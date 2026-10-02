"""Exercise/KP linking is optional, scoped, cached and never a learning-state write."""

import json
import threading
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest

from reader_service.knowledge.repository import KnowledgeRepository
from reader_service.library.database import Database
from reader_service.practice_knowledge import PracticeKnowledgeService
from reader_service.practice_prototype import PracticePrototype
from test_practice_catalog import _line, _source
from test_api import request_json, running_server
from test_ask_about_this import runtime_set


class Runtime:
    def __init__(self, *, provider="deepseek", block=False):
        self.provider = provider
        self.calls = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self.block = block
        self.reply = None
        self.error = None

    def preferred_provider(self):
        return self.provider

    def provider_identity(self, provider):
        return provider, {"deepseek": "deepseek-flash", "zhipu": "GLM-5.3-Flash"}.get(provider, "unapproved")

    def complete_for_with_metadata(self, provider, messages, **options):
        payload = json.loads(messages[-1]["content"])
        self.calls.append((provider, payload, options))
        self.entered.set()
        if self.block:
            assert self.release.wait(5)
        if self.error:
            raise self.error
        answer = self.reply if self.reply is not None else json.dumps({"matches": [
            {"number": question["number"], "knowledge_point_id": "local-kp" if index == 0 else None}
            for index, question in enumerate(payload["exercises"])
        ]})
        return SimpleNamespace(answer=answer)


def add_point(database, point_id="local-kp", primary="section", order=0, version=1,
              *, revision="revision", chapter="chapter"):
    with database.connect() as connection:
        connection.execute(
            """INSERT INTO knowledge_points(
               knowledge_point_id,book_source_revision_id,chapter_outline_node_id,chapter_structure_version,
               primary_section_id,title,one_sentence_definition,order_index,start_page,start_y,
               end_page,end_y,source_foundation_version,created_at)
               VALUES (?,?,?,?,?,?,'教材中的概念边界。',?,0,.1,0,.2,1,'now')""",
            (point_id, revision, chapter, version, primary,
             "当前节的知识点" if primary == "section" else "邻节知识点", order),
        )


def copy_book(database, prefix, *, exercise_number="8.1.1", source_sha256=None):
    """A second real catalog in the same DB, with independent book/outline IDs."""
    identities = {name: f"{prefix}-{name}" for name in
                  ("book", "revision", "chapter", "section", "exercise", "answers", "next")}
    with database.connect() as connection:
        connection.execute("BEGIN")
        connection.execute("PRAGMA defer_foreign_keys=ON")
        for table, key, original in (
            ("books", "id", "book"), ("book_source_revisions", "id", "revision"),
            ("outline_nodes", "book_source_revision_id", "revision"),
            ("ocr_pages", "book_source_revision_id", "revision"),
            ("ocr_lines", "book_source_revision_id", "revision"),
            ("chapter_preparations", "book_source_revision_id", "revision"),
        ):
            for row in connection.execute(f"SELECT * FROM {table} WHERE {key}=?", (original,)).fetchall():
                values = {key: identities.get(value, value) for key, value in dict(row).items()}
                if table == "books":
                    values["title"] = f"{prefix} 自选教材"
                if table == "book_source_revisions" and source_sha256:
                    values["blob_sha256"] = source_sha256
                for key in ("title", "text"):
                    if key in values:
                        values[key] = values[key].replace("8.1.1", exercise_number)
                columns = ",".join(values)
                placeholders = ",".join("?" for _ in values)
                connection.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                                   tuple(values.values()))
    return identities


@pytest.fixture
def setup(tmp_path):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    _source(database)
    with database.connect() as connection:
        connection.execute(
            """INSERT INTO outline_nodes(outline_node_id,book_source_revision_id,parent_id,depth,order_index,
               kind,title,start_page,resolution_state,confidence,evidence_json)
               VALUES ('chapter','revision',NULL,0,2,'CHAPTER','第8章 示例',0,'RESOLVED',1,'{}')""",
        )
        connection.execute("UPDATE outline_nodes SET parent_id='chapter' WHERE outline_node_id IN ('section','next')")
        connection.execute(
            """INSERT INTO chapter_preparations(book_source_revision_id,chapter_outline_node_id,status,
               foundation_version,chapter_identity_revision,chapter_physical_revision,structure_version,
               attempt_id,generator_provider,generator_model,reviewer_provider,reviewer_model,
               requested_at,updated_at,published_at)
               VALUES ('revision','chapter','READY',1,1,1,1,'attempt','deepseek','deepseek-flash',
                       'deepseek','deepseek-flash','now','now','now')""",
        )
        for ordinal, text, y in (
            (2, '02. 哪项属于另一概念？', .3), (3, 'A. 甲 B. 乙', .35),
            (4, 'C. 丙 D. 丁', .4),
        ):
            _line(connection, 1, ordinal, text, y)
        _line(connection, 2, 3, '02. B', .4)
        _line(connection, 2, 4, '乙符合另一个条件。', .45)
    practice = PracticePrototype(database)
    section = practice.catalog("revision")[0]
    assert len(section["questions"]) == 2
    return database, practice, section


