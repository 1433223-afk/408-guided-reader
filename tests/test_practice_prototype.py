"""Only the source-specific Practice demo's durable state and answer boundary."""

import pytest

import reader_service.library.database as database_module
from reader_service.library.database import Database
from reader_service.practice_prototype import PracticePrototype, SOURCE_SHA256


def _revision(database, revision_id, source_hash):
    with database.connect() as connection:
        connection.execute(
            "INSERT INTO books(id, title, status, created_at) VALUES (?, 'sample', 'ACTIVE', 'now')",
            (revision_id,),
        )
        connection.execute(
            """INSERT INTO book_source_revisions
               (id, book_id, blob_sha256, byte_size, page_count, page_geometry_json, label, status, created_at)
               VALUES (?, ?, ?, 1, 23, '[]', 'sample', 'ACTIVE', 'now')""",
            (revision_id, revision_id, source_hash),
        )


def test_practice_state_survives_reopen_and_keeps_last_and_ever_correct(tmp_path):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    _revision(database, "supported", SOURCE_SHA256)
    _revision(database, "other", "f" * 64)
    practice = PracticePrototype(database)

    assert practice.list("supported") == []
    assert practice.list_favorites() == []
    assert practice.set_favorite("supported", 1, True) == {
        "number": 1, "attempt_count": 0, "last_correct": None, "last_choice": None,
        "ever_correct": False, "favorite": True,
    }
    favorite = practice.list_favorites()[0]
    assert (favorite["book_id"], favorite["source_kind"], favorite["source"]["number"]) == ("supported", "PRACTICE", 1)
    assert favorite["source"]["attempt_count"] == 0
    wrong = practice.attempt("supported", 1, "A")
    assert (wrong["attempt_count"], wrong["last_correct"], wrong["last_choice"], wrong["ever_correct"], wrong["favorite"]) == (1, False, "A", False, True)
    right = practice.attempt("supported", 1, "D")
    assert (right["attempt_count"], right["last_correct"], right["ever_correct"]) == (2, True, True)
    again = practice.attempt("supported", 1, "B")
    assert (again["attempt_count"], again["last_correct"], again["ever_correct"]) == (3, False, True)

    reopened = PracticePrototype(Database(database.path))
    assert reopened.list("supported") == [again]
    assert reopened.list_favorites()[0]["source"]["attempt_count"] == 3
    assert reopened.set_favorite("supported", 1, False)["favorite"] is False
    assert reopened.list_favorites() == []
    with pytest.raises(LookupError):
        reopened.list("other")
    with pytest.raises(LookupError):
        reopened.attempt("other", 1, "D")
    with pytest.raises(ValueError):
        reopened.attempt("supported", 17, "A")
    with pytest.raises(ValueError):
        reopened.set_favorite("supported", 1, "yes")


def test_second_section_uses_distinct_ids_and_favorites(tmp_path):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    _revision(database, "supported", SOURCE_SHA256)
    practice = PracticePrototype(database)
    assert practice.attempt("supported", 101, "A")["last_correct"] is True
    assert practice.attempt("supported", 101, "B")["last_correct"] is False
    assert practice.attempt("supported", 115, "C")["last_correct"] is True
    assert practice.attempt("supported", 1, "D")["last_correct"] is True
    practice.set_favorite("supported", 101, True)
    favorite = PracticePrototype(Database(database.path)).list_favorites()[0]
    assert favorite["source"]["number"] == 101
    assert favorite["source"]["label"] == 1
    assert favorite["source"]["pdf_page_index"] == 227
    assert favorite["source"]["exercise_title"] == "5.2.4 本节习题精选"
    assert len(practice.list("supported")) == 3
    assert practice.attempt("supported", 109, "A")["last_correct"] is True
    practice.set_favorite("supported", 109, True)
    cross_page = next(item for item in practice.list_favorites() if item["source"]["number"] == 109)
    assert cross_page["source"]["label"] == 9
    assert cross_page["source"]["pdf_page_index"] == 227


