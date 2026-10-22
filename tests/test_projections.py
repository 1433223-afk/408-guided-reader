import sqlite3
import threading

import pytest

from reader_service.library.database import Database


@pytest.fixture
def database(tmp_path):
    db = Database(tmp_path / "cache.sqlite3")
    with db.connect() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("CREATE TABLE source(value TEXT)")
        c.execute("CREATE TABLE state(value TEXT)")
        c.execute("INSERT INTO source VALUES ('original')")
    return db


def read(db, calls):
    def build(c):
        calls.append(True)
        return [{"text": c.execute("SELECT value FROM source").fetchone()[0]}]
    return db.projections.get("test", {"source"}, build, db.connect)


def test_views_refresh_after_source_writes_but_not_unrelated_state(database):
    calls = []
    assert read(database, calls)[0]["text"] == "original"
    with database.connect() as c:
        c.execute("INSERT INTO state VALUES ('favorite')")
    assert read(database, calls)[0]["text"] == "original"
    assert len(calls) == 1
    with database.connect() as c:
        c.execute("UPDATE source SET value='changed'")
    assert read(database, calls)[0]["text"] == "changed"
    assert len(calls) == 2


def test_failed_writes_do_not_invalidate_or_publish_uncommitted_values(database):
    calls = []
    read(database, calls)
    with pytest.raises(ValueError):
        with database.connect() as c:
            c.execute("UPDATE source SET value='uncommitted'")
            raise ValueError("rollback")
    assert read(database, calls) == [{"text": "original"}]
    assert len(calls) == 1


def test_external_database_writes_invalidate_cached_data(database):
    calls = []
    read(database, calls)
    with sqlite3.connect(database.path) as c:
        c.execute("UPDATE source SET value='external'")
    assert read(database, calls)[0]["text"] == "external"
    assert len(calls) == 2


def test_returned_data_cannot_poison_another_request_and_cache_is_bounded(database):
    calls = []
    value = read(database, calls)
    value[0]["text"] = "tampered"
    assert read(database, calls)[0]["text"] == "original"
    for i in range(30):
        database.projections.get(i, {"source"}, lambda c: [i], database.connect)
    assert len(database.projections.views) == database.projections.capacity


def test_reader_and_writer_publish_without_stale_cache_or_deadlock(database):
    entered, resume = threading.Event(), threading.Event()
    results, errors = [], []

    def build(c):
        value = c.execute("SELECT value FROM source").fetchone()[0]
        entered.set()
        assert resume.wait(3)
        return value

    def reader():
        try:
            results.append(database.projections.get("concurrent", {"source"}, build, database.connect))
        except Exception as e:
            errors.append(e)

    def writer():
        try:
            with database.connect() as c:
                c.execute("UPDATE source SET value='next'")
        except Exception as e:
            errors.append(e)

    a = threading.Thread(target=reader)
    a.start()
    assert entered.wait(3)
    b = threading.Thread(target=writer)
    b.start()
    resume.set()
    a.join(3); b.join(3)
    assert not a.is_alive() and not b.is_alive() and not errors
    assert results == ["original"]
    assert read(database, [])[0]["text"] == "next"
