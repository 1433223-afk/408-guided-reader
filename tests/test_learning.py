import json
import sqlite3
import threading
import time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor

import pytest

from reader_service.agent_runtime import ProviderCompletion, ProviderFailure, ProviderFailureKind
from reader_service.knowledge import ChapterRegenerationBlocked
from reader_service.learning.repository import LearningRepository
from reader_service.learning.service import LearningService
from reader_service.library.database import Database, MIGRATIONS
from test_knowledge_map import build_fixture, claim_and_run
from conftest import make_pdf
from test_api import running_server, request_json
from urllib.error import HTTPError
from uuid import uuid4


class Runtime:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.review = 'PASS'
        self.started = threading.Event()
        self.release = threading.Event()
        self.release.set()

    def provider_identity(self, provider):
        return provider, provider + '-model'

    def complete_for_with_metadata(self, provider, messages, **kwargs):
        self.calls.append((provider, json.loads(messages[1]['content'])))
        self.started.set()
        assert self.release.wait(5)
        if self.fail:
            raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'test_failure', '调用失败')
        if 'candidate' in self.calls[-1][1]:
            answer = json.dumps({'verdict': self.review, 'summary': '审查理由'})
        else:
            answer = '根据所附教材，这是该知识点的解释。补充解释：可以用日常例子理解。'
        return ProviderCompletion(answer, 1, None, {'provider': provider, 'model': provider + '-model'})


@pytest.fixture
def learning(service):
    f = build_fixture(service)
    rev = f['revision']['id']
    chapter = f['chapter']['outline_node_id']
    f['knowledge'].request_prepare(rev, chapter)
    claim_and_run(f)
    points = f['knowledge'].snapshot(rev, chapter)['knowledge_points']
    runtime = Runtime()
    master = LearningService(service.database, f['foundation'], runtime)
    return f, master, runtime, points


def idle(master):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        with master._lock:
            if not master._inflight:
                return
        time.sleep(.01)
    pytest.fail('Master did not finish')


def test_explicit_evidence_recovery_and_no_automatic_downgrade(learning, service):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    assert master.snapshot(rev, kp)['status'] == 'UNCONFIRMED'
    opened = master.repository.open(rev, kp)
    assert opened['status'] == 'NOT_FULLY_CLEAR'
    topic = opened['topics'][0]['id']
    with pytest.raises(ChapterRegenerationBlocked):
        f['repository'].request_regenerate(rev, f['chapter']['outline_node_id'])
    master.send(rev, kp, {'intent_id': 'first', 'question': '这个概念为什么如此？'})
    idle(master)
    state = master.snapshot(rev, kp)
    assert len(state['messages']) == 2
    assert state['messages'][-1]['review_state'] == 'PASS'
    assert state['status'] == 'NOT_FULLY_CLEAR'
    assert state['topics'][0]['state'] == 'ACTIVE'
    restarted = LearningService(service.database, f['foundation'], runtime)
    assert restarted.snapshot(rev, kp) == state
    confirmed = restarted.repository.confirm(rev, kp, topic)
    assert confirmed['status'] == 'UNDERSTOOD'
    assert confirmed['topics'][0]['state'] == 'RESOLVED'
    restarted.repository.confirm(rev, kp, topic)
    opened_again = restarted.repository.open(rev, kp)
    assert opened_again['status'] == 'UNDERSTOOD'
    assert len(opened_again['topics']) == 2
    assert opened_again['messages'] == state['messages']
    with service.database.connect() as c:
        events = list(c.execute('SELECT event_type FROM learning_events'))
        assert [r[0] for r in events] == ['KP_EXPLICIT_UNCLEAR', 'KP_EXPLICIT_UNDERSTOOD']
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("UPDATE learning_events SET status = 'UNDERSTOOD'")
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("DELETE FROM learning_events")


def test_question_committed_before_egress_double_send_failure_retry_and_replay(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    payload = {'intent_id': 'same', 'question': '为什么？', 'review_mode': 'Fast'}
    runtime.release.clear()
    runtime.fail = True
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda _: master.send(rev, kp, payload), range(6)))
    assert runtime.started.wait(2)
    state = master.snapshot(rev, kp)
    assert len(state['topics']) == len(state['messages']) == 1
    assert state['messages'][0]['state'] == 'PENDING'
    runtime.release.set()
    idle(master)
    state = master.snapshot(rev, kp)
    assert state['messages'][0]['state'] == 'FAILED'
    master.send(rev, kp, payload)  # HTTP replay is not an implicit technical retry.
    assert len(runtime.calls) == 1
    runtime.fail = False
    message_id = state['messages'][0]['id']
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(lambda _: master.retry(rev, kp, message_id), range(6)))
    idle(master)
    master.retry(rev, kp, message_id)
    master.send(rev, kp, payload)
    state = master.snapshot(rev, kp)
    assert len(state['messages']) == 2
    assert len(runtime.calls) == 2
    assert state['messages'][-1]['review_state'] == 'NOT_REQUESTED'
    assert state['status'] == 'UNCONFIRMED'  # Sending alone is not explicit unclear evidence.
    with pytest.raises(ValueError):
        master.send(rev, kp, {**payload, 'question': '替换问题'})


