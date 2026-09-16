import json
import sqlite3
import threading
import time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor

import pytest

from reader_service.agent_runtime import ProviderCompletion, ProviderFailure, ProviderFailureKind
from reader_service.assistant import AssistantContextBuilder, AssistantService
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
        self.options = []
        self.fail = False
        self.review = 'PASS'
        self.started = threading.Event()
        self.release = threading.Event()
        self.release.set()

    def provider_identity(self, provider):
        return provider, provider + '-model'

    def status(self):
        providers = [
            {'provider': provider, 'model': provider + '-model', 'configured': True,
             'configuration_valid': True, 'credential_available': True,
             'cooling': False, 'ai_off_reason': None}
            for provider in ('deepseek', 'zhipu', 'openrouter')
        ]
        return {'providers': providers}

    def complete_for_with_metadata(self, provider, messages, **kwargs):
        self.calls.append((provider, json.loads(messages[1]['content'])))
        self.options.append(kwargs)
        self.started.set()
        assert self.release.wait(5)
        if self.fail:
            raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'test_failure', '调用失败')
        if 'candidate' in self.calls[-1][1]:
            answer = json.dumps({'verdict': self.review, 'summary': '审查理由'})
        else:
            answer = '根据所附教材，这是该知识点的解释。补充解释：可以用日常例子理解。'
        return ProviderCompletion(answer, 1, None, {'provider': provider, 'model': provider + '-model'})

    def stream_for_with_metadata(self, provider, messages, on_delta, on_reasoning_delta=None, **kwargs):
        self.calls.append((provider, json.loads(messages[1]['content'])))
        self.options.append(kwargs)
        self.started.set()
        assert self.release.wait(5)
        if self.fail:
            raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'test_failure', '调用失败')
        answer = '根据所附教材，这是该知识点的解释。补充解释：可以用日常例子理解。'
        if kwargs.get('thinking_mode') == 'enabled' and on_reasoning_delta:
            on_reasoning_delta('REAL_REASONING_STREAM_CANARY')
        for delta in ('根据所附教材，', '这是该知识点的解释。', '补充解释：可以用日常例子理解。'):
            on_delta(delta)
        return ProviderCompletion(answer, 1, None, {'provider': provider, 'model': provider + '-model'},
                                  {'reasoning_present': kwargs.get('thinking_mode') == 'enabled'})


class AssistantCaptureRuntime:
    def __init__(self):
        self.calls = []

    def provider_identity(self, provider):
        selected = provider or 'deepseek'
        return selected, selected + '-model'

    def complete_for_with_metadata(self, provider, messages, **kwargs):
        self.calls.append({'provider': provider, 'messages': messages, 'options': kwargs})
        return ProviderCompletion(
            '只围绕所选 Master 文字生成的新解释。', 1, None,
            {'provider': provider, 'model': provider + '-model'},
        )


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


def test_master_status_confirms_answer_and_review_defaults(learning):
    _f, master, _runtime, _points = learning
    status = master.status()
    assert (status['answer_provider'], status['answer_model']) == ('deepseek', 'deepseek-model')
    assert (status['review_provider'], status['review_model']) == ('zhipu', 'zhipu-model')
    assert status['default_reasoning_mode'] == 'Quick'
    assert status['default_review_mode'] == 'Fast'