def finish(service):
    worker = service._worker
    if worker:
        worker.join(timeout=5)
        assert not worker.is_alive()


def test_section_batch_is_nonblocking_deduplicated_and_reuses_positive_and_null(setup):
    database, practice, section = setup
    add_point(database)
    add_point(database, "neighbor-kp", "next", 1)
    runtime = Runtime(block=True)
    service = PracticeKnowledgeService(practice, runtime)
    result = service.request("revision", {"section_id": section["id"]})
    assert result == {"section_id": section["id"], "matches": [], "pending": True}
    assert runtime.entered.wait(3)
    assert service.request("revision", {"section_id": section["id"]})["pending"]
    assert service.snapshot("revision", section["id"])["pending"]
    assert len(runtime.calls) == 1
    numbers = [question["number"] for question in section["questions"]]
    # Selection/submission is independent of the still-running matching call.
    assert practice.attempt("revision", numbers[0], "A")["last_correct"] is True
    runtime.release.set()
    finish(service)
    snapshot = service.snapshot("revision", section["id"])
    assert snapshot["pending"] is False
    matches = {item["number"]: item["knowledge_point"] for item in snapshot["matches"]}
    assert matches[numbers[0]]["id"] == "local-kp"
    assert matches[numbers[0]]["title"] == "当前节的知识点"
    assert matches[numbers[0]]["start_page"] == 0
    assert matches[numbers[1]] is None
    provider, payload, options = runtime.calls[0]
    assert provider == "deepseek" and options["thinking_mode"] == "disabled"
    assert "json_object" not in options
    assert {item["number"] for item in payload["exercises"]} == set(numbers)
    assert [item["id"] for item in payload["candidates"]] == ["local-kp"]
    sent = json.dumps(payload, ensure_ascii=False)
    assert "official_answer" not in sent and "explanation" not in sent and "符合条件" not in sent
    fresh = PracticeKnowledgeService(practice, Runtime())
    assert fresh.request("revision", {"section_id": section["id"]}) == snapshot
    assert fresh.runtime.calls == []
    with database.connect() as connection:
        assert not KnowledgeRepository._has_kp_linked_user_asset_connection(connection, "revision", "chapter")
        assert connection.execute("SELECT COUNT(*) FROM practice_knowledge_matches").fetchone()[0] == 2
    assert KnowledgeRepository(database).snapshot("revision", "chapter")["regeneration_allowed"] is True


def test_empty_candidates_are_cached_but_new_kp_invalidates_nulls(setup):
    database, practice, section = setup
    runtime = Runtime()
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert all(item["knowledge_point"] is None for item in service.snapshot("revision", section["id"])["matches"])
    assert runtime.calls == []
    add_point(database)
    assert service.snapshot("revision", section["id"])["matches"] == []
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert len(runtime.calls) == 1
    assert len(service.snapshot("revision", section["id"])["matches"]) == 2


def test_arbitrary_imported_book_and_section_use_their_own_published_candidates(setup):
    database, practice, _ = setup
    add_point(database)
    ids = copy_book(database, "uploaded-independent", exercise_number="17.4.2", source_sha256="a" * 64)
    add_point(database, "imported-kp", ids["section"], revision=ids["revision"], chapter=ids["chapter"])
    add_point(database, "imported-neighbor", ids["next"], 1,
              revision=ids["revision"], chapter=ids["chapter"])
    section = practice.catalog(ids["revision"])[0]
    assert section["id"] == ids["exercise"]
    assert section["title"] == "17.4.2 本节习题精选"
    runtime = Runtime()
    runtime.reply = json.dumps({"matches": [
        {"number": item["number"], "knowledge_point_id": "imported-kp" if index == 0 else None}
        for index, item in enumerate(section["questions"])
    ]})
    service = PracticeKnowledgeService(practice, runtime)
    service.request(ids["revision"], {"section_id": section["id"]})
    finish(service)
    assert [point["id"] for point in runtime.calls[0][1]["candidates"]] == ["imported-kp"]
    result = service.snapshot(ids["revision"], section["id"])
    assert {item["knowledge_point"] and item["knowledge_point"]["id"] for item in result["matches"]} == {
        "imported-kp", None,
    }
    fresh = PracticeKnowledgeService(practice, Runtime())
    assert fresh.request(ids["revision"], {"section_id": section["id"]}) == result
    assert fresh.runtime.calls == []
    with database.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM practice_knowledge_matches WHERE book_source_revision_id='revision'",
        ).fetchone()[0] == 0


