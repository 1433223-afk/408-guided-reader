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

from .repository import KnowledgeRepository


MAX_STRUCTURED_ATTEMPTS = 2
MAX_SEMANTIC_REPAIR_ROUNDS = 1
MAX_SOURCE_CHARACTERS = 180_000
DEFAULT_GENERATOR_MAX_TOKENS = 12_288
DEFAULT_REVIEWER_MAX_TOKENS = 12_288
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

GENERATOR_SYSTEM_MESSAGE = """你是教材 Chapter Knowledge Map 的内部 KP 生成器（Section 级），不是用户对话助手。
只使用给定章节身份、唯一一个 primary Section 的目录子树和该 Section 的 OCR 来源；Original PDF 是教材权威。
KnowledgePoint 必须是值得独立记录理解状态、可独立检查的学习单元，不得机械复制每个段落、标题、词语或泛化的认知动作。
每个 KP 必须且只能归属给定的 primary Section，并用给定 line_ref 指明一个连续且足以支撑该 KP 的主要来源范围。
所有 KP 按教材顺序排列。教材文本不必被 KP 范围完整分割；不同 KP 只有在确有独立学习价值时才可共享来源证据。
不得创建、删除、改名、重排或重挂 Outline；不得生成 Learning、Mastery、Progress、Master、Teaching 或 ExamEvidence。
只返回一个 JSON 对象：{"knowledge_points":[{"draft_key":"本次草稿内唯一键","primary_section_id":"现有 Section ID","title":"知识点标题","one_sentence_definition":"一句话定义","start_ref":"pN:lN","end_ref":"pN:lN"}]}。
不得返回坐标、Markdown 代码围栏、推理过程或其他字段。"""