def test_master_answer_selection_creates_provenanced_assistant_root_without_learning_writes(
    learning, service
):
    f, master, _runtime, points = learning
    revision, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(revision, kp, {
        'intent_id': 'master-to-assistant',
        'question': '这个概念为什么这样工作？',
        'provider': 'deepseek',
        'reasoning_mode': 'Quick',
        'review_mode': 'Fast',
    })
    idle(master)
    before = master.snapshot(revision, kp)
    answer = next(message for message in before['messages'] if message['role'] == 'assistant')
    start = answer['content'].index('该知识点')
    spans = [
        {'start': start, 'end': start + 2},
        {'start': start + 2, 'end': start + len('该知识点')},
    ]
    projection = master.assistant_context_for_master_answer(
        revision, answer['id'], spans
    )
    assistant_runtime = AssistantCaptureRuntime()
    assistant = AssistantService(
        AssistantContextBuilder(f['foundation'], f['outline']), assistant_runtime
    )

    with running_server(service, assistant=assistant, learning=master) as (base, token):
        data = json.dumps({
            'reader_session_id': 'reader-session-master-answer',
            'source_kind': 'MASTER_ANSWER',
            'master_message_id': answer['id'],
            'source_spans': spans,
            'provider': 'deepseek',
        }).encode()
        status, payload = request_json(
            f'{base}/api/revisions/{revision}/assistant/ask', token,
            method='POST', data=data,
            headers={'Content-Type': 'application/json'},
        )

    assert status == 200
    root = payload['assistant']['roots'][0]
    assert root['created_from']['kind'] == 'MASTER_ANSWER'
    assert root['created_from']['selected_text_preview'] == '该知识点'
    assert root['created_from']['source_provenance'] == projection['source_provenance']
    assert root['turns'][0]['question'] == '该知识点'
    assert master.snapshot(revision, kp) == before

    transport = assistant_runtime.calls[0]['messages'][-1]['content']
    assert transport.startswith('【当前解释焦点（用户所选）】\n该知识点\n')
    assert '这段文字来自 Master 回答，不是教材原文' in transport
    assert '原 Master 学习范围的有界教材语境' in transport
    assert '补充解释：可以用日常例子理解' not in transport
    for canary in (
        answer['id'], before['thread_id'], before['topics'][0]['id'],
        answer['intent_id'], 'MASTER_ANSWER', 'source_spans',
    ):
        assert canary not in transport

    user_message = next(message for message in before['messages'] if message['role'] == 'user')
    with pytest.raises(LookupError):
        master.assistant_context_for_master_answer(
            revision, user_message['id'], [{'start': 0, 'end': 2}]
        )


@pytest.mark.parametrize(
    'provider,reasoning_mode,expected_options,reasoning_visible',
    [
        ('deepseek', 'Quick', {'thinking_mode': 'disabled'}, False),
        ('zhipu', 'Quick', {'reasoning_effort': 'low'}, False),
        ('openrouter', 'Quick', {'reasoning_effort': 'low'}, False),
        ('deepseek', 'Deep', {'thinking_mode': 'enabled', 'max_tokens': 12_288}, True),
        ('zhipu', 'Deep', {'thinking_mode': 'enabled', 'reasoning_effort': 'high'}, True),
        ('openrouter', 'Deep', {'reasoning_effort': 'high'}, False),
    ],
)
def test_master_true_streaming_reasoning_and_model_persistence(
    learning, provider, reasoning_mode, expected_options, reasoning_visible
):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    events = []
    result = master.send(rev, kp, {
        'intent_id': f'stream-{provider}-{reasoning_mode}',
        'question': '请解释当前概念。',
        'provider': provider,
        'reasoning_mode': reasoning_mode,
    }, stream=events.append)
    kinds = [event['type'] for event in events]
    assert kinds[0] == 'stage' and events[0]['stage'] == 'answering'
    assert kinds[-1] == 'complete'
    assert ''.join(event['content'] for event in events if event['type'] == 'delta') == result['messages'][-1]['content']
    reasoning = ''.join(event['content'] for event in events if event['type'] == 'reasoning_delta')
    assert bool(reasoning) is reasoning_visible
    assert ('REAL_REASONING_STREAM_CANARY' in reasoning) is reasoning_visible
    assert 'REAL_REASONING_STREAM_CANARY' not in json.dumps(result, ensure_ascii=False)
    question, answer = result['messages']
    assert (question['provider'], question['model'], question['reasoning_mode'], question['review_mode']) == (
        provider, provider + '-model', reasoning_mode, 'Fast'
    )
    assert (answer['provider'], answer['model'], answer['reasoning_mode'], answer['review_state']) == (
        provider, provider + '-model', reasoning_mode, 'NOT_REQUESTED'
    )
    assert len(runtime.calls) == 1
    for key, value in expected_options.items():
        assert runtime.options[0][key] == value
    assert not ({'thinking_mode', 'reasoning_effort'} - set(expected_options)) & set(runtime.options[0])
    assert ('max_tokens' in runtime.options[0]) is ('max_tokens' in expected_options)


