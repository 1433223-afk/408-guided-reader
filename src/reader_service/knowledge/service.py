from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import threading
from collections import deque
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from reader_service.agent_runtime import (
    ProviderCompletion,
    ProviderFailure,
    ProviderFailureKind,
    ProviderRuntimeSet,
)
from reader_service.foundation import FoundationService
from reader_service.library import LibraryService
from reader_service.outline import ChapterResolutionError, OutlineService

from .repository import ChapterRegenerationBlocked, KnowledgeRepository
from .semantic import (
    SemanticOutputError,
    build_compact_review_ledger,
    build_evidence_units,
    build_semantic_windows,
    materialize_candidates,
    publication_points,
    semantic_window_payload,
    validate_semantic_output,
)


MAX_STRUCTURED_ATTEMPTS = 3
MAX_SAFE_REVIEW_DETAIL_CHARACTERS = 240
MAX_SOURCE_CHARACTERS = 180_000
DEFAULT_GENERATOR_MAX_TOKENS = 4_096
DEFAULT_REVIEWER_MAX_TOKENS = 8_192
DEFAULT_SECTION_GENERATION_WORKERS = 2

REVIEW_RUBRIC = (
    "independently_trackable_granularity",
    "duplicate_or_near_duplicate_semantics",
    "instructional_specificity",
    "split_merge_quality",
    "major_learning_coverage",
    "section_and_source_faithfulness",
    "chapter_map_balance",
)

GENERATOR_SYSTEM_MESSAGE = """你是教材 Chapter Knowledge Map 的内部语义归并器，不是用户对话助手。
输入是一个真实 Outline 小节（或没有子小节时的 Section fallback）内按教材顺序排列的 deterministic evidence units。你只做这一次最终 learning-identity partition；不得依据先前模型结果做第二轮合并、拆分、清理或修复。
KP 是最小的、值得独立教学、独立检查、独立诊断、独立补救并长期记录掌握状态的学习单元。必须预设吸收：只有当前教材证据能正面证明某个内容需要独立 teaching + assessment + diagnosis + remediation，才建立一个 learning target。对相邻条目必须先问：未来是否确实需要分别教学，并在学习者失败时采用不同的诊断或补救路径？只要不需要分别教学，或补救路径没有实质区别，就必须合为同一个 target。若不确定是否值得维护两个独立 mastery 状态，也必须合并。能单独出一道事实题、拥有不同标题、术语、段落、方向、变体或编号，都不足以形成 mastery boundary。
标题本身、例子本身不成为 KP；definition/property/ordinary step/example 默认属于同一 learning target。只有既能独立教学、又具有不同错误模式或补救路径，且当前 source evidence 对两者都有充分展开时，才可以拆成不同 targets。
同一学习对象的多种分类方式，默认合为一个分类框架；分类维度或分类项本身不单独成为 KP。同一学习目标下的一组成套方法、互补步骤或替代实现，默认整体理解并合为一个 target；只有其中某项有充分独立展开，并确实需要不同教学、检查和补救时才拆分。
例题、章节概览、后文预告和对前文的比较总结，默认进入 non_kp_units 或吸收到其所说明的 learning target，不单独铸造 KP；它们包含的新且充分展开的独立机制除外。
window.kp_creation 为 FORBIDDEN_REVIEW_MATERIAL 时，该窗口属于本章/本节小结、常见问题、易混淆或 FAQ 复习材料：learning_targets 必须为空，全部 unit_id 必须进入 non_kp_units；这些内容只补充已有 KP，绝不在这里铸造新 KP。
non_kp_units 只表示这些 evidence 不在本窗口铸造成独立 KP，不表示内容无价值。facet/property/step/example 可以被包含在某个 target 的连续 source evidence 中。
不得追求特定 KP 数量，也不得创建掩盖不同机制、错误模式或补救路径的宽泛伞形 KP。
unit_id、Section、Outline 小节和来源范围均由服务端确定；不得创建或改写，不得输出 Section/page/ref/坐标/来源字段，不得跨 window 或跨 Section 组合，也不得生成 Learning、Mastery、Progress、Master、Teaching 或 ExamEvidence。
只返回一个 JSON 对象：{"learning_targets":[{"unit_ids":["一个或多个连续的给定 unit_id"],"title":"知识点标题","one_sentence_meaning":"一句话含义"}],"non_kp_units":["其余给定 unit_id"]}。
learning_targets 按教材顺序排列，每个 target 的 unit_ids 必须连续；non_kp_units 也按教材顺序排列。两者合计必须覆盖每个给定 unit_id 恰好一次。不得返回 Markdown 代码围栏、推理过程或其他字段。"""

