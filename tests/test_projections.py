import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor

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


@pytest.mark.parametrize("table", ["source", "state"])
def test_cold_build_does_not_block_writes_and_does_not_publish_an_old_snapshot(database, table):
    entered, resume, committed = threading.Event(), threading.Event(), threading.Event()

    def build(c):
        value = c.execute("SELECT value FROM source").fetchone()[0]
        entered.set()
        assert resume.wait(3)
        return [{"text": value}]

    def writer():
        with database.connect() as c:
            if table == "source":
                c.execute("UPDATE source SET value='next'")
            else:
                c.execute("INSERT INTO state VALUES ('favorite')")
        committed.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        reader = pool.submit(database.projections.get, "test", {"source"}, build, database.connect)
        assert entered.wait(3)
        writing = pool.submit(writer)
        try:
            assert committed.wait(3), "a cold projection held up a database commit"
        finally:
            resume.set()
        assert reader.result(3) == [{"text": "original"}]
        writing.result(3)
    # Even unrelated writes conservatively prevent caching an in-flight build;
    # already-cached, unrelated views remain reusable (covered above).
    assert "test" not in database.projections.views
    calls = []
    assert read(database, calls) == [{"text": "next" if table == "source" else "original"}]
    assert len(calls) == 1


def test_cold_build_does_not_block_a_cached_view_or_nested_build(database):
    calls = []
    read(database, calls)
    entered, resume = threading.Event(), threading.Event()

    def build(c):
        entered.set()
        assert resume.wait(3)
        return read(database, calls)

    with ThreadPoolExecutor(max_workers=2) as pool:
        cold = pool.submit(database.projections.get, "nested", {"source"}, build, database.connect)
        assert entered.wait(3)
        hit = pool.submit(read, database, calls)
        try:
            assert hit.result(3) == [{"text": "original"}]
        finally:
            resume.set()
        assert cold.result(3) == [{"text": "original"}]
    assert len(calls) == 1


def test_external_write_during_build_cannot_publish_old_snapshot(database):
    def build(c):
        old = c.execute("SELECT value FROM source").fetchone()[0]
        with sqlite3.connect(database.path) as external:
            external.execute("UPDATE source SET value='external'")
        # A WAL read transaction still sees its original snapshot.
        assert c.execute("SELECT value FROM source").fetchone()[0] == old
        return [{"text": old}]

    assert database.projections.get("test", {"source"}, build, database.connect) == [{"text": "original"}]
    assert "test" not in database.projections.views
    assert read(database, []) == [{"text": "external"}]


def test_slower_old_build_cannot_replace_a_newer_same_key_view(database):
    entered, resume = threading.Event(), threading.Event()

    def slow(c):
        old = c.execute("SELECT value FROM source").fetchone()[0]
        entered.set()
        assert resume.wait(3)
        return [{"text": old}]

    with ThreadPoolExecutor(max_workers=1) as pool:
        old = pool.submit(database.projections.get, "test", {"source"}, slow, database.connect)
        assert entered.wait(3)
        try:
            with database.connect() as c:
                c.execute("UPDATE source SET value='new'")
            assert read(database, []) == [{"text": "new"}]
        finally:
            resume.set()
        assert old.result(3) == [{"text": "original"}]
    assert read(database, []) == [{"text": "new"}]


def test_rollback_during_build_keeps_the_valid_snapshot_cacheable(database):
    def build(c):
        old = c.execute("SELECT value FROM source").fetchone()[0]
        with pytest.raises(ValueError):
            with database.connect() as writer:
                writer.execute("UPDATE source SET value='uncommitted'")
                raise ValueError("rollback")
        return [{"text": old}]

    assert database.projections.get("test", {"source"}, build, database.connect) == [{"text": "original"}]
    calls = []
    assert read(database, calls) == [{"text": "original"}]
    assert not calls


def test_failed_build_does_not_publish_and_nested_build_can_retry(database):
    def failed(c):
        read(database, [])
        raise ValueError("failed projection")

    with pytest.raises(ValueError, match="failed projection"):
        database.projections.get("nested", {"source"}, failed, database.connect)
    assert "nested" not in database.projections.views
    assert database.projections.get("nested", {"source"}, lambda c: read(database, []), database.connect)


def test_external_commit_just_after_our_commit_is_not_mistaken_for_our_write(database):
    read(database, [])

    class CommitWithExternalWrite:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, *args):
            return self.connection.execute(*args)

        def commit(self):
            self.connection.commit()
            with sqlite3.connect(database.path) as external:
                external.execute("UPDATE source SET value='external'")

    with sqlite3.connect(database.path) as writer:
        writer.execute("INSERT INTO state VALUES ('favorite')")
        database.projections.commit(CommitWithExternalWrite(writer), {"state"})
    assert read(database, []) == [{"text": "external"}]