def test_answer_reasoning_and_review_are_independent(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    events = []
    state = master.send(rev, kp, {
        'intent_id': 'deep-answer-standard-review',
        'question': '请深入解释。',
        'provider': 'deepseek',
        'reasoning_mode': 'Deep',
        'review_mode': 'Standard',
    }, stream=events.append)
    assert [call[0] for call in runtime.calls] == ['deepseek', 'zhipu']
    assert runtime.options[0]['thinking_mode'] == 'enabled'
    assert 'thinking_mode' not in runtime.options[1]
    assert any(event.get('stage') == 'reviewing' for event in events)
    assert state['messages'][-1]['review_state'] == 'PASS'


def test_failed_deep_send_restart_retry_retains_execution_identity(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    runtime.fail = True
    payload = {'intent_id': 'durable-deep', 'question': '深入解释。', 'provider': 'zhipu',
               'reasoning_mode': 'Deep', 'review_mode': 'Fast'}
    master.send(rev, kp, payload)
    idle(master)
    failed = master.snapshot(rev, kp)['messages'][0]
    assert (failed['provider'], failed['model'], failed['reasoning_mode']) == ('zhipu', 'zhipu-model', 'Deep')
    runtime.fail = False
    restarted = LearningService(master.repository.database, f['foundation'], runtime)
    restarted.retry(rev, kp, failed['id'])
    idle(restarted)
    assert runtime.calls[-1][0] == 'zhipu'
    assert runtime.options[-1]['model'] == 'zhipu-model'
    assert runtime.options[-1]['thinking_mode'] == 'enabled'
    assert runtime.options[-1]['reasoning_effort'] == 'high'
    assert restarted.snapshot(rev, kp)['messages'][-1]['reasoning_mode'] == 'Deep'


def test_failed_deepseek_deep_retry_retains_raised_bounded_generation_budget(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    runtime.fail = True
    master.send(rev, kp, {
        'intent_id': 'durable-deepseek-budget',
        'question': '请深入解释，但避免无止境展开。',
        'provider': 'deepseek',
        'reasoning_mode': 'Deep',
        'review_mode': 'Fast',
    })
    idle(master)
    failed = master.snapshot(rev, kp)['messages'][0]
    runtime.fail = False

    restarted = LearningService(master.repository.database, f['foundation'], runtime)
    restarted.retry(rev, kp, failed['id'])
    idle(restarted)

    assert runtime.calls[-1][0] == 'deepseek'
    assert runtime.options[-1]['model'] == 'deepseek-model'
    assert runtime.options[-1]['thinking_mode'] == 'enabled'
    assert runtime.options[-1]['max_tokens'] == 12_288
    assert restarted.snapshot(rev, kp)['messages'][-1]['reasoning_mode'] == 'Deep'


def test_explicit_evidence_recovery_and_no_automatic_downgrade(learning, service):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    assert master.snapshot(rev, kp)['status'] == 'UNCONFIRMED'
    opened = master.repository.open(rev, kp)
    assert opened['status'] == 'NOT_FULLY_CLEAR'
    topic = opened['topics'][0]['id']
    with pytest.raises(ChapterRegenerationBlocked):
        f['repository'].request_regenerate(rev, f['chapter']['outline_node_id'])
    master.send(rev, kp, {'intent_id': 'first', 'question': '这个概念为什么如此？', 'review_mode': 'Standard'})
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
    assert len(opened_again['topics']) == 1
    assert opened_again['topics'][0]['id'] == topic
    assert opened_again['topics'][0]['state'] == 'ACTIVE'
    assert opened_again['messages'] == state['messages']
    with service.database.connect() as c:
        events = list(c.execute('SELECT event_type FROM learning_events'))
        assert [r[0] for r in events] == ['KP_EXPLICIT_UNCLEAR', 'KP_EXPLICIT_UNDERSTOOD']
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("UPDATE learning_events SET status = 'UNDERSTOOD'")
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("DELETE FROM learning_events")


def test_first_pass_understanding_does_not_create_master_topic(learning, service):
    f, master, _runtime, points = learning
    revision = f['revision']['id']
    point = points[0]['knowledge_point_id']

    confirmed = master.repository.understand_without_topic(revision, point)
    assert confirmed['status'] == 'UNDERSTOOD'
    assert confirmed['thread_id'] is None
    assert confirmed['topics'] == []
    assert confirmed['messages'] == []

    # A repeated explicit click is idempotent and cannot manufacture durable Master state.
    master.repository.understand_without_topic(revision, point)
    with master.repository.database.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM master_threads').fetchone()[0] == 0
        assert connection.execute('SELECT COUNT(*) FROM master_topics').fetchone()[0] == 0
        event = connection.execute(
            'SELECT event_type, status, topic_id FROM learning_events WHERE knowledge_point_id=?',
            (point,),
        ).fetchone()
        assert tuple(event) == ('KP_EXPLICIT_UNDERSTOOD', 'UNDERSTOOD', None)

    with running_server(service, learning=master) as (base_url, token):
        other = points[1]['knowledge_point_id']
        _, payload = request_json(
            f'{base_url}/api/revisions/{revision}/learning/{other}/understand',
            token,
            method='POST',
            data=b'{}',
        )
        assert payload['status'] == 'UNDERSTOOD'
        assert payload['thread_id'] is None

    master.repository.open(revision, point)
    with pytest.raises(ValueError, match='已有 Master 对话'):
        master.repository.understand_without_topic(revision, point)


def test_topic_navigation_is_read_only_and_preserves_real_identity(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(rev, kp, {'intent_id': 'navigation', 'question': '为什么？', 'review_mode': 'Fast'})
    idle(master)
    before = master.snapshot(rev, kp)
    topic = before['topics'][0]['id']
    master.repository.confirm(rev, kp, topic)
    resolved = master.snapshot(rev, kp)
    before_counts = {}
    with master.repository.database.connect() as c:
        for table in ('master_threads', 'master_topics', 'master_messages', 'learning_events', 'kp_status'):
            before_counts[table] = c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    restarted = LearningService(master.repository.database, f['foundation'], runtime)
    current = restarted.snapshot(rev, kp)
    entries = restarted.repository.entries(rev, f['chapter']['outline_node_id'])
    assert {t['id'] for t in entries['topics']} == {t['id'] for t in current['topics']}
    old = next(t for t in entries['topics'] if t['id'] == topic)
    assert old['state'] == 'RESOLVED'
    assert old['label'] == '为什么？'
    assert old['scope_id'] == kp and old['scope_kind'] == 'KP'
    assert current == resolved
    assert restarted.repository.entries(rev, f['chapter']['outline_node_id']) == entries
    assert restarted.snapshot(rev, kp) == current
    with master.repository.database.connect() as c:
        assert {table: c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                for table in before_counts} == before_counts
    assert len(runtime.calls) == 1


def test_master_history_projection_is_chapter_local_and_requires_completed_exchange(learning, service):
    f, master, _runtime, points = learning
    revision = f['revision']['id']
    first_chapter = f['chapter']['outline_node_id']
    first_point = points[0]['knowledge_point_id']

    empty = master.repository.open(revision, first_point)
    empty_topic_id = empty['topics'][0]['id']
    assert master.repository.entries(revision)['topics'] == []
    assert master.repository.entries(revision, first_chapter)['topics'] == []

    pending, created = master.repository.enqueue(
        revision, first_point, 'chapter-one-first', '第一章为什么这样？',
        'Fast', 'deepseek', 'deepseek-model', 'Quick',
    )
    assert created
    assert master.repository.entries(revision, first_chapter)['topics'] == []
    master.repository.update_message(pending['id'], state='FAILED')
    master.retry(revision, first_point, pending['id'])
    idle(master)
    first_entries = master.repository.entries(revision, first_chapter)['topics']
    assert [(topic['id'], topic['label']) for topic in first_entries] == [
        (empty_topic_id, '第一章为什么这样？')
    ]

    master.repository.confirm(revision, first_point, empty_topic_id)
    master.send(revision, first_point, {
        'intent_id': 'chapter-one-follow-up', 'question': '继续追问。',
        'review_mode': 'Fast',
    })
    idle(master)
    after_follow_up = master.repository.entries(revision, first_chapter)['topics']
    assert len(after_follow_up) == 1
    assert after_follow_up[0]['id'] == empty_topic_id
    assert after_follow_up[0]['state'] == 'RESOLVED'

    second_chapter = f['sibling']['outline_node_id']
    f['knowledge'].request_prepare(revision, second_chapter)
    claim_and_run(f)
    with master.repository.database.connect() as connection:
        template = dict(connection.execute(
            'SELECT * FROM knowledge_points WHERE knowledge_point_id=?', (first_point,)
        ).fetchone())
        second_section = connection.execute(
            "SELECT outline_node_id FROM outline_nodes WHERE book_source_revision_id=? AND parent_id=? AND kind='SECTION'",
            (revision, second_chapter),
        ).fetchone()[0]
        structure_version = connection.execute(
            'SELECT structure_version FROM chapter_preparations WHERE book_source_revision_id=? AND chapter_outline_node_id=?',
            (revision, second_chapter),
        ).fetchone()[0]
        if structure_version < 1:
            structure_version = 1
        ready_metadata = connection.execute("""SELECT generator_provider,generator_model,
            reviewer_provider,reviewer_model,published_at FROM chapter_preparations
            WHERE book_source_revision_id=? AND chapter_outline_node_id=?""",
            (revision, first_chapter)).fetchone()
        connection.execute(
            """UPDATE chapter_preparations SET status='READY', structure_version=?,
                generator_provider=?,generator_model=?,reviewer_provider=?,reviewer_model=?,published_at=?,
                failure_stage=NULL,failure_kind=NULL,failure_code=NULL
                WHERE book_source_revision_id=? AND chapter_outline_node_id=?""",
            (structure_version, *ready_metadata, revision, second_chapter),
        )
        template.update({
            'knowledge_point_id': str(uuid4()), 'chapter_outline_node_id': second_chapter,
            'chapter_structure_version': structure_version, 'primary_section_id': second_section,
            'order_index': 0, 'title': '第二章知识点', 'start_page': 4, 'start_y': .2,
            'end_page': 5, 'end_y': .5,
        })
        connection.execute(
            f"INSERT INTO knowledge_points ({','.join(template)}) VALUES ({','.join('?' for _ in template)})",
            tuple(template.values()),
        )
    second_point = template
    with master.repository.database.connect() as connection:
        second_thread, second_topic, intent = str(uuid4()), str(uuid4()), 'chapter-two-first'
        connection.execute(
            "INSERT INTO master_threads(id,book_source_revision_id,knowledge_point_id,created_at) VALUES (?,?,?,'2026-09-15T00:00:00Z')",
            (second_thread, revision, second_point['knowledge_point_id']),
        )
        connection.execute(
            "INSERT INTO master_topics VALUES (?,?,'ACTIVE','2026-09-15T00:00:00Z',NULL,NULL)",
            (second_topic, second_thread),
        )
        connection.execute("""INSERT INTO master_messages(
            id,thread_id,topic_id,intent_id,role,content,created_at,state,review_mode,
            review_state,provider,model,reasoning_mode)
            VALUES (?,?,?,?, 'user','第二章的问题。','2026-09-15T00:00:01Z','COMPLETE','Fast',NULL,'deepseek','deepseek-model','Quick')""",
            (str(uuid4()), second_thread, second_topic, intent),
        )
        connection.execute("""INSERT INTO master_messages(
            id,thread_id,topic_id,intent_id,role,content,created_at,state,review_mode,
            review_state,provider,model,reasoning_mode)
            VALUES (?,?,?,?, 'assistant','第二章回答。','2026-09-15T00:00:02Z','COMPLETE','Fast','NOT_REQUESTED','deepseek','deepseek-model','Quick')""",
            (str(uuid4()), second_thread, second_topic, intent),
        )
    second_entries = master.repository.entries(revision, second_chapter)['topics']
    assert len(second_entries) == 1
    assert second_entries[0]['label'] == '第二章的问题。'
    assert second_entries[0]['id'] != empty_topic_id
    assert {topic['id'] for topic in master.repository.entries(revision, first_chapter)['topics']} == {empty_topic_id}
    with pytest.raises(LookupError, match='当前章节不存在'):
        master.repository.entries(revision, str(uuid4()))
    with running_server(service, learning=master) as (base, token):
        _, unscoped = request_json(f'{base}/api/revisions/{revision}/learning', token)
        _, scoped = request_json(
            f'{base}/api/revisions/{revision}/learning?chapter_id={first_chapter}', token
        )
        assert unscoped['topics'] == []
        assert [topic['id'] for topic in scoped['topics']] == [empty_topic_id]


def test_concurrent_explicit_open_reuses_one_topic(learning):
    f, master, runtime, points = learning
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda _: master.repository.open(rev, kp), range(8)))
    topic_ids = {result['topics'][0]['id'] for result in results}
    assert len(topic_ids) == 1
    with master.repository.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM master_threads').fetchone()[0] == 1
        assert c.execute('SELECT COUNT(*) FROM master_topics').fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM learning_events WHERE event_type='KP_EXPLICIT_UNCLEAR'").fetchone()[0] == 1


def test_master_openrouter_review_requests_json_without_weakening_verdict(learning):
    f, master, runtime, points = learning
    master.reviewer = 'openrouter'
    original = runtime.complete_for_with_metadata
    options = []
    def complete(provider, messages, **kwargs):
        if provider == 'openrouter':
            options.append(kwargs)
            assert kwargs.get('json_object') is True
        return original(provider, messages, **kwargs)
    runtime.complete_for_with_metadata = complete
    rev, kp = f['revision']['id'], points[0]['knowledge_point_id']
    runtime.review = 'FAIL'
    master.send(rev, kp, {'intent_id':'json-review','question':'为什么？','review_mode':'Standard'})
    idle(master)
    answer = master.snapshot(rev,kp)['messages'][-1]
    assert answer['review_state'] == 'FAIL'
    runtime.review = 'PASS'
    master.retry(rev,kp,answer['id'])
    idle(master)
    assert master.snapshot(rev,kp)['messages'][-1]['review_state'] == 'PASS'
    assert len(options) == 2


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
    master.send(rev, kp, {'intent_id': 'legacy', 'question': '为什么？', 'review_mode': 'Standard'})
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
    master.send(rev, kp, {'intent_id': 'one', 'question': '为什么？', 'review_mode': 'Standard'})
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
    message, _ = master.repository.enqueue(
        rev, kp, 'pending', '问题', 'Standard', 'deepseek', 'deepseek-model', 'Quick'
    )
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


def test_migration_19_adds_reasoning_mode_without_changing_master_records(learning, service, tmp_path):
    f, master, _runtime, points = learning
    revision, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(revision, kp, {
        'intent_id': 'pre-19-message', 'question': '历史问题',
        'provider': 'deepseek', 'review_mode': 'Fast',
    })
    idle(master)
    path = tmp_path / 'master-v18.sqlite3'
    source = sqlite3.connect(service.database.path)
    destination = sqlite3.connect(path)
    try:
        source.backup(destination)
    finally:
        source.close()
        destination.close()
    with sqlite3.connect(path) as c:
        c.execute('DELETE FROM schema_migrations WHERE version=19')
        c.execute('ALTER TABLE master_messages DROP COLUMN reasoning_mode')
        before = {
            table: c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            for table in ('master_threads', 'master_topics', 'master_messages', 'learning_events', 'kp_status')
        }
    Database(path).initialize()
    backup = path.with_name(path.name + '.pre-migration-19.bak')
    assert backup.exists()
    with sqlite3.connect(backup) as c:
        assert 'reasoning_mode' not in {row[1] for row in c.execute('PRAGMA table_info(master_messages)')}
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    with Database(path).connect() as c:
        assert c.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 19
        assert {row['reasoning_mode'] for row in c.execute('SELECT reasoning_mode FROM master_messages')} == {'Quick'}
        assert {
            table: c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
            for table in before
        } == before
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not c.execute('PRAGMA foreign_key_check').fetchall()


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
    assert len(state['topics']) == 1
    assert state['topics'][0]['id'] == topic
    assert state['topics'][0]['state'] == 'RESOLVED'
    assert state['status'] == 'UNDERSTOOD'
    assert [message['content'] for message in runtime.calls[-1][1]['topic_messages']] == [
        '问题', '根据所附教材，这是该知识点的解释。补充解释：可以用日常例子理解。', '新的问题'
    ]


def test_stable_topic_migration_merges_references_and_preserves_state(learning, service, tmp_path):
    f, _, _, points = learning
    revision, kp = f['revision']['id'], points[0]['knowledge_point_id']
    path = tmp_path / 'stable-topic-v17.sqlite3'
    source = sqlite3.connect(service.database.path)
    destination = sqlite3.connect(path)
    try:
        source.backup(destination)
    finally:
        source.close()
        destination.close()
    with sqlite3.connect(path) as c:
        c.execute('DELETE FROM schema_migrations WHERE version=18')
        c.execute('DROP INDEX one_master_topic_per_thread')
        c.execute("CREATE UNIQUE INDEX one_active_master_topic ON master_topics(thread_id) WHERE state='ACTIVE'")
        c.execute("""INSERT INTO master_threads(id,book_source_revision_id,knowledge_point_id,created_at)
            VALUES ('thread',?,?,?)""", (revision, kp, '2026-01-01T00:00:00Z'))
        c.execute("INSERT INTO master_topics VALUES ('canonical','thread','RESOLVED','2026-01-01T00:00:01Z','2026-01-01T00:00:04Z','EXPLICIT_USER_EVIDENCE')")
        c.execute("INSERT INTO master_topics VALUES ('duplicate','thread','ACTIVE','2026-01-01T00:00:05Z',NULL,NULL)")
        rows = [
            ('user-one', 'canonical', 'one', 'user', '原问题', '2026-01-01T00:00:02Z', None),
            ('answer-one', 'canonical', 'one', 'assistant', '原回答', '2026-01-01T00:00:03Z', 'PASS'),
            ('user-two', 'duplicate', 'two', 'user', '后续问题', '2026-01-01T00:00:06Z', None),
            ('answer-two', 'duplicate', 'two', 'assistant', '后续回答', '2026-01-01T00:00:07Z', 'PASS'),
        ]
        for message_id, topic_id, intent, role, content, created_at, review_state in rows:
            c.execute("""INSERT INTO master_messages(
                id,thread_id,topic_id,intent_id,role,content,created_at,state,review_mode,review_state)
                VALUES (?,'thread',?,?,?,?,?,'COMPLETE','Standard',?)""",
                (message_id, topic_id, intent, role, content, created_at, review_state))
        c.execute("""INSERT INTO kp_status VALUES (?,?,'UNDERSTOOD','KP_EXPLICIT_UNDERSTOOD',?,?)""",
                  (kp, revision, '2026-01-01T00:00:04Z', '2026-01-01T00:00:04Z'))
        c.execute("""INSERT INTO learning_events(
            id,book_source_revision_id,knowledge_point_id,topic_id,event_type,status,created_at)
            VALUES ('event-one',?,?,'canonical','KP_EXPLICIT_UNDERSTOOD','UNDERSTOOD','2026-01-01T00:00:04Z')""", (revision, kp))
        c.execute("""INSERT INTO learning_events(
            id,book_source_revision_id,knowledge_point_id,topic_id,event_type,status,created_at)
            VALUES ('event-two',?,?,'duplicate','KP_EXPLICIT_UNCLEAR','NOT_FULLY_CLEAR','2026-01-01T00:00:05Z')""", (revision, kp))
        c.execute("INSERT INTO learning_memory VALUES ('memory',?,'MASTER','answer-two','2026-01-01T00:00:08Z')", (revision,))
    Database(path).initialize()
    backup = path.with_name(path.name + '.pre-migration-18.bak')
    assert backup.exists()
    with sqlite3.connect(backup) as c:
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert c.execute("SELECT COUNT(*) FROM master_topics WHERE thread_id='thread'").fetchone()[0] == 2
    with Database(path).connect() as c:
        topic = c.execute("SELECT * FROM master_topics WHERE thread_id='thread'").fetchone()
        assert tuple(topic[key] for key in ('id', 'state', 'resolved_at', 'resolved_by')) == ('canonical', 'ACTIVE', None, None)
        assert [tuple(row) for row in c.execute("SELECT id,topic_id,content FROM master_messages WHERE thread_id='thread' ORDER BY created_at")] == [
            ('user-one', 'canonical', '原问题'), ('answer-one', 'canonical', '原回答'),
            ('user-two', 'canonical', '后续问题'), ('answer-two', 'canonical', '后续回答')]
        assert [tuple(row) for row in c.execute("SELECT id,topic_id FROM learning_events WHERE knowledge_point_id=? ORDER BY created_at", (kp,))] == [
            ('event-one', 'canonical'), ('event-two', 'canonical')]
        assert tuple(c.execute("SELECT source_kind,source_id FROM learning_memory WHERE id='memory'").fetchone()) == ('MASTER', 'answer-two')
        assert c.execute('SELECT status FROM kp_status WHERE knowledge_point_id=?', (kp,)).fetchone()[0] == 'UNDERSTOOD'
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        assert c.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0] == 19
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("UPDATE learning_events SET topic_id='canonical' WHERE id='event-one'")
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO master_topics VALUES ('second','thread','ACTIVE','later',NULL,NULL)")


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
