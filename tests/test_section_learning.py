import sqlite3
from unittest.mock import patch
from uuid import uuid4
from io import BytesIO

import pytest

from reader_service.learning.service import LearningService
from reader_service.library import database as db_module
from reader_service.library.database import Database
from test_learning import learning, idle
from test_api import running_server, request_json
from urllib.error import HTTPError
from conftest import make_pdf


def test_section_choices_durable_scope_and_clear_history(learning, service):
    f, master, runtime, points = learning
    rev = f['revision']['id']
    section = points[0]['primary_section_id']
    kp = points[0]['knowledge_point_id']
    master.repository.open(rev, kp)
    before = master.repository.entries(rev)
    opened = master.repository.open(rev, section)
    assert opened['point']['scope_kind'] == 'SECTION'
    assert 'knowledge_point_id' not in opened['point']
    assert opened['status'] == 'ANSWERED_HAS_UNCLEAR'
    assert opened['thread_id'] != master.snapshot(rev, kp)['thread_id']
    assert master.repository.open(rev, section) == opened
    after = master.repository.entries(rev)
    assert [(p['knowledge_point_id'], p['status']) for p in after['points']] == [(p['knowledge_point_id'], p['status']) for p in before['points']]
    runtime.fail = True
    master.send(rev, section, {'intent_id': 'section-one', 'question': '这一节如何联系起来？', 'review_mode': 'Standard'})
    idle(master)
    failed = master.snapshot(rev, section)
    assert failed['messages'][0]['state'] == 'FAILED'
    restarted = LearningService(service.database, f['foundation'], runtime)
    assert restarted.snapshot(rev, section) == failed
    runtime.fail = False
    restarted.retry(rev, section, failed['messages'][0]['id'])
    idle(restarted)
    replied = restarted.snapshot(rev, section)
    assert len(replied['messages']) == 2
    assert replied['messages'][-1]['review_state'] == 'PASS'
    source = runtime.calls[-1][1]['source']
    assert source['scope_kind'] == 'SECTION'
    assert source['section']['id'] == section
    assert {p['knowledge_point_id'] for p in source['knowledge_points']} == {p['knowledge_point_id'] for p in points if p['primary_section_id'] == section}
    assert replied['status'] == 'ANSWERED_HAS_UNCLEAR'
    with pytest.raises(LookupError):
        restarted.retry(rev, kp, replied['messages'][0]['id'])
    clear = restarted.repository.clear_section(rev, section)
    assert clear['status'] == 'ANSWERED_CLEAR'
    assert clear['topics'][0]['state'] == 'RESOLVED'
    assert clear['messages'] == replied['messages']
    statuses = restarted.repository.entries(rev)['points']
    for p in statuses:
        old = next(q for q in before['points'] if q['knowledge_point_id'] == p['knowledge_point_id'])
        assert p['status'] == ('UNDERSTOOD' if p['primary_section_id'] == section else old['status'])
    with service.database.connect() as c:
        events = [tuple(r) for r in c.execute('SELECT event_type,status FROM learning_events WHERE section_outline_node_id=? ORDER BY rowid', (section,))]
        assert events == [('SECTION_CHECK_HAS_UNCLEAR', 'ANSWERED_HAS_UNCLEAR'), ('SECTION_CHECK_CLEAR', 'ANSWERED_CLEAR')]
        count = c.execute('SELECT COUNT(*) FROM learning_events').fetchone()[0]
        assert c.execute('SELECT reading_reached_end_at FROM section_learning_states WHERE outline_node_id=?', (section,)).fetchone()[0] is None
    restarted.repository.clear_section(rev, section)
    with service.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM learning_events').fetchone()[0] == count
        with pytest.raises(sqlite3.IntegrityError):
            c.execute('DELETE FROM learning_events WHERE section_outline_node_id=?', (section,))
    reopened = restarted.repository.open(rev, section)
    assert reopened['status'] == 'ANSWERED_HAS_UNCLEAR'
    assert len(reopened['topics']) == 1
    assert reopened['topics'][0]['id'] == clear['topics'][0]['id']
    assert reopened['topics'][0]['state'] == 'ACTIVE'
    assert all(p['status'] == 'UNDERSTOOD' for p in restarted.repository.entries(rev)['points'] if p['primary_section_id'] == section)
    resolved_again = restarted.repository.confirm(rev, section, clear['topics'][0]['id'])
    assert resolved_again['status'] == 'ANSWERED_CLEAR'
    assert len(resolved_again['topics']) == 1
    assert resolved_again['topics'][0]['state'] == 'RESOLVED'
    pdf = make_pdf(((420, 600),))
    sibling = service.intake(BytesIO(pdf), content_length=len(pdf), filename='sibling.pdf')['book']['active_revision']
    service.delete_book(f['book']['id'])
    assert service.revision(sibling['id'])
    with service.database.connect() as c:
        for table in ('master_threads', 'master_topics', 'master_messages', 'kp_status', 'learning_events', 'section_learning_states'):
            assert c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0


