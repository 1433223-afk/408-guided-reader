"""Only the source-specific Practice demo's durable state and answer boundary."""

import pytest

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
