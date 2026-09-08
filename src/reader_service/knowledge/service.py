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
from .semantic import (
    SemanticOutputError,
    build_compact_review_ledger,
    build_evidence_units,
    materialize_candidates,
    packetize_evidence_units,
    publication_points,
    repair_packet_ids,
    semantic_packet_payload,
    validate_semantic_output,
)


MAX_STRUCTURED_ATTEMPTS = 3
MAX_SEMANTIC_REPAIR_ROUNDS = 3
MAX_CUMULATIVE_REPAIR_PACKETS = 4
MAX_CUMULATIVE_REPAIR_UNITS = 48
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

GENERATOR_SYSTEM_MESSAGE = """你是教材 Chapter Knowledge Map 的内部语义分类器，不是用户对话助手。
输入只包含同一 Section、同一 packet 中按教材顺序排列的确定性 evidence units。unit_id、Section 身份和来源范围均由服务端确定；你不能创建或改写它们。
逐个完整核算所有 unit，只允许：KEEP（一个 unit 独立成为 KP）、MERGE（同一 packet 内相邻连续的两个或更多 units 合并为一个 KP）、DROP（相邻连续 units 不形成独立学习单元）。
KEEP 的 unit_ids 必须恰好 1 个；MERGE 的 unit_ids 必须至少 2 个，单个 unit 绝不能标成 MERGE。
KP 必须同时满足五个门槛：值得单独学习；可以聚焦判断“会不会”且可能会 A 不会相邻 B；自身表达一个完整原理、机制、方法、关系、分类框架或概念；当前教材证据确实充分教学而非仅提到一次；未来单独记录 UNDERSTOOD/NOT_UNDERSTOOD 有实际意义。不得机械复制每段文字、标题、术语，也不得生成“推理、答题、问题解决”等泛化认知动作。短编号标题应与紧随的讲解作为一个 evidence unit 理解，不能把标题和定义分别保留成重复 KP；只有问题或“见/参见/详见……”交叉引用而没有实质讲解的 unit 必须 DROP。
连续 units 若共同构成一个分类、组成、步骤或并列枚举，而各 item 在当前证据中只有简短定义、没有足够独立教学展开，默认且必须 MERGE 为一个可独立追踪的框架型 KP，不能把每个名词或枚举项分别 KEEP。只有 item 自身包含充分的机制、方法、关系或可考查教学证据，足以支持“会 A 但不会 B”的独立判断时才可拆开。输入 granularity_hints.brief_enumeration_runs 是服务端识别出的高置信短枚举；每个 run 的全部 unit_ids 必须由同一个 MERGE decision 覆盖。
把当前 packet 作为一个候选集合整体判断：同一概念的重复定义、复述、例示或再次列举不得各自保留为同标题/同含义 KP。相邻且共同构成一个学习单元时 MERGE；否则保留最充分的一处并 DROP 冗余处。
如果输入含 prior_section_candidates，它们只是本 Section 先前 packet 已保留的私有标题/含义摘要，只用于避免再次保留同一独立学习单元；不得改写或重复输出这些先前 candidates。当前 unit 若只是重复其中一个 candidate，应 DROP 当前 unit；绝不能用单-unit MERGE 表示与先前 packet 合并。
不得跨 packet 或跨 Section 合并，不得生成 Section/page/ref/坐标/来源字段，不得创建、删除、改名、重排或重挂 Outline；不得生成 Learning、Mastery、Progress、Master、Teaching 或 ExamEvidence。
只返回一个 JSON 对象：{"decisions":[{"action":"KEEP","unit_ids":["给定 unit_id"],"title":"知识点标题","one_sentence_meaning":"一句话含义"},{"action":"MERGE","unit_ids":["相邻 unit_id","相邻 unit_id"],"title":"知识点标题","one_sentence_meaning":"一句话含义"},{"action":"DROP","unit_ids":["给定 unit_id"]}]}。
每个给定 unit_id 必须恰好出现一次，decision 顺序必须与输入一致。不得返回 Markdown 代码围栏、推理过程或其他字段。"""

