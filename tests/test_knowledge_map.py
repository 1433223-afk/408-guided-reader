from __future__ import annotations

import json
import sqlite3
import threading
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
from reader_service.library.database import Database, MIGRATIONS
from reader_service.outline import OutlineRepository, OutlineService

from conftest import make_pdf


def detected(text: str, y: float) -> DetectedLine:
    width = min(0.8, max(0.12, len(text) * 0.025))
    cells = tuple(
        (0.1 + width * index / len(text), 0.1 + width * (index + 1) / len(text), index, index + 1)
        for index in range(len(text))
    )
    return DetectedLine(
        quad=((0.1, y), (0.1 + width, y), (0.1 + width, y + 0.035), (0.1, y + 0.035)),
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


class ScriptedRuntime:
    active_provider = "deepseek"

    def __init__(self, generation, review):
        self.answers = {
            "deepseek": (
                {key: list(values) for key, values in generation.items()}
                if isinstance(generation, dict) else list(generation)
            ),
            "zhipu": list(review),
        }
        self.calls = []
        self._lock = threading.Lock()

    def provider_identity(self, provider):
        if provider not in self.answers:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED, "unknown_provider", "provider unavailable"
            )
        return provider, {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider]

    def complete_for_with_metadata(
        self, provider, messages, *, interaction_id=None, max_tokens=None,
        attempt_observer=None,
    ):
        section_id = None
        if provider == "deepseek":
            payload = json.loads(messages[1]["content"])
            section_id = payload["source_section"]["section_id"]
        with self._lock:
            self.calls.append(
                {"provider": provider, "messages": json.loads(json.dumps(messages)),
                 "interaction_id": interaction_id, "max_tokens": max_tokens}
            )
            answers = self.answers[provider]
            queue = answers.get(section_id) if isinstance(answers, dict) else answers
            if not queue:
                raise AssertionError(f"No scripted answer for {provider}")
            answer = queue.pop(0)
        if attempt_observer is not None:
            attempt_observer({
                "status": "STARTED", "provider": provider,
                "model": {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider],
                "interaction_id": interaction_id, "transport_attempt": 1,
            })
        if isinstance(answer, Exception):
            if attempt_observer is not None and isinstance(answer, ProviderFailure):
                attempt_observer({
                    "status": "FAILED", "provider": provider,
                    "model": {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider],
                    "interaction_id": interaction_id, "transport_attempt": 1,
                    "latency_ms": 1, "failure_kind": answer.kind.value,
                    "failure_code": answer.code,
                    **(answer.diagnostics or {}),
                })
            raise answer
        if attempt_observer is not None:
            attempt_observer({
                "status": "SUCCEEDED", "provider": provider,
                "model": {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider],
                "interaction_id": interaction_id, "transport_attempt": 1,
                "latency_ms": 1,
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                "finish_reason": "stop", "content_present": True,
                "content_length": len(answer), "reasoning_present": False,
                "reasoning_length": 0,
            })
        return ProviderCompletion(
            answer=answer, latency_ms=1, usage={"fixture": True},
            effective_config={
                "provider": provider,
                "model": {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider],
            },
        )


def generation_answer(section_id: str, section_index: int, *, start_ref=None, end_ref=None,
                      title=None, definition=None) -> str:
    refs = [("p0:l2", "p1:l0"), ("p2:l1", "p3:l0")]
    default_start, default_end = refs[section_index]
    return json.dumps(
        {
            "knowledge_points": [
                {
                    "draft_key": f"private-{section_index}",
                    "primary_section_id": section_id,
                    "title": title or f"核心概念 {section_index + 1}",
                    "one_sentence_definition": definition or f"第{section_index + 1}节中值得独立理解的核心概念。",
                    "start_ref": start_ref or default_start,
                    "end_ref": end_ref or default_end,
                },
            ]
        },
        ensure_ascii=False,
    )


def generation_scripts(section_ids: list[str], *, first_override=None, repeats=1):
    scripts = {
        section_id: [generation_answer(section_id, index) for _ in range(repeats)]
        for index, section_id in enumerate(section_ids)
    }
    if first_override is not None:
        scripts[section_ids[0]] = list(first_override)
    return scripts


def review_answer(verdict: str, summary: str, findings=None) -> str:
    return json.dumps(
        {"verdict": verdict, "summary": summary, "findings": findings or []},
        ensure_ascii=False,
    )