@pytest.mark.parametrize('mode,expected', [('Fast', 1), ('Standard', 2), ('Deep', 2)])
def test_context_isolation_and_review_strength(learning, mode, expected):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(rev, kp, {'intent_id': 'one', 'question': '为什么？', 'review_mode': mode})
    idle(master)
    assert len(runtime.calls) == expected
    generation = runtime.calls[0][1]
    assert set(generation) == {'source', 'topic_messages'}
    assert set(generation['source']) == {'knowledge_point_id', 'title', 'section', 'range', 'pages'}
    assert 'CANARY_OTHER_CHAPTER' not in json.dumps(runtime.calls)
    assert generation['source']['range'] == {k: points[0][k] for k in ('start_page', 'start_y', 'end_page', 'end_y')}
    if expected == 2:
        assert runtime.calls[1][0] == 'zhipu'
        assert set(runtime.calls[1][1]) == {'source', 'question', 'candidate', 'mode'}
        assert runtime.calls[1][1]['mode'] == mode


@pytest.mark.parametrize('mode', ['Fast', 'Standard', 'Deep'])
@pytest.mark.parametrize('bad_answer', ['PDF p. 999', '教材图 999-9 明确表明了这一事实。'])
def test_grounding_failure_preserves_intent_and_retry_before_review(learning, monkeypatch, mode, bad_answer):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    original = runtime.complete_for_with_metadata
    def unsupported(*args, **kwargs):
        completion = original(*args, **kwargs)
        return ProviderCompletion(bad_answer, 1, None, completion.effective_config)
    monkeypatch.setattr(runtime, 'complete_for_with_metadata', unsupported)
    master.send(rev, kp, {'intent_id': 'grounding-retry', 'question': '为什么？', 'review_mode': mode})
    idle(master)
    failed = master.snapshot(rev, kp)
    assert len(runtime.calls) == len(failed['messages']) == 1
    assert failed['messages'][0]['state'] == 'FAILED'
    assert failed['topics'][0]['state'] == 'ACTIVE'
    assert failed['status'] == 'UNCONFIRMED'
    monkeypatch.setattr(runtime, 'complete_for_with_metadata', original)
    master.retry(rev, kp, failed['messages'][0]['id'])
    idle(master)
    restored = master.snapshot(rev, kp)
    assert len(restored['messages']) == 2
    assert restored['messages'][0]['id'] == failed['messages'][0]['id']
    assert restored['messages'][1]['review_state'] == ('NOT_REQUESTED' if mode == 'Fast' else 'PASS')
    assert restored['topics'] == failed['topics']
    assert restored['status'] == 'UNCONFIRMED'
    with master.repository.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM learning_events').fetchone()[0] == 0