def test_two_books_with_same_legacy_section_and_question_ids_keep_caches_isolated(setup):
    database, practice, _ = setup
    first = copy_book(database, "first", exercise_number="1.2.6")
    second = copy_book(database, "second", exercise_number="1.2.6")
    catalogs = [practice.catalog(ids["revision"])[0] for ids in (first, second)]
    assert [section["id"] for section in catalogs] == ["126", "126"]
    assert [question["number"] for question in catalogs[0]["questions"]] == [
        question["number"] for question in catalogs[1]["questions"]]
    runtime = Runtime()
    service = PracticeKnowledgeService(practice, runtime)
    for ids, section in zip((first, second), catalogs):
        point_id = f"{ids['book']}-kp"
        add_point(database, point_id, ids["section"], revision=ids["revision"], chapter=ids["chapter"])
        # The other book's matching rows must never appear before this book runs.
        assert service.snapshot(ids["revision"], "126")["matches"] == []
        runtime.reply = json.dumps({"matches": [
            {"number": item["number"], "knowledge_point_id": point_id if index == 0 else None}
            for index, item in enumerate(section["questions"])
        ]})
        service.request(ids["revision"], {"section_id": "126"})
        finish(service)
        assert [point["id"] for point in runtime.calls[-1][1]["candidates"]] == [point_id]
    assert len(runtime.calls) == 2
    fresh = PracticeKnowledgeService(practice, Runtime())
    for ids in (first, second):
        result = fresh.request(ids["revision"], {"section_id": "126"})
        assert not result["pending"]
        assert {item["knowledge_point"] and item["knowledge_point"]["id"] for item in result["matches"]} == {
            f"{ids['book']}-kp", None,
        }
    assert fresh.runtime.calls == []


@pytest.mark.parametrize("inconsistent", [None, "kp", "preparation"])
def test_book_foundation_bump_retains_consistent_published_map_only(setup, inconsistent):
    database, practice, section = setup
    add_point(database)
    with database.connect() as connection:
        # Preparing OCR elsewhere in the same PDF does not replace this READY map.
        connection.execute("UPDATE book_source_revisions SET foundation_version=2 WHERE id='revision'")
        if inconsistent == "kp":
            connection.execute("UPDATE knowledge_points SET source_foundation_version=2")
        elif inconsistent == "preparation":
            connection.execute("UPDATE chapter_preparations SET foundation_version=2")
    assert len(KnowledgeRepository(database).snapshot("revision", "chapter")["knowledge_points"]) == 1
    runtime = Runtime()
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    result = service.snapshot("revision", section["id"])
    if inconsistent:
        assert runtime.calls == []
        assert all(item["knowledge_point"] is None for item in result["matches"])
    else:
        assert len(runtime.calls) == 1
        assert [point["id"] for point in runtime.calls[0][1]["candidates"]] == ["local-kp"]
        assert any(item["knowledge_point"] and item["knowledge_point"]["id"] == "local-kp"
                   for item in result["matches"])


def test_current_section_excludes_another_published_chapter(setup):
    database, practice, section = setup
    add_point(database)
    with database.connect() as connection:
        for original, replacement, parent in (("chapter", "outside-chapter", None),
                                               ("section", "outside-section", "outside-chapter")):
            node = dict(connection.execute("SELECT * FROM outline_nodes WHERE outline_node_id=?",
                                           (original,)).fetchone())
            node.update(outline_node_id=replacement, parent_id=parent, order_index=99)
            connection.execute(f"INSERT INTO outline_nodes ({','.join(node)}) VALUES ({','.join('?' for _ in node)})",
                               tuple(node.values()))
        preparation = dict(connection.execute("SELECT * FROM chapter_preparations").fetchone())
        preparation["chapter_outline_node_id"] = "outside-chapter"
        connection.execute(
            f"INSERT INTO chapter_preparations ({','.join(preparation)}) VALUES ({','.join('?' for _ in preparation)})",
            tuple(preparation.values()),
        )
    add_point(database, "outside-kp", "outside-section", chapter="outside-chapter")
    runtime = Runtime()
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert [point["id"] for point in runtime.calls[0][1]["candidates"]] == ["local-kp"]