def test_second_section_migration_preserves_existing_practice_and_review(tmp_path, monkeypatch):
    path = tmp_path / "state.sqlite3"
    all_migrations = database_module.MIGRATIONS
    monkeypatch.setattr(database_module, "MIGRATIONS", all_migrations[:-2])
    database = Database(path)
    database.initialize()
    _revision(database, "supported", SOURCE_SHA256)
    practice = PracticePrototype(database)
    practice.attempt("supported", 1, "D")
    practice.set_favorite("supported", 1, True)
    with database.connect() as connection:
        connection.execute(
            "INSERT INTO practice_review_threads(id, book_source_revision_id, question_number) "
            "VALUES ('thread', 'supported', 1)"
        )
        connection.execute(
            """INSERT INTO practice_review_messages
               (id, thread_id, intent_id, role, content, state)
               VALUES ('message', 'thread', 'intent', 'user', '为什么？', 'COMPLETE')"""
        )
    monkeypatch.setattr(database_module, "MIGRATIONS", all_migrations)
    database.initialize()
    assert practice.list("supported")[0]["favorite"] is True
    assert practice.attempt("supported", 101, "A")["last_correct"] is True
    with database.connect() as connection:
        assert connection.execute("SELECT content FROM practice_review_messages WHERE id='message'").fetchone()[0] == "为什么？"
        assert connection.execute("PRAGMA foreign_key_check").fetchone() is None


def test_cross_page_migration_preserves_second_section_state_and_review(tmp_path, monkeypatch):
    path = tmp_path / "state.sqlite3"
    migrations = database_module.MIGRATIONS
    monkeypatch.setattr(database_module, "MIGRATIONS", migrations[:-2])
    database = Database(path)
    database.initialize()
    _revision(database, "supported", SOURCE_SHA256)
    practice = PracticePrototype(database)
    practice.attempt("supported", 108, "B")
    practice.set_favorite("supported", 108, True)
    with database.connect() as connection:
        connection.execute("INSERT INTO practice_review_threads(id, book_source_revision_id, question_number) "
                           "VALUES ('thread', 'supported', 108)")
        connection.execute("INSERT INTO practice_review_messages(id, thread_id, intent_id, role, content, state) "
                           "VALUES ('message', 'thread', 'intent', 'user', '为什么？', 'COMPLETE')")
    monkeypatch.setattr(database_module, "MIGRATIONS", migrations)
    database.initialize()
    assert practice.attempt("supported", 109, "A")["last_correct"] is True
    assert practice.list_favorites()[0]["source"]["number"] == 108
    with database.connect() as connection:
        assert connection.execute("SELECT content FROM practice_review_messages WHERE id='message'").fetchone()[0] == "为什么？"
        assert connection.execute("PRAGMA foreign_key_check").fetchone() is None


def test_automatic_catalog_migration_preserves_old_ids_and_review(tmp_path, monkeypatch):
    path = tmp_path / "state.sqlite3"
    migrations = database_module.MIGRATIONS
    monkeypatch.setattr(database_module, "MIGRATIONS", migrations[:-1])
    database = Database(path)
    database.initialize()
    _revision(database, "supported", SOURCE_SHA256)
    practice = PracticePrototype(database)
    practice.attempt("supported", 109, "A")
    practice.set_favorite("supported", 109, True)
    with database.connect() as connection:
        connection.execute("INSERT INTO practice_review_threads(id, book_source_revision_id, question_number) "
                           "VALUES ('thread', 'supported', 109)")
        connection.execute("INSERT INTO practice_review_messages(id, thread_id, intent_id, role, content, state) "
                           "VALUES ('message', 'thread', 'intent', 'user', '为什么？', 'COMPLETE')")
    monkeypatch.setattr(database_module, "MIGRATIONS", migrations)
    database.initialize()
    assert path.with_name("state.sqlite3.pre-migration-24.bak").exists()
    assert practice.list("supported")[0]["number"] == 109
    assert practice.list("supported")[0]["favorite"] is True
    with database.connect() as connection:
        assert connection.execute("SELECT content FROM practice_review_messages WHERE id='message'").fetchone()[0] == "为什么？"
        assert connection.execute("PRAGMA foreign_key_check").fetchone() is None