def test_grounding_blocks_review_retry_of_legacy_unsupported_answer(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(rev, kp, {'intent_id': 'legacy', 'question': '为什么？'})
    idle(master)
    answer = master.snapshot(rev, kp)['messages'][-1]
    with master.repository.database.connect() as c:
        c.execute("UPDATE master_messages SET content=?, review_state='FAIL' WHERE id=?", ('教材图 999-9', answer['id']))
    calls = len(runtime.calls)
    master.retry(rev, kp, answer['id'])
    idle(master)
    result = master.snapshot(rev, kp)
    assert len(runtime.calls) == calls  # Reject before any reviewer egress.
    assert result['messages'][-1]['review_state'] == 'TECHNICAL_FAILURE'
    assert result['status'] == 'UNCONFIRMED'
    assert result['topics'][0]['state'] == 'ACTIVE'


@pytest.mark.parametrize('verdict', ['FAIL', 'INVALID'])
def test_review_failure_never_pass_never_mastery_and_retry(learning, verdict):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    runtime.review = verdict
    master.send(rev, kp, {'intent_id': 'one', 'question': '为什么？'})
    idle(master)
    state = master.snapshot(rev, kp)
    assert state['messages'][-1]['review_state'] == ('FAIL' if verdict == 'FAIL' else 'TECHNICAL_FAILURE')
    assert state['status'] == 'UNCONFIRMED'
    runtime.review = 'PASS'
    master.retry(rev, kp, state['messages'][-1]['id'])
    idle(master)
    state = master.snapshot(rev, kp)
    assert len(state['messages']) == 2
    assert state['messages'][-1]['review_state'] == 'PASS'
    assert state['status'] == 'UNCONFIRMED'


def test_section_confirmation_preserves_unclear_topics_and_other_section(learning, service):
    f, master, runtime, points = learning
    rev = f['revision']['id']
    section = points[0]['primary_section_id']
    own = [p for p in points if p['primary_section_id'] == section]
    other = [p for p in points if p['primary_section_id'] != section]
    assert len(own) >= 2 and other
    opened = master.repository.open(rev, own[0]['knowledge_point_id'])
    result = master.repository.confirm_section(rev, section)
    assert result == {'changed': len(own) - 1, 'unclear': 1}
    assert master.repository.confirm_section(rev, section) == {'changed': 0, 'unclear': 1}
    assert master.snapshot(rev, own[0]['knowledge_point_id']) == opened
    for point in own[1:]:
        assert master.snapshot(rev, point['knowledge_point_id'])['status'] == 'UNDERSTOOD'
    for point in other:
        assert master.snapshot(rev, point['knowledge_point_id'])['status'] == 'UNCONFIRMED'
    with service.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM learning_events').fetchone()[0] == len(own)
    restarted = LearningService(service.database, f['foundation'], runtime)
    assert restarted.repository.entries(rev) == master.repository.entries(rev)


def test_transaction_rolls_back_lock_and_projection(learning, service, monkeypatch):
    f, master, runtime, points = learning
    original = master.repository.knowledge.lock_for_learning_state
    def fail(c, kp):
        original(c, kp)
        raise RuntimeError('rollback')
    monkeypatch.setattr(master.repository.knowledge, 'lock_for_learning_state', fail)
    with pytest.raises(RuntimeError):
        master.repository.confirm_section(f['revision']['id'], points[0]['primary_section_id'])
    snapshot = f['knowledge'].snapshot(f['revision']['id'], f['chapter']['outline_node_id'])
    assert snapshot['regeneration_allowed']
    with service.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM learning_events').fetchone()[0] == 0


def test_restart_interruption_and_ownership_cascade(learning, service):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    message, _ = master.repository.enqueue(rev, kp, 'pending', '问题', 'Standard')
    restarted = LearningService(service.database, f['foundation'], runtime)
    assert restarted.snapshot(rev, kp)['messages'][0]['state'] == 'FAILED'
    pdf = make_pdf(((420, 600),))
    sibling = service.intake(BytesIO(pdf), content_length=len(pdf), filename='sibling.pdf')['book']['active_revision']
    with pytest.raises(LookupError):
        master.snapshot(sibling['id'], kp)
    with pytest.raises(LookupError):
        master.repository.open(rev, 'invented-kp')
    service.delete_book(f['book']['id'])
    assert service.revision(sibling['id'])
    with service.database.connect() as c:
        for table in ('master_threads', 'master_topics', 'master_messages', 'kp_status', 'learning_events'):
            assert c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0


def test_migration_11_to_12_is_additive(tmp_path, monkeypatch):
    from reader_service.library import database as db_module
    monkeypatch.setattr(db_module, 'MIGRATIONS', [m for m in MIGRATIONS if m[0] <= 12])
    path = tmp_path / 'migration.sqlite'
    c = sqlite3.connect(path)
    c.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)')
    for version, sql in MIGRATIONS:
        if version <= 11:
            c.executescript(sql)
            c.execute('INSERT INTO schema_migrations VALUES (?)', (version,))
    before = list(c.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"))
    c.commit()
    c.close()
    database = Database(path)
    database.initialize()
    with database.connect() as c:
        after = dict(c.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'"))
        assert all(after[name] == sql for name, sql in before)
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert list(c.execute('PRAGMA foreign_key_check')) == []


def test_http_authority_and_replay(learning, service):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    with running_server(service, learning=master) as (base, token):
        url = f'{base}/api/revisions/{rev}/learning/{kp}'
        with pytest.raises(HTTPError) as error:
            request_json(url, 'wrong-token')
        assert error.value.code == 401
        _, before = request_json(url, token)
        assert before['status'] == 'UNCONFIRMED'
        request_json(url + '/open', token, method='POST', data=b'{}')
        data = json.dumps({'intent_id': 'http', 'question': '问题', 'review_mode': 'Fast'}).encode()
        request_json(url + '/send', token, method='POST', data=data)
        idle(master)
        _, state = request_json(url + '/send', token, method='POST', data=data)
        assert len(state['messages']) == 2
        topic = state['topics'][0]['id']
        request_json(url + '/confirm', token, method='POST', data=json.dumps({'topic_id': topic}).encode())
        _, confirmed = request_json(url, token)
        assert confirmed['status'] == 'UNDERSTOOD'


def test_resolution_during_provider_call_does_not_lose_turn_or_reopen_topic(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    runtime.release.clear()
    master.send(rev, kp, {'intent_id': 'first', 'question': '问题'})
    assert runtime.started.wait(2)
    topic = master.snapshot(rev, kp)['topics'][0]['id']
    master.repository.confirm(rev, kp, topic)
    runtime.release.set()
    idle(master)
    state = master.snapshot(rev, kp)
    assert state['status'] == 'UNDERSTOOD'
    assert state['topics'][0]['state'] == 'RESOLVED'
    assert len(state['messages']) == 2
    master.send(rev, kp, {'intent_id': 'second', 'question': '新的问题'})
    idle(master)
    state = master.snapshot(rev, kp)
    assert len(state['topics']) == 2
    assert state['topics'][1]['state'] == 'ACTIVE'
    assert state['status'] == 'UNDERSTOOD'
    assert len(runtime.calls[-2][1]['topic_messages']) == 1


def test_subsection_bulk_scope_boundaries_history_and_restart(learning, service):
    f, master, runtime, points = learning
    rev = f['revision']['id']
    owner = points[0]['primary_section_id']
    sub_ids = [str(uuid4()), str(uuid4())]
    with service.database.connect() as c:
        template = dict(c.execute('SELECT * FROM outline_nodes WHERE outline_node_id = ? AND book_source_revision_id = ?', (owner, rev)).fetchone())
        for i, (start, end) in enumerate([((0, .2), (1, .2)), ((1, .2), (2, .0))]):
            node = {**template, 'outline_node_id': sub_ids[i], 'kind': 'SUBSECTION',
                    'parent_id': owner, 'depth': template['depth'] + 1, 'order_index': i,
                    'title': f'1.1.{i+1} 小节', 'start_page': start[0], 'start_y': start[1],
                    'end_page': end[0], 'end_y': end[1]}
            c.execute(f"INSERT INTO outline_nodes ({','.join(node)}) VALUES ({','.join('?' for _ in node)})", tuple(node.values()))
        template = dict(c.execute('SELECT * FROM knowledge_points WHERE knowledge_point_id = ?', (points[0]['knowledge_point_id'],)).fetchone())
        added = []
        for i, (start, end) in enumerate([((0, .3), (0, .4)), ((0, .5), (1, .2)), ((1, .2), (1, .4)), ((1, .1), (1, .3))]):
            point = {**template, 'knowledge_point_id': str(uuid4()), 'order_index': 100 + i,
                     'start_page': start[0], 'start_y': start[1], 'end_page': end[0], 'end_y': end[1]}
            c.execute(f"INSERT INTO knowledge_points ({','.join(point)}) VALUES ({','.join('?' for _ in point)})", tuple(point.values()))
            added.append(point['knowledge_point_id'])
    unclear = master.repository.open(rev, added[0])
    before = master.repository.entries(rev)
    subsection = next(s for s in before['sections'] if s['outline_node_id'] == sub_ids[0])
    eligible = set(subsection['knowledge_point_ids'])
    assert set(added[:2]) <= eligible
    assert not set(added[2:]) & eligible  # Same-page next-start and cross-boundary KP.
    result = master.repository.confirm_section(rev, sub_ids[0])
    assert result == {'changed': len(eligible) - 1, 'unclear': 1}
    after = master.repository.entries(rev)
    for old, new in zip(before['points'], after['points']):
        expected = 'UNDERSTOOD' if old['knowledge_point_id'] in eligible - {added[0]} else old['status']
        assert new['status'] == expected
    assert master.snapshot(rev, added[0]) == unclear
    with service.database.connect() as c:
        events = [tuple(r) for r in c.execute('SELECT knowledge_point_id,event_type FROM learning_events')]
        assert {kp for kp, kind in events if kind == 'SUBSECTION_UNCONFIRMED_EXPLICIT_CONFIRM'} == eligible - {added[0]}
        assert c.execute('SELECT COUNT(*) FROM master_threads').fetchone()[0] == 1
    restarted = LearningService(service.database, f['foundation'], runtime)
    assert restarted.repository.entries(rev) == after
    assert restarted.repository.confirm_section(rev, sub_ids[0]) == {'changed': 0, 'unclear': 1}
    with running_server(service, learning=restarted) as (base, token):
        _, response = request_json(f'{base}/api/revisions/{rev}/learning/{sub_ids[0]}/confirm-section', token, method='POST', data=b'{}')
        assert response == {'changed': 0, 'unclear': 1}
        with pytest.raises(HTTPError):
            request_json(f'{base}/api/revisions/{uuid4()}/learning/{sub_ids[0]}/confirm-section', token, method='POST', data=b'{}')
