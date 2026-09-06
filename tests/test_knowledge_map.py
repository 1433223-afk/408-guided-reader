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
        self.answers = {"deepseek": list(generation), "zhipu": list(review)}
        self.calls = []
        self._lock = threading.Lock()

    def provider_identity(self, provider):
        if provider not in self.answers:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED, "unknown_provider", "provider unavailable"
            )
        return provider, {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider]

    def complete_for_with_metadata(
        self, provider, messages, *, interaction_id=None, max_tokens=None
    ):
        with self._lock:
            self.calls.append(
                {"provider": provider, "messages": json.loads(json.dumps(messages)),
                 "interaction_id": interaction_id, "max_tokens": max_tokens}
            )
            if not self.answers[provider]:
                raise AssertionError(f"No scripted answer for {provider}")
            answer = self.answers[provider].pop(0)
        if isinstance(answer, Exception):
            raise answer
        return ProviderCompletion(
            answer=answer, latency_ms=1, usage={"fixture": True},
            effective_config={
                "provider": provider,
                "model": {"deepseek": "generator-model", "zhipu": "reviewer-model"}[provider],
            },
        )


def generation_answer(section_ids: list[str]) -> str:
    return json.dumps(
        {
            "knowledge_points": [
                {
                    "draft_key": "private-a",
                    "primary_section_id": section_ids[0],
                    "title": "核心概念 A",
                    "one_sentence_definition": "第一节中值得独立理解的核心概念。",
                    "start_ref": "p0:l2",
                    "end_ref": "p1:l0",
                },
                {
                    "draft_key": "private-b",
                    "primary_section_id": section_ids[1],
                    "title": "核心概念 B",
                    "one_sentence_definition": "第二节中值得独立理解的核心概念。",
                    "start_ref": "p2:l1",
                    "end_ref": "p3:l0",
                },
            ]
        },
        ensure_ascii=False,
    )


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
        [generation_answer([node["outline_node_id"] for node in sections])],
        [json.dumps({"verdict": "PASS", "summary": "结构与来源范围通过。"}, ensure_ascii=False)],
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
        "generation_provenance",
    }
    encoded = json.dumps(inspections, ensure_ascii=False)
    assert "CANARY_OTHER_CHAPTER" not in encoded
    assert all(call["provider"] == expected for call, expected in zip(
        fixture["runtime"].calls, ["deepseek", "zhipu"]
    ))
    assert [call["max_tokens"] for call in fixture["runtime"].calls] == [12_288, 12_288]

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


@pytest.mark.parametrize(
    ("generation", "review", "validator", "stage", "code"),
    [
        (
            [ProviderFailure(ProviderFailureKind.UNCONFIGURED, "unconfigured", "AI off")],
            [], None, "GENERATION", "unconfigured",
        ),
        (["not-json", "still-not-json"], [], None, "GENERATION", "invalid_generation_output"),
        (None, [json.dumps({"verdict": "FAIL", "summary": "范围不足"}, ensure_ascii=False)], None, "REVIEW", "review_rejected"),
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
    runtime = ScriptedRuntime(
        generation if generation is not None else [generation_answer(section_ids)],
        review if review is not None else [json.dumps({"verdict": "PASS", "summary": "通过"}, ensure_ascii=False)],
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
    bad = json.loads(generation_answer(section_ids))
    bad["knowledge_points"][1]["primary_section_id"] = section_ids[0]
    runtime = ScriptedRuntime(
        [json.dumps(bad, ensure_ascii=False), generation_answer(section_ids)],
        [json.dumps({"verdict": "PASS", "summary": "通过"}, ensure_ascii=False)],
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
            self, provider, messages, *, interaction_id=None, max_tokens=None
        ):
            if provider == "deepseek":
                entered.set()
                if not release.wait(5):
                    raise AssertionError("book-delete race was not released")
            return super().complete_for_with_metadata(
                provider, messages, interaction_id=interaction_id, max_tokens=max_tokens
            )

    runtime = BlockingRuntime(
        [generation_answer(section_ids)],
        [json.dumps({"verdict": "PASS", "summary": "通过"}, ensure_ascii=False)],
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


def test_migration_8_preserves_existing_book_outline_annotation_and_page_job(tmp_path):
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
        assert upgraded.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        upgraded.close()
