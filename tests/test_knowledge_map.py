from __future__ import annotations

import copy
import json
import sqlite3
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from pypdf import PdfWriter

from reader_service.agent_runtime import ProviderCompletion, ProviderFailure, ProviderFailureKind
from reader_service.foundation import (
    DetectedLine,
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.jobs import JobRepository, PreparationCoordinator
from reader_service.knowledge import (
    ChapterRegenerationBlocked,
    KnowledgeRepository,
    KnowledgeService,
)
from reader_service.knowledge.semantic import (
    MAX_SEMANTIC_WINDOW_CHARACTERS,
    build_compact_review_ledger,
    build_evidence_units,
    build_semantic_windows,
    materialize_candidates,
    semantic_window_payload,
    validate_semantic_output,
)
from reader_service.knowledge.service import GENERATOR_SYSTEM_MESSAGE, REVIEW_RUBRIC, REVIEW_SYSTEM_MESSAGE
from reader_service.library.database import Database, MIGRATIONS
from reader_service.outline import OutlineRepository, OutlineService

from conftest import make_pdf


def detected(text: str, y: float, *, x: float = 0.1, width: float | None = None) -> DetectedLine:
    width = width if width is not None else min(0.8, max(0.12, len(text) * 0.025))
    cells = tuple(
        (x + width * index / len(text), x + width * (index + 1) / len(text), index, index + 1)
        for index in range(len(text))
    )
    return DetectedLine(
        quad=((x, y), (x + width, y), (x + width, y + 0.035), (x, y + 0.035)),
        text=text,
        confidence=0.99,
        cells=cells,
    )


def chapter_pdf() -> bytes:
    writer = PdfWriter()
    for _ in range(6):
        writer.add_blank_page(width=612, height=792)
    chapter_one = writer.add_outline_item("第1章 基础", 0)
    writer.add_outline_item("1.1 第一节", 0, parent=chapter_one)
    writer.add_outline_item("1.2 第二节", 2, parent=chapter_one)
    chapter_two = writer.add_outline_item("第2章 后续", 4)
    writer.add_outline_item("2.1 第三节", 4, parent=chapter_two)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class UnusedEngine:
    profile = "unused"

    def prepare_page(self, image, page_size):
        raise AssertionError("test publishes deterministic OCR directly")


def semantic_answer(payload: dict) -> str:
    return json.dumps(
        {
            "learning_targets": [
                {
                    "unit_ids": [unit["unit_id"]],
                    "title": f"学习单元 {unit['unit_id']}",
                    "one_sentence_meaning": "这是教材中可独立理解和检查的学科内容。",
                }
                for unit in payload["units"]
            ],
            "non_kp_units": [],
        },
        ensure_ascii=False,
    )


def review_answer(verdict: str = "PASS", summary: str = "结构审查通过。", findings=None):
    return json.dumps(
        {"verdict": verdict, "summary": summary, "findings": findings or []},
        ensure_ascii=False,
    )


def blocking_finding(section_id: str, unit_ids: list[str], *, dimension="split_merge_quality"):
    return {
        "dimension": dimension,
        "severity": "BLOCKING",
        "section_id": section_id,
        "unit_ids": unit_ids,
        "detail": "这些单元的拆分或合并不能形成独立且清晰的学习状态。",
    }


class ScriptedRuntime:
    active_provider = "deepseek"

    def __init__(self, generation=None, review=None):
        self.generation = generation or (lambda payload, _count: semantic_answer(payload))
        self.review = review or [review_answer()]
        self.calls: list[dict] = []
        self.counts = Counter()
        self._lock = threading.Lock()

    def provider_identity(self, provider):
        if provider not in {"deepseek", "zhipu"}:
            raise ProviderFailure(ProviderFailureKind.UNCONFIGURED, "unknown_provider", "provider unavailable")
        return provider, {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider]

    def complete_for_with_metadata(
        self,
        provider,
        messages,
        *,
        interaction_id=None,
        max_tokens=None,
        attempt_observer=None,
        retain_request_body=True,
        thinking_mode=None,
        reasoning_effort=None,
    ):
        payload = json.loads(messages[1]["content"])
        key = payload.get("window", {}).get("window_id", "review")
        with self._lock:
            self.counts[(provider, key)] += 1
            count = self.counts[(provider, key)]
            self.calls.append(
                {
                    "provider": provider,
                    "payload": copy.deepcopy(payload),
                    "messages": copy.deepcopy(messages),
                    "interaction_id": interaction_id,
                    "max_tokens": max_tokens,
                    "retain_request_body": retain_request_body,
                    "thinking_mode": thinking_mode,
                    "reasoning_effort": reasoning_effort,
                }
            )
            if provider == "deepseek":
                answer = self.generation(payload, count)
            elif callable(self.review):
                answer = self.review(payload, count)
            else:
                if not self.review:
                    raise AssertionError("No scripted Review answer")
                answer = self.review.pop(0)
        model = {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider]
        if attempt_observer is not None:
            attempt_observer(
                {
                    "status": "STARTED",
                    "provider": provider,
                    "model": model,
                    "interaction_id": interaction_id,
                    "transport_attempt": 1,
                }
            )
        if isinstance(answer, Exception):
            if attempt_observer is not None and isinstance(answer, ProviderFailure):
                attempt_observer(
                    {
                        "status": "FAILED",
                        "provider": provider,
                        "model": model,
                        "interaction_id": interaction_id,
                        "transport_attempt": 1,
                        "latency_ms": 1,
                        "failure_kind": answer.kind.value,
                        "failure_code": answer.code,
                        **(answer.diagnostics or {}),
                    }
                )
            raise answer
        if attempt_observer is not None:
            attempt_observer(
                {
                    "status": "SUCCEEDED",
                    "provider": provider,
                    "model": model,
                    "interaction_id": interaction_id,
                    "transport_attempt": 1,
                    "latency_ms": 1,
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                    "finish_reason": "stop",
                    "content_present": bool(answer),
                    "content_length": len(answer),
                    "reasoning_present": False,
                    "reasoning_length": 0,
                }
            )
        return ProviderCompletion(
            answer=answer,
            latency_ms=1,
            usage={"fixture": True},
            effective_config={"provider": provider, "model": model},
        )


def build_fixture(service, *, runtime=None, post_review_validator=None):
    pdf = chapter_pdf()
    result = service.intake(BytesIO(pdf), content_length=len(pdf), filename="chapters.pdf", title="章节测试")
    revision = result["book"]["active_revision"]
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    pages = {
        0: [detected("第1章 基础", 0.08), detected("1.1 第一节", 0.18), detected("概念 A 的起点", 0.30)],
        1: [detected("概念 A 的终点。", 0.30)],
        2: [detected("1.2 第二节", 0.16), detected("概念 B 的起点", 0.28)],
        3: [detected("概念 B 的终点。", 0.30)],
        4: [
            detected("第2章 后续", 0.09),
            detected("2.1 第三节", 0.2),
            detected("不得外泄 CANARY_OTHER_CHAPTER", 0.3),
        ],
        5: [detected("第二章内容", 0.3)],
    }
    for page_index, lines in pages.items():
        assert foundation_repository.mark_preparing(revision["id"], page_index)
        foundation_repository.publish_page(
            revision["id"],
            page_index,
            route="OCR",
            foundation_version=1,
            engine_profile="fixture:v1",
            lines=lines,
        )
    outline = OutlineService(
        service,
        OutlineRepository(service.database),
        PageLabelService(service, PageLabelRepository(service.database)),
    )
    outline.bootstrap(revision["id"])
    nodes = outline.repository.list(revision["id"])
    chapter = next(node for node in nodes if node["title"] == "第1章 基础")
    sibling = next(node for node in nodes if node["title"] == "第2章 后续")
    sections = sorted(
        [node for node in nodes if node["parent_id"] == chapter["outline_node_id"]],
        key=lambda node: node["order_index"],
    )
    scripted = runtime or ScriptedRuntime()
    repository = KnowledgeRepository(service.database)
    knowledge = KnowledgeService(
        service,
        foundation,
        outline,
        repository,
        scripted,
        generator_provider="deepseek",
        reviewer_provider="zhipu",
        post_review_validator=post_review_validator,
    )
    return {
        "book": result["book"],
        "revision": revision,
        "foundation": foundation,
        "outline": outline,
        "chapter": chapter,
        "sibling": sibling,
        "sections": sections,
        "runtime": scripted,
        "repository": repository,
        "knowledge": knowledge,
        "jobs": JobRepository(service.database),
    }


def claim_and_run(fixture):
    job = fixture["jobs"].claim()
    assert job is not None and job["job_type"] == "CHAPTER_PREPARE"
    result = fixture["knowledge"].run_job(job)
    fixture["jobs"].complete(job["id"])
    return result


def semantic_inputs(fixture):
    revision_id = fixture["revision"]["id"]
    resolved = fixture["outline"].resolve_chapter_physical(revision_id, fixture["chapter"]["outline_node_id"])
    source, _, bounds = fixture["knowledge"]._source_projection(
        fixture["knowledge"].library.revision(revision_id), resolved
    )
    units = build_evidence_units(source)
    return source, units, build_semantic_windows(units), bounds


def test_front_matter_without_sections_cannot_enqueue_preparation(service):
    fixture = build_fixture(service)
    revision = fixture["revision"]["id"]
    chapter = fixture["sibling"]["outline_node_id"]
    with service.database.connect() as connection:
        connection.execute("DELETE FROM outline_nodes WHERE parent_id = ?", (chapter,))
        connection.execute("UPDATE outline_nodes SET title = '目 录' WHERE outline_node_id = ?", (chapter,))
        before = {table: connection.execute(f"SELECT * FROM {table}").fetchall()
                  for table in ("outline_nodes", "chapter_preparations", "jobs", "knowledge_points")}
    with pytest.raises(ValueError, match="没有正文小节"):
        fixture["knowledge"].request_prepare(revision, chapter)
    with service.database.connect() as connection:
        for table, rows in before.items():
            assert connection.execute(f"SELECT * FROM {table}").fetchall() == rows


def test_physical_resolution_matches_unnumbered_and_split_headings(service):
    writer = PdfWriter()
    for _ in range(5):
        writer.add_blank_page(width=612, height=792)
    chapter_one = writer.add_outline_item("第1章 基础", 0)
    writer.add_outline_item("1.1 第一节", 0, parent=chapter_one)
    writer.add_outline_item("归纳总结", 2, parent=chapter_one)
    writer.add_outline_item("思维拓展", 3, parent=chapter_one)
    chapter_two = writer.add_outline_item("第2章 后续", 4)
    writer.add_outline_item("2.1 第二节", 4, parent=chapter_two)
    output = BytesIO()
    writer.write(output)
    pdf = output.getvalue()

    imported = service.intake(
        BytesIO(pdf), content_length=len(pdf), filename="unnumbered-headings.pdf"
    )
    revision = imported["book"]["active_revision"]
    repository = FoundationRepository(service.database)
    foundation = FoundationService(service, repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    pages = {
        0: [
            detected("第1章 基础", 0.08),
            detected("1.1 完全无关", 0.13),
            detected("1.1", 0.20, width=0.05),
            detected("第一节", 0.20, x=0.17, width=0.12),
            detected("正文", 0.32),
            detected("归纳总结", 0.50),
        ],
        1: [detected("正文续页", 0.20)],
        2: [detected("归纳总结", 0.28), detected("总结正文", 0.40)],
        3: [detected("思维拓展", 0.24), detected("拓展正文", 0.36)],
        4: [detected("第2章 后续", 0.09), detected("2.1 第二节", 0.20)],
    }
    for page_index, lines in pages.items():
        assert repository.mark_preparing(revision["id"], page_index)
        repository.publish_page(
            revision["id"], page_index, route="OCR", foundation_version=1,
            engine_profile="fixture:v1", lines=lines,
        )

    outline = OutlineService(
        service,
        OutlineRepository(service.database),
        PageLabelService(service, PageLabelRepository(service.database)),
    )
    nodes = outline.bootstrap(revision["id"])["nodes"]
    chapter = next(node for node in nodes if node["title"] == "第1章 基础")
    resolved = outline.resolve_chapter_physical(
        revision["id"], chapter["outline_node_id"]
    )
    by_title = {node["title"]: node for node in resolved["nodes"]}

    assert by_title["1.1 第一节"]["start_page"] == 0
    assert by_title["1.1 第一节"]["start_y"] == pytest.approx(0.20)
    assert by_title["归纳总结"]["start_page"] == 2
    assert by_title["归纳总结"]["start_y"] == pytest.approx(0.28)
    assert by_title["思维拓展"]["start_page"] == 3
    assert by_title["思维拓展"]["start_y"] == pytest.approx(0.24)
    assert all(node["resolution_state"] == "RESOLVED" for node in resolved["nodes"])


def logical_projection(nodes):
    return [
        (
            node["outline_node_id"],
            node["parent_id"],
            node["depth"],
            node["order_index"],
            node["kind"],
            node["title"],
            node["identity_revision"],
        )
        for node in sorted(nodes, key=lambda item: item["outline_node_id"])
    ]


def nested_keys(value):
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in nested_keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in nested_keys(item)}
    return set()


def test_deterministic_units_and_outline_bounded_windows(service):
    fixture = build_fixture(service)
    source, units, windows, _ = semantic_inputs(fixture)
    assert build_evidence_units(source) == units
    assert build_semantic_windows(copy.deepcopy(units)) == windows
    assert [unit["unit_id"] for unit in units] == [unit["unit_id"] for window in windows for unit in window["units"]]
    assert len({unit["unit_id"] for unit in units}) == len(units)
    for window in windows:
        assert window["character_count"] <= MAX_SEMANTIC_WINDOW_CHARACTERS
        assert {unit["primary_section_id"] for unit in window["units"]} == {window["primary_section_id"]}
        payload = semantic_window_payload(source["chapter"], window)
        assert set(payload) == {"chapter", "section", "window", "units"}
        assert set(payload["units"][0]) == {"unit_id", "text"}
        assert nested_keys(payload).isdisjoint(
            {"start_ref", "end_ref", "start_page", "start_y", "end_page", "end_y"}
        )


def test_section_lead_in_joins_first_subsection_only():
    def unit(unit_id, section_id, subsection_id=None, subsection_title=None):
        return {
            "unit_id": unit_id,
            "text": unit_id,
            "primary_section_id": section_id,
            "primary_section_title": section_id,
            "outline_subsection_id": subsection_id,
            "outline_subsection_title": subsection_title,
        }

    windows = build_semantic_windows(
        [
            unit("u0001", "section-a"),
            unit("u0002", "section-a", "subsection-a1", "A.1"),
            unit("u0003", "section-a", "subsection-a2", "A.2"),
            unit("u0004", "section-b"),
        ]
    )

    assert [window["window_kind"] for window in windows] == [
        "SUBSECTION", "SUBSECTION", "SECTION"
    ]
    assert [unit["unit_id"] for unit in windows[0]["units"]] == ["u0001", "u0002"]
    assert windows[0]["outline_subsection_id"] == "subsection-a1"
    assert windows[0]["outline_subsection_title"] == "A.1"
    assert [unit["unit_id"] for unit in windows[1]["units"]] == ["u0003"]
    assert [unit["unit_id"] for unit in windows[2]["units"]] == ["u0004"]


def test_short_heading_and_cross_page_continuation_preserve_evidence_boundaries():
    source = {
        "chapter": {"book_source_revision_id": "revision"},
        "source_sections": [
            {
                "section_id": "section",
                "title": "7.1 外部设备",
                "subsections": [],
                "lines": [
                    {
                        "text": "2. 喷墨式打印机",
                        "pdf_page_index": 10,
                        "line_ordinal": 40,
                        "line_ref": "p10:l40",
                        "y_start": 0.86,
                        "y_end": 0.88,
                    },
                    {
                        "text": "彩色喷墨打印机使用多种墨盒，在一张",
                        "pdf_page_index": 10,
                        "line_ordinal": 41,
                        "line_ref": "p10:l41",
                        "y_start": 0.89,
                        "y_end": 0.91,
                    },
                    {
                        "text": "300",
                        "pdf_page_index": 11,
                        "line_ordinal": 0,
                        "line_ref": "p11:l0",
                        "y_start": 0.05,
                        "y_end": 0.07,
                    },
                    {
                        "text": "纸张上组合实现彩色打印。",
                        "pdf_page_index": 11,
                        "line_ordinal": 2,
                        "line_ref": "p11:l2",
                        "y_start": 0.10,
                        "y_end": 0.12,
                    },
                ],
            }
        ],
    }
    units = build_evidence_units(source)
    assert len(units) == 1
    assert units[0]["start_ref"] == "p10:l40"
    assert units[0]["end_ref"] == "p11:l2"
    assert "喷墨式打印机" in units[0]["text"]
    assert "300" not in units[0]["text"]


def test_repeated_page_top_furniture_is_excluded_from_semantic_units():
    def source_line(text, page, ordinal, y_start, y_end):
        return {
            "text": text,
            "pdf_page_index": page,
            "line_ordinal": ordinal,
            "line_ref": f"p{page}:l{ordinal}",
            "y_start": y_start,
            "y_end": y_end,
        }

    source = {
        "chapter": {"book_source_revision_id": "revision"},
        "source_sections": [
            {
                "section_id": "section",
                "title": "1.1 基本概念",
                "subsections": [],
                "lines": [
                    source_line("2. 数据元素。", 10, 40, 0.88, 0.91),
                    source_line("2", 11, 0, 0.06, 0.078),
                    source_line("2026年数据结构考研复习指导", 11, 1, 0.06, 0.079),
                    source_line("3. 数据对象。", 11, 2, 0.10, 0.13),
                    source_line("2026年数据结构考研复习指导", 12, 0, 0.06, 0.079),
                    source_line("3", 12, 1, 0.06, 0.078),
                    source_line("4. 数据类型。", 12, 2, 0.10, 0.13),
                    source_line("1.2 唯一的顶部正文标题", 13, 0, 0.06, 0.079),
                    source_line("标题后的正文。", 13, 1, 0.10, 0.13),
                ],
            }
        ],
    }

    units = build_evidence_units(source)
    texts = [unit["text"] for unit in units]

    assert all("2026年数据结构考研复习指导" not in text for text in texts)
    assert "2" not in texts
    assert "3" not in texts
    assert any("3. 数据对象" in text for text in texts)
    assert any("4. 数据类型" in text for text in texts)
    assert any("1.2 唯一的顶部正文标题" in text for text in texts)


def semantic_window(*, section_title="1.1 正文", unit_count=3):
    return {
        "window_id": "w001",
        "window_order": 0,
        "window_kind": "SECTION",
        "primary_section_id": "section",
        "primary_section_title": section_title,
        "outline_subsection_id": None,
        "outline_subsection_title": None,
        "character_count": unit_count * 10,
        "units": [
            {"unit_id": f"u{index:04d}", "text": f"教材内容 {index}"}
            for index in range(1, unit_count + 1)
        ],
    }


def test_group_first_partition_is_strict_and_complete():
    window = semantic_window()
    valid = json.dumps(
        {
            "learning_targets": [
                {
                    "unit_ids": ["u0001", "u0002"],
                    "title": "一个学习目标",
                    "one_sentence_meaning": "相邻证据共同支撑一个值得独立掌握的目标。",
                }
            ],
            "non_kp_units": ["u0003"],
        },
        ensure_ascii=False,
    )
    result = validate_semantic_output(valid, window)
    assert result["learning_targets"][0]["unit_ids"] == ["u0001", "u0002"]
    invalid = [
        {"decisions": []},
        {"learning_targets": [], "non_kp_units": ["u0001", "invented", "u0003"]},
        {
            "learning_targets": [
                {"unit_ids": ["u0001", "u0003"], "title": "跨越", "one_sentence_meaning": "非法非连续目标"}
            ],
            "non_kp_units": ["u0002"],
        },
        {"learning_targets": [], "non_kp_units": ["u0001", "u0002"]},
    ]
    for value in invalid:
        with pytest.raises(ValueError):
            validate_semantic_output(json.dumps(value, ensure_ascii=False), window)


@pytest.mark.parametrize("title", ["2.4 本章小结", "2.5 常见问题和易混淆知识点", "FAQ", "2.1.3 本节试题精选", "2.2.3 本节试题精选"])
def test_summary_and_faq_windows_are_non_minting_review_material(title):
    window = semantic_window(section_title=title, unit_count=2)
    payload = semantic_window_payload({"chapter_outline_node_id": "chapter", "title": "第2章"}, window)
    assert payload["window"]["kp_creation"] == "FORBIDDEN_REVIEW_MATERIAL"
    valid = json.dumps(
        {"learning_targets": [], "non_kp_units": ["u0001", "u0002"]},
        ensure_ascii=False,
    )
    assert validate_semantic_output(valid, window)["learning_targets"] == []
    with pytest.raises(ValueError, match="cannot mint KnowledgePoints"):
        validate_semantic_output(semantic_answer({"units": payload["units"]}), window)


def test_prompts_freeze_one_pass_absorption_and_terminal_review_contract():
    assert "只做这一次最终" in GENERATOR_SYSTEM_MESSAGE
    assert "分别教学" in GENERATOR_SYSTEM_MESSAGE
    assert "补救路径" in GENERATOR_SYSTEM_MESSAGE
    assert "多种分类方式" in GENERATOR_SYSTEM_MESSAGE
    assert "一组成套方法" in GENERATOR_SYSTEM_MESSAGE
    assert "例题、章节概览、后文预告" in GENERATOR_SYSTEM_MESSAGE
    assert "比较总结" in GENERATOR_SYSTEM_MESSAGE
    assert "举一反三" in GENERATOR_SYSTEM_MESSAGE
    assert "泛化 target" in GENERATOR_SYSTEM_MESSAGE
    assert "FORBIDDEN_REVIEW_MATERIAL" in GENERATOR_SYSTEM_MESSAGE
    assert "不得依据先前模型结果" in GENERATOR_SYSTEM_MESSAGE
    assert "只能定位问题，不能改写候选" in REVIEW_SYSTEM_MESSAGE
    assert "不得因为还能改进就阻断发布" in REVIEW_SYSTEM_MESSAGE
    assert set(REVIEW_RUBRIC) == {
        "independently_trackable_granularity",
        "duplicate_or_near_duplicate_semantics",
        "instructional_specificity",
        "split_merge_quality",
        "major_learning_coverage",
        "section_and_source_faithfulness",
        "chapter_map_balance",
    }


def test_materialization_and_compact_review_keep_source_authority_server_side(service):
    fixture = build_fixture(service)
    source, units, windows, _ = semantic_inputs(fixture)
    partitions = {}
    for window in windows:
        first, *rest = window["units"]
        partitions[window["window_id"]] = {
            "learning_targets": [
                {
                    "unit_ids": [first["unit_id"]],
                    "title": f"目标 {window['window_id']}",
                    "one_sentence_meaning": "语义只提供标题和含义。",
                }
            ],
            "non_kp_units": [unit["unit_id"] for unit in rest],
        }
    candidates = materialize_candidates(windows, partitions)
    for candidate in candidates:
        unit = next(unit for unit in units if unit["unit_id"] == candidate["unit_ids"][0])
        assert candidate["primary_section_id"] == unit["primary_section_id"]
        assert candidate["source_revision_id"] == unit["source_revision_id"]
        assert (candidate["start_page"], candidate["start_y"]) == (unit["start_page"], unit["start_y"])
    ledger = build_compact_review_ledger(
        source["chapter"],
        units,
        windows,
        partitions,
        candidates,
        semantic_provider="deepseek",
        semantic_model="deepseek-flash",
        review_rubric=REVIEW_RUBRIC,
        overlap_warnings=[],
    )
    assert len(ledger["windows"]) == len(windows)
    assert len(ledger["candidates"]) == len(candidates)
    assert nested_keys(ledger).isdisjoint(
        {
            "text",
            "lines",
            "start_ref",
            "end_ref",
            "start_page",
            "start_y",
            "end_page",
            "end_y",
            "source_revision_id",
            "reasoning_content",
        }
    )


def test_one_chapter_publishes_atomically_without_outline_mutation_or_payload_retention(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    before = logical_projection(fixture["outline"].repository.list(revision_id))
    requested, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert created and requested["status"] == "PREPARING"
    assert requested["knowledge_points"] == []
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    assert ready["knowledge_points"]
    assert ready["structure_version"] == 1
    assert ready["generator_provider"] == "deepseek"
    assert ready["reviewer_provider"] == "zhipu"
    assert logical_projection(fixture["outline"].repository.list(revision_id)) == before
    assert fixture["repository"].snapshot(revision_id, fixture["sibling"]["outline_node_id"])["status"] == "NOT_PREPARED"
    serialized_calls = json.dumps(fixture["runtime"].calls, ensure_ascii=False)
    assert "CANARY_OTHER_CHAPTER" not in serialized_calls
    generation_calls = [call for call in fixture["runtime"].calls if call["provider"] == "deepseek"]
    review_calls = [call for call in fixture["runtime"].calls if call["provider"] == "zhipu"]
    assert generation_calls and len(review_calls) == 1
    assert all(call["retain_request_body"] is False for call in fixture["runtime"].calls)
    assert all(set(call["payload"]) == {"chapter", "section", "window", "units"} for call in generation_calls)
    assert set(review_calls[0]["payload"]) == {
        "chapter",
        "sections",
        "windows",
        "candidates",
        "semantic_provenance",
        "review_rubric",
        "overlap_warnings",
    }
    no_op, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert not created and no_op["status"] == "READY"
    assert [point["knowledge_point_id"] for point in no_op["knowledge_points"]] == [
        point["knowledge_point_id"] for point in ready["knowledge_points"]
    ]


def test_ready_chapter_regeneration_keeps_old_map_visible_and_mints_all_fresh_ids(service):
    fixture = build_fixture(service, runtime=ScriptedRuntime(review=lambda _payload, _count: review_answer()))
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    first = claim_and_run(fixture)
    first_ids = [point["knowledge_point_id"] for point in first["knowledge_points"]]

    requested, created = fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    assert created
    assert requested["status"] == "READY"
    assert requested["regeneration_state"] == "RUNNING"
    assert not requested["regeneration_allowed"]
    assert [point["knowledge_point_id"] for point in requested["knowledge_points"]] == first_ids

    joined, created = fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    assert not created and joined["attempt_id"] == requested["attempt_id"]
    ordinary, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert not created and ordinary["attempt_id"] == requested["attempt_id"]
    assert [point["knowledge_point_id"] for point in ordinary["knowledge_points"]] == first_ids

    replaced = claim_and_run(fixture)
    replacement_ids = [point["knowledge_point_id"] for point in replaced["knowledge_points"]]
    assert replaced["status"] == "READY"
    assert replaced["regeneration_state"] == "IDLE", replaced
    assert replaced["regeneration_allowed"]
    assert replaced["structure_version"] == 2
    assert set(first_ids).isdisjoint(replacement_ids)
    with service.database.connect() as connection:
        rows = connection.execute(
            """
            SELECT knowledge_point_id, chapter_structure_version
            FROM knowledge_points
            WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
            """,
            (revision_id, chapter_id),
        ).fetchall()
    assert {row["knowledge_point_id"] for row in rows} == set(replacement_ids)
    assert {row["chapter_structure_version"] for row in rows} == {2}


def test_regeneration_requested_after_publish_before_job_completion_is_requeued(service):
    fixture = build_fixture(
        service, runtime=ScriptedRuntime(review=lambda _payload, _count: review_answer())
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)

    first_job = fixture["jobs"].claim()
    assert first_job is not None and first_job["job_type"] == "CHAPTER_PREPARE"
    first = fixture["knowledge"].run_job(first_job)
    first_ids = [point["knowledge_point_id"] for point in first["knowledge_points"]]

    requested, created = fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    assert created
    assert requested["status"] == "READY"
    assert requested["regeneration_state"] == "RUNNING"
    assert [point["knowledge_point_id"] for point in requested["knowledge_points"]] == first_ids

    fixture["jobs"].complete(first_job["id"])
    replacement_job = fixture["jobs"].claim()
    assert replacement_job is not None
    assert replacement_job["id"] == first_job["id"]
    replaced = fixture["knowledge"].run_job(replacement_job)
    fixture["jobs"].complete(replacement_job["id"])

    replacement_ids = [
        point["knowledge_point_id"] for point in replaced["knowledge_points"]
    ]
    assert replaced["status"] == "READY"
    assert replaced["regeneration_state"] == "IDLE"
    assert replaced["structure_version"] == 2
    assert set(first_ids).isdisjoint(replacement_ids)


def test_failed_ready_regeneration_preserves_published_map(service):
    def reviewer(payload, count):
        if count == 1:
            return review_answer()
        window = next(window for window in payload["windows"] if window["learning_targets"])
        return review_answer(
            "FAIL", "替换候选存在阻断问题。",
            [blocking_finding(window["section_id"], window["learning_targets"][0]["unit_ids"])],
        )

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    first = claim_and_run(fixture)
    first_ids = [point["knowledge_point_id"] for point in first["knowledge_points"]]

    fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["status"] == "READY"
    assert failed["regeneration_state"] == "FAILED"
    assert failed["regeneration_failure_stage"] == "REVIEW"
    assert failed["regeneration_failure_code"] == "review_rejected"
    assert failed["structure_version"] == 1
    assert [point["knowledge_point_id"] for point in failed["knowledge_points"]] == first_ids


def test_learning_state_lock_is_permanent_and_rechecked_inside_replacement(service):
    fixture = build_fixture(service, runtime=ScriptedRuntime(review=lambda _payload, _count: review_answer()))
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    first = claim_and_run(fixture)
    first_ids = [point["knowledge_point_id"] for point in first["knowledge_points"]]

    fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    with service.database.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        fixture["repository"].lock_for_learning_state(connection, first_ids[0])

    failed = claim_and_run(fixture)
    assert failed["status"] == "READY"
    assert failed["regeneration_state"] == "FAILED"
    assert failed["regeneration_failure_code"] == "CHAPTER_PERMANENTLY_LOCKED", failed
    assert [point["knowledge_point_id"] for point in failed["knowledge_points"]] == first_ids
    assert failed["regeneration_block_code"] == "CHAPTER_PERMANENTLY_LOCKED"

    with service.database.connect() as connection:
        with pytest.raises(sqlite3.IntegrityError, match="irreversible"):
            connection.execute(
                """
                UPDATE chapter_preparations SET learning_state_ever_at = NULL
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                """,
                (revision_id, chapter_id),
            )
    with pytest.raises(ChapterRegenerationBlocked) as blocked:
        fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    assert blocked.value.code == "CHAPTER_PERMANENTLY_LOCKED"


def test_other_durable_kp_reference_blocks_ready_regeneration(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    ready = claim_and_run(fixture)
    point_id = ready["knowledge_points"][0]["knowledge_point_id"]
    with service.database.connect() as connection:
        connection.execute(
            "CREATE TABLE fixture_user_assets(id TEXT PRIMARY KEY, knowledge_point_id TEXT)"
        )
        connection.execute(
            "INSERT INTO fixture_user_assets(id, knowledge_point_id) VALUES ('asset', ?)",
            (point_id,),
        )

    snapshot = fixture["knowledge"].snapshot(revision_id, chapter_id)
    assert not snapshot["regeneration_allowed"]
    assert snapshot["regeneration_block_code"] == "CHAPTER_HAS_USER_ASSETS"
    with pytest.raises(ChapterRegenerationBlocked) as blocked:
        fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    assert blocked.value.code == "CHAPTER_HAS_USER_ASSETS"


def test_ready_replacement_publication_rolls_back_to_old_map_on_insert_failure(service):
    fixture = build_fixture(
        service, runtime=ScriptedRuntime(review=lambda _payload, _count: review_answer())
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    first = claim_and_run(fixture)
    first_ids = [point["knowledge_point_id"] for point in first["knowledge_points"]]
    fixture["knowledge"].request_regenerate(revision_id, chapter_id)
    with service.database.connect() as connection:
        connection.execute(
            """
            CREATE TRIGGER fail_replacement_kp BEFORE INSERT ON knowledge_points
            WHEN NEW.chapter_structure_version = 2 AND NEW.order_index = 1
            BEGIN SELECT RAISE(ABORT, 'replacement fault injection'); END
            """
        )

    failed = claim_and_run(fixture)
    assert failed["status"] == "READY"
    assert failed["regeneration_state"] == "FAILED"
    assert failed["regeneration_failure_stage"] == "PUBLICATION"
    assert failed["regeneration_failure_code"] == "publication_failed"
    assert failed["structure_version"] == 1
    assert [point["knowledge_point_id"] for point in failed["knowledge_points"]] == first_ids


def test_invalid_output_retries_only_the_identical_window_contract(service):
    first_payloads = []

    def generation(payload, count):
        if payload["window"]["window_id"] == "w001" and count == 1:
            first_payloads.append(copy.deepcopy(payload))
            return "not-json"
        if payload["window"]["window_id"] == "w001" and count == 2:
            assert payload == first_payloads[0]
        return semantic_answer(payload)

    runtime = ScriptedRuntime(generation=generation)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert claim_and_run(fixture)["status"] == "READY"
    assert runtime.counts[("deepseek", "w001")] == 2
    assert all(
        count == 1
        for (provider, window_id), count in runtime.counts.items()
        if provider == "deepseek" and window_id != "w001"
    )
    semantic_calls = [call for call in runtime.calls if call["provider"] == "deepseek"]
    assert all(call["interaction_id"].startswith("kp-semantic:") for call in semantic_calls)
    assert all("repair_context" not in call["payload"] for call in semantic_calls)


def test_valid_review_fail_is_terminal_and_never_regenerates_or_publishes(service):
    def reviewer(payload, _count):
        window = payload["windows"][0]
        unit_id = window["learning_targets"][0]["unit_ids"][0]
        return review_answer(
            "FAIL", "存在阻断性拆分问题。", [blocking_finding(window["section_id"], [unit_id])]
        )

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "REVIEW"
    assert failed["failure_kind"] == "SEMANTIC_FAILURE"
    assert failed["failure_code"] == "review_rejected"
    assert failed["knowledge_points"] == []
    assert runtime.counts[("zhipu", "review")] == 1
    generation_counts = {key: count for key, count in runtime.counts.items() if key[0] == "deepseek"}
    assert generation_counts and set(generation_counts.values()) == {1}
    inspection = fixture["knowledge"].inspect_payloads(revision_id, chapter_id)
    finding = inspection["attempts"][0]["review"]["findings"][0]
    assert finding["severity"] == "BLOCKING"
    assert finding["unit_ids"]


def test_overlap_is_warning_signal_not_deterministic_failure():
    points = [
        {
            "primary_section_id": "s",
            "title": "A",
            "one_sentence_definition": "A",
            "start_page": 0,
            "start_y": 0.1,
            "end_page": 0,
            "end_y": 0.4,
        },
        {
            "primary_section_id": "s",
            "title": "B",
            "one_sentence_definition": "B",
            "start_page": 0,
            "start_y": 0.3,
            "end_page": 0,
            "end_y": 0.5,
        },
    ]
    KnowledgeService._validate_points(points, {"s": ((0, 0.0), (1, 0.0))})
    assert KnowledgeService._overlap_warnings(points) == [
        {
            "first_candidate_index": 0,
            "second_candidate_index": 1,
            "primary_section_id": "s",
            "signal": "SHARED_SOURCE_EVIDENCE_REVIEW_REQUIRED",
        }
    ]


def test_generation_and_review_failures_are_diagnosable_and_never_publish(service):
    cases = [
        (
            lambda _payload, _count: ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "empty_response",
                "provider returned no answer",
                diagnostics={"content_present": False, "content_length": 0},
            ),
            None,
            "GENERATION",
            "empty_response",
        ),
        (lambda _payload, _count: "", None, "GENERATION", "invalid_semantic_output.not_json"),
        (
            None,
            lambda _payload, _count: ProviderFailure(
                ProviderFailureKind.TRANSIENT, "timeout", "review timeout"
            ),
            "REVIEW",
            "timeout",
        ),
        (None, lambda _payload, _count: "not-json", "REVIEW", "invalid_review_output"),
    ]
    for generator, reviewer, stage, code in cases:
        runtime = ScriptedRuntime(generation=generator, review=reviewer or [review_answer()])
        fixture = build_fixture(service, runtime=runtime)
        revision_id = fixture["revision"]["id"]
        chapter_id = fixture["chapter"]["outline_node_id"]
        fixture["knowledge"].request_prepare(revision_id, chapter_id)
        failed = claim_and_run(fixture)
        assert failed["status"] == "FAILED"
        assert failed["failure_stage"] == stage
        assert failed["failure_code"] == code
        assert failed["knowledge_points"] == []
        attempts = fixture["repository"].pipeline_attempts(revision_id, chapter_id)
        assert attempts
        if code == "empty_response":
            row = next(row for row in attempts if row["failure_code"] == code)
            assert row["content_present"] == 0
            assert row["content_length"] == 0
        service.delete_book(fixture["book"]["id"])


def test_post_review_validation_failure_and_atomic_insert_rollback(service):
    fixture = build_fixture(
        service, post_review_validator=lambda _points: (_ for _ in ()).throw(ValueError("bad"))
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["failure_stage"] == "DETERMINISTIC_VALIDATION"
    assert failed["failure_code"] == "deterministic_validation_failed"
    assert failed["knowledge_points"] == []

    retry, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert retry["status"] == "PREPARING" and not created
    resolved = fixture["outline"].resolve_chapter_physical(revision_id, chapter_id)
    chapter = resolved["chapter"]
    state = fixture["repository"].snapshot(revision_id, chapter_id)
    fixture["repository"].update_dependencies(
        revision_id,
        chapter_id,
        state["attempt_id"],
        foundation_version=1,
        identity_revision=chapter["identity_revision"],
        physical_revision=chapter["physical_revision"],
    )
    section_id = fixture["sections"][0]["outline_node_id"]
    points = [
        {
            "primary_section_id": section_id,
            "title": f"KP {index}",
            "one_sentence_definition": "定义",
            "start_page": 0,
            "start_y": 0.30 + index * 0.04,
            "end_page": 0,
            "end_y": 0.32 + index * 0.04,
        }
        for index in range(2)
    ]
    with service.database.connect() as connection:
        connection.execute(
            """
            CREATE TRIGGER fail_second_kp BEFORE INSERT ON knowledge_points
            WHEN NEW.order_index = 1 BEGIN SELECT RAISE(ABORT, 'fault injection'); END
            """
        )
    with pytest.raises(Exception, match="fault injection"):
        fixture["repository"].publish(
            revision_id,
            chapter_id,
            state["attempt_id"],
            foundation_version=1,
            identity_revision=chapter["identity_revision"],
            physical_revision=chapter["physical_revision"],
            points=points,
            generator_provider="deepseek",
            generator_model="generator-model",
            reviewer_provider="zhipu",
            reviewer_model="reviewer-model",
            review_summary="通过",
            source_payload_sha256="a" * 64,
            review_payload_sha256="b" * 64,
        )
    snapshot = fixture["repository"].snapshot(revision_id, chapter_id)
    assert snapshot["status"] == "PREPARING"
    assert snapshot["knowledge_points"] == []


def test_duplicate_requests_restart_recovery_and_attempt_interruption(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: fixture["knowledge"].request_prepare(revision_id, chapter_id), range(8)))
    assert all(state["status"] == "PREPARING" for state, _ in results)
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM jobs WHERE job_type = 'CHAPTER_PREPARE'").fetchone()[0] == 1
    state = fixture["repository"].snapshot(revision_id, chapter_id)
    section_id = fixture["sections"][0]["outline_node_id"]
    fixture["repository"].record_pipeline_attempt(
        revision_id,
        chapter_id,
        state["attempt_id"],
        section_id=section_id,
        packet_or_stage_id="w-test",
        semantic_round=0,
        structured_attempt=1,
        provider_role="KP_GENERATOR",
        pipeline_stage="SEMANTIC_CLASSIFICATION",
        event={
            "status": "STARTED",
            "provider": "deepseek",
            "model": "generator-model",
            "interaction_id": "restart-test",
            "transport_attempt": 1,
        },
    )
    fixture["repository"].recover_preparing_jobs()
    recovered = fixture["repository"].pipeline_attempts(revision_id, chapter_id)
    assert recovered[-1]["status"] == "INTERRUPTED"
    state = fixture["repository"].snapshot(revision_id, chapter_id)
    assert state["prepare_stage"] == "QUEUED"
    assert state["knowledge_points"] == []


def test_running_chapter_job_converges_when_book_delete_wins(service):
    entered = threading.Event()
    release = threading.Event()

    class BlockingRuntime(ScriptedRuntime):
        def complete_for_with_metadata(self, provider, messages, **kwargs):
            if provider == "deepseek":
                entered.set()
                if not release.wait(5):
                    raise AssertionError("book-delete race was not released")
            return super().complete_for_with_metadata(provider, messages, **kwargs)

    runtime = BlockingRuntime()
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    job = fixture["jobs"].claim()
    assert job is not None
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fixture["knowledge"].run_job, job)
        try:
            assert entered.wait(2)
            service.delete_book(fixture["book"]["id"])
        finally:
            release.set()
        result = future.result(timeout=5)
    assert result["status"] == "CANCELLED"


def test_http_contract_never_exposes_private_candidates(service):
    from test_api import request_json, running_server

    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    coordinator = PreparationCoordinator(
        service,
        fixture["foundation"],
        fixture["jobs"],
        outline=fixture["outline"],
        knowledge=fixture["knowledge"],
    )
    path = f"/api/revisions/{revision_id}/chapters/{chapter_id}/knowledge-map"
    with running_server(
        service,
        preparation=coordinator,
        outline=fixture["outline"],
        knowledge=fixture["knowledge"],
    ) as (base, token):
        status, snapshot = request_json(f"{base}{path}", token)
        assert status == 200 and snapshot["status"] == "NOT_PREPARED"
        status, requested = request_json(
            f"{base}{path}/prepare",
            token,
            method="POST",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        assert status == 202
        assert requested["chapter_map"]["status"] == "PREPARING"
        assert requested["chapter_map"]["knowledge_points"] == []
        ready = claim_and_run(fixture)
        assert ready["status"] == "READY"
        status, published = request_json(f"{base}{path}", token)
        assert status == 200 and published["knowledge_points"]
        assert "candidate_id" not in json.dumps(published)
        published_ids = [point["knowledge_point_id"] for point in published["knowledge_points"]]
        status, replacement = request_json(
            f"{base}{path}/regenerate",
            token,
            method="POST",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        assert status == 202
        assert replacement["chapter_map"]["status"] == "READY"
        assert replacement["chapter_map"]["regeneration_state"] == "RUNNING"
        assert [
            point["knowledge_point_id"]
            for point in replacement["chapter_map"]["knowledge_points"]
        ] == published_ids
        status, inspection = request_json(f"{base}{path}/inspection", token)
        assert status == 200 and inspection["pipeline_attempts"]


def test_migration_10_preserves_legacy_attempt_as_safe_metadata(tmp_path):
    path = tmp_path / "upgrade.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, sql in MIGRATIONS:
        if version >= 10:
            break
        connection.executescript(sql)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
    connection.execute("INSERT INTO books(id, title, status, created_at) VALUES ('book', '书', 'ACTIVE', 't')")
    connection.execute(
        """
        INSERT INTO book_source_revisions(
            id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
            label, status, created_at, foundation_version
        ) VALUES ('revision', 'book', ?, 10, 1, '[]', '教材', 'ACTIVE', 't', 1)
        """,
        ("a" * 64,),
    )
    connection.execute(
        """
        INSERT INTO outline_nodes(
            outline_node_id, book_source_revision_id, identity_revision,
            parent_id, depth, order_index, kind, title, start_page, start_y,
            end_page, end_y, resolution_state, physical_revision, confidence,
            evidence_json
        ) VALUES ('chapter', 'revision', 1, NULL, 0, 0, 'CHAPTER', '第1章',
                  0, 0, 0, 1, 'RESOLVED', 1, 1, '{}')
        """
    )
    connection.execute(
        """
        INSERT INTO outline_nodes(
            outline_node_id, book_source_revision_id, identity_revision,
            parent_id, depth, order_index, kind, title, start_page, start_y,
            end_page, end_y, resolution_state, physical_revision, confidence,
            evidence_json
        ) VALUES ('section', 'revision', 1, 'chapter', 1, 0, 'SECTION', '1.1',
                  0, 0, 0, 1, 'RESOLVED', 1, 1, '{}')
        """
    )
    connection.execute(
        """
        INSERT INTO chapter_preparations(
            book_source_revision_id, chapter_outline_node_id, status,
            foundation_version, chapter_identity_revision,
            chapter_physical_revision, structure_version, attempt_id,
            requested_at, updated_at, prepare_stage
        ) VALUES ('revision', 'chapter', 'PREPARING', 1, 1, 1, 0,
                  'attempt', 't', 't', 'GENERATING')
        """
    )
    connection.execute(
        """
        INSERT INTO chapter_generation_attempts(
            id, book_source_revision_id, chapter_outline_node_id,
            preparation_attempt_id, primary_section_id, structured_attempt,
            transport_attempt, interaction_id, provider, model, provider_role,
            pipeline_stage, status, started_at
        ) VALUES ('legacy', 'revision', 'chapter', 'attempt', 'section', 1, 1,
                  'interaction', 'deepseek', 'model', 'KP_GENERATOR',
                  'GENERATION', 'STARTED', 't')
        """
    )
    connection.commit()
    connection.close()

    Database(path).initialize()
    upgraded = sqlite3.connect(path)
    try:
        row = upgraded.execute(
            """
            SELECT id, primary_section_id, packet_or_stage_id, semantic_round,
                   provider_role, pipeline_stage, status
            FROM chapter_pipeline_attempts
            """
        ).fetchone()
        assert row == ("legacy", "section", "section", 0, "KP_GENERATOR", "LEGACY_GENERATION", "STARTED")
        assert upgraded.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chapter_generation_attempts'"
        ).fetchone() is None
        assert upgraded.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == MIGRATIONS[-1][0]
        preparation = upgraded.execute(
            """
            SELECT regeneration_state, attempt_foundation_version,
                   attempt_chapter_identity_revision,
                   attempt_chapter_physical_revision, learning_state_ever_at
            FROM chapter_preparations
            """
        ).fetchone()
        assert preparation == ("IDLE", 1, 1, 1, None)
    finally:
        upgraded.close()


def test_book_delete_cascades_and_knowledge_does_not_write_learning(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert claim_and_run(fixture)["status"] == "READY"
    other_pdf = make_pdf()
    other = service.intake(
        BytesIO(other_pdf), content_length=len(other_pdf), filename="other.pdf", title="另一本书"
    )["book"]
    service.delete_book(fixture["book"]["id"])
    with service.database.connect() as connection:
        for table in ("chapter_preparations", "knowledge_points", "chapter_pipeline_attempts"):
            assert connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE book_source_revision_id = ?", (revision_id,)
            ).fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM books WHERE id = ?", (other["id"],)).fetchone()[0] == 1
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        for table in ("kp_status", "learning_events", "master_threads", "master_topics", "master_messages", "teaching_assets"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert tables.isdisjoint(
        {
            "section_learning_state",
            "exam_evidence",
        }
    )

def test_large_subsection_keeps_one_complete_bounded_semantic_judgment():
    from reader_service.knowledge.semantic import SemanticOutputError
    units = [{
        'unit_id': f'u{i:04d}', 'text': '字' * size,
        'primary_section_id': 'section', 'primary_section_title': 'Section',
        'outline_subsection_id': 'subsection', 'outline_subsection_title': 'Subsection',
    } for i, size in enumerate([900] * 7 + [185])]
    windows = build_semantic_windows(units)
    assert len(windows) == 1
    assert windows[0]['character_count'] == 6485
    assert windows[0]['units'] == units
    assert windows[0]['outline_subsection_id'] == 'subsection'
    units[-1]['text'] += '字' * (MAX_SEMANTIC_WINDOW_CHARACTERS - 6485)
    assert build_semantic_windows(units)[0]['character_count'] == MAX_SEMANTIC_WINDOW_CHARACTERS
    units[-1]['text'] += '字'
    with pytest.raises(SemanticOutputError) as error:
        build_semantic_windows(units)
    assert error.value.code == 'semantic_window_source_limit'


def test_long_section_fallback_is_whole_and_has_output_capacity():
    units = [{
        'unit_id': f'u{i:04d}', 'text': '字' * size,
        'primary_section_id': 'section', 'primary_section_title': 'Long Section',
        'outline_subsection_id': None, 'outline_subsection_title': None,
    } for i, size in enumerate([139] * 97 + [148])]
    windows = build_semantic_windows(units)
    assert len(windows) == 1
    assert windows[0]['character_count'] == 13631
    assert windows[0]['units'] == units
    knowledge = KnowledgeService.__new__(KnowledgeService)
    knowledge.generator_max_tokens = 4096
    assert knowledge._window_output_budget(windows[0]) == 7296
    assert knowledge._window_output_budget({'units': units * 10}) == 16384

def test_source_capacity_failure_has_specific_code_and_never_calls_provider(service, monkeypatch):
    from reader_service.knowledge.semantic import SemanticOutputError
    fixture = build_fixture(service)
    revision_id, chapter_id = fixture['revision']['id'], fixture['chapter']['outline_node_id']
    def reject(_units):
        raise SemanticOutputError('semantic_window_source_limit', 'Semantic window exceeds configured source bound')
    monkeypatch.setattr('reader_service.knowledge.service.build_semantic_windows', reject)
    fixture['knowledge'].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed['failure_stage'] == 'SOURCE_CAPACITY'
    assert failed['failure_code'] == 'semantic_window_source_limit'
    assert failed['knowledge_points'] == []
    assert fixture['repository'].pipeline_attempts(revision_id, chapter_id) == []