@pytest.mark.parametrize("invalid", ["malformed", "foreign", "missing", "duplicate", "wrong-type"])
def test_invalid_model_response_never_becomes_a_negative_cache_and_can_retry(setup, invalid):
    database, practice, section = setup
    add_point(database)
    add_point(database, "neighbor-kp", "next", 1)
    runtime = Runtime()
    decisions = [{"number": question["number"], "knowledge_point_id": None} for question in section["questions"]]
    if invalid == "foreign":
        decisions[0]["knowledge_point_id"] = "neighbor-kp"
    elif invalid == "missing":
        decisions.pop()
    elif invalid == "duplicate":
        decisions.append(decisions[0])
    elif invalid == "wrong-type":
        decisions[0]["knowledge_point_id"] = ["local-kp"]
    runtime.reply = "invalid JSON" if invalid == "malformed" else json.dumps({"matches": decisions})
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert service.snapshot("revision", section["id"]) == {"section_id": section["id"], "matches": [], "pending": False}
    assert len(runtime.calls) == 1  # snapshot never retries.
    runtime.reply = None
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert len(runtime.calls) == 2
    assert len(service.snapshot("revision", section["id"])["matches"]) == 2


def test_provider_failure_has_no_persisted_result_and_zhipu_only_can_retry(setup):
    database, practice, section = setup
    add_point(database)
    runtime = Runtime(provider="zhipu")
    runtime.error = TimeoutError()
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert service.snapshot("revision", section["id"])["matches"] == []
    runtime.error = None
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert len(runtime.calls) == 2
    assert runtime.calls[-1][2]["model"] == "GLM-5.3-Flash"
    assert runtime.calls[-1][2]["reasoning_effort"] == "low"


@pytest.mark.parametrize("provider", ["deepseek", "zhipu"])
def test_real_runtime_boundary_accepts_matching_request_for_each_approved_provider(setup, provider):
    database, practice, section = setup
    add_point(database)
    answer = json.dumps({"matches": [
        {"number": question["number"], "knowledge_point_id": "local-kp" if index == 0 else None}
        for index, question in enumerate(section["questions"])
    ]})
    runtime, adapters = runtime_set(
        bakeoff_enabled=False,
        keys={name: "in-memory-test-key" if name == provider else None
              for name in ("deepseek", "zhipu", "openrouter")},
        outcomes={provider: [answer]},
    )
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert len(adapters[provider].calls) == 1
    assert all(not adapter.calls for name, adapter in adapters.items() if name != provider)
    body = adapters[provider].calls[0]["body"]
    assert "response_format" not in body
    assert body["model"] == ("deepseek-flash" if provider == "deepseek" else "GLM-5.3-Flash")
    assert body.get("thinking") == ({"type": "disabled"} if provider == "deepseek" else None)
    assert body.get("reasoning_effort") == ("low" if provider == "zhipu" else None)
    snapshot = service.snapshot("revision", section["id"])
    assert not snapshot["pending"] and len(snapshot["matches"]) == 2
    assert sum(item["knowledge_point"] is not None for item in snapshot["matches"]) == 1


@pytest.mark.parametrize("change", ["source", "kp", "scope", "review"])
def test_source_or_candidate_changes_while_model_runs_reject_old_result(setup, change):
    database, practice, section = setup
    add_point(database)
    runtime = Runtime(block=True)
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    assert runtime.entered.wait(3)
    with database.connect() as connection:
        if change == "source":
            connection.execute("UPDATE ocr_lines SET text=replace(text,'哪项','以下哪项') WHERE book_source_revision_id='revision'")
        elif change == "kp":
            connection.execute("UPDATE knowledge_points SET title='更正的概念' WHERE knowledge_point_id='local-kp'")
        elif change == "scope":
            connection.execute("UPDATE outline_nodes SET physical_revision=2 WHERE outline_node_id='chapter'")
        else:
            connection.execute("UPDATE outline_nodes SET evidence_json=? WHERE outline_node_id='chapter'",
                               (json.dumps({"asset_review": {"structure_version": 1}}),))
    runtime.release.set()
    finish(service)
    assert service.snapshot("revision", section["id"])["matches"] == []
    with database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM practice_knowledge_matches").fetchone()[0] == 0