def blocking_finding(
    dimension: str,
    *,
    candidate_indices: list[int],
    evidence_section_ids: list[str],
    repair_section_ids: list[str],
    detail: str,
) -> dict:
    return {
        "dimension": dimension,
        "severity": "BLOCKING",
        "candidate_indices": candidate_indices,
        "evidence_section_ids": evidence_section_ids,
        "repair_section_ids": repair_section_ids,
        "detail": detail,
    }


def build_fixture(service, *, runtime=None, post_review_validator=None):
    result = service.intake(
        BytesIO(chapter_pdf()), content_length=len(chapter_pdf()),
        filename="chapters.pdf", title="章节测试",
    )
    revision = result["book"]["active_revision"]
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    pages = {
        0: [detected("第1章 基础", 0.08), detected("1.1 第一节", 0.18), detected("概念 A 的起点", 0.30)],
        1: [detected("概念 A 的终点", 0.30)],
        2: [detected("1.2 第二节", 0.16), detected("概念 B 的起点", 0.28)],
        3: [detected("概念 B 的终点", 0.30)],
        4: [detected("第2章 后续", 0.09), detected("2.1 第三节", 0.2), detected("不得外泄 CANARY_OTHER_CHAPTER", 0.3)],
        5: [detected("第二章内容", 0.3)],
    }
    for page_index, lines in pages.items():
        assert foundation_repository.mark_preparing(revision["id"], page_index)
        foundation_repository.publish_page(
            revision["id"], page_index, route="OCR", foundation_version=1,
            engine_profile="fixture:v1", lines=lines,
        )
    outline = OutlineService(
        service, OutlineRepository(service.database),
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
    scripted = runtime or ScriptedRuntime(
        generation_scripts([node["outline_node_id"] for node in sections]),
        [review_answer("PASS", "结构与来源范围通过。")],
    )
    repository = KnowledgeRepository(service.database)
    knowledge = KnowledgeService(
        service, foundation, outline, repository, scripted,
        generator_provider="deepseek", reviewer_provider="zhipu",
        post_review_validator=post_review_validator,
    )
    return {
        "book": result["book"], "revision": revision, "foundation": foundation, "outline": outline,
        "chapter": chapter, "sibling": sibling, "sections": sections,
        "runtime": scripted, "repository": repository, "knowledge": knowledge,
        "jobs": JobRepository(service.database),
    }


def claim_and_run(fixture):
    job = fixture["jobs"].claim()
    assert job is not None and job["job_type"] == "CHAPTER_PREPARE"
    result = fixture["knowledge"].run_job(job)
    fixture["jobs"].complete(job["id"])
    return result


def logical_projection(nodes):
    return [
        (
            node["outline_node_id"], node["parent_id"], node["depth"],
            node["order_index"], node["kind"], node["title"],
            node["identity_revision"],
        )
        for node in sorted(nodes, key=lambda item: item["outline_node_id"])
    ]


def test_one_chapter_publishes_atomically_with_stable_ids_and_allowlisted_payload(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    sibling_id = fixture["sibling"]["outline_node_id"]
    before = fixture["outline"].repository.list(revision_id)
    sibling_before = next(node for node in before if node["outline_node_id"] == sibling_id)

    not_prepared = fixture["knowledge"].snapshot(revision_id, chapter_id)
    assert not_prepared["status"] == "NOT_PREPARED"
    preparing, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert created and preparing["status"] == "PREPARING"
    assert preparing["knowledge_points"] == []
    assert fixture["knowledge"].snapshot(revision_id, sibling_id)["status"] == "NOT_PREPARED"

    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    assert ready["structure_version"] == 1
    assert len(ready["knowledge_points"]) == 2
    assert all(point["knowledge_point_id"] not in {"private-a", "private-b"} for point in ready["knowledge_points"])
    assert {point["primary_section_id"] for point in ready["knowledge_points"]} == {
        section["outline_node_id"] for section in fixture["sections"]
    }
    assert all(point["book_source_revision_id"] == revision_id for point in ready["knowledge_points"])

    after = fixture["outline"].repository.list(revision_id)
    assert logical_projection(after) == logical_projection(before)
    sibling_after = next(node for node in after if node["outline_node_id"] == sibling_id)
    assert sibling_after == sibling_before
    changed = [node for node in after if node["physical_revision"] != next(
        old["physical_revision"] for old in before if old["outline_node_id"] == node["outline_node_id"]
    )]
    assert {node["outline_node_id"] for node in changed} == {
        chapter_id, *(section["outline_node_id"] for section in fixture["sections"])
    }

    inspections = fixture["knowledge"].inspect_payloads(revision_id, chapter_id)["attempts"]
    assert len(inspections) == 1 and inspections[0]["outcome"] == "READY"
    source = inspections[0]["source_payload"]
    review = inspections[0]["review_payload"]
    assert set(source) == {"chapter", "outline", "source_sections"}
    assert set(review) == {
        "chapter", "outline", "bounded_source", "candidate_knowledge_points",
        "generation_provenance", "review_rubric", "overlap_warnings",
    }
    encoded = json.dumps(inspections, ensure_ascii=False)
    assert "CANARY_OTHER_CHAPTER" not in encoded
    generation_calls = [call for call in fixture["runtime"].calls if call["provider"] == "deepseek"]
    review_calls = [call for call in fixture["runtime"].calls if call["provider"] == "zhipu"]
    assert len(generation_calls) == len(fixture["sections"])
    assert len(review_calls) == 1
    assert all(call["max_tokens"] == 12_288 for call in fixture["runtime"].calls)
    for call in generation_calls:
        payload = json.loads(call["messages"][1]["content"])
        assert set(payload) == {"chapter", "outline", "source_section"}
        assert set(payload["chapter"]) == {
            "book_source_revision_id", "chapter_outline_node_id", "title",
        }
        assert {node["kind"] for node in payload["outline"]}.isdisjoint({"CHAPTER"})
        assert payload["source_section"]["section_id"] == payload["outline"][0]["outline_node_id"]
        assert set(payload["source_section"]) == {"section_id", "title", "lines"}
        assert all(set(line) == {"line_ref", "text"} for line in payload["source_section"]["lines"])

    reopened = KnowledgeRepository(service.database).snapshot(revision_id, chapter_id)
    assert [point["knowledge_point_id"] for point in reopened["knowledge_points"]] == [
        point["knowledge_point_id"] for point in ready["knowledge_points"]
    ]
    joined, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert not created and joined["status"] == "READY"
    assert fixture["jobs"].claim() is None


def test_duplicate_concurrent_requests_and_restart_recovery_converge(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(
            lambda _: fixture["knowledge"].request_prepare(revision_id, chapter_id),
            range(12),
        ))
    assert all(result[0]["status"] == "PREPARING" for result in results)
    with service.database.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM chapter_preparations WHERE book_source_revision_id = ?",
            (revision_id,),
        ).fetchone()[0] == 1
        assert connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE job_type = 'CHAPTER_PREPARE' AND book_source_revision_id = ?",
            (revision_id,),
        ).fetchone()[0] == 1

    running = fixture["jobs"].claim()
    assert running and running["job_type"] == "CHAPTER_PREPARE"
    assert fixture["jobs"].recover() == 1
    assert fixture["repository"].recover_preparing_jobs() == 0
    recovered = fixture["jobs"].claim()
    assert recovered and recovered["id"] == running["id"]
    ready = fixture["knowledge"].run_job(recovered)
    fixture["jobs"].complete(recovered["id"])
    assert ready["status"] == "READY"