REVIEW_SYSTEM_MESSAGE = """你是独立的 Chapter Knowledge Map 结构审查者，只判断给定的完整 Chapter map 是否可以发布。
输入是服务端生成的 compact ledger：完整 unit/decision accounting、候选标题与含义、截断证据提示和 overlap warnings，不含原始几何。必须先扫描全部 Sections，再整体检查：可独立追踪的颗粒度、语义重复/近重复、instructional specificity、拆分/合并质量、主要学习内容覆盖、Section/来源忠实度和 map-level balance。
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
            "source_payload_sha256": None,
            "source_character_count": 0,
            "source_payload_character_count": 0,
            "unit_count": 0,
            "packet_count": 0,
            "candidate_count": 0,
            "packet_bounds": [],
            "review_rounds": [],
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
            packets = packetize_evidence_units(units)
            section_count = len({unit["primary_section_id"] for unit in units})
            inspection["unit_count"] = len(units)
            inspection["source_character_count"] = sum(
                len(unit["text"]) for unit in units
            )
            inspection["packet_count"] = len(packets)
            inspection["packet_bounds"] = [
                {
                    "packet_id": packet["packet_id"],
                    "section_id": packet["primary_section_id"],
                    "unit_count": len(packet["units"]),
                    "character_count": packet["character_count"],
                }
                for packet in packets
            ]
            self.repository.update_progress(
                revision_id, chapter_id, attempt_id,
                stage="GENERATING", sections_completed=0,
                sections_total=section_count,
            )
            decisions_by_packet, generator_identity = self._classify_packets(
                packets, source_payload["chapter"], revision_id, chapter_id,
                attempt_id, semantic_round=0,
            )
            semantic_repair_round = 0
            repaired_packet_ids: set[str] = set()
            repaired_unit_ids: set[str] = set()
            while True:
                inspection["candidate_count"] = sum(
                    decision["action"] != "DROP"
                    for decisions in decisions_by_packet.values()
                    for decision in decisions
                )
                candidates = materialize_candidates(packets, decisions_by_packet)
                points = publication_points(candidates)
                self._validate_points(points, section_bounds)
                review_payload = build_compact_review_ledger(
                    source_payload["chapter"], units, packets,
                    decisions_by_packet, candidates,
                    semantic_provider=self._required_identity(
                        generator_identity, "generator"
                    )[0],
                    semantic_model=self._required_identity(
                        generator_identity, "generator"
                    )[1],
                    semantic_repair_round=semantic_repair_round,
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
                    semantic_repair_round,
                )
                review_summary = verdict.summary
                inspection["review_rounds"].append(
                    self._safe_review_observation(
                        verdict,
                        semantic_repair_round,
                        review_hash,
                        len(self._canonical(review_payload)),
                    )
                )
                if verdict.verdict == "PASS":
                    break
                if semantic_repair_round >= MAX_SEMANTIC_REPAIR_ROUNDS:
                    raise KnowledgePipelineError(
                        "REVIEW", "SEMANTIC_FAILURE", "review_rejected",
                        "Structural Review rejected the repaired candidate set",
                        provider=reviewer_identity[0], model=reviewer_identity[1],
                        summary=verdict.summary,
                    )

                try:
                    selected_packet_ids = repair_packet_ids(
                        verdict.findings, units, packets
                    )
                except ValueError as failure:
                    raise KnowledgePipelineError(
                        "REVIEW", "SEMANTIC_FAILURE",
                        "review_repair_scope_exceeded", str(failure),
                        provider=reviewer_identity[0], model=reviewer_identity[1],
                        summary=verdict.summary,
                    ) from failure
                selected_packet_id_set = set(selected_packet_ids)
                if selected_packet_id_set & repaired_packet_ids:
                    raise KnowledgePipelineError(
                        "REVIEW", "SEMANTIC_FAILURE", "review_rejected",
                        "Structural Review repeated a blocker in an already repaired packet",
                        provider=reviewer_identity[0], model=reviewer_identity[1],
                        summary=verdict.summary,
                    )
                selected_unit_ids = {
                    unit_id
                    for finding in verdict.findings
                    if finding["severity"] == "BLOCKING"
                    for unit_id in finding["unit_ids"]
                }
                if (
                    len(repaired_packet_ids | selected_packet_id_set)
                    > MAX_CUMULATIVE_REPAIR_PACKETS
                    or len(repaired_unit_ids | selected_unit_ids)
                    > MAX_CUMULATIVE_REPAIR_UNITS
                ):
                    raise KnowledgePipelineError(
                        "REVIEW", "SEMANTIC_FAILURE",
                        "review_repair_scope_exceeded",
                        "Cumulative Review repair scope exceeds the bounded Chapter budget",
                        provider=reviewer_identity[0], model=reviewer_identity[1],
                        summary=verdict.summary,
                    )
                repair_packets = [
                    packet for packet in packets
                    if packet["packet_id"] in selected_packet_ids
                ]
                repair_contexts = self._packet_repair_contexts(
                    verdict, repair_packets, decisions_by_packet,
                    semantic_repair_round + 1,
                )
                peer_candidates = self._repair_peer_candidates(
                    repair_packets, packets, decisions_by_packet
                )
                repair_section_count = len({
                    packet["primary_section_id"] for packet in repair_packets
                })
                self.repository.update_progress(
                    revision_id, chapter_id, attempt_id,
                    stage="GENERATING", sections_completed=0,
                    sections_total=repair_section_count,
                )
                repaired_sets, repaired_identity = self._classify_packets(
                    repair_packets, source_payload["chapter"], revision_id,
                    chapter_id, attempt_id,
                    semantic_round=semantic_repair_round + 1,
                    repair_contexts=repair_contexts,
                    prior_section_candidates_by_packet=peer_candidates,
                )
                if repaired_identity != generator_identity:
                    raise KnowledgePipelineError(
                        "GENERATION", "TECHNICAL_FAILURE",
                        "inconsistent_generator_route",
                        "Semantic repair changed the actual generator route",
                        provider=repaired_identity[0], model=repaired_identity[1],
                    )
                decisions_by_packet.update(repaired_sets)
                repaired_packet_ids.update(selected_packet_id_set)
                repaired_unit_ids.update(selected_unit_ids)
                semantic_repair_round += 1
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
        semantic_round: int,
        review_hash: str,
        payload_character_count: int,
    ) -> dict:
        return {
            "semantic_round": semantic_round,
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

    def _classify_packets(
        self,
        packets: list[dict],
        chapter: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        semantic_round: int,
        repair_contexts: dict[str, dict] | None = None,
        prior_section_candidates_by_packet: dict[str, list[dict]] | None = None,
    ):
        if not packets:
            raise ValueError("Chapter has no semantic packets")
        repair_contexts = repair_contexts or {}
        prior_section_candidates_by_packet = prior_section_candidates_by_packet or {}
        results: dict[str, list[dict]] = {}
        identities: set[tuple[str | None, str | None]] = set()
        section_packets: dict[str, list[dict]] = {}
        for packet in packets:
            section_id = packet["primary_section_id"]
            section_packets.setdefault(section_id, []).append(packet)

        def classify_section(local_packets: list[dict]):
            local_results = {}
            local_identities = set()
            prior_section_candidates: list[dict] = []
            for packet in local_packets:
                repair_context = repair_contexts.get(packet["packet_id"])
                configured_peers = prior_section_candidates_by_packet.get(
                    packet["packet_id"], []
                )
                decisions, identity = self._classify_packet(
                    packet,
                    chapter,
                    revision_id,
                    chapter_id,
                    attempt_id,
                    semantic_round=semantic_round,
                    repair_context=repair_context,
                    prior_section_candidates=(
                        prior_section_candidates
                        if semantic_round == 0 and repair_context is None
                        else [*configured_peers, *prior_section_candidates]
                    ),
                )
                local_results[packet["packet_id"]] = decisions
                local_identities.add(identity)
                prior_section_candidates.extend(
                    {
                        "title": decision["title"],
                        "one_sentence_meaning": decision["one_sentence_meaning"],
                    }
                    for decision in decisions
                    if decision["action"] != "DROP"
                )
            return local_results, local_identities

        first_failure: Exception | None = None
        completed_sections = 0
        workers = min(self.section_generation_workers, len(section_packets))
        executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="kp-semantic-section"
        )
        futures = {
            executor.submit(classify_section, local_packets): section_id
            for section_id, local_packets in section_packets.items()
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
                        sections_total=len(section_packets),
                    )
        finally:
            executor.shutdown(wait=True, cancel_futures=True)
        if first_failure is not None:
            raise first_failure
        if set(results) != {packet["packet_id"] for packet in packets}:
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE",
                "incomplete_packet_classification",
                "Not every required semantic packet produced private decisions",
            )
        if len(identities) != 1:
            raise KnowledgePipelineError(
                "GENERATION", "TECHNICAL_FAILURE",
                "inconsistent_generator_route",
                "Semantic packets did not retain one actual provider/model route",
            )
        return results, next(iter(identities))

    def _classify_packet(
        self,
        packet: dict,
        chapter: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        semantic_round: int,
        repair_context: dict | None,
        prior_section_candidates: list[dict] | None,
    ):
        identity = self._configured_identity(self.generator_provider, "GENERATION")
        payload = semantic_packet_payload(
            chapter,
            packet,
            repair_context=repair_context,
            prior_section_candidates=prior_section_candidates,
        )
        validation_error = None
        validation_code = None
        for structured_attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            system = GENERATOR_SYSTEM_MESSAGE
            if repair_context is not None:
                system += (
                    "\n这是结构 Review 后的一次有界 packet 修复。只修复 "
                    "repair_context 指出的 units；仍须为本 packet 返回完整 replacement "
                    "decision ledger，不能触及其他 packet。"
                )
            if validation_error is not None:
                system += (
                    "\n上一次输出未通过确定性校验："
                    f"{validation_error}。请严格按 schema 完整重试。"
                )
                if validation_code == "merge_arity":
                    system += (
                        "逐项检查：任何只有一个 unit_id 的 decision 只能是 KEEP "
                        "或 DROP；MERGE 必须含当前 packet 内至少两个相邻 unit_id。"
                    )
                elif validation_code == "noncontiguous_units":
                    system += (
                        "逐项检查：同一个 decision 的 unit_ids 必须按输入原顺序连续，"
                        "不能跳过中间 unit；不相邻的 DROP 也必须拆成各自按顺序的 "
                        "decision，不能组合成一个 decision。"
                    )
                elif validation_code == "incomplete_accounting":
                    system += (
                        "逐项对照输入 units：每个 unit_id 必须恰好出现一次，"
                        "不得遗漏、重复或新增。"
                    )
                elif validation_code == "reordered_or_reused_units":
                    system += (
                        "把所有 decisions 的 unit_ids 依次展开后，必须与输入 unit_id "
                        "序列完全相同；每个 ID 只出现一次，不能按 action 或主题重排。"
                    )
                elif validation_code == "not_json":
                    system += "只输出裸 JSON 对象，禁止 Markdown 代码围栏或任何前后文字。"
                elif validation_code == "nonteaching_evidence":
                    system += (
                        "只有问题或‘见/参见/详见’交叉引用、没有实质讲解的 evidence "
                        "必须 DROP，不能成为 KP。"
                    )
                elif validation_code == "fragmented_brief_enumeration":
                    system += (
                        "逐项检查 granularity_hints.brief_enumeration_runs：每个短分类、"
                        "组成、步骤或并列枚举 run 的全部 unit_ids 必须由同一个 MERGE "
                        "decision 覆盖，不能分别 KEEP。"
                    )
            observer = lambda event, current_attempt=structured_attempt: (
                self.repository.record_pipeline_attempt(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    section_id=packet["primary_section_id"],
                    packet_or_stage_id=packet["packet_id"],
                    semantic_round=semantic_round,
                    structured_attempt=current_attempt,
                    provider_role="KP_GENERATOR",
                    pipeline_stage="SEMANTIC_CLASSIFICATION",
                    event=event,
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
                        f"kp-semantic:{attempt_id}:{packet['packet_id']}:"
                        f"round-{semantic_round}:structured-{structured_attempt}"
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
                return validate_semantic_output(completion.answer, packet), identity
            except SemanticOutputError as failure:
                validation_error = str(failure)
                validation_code = failure.code
                safe_failure_code = f"invalid_semantic_output.{failure.code}"
                self.repository.record_structured_validation_failure(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    packet_or_stage_id=packet["packet_id"],
                    semantic_round=semantic_round,
                    structured_attempt=structured_attempt,
                    pipeline_stage="SEMANTIC_CLASSIFICATION",
                    failure_code=safe_failure_code,
                )
                if structured_attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "GENERATION", "INVALID_STRUCTURED_OUTPUT",
                        safe_failure_code, validation_error,
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded semantic classification loop exhausted")

    @staticmethod
    def _packet_repair_contexts(
        verdict: ReviewVerdict,
        packets: list[dict],
        decisions_by_packet: dict[str, list[dict]],
        semantic_round: int,
    ) -> dict[str, dict]:
        contexts = {}
        for packet in packets:
            packet_unit_ids = {
                unit["unit_id"] for unit in packet["units"]
            }
            findings = []
            for finding in verdict.findings:
                local_unit_ids = [
                    unit_id for unit_id in finding["unit_ids"]
                    if unit_id in packet_unit_ids
                ]
                if finding["severity"] == "BLOCKING" and local_unit_ids:
                    findings.append(
                        {
                            "dimension": finding["dimension"],
                            "severity": "BLOCKING",
                            "unit_ids": local_unit_ids,
                            "detail": finding["detail"],
                        }
                    )
            if not findings:
                raise ValueError("Repair packet lacks an addressed blocking finding")
            contexts[packet["packet_id"]] = {
                "semantic_round": semantic_round,
                "blocking_findings": findings,
                "previous_decisions": copy.deepcopy(
                    decisions_by_packet[packet["packet_id"]]
                ),
            }
        return contexts

    @staticmethod
    def _repair_peer_candidates(
        repair_packets: list[dict],
        all_packets: list[dict],
        decisions_by_packet: dict[str, list[dict]],
    ) -> dict[str, list[dict]]:
        packet_section = {
            packet["packet_id"]: packet["primary_section_id"]
            for packet in all_packets
        }
        repair_packet_ids = {
            packet["packet_id"] for packet in repair_packets
        }
        contexts: dict[str, list[dict]] = {}
        for repair_packet in repair_packets:
            peers = []
            for packet in all_packets:
                packet_id = packet["packet_id"]
                if packet_id in repair_packet_ids or (
                    packet_section[packet_id]
                    != repair_packet["primary_section_id"]
                ):
                    continue
                peers.extend(
                    {
                        "title": decision["title"],
                        "one_sentence_meaning": decision["one_sentence_meaning"],
                    }
                    for decision in decisions_by_packet[packet_id]
                    if decision["action"] != "DROP"
                )
            contexts[repair_packet["packet_id"]] = peers
        return contexts

    def _review(
        self,
        payload: dict,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        semantic_repair_round: int,
    ):
        identity = self._configured_identity(self.reviewer_provider, "REVIEW")
        validation_error = None
        for structured_attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            system = REVIEW_SYSTEM_MESSAGE
            if validation_error is not None:
                system += (
                    "\n上一次输出未通过确定性校验："
                    f"{validation_error}。请严格按同一 schema 重试。"
                )
            observer = lambda event, current_attempt=structured_attempt: (
                self.repository.record_pipeline_attempt(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    section_id=None,
                    packet_or_stage_id="chapter-structural-review",
                    semantic_round=semantic_repair_round,
                    structured_attempt=current_attempt,
                    provider_role="KP_STRUCTURAL_REVIEWER",
                    pipeline_stage="STRUCTURAL_REVIEW",
                    event=event,
                )
            )
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.reviewer_provider,
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": self._canonical(payload)},
                    ],
                    interaction_id=(
                        f"kp-review:{attempt_id}:round-{semantic_repair_round}:"
                        f"structured-{structured_attempt}"
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
                validation_error = str(failure)
                self.repository.record_structured_validation_failure(
                    revision_id,
                    chapter_id,
                    attempt_id,
                    packet_or_stage_id="chapter-structural-review",
                    semantic_round=semantic_repair_round,
                    structured_attempt=structured_attempt,
                    pipeline_stage="STRUCTURAL_REVIEW",
                    failure_code="invalid_review_output",
                )
                if structured_attempt == MAX_STRUCTURED_ATTEMPTS:
                    raise KnowledgePipelineError(
                        "REVIEW", "INVALID_STRUCTURED_OUTPUT",
                        "invalid_review_output", validation_error,
                        provider=identity[0], model=identity[1],
                    ) from failure
        raise AssertionError("bounded Review loop exhausted")

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