REVIEW_SYSTEM_MESSAGE = """你是独立的 Chapter Knowledge Map 结构审查者，只判断给定候选是否可以发布。
必须整体审查完整 Chapter map，并逐项检查：KP 是否是可独立追踪/检查的学习单元；是否存在语义重复或近重复；是否误把“推理、答题、问题解决”等泛化能力当成学科知识；拆分/合并是否合理；是否覆盖主要可学习内容；primary Section 与来源是否忠实且充分；各 Section 的颗粒度与数量是否明显失衡。
overlap_warnings 只是共享来源证据的审查信号，不是自动失败：判断它代表合理共享证据，还是重复、近重复或不当拆分。来源空隙是正常的，不要求每行教材都有 KP。
Original PDF 是教材权威。你只能审查，不能改写候选，不能写入 Learning、Mastery、Progress、Master、Teaching 或 ExamEvidence。
只返回一个 JSON 对象，且只能含三个字段：{"verdict":"PASS 或 FAIL","summary":"不超过 1000 字的简体中文理由","findings":[{"dimension":"review_rubric 中的一个值","severity":"BLOCKING 或 WARNING","candidate_indices":[0],"evidence_section_ids":["现有 Section ID"],"repair_section_ids":["必须重生成候选的最小 Section 集合"],"detail":"具体、可操作的简体中文问题说明"}]}。
candidate_indices 必须引用输入 candidate_knowledge_points 的零基索引。跨 Section 重复应在 evidence_section_ids 和 candidate_indices 中列出双方，但 repair_section_ids 只列需要改变的最小 Section，不要仅因作为正确对照就列入。覆盖遗漏可使用空 candidate_indices，但仍须指出受影响 Section。
FAIL 必须至少有一个 BLOCKING finding，且每个 BLOCKING finding 必须有非空 repair_section_ids；PASS 不得含 BLOCKING finding。WARNING 的 repair_section_ids 必须为空。
不得返回 Markdown 代码围栏、修订后的 KP 或其他文字。"""


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
        if state["status"] != "PREPARING":
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
            "source_payload": None,
            "generation_payloads": [],
            "review_payload": None,
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
            source_payload, ref_index, section_bounds = self._source_projection(
                revision, resolved
            )
            inspection["source_payload"] = copy.deepcopy(source_payload)
            source_hash = self._digest(source_payload)
            section_payloads = self._section_generation_payloads(source_payload)
            inspection["generation_payloads"] = copy.deepcopy(section_payloads)
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="GENERATING", sections_completed=0,
                sections_total=len(section_payloads),
            )
            candidate_sets, generator_identity = self._generate_sections(
                section_payloads, ref_index, section_bounds,
                revision_id, chapter_id, attempt_id,
            )
            semantic_repair_round = 0
            while True:
                draft = self._assemble_candidate_sets(section_payloads, candidate_sets)
                points = self._resolve_ranges(draft, ref_index, section_bounds)
                self._validate_points(points, section_bounds)
                review_payload = self._review_payload(
                    source_payload, points, generator_identity,
                    len(section_payloads), semantic_repair_round,
                )
                inspection["review_payload"] = copy.deepcopy(review_payload)
                review_hash = self._digest(review_payload)
                self.repository.update_progress(
                    revision_id, chapter_id, attempt_id,
                    stage="REVIEWING", sections_completed=len(section_payloads),
                    sections_total=len(section_payloads),
                )
                verdict, reviewer_identity = self._review(
                    review_payload, attempt_id, semantic_repair_round
                )
                review_summary = verdict.summary
                if verdict.verdict == "PASS":
                    break
                if semantic_repair_round >= MAX_SEMANTIC_REPAIR_ROUNDS:
                    raise KnowledgePipelineError(
                        "REVIEW", "SEMANTIC_FAILURE", "review_rejected",
                        "Structural Review rejected the repaired candidate set",
                        provider=reviewer_identity[0], model=reviewer_identity[1],
                        summary=verdict.summary,
                    )

                repair_section_ids = self._repair_section_ids(
                    verdict, section_payloads
                )
                repair_payloads = [
                    payload for payload in section_payloads
                    if payload["source_section"]["section_id"] in repair_section_ids
                ]
                repair_contexts = self._repair_contexts(
                    verdict, repair_section_ids, candidate_sets, points,
                    semantic_repair_round + 1,
                )
                self.repository.update_progress(
                    revision_id, chapter_id, attempt_id,
                    stage="GENERATING", sections_completed=0,
                    sections_total=len(repair_payloads),
                )
                repaired_sets, repaired_identity = self._generate_sections(
                    repair_payloads, ref_index, section_bounds,
                    revision_id, chapter_id, attempt_id,
                    repair_contexts=repair_contexts,
                    structured_attempt_offset=(
                        (semantic_repair_round + 1) * MAX_STRUCTURED_ATTEMPTS
                    ),
                )
                if repaired_identity != generator_identity:
                    raise KnowledgePipelineError(
                        "GENERATION", "TECHNICAL_FAILURE",
                        "inconsistent_generator_route",
                        "Semantic repair changed the actual generator route",
                        provider=repaired_identity[0], model=repaired_identity[1],
                    )
                candidate_sets.update(repaired_sets)
                semantic_repair_round += 1
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="VALIDATING", sections_completed=len(section_payloads),
                sections_total=len(section_payloads),
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
                stage="PUBLISHING", sections_completed=len(section_payloads),
                sections_total=len(section_payloads),
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
            "generation_attempts": self.repository.generation_attempts(
                revision_id, chapter_id
            ),
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

    @staticmethod
    def _section_generation_payloads(source_payload: dict) -> list[dict]:
        outline = source_payload["outline"]
        children: dict[str | None, list[dict]] = {}
        for node in outline:
            children.setdefault(node["parent_id"], []).append(node)

        payloads = []
        for source_section in source_payload["source_sections"]:
            section_id = source_section["section_id"]
            subtree = []
            pending = [section_id]
            included = set()
            while pending:
                node_id = pending.pop()
                if node_id in included:
                    continue
                included.add(node_id)
                pending.extend(
                    child["outline_node_id"] for child in children.get(node_id, [])
                )
            for node in outline:
                if node["outline_node_id"] in included:
                    subtree.append(copy.deepcopy(node))
            if not subtree or subtree[0]["outline_node_id"] != section_id:
                raise ValueError("Section generation payload lacks its Outline root")
            payloads.append(
                {
                    "chapter": {
                        key: source_payload["chapter"][key]
                        for key in (
                            "book_source_revision_id",
                            "chapter_outline_node_id",
                            "title",
                        )
                    },
                    "outline": [
                        {
                            key: node[key]
                            for key in (
                                "outline_node_id", "parent_id", "kind", "title",
                                "order_index",
                            )
                        }
                        for node in subtree
                    ],
                    "source_section": {
                        "section_id": section_id,
                        "title": source_section["title"],
                        "lines": [
                            {"line_ref": line["line_ref"], "text": line["text"]}
                            for line in source_section["lines"]
                        ],
                    },
                }
            )
        return payloads

    @staticmethod
    def _assemble_candidate_sets(
        payloads: list[dict], candidate_sets: dict[str, list[dict]]
    ) -> list[dict]:
        expected = [payload["source_section"]["section_id"] for payload in payloads]
        if set(candidate_sets) != set(expected):
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE", "incomplete_section_generation",
                "Private candidate sets do not match the requested Sections",
            )
        points = []
        for section_id in expected:
            for point in candidate_sets[section_id]:
                if point["primary_section_id"] != section_id:
                    raise KnowledgePipelineError(
                        "GENERATION", "INVALID_STRUCTURED_OUTPUT",
                        "invalid_generation_output",
                        "Section candidate escaped its generation ownership",
                    )
                points.append(copy.deepcopy(point))
        return points

    @staticmethod
    def _review_payload(
        source_payload: dict,
        points: list[dict],
        generator_identity: tuple[str | None, str | None],
        section_count: int,
        semantic_repair_round: int,
    ) -> dict:
        return {
            "chapter": copy.deepcopy(source_payload["chapter"]),
            "outline": copy.deepcopy(source_payload["outline"]),
            "bounded_source": copy.deepcopy(source_payload["source_sections"]),
            "candidate_knowledge_points": copy.deepcopy(points),
            "generation_provenance": {
                "provider": generator_identity[0], "model": generator_identity[1],
                "section_count": section_count,
                "semantic_repair_round": semantic_repair_round,
            },
            "review_rubric": list(REVIEW_RUBRIC),
            "overlap_warnings": KnowledgeService._overlap_warnings(points),
        }

    @staticmethod
    def _repair_section_ids(
        verdict: ReviewVerdict, section_payloads: list[dict]
    ) -> list[str]:
        requested = {
            section_id
            for finding in verdict.findings
            if finding["severity"] == "BLOCKING"
            for section_id in finding["repair_section_ids"]
        }
        ordered = [
            payload["source_section"]["section_id"]
            for payload in section_payloads
            if payload["source_section"]["section_id"] in requested
        ]
        if not ordered:
            raise KnowledgePipelineError(
                "REVIEW", "INVALID_STRUCTURED_OUTPUT", "invalid_review_output",
                "Review FAIL did not identify an actionable repair Section",
            )
        return ordered

    @staticmethod
    def _repair_contexts(
        verdict: ReviewVerdict,
        repair_section_ids: list[str],
        candidate_sets: dict[str, list[dict]],
        points: list[dict],
        semantic_repair_round: int,
    ) -> dict[str, dict]:
        contexts = {}
        for section_id in repair_section_ids:
            findings = [
                copy.deepcopy(finding) for finding in verdict.findings
                if finding["severity"] == "BLOCKING"
                and section_id in finding["repair_section_ids"]
            ]
            candidate_indices = sorted({
                index
                for finding in findings
                for index in finding["candidate_indices"]
            })
            contexts[section_id] = {
                "semantic_repair_round": semantic_repair_round,
                "review_summary": verdict.summary,
                "blocking_findings": findings,
                "prior_section_candidates": copy.deepcopy(candidate_sets[section_id]),
                "referenced_candidates": [
                    {
                        "candidate_index": index,
                        "primary_section_id": points[index]["primary_section_id"],
                        "title": points[index]["title"],
                        "one_sentence_definition": points[index]["one_sentence_definition"],
                    }
                    for index in candidate_indices
                ],
            }
        return contexts

    def _generate_sections(
        self,
        payloads: list[dict],
        ref_index: dict,
        section_bounds: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        repair_contexts: dict[str, dict] | None = None,
        structured_attempt_offset: int = 0,
    ):
        if not payloads:
            raise ValueError("Chapter has no Section generation payloads")
        results: dict[str, list[dict]] = {}
        identities: set[tuple[str | None, str | None]] = set()
        completed = 0
        first_failure: Exception | None = None
        workers = min(self.section_generation_workers, len(payloads))
        executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="kp-section-generate"
        )
        repair_contexts = repair_contexts or {}
        call_payloads = []
        for payload in payloads:
            section_id = payload["source_section"]["section_id"]
            call_payload = copy.deepcopy(payload)
            if section_id in repair_contexts:
                call_payload["repair_context"] = copy.deepcopy(
                    repair_contexts[section_id]
                )
            call_payloads.append(call_payload)
        futures = {
            executor.submit(
                self._generate_section,
                payload,
                {
                    ref: item for ref, item in ref_index.items()
                    if item["section_id"] == payload["source_section"]["section_id"]
                },
                {
                    payload["source_section"]["section_id"]:
                        section_bounds[payload["source_section"]["section_id"]]
                },
                revision_id,
                chapter_id,
                attempt_id,
                structured_attempt_offset=structured_attempt_offset,
                semantic_repair=bool(repair_contexts),
            ): payload["source_section"]["section_id"]
            for payload in call_payloads
        }
        try:
            for future in as_completed(futures):
                section_id = futures[future]
                try:
                    points, identity = future.result()
                except CancelledError:
                    continue
                except Exception as failure:
                    if first_failure is None:
                        first_failure = failure
                        for sibling in futures:
                            if sibling is not future:
                                sibling.cancel()
                else:
                    results[section_id] = points
                    identities.add(identity)
                    completed += 1
                    self.repository.update_progress(
                        revision_id, chapter_id, attempt_id,
                        stage="GENERATING", sections_completed=completed,
                        sections_total=len(payloads),
                    )
        finally:
            executor.shutdown(wait=True, cancel_futures=True)
        if first_failure is not None:
            raise first_failure
        if len(results) != len(payloads):
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE", "incomplete_section_generation",
                "Not every required Section produced private candidates",
            )
        if len(identities) != 1:
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE", "inconsistent_generator_route",
                "Section generation did not retain one actual provider/model route",
            )
        points = self._assemble_candidate_sets(payloads, results)
        if not 1 <= len(points) <= 120:
            raise KnowledgePipelineError(
                "GENERATION", "INVALID_STRUCTURED_OUTPUT",
                "invalid_generation_output", "Chapter KP count is implausible",
                provider=next(iter(identities))[0], model=next(iter(identities))[1],
            )
        return results, next(iter(identities))

    def _generate_section(
        self,
        payload: dict,
        ref_index: dict,
        section_bounds: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        structured_attempt_offset: int = 0,
        semantic_repair: bool = False,
    ):
        identity = self._configured_identity(self.generator_provider, "GENERATION")
        section_id = payload["source_section"]["section_id"]
        for attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            system = GENERATOR_SYSTEM_MESSAGE
            if semantic_repair:
                system += """
这是结构 Review 后的有界 Section 修复调用。repair_context 只提供审查裁决、当前 Section 的旧候选和与 finding 直接相关的候选对照；它们不是新的教材来源。
根据 BLOCKING findings 重新生成本 Section 的完整替换候选集（不是增量 patch），同时保留本 Section 中无问题且仍有独立学习价值的候选。只能用 source_section 的教材行作为新候选来源，不得改动或重发其他 Section。"""
            if attempt > 1:
                system += "\n上一次输出未通过 JSON/schema 校验；请严格按同一 schema 重试。"
            recorded_attempt = structured_attempt_offset + attempt
            observer = lambda event, structured_attempt=recorded_attempt: (
                self.repository.record_generation_attempt(
                    revision_id, chapter_id, attempt_id, section_id,
                    structured_attempt, event,
                )
            )
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.generator_provider,
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": self._canonical(payload)},
                    ],
                    interaction_id=(
                        f"{'kp-repair' if semantic_repair else 'kp-generation'}:"
                        f"{attempt_id}:{section_id}:structured-{recorded_attempt}"
                    ),
                    max_tokens=self.generator_max_tokens,
                    attempt_observer=observer,
                )
            except ProviderFailure as failure:
                raise KnowledgePipelineError(
                    "GENERATION", failure.kind.value, failure.code,
                    failure.user_message, provider=identity[0], model=identity[1],
                ) from failure
            identity = self._completion_identity(completion)
            try:
                return self._validate_generation(
                    completion.answer, ref_index, section_bounds
                ), identity
            except ValueError as failure:
                if attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "GENERATION", "INVALID_STRUCTURED_OUTPUT",
                        "invalid_generation_output", str(failure),
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded generation loop exhausted without outcome")

    def _review(self, payload: dict, attempt_id: str, semantic_repair_round: int):
        identity = self._configured_identity(self.reviewer_provider, "REVIEW")
        for attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            system = REVIEW_SYSTEM_MESSAGE
            if attempt > 1:
                system += "\n上一次输出未通过 JSON/schema 校验；请严格按同一 schema 重试。"
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.reviewer_provider,
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": self._canonical(payload)},
                    ],
                    interaction_id=(
                        f"kp-review:{attempt_id}:round-{semantic_repair_round}:"
                        f"structured-{attempt}"
                    ),
                    max_tokens=self.reviewer_max_tokens,
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
                if attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "REVIEW", "INVALID_STRUCTURED_OUTPUT",
                        "invalid_review_output", str(failure),
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded Review loop exhausted without outcome")

    @staticmethod
    def _validate_generation(answer: str, ref_index: dict, section_bounds: dict) -> list[dict]:
        try:
            value = json.loads(answer)
        except (TypeError, ValueError):
            raise ValueError("Generator output is not JSON") from None
        if not isinstance(value, dict) or set(value) != {"knowledge_points"}:
            raise ValueError("Generator output fields are invalid")
        points = value["knowledge_points"]
        if not isinstance(points, list) or not 1 <= len(points) <= 120:
            raise ValueError("Generator output has an implausible KP count")
        keys = set()
        expected = {
            "draft_key", "primary_section_id", "title",
            "one_sentence_definition", "start_ref", "end_ref",
        }
        for point in points:
            if not isinstance(point, dict) or set(point) != expected:
                raise ValueError("Generated KP fields are invalid")
            if not isinstance(point["draft_key"], str) or not 1 <= len(point["draft_key"]) <= 80:
                raise ValueError("Draft key is invalid")
            if point["draft_key"] in keys:
                raise ValueError("Draft keys must be unique")
            keys.add(point["draft_key"])
            if point["primary_section_id"] not in section_bounds:
                raise ValueError("KP primary Section is not in the requested Chapter")
            if not isinstance(point["title"], str) or not 1 <= len(point["title"].strip()) <= 200:
                raise ValueError("KP title is invalid")
            definition = point["one_sentence_definition"]
            if not isinstance(definition, str) or not 1 <= len(definition.strip()) <= 1000:
                raise ValueError("KP definition is invalid")
            if point["start_ref"] not in ref_index or point["end_ref"] not in ref_index:
                raise ValueError("KP source ref is outside the allowlisted Chapter source")
        return points

    @staticmethod
    def _resolve_ranges(points: list[dict], ref_index: dict, section_bounds: dict) -> list[dict]:
        resolved = []
        for point in points:
            start = ref_index[point["start_ref"]]
            end = ref_index[point["end_ref"]]
            section_id = point["primary_section_id"]
            if start["section_id"] != section_id or end["section_id"] != section_id:
                raise KnowledgePipelineError(
                    "RANGE_RESOLUTION", "DETERMINISTIC", "source_section_mismatch",
                    "KP refs do not belong to the declared primary Section",
                )
            start_pos = (start["pdf_page_index"], start["y_start"])
            end_pos = (end["pdf_page_index"], end["y_end"])
            if end_pos <= start_pos:
                raise KnowledgePipelineError(
                    "RANGE_RESOLUTION", "DETERMINISTIC", "invalid_source_range",
                    "KP source range is empty or reversed",
                )
            bounds = section_bounds[section_id]
            if start_pos < bounds[0] or end_pos > bounds[1]:
                raise KnowledgePipelineError(
                    "RANGE_RESOLUTION", "DETERMINISTIC", "source_range_outside_section",
                    "KP range is outside its primary Section",
                )
            resolved.append(
                {
                    "primary_section_id": section_id,
                    "title": point["title"].strip(),
                    "one_sentence_definition": point["one_sentence_definition"].strip(),
                    "start_page": start_pos[0], "start_y": start_pos[1],
                    "end_page": end_pos[0], "end_y": end_pos[1],
                }
            )
        resolved.sort(key=lambda item: (item["start_page"], item["start_y"], item["end_page"], item["end_y"]))
        return resolved

    @staticmethod
    def _validate_points(points: list[dict], section_bounds: dict) -> None:
        if not 1 <= len(points) <= 120:
            raise ValueError("Published KP count is implausible")
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

        section_ids = {
            section["section_id"] for section in payload["bounded_source"]
        }
        rubric = set(payload["review_rubric"])
        points = payload["candidate_knowledge_points"]
        expected = {
            "dimension", "severity", "candidate_indices",
            "evidence_section_ids", "repair_section_ids", "detail",
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
            candidate_indices = finding["candidate_indices"]
            if not isinstance(candidate_indices, list) or any(
                isinstance(index, bool) or not isinstance(index, int)
                or not 0 <= index < len(points)
                for index in candidate_indices
            ) or len(candidate_indices) != len(set(candidate_indices)):
                raise ValueError("Review finding candidate indices are invalid")
            evidence_section_ids = finding["evidence_section_ids"]
            repair_section_ids = finding["repair_section_ids"]
            for label, values in (
                ("evidence", evidence_section_ids),
                ("repair", repair_section_ids),
            ):
                if not isinstance(values, list) or any(
                    not isinstance(section_id, str) or section_id not in section_ids
                    for section_id in values
                ) or len(values) != len(set(values)):
                    raise ValueError(f"Review finding {label} Sections are invalid")
            if not evidence_section_ids:
                raise ValueError("Review finding lacks an evidence Section")
            if not set(repair_section_ids).issubset(evidence_section_ids):
                raise ValueError("Review repair Sections lack matching evidence")
            if severity == "BLOCKING" and not repair_section_ids:
                raise ValueError("Blocking Review finding lacks a repair Section")
            if severity == "WARNING" and repair_section_ids:
                raise ValueError("Review warning cannot request repair")
            if any(
                points[index]["primary_section_id"] not in evidence_section_ids
                for index in candidate_indices
            ):
                raise ValueError("Review candidate index is outside its evidence Sections")
            detail = finding["detail"]
            if not isinstance(detail, str) or not detail.strip() \
                    or len(detail.strip()) > 600:
                raise ValueError("Review finding detail is invalid")
            normalized.append({
                "dimension": finding["dimension"],
                "severity": severity,
                "candidate_indices": list(candidate_indices),
                "evidence_section_ids": list(evidence_section_ids),
                "repair_section_ids": list(repair_section_ids),
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