def test_section_clear_rolls_back_all_kps_and_section_state(learning, service, monkeypatch):
    f, master, runtime, points = learning
    rev, section = f['revision']['id'], points[0]['primary_section_id']
    before = master.repository.entries(rev)
    def fail(*args):
        raise ValueError('injected section event failure')
    monkeypatch.setattr(master.repository, '_section_event', fail)
    with pytest.raises(ValueError):
        master.repository.clear_section(rev, section)
    assert master.repository.entries(rev) == before
    with service.database.connect() as c:
        assert not c.execute('SELECT * FROM learning_events').fetchall()
        assert c.execute('SELECT learning_state_ever_at FROM chapter_preparations WHERE chapter_outline_node_id=?', (points[0]['chapter_outline_node_id'],)).fetchone()[0] is None


def test_section_http_authority_and_atomic_lock(learning, service, monkeypatch):
    f, master, runtime, points = learning
    rev, section = f['revision']['id'], points[0]['primary_section_id']
    with running_server(service, learning=master) as (url, token):
        path = f'{url}/api/revisions/{rev}/learning/{section}'
        with pytest.raises(HTTPError) as exc:
            request_json(path+'/open', 'bad-token', method='POST', data=b'{}')
        assert exc.value.code == 401
        _, opened = request_json(path+'/open', token, method='POST', data=b'{}')
        assert opened['status'] == 'ANSWERED_HAS_UNCLEAR'
        _, clear = request_json(path+'/check-section', token, method='POST', data=b'{}')
        assert clear['status'] == 'ANSWERED_CLEAR'
        with pytest.raises(HTTPError) as exc:
            request_json(f'{url}/api/revisions/{uuid4()}/learning/{section}', token)
        assert exc.value.code == 404
    with service.database.connect() as c:
        assert c.execute('SELECT learning_state_ever_at FROM chapter_preparations WHERE chapter_outline_node_id=?', (points[0]['chapter_outline_node_id'],)).fetchone()[0]


def test_populated_migration_12_to_13_preserves_learning_and_cascade(learning, service, tmp_path):
    f, master, runtime, points = learning
    # Independent v12 database populated from this fixture's pre-Learning schema and actual KP rows.
    old_path = tmp_path / 'v12.sqlite3'
    with patch.object(db_module, 'MIGRATIONS', [m for m in db_module.MIGRATIONS if m[0] <= 12]):
        old = Database(old_path)
        old.initialize()
    with service.database.connect() as source:
        c = sqlite3.connect(old_path)
        tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name != 'schema_migrations'")]
        for table in tables:
            cols = [r[1] for r in c.execute(f'PRAGMA table_info({table})')]
            for row in source.execute(f"SELECT {','.join(cols)} FROM {table}"):
                c.execute(f"INSERT INTO {table} VALUES ({','.join('?' for _ in cols)})", tuple(row))
        rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
        c.execute('INSERT INTO master_threads VALUES (?, ?, ?, ?)', ('old-thread', rev, kp, 'timestamp'))
        c.execute("INSERT INTO master_topics VALUES ('old-topic','old-thread','ACTIVE','timestamp',NULL,NULL)")
        c.execute("INSERT INTO learning_events VALUES ('old-event',?,?,'old-topic','KP_EXPLICIT_UNCLEAR','NOT_FULLY_CLEAR','timestamp')", (rev, kp))
        c.execute("INSERT INTO master_messages(id,thread_id,topic_id,intent_id,role,content,created_at,state,review_mode) VALUES ('old-message','old-thread','old-topic','one','user','保留原问题','timestamp','COMPLETE','Fast')")
        before = {table: ([r[1] for r in c.execute(f'PRAGMA table_info({table})')], c.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall()) for table in tables}
        c.commit(); c.close()
    old.initialize()
    with old.connect() as c:
        for table, (cols, rows) in before.items():
            assert [tuple(r) for r in c.execute(f"SELECT {','.join(cols)} FROM {table} ORDER BY rowid")] == rows
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        c.execute('DELETE FROM books')
        assert not c.execute('SELECT * FROM master_threads').fetchall()
        assert not c.execute('SELECT * FROM learning_events').fetchall()


def test_section_migration_fk_failure_rolls_back_schema_and_marker(tmp_path):
    path = tmp_path / 'invalid-v12.sqlite3'
    old = Database(path)
    with patch.object(db_module, 'MIGRATIONS', [m for m in db_module.MIGRATIONS if m[0] <= 12]):
        old.initialize()
    with sqlite3.connect(path) as c:
        c.execute("INSERT INTO master_threads VALUES ('bad-thread','missing-book','missing-kp','time')")
        original = c.execute("SELECT sql FROM sqlite_master WHERE name='master_threads'").fetchone()[0]
    with pytest.raises(RuntimeError, match='foreign-key'):
        old.initialize()
    with sqlite3.connect(path) as c:
        assert c.execute("SELECT sql FROM sqlite_master WHERE name='master_threads'").fetchone()[0] == original
        assert c.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 12
        assert c.execute('SELECT COUNT(*) FROM master_threads').fetchone()[0] == 1
