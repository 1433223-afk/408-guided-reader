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

from reader_service.agent_runtime import (
    ProviderCompletion,
    ProviderFailure,
    ProviderFailureKind,
)
from reader_service.foundation import (
    DetectedLine,
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.jobs import JobRepository, PreparationCoordinator
from reader_service.knowledge import KnowledgeRepository, KnowledgeService
from reader_service.knowledge.semantic import (
    MAX_SEMANTIC_PACKET_CHARACTERS,
    MAX_SEMANTIC_PACKET_UNITS,
    brief_enumeration_runs,
    build_compact_review_ledger,
    build_evidence_units,
    materialize_candidates,
    packetize_evidence_units,
    publication_points,
    repair_packet_ids,
    semantic_packet_payload,
    validate_compact_review_ledger,
    validate_semantic_output,
)
from reader_service.knowledge.service import (
    GENERATOR_SYSTEM_MESSAGE,
    REVIEW_RUBRIC,
    REVIEW_SYSTEM_MESSAGE,
    ReviewVerdict,
)
from reader_service.library.database import Database, MIGRATIONS
from reader_service.outline import OutlineRepository, OutlineService

from conftest import make_pdf


def detected(text: str, y: float) -> DetectedLine:
    width = min(0.8, max(0.12, len(text) * 0.025))
    cells = tuple(
        (
            0.1 + width * index / len(text),
            0.1 + width * (index + 1) / len(text),
            index,
            index + 1,
        )
        for index in range(len(text))
    )
    return DetectedLine(
        quad=(
            (0.1, y),
            (0.1 + width, y),
            (0.1 + width, y + 0.035),
            (0.1, y + 0.035),
        ),
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


def semantic_answer(payload: dict, *, repaired: bool = False) -> str:
    decisions = []
    for index, unit in enumerate(payload["units"]):
        decisions.append(
            {
                "action": "KEEP",
                "unit_ids": [unit["unit_id"]],
                "title": (
                    f"修复后的学习单元 {index + 1}"
                    if repaired and index == 0
                    else f"学习单元 {unit['unit_id']}"
                ),
                "one_sentence_meaning": "这是教材中可独立理解和检查的学科内容。",
            }
        )
    return json.dumps({"decisions": decisions}, ensure_ascii=False)


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
        self.generation = generation or (
            lambda payload, _count: semantic_answer(
                payload, repaired="repair_context" in payload
            )
        )
        self.review = review or [review_answer()]
        self.calls: list[dict] = []
        self.counts = Counter()
        self._lock = threading.Lock()

    def provider_identity(self, provider):
        if provider not in {"deepseek", "zhipu"}:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "unknown_provider",
                "provider unavailable",
            )
        return provider, {
            "deepseek": "generator-model",
            "zhipu": "reviewer-model",
        }[provider]

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
        key = payload.get("packet", {}).get("packet_id", "review")
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
        model = {
            "deepseek": "generator-model",
            "zhipu": "reviewer-model",
        }[provider]
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
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 5,
                        "total_tokens": 15,
                    },
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
    result = service.intake(
        BytesIO(pdf), content_length=len(pdf), filename="chapters.pdf", title="章节测试"
    )
    revision = result["book"]["active_revision"]
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    pages = {
        0: [
            detected("第1章 基础", 0.08),
            detected("1.1 第一节", 0.18),
            detected("概念 A 的起点", 0.30),
        ],
        1: [detected("概念 A 的终点。", 0.30)],
        2: [
            detected("1.2 第二节", 0.16),
            detected("概念 B 的起点", 0.28),
        ],
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
    resolved = fixture["outline"].resolve_chapter_physical(
        revision_id, fixture["chapter"]["outline_node_id"]
    )
    source, _, bounds = fixture["knowledge"]._source_projection(
        fixture["knowledge"].library.revision(revision_id), resolved
    )
    units = build_evidence_units(source)
    return source, units, packetize_evidence_units(units), bounds


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


def test_deterministic_units_and_section_local_bounded_packets(service):
    fixture = build_fixture(service)
    source, units, packets, _ = semantic_inputs(fixture)
    assert build_evidence_units(source) == units
    assert packetize_evidence_units(copy.deepcopy(units)) == packets
    assert [unit["unit_id"] for unit in units] == [
        unit["unit_id"] for packet in packets for unit in packet["units"]
    ]
    assert len({unit["unit_id"] for unit in units}) == len(units)
    for packet in packets:
        assert len(packet["units"]) <= MAX_SEMANTIC_PACKET_UNITS
        assert packet["character_count"] <= MAX_SEMANTIC_PACKET_CHARACTERS
        assert {unit["primary_section_id"] for unit in packet["units"]} == {
            packet["primary_section_id"]
        }
        payload = semantic_packet_payload(source["chapter"], packet)
        assert set(payload) == {
            "chapter", "section", "packet", "units", "granularity_hints"
        }
        assert set(payload["granularity_hints"]) == {"brief_enumeration_runs"}
        assert set(payload["units"][0]) == {"unit_id", "text"}
        assert not nested_keys(payload) & {
            "source_revision_id",
            "line_ref",
            "start_page",
            "start_y",
            "end_page",
            "end_y",
            "quad",
        }


def test_deterministic_short_heading_is_attached_to_following_explanation():
    source = {
        "chapter": {"book_source_revision_id": "revision"},
        "source_sections": [
            {
                "section_id": "section",
                "title": "7.1 概述",
                "lines": [
                    {
                        "text": "1. I/O 接口的功能",
                        "pdf_page_index": 0,
                        "line_ref": "l1",
                        "y_start": 0.1,
                        "y_end": 0.2,
                    },
                    {
                        "text": "I/O 接口负责协调主机与外设之间的数据传送。",
                        "pdf_page_index": 0,
                        "line_ref": "l2",
                        "y_start": 0.2,
                        "y_end": 0.3,
                    },
                ],
            }
        ],
    }

    units = build_evidence_units(source)

    assert len(units) == 1
    assert units[0]["start_ref"] == "l1"
    assert units[0]["end_ref"] == "l2"
    assert "I/O 接口的功能" in units[0]["text"]
    assert "协调主机与外设" in units[0]["text"]


def test_incomplete_numbered_item_continues_across_page_without_running_header():
    source = {
        "chapter": {"book_source_revision_id": "revision"},
        "source_sections": [
            {
                "section_id": "section",
                "title": "7.1 外部设备",
                "lines": [
                    {
                        "text": "2）喷墨式打印机。彩色喷墨打印机分别喷射三种颜色的墨滴，按一定",
                        "pdf_page_index": 10,
                        "line_ordinal": 40,
                        "line_ref": "p10:l40",
                        "y_start": 0.88,
                        "y_end": 0.90,
                    },
                    {
                        "text": "300",
                        "pdf_page_index": 11,
                        "line_ordinal": 0,
                        "line_ref": "p11:l0",
                        "y_start": 0.06,
                        "y_end": 0.08,
                    },
                    {
                        "text": "2026年计算机组成原理考研复习指导",
                        "pdf_page_index": 11,
                        "line_ordinal": 1,
                        "line_ref": "p11:l1",
                        "y_start": 0.06,
                        "y_end": 0.08,
                    },
                    {
                        "text": "的比例混合出所要求的颜色。喷墨式打印机可实现高质量彩色打印。",
                        "pdf_page_index": 11,
                        "line_ordinal": 2,
                        "line_ref": "p11:l2",
                        "y_start": 0.10,
                        "y_end": 0.12,
                    },
                    {
                        "text": "3）激光打印机。激光打印机使用激光技术形成字符或图像。",
                        "pdf_page_index": 11,
                        "line_ordinal": 3,
                        "line_ref": "p11:l3",
                        "y_start": 0.13,
                        "y_end": 0.15,
                    },
                ],
            }
        ],
    }

    units = build_evidence_units(source)

    assert len(units) == 2
    assert units[0]["start_ref"] == "p10:l40"
    assert units[0]["end_ref"] == "p11:l2"
    assert units[0]["start_page"] == 10
    assert units[0]["end_page"] == 11
    assert "喷墨式打印机可实现高质量彩色打印" in units[0]["text"]
    assert "300" not in units[0]["text"]
    assert "考研复习指导" not in units[0]["text"]
    assert units[1]["start_ref"] == "p11:l3"

    packets = packetize_evidence_units(units)
    decisions = {
        packets[0]["packet_id"]: [
            {
                "action": "KEEP",
                "unit_ids": [units[0]["unit_id"]],
                "title": "喷墨打印机",
                "one_sentence_meaning": "喷墨打印机按比例混合墨滴形成彩色输出。",
            },
            {
                "action": "KEEP",
                "unit_ids": [units[1]["unit_id"]],
                "title": "激光打印机",
                "one_sentence_meaning": "激光打印机使用激光技术形成字符或图像。",
            },
        ]
    }
    materialized = materialize_candidates(packets, decisions)
    assert [candidate["title"] for candidate in materialized] == [
        "喷墨打印机", "激光打印机"
    ]
    assert materialized[0]["start_page"] == 10
    assert materialized[0]["end_page"] == 11


def test_completed_sentence_at_page_boundary_stays_in_separate_evidence_unit():
    source = {
        "chapter": {"book_source_revision_id": "revision"},
        "source_sections": [
            {
                "section_id": "section",
                "title": "7.1 外部设备",
                "lines": [
                    {
                        "text": "本页的教学说明已经完整结束。",
                        "pdf_page_index": 10,
                        "line_ordinal": 40,
                        "line_ref": "p10:l40",
                        "y_start": 0.88,
                        "y_end": 0.90,
                    },
                    {
                        "text": "下一页开始另一段完整的教学说明。",
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

    assert len(units) == 2
    assert units[0]["end_ref"] == "p10:l40"
    assert units[1]["start_ref"] == "p11:l2"


@pytest.mark.parametrize(
    "text",
    [
        "为什么需要中断？",
        "见常见问题和易混淆知识点1",
        "什么是翻译程序？见常见问题和易混淆知识点1",
        "（1）翻译程序见常见问题和易混淆知识点1",
    ],
)
def test_semantic_output_rejects_question_or_reference_only_candidate(text):
    packet = {
        "units": [{"unit_id": "u0001", "text": text}],
    }
    answer = json.dumps(
        {
            "decisions": [
                {
                    "action": "KEEP",
                    "unit_ids": ["u0001"],
                    "title": "伪学习单元",
                    "one_sentence_meaning": "没有教材实质讲解。",
                }
            ]
        },
        ensure_ascii=False,
    )

    with pytest.raises(ValueError, match="questions or references"):
        validate_semantic_output(answer, packet)


@pytest.mark.parametrize(
    "text",
    [
        "参考地址是指令访问操作数时使用的地址。",
        "中断可以提高CPU与外设并行工作的效率。为什么需要中断？",
    ],
)
def test_semantic_output_allows_substantive_teaching_with_reference_word_or_question(text):
    packet = {"units": [{"unit_id": "u0001", "text": text}]}
    answer = json.dumps(
        {
            "decisions": [
                {
                    "action": "KEEP",
                    "unit_ids": ["u0001"],
                    "title": "可教学内容",
                    "one_sentence_meaning": "教材提供了可独立学习的实质说明。",
                }
            ]
        },
        ensure_ascii=False,
    )

    assert validate_semantic_output(answer, packet)[0]["action"] == "KEEP"


def test_semantic_and_review_prompts_define_upstream_rules_and_blocking_threshold():
    assert "短编号标题" in GENERATOR_SYSTEM_MESSAGE
    assert "交叉引用" in GENERATOR_SYSTEM_MESSAGE
    assert "必须 DROP" in GENERATOR_SYSTEM_MESSAGE
    assert "分类、组成、步骤或并列枚举" in GENERATOR_SYSTEM_MESSAGE
    assert "brief_enumeration_runs" in GENERATOR_SYSTEM_MESSAGE
    assert "BLOCKING 仅用于" in REVIEW_SYSTEM_MESSAGE
    assert "存在优化空间" in REVIEW_SYSTEM_MESSAGE
    assert "只能是 WARNING" in REVIEW_SYSTEM_MESSAGE
    assert "扫描全部 Sections" in REVIEW_SYSTEM_MESSAGE


def test_brief_enumeration_is_one_upstream_merged_learning_unit():
    packet = {
        "packet_id": "p002",
        "section_packet_index": 1,
        "section_packet_count": 2,
        "primary_section_id": "section-7-1",
        "primary_section_title": "7.1 I/O系统基本概念",
        "units": [
            {"unit_id": "u0031", "text": "1）程序查询方式。由CPU不断查询设备是否就绪。"},
            {"unit_id": "u0032", "text": "2）程序中断方式。设备就绪后向CPU提出中断请求。"},
            {"unit_id": "u0033", "text": "3）DMA方式。主存与设备之间建立直接数据通路。"},
            {"unit_id": "u0034", "text": "4）通道方式。通道执行通道程序完成I/O操作。"},
        ],
    }
    run = ["u0031", "u0032", "u0033", "u0034"]
    assert brief_enumeration_runs(packet) == [run]
    payload = semantic_packet_payload(
        {"chapter_outline_node_id": "chapter-7", "title": "第7章"}, packet
    )
    assert payload["granularity_hints"]["brief_enumeration_runs"] == [run]

    fragmented = {
        "decisions": [
            {
                "action": "KEEP",
                "unit_ids": [unit["unit_id"]],
                "title": unit["text"].split("。", 1)[0],
                "one_sentence_meaning": "只有概览性的简短介绍。",
            }
            for unit in packet["units"]
        ]
    }
    with pytest.raises(ValueError, match="one merged learning unit"):
        validate_semantic_output(
            json.dumps(fragmented, ensure_ascii=False), packet
        )

    merged = {
        "decisions": [
            {
                "action": "MERGE",
                "unit_ids": run,
                "title": "I/O控制方式分类",
                "one_sentence_meaning": (
                    "I/O控制方式包括程序查询、程序中断、DMA和通道四类。"
                ),
            }
        ]
    }
    assert validate_semantic_output(
        json.dumps(merged, ensure_ascii=False), packet
    )[0]["unit_ids"] == run


def test_enumerated_items_with_substantial_independent_evidence_may_remain_split():
    detailed = "该方法具有独立机制、执行过程、适用条件与优缺点。" * 9
    packet = {
        "units": [
            {"unit_id": f"u{index:04d}", "text": f"{index}）方法{index}。{detailed}"}
            for index in range(1, 4)
        ]
    }
    assert brief_enumeration_runs(packet) == []
    answer = {
        "decisions": [
            {
                "action": "KEEP",
                "unit_ids": [unit["unit_id"]],
                "title": f"独立方法 {index}",
                "one_sentence_meaning": "教材提供了足够的独立机制和方法证据。",
            }
            for index, unit in enumerate(packet["units"], start=1)
        ]
    }
    assert len(validate_semantic_output(json.dumps(answer, ensure_ascii=False), packet)) == 3


def test_one_substantial_item_disables_brief_hint_for_the_whole_enumeration():
    detailed = "该方式具有独立机制、执行过程、适用条件与优缺点。" * 9
    packet = {
        "units": [
            {"unit_id": "u0001", "text": "1）方式一。简短介绍。"},
            {"unit_id": "u0002", "text": "2）方式二。简短介绍。"},
            {"unit_id": "u0003", "text": "3）方式三。简短介绍。"},
            {"unit_id": "u0004", "text": f"4）方式四。{detailed}"},
        ]
    }

    assert brief_enumeration_runs(packet) == []


def test_fragmented_brief_enumeration_retries_only_current_semantic_packet(service):
    packet_id = "p-enumeration"

    def generation(payload, count):
        unit_ids = [unit["unit_id"] for unit in payload["units"]]
        if count == 1:
            return json.dumps(
                {
                    "decisions": [
                        {
                            "action": "KEEP",
                            "unit_ids": [unit_id],
                            "title": f"枚举项 {index}",
                            "one_sentence_meaning": "当前只有简短的概览介绍。",
                        }
                        for index, unit_id in enumerate(unit_ids, start=1)
                    ]
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "decisions": [
                    {
                        "action": "MERGE",
                        "unit_ids": unit_ids,
                        "title": "I/O控制方式分类",
                        "one_sentence_meaning": "四种方式构成同一个分类框架。",
                    }
                ]
            },
            ensure_ascii=False,
        )

    runtime = ScriptedRuntime(generation=generation)
    fixture = build_fixture(service, runtime=runtime)
    source, _, _, _ = semantic_inputs(fixture)
    section = fixture["sections"][0]
    packet = {
        "packet_id": packet_id,
        "section_packet_index": 0,
        "section_packet_count": 1,
        "primary_section_id": section["outline_node_id"],
        "primary_section_title": section["title"],
        "units": [
            {"unit_id": f"u{index:04d}", "text": f"{index}）方式{index}。简短介绍。"}
            for index in range(1, 5)
        ],
    }
    state, _ = fixture["knowledge"].request_prepare(
        fixture["revision"]["id"], fixture["chapter"]["outline_node_id"]
    )

    decisions, _identity = fixture["knowledge"]._classify_packet(
        packet,
        source["chapter"],
        fixture["revision"]["id"],
        fixture["chapter"]["outline_node_id"],
        state["attempt_id"],
        semantic_round=0,
        repair_context=None,
        prior_section_candidates=None,
    )

    assert runtime.counts[("deepseek", packet_id)] == 2
    assert decisions == [
        {
            "action": "MERGE",
            "unit_ids": [f"u{index:04d}" for index in range(1, 5)],
            "title": "I/O控制方式分类",
            "one_sentence_meaning": "四种方式构成同一个分类框架。",
        }
    ]
    attempts = fixture["repository"].pipeline_attempts(
        fixture["revision"]["id"], fixture["chapter"]["outline_node_id"]
    )
    assert any(
        attempt["packet_or_stage_id"] == packet_id
        and attempt["failure_code"]
        == "invalid_semantic_output.fragmented_brief_enumeration"
        for attempt in attempts
    )


def test_semantic_output_requires_complete_ordered_server_ids(service):
    fixture = build_fixture(service)
    source, _, packets, _ = semantic_inputs(fixture)
    packet = packets[0]
    payload = semantic_packet_payload(source["chapter"], packet)
    valid = semantic_answer(payload)
    decisions = validate_semantic_output(valid, packet)
    assert [unit for decision in decisions for unit in decision["unit_ids"]] == [
        unit["unit_id"] for unit in packet["units"]
    ]

    unit_ids = [unit["unit_id"] for unit in packet["units"]]
    invalid = [
        {"decisions": [{"action": "DROP", "unit_ids": unit_ids[:-1]}]},
        {"decisions": [{"action": "DROP", "unit_ids": [*unit_ids, "invented"]}]},
        {"decisions": [{"action": "KEEP", "unit_ids": unit_ids, "title": "x", "one_sentence_meaning": "y"}]},
        {"decisions": [{"action": "DROP", "unit_ids": list(reversed(unit_ids))}]},
    ]
    for value in invalid:
        with pytest.raises(ValueError):
            validate_semantic_output(json.dumps(value), packet)


def test_semantic_output_rejects_unary_merge_without_silent_repair(service):
    fixture = build_fixture(service)
    source, _, packets, _ = semantic_inputs(fixture)
    packet = packets[0]
    payload = semantic_packet_payload(source["chapter"], packet)
    value = json.loads(semantic_answer(payload))
    value["decisions"][0]["action"] = "MERGE"

    with pytest.raises(ValueError, match="at least two"):
        validate_semantic_output(json.dumps(value), packet)


def test_materialization_and_compact_review_ledger_keep_source_authority_server_side(service):
    fixture = build_fixture(service)
    source, units, packets, bounds = semantic_inputs(fixture)
    decisions = {
        packet["packet_id"]: validate_semantic_output(
            semantic_answer(semantic_packet_payload(source["chapter"], packet)), packet
        )
        for packet in packets
    }
    candidates = materialize_candidates(packets, decisions)
    assert materialize_candidates(packets, decisions) == candidates
    points = publication_points(candidates)
    fixture["knowledge"]._validate_points(points, bounds)
    assert all(candidate["candidate_id"].startswith("c") for candidate in candidates)
    ledger = build_compact_review_ledger(
        source["chapter"],
        units,
        packets,
        decisions,
        candidates,
        semantic_provider="deepseek",
        semantic_model="generator-model",
        semantic_repair_round=0,
        review_rubric=REVIEW_RUBRIC,
        overlap_warnings=[],
    )
    validate_compact_review_ledger(ledger)
    assert not nested_keys(ledger) & {
        "text",
        "lines",
        "line_ref",
        "start_ref",
        "end_ref",
        "start_page",
        "start_y",
        "end_page",
        "end_y",
        "geometry",
        "quad",
        "source_revision_id",
    }
    assert "CANARY_OTHER_CHAPTER" not in json.dumps(ledger, ensure_ascii=False)


def test_one_chapter_publishes_atomically_without_outline_mutation_or_payload_retention(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    sibling_id = fixture["sibling"]["outline_node_id"]
    before = fixture["outline"].repository.list(revision_id)
    sibling_before = next(node for node in before if node["outline_node_id"] == sibling_id)

    preparing, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert created and preparing["status"] == "PREPARING"
    assert preparing["knowledge_points"] == []
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    assert ready["structure_version"] == 1
    assert ready["knowledge_points"]
    assert all(
        point["knowledge_point_id"] not in {
            candidate["candidate_id"]
            for call in fixture["runtime"].calls
            if call["provider"] == "zhipu"
            for candidate in call["payload"]["candidates"]
        }
        for point in ready["knowledge_points"]
    )
    after = fixture["outline"].repository.list(revision_id)
    assert logical_projection(after) == logical_projection(before)
    assert next(node for node in after if node["outline_node_id"] == sibling_id) == sibling_before
    assert fixture["knowledge"].snapshot(revision_id, sibling_id)["status"] == "NOT_PREPARED"

    inspection = fixture["knowledge"].inspect_payloads(revision_id, chapter_id)
    safe = inspection["attempts"][-1]
    assert safe["outcome"] == "READY"
    assert set(safe) == {
        "revision_id",
        "chapter_id",
        "attempt_id",
        "generator_provider",
        "reviewer_provider",
        "source_payload_sha256",
        "source_character_count",
        "source_payload_character_count",
        "unit_count",
        "packet_count",
        "candidate_count",
        "packet_bounds",
        "review_rounds",
        "outcome",
    }
    assert all(call["retain_request_body"] is False for call in fixture["runtime"].calls)
    assert all(
        call["thinking_mode"] == "disabled"
        and call["reasoning_effort"] is None
        for call in fixture["runtime"].calls
        if call["provider"] == "deepseek"
    )
    assert all(
        call["thinking_mode"] is None
        and call["reasoning_effort"] == "low"
        for call in fixture["runtime"].calls
        if call["provider"] == "zhipu"
    )
    assert "CANARY_OTHER_CHAPTER" not in json.dumps(
        inspection, ensure_ascii=False
    )
    call_count = len(fixture["runtime"].calls)
    unchanged, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert unchanged["status"] == "READY" and not created
    assert len(fixture["runtime"].calls) == call_count


def test_packet_structured_retry_does_not_resend_successful_packets(service):
    failing_packet = None

    def generation(payload, count):
        nonlocal failing_packet
        if failing_packet is None:
            failing_packet = payload["packet"]["packet_id"]
        if payload["packet"]["packet_id"] == failing_packet and count == 1:
            return "not-json"
        return semantic_answer(payload)

    runtime = ScriptedRuntime(generation=generation)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    counts = {
        key: value for (provider, key), value in runtime.counts.items()
        if provider == "deepseek"
    }
    assert counts[failing_packet] == 2
    assert all(count == 1 for packet, count in counts.items() if packet != failing_packet)
    attempts = fixture["repository"].pipeline_attempts(revision_id, chapter_id)
    failing = [row for row in attempts if row["packet_or_stage_id"] == failing_packet]
    assert {row["structured_attempt"] for row in failing} == {1, 2}
    assert all(row["pipeline_stage"] == "SEMANTIC_CLASSIFICATION" for row in failing)


def test_multi_packet_section_is_sequential_and_prior_context_never_crosses_section(service):
    runtime = ScriptedRuntime()
    fixture = build_fixture(service, runtime=runtime)
    source, _, packets, _ = semantic_inputs(fixture)
    first = packets[0]
    assert len(first["units"]) >= 2 and len(packets) >= 2

    split_packets = []
    for suffix, selected in (("a", first["units"][:1]), ("b", first["units"][1:])):
        split_packets.append(
            {
                **first,
                "packet_id": f"{first['packet_id']}-{suffix}",
                "packet_order": len(split_packets),
                "section_packet_index": len(split_packets),
                "section_packet_count": 2,
                "units": selected,
                "character_count": sum(len(unit["text"]) for unit in selected),
            }
        )
    other = {**packets[1], "packet_order": 2}
    split_packets.append(other)

    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    state, _ = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    fixture["knowledge"]._classify_packets(
        split_packets,
        source["chapter"],
        revision_id,
        chapter_id,
        state["attempt_id"],
        semantic_round=0,
    )

    calls = {
        call["payload"]["packet"]["packet_id"]: call["payload"]
        for call in runtime.calls
        if call["provider"] == "deepseek"
    }
    assert "prior_section_candidates" not in calls[f"{first['packet_id']}-a"]
    assert calls[f"{first['packet_id']}-b"]["prior_section_candidates"]
    assert "prior_section_candidates" not in calls[other["packet_id"]]


def test_same_section_multi_packet_repair_uses_newly_repaired_peer_context(service):
    runtime = ScriptedRuntime()
    fixture = build_fixture(service, runtime=runtime)
    source, _, packets, _ = semantic_inputs(fixture)
    first = packets[0]
    repair_packets = []
    for suffix, selected in (("a", first["units"][:1]), ("b", first["units"][1:])):
        repair_packets.append(
            {
                **first,
                "packet_id": f"{first['packet_id']}-{suffix}",
                "packet_order": len(repair_packets),
                "section_packet_index": len(repair_packets),
                "section_packet_count": 2,
                "units": selected,
                "character_count": sum(len(unit["text"]) for unit in selected),
            }
        )
    repair_contexts = {
        packet["packet_id"]: {
            "semantic_round": 1,
            "blocking_findings": [
                {
                    "dimension": "duplicate_or_near_duplicate_semantics",
                    "severity": "BLOCKING",
                    "unit_ids": [packet["units"][0]["unit_id"]],
                    "detail": "需要局部修复。",
                }
            ],
            "previous_decisions": json.loads(
                semantic_answer(semantic_packet_payload(source["chapter"], packet))
            )["decisions"],
        }
        for packet in repair_packets
    }
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    state, _ = fixture["knowledge"].request_prepare(revision_id, chapter_id)

    fixture["knowledge"]._classify_packets(
        repair_packets,
        source["chapter"],
        revision_id,
        chapter_id,
        state["attempt_id"],
        semantic_round=1,
        repair_contexts=repair_contexts,
        prior_section_candidates_by_packet={
            packet["packet_id"]: [] for packet in repair_packets
        },
    )

    calls = {
        call["payload"]["packet"]["packet_id"]: call["payload"]
        for call in runtime.calls
        if call["provider"] == "deepseek"
    }
    assert "prior_section_candidates" not in calls[f"{first['packet_id']}-a"]
    assert calls[f"{first['packet_id']}-b"]["prior_section_candidates"][0][
        "title"
    ].startswith("修复后")


def test_actionable_review_repairs_only_addressed_packet_then_re_reviews_chapter(service):
    target = {}

    def reviewer(payload, count):
        if count == 1:
            packet = payload["packets"][0]
            decision = next(
                decision for decision in packet["decisions"]
                if "candidate_id" in decision
            )
            target["packet_id"] = packet["packet_id"]
            target["section_id"] = packet["section_id"]
            target["unit_id"] = decision["unit_ids"][0]
            return review_answer(
                "FAIL",
                "首个 packet 存在不合理拆分。",
                [blocking_finding(packet["section_id"], [target["unit_id"]])],
            )
        return review_answer(summary="定向修复后整章结构通过。")

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    generator_counts = {
        key: value for (provider, key), value in runtime.counts.items()
        if provider == "deepseek"
    }
    assert generator_counts[target["packet_id"]] == 2
    assert all(
        value == 1 for key, value in generator_counts.items()
        if key != target["packet_id"]
    )
    reviews = [call["payload"] for call in runtime.calls if call["provider"] == "zhipu"]
    assert len(reviews) == 2
    target_units = set(
        next(
            [
                unit_id
                for decision in packet["decisions"]
                for unit_id in decision["unit_ids"]
            ]
            for packet in reviews[0]["packets"]
            if packet["packet_id"] == target["packet_id"]
        )
    )
    unaffected_before = [
        candidate for candidate in reviews[0]["candidates"]
        if target_units.isdisjoint(candidate["unit_ids"])
    ]
    unaffected_after = [
        candidate for candidate in reviews[1]["candidates"]
        if target_units.isdisjoint(candidate["unit_ids"])
    ]
    assert unaffected_after == unaffected_before
    repaired = [
        candidate for candidate in reviews[1]["candidates"]
        if target["unit_id"] in candidate["unit_ids"]
    ]
    assert repaired and repaired[0]["title"].startswith("修复后")
    inspection = fixture["knowledge"].inspect_payloads(revision_id, chapter_id)
    assert [item["verdict"] for item in inspection["attempts"][-1]["review_rounds"]] == [
        "FAIL",
        "PASS",
    ]


def test_later_review_may_repair_only_newly_discovered_untouched_packets(
    service, monkeypatch
):
    def split_each_unit(units):
        by_section = {}
        for unit in units:
            by_section.setdefault(unit["primary_section_id"], []).append(unit)
        packets = []
        for section_units in by_section.values():
            for section_index, unit in enumerate(section_units):
                packets.append(
                    {
                        "packet_id": f"p{len(packets) + 1:03d}",
                        "packet_order": len(packets),
                        "section_packet_index": section_index,
                        "section_packet_count": len(section_units),
                        "primary_section_id": unit["primary_section_id"],
                        "primary_section_title": unit["primary_section_title"],
                        "units": [unit],
                        "character_count": len(unit["text"]),
                    }
                )
        return packets

    monkeypatch.setattr(
        "reader_service.knowledge.service.packetize_evidence_units", split_each_unit
    )
    targets = []

    def reviewer(payload, count):
        if count == 1:
            selected = [payload["packets"][0]]
        elif count == 2:
            selected = payload["packets"][1:3]
        else:
            return review_answer(summary="新暴露的局部缺陷修复后整章通过。")
        findings = []
        for packet in selected:
            unit_id = packet["decisions"][0]["unit_ids"][0]
            targets.append((packet["packet_id"], unit_id))
            findings.append(
                blocking_finding(
                    packet["section_id"],
                    [unit_id],
                    dimension="duplicate_or_near_duplicate_semantics",
                )
            )
        return review_answer("FAIL", "发现高置信重复学习状态。", findings)

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)

    ready = claim_and_run(fixture)

    assert ready["status"] == "READY"
    assert len([call for call in runtime.calls if call["provider"] == "zhipu"]) == 3
    repaired_packet_ids = {packet_id for packet_id, _unit_id in targets}
    generation_counts = {
        key: count
        for (provider, key), count in runtime.counts.items()
        if provider == "deepseek"
    }
    assert len(repaired_packet_ids) == 3
    assert all(generation_counts[packet_id] == 2 for packet_id in repaired_packet_ids)
    assert all(
        count == 1
        for packet_id, count in generation_counts.items()
        if packet_id not in repaired_packet_ids
    )
    repair_calls = [
        call for call in runtime.calls
        if call["provider"] == "deepseek" and "repair_context" in call["payload"]
    ]
    assert repair_calls
    first_repair = next(
        call for call in repair_calls
        if call["payload"]["packet"]["packet_id"] == "p001"
    )
    assert first_repair["payload"]["prior_section_candidates"]
    assert not nested_keys(first_repair["payload"]) & {
        "source_revision_id", "start_ref", "end_ref", "start_page", "end_page"
    }
    inspection = fixture["knowledge"].inspect_payloads(revision_id, chapter_id)
    rounds = inspection["attempts"][-1]["review_rounds"]
    assert [item["verdict"] for item in rounds] == ["FAIL", "FAIL", "PASS"]
    assert rounds[0]["findings"][0]["detail"].startswith("这些单元")


def test_cumulative_new_packet_repair_scope_is_bounded(service, monkeypatch):
    monkeypatch.setattr(
        "reader_service.knowledge.service.MAX_CUMULATIVE_REPAIR_PACKETS", 1
    )

    def reviewer(payload, count):
        packet = payload["packets"][count - 1]
        unit_id = packet["decisions"][0]["unit_ids"][0]
        return review_answer(
            "FAIL",
            "每轮发现另一个阻断缺陷。",
            [blocking_finding(packet["section_id"], [unit_id])],
        )

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)

    failed = claim_and_run(fixture)

    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "REVIEW"
    assert failed["failure_code"] == "review_repair_scope_exceeded"
    assert failed["knowledge_points"] == []


def test_review_targets_are_validated_and_over_broad_repair_fails_closed(service):
    modes = ["invented", "whole-chapter"]
    for mode in modes:
        runtime = ScriptedRuntime()

        def reviewer(payload, _count, selected=mode):
            if selected == "invented":
                section = payload["sections"][0]
                findings = [blocking_finding(section["section_id"], ["invented-unit"])]
            else:
                findings = [
                    blocking_finding(section["section_id"], [unit["unit_id"] for unit in section["units"]])
                    for section in payload["sections"]
                ]
            return review_answer("FAIL", "拒绝并给出定位。", findings)

        runtime.review = reviewer
        fixture = build_fixture(service, runtime=runtime)
        revision_id = fixture["revision"]["id"]
        chapter_id = fixture["chapter"]["outline_node_id"]
        fixture["knowledge"].request_prepare(revision_id, chapter_id)
        failed = claim_and_run(fixture)
        assert failed["status"] == "FAILED"
        assert failed["failure_stage"] == "REVIEW"
        assert failed["failure_code"] == (
            "invalid_review_output"
            if mode == "invented"
            else "review_repair_scope_exceeded"
        )
        assert failed["failure_kind"] == (
            "INVALID_STRUCTURED_OUTPUT"
            if mode == "invented"
            else "SEMANTIC_FAILURE"
        )
        assert failed["knowledge_points"] == []
        service.delete_book(fixture["book"]["id"])


@pytest.mark.parametrize(
    "dimension",
    [
        "independently_trackable_granularity",
        "duplicate_or_near_duplicate_semantics",
        "instructional_specificity",
        "split_merge_quality",
        "major_learning_coverage",
        "section_and_source_faithfulness",
        "chapter_map_balance",
    ],
)
def test_bounded_re_review_rejection_preserves_atomic_empty_map(service, dimension):
    def reviewer(payload, _count):
        packet = payload["packets"][0]
        unit_id = packet["decisions"][0]["unit_ids"][0]
        return review_answer(
            "FAIL",
            f"{dimension} 仍未通过。",
            [blocking_finding(packet["section_id"], [unit_id], dimension=dimension)],
        )

    runtime = ScriptedRuntime(review=reviewer)
    fixture = build_fixture(service, runtime=runtime)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "REVIEW"
    assert failed["failure_code"] == "review_rejected"
    assert failed["knowledge_points"] == []
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM knowledge_points").fetchone()[0] == 0


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
        (
            lambda _payload, _count: "",
            None,
            "GENERATION",
            "invalid_semantic_output.not_json",
        ),
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
        runtime = ScriptedRuntime(
            generation=generator,
            review=reviewer or [review_answer()],
        )
        fixture = build_fixture(service, runtime=runtime)
        revision_id = fixture["revision"]["id"]
        chapter_id = fixture["chapter"]["outline_node_id"]
        fixture["knowledge"].request_prepare(revision_id, chapter_id)
        failed = claim_and_run(fixture)
        assert failed["status"] == "FAILED"
        assert failed["failure_stage"] == stage
        assert failed["failure_code"] == code
        attempts = fixture["repository"].pipeline_attempts(revision_id, chapter_id)
        assert attempts
        if code == "empty_response":
            row = next(row for row in attempts if row["failure_code"] == code)
            assert row["content_present"] == 0
            assert row["content_length"] == 0
        if code.startswith("invalid_semantic_output") or code == "invalid_review_output":
            assert any(
                row["status"] == "FAILED"
                and row["failure_kind"] == "INVALID_STRUCTURED_OUTPUT"
                and row["failure_code"] == code
                for row in attempts
            )
        service.delete_book(fixture["book"]["id"])


def test_post_review_validation_failure_and_atomic_insert_rollback(service):
    fixture = build_fixture(
        service,
        post_review_validator=lambda _points: (_ for _ in ()).throw(ValueError("bad")),
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
        results = list(
            pool.map(
                lambda _: fixture["knowledge"].request_prepare(revision_id, chapter_id),
                range(8),
            )
        )
    assert all(state["status"] == "PREPARING" for state, _ in results)
    with service.database.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE job_type = 'CHAPTER_PREPARE'"
        ).fetchone()[0] == 1
    state = fixture["repository"].snapshot(revision_id, chapter_id)
    section_id = fixture["sections"][0]["outline_node_id"]
    fixture["repository"].record_pipeline_attempt(
        revision_id,
        chapter_id,
        state["attempt_id"],
        section_id=section_id,
        packet_or_stage_id="p-test",
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
        status, inspection = request_json(f"{base}{path}/inspection", token)
        assert status == 200
        assert inspection["pipeline_attempts"]


def test_migration_10_preserves_legacy_attempt_as_safe_metadata(tmp_path):
    path = tmp_path / "upgrade.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        "CREATE TABLE schema_migrations "
        "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, sql in MIGRATIONS:
        if version >= 10:
            break
        connection.executescript(sql)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
    connection.execute(
        "INSERT INTO books(id, title, status, created_at) VALUES ('book', '书', 'ACTIVE', 't')"
    )
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
        assert row == (
            "legacy",
            "section",
            "section",
            0,
            "KP_GENERATOR",
            "LEGACY_GENERATION",
            "STARTED",
        )
        assert upgraded.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' "
            "AND name='chapter_generation_attempts'"
        ).fetchone() is None
        assert upgraded.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 10
    finally:
        upgraded.close()


def test_book_delete_cascades_and_phase_does_not_create_learning_tables(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert claim_and_run(fixture)["status"] == "READY"
    other_pdf = make_pdf()
    other = service.intake(
        BytesIO(other_pdf),
        content_length=len(other_pdf),
        filename="other.pdf",
        title="另一本书",
    )["book"]
    service.delete_book(fixture["book"]["id"])
    with service.database.connect() as connection:
        for table in (
            "chapter_preparations",
            "knowledge_points",
            "chapter_pipeline_attempts",
        ):
            assert connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE book_source_revision_id = ?",
                (revision_id,),
            ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM books WHERE id = ?", (other["id"],)
        ).fetchone()[0] == 1
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert tables.isdisjoint(
        {
            "kp_status",
            "section_learning_state",
            "learning_events",
            "master_threads",
            "master_topics",
            "master_messages",
            "teaching_assets",
            "exam_evidence",
        }
    )