REVIEW_SYSTEM_MESSAGE = """你是独立的 Chapter Knowledge Map 结构审查者，只判断给定的完整 Chapter map 是否可以发布。
输入是服务端生成的 compact ledger：完整 unit/partition accounting、候选标题与含义、截断证据提示和 overlap warnings，不含原始几何。必须先扫描全部 Sections，再整体检查：可独立追踪的颗粒度、语义重复/近重复、instructional specificity、拆分/合并质量、主要学习内容覆盖、Section/来源忠实度和 map-level balance。
overlap_warnings 只是审查信号，不是自动失败；来源空隙正常，不要求 no-gaps。你只能定位问题，不能改写候选，不能生成来源字段，也不能写入 Learning、Mastery、Progress、Master、Teaching 或 ExamEvidence。
BLOCKING 仅用于依据 ledger 可高置信判断、若不修复就会让整张图不可发布的缺陷，例如同一学习状态被重复保留、伪造或泛化认知 KP、重大独立学习内容缺失、明显错误的 Section/来源归属，或会形成无意义 mastery 状态的严重拆分/合并。存在优化空间、可选的命名/合并方案、轻微不均衡、例示/回顾是否另列、或因截断证据无法高置信判断的问题只能是 WARNING；不得因为还能改进就阻断发布。
每个 finding 必须定位到一个现有 section_id，并引用该 Section 中一个或多个给定 unit_id；只定位真正需要改变的最小 units。跨 Section 重复应为需要修复的一侧给出定位明确的 finding，不要把正确对照一并列为修复目标。
只返回一个 JSON 对象，且只能含三个字段：{"verdict":"PASS 或 FAIL","summary":"不超过 1000 字的简体中文理由","findings":[{"dimension":"review_rubric 中的一个值","severity":"BLOCKING 或 WARNING","section_id":"现有 Section ID","unit_ids":["该 Section 的给定 unit_id"],"detail":"具体、可操作的简体中文问题说明"}]}。
FAIL 必须至少有一个 BLOCKING finding；PASS 不得含 BLOCKING finding。不得返回 Markdown 代码围栏、修订后的 KP 或其他文字。"""


class KnowledgePipelineError(RuntimeError):
    def __init__(
        self,
        stage: str,
        kind: str,
        code: str,
        message: str,
        *,
        provider: str | None = None,
        model: str | None = None,
        summary: str | None = None,
    ):
        super().__init__(message)
        self.stage = stage
        self.kind = kind
        self.code = code
        self.provider = provider
        self.model = model
        self.summary = summary


@dataclass(frozen=True, slots=True)
class ReviewVerdict:
    verdict: str
    summary: str
    findings: tuple[dict, ...]