def test_section_structured_retry_does_not_resend_successful_sibling_and_records_safe_attempts(service):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    runtime = ScriptedRuntime(
        generation_scripts(
            section_ids,
            first_override=[
                "DO_NOT_STORE_RESPONSE_BODY",
                generation_answer(section_ids[0], 0),
            ],
        ),
        [review_answer("PASS", "整章结构通过。")],
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"

    generation_calls = [call for call in runtime.calls if call["provider"] == "deepseek"]
    section_calls = [
        json.loads(call["messages"][1]["content"])["source_section"]["section_id"]
        for call in generation_calls
    ]
    assert section_calls.count(section_ids[0]) == 2
    assert section_calls.count(section_ids[1]) == 1
    assert any("structured-2" in call["interaction_id"] for call in generation_calls)

    attempts = fixture["repository"].generation_attempts(revision_id, chapter_id)
    assert len(attempts) == 3
    assert {attempt["status"] for attempt in attempts} == {"SUCCEEDED"}
    assert {attempt["primary_section_id"] for attempt in attempts} == set(section_ids)
    assert all(attempt["provider_role"] == "KP_GENERATOR" for attempt in attempts)
    assert all(attempt["pipeline_stage"] == "GENERATION" for attempt in attempts)
    assert all(attempt["finish_reason"] == "stop" for attempt in attempts)
    assert all(attempt["total_tokens"] == 15 for attempt in attempts)
    assert all(attempt["content_present"] == 1 for attempt in attempts)
    assert all(attempt["reasoning_present"] == 0 for attempt in attempts)
    serialized = json.dumps(attempts, ensure_ascii=False)
    assert "DO_NOT_STORE_RESPONSE_BODY" not in serialized
    assert "knowledge_points" not in serialized


def test_actionable_review_repairs_only_target_section_then_re_reviews_full_chapter(service):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    initial_first = generation_answer(
        section_ids[0], 0, title="重复概念",
        definition="第一节中完整讲授的可独立学习概念。",
    )
    initial_second = generation_answer(
        section_ids[1], 1, title="重复概念",
        definition="第二节复述了第一节已经完整讲授的概念。",
    )
    repaired_second = generation_answer(
        section_ids[1], 1, title="第二节独有概念",
        definition="第二节教材来源支持的另一个独立学习概念。",
    )
    rejection = review_answer(
        "FAIL", "第二节候选与第一节候选语义重复。",
        [blocking_finding(
            "duplicate_or_near_duplicate_semantics",
            candidate_indices=[0, 1],
            evidence_section_ids=section_ids,
            repair_section_ids=[section_ids[1]],
            detail="保留第一节完整讲授项；第二节须去除复述并只保留其独有内容。",
        )],
    )
    runtime = ScriptedRuntime(
        {
            section_ids[0]: [initial_first],
            section_ids[1]: [initial_second, repaired_second],
        },
        [rejection, review_answer("PASS", "定点修复后整章结构通过。")],
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)

    ready = claim_and_run(fixture)

    assert ready["status"] == "READY"
    assert [point["title"] for point in ready["knowledge_points"]] == [
        "重复概念", "第二节独有概念",
    ]
    generation_calls = [call for call in runtime.calls if call["provider"] == "deepseek"]
    called_sections = [
        json.loads(call["messages"][1]["content"])["source_section"]["section_id"]
        for call in generation_calls
    ]
    assert called_sections.count(section_ids[0]) == 1
    assert called_sections.count(section_ids[1]) == 2
    repair_call = next(
        call for call in generation_calls if call["interaction_id"].startswith("kp-repair:")
    )
    repair_payload = json.loads(repair_call["messages"][1]["content"])
    assert set(repair_payload) == {
        "chapter", "outline", "source_section", "repair_context",
    }
    assert repair_payload["source_section"]["section_id"] == section_ids[1]
    assert repair_payload["repair_context"]["semantic_repair_round"] == 1
    assert repair_payload["repair_context"]["blocking_findings"][0][
        "repair_section_ids"
    ] == [section_ids[1]]
    assert {
        item["candidate_index"]
        for item in repair_payload["repair_context"]["referenced_candidates"]
    } == {0, 1}
    assert "完整替换候选集" in repair_call["messages"][0]["content"]

    review_calls = [call for call in runtime.calls if call["provider"] == "zhipu"]
    assert len(review_calls) == 2
    review_payloads = [json.loads(call["messages"][1]["content"]) for call in review_calls]
    assert all(
        len(payload["bounded_source"]) == len(section_ids)
        and len(payload["candidate_knowledge_points"]) == 2
        for payload in review_payloads
    )
    assert [
        payload["generation_provenance"]["semantic_repair_round"]
        for payload in review_payloads
    ] == [0, 1]
    assert review_payloads[0]["candidate_knowledge_points"][1]["title"] == "重复概念"
    assert review_payloads[1]["candidate_knowledge_points"][1]["title"] == "第二节独有概念"

    attempts = fixture["repository"].generation_attempts(revision_id, chapter_id)
    assert len(attempts) == 3
    repaired_attempt = next(
        attempt for attempt in attempts if attempt["interaction_id"].startswith("kp-repair:")
    )
    assert repaired_attempt["primary_section_id"] == section_ids[1]
    assert repaired_attempt["structured_attempt"] == 3
    assert repaired_attempt["status"] == "SUCCEEDED"


def test_non_actionable_review_output_never_guesses_a_repair_section(service):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    legacy_fail = json.dumps(
        {"verdict": "FAIL", "summary": "有问题但没有可定位 findings。"},
        ensure_ascii=False,
    )
    runtime = ScriptedRuntime(
        generation_scripts(section_ids), [legacy_fail, legacy_fail]
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)

    failed = claim_and_run(fixture)

    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "REVIEW"
    assert failed["failure_code"] == "invalid_review_output"
    generation_calls = [call for call in runtime.calls if call["provider"] == "deepseek"]
    assert len(generation_calls) == len(section_ids)
    assert all(not call["interaction_id"].startswith("kp-repair:") for call in generation_calls)
    assert len([call for call in runtime.calls if call["provider"] == "zhipu"]) == 2
    assert fixture["repository"].snapshot(revision_id, chapter_id)["knowledge_points"] == []


def test_overlap_is_review_signal_not_deterministic_failure(service):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    overlapping = json.dumps(
        {
            "knowledge_points": [
                {
                    "draft_key": "shared-a",
                    "primary_section_id": section_ids[0],
                    "title": "共享证据下的概念 A",
                    "one_sentence_definition": "可独立检查的第一个概念。",
                    "start_ref": "p0:l2",
                    "end_ref": "p1:l0",
                },
                {
                    "draft_key": "shared-b",
                    "primary_section_id": section_ids[0],
                    "title": "共享证据下的概念 B",
                    "one_sentence_definition": "可独立检查的第二个概念。",
                    "start_ref": "p0:l2",
                    "end_ref": "p1:l0",
                },
            ]
        },
        ensure_ascii=False,
    )
    runtime = ScriptedRuntime(
        {
            section_ids[0]: [overlapping],
            section_ids[1]: [generation_answer(section_ids[1], 1)],
        },
        [review_answer(
            "PASS", "共享来源合理，结构通过。",
            [{
                "dimension": "duplicate_or_near_duplicate_semantics",
                "severity": "WARNING",
                "candidate_indices": [0, 1],
                "evidence_section_ids": [section_ids[0]],
                "repair_section_ids": [],
                "detail": "两项共享来源，但学习目标彼此独立。",
            }],
        )],
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"
    assert len(ready["knowledge_points"]) == 3
    review_payload = fixture["knowledge"].inspect_payloads(
        revision_id, chapter_id
    )["attempts"][-1]["review_payload"]
    assert review_payload["overlap_warnings"] == [{
        "first_candidate_index": 0,
        "second_candidate_index": 1,
        "primary_section_id": section_ids[0],
        "signal": "SHARED_SOURCE_EVIDENCE_REVIEW_REQUIRED",
    }]
    assert set(review_payload["review_rubric"]) == {
        "independently_trackable_granularity",
        "duplicate_or_near_duplicate_semantics",
        "instructional_specificity",
        "split_merge_quality",
        "major_learning_coverage",
        "section_and_source_faithfulness",
        "chapter_map_balance",
    }
    review_call = next(call for call in runtime.calls if call["provider"] == "zhipu")
    system = review_call["messages"][0]["content"]
    for phrase in ("语义重复", "泛化能力", "拆分/合并", "覆盖", "失衡", "overlap_warnings"):
        assert phrase in system


@pytest.mark.parametrize(
    ("issue", "summary"),
    [
        ("duplicate", "语义重复或近重复"),
        ("instructional_specificity", "候选只是泛化答题能力"),
        ("split_merge_quality", "候选存在不合理拆分或合并"),
        ("coverage", "遗漏主要可学习内容"),
        ("map_balance", "各小节颗粒度明显失衡"),
    ],
)
def test_chapter_structural_review_rejection_never_publishes_adversarial_map(
    service, issue, summary
):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    dimensions = {
        "duplicate": "duplicate_or_near_duplicate_semantics",
        "instructional_specificity": "instructional_specificity",
        "split_merge_quality": "split_merge_quality",
        "coverage": "major_learning_coverage",
        "map_balance": "chapter_map_balance",
    }
    rejection = review_answer(
        "FAIL", f"{issue}: {summary}",
        [blocking_finding(
            dimensions[issue], candidate_indices=[0],
            evidence_section_ids=[section_ids[0]],
            repair_section_ids=[section_ids[0]], detail=summary,
        )],
    )
    runtime = ScriptedRuntime(
        generation_scripts(section_ids, repeats=2),
        [rejection, rejection],
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "REVIEW"
    assert failed["failure_code"] == "review_rejected"
    assert failed["knowledge_points"] == []
    generation_calls = [call for call in runtime.calls if call["provider"] == "deepseek"]
    called_sections = [
        json.loads(call["messages"][1]["content"])["source_section"]["section_id"]
        for call in generation_calls
    ]
    assert called_sections.count(section_ids[0]) == 2
    assert all(called_sections.count(section_id) == 1 for section_id in section_ids[1:])
    assert len([call for call in runtime.calls if call["provider"] == "zhipu"]) == 2
    review_payload = fixture["knowledge"].inspect_payloads(
        revision_id, chapter_id
    )["attempts"][-1]["review_payload"]
    assert len(review_payload["bounded_source"]) == len(section_ids)
    assert len(review_payload["review_rubric"]) == 7


def test_restart_marks_live_generation_attempt_interrupted_and_resets_private_progress(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    section_id = fixture["sections"][0]["outline_node_id"]
    preparing, _ = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    fixture["repository"].update_progress(
        revision_id, chapter_id, preparing["attempt_id"],
        stage="GENERATING", sections_completed=1, sections_total=2,
    )
    fixture["repository"].record_generation_attempt(
        revision_id, chapter_id, preparing["attempt_id"], section_id, 1,
        {
            "status": "STARTED", "provider": "deepseek", "model": "generator-model",
            "interaction_id": "restart-canary", "transport_attempt": 1,
        },
    )

    fixture["repository"].recover_preparing_jobs()
    recovered = fixture["repository"].snapshot(revision_id, chapter_id)
    assert recovered["status"] == "PREPARING"
    assert recovered["prepare_stage"] == "QUEUED"
    assert recovered["sections_completed"] == 0
    assert recovered["sections_total"] == 0
    attempts = fixture["repository"].generation_attempts(revision_id, chapter_id)
    assert len(attempts) == 1
    assert attempts[0]["status"] == "INTERRUPTED"
    assert attempts[0]["failure_kind"] == "INTERRUPTED"
    assert attempts[0]["failure_code"] == "service_restart"


@pytest.mark.parametrize(
    ("generation", "review", "validator", "stage", "code"),
    [
        (
            [ProviderFailure(ProviderFailureKind.UNCONFIGURED, "unconfigured", "AI off")],
            [], None, "GENERATION", "unconfigured",
        ),
        (["not-json", "still-not-json"], [], None, "GENERATION", "invalid_generation_output"),
        (None, "ACTIONABLE_FAIL", None, "REVIEW", "review_rejected"),
        (
            None,
            [ProviderFailure(ProviderFailureKind.TRANSIENT, "timeout", "review timeout")],
            None, "REVIEW", "timeout",
        ),
        (None, ["not-json", "still-not-json"], None, "REVIEW", "invalid_review_output"),
        (None, None, lambda _points: (_ for _ in ()).throw(ValueError("bad")), "DETERMINISTIC_VALIDATION", "deterministic_validation_failed"),
    ],
)
def test_pipeline_failures_never_publish_partial_ready(
    service, generation, review, validator, stage, code
):
    base = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in base["sections"]]
    if review == "ACTIONABLE_FAIL":
        rejection = review_answer(
            "FAIL", "范围不足",
            [blocking_finding(
                "major_learning_coverage", candidate_indices=[],
                evidence_section_ids=[section_ids[0]],
                repair_section_ids=[section_ids[0]], detail="第一节缺少主要学习内容。",
            )],
        )
        review = [rejection, rejection]
    runtime = ScriptedRuntime(
        generation_scripts(section_ids, first_override=generation, repeats=2),
        review if review is not None else [review_answer("PASS", "通过")],
    )
    base["knowledge"] = KnowledgeService(
        service, base["foundation"], base["outline"], base["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
        post_review_validator=validator,
    )
    revision_id = base["revision"]["id"]
    chapter_id = base["chapter"]["outline_node_id"]
    base["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(base)
    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == stage
    assert failed["failure_code"] == code
    assert failed["knowledge_points"] == []
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM knowledge_points").fetchone()[0] == 0


def test_range_failure_retry_and_book_cascade_without_learning_writes(service):
    fixture = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in fixture["sections"]]
    bad = generation_answer(
        section_ids[0], 0, start_ref="p1:l0", end_ref="p0:l2"
    )
    runtime = ScriptedRuntime(
        {
            section_ids[0]: [bad, generation_answer(section_ids[0], 0)],
            section_ids[1]: [
                generation_answer(section_ids[1], 1),
                generation_answer(section_ids[1], 1),
            ],
        },
        [review_answer("PASS", "通过")],
    )
    fixture["knowledge"] = KnowledgeService(
        service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    failed = claim_and_run(fixture)
    assert failed["status"] == "FAILED"
    assert failed["failure_stage"] == "RANGE_RESOLUTION"
    retry, created = fixture["knowledge"].request_prepare(revision_id, chapter_id)
    assert not created and retry["status"] == "PREPARING"
    ready = claim_and_run(fixture)
    assert ready["status"] == "READY"

    other = service.intake(
        BytesIO(make_pdf()), content_length=len(make_pdf()),
        filename="other.pdf", title="另一本书",
    )["book"]
    service.delete_book(fixture["book"]["id"])
    with service.database.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM chapter_preparations WHERE book_source_revision_id = ?",
            (revision_id,),
        ).fetchone()[0] == 0
        assert connection.execute(
            "SELECT COUNT(*) FROM knowledge_points WHERE book_source_revision_id = ?",
            (revision_id,),
        ).fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM books WHERE id = ?", (other["id"],)).fetchone()[0] == 1
        tables = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    forbidden = {
        "kp_status", "section_learning_state", "learning_events", "master_threads",
        "master_topics", "master_messages", "teaching_assets", "exam_evidence",
    }
    assert tables.isdisjoint(forbidden)


def test_running_chapter_job_converges_when_book_delete_wins(service):
    base = build_fixture(service)
    section_ids = [section["outline_node_id"] for section in base["sections"]]
    entered = threading.Event()
    release = threading.Event()

    class BlockingRuntime(ScriptedRuntime):
        def complete_for_with_metadata(
            self, provider, messages, *, interaction_id=None, max_tokens=None,
            attempt_observer=None,
        ):
            if provider == "deepseek":
                entered.set()
                if not release.wait(5):
                    raise AssertionError("book-delete race was not released")
            return super().complete_for_with_metadata(
                provider, messages, interaction_id=interaction_id, max_tokens=max_tokens,
                attempt_observer=attempt_observer,
            )

    runtime = BlockingRuntime(
        generation_scripts(section_ids),
        [review_answer("PASS", "通过")],
    )
    base["knowledge"] = KnowledgeService(
        service, base["foundation"], base["outline"], base["repository"], runtime,
        generator_provider="deepseek", reviewer_provider="zhipu",
    )
    revision_id = base["revision"]["id"]
    chapter_id = base["chapter"]["outline_node_id"]
    base["knowledge"].request_prepare(revision_id, chapter_id)
    job = base["jobs"].claim()
    assert job is not None and job["job_type"] == "CHAPTER_PREPARE"

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(base["knowledge"].run_job, job)
        try:
            assert entered.wait(2)
            service.delete_book(base["book"]["id"])
        finally:
            release.set()
        result = future.result(timeout=5)

    assert result["status"] == "CANCELLED"
    base["jobs"].complete(job["id"])
    with service.database.connect() as connection:
        for table in ("chapter_preparations", "knowledge_points", "jobs"):
            assert connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE book_source_revision_id = ?",
                (revision_id,),
            ).fetchone()[0] == 0


def test_atomic_publication_rollback_keeps_draft_ids_invisible(service):
    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    fixture["knowledge"].request_prepare(revision_id, chapter_id)
    resolved = fixture["outline"].resolve_chapter_physical(revision_id, chapter_id)
    chapter = resolved["chapter"]
    state = fixture["repository"].snapshot(revision_id, chapter_id)
    fixture["repository"].update_dependencies(
        revision_id, chapter_id, state["attempt_id"], foundation_version=1,
        identity_revision=chapter["identity_revision"],
        physical_revision=chapter["physical_revision"],
    )
    section_id = fixture["sections"][0]["outline_node_id"]
    points = [
        {
            "primary_section_id": section_id, "title": f"KP {index}",
            "one_sentence_definition": "定义", "start_page": 0,
            "start_y": 0.3 + index * 0.01, "end_page": 0,
            "end_y": 0.305 + index * 0.01,
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
            revision_id, chapter_id, state["attempt_id"], foundation_version=1,
            identity_revision=chapter["identity_revision"],
            physical_revision=chapter["physical_revision"], points=points,
            generator_provider="deepseek", generator_model="generator-model",
            reviewer_provider="zhipu", reviewer_model="reviewer-model",
            review_summary="通过", source_payload_sha256="a" * 64,
            review_payload_sha256="b" * 64,
        )
    snapshot = fixture["repository"].snapshot(revision_id, chapter_id)
    assert snapshot["status"] == "PREPARING"
    assert snapshot["structure_version"] == 0
    assert snapshot["knowledge_points"] == []
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM knowledge_points").fetchone()[0] == 0


def test_knowledge_map_http_contract_exposes_no_partial_draft(service):
    from test_api import request_json, running_server

    fixture = build_fixture(service)
    revision_id = fixture["revision"]["id"]
    chapter_id = fixture["chapter"]["outline_node_id"]
    coordinator = PreparationCoordinator(
        service, fixture["foundation"], fixture["jobs"],
        outline=fixture["outline"], knowledge=fixture["knowledge"],
    )
    path = f"/api/revisions/{revision_id}/chapters/{chapter_id}/knowledge-map"
    with running_server(
        service, preparation=coordinator, outline=fixture["outline"],
        knowledge=fixture["knowledge"],
    ) as (base, token):
        status, snapshot = request_json(f"{base}{path}", token)
        assert status == 200 and snapshot["status"] == "NOT_PREPARED"
        status, requested = request_json(
            f"{base}{path}/prepare", token, method="POST", data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        assert status == 202
        assert requested["chapter_map"]["status"] == "PREPARING"
        assert requested["chapter_map"]["knowledge_points"] == []
        ready = claim_and_run(fixture)
        assert ready["status"] == "READY"
        status, published = request_json(f"{base}{path}", token)
        assert status == 200 and len(published["knowledge_points"]) == 2
        status, inspection = request_json(f"{base}{path}/inspection", token)
        assert status == 200 and inspection["attempts"][-1]["outcome"] == "READY"


def test_migrations_8_and_9_preserve_existing_assets_and_add_safe_kp_progress(tmp_path):
    path = tmp_path / "upgrade.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, sql in MIGRATIONS:
        if version >= 8:
            break
        connection.executescript(sql)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
    connection.execute(
        "INSERT INTO books(id, title, status, created_at) VALUES ('book', '旧书', 'ACTIVE', 't')"
    )
    connection.execute(
        """
        INSERT INTO book_source_revisions(
            id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
            label, status, created_at, foundation_version
        ) VALUES ('revision', 'book', ?, 10, 1, '[]', '初版', 'ACTIVE', 't', 1)
        """,
        ("a" * 64,),
    )
    connection.execute(
        """
        INSERT INTO outline_nodes(
            outline_node_id, book_source_revision_id, identity_revision,
            parent_id, depth, order_index, kind, title, printed_label_hint,
            start_page, start_y, end_page, end_y, resolution_state,
            physical_revision, confidence, evidence_json
        ) VALUES ('chapter', 'revision', 1, NULL, 0, 0, 'CHAPTER', '第1章',
                  NULL, 0, NULL, NULL, NULL, 'PARTIAL', 1, 1, '{}')
        """
    )
    connection.execute(
        """
        INSERT INTO annotations(
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, save_intent_id, provenance_json,
            source_grounding_json, review_provider, review_model,
            review_failure_kind, review_code, review_summary, reviewed_at, created_at
        ) VALUES ('note', 'revision', 0, 'TEXT', '[]', '原文', '', '', 1,
                  '旧笔记', 'YELLOW', 'USER', NULL, 'OK', NULL, NULL, NULL,
                  NULL, NULL, NULL, NULL, NULL, NULL, NULL, 't')
        """
    )
    connection.execute(
        """
        INSERT INTO jobs(
            id, job_type, book_source_revision_id, page_start, page_end,
            foundation_version, status, priority, cancel_requested,
            attempts, created_at, updated_at
        ) VALUES ('page-job', 'PAGE_PREPARE', 'revision', 0, 0, 1,
                  'QUEUED', 9, 0, 2, 't', 't')
        """
    )
    connection.commit()
    connection.close()

    Database(path).initialize()
    upgraded = sqlite3.connect(path)
    try:
        assert upgraded.execute("SELECT title, status FROM books WHERE id = 'book'").fetchone() == ("旧书", "ACTIVE")
        assert upgraded.execute(
            "SELECT outline_node_id, title, identity_revision, physical_revision FROM outline_nodes"
        ).fetchone() == ("chapter", "第1章", 1, 1)
        assert upgraded.execute(
            "SELECT id, quote, body, source_kind FROM annotations"
        ).fetchone() == ("note", "原文", "旧笔记", "USER")
        assert upgraded.execute(
            "SELECT id, job_type, page_start, attempts FROM jobs"
        ).fetchone() == ("page-job", "PAGE_PREPARE", 0, 2)
        preparation_columns = {
            row[1] for row in upgraded.execute("PRAGMA table_info(chapter_preparations)")
        }
        assert {"prepare_stage", "sections_completed", "sections_total"}.issubset(
            preparation_columns
        )
        assert upgraded.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chapter_generation_attempts'"
        ).fetchone() == (1,)
        assert upgraded.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone() == (9,)
        assert upgraded.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        upgraded.close()