def test_completed_source_change_rematches_only_affected_question(setup):
    database, practice, section = setup
    add_point(database)
    service = PracticeKnowledgeService(practice, Runtime())
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    with database.connect() as connection:
        connection.execute("UPDATE ocr_lines SET text=replace(text,'另一概念','新概念') WHERE book_source_revision_id='revision'")
    snapshot = service.snapshot("revision", section["id"])
    assert len(snapshot["matches"]) == 1
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert len(service.runtime.calls[-1][1]["exercises"]) == 1
    assert service.runtime.calls[-1][1]["exercises"][0]["number"] == section["questions"][1]["number"]


def test_unapproved_provider_never_reaches_egress(setup):
    database, practice, section = setup
    add_point(database)
    runtime = Runtime(provider="openrouter")
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert runtime.calls == []
    assert service.snapshot("revision", section["id"])["matches"] == []


def test_deletion_cascades_machine_links_and_preserves_existing_practice_state(setup):
    database, practice, section = setup
    add_point(database)
    service = PracticeKnowledgeService(practice, Runtime())
    number = section["questions"][0]["number"]
    practice.attempt("revision", number, "A")
    practice.set_favorite("revision", number, True)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    with database.connect() as connection:
        connection.execute("DELETE FROM knowledge_points WHERE knowledge_point_id='local-kp'")
        assert connection.execute("SELECT COUNT(*) FROM practice_knowledge_matches WHERE knowledge_point_id IS NOT NULL").fetchone()[0] == 0
    assert practice.list("revision")[0]["favorite"] is True
    assert practice.list("revision")[0]["attempt_count"] == 1
    with database.connect() as connection:
        connection.execute("DELETE FROM books WHERE id='book'")
        assert connection.execute("SELECT COUNT(*) FROM practice_knowledge_matches").fetchone()[0] == 0


def test_chapter_level_exercise_candidates_stay_within_published_chapter(setup):
    database, practice, section = setup
    add_point(database)
    add_point(database, "neighbor-kp", "next", 1)
    add_point(database, "unpublished-kp", "section", 2, version=2)
    with database.connect() as connection:
        connection.execute("UPDATE outline_nodes SET parent_id='chapter',order_index=2 WHERE outline_node_id='exercise'")
        connection.execute("UPDATE outline_nodes SET parent_id='chapter',order_index=3 WHERE outline_node_id='answers'")
    runtime = Runtime()
    service = PracticeKnowledgeService(practice, runtime)
    service.request("revision", {"section_id": section["id"]})
    finish(service)
    assert {point["id"] for point in runtime.calls[0][1]["candidates"]} == {"local-kp", "neighbor-kp"}


def test_new_migration_preserves_existing_attempts_and_is_idempotent(setup):
    database, practice, section = setup
    number = section["questions"][0]["number"]
    before = practice.attempt("revision", number, "A")
    with database.connect() as connection:
        connection.execute("DROP TABLE practice_knowledge_matches")
        connection.execute("DELETE FROM schema_migrations WHERE version=25")
    database.initialize()
    database.initialize()
    assert practice.list("revision") == [before]
    with database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM practice_knowledge_matches").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchone() is None


def test_api_requires_auth_and_get_does_not_start_matching(service, monkeypatch):
    from reader_service import server as server_module
    calls = []
    class Matching:
        def snapshot(self, revision, section_id):
            calls.append(("read", revision, section_id))
            return {"section_id": section_id, "matches": [], "pending": False}
        def request(self, revision, payload):
            calls.append(("start", revision, payload))
            return {"section_id": payload["section_id"], "matches": [], "pending": True}
    monkeypatch.setattr(server_module, "PracticeKnowledgeService", lambda *_args: Matching())
    with running_server(service) as (base, token):
        url = f"{base}/api/revisions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/practice-prototype/knowledge-links"
        with pytest.raises(HTTPError) as denied:
            request_json(url, "", method="POST", data=b'{"section_id":"126"}',
                         headers={"Content-Type": "application/json"})
        assert denied.value.code == 401 and not calls
        status, snapshot = request_json(url + "?section_id=126", token)
        assert status == 200 and not snapshot["pending"] and calls[0][0] == "read"
        status, requested = request_json(url, token, method="POST", data=b'{"section_id":"126"}',
                                         headers={"Content-Type": "application/json"})
        assert status == 200 and requested["pending"] and calls[1][0] == "start"