class KnowledgeService:
    """One-Chapter private-draft pipeline with atomic durable publication."""

    def __init__(
        self,
        library: LibraryService,
        foundation: FoundationService,
        outline: OutlineService,
        repository: KnowledgeRepository,
        runtime: ProviderRuntimeSet,
        *,
        generator_provider: str | None = None,
        reviewer_provider: str | None = None,
        generator_max_tokens: int | None = None,
        reviewer_max_tokens: int | None = None,
        section_generation_workers: int | None = None,
        post_review_validator=None,
    ):
        self.library = library
        self.foundation = foundation
        self.outline = outline
        self.repository = repository
        self.runtime = runtime
        self.generator_provider = (
            generator_provider
            or os.environ.get("GUIDED_READER_KP_GENERATOR_PROVIDER", runtime.active_provider)
        ).strip().lower()
        self.reviewer_provider = (
            reviewer_provider
            or os.environ.get(
                "GUIDED_READER_KP_REVIEW_PROVIDER",
                os.environ.get("GUIDED_READER_REVIEW_PROVIDER", "zhipu"),
            )
        ).strip().lower()
        self.generator_max_tokens = (
            generator_max_tokens if generator_max_tokens is not None
            else self._environment_int(
                "GUIDED_READER_KP_GENERATOR_MAX_TOKENS", DEFAULT_GENERATOR_MAX_TOKENS
            )
        )
        self.reviewer_max_tokens = (
            reviewer_max_tokens if reviewer_max_tokens is not None
            else self._environment_int(
                "GUIDED_READER_KP_REVIEW_MAX_TOKENS", DEFAULT_REVIEWER_MAX_TOKENS
            )
        )
        self.section_generation_workers = (
            section_generation_workers if section_generation_workers is not None
            else self._environment_int(
                "GUIDED_READER_KP_SECTION_WORKERS", DEFAULT_SECTION_GENERATION_WORKERS
            )
        )
        if isinstance(self.generator_max_tokens, bool) or not 1 <= self.generator_max_tokens <= 16384:
            raise ValueError("KP generator max_tokens must be between 1 and 16384")
        if isinstance(self.reviewer_max_tokens, bool) or not 1 <= self.reviewer_max_tokens <= 16384:
            raise ValueError("KP reviewer max_tokens must be between 1 and 16384")
        if isinstance(self.section_generation_workers, bool) or not 1 <= self.section_generation_workers <= 4:
            raise ValueError("KP Section generation workers must be between 1 and 4")
        self.post_review_validator = post_review_validator
        self._inspections: deque[dict] = deque(maxlen=8)
        self._inspection_lock = threading.Lock()

    def snapshot(self, revision_id: str, chapter_id: str) -> dict:
        self.library.revision(revision_id)
        return self.repository.snapshot(revision_id, chapter_id)

    def request_prepare(self, revision_id: str, chapter_id: str) -> tuple[dict, bool]:
        self.library.revision(revision_id)
        return self.repository.request_prepare(revision_id, chapter_id)

    def request_regenerate(self, revision_id: str, chapter_id: str) -> tuple[dict, bool]:
        self.library.revision(revision_id)
        return self.repository.request_regenerate(revision_id, chapter_id)

    def required_page_range(self, revision_id: str, chapter_id: str) -> tuple[int, int]:
        nodes = self.outline.repository.list(revision_id)
        ordered = self.outline._topological(nodes)
        chapter = next(
            (node for node in ordered if node["outline_node_id"] == chapter_id), None
        )
        if chapter is None or chapter["kind"] != "CHAPTER" or chapter["parent_id"] is not None:
            raise ValueError("Knowledge Map preparation requires one top-level Chapter")
        if chapter["start_page"] is None:
            raise ValueError("Chapter has no safe start page")
        next_root = next(
            (
                node for node in ordered
                if node["parent_id"] is None
                and node["order_index"] > chapter["order_index"]
                and node["start_page"] is not None
            ),
            None,
        )
        revision = self.library.revision(revision_id)
        end = int(next_root["start_page"]) if next_root else int(revision["page_count"])
        return int(chapter["start_page"]), end

    def run_job(self, job: dict) -> dict:
        revision_id = job["book_source_revision_id"]
        chapter_id = job["chapter_outline_node_id"]
        try:
            state = self.repository.snapshot(revision_id, chapter_id)
        except LookupError:
            return self._cancelled_job_result(revision_id, chapter_id)
        if state["status"] != "PREPARING" and not (
            state["status"] == "READY" and state["regeneration_state"] == "RUNNING"
        ):
            return state
        attempt_id = state["attempt_id"]
        generator_identity = (None, None)
        reviewer_identity = (None, None)
        source_hash = None
        review_hash = None
        review_summary = None
        inspection = {
            "revision_id": revision_id,
            "chapter_id": chapter_id,
            "attempt_id": attempt_id,
            "generator_provider": self.generator_provider,
            "reviewer_provider": self.reviewer_provider,
            "source_payload_sha256": None,
            "source_character_count": 0,
            "source_payload_character_count": 0,
            "unit_count": 0,
            "window_count": 0,
            "candidate_count": 0,
            "window_bounds": [],
            "review": None,
            "outcome": "PREPARING",
        }
        try:
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="RESOLVING_SOURCE", sections_completed=0, sections_total=0,
            )
            resolved = self.outline.resolve_chapter_physical(revision_id, chapter_id)
            chapter = resolved["chapter"]
            revision = self.library.revision(revision_id)
            self.repository.update_dependencies(
                revision_id, chapter_id, attempt_id,
                foundation_version=int(revision["foundation_version"]),
                identity_revision=int(chapter["identity_revision"]),
                physical_revision=int(chapter["physical_revision"]),
            )
            source_payload, _ref_index, section_bounds = self._source_projection(
                revision, resolved
            )
            source_hash = self._digest(source_payload)
            inspection["source_payload_sha256"] = source_hash
            inspection["source_payload_character_count"] = len(
                self._canonical(source_payload)
            )
            units = build_evidence_units(source_payload)
            windows = build_semantic_windows(units)
            section_count = len({unit["primary_section_id"] for unit in units})
            inspection["unit_count"] = len(units)
            inspection["source_character_count"] = sum(
                len(unit["text"]) for unit in units
            )
            inspection["window_count"] = len(windows)
            inspection["window_bounds"] = [
                {
                    "window_id": window["window_id"],
                    "section_id": window["primary_section_id"],
                    "outline_subsection_id": window["outline_subsection_id"],
                    "unit_count": len(window["units"]),
                    "character_count": window["character_count"],
                }
                for window in windows
            ]
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="GENERATING", sections_completed=0,
                sections_total=section_count,
            )
            partitions_by_window, generator_identity = self._classify_windows(
                windows, source_payload["chapter"], revision_id, chapter_id,
                attempt_id,
            )
            inspection["candidate_count"] = sum(
                len(partition["learning_targets"])
                for partition in partitions_by_window.values()
            )
            candidates = materialize_candidates(windows, partitions_by_window)
            points = publication_points(candidates)
            self._validate_points(points, section_bounds)
            review_payload = build_compact_review_ledger(
                source_payload["chapter"], units, windows,
                partitions_by_window, candidates,
                semantic_provider=self._required_identity(
                    generator_identity, "generator"
                )[0],
                semantic_model=self._required_identity(
                    generator_identity, "generator"
                )[1],
                review_rubric=REVIEW_RUBRIC,
                overlap_warnings=self._overlap_warnings(points),
            )
            review_hash = self._digest(review_payload)
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="REVIEWING", sections_completed=section_count,
                sections_total=section_count,
            )
            verdict, reviewer_identity = self._review(
                review_payload, revision_id, chapter_id, attempt_id,
            )
            review_summary = verdict.summary
            inspection["review"] = self._safe_review_observation(
                verdict,
                review_hash,
                len(self._canonical(review_payload)),
            )
            if verdict.verdict != "PASS":
                raise KnowledgePipelineError(
                    "REVIEW", "SEMANTIC_FAILURE", "review_rejected",
                    "Structural Review rejected the candidate set",
                    provider=reviewer_identity[0], model=reviewer_identity[1],
                    summary=verdict.summary,
                )
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="VALIDATING", sections_completed=section_count,
                sections_total=section_count,
            )
            self._validate_points(points, section_bounds)
            if self.post_review_validator is not None:
                try:
                    self.post_review_validator(copy.deepcopy(points))
                except Exception as failure:
                    raise KnowledgePipelineError(
                        "DETERMINISTIC_VALIDATION", "INVALID_CANDIDATE",
                        "deterministic_validation_failed", type(failure).__name__,
                    ) from failure
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="PUBLISHING", sections_completed=section_count,
                sections_total=section_count,
            )
            published = self.repository.publish(
                revision_id, chapter_id, attempt_id,
                foundation_version=int(revision["foundation_version"]),
                identity_revision=int(chapter["identity_revision"]),
                physical_revision=int(chapter["physical_revision"]),
                points=points,
                generator_provider=self._required_identity(generator_identity, "generator")[0],
                generator_model=self._required_identity(generator_identity, "generator")[1],
                reviewer_provider=self._required_identity(reviewer_identity, "reviewer")[0],
                reviewer_model=self._required_identity(reviewer_identity, "reviewer")[1],
                review_summary=verdict.summary,
                source_payload_sha256=source_hash,
                review_payload_sha256=review_hash,
            )
            inspection["outcome"] = "READY"
            self._record_inspection(inspection)
            return published
        except ChapterResolutionError as failure:
            error = KnowledgePipelineError(
                "RANGE_RESOLUTION", "DETERMINISTIC", failure.code, str(failure)
            )
        except ProviderFailure as failure:
            # Provider calls are normally normalized at their exact stage. This is
            # the fail-closed guard for a custom runtime violating that contract.
            error = KnowledgePipelineError(
                "AGENT_RUNTIME", failure.kind.value, failure.code,
                failure.user_message,
            )
        except KnowledgePipelineError as failure:
            error = failure
        except ChapterRegenerationBlocked as failure:
            error = KnowledgePipelineError(
                "PUBLICATION", "DEPENDENCY_LOCK", failure.code, str(failure)
            )
        except SemanticOutputError as failure:
            error = KnowledgePipelineError(
                "SOURCE_CAPACITY", "INPUT_LIMIT", failure.code, str(failure),
            )
        except (ValueError, AssertionError) as failure:
            error = KnowledgePipelineError(
                "DETERMINISTIC_VALIDATION", "INVALID_CANDIDATE",
                "deterministic_validation_failed", str(failure),
            )
        except Exception as failure:
            error = KnowledgePipelineError(
                "PUBLICATION", "TECHNICAL_FAILURE", "publication_failed",
                type(failure).__name__,
            )

        if error.stage == "GENERATION" and error.provider:
            generator_identity = (error.provider, error.model)
        if error.stage == "REVIEW" and error.provider:
            reviewer_identity = (error.provider, error.model)
        self.repository.fail(
            revision_id, chapter_id, attempt_id,
            stage=error.stage, kind=error.kind, code=error.code,
            generator_provider=generator_identity[0], generator_model=generator_identity[1],
            reviewer_provider=reviewer_identity[0], reviewer_model=reviewer_identity[1],
            review_summary=error.summary or review_summary,
            source_payload_sha256=source_hash, review_payload_sha256=review_hash,
        )
        inspection["outcome"] = "FAILED"
        inspection["failure"] = {
            "stage": error.stage, "kind": error.kind, "code": error.code
        }
        self._record_inspection(inspection)
        try:
            return self.repository.snapshot(revision_id, chapter_id)
        except LookupError:
            return self._cancelled_job_result(revision_id, chapter_id)

    def inspect_payloads(self, revision_id: str, chapter_id: str) -> dict:
        with self._inspection_lock:
            items = [
                copy.deepcopy(item) for item in self._inspections
                if item["revision_id"] == revision_id and item["chapter_id"] == chapter_id
            ]
        return {
            "attempts": items,
            "pipeline_attempts": self.repository.pipeline_attempts(
                revision_id, chapter_id
            ),
        }

    @staticmethod
    def _safe_review_observation(
        verdict: ReviewVerdict,
        review_hash: str,
        payload_character_count: int,
    ) -> dict:
        return {
            "review_payload_sha256": review_hash,
            "payload_character_count": payload_character_count,
            "verdict": verdict.verdict,
            "findings": [
                {
                    "dimension": finding["dimension"],
                    "severity": finding["severity"],
                    "section_id": finding["section_id"],
                    "unit_ids": list(finding["unit_ids"]),
                    "detail": re.sub(r"\s+", " ", finding["detail"]).strip()[
                        :MAX_SAFE_REVIEW_DETAIL_CHARACTERS
                    ],
                }
                for finding in verdict.findings
            ],
        }

    def _record_inspection(self, inspection: dict) -> None:
        with self._inspection_lock:
            self._inspections.append(copy.deepcopy(inspection))

    @staticmethod
    def _cancelled_job_result(revision_id: str, chapter_id: str) -> dict:
        """Return an internal terminal result when owning Book deletion wins the race."""
        return {
            "book_source_revision_id": revision_id,
            "chapter_outline_node_id": chapter_id,
            "status": "CANCELLED",
            "structure_version": 0,
            "knowledge_points": [],
        }

    def _source_projection(self, revision: dict, resolved: dict):
        chapter = resolved["chapter"]
        sections = [node for node in resolved["nodes"] if node["kind"] == "SECTION"]
        if not sections:
            raise ValueError("Chapter has no resolved primary Sections")
        _, ready_pages = self.outline.repository.ready_snapshot(revision["id"])
        source_sections = []
        ref_index: dict[str, dict] = {}
        section_bounds = {}
        excluded_ranges = [
            (tuple(item["start"]), tuple(item["end"]))
            for item in resolved.get("excluded_ranges", [])
        ]
        total_chars = 0
        for section in sorted(sections, key=lambda value: value["order_index"]):
            bounds = (
                (section["start_page"], section["start_y"]),
                (section["end_page"], section["end_y"]),
            )
            section_bounds[section["outline_node_id"]] = bounds
            subsection_ranges = []
            for subsection in resolved["nodes"]:
                if (
                    subsection["kind"] != "SUBSECTION"
                    or subsection["parent_id"] != section["outline_node_id"]
                    or subsection.get("start_page") is None
                    or subsection.get("start_y") is None
                    or subsection.get("end_page") is None
                    or subsection.get("end_y") is None
                ):
                    continue
                subsection_ranges.append(
                    {
                        "outline_node_id": subsection["outline_node_id"],
                        "title": subsection["title"],
                        "start": (subsection["start_page"], subsection["start_y"]),
                        "end": (subsection["end_page"], subsection["end_y"]),
                    }
                )
            subsection_ranges.sort(key=lambda value: value["start"])
            source_lines = []
            for page_index in range(bounds[0][0], min(bounds[1][0], revision["page_count"] - 1) + 1):
                for line in ready_pages.get(page_index, []):
                    ys = [float(point[1]) for point in line["quad"]]
                    position = (page_index, min(ys))
                    if position < bounds[0] or position >= bounds[1]:
                        continue
                    if any(start <= position < end for start, end in excluded_ranges):
                        continue
                    ref = f"p{page_index}:l{line['line_ordinal']}"
                    item = {
                        "line_ref": ref,
                        "pdf_page_index": page_index,
                        "line_ordinal": int(line["line_ordinal"]),
                        "y_start": min(ys), "y_end": max(ys),
                        "text": line["text"],
                    }
                    source_lines.append(item)
                    ref_index[ref] = {**item, "section_id": section["outline_node_id"]}
                    total_chars += len(line["text"])
            if not source_lines:
                raise ValueError(f"Resolved Section has no bounded OCR source: {section['title']}")
            source_sections.append(
                {
                    "section_id": section["outline_node_id"],
                    "title": section["title"],
                    "range": {
                        "start_page": bounds[0][0], "start_y": bounds[0][1],
                        "end_page": bounds[1][0], "end_y": bounds[1][1],
                    },
                    "subsections": subsection_ranges,
                    "lines": source_lines,
                }
            )
        if total_chars > MAX_SOURCE_CHARACTERS:
            raise ValueError("Chapter source exceeds the bounded provider payload limit")
        outline_projection = [
            {
                "outline_node_id": node["outline_node_id"],
                "parent_id": node["parent_id"], "kind": node["kind"],
                "title": node["title"], "order_index": node["order_index"],
                "identity_revision": node["identity_revision"],
                "physical_revision": node["physical_revision"],
            }
            for node in resolved["nodes"]
        ]
        payload = {
            "chapter": {
                "book_source_revision_id": revision["id"],
                "chapter_outline_node_id": chapter["outline_node_id"],
                "title": chapter["title"],
                "foundation_version": revision["foundation_version"],
                "identity_revision": chapter["identity_revision"],
                "physical_revision": chapter["physical_revision"],
            },
            "outline": outline_projection,
            "source_sections": source_sections,
        }
        return payload, ref_index, section_bounds

    def _classify_windows(
        self,
        windows: list[dict],
        chapter: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
    ):
        if not windows:
            raise ValueError("Chapter has no semantic windows")
        results: dict[str, dict] = {}
        identities: set[tuple[str | None, str | None]] = set()
        section_windows: dict[str, list[dict]] = {}
        for window in windows:
            section_windows.setdefault(window["primary_section_id"], []).append(window)

        def classify_section(local_windows: list[dict]):
            local_results = {}
            local_identities = set()
            for window in local_windows:
                partition, identity = self._classify_window(
                    window, chapter, revision_id, chapter_id, attempt_id
                )
                local_results[window["window_id"]] = partition
                local_identities.add(identity)
            return local_results, local_identities

        first_failure: Exception | None = None
        completed_sections = 0
        workers = min(self.section_generation_workers, len(section_windows))
        executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="kp-semantic-section"
        )
        futures = {
            executor.submit(classify_section, local_windows): section_id
            for section_id, local_windows in section_windows.items()
        }
        try:
            for future in as_completed(futures):
                try:
                    section_results, section_identities = future.result()
                except CancelledError:
                    continue
                except Exception as failure:
                    if first_failure is None:
                        first_failure = failure
                        for sibling in futures:
                            if sibling is not future:
                                sibling.cancel()
                else:
                    results.update(section_results)
                    identities.update(section_identities)
                    completed_sections += 1
                    self.repository.update_progress(
                        revision_id, chapter_id, attempt_id,
                        stage="GENERATING",
                        sections_completed=completed_sections,
                        sections_total=len(section_windows),
                    )
        finally:
            executor.shutdown(wait=True, cancel_futures=True)
        if first_failure is not None:
            raise first_failure
        if set(results) != {window["window_id"] for window in windows}:
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE",
                "incomplete_window_classification",
                "Not every required semantic window produced a private partition",
            )
        if len(identities) != 1:
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE",
                "inconsistent_generator_route",
                "Semantic windows did not retain one actual provider/model route",
            )
        return results, next(iter(identities))

    def _classify_window(
        self,
        window: dict,
        chapter: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
    ):
        identity = self._configured_identity(self.generator_provider, "GENERATION")
        payload = semantic_window_payload(chapter, window)
        messages = [
            {"role": "system", "content": GENERATOR_SYSTEM_MESSAGE},
            {"role": "user", "content": self._canonical(payload)},
        ]
        for structured_attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            observer = lambda event, current_attempt=structured_attempt: (
                self.repository.record_pipeline_attempt(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    section_id=window["primary_section_id"],
                    packet_or_stage_id=window["window_id"],
                    semantic_round=0,
                    structured_attempt=current_attempt,
                    provider_role="KP_GENERATOR",
                    pipeline_stage="SEMANTIC_CLASSIFICATION",
                    event=event,
                )
            )
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.generator_provider,
                    messages,
                    interaction_id=(
                        f"kp-semantic:{attempt_id}:{window['window_id']}:"
                        f"structured-{structured_attempt}"
                    ),
                    max_tokens=self.generator_max_tokens,
                    attempt_observer=observer,
                    retain_request_body=False,
                    thinking_mode=(
                        "disabled" if self.generator_provider == "deepseek" else None
                    ),
                    reasoning_effort=(
                        "low" if self.generator_provider == "zhipu" else None
                    ),
                )
            except ProviderFailure as failure:
                raise KnowledgePipelineError(
                    "GENERATION", failure.kind.value, failure.code,
                    failure.user_message, provider=identity[0], model=identity[1],
                ) from failure
            identity = self._completion_identity(completion)
            try:
                return validate_semantic_output(completion.answer, window), identity
            except SemanticOutputError as failure:
                safe_failure_code = f"invalid_semantic_output.{failure.code}"
                self.repository.record_structured_validation_failure(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    packet_or_stage_id=window["window_id"],
                    semantic_round=0,
                    structured_attempt=structured_attempt,
                    pipeline_stage="SEMANTIC_CLASSIFICATION",
                    failure_code=safe_failure_code,
                )
                if structured_attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "GENERATION", "INVALID_STRUCTURED_OUTPUT",
                        safe_failure_code, str(failure),
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded semantic classification loop exhausted")

    def _review(
        self,
        payload: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
    ):
        identity = self._configured_identity(self.reviewer_provider, "REVIEW")
        messages = [
            {"role": "system", "content": REVIEW_SYSTEM_MESSAGE},
            {"role": "user", "content": self._canonical(payload)},
        ]
        for structured_attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            observer = lambda event, current_attempt=structured_attempt: (
                self.repository.record_pipeline_attempt(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    section_id=None,
                    packet_or_stage_id="chapter-structural-review",
                    semantic_round=0,
                    structured_attempt=current_attempt,
                    provider_role="KP_STRUCTURAL_REVIEWER",
                    pipeline_stage="STRUCTURAL_REVIEW",
                    event=event,
                )
            )
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.reviewer_provider,
                    messages,
                    interaction_id=(
                        f"kp-review:{attempt_id}:structured-{structured_attempt}"
                    ),
                    max_tokens=self.reviewer_max_tokens,
                    attempt_observer=observer,
                    retain_request_body=False,
                    thinking_mode=(
                        "disabled" if self.reviewer_provider == "deepseek" else None
                    ),
                    reasoning_effort=(
                        "low" if self.reviewer_provider == "zhipu" else None
                    ),
                )
            except ProviderFailure as failure:
                raise KnowledgePipelineError(
                    "REVIEW", failure.kind.value, failure.code,
                    failure.user_message, provider=identity[0], model=identity[1],
                ) from failure
            identity = self._completion_identity(completion)
            try:
                return self._validate_review(completion.answer, payload), identity
            except ValueError as failure:
                self.repository.record_structured_validation_failure(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    packet_or_stage_id="chapter-structural-review",
                    semantic_round=0,
                    structured_attempt=structured_attempt,
                    pipeline_stage="STRUCTURAL_REVIEW",
                    failure_code="invalid_review_output",
                )
                if structured_attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "REVIEW", "INVALID_STRUCTURED_OUTPUT",
                        "invalid_review_output", str(failure),
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded Review loop exhausted")

    @staticmethod
    def _validate_points(points: list[dict], section_bounds: dict) -> None:
        if not points:
            raise ValueError("Published Chapter contains no KnowledgePoints")
        for point in points:
            if set(point) != {
                "primary_section_id", "title", "one_sentence_definition",
                "start_page", "start_y", "end_page", "end_y",
            }:
                raise ValueError("Resolved KP contains undeclared fields")
            if point["primary_section_id"] not in section_bounds:
                raise ValueError("Resolved KP primary Section is invalid")
            start = (point["start_page"], point["start_y"])
            end = (point["end_page"], point["end_y"])
            bounds = section_bounds[point["primary_section_id"]]
            if not bounds[0] <= start < end <= bounds[1]:
                raise ValueError("Resolved KP range is invalid")

    @staticmethod
    def _overlap_warnings(points: list[dict]) -> list[dict]:
        warnings = []
        for left_index, left in enumerate(points):
            left_start = (left["start_page"], left["start_y"])
            left_end = (left["end_page"], left["end_y"])
            for right_index in range(left_index + 1, len(points)):
                right = points[right_index]
                if left["primary_section_id"] != right["primary_section_id"]:
                    continue
                right_start = (right["start_page"], right["start_y"])
                right_end = (right["end_page"], right["end_y"])
                if max(left_start, right_start) < min(left_end, right_end):
                    warnings.append(
                        {
                            "first_candidate_index": left_index,
                            "second_candidate_index": right_index,
                            "primary_section_id": left["primary_section_id"],
                            "signal": "SHARED_SOURCE_EVIDENCE_REVIEW_REQUIRED",
                        }
                    )
        return warnings

    @staticmethod
    def _validate_review(answer: str, payload: dict) -> ReviewVerdict:
        try:
            value = json.loads(answer)
        except (TypeError, ValueError):
            raise ValueError("Review output is not JSON") from None
        if not isinstance(value, dict) or set(value) != {
            "verdict", "summary", "findings"
        }:
            raise ValueError("Review output fields are invalid")
        if value["verdict"] not in {"PASS", "FAIL"}:
            raise ValueError("Review verdict is invalid")
        summary = value["summary"]
        if not isinstance(summary, str) or not summary.strip() or len(summary.strip()) > 1000:
            raise ValueError("Review summary is invalid")
        findings = value["findings"]
        if not isinstance(findings, list) or len(findings) > 24:
            raise ValueError("Review findings are invalid")

        section_units = {
            section["section_id"]: {
                unit["unit_id"] for unit in section["units"]
            }
            for section in payload["sections"]
        }
        rubric = set(payload["review_rubric"])
        expected = {
            "dimension", "severity", "section_id", "unit_ids", "detail",
        }
        normalized = []
        for finding in findings:
            if not isinstance(finding, dict) or set(finding) != expected:
                raise ValueError("Review finding fields are invalid")
            if finding["dimension"] not in rubric:
                raise ValueError("Review finding dimension is invalid")
            severity = finding["severity"]
            if severity not in {"BLOCKING", "WARNING"}:
                raise ValueError("Review finding severity is invalid")
            section_id = finding["section_id"]
            if not isinstance(section_id, str) or section_id not in section_units:
                raise ValueError("Review finding Section is invalid")
            unit_ids = finding["unit_ids"]
            if not isinstance(unit_ids, list) or not unit_ids or any(
                not isinstance(unit_id, str)
                or unit_id not in section_units[section_id]
                for unit_id in unit_ids
            ) or len(unit_ids) != len(set(unit_ids)):
                raise ValueError("Review finding unit IDs are invalid")
            detail = finding["detail"]
            if not isinstance(detail, str) or not detail.strip() \
                    or len(detail.strip()) > 600:
                raise ValueError("Review finding detail is invalid")
            normalized.append({
                "dimension": finding["dimension"],
                "severity": severity,
                "section_id": section_id,
                "unit_ids": list(unit_ids),
                "detail": detail.strip(),
            })

        blocking = [
            finding for finding in normalized
            if finding["severity"] == "BLOCKING"
        ]
        if value["verdict"] == "FAIL" and not blocking:
            raise ValueError("Review FAIL lacks a blocking finding")
        if value["verdict"] == "PASS" and blocking:
            raise ValueError("Review PASS contains a blocking finding")
        return ReviewVerdict(value["verdict"], summary.strip(), tuple(normalized))

    def _configured_identity(self, provider: str, stage: str) -> tuple[str, str | None]:
        try:
            return self.runtime.provider_identity(provider)
        except ProviderFailure as failure:
            raise KnowledgePipelineError(
                stage, failure.kind.value, failure.code, failure.user_message,
                provider=provider,
            ) from failure

    @staticmethod
    def _completion_identity(completion: ProviderCompletion) -> tuple[str | None, str | None]:
        config = completion.effective_config or {}
        return config.get("provider"), config.get("model")

    @staticmethod
    def _required_identity(identity: tuple[str | None, str | None], label: str):
        if not identity[0] or not identity[1]:
            raise KnowledgePipelineError(
                "PUBLICATION", "TECHNICAL_FAILURE", f"missing_{label}_identity",
                f"Actual {label} route identity was not recorded",
            )
        return identity

    @staticmethod
    def _canonical(value: dict) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @classmethod
    def _digest(cls, value: dict) -> str:
        return hashlib.sha256(cls._canonical(value).encode("utf-8")).hexdigest()

    @staticmethod
    def _environment_int(name: str, default: int) -> int:
        try:
            return int(os.environ.get(name, str(default)))
        except ValueError:
            return -1
