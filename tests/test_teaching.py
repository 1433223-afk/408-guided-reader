import copy
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from reader_service.agent_runtime import ProviderCompletion, ProviderFailure, ProviderFailureKind
from reader_service.jobs import JobRepository
from reader_service.teaching import evidence, writing_context
from reader_service.teaching.contracts import (GENERATOR, draft_messages, validate_guide, validate_review,
                                              validate_draft, validate_formatted)
from reader_service.teaching.service import TeachingService
from test_knowledge_map import build_fixture, claim_and_run


def candidate(packet):
    refs = [packet['evidence'][0]['source_id']]
    return {'modules': [
        {'id': 'm1', 'kind': 'article', 'title': '为什么需要新的表示', 'text': '现有办法在条件变化时不再适用，因此需要能够表达这些差异的表示。', 'source_ids': refs},
        {'id': 'm2', 'kind': 'article', 'title': '表示背后的约定', 'text': '新的表示回应了这个问题，也让我们看清条件与结果之间的联系。', 'source_ids': refs}]}


class Runtime:
    def provider_identity(self, provider):
        return provider, provider + '-model'

    def __init__(self):
        self.calls = []
        self.messages = []
        self.options = []
        self.fail_stage = None
        self.reject = False
        self.invalid = False
        self.edit_draft = False

    def complete_for_with_metadata(self, provider, messages, **kwargs):
        self.messages.append(copy.deepcopy(messages))
        self.options.append(copy.deepcopy(kwargs))
        if len(messages) == 2 and messages[0]['content'].startswith(GENERATOR):
            self.calls.append((provider, {'draft_request': messages[1]['content']}))
            if self.fail_stage == 'GENERATE':
                raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'timeout', '超时')
            text = '\n\n'.join(m['text'] for m in candidate({'evidence': [{'source_id': 's1'}]})['modules'])
            return ProviderCompletion(text, 1, None, {'provider': provider})
        payload = json.loads(messages[1]['content'])
        self.calls.append((provider, payload))
        review = 'candidate' in payload
        if self.fail_stage == ('REVIEW' if review else 'GENERATE'):
            raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'timeout', '超时')
        if review:
            value = {'verdict': 'FAIL' if self.reject else 'PASS', 'issues': []}
            if self.reject:
                value['issues'] = [{'module_id': 'm1', 'source_ids': payload['candidate']['modules'][0]['source_ids'], 'detail': '路线需要更具体'}]
        elif 'rework' in payload:
            value = {'modules': payload['rework']['modules']}
        else:
            value = candidate(payload['source'])
        if 'draft' in payload:
            value['modules'] = [{**value['modules'][0], 'text': payload['draft']}]
        if self.edit_draft and 'draft' in payload:
            value['modules'][0]['text'] += '装配擅自新增。'
        return ProviderCompletion('invalid' if self.invalid else json.dumps(value), 1, None, {'provider': provider, 'model': provider + '-model'})

    def stream_for_with_metadata(self, provider, messages, on_delta, on_reasoning_delta=None, **kwargs):
        completion = self.complete_for_with_metadata(provider, messages, **kwargs)
        if on_reasoning_delta and len(messages) == 2 and messages[0]['content'].startswith(GENERATOR):
            on_reasoning_delta('REAL_GUIDE_REASONING_CANARY')
        midpoint = max(1, len(completion.answer) // 2)
        on_delta(completion.answer[:midpoint])
        on_delta(completion.answer[midpoint:])
        return ProviderCompletion(completion.answer, completion.latency_ms, completion.usage,
                                  completion.effective_config, completion.response_metadata, 1)


@pytest.fixture
def guide(service):
    fixture = build_fixture(service)
    fixture['outline'].resolve_chapter_physical(fixture['revision']['id'], fixture['chapter']['outline_node_id'])
    runtime = Runtime()
    guide = TeachingService(service.database, runtime)
    rev, section = fixture['revision']['id'], fixture['sections'][0]['outline_node_id']
    return fixture, runtime, guide, rev, section


def drain(guide, limit=10):
    jobs = JobRepository(guide.database)
    for _ in range(limit):
        job = jobs.claim()
        if not job:
            return
        assert job['job_type'].startswith('TEACHING')
        guide.run_job(job)
        jobs.complete(job['id'])
    pytest.fail('Guide loop did not terminate')


def test_publish_retry_restart_atomic_replacement_and_replay(guide):
    fixture, runtime, g, rev, section = guide
    intent = str(uuid4())
    with ThreadPoolExecutor(5) as pool:
        results = list(pool.map(lambda _: g.request(rev, section, intent), range(10)))
    assert len({x['task']['id'] for x in results}) == 1
    assert all(x['published'] is None for x in results)
    drain(g)
    first = g.snapshot(rev, section)['published']
    assert first and len(runtime.calls) == 2
    assert g.request(rev, section, intent, regenerate=True)['task']['version'] == 1
    runtime.fail_stage = 'REVIEW'
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    failed = g.snapshot(rev, section)
    assert failed['published'] == first
    assert failed['task']['state'] == 'FAILED' and failed['task']['stage'] == 'REVIEW'
    assert failed['task']['semantic_rework_count'] == 0
    restarted = TeachingService(g.database, runtime)
    assert restarted.snapshot(rev, section) == failed
    runtime.fail_stage = None
    before = len(runtime.calls)
    restarted.retry(rev, section, failed['task']['id'])
    drain(restarted)
    # The unreviewed candidate is intentionally memory-only. A process restart
    # therefore regenerates before Review instead of recovering draft prose.
    assert len(runtime.calls) == before + 2
    assert restarted.snapshot(rev, section)['published']['version'] == 2
    with g.database.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM teaching_assets WHERE state='PUBLISHED'").fetchone()[0] == 2
        assert c.execute('SELECT COUNT(*) FROM section_guides').fetchone()[0] == 1
        assert not c.execute('PRAGMA foreign_key_check').fetchall()


def test_streamed_draft_is_memory_only_until_atomic_publication(guide):
    _, _, g, rev, section = guide
    view = g.request(rev, section, str(uuid4()))
    asset_id = view['task']['id']
    jobs = JobRepository(g.database)
    generation = jobs.claim()
    g.run_job(generation)
    jobs.complete(generation['id'])
    with g.database.connect() as c:
        row = c.execute('SELECT state,stage,content_json FROM teaching_assets WHERE id=?', (asset_id,)).fetchone()
        assert tuple(row) == ('IN_REVIEW', 'REVIEW', None)
    event = g.draft_event(rev, section, asset_id, -1, 0)
    assert event['type'] == 'draft' and event['stage'] == 'review'
    assert '现有办法' in event['text']
    assert event['reasoning'] == 'REAL_GUIDE_REASONING_CANARY'
    assert event['provider'] == g.provider
    snapshot = g.snapshot(rev, section)
    assert 'draft' not in snapshot and snapshot['published'] is None
    with g.database.connect() as c:
        stored = json.dumps(dict(c.execute('SELECT * FROM teaching_assets WHERE id=?', (asset_id,)).fetchone()), ensure_ascii=False)
        assert 'REAL_GUIDE_REASONING_CANARY' not in stored
    review = jobs.claim()
    g.run_job(review)
    jobs.complete(review['id'])
    assert g.draft_event(rev, section, asset_id, event['sequence'], 0)['type'] == 'complete'
    with g.database.connect() as c:
        row = c.execute('SELECT state,content_json FROM teaching_assets WHERE id=?', (asset_id,)).fetchone()
        assert row['state'] == 'PUBLISHED' and row['content_json']


def test_same_process_review_retry_reuses_private_candidate(guide):
    _, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    runtime.fail_stage = 'REVIEW'
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    failed = g.snapshot(rev, section)
    before = len(runtime.calls)
    runtime.fail_stage = None
    g.retry(rev, section, failed['task']['id'])
    drain(g)
    assert len(runtime.calls) == before + 1
    assert g.snapshot(rev, section)['published']['version'] == 2


def test_semantic_limit_targeted_rework_and_invalid_review(guide):
    _, runtime, g, rev, section = guide
    runtime.reject = True
    g.request(rev, section, str(uuid4()))
    drain(g)
    failed = g.snapshot(rev, section)
    assert failed['task']['terminal'] == 1 and failed['task']['semantic_rework_count'] == 3
    assert failed['published'] is None and len(runtime.calls) == 6
    for _, payload in runtime.calls:
        if 'rework' in payload:
            assert [m['id'] for m in payload['rework']['modules']] == ['m1']
    g.retry(rev, section, failed['task']['id'])
    drain(g)
    assert len(runtime.calls) == 6
    runtime.reject = False
    runtime.invalid = True
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    assert g.snapshot(rev, section)['task']['semantic_rework_count'] == 0
    assert g.snapshot(rev, section)['published'] is None


def test_packet_scope_optional_dependencies_and_staleness(guide):
    f, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    packet = runtime.calls[1][1]['source']
    assert set(packet) == {'section', 'evidence'}
    assert set(packet['section']) == {'id', 'title'}
    with g.database.connect() as c:
        row = c.execute('SELECT * FROM teaching_assets').fetchone()
        deps = json.loads(row['dependencies_json'])
        assert 'chapter_structure_version' not in deps
        ledger = json.loads(row['sources_json'])
        node = evidence.section(c, rev, section)
        assert all((node['start_page'], node['start_y']) <= (x['pdf_page_index'], sum(p[1] for p in x['quad']) / 4) < (node['end_page'], node['end_y']) for x in ledger.values())
        c.execute('UPDATE book_source_revisions SET foundation_version=foundation_version+1 WHERE id=?', (rev,))
    assert not g.snapshot(rev, section)['published']['stale']
    f['knowledge'].request_prepare(rev, f['chapter']['outline_node_id'])
    claim_and_run(f)
    assert not g.snapshot(rev, section)['published']['stale']
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    with g.database.connect() as c:
        row = c.execute('SELECT dependencies_json FROM teaching_assets ORDER BY version DESC LIMIT 1').fetchone()
        assert json.loads(row[0])['chapter_structure_version'] == 1
        c.execute('UPDATE chapter_preparations SET structure_version=structure_version+1')
    assert g.snapshot(rev, section)['published']['stale']


@pytest.mark.parametrize('change', ['unknown', 'page', 'quote', 'exam', 'locator', 'partial', 'url'])
def test_contract_rejects_untrusted_source_authority(guide, change):
    _, _, g, rev, section = guide
    with g.database.connect() as c:
        packet, _, _ = evidence.build(c, rev, section)
    value = candidate(packet)
    m = value['modules'][0]
    if change == 'unknown': m['source_ids'] = ['foreign']
    if change == 'page': m['text'] = '请看PDF第999页'
    if change == 'quote': m['text'] = '教材说“编造的逐字引文”'
    if change == 'exam': m['text'] = '这是高频常考重点'
    if change == 'locator': m['pdf_page_index'] = 99
    if change == 'partial': value['modules'] = []
    if change == 'url': m['text'] = '看 https://example.com'
    with pytest.raises(ValueError): validate_guide(value, packet)


def test_review_cannot_rewrite_and_guide_selection_has_no_pdf_authority(guide):
    _, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    payload = runtime.calls[-1][1]
    assert set(payload) == {'source', 'candidate'}
    with pytest.raises(ValueError):
        validate_review({'verdict': 'PASS', 'issues': [], 'replacement': 'x'}, payload['candidate'], payload['source'])
    view = g.snapshot(rev, section)
    context = g.selection_context(rev, section, view['published']['id'], 'm1', 0, 5)
    assert context['source_anchor'] == {}
    assert context['scope'].section_id == section
    assert 'AI 导读' in context['same_page_ocr_context']
    with g.database.connect() as c:
        for table in ('master_threads', 'learning_events', 'annotations'):
            assert c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0


def test_recovery_and_cascade(guide, service):
    f, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    jobs = JobRepository(g.database)
    assert jobs.claim()
    assert jobs.recover() == 1
    drain(g)
    service.delete_book(f['book']['id'])
    with g.database.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM teaching_assets').fetchone()[0] == 0
        assert c.execute('SELECT COUNT(*) FROM section_guides').fetchone()[0] == 0


def test_http_authorization_scope_and_no_candidate_egress(guide, service):
    from test_api import running_server, request_json
    from urllib.error import HTTPError
    f, runtime, g, rev, section = guide
    with running_server(service, teaching=g) as (url, token):
        endpoint = f'{url}/api/revisions/{rev}/sections/{section}/guide'
        with pytest.raises(HTTPError) as error:
            request_json(endpoint, 'wrong')
        assert error.value.code == 401
        _, result = request_json(endpoint + '/generate', token, method='POST', data=json.dumps({'intent_id': str(uuid4())}).encode())
        assert result['published'] is None and 'content_json' not in result['task']
        drain(g)
        _, result = request_json(endpoint, token)
        assert result['published'] and 'generator_json' not in result
        with pytest.raises(HTTPError):
            request_json(endpoint.replace(section, f['chapter']['outline_node_id']), token)


def test_http_guide_events_stream_real_draft_then_completes(guide, service):
    from test_api import running_server, request_json
    from urllib.request import Request, urlopen
    _, _, g, rev, section = guide
    with running_server(service, teaching=g) as (url, token):
        endpoint = f'{url}/api/revisions/{rev}/sections/{section}/guide'
        _, started = request_json(endpoint + '/generate', token, method='POST',
                                  data=json.dumps({'intent_id': str(uuid4())}).encode())
        opened = threading.Event()
        def receive():
            request = Request(endpoint + f"/events?asset_id={started['task']['id']}",
                              headers={'X-Reader-Token': token, 'Accept': 'text/event-stream'})
            with urlopen(request) as response:
                assert response.headers['Content-Type'].startswith('text/event-stream')
                opened.set()
                return response.read().decode('utf-8')
        with ThreadPoolExecutor(1) as pool:
            result = pool.submit(receive)
            assert opened.wait(2)
            drain(g)
            body = result.result(timeout=3)
        events = [json.loads(line.removeprefix('data: ')) for line in body.splitlines()
                  if line.startswith('data: ')]
        assert any(e['type'] == 'draft' and e.get('text') for e in events)
        assert any(e['type'] == 'draft' and e.get('stage') == 'review' for e in events)
        assert events[-1]['type'] == 'complete'


def test_publication_rollback_and_source_change_during_review(guide, monkeypatch):
    _, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    first = g.snapshot(rev, section)['published']
    # A failure of pointer replacement rolls back the candidate's PUBLISHED state too.
    with g.database.connect() as c:
        c.execute("CREATE TRIGGER injected_publication_failure BEFORE UPDATE ON section_guides BEGIN SELECT RAISE(ABORT,'injected'); END")
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    assert g.snapshot(rev, section)['published'] == first
    with g.database.connect() as c:
        assert c.execute("SELECT COUNT(*) FROM teaching_assets WHERE state='PUBLISHED'").fetchone()[0] == 1
        c.execute('DROP TRIGGER injected_publication_failure')
    normal = runtime.complete_for_with_metadata
    def mutate(*args, **kwargs):
        result = normal(*args, **kwargs)
        if 'candidate' in runtime.calls[-1][1]:
            with g.database.connect() as c:
                c.execute('UPDATE outline_nodes SET physical_revision=physical_revision+1 WHERE outline_node_id=?', (section,))
        return result
    monkeypatch.setattr(runtime, 'complete_for_with_metadata', mutate)
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    view = g.snapshot(rev, section)
    assert view['published']['id'] == first['id'] and view['published']['stale']
    assert view['task']['state'] == 'FAILED'


def test_sibling_scope_and_geometry_degradation(guide):
    f, runtime, g, rev, section = guide
    other = f['sections'][1]['outline_node_id']
    g.request(rev, section, str(uuid4()))
    drain(g)
    g.request(rev, other, str(uuid4()))
    drain(g)
    first = g.snapshot(rev, section)['published']
    sibling = g.snapshot(rev, other)['published']
    assert first and sibling
    with g.database.connect() as c:
        c.execute('UPDATE outline_nodes SET physical_revision=physical_revision+1 WHERE outline_node_id=?', (other,))
    assert not g.snapshot(rev, section)['published']['stale']
    assert g.snapshot(rev, other)['published']['stale']
    with g.database.connect() as c:
        anchor = json.loads(c.execute('SELECT sources_json FROM teaching_assets WHERE id=?', (first['id'],)).fetchone()[0])[first['content']['modules'][0]['source_ids'][0]]
        c.execute('UPDATE ocr_lines SET quad_json=? WHERE book_source_revision_id=? AND pdf_page_index=?', ('[[0,0],[0.1,0],[0.1,0.1],[0,0.1]]', rev, anchor['pdf_page_index']))
    after = g.snapshot(rev, section)['published']
    assert after['id'] == first['id'] and after['stale']
    assert not all(s['available'] for s in after['sources'].values())


def test_populated_migration_13_preserves_jobs_and_user_tables(tmp_path):
    from reader_service.library.database import Database, MIGRATIONS
    import sqlite3
    database = Database(tmp_path / 'old.sqlite3')
    with sqlite3.connect(database.path) as c:
        c.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)')
        for version, sql in MIGRATIONS:
            if version >= 14: break
            c.executescript(sql)
            c.execute('INSERT INTO schema_migrations VALUES (?)', (version,))
        c.execute("INSERT INTO books(id,title,status,created_at) VALUES ('b','fixture','ACTIVE','now')")
        c.execute("INSERT INTO book_source_revisions(id,book_id,blob_sha256,byte_size,page_geometry_json,label,page_count,status,created_at) VALUES ('r','b',?,100,'[]','fixture',2,'ACTIVE','now')", ('a'*64,))
        c.execute("INSERT INTO jobs(id,job_type,book_source_revision_id,page_start,page_end,foundation_version,status,priority,cancel_requested,attempts,created_at,updated_at) VALUES ('j','PAGE_PREPARE','r',0,0,1,'QUEUED',7,0,2,'now','now')")
        tables = ['books', 'book_source_revisions', 'jobs']
        before = {t: c.execute(f'SELECT * FROM {t}').fetchall() for t in tables}
    database.initialize()
    with database.connect() as c:
        for t in tables:
            assert [tuple(r) for r in c.execute(f'SELECT * FROM {t}')] == before[t]
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        assert c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'


def test_foundation_events_are_page_scoped_and_remain_stale_after_restore(guide):
    from test_knowledge_map import detected
    f, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    published = g.snapshot(rev, section)['published']
    repo = f['foundation'].repository
    # Changes in another Chapter must never invalidate this Guide.
    with g.database.connect() as c:
        c.execute("UPDATE ocr_pages SET status='PREPARING' WHERE book_source_revision_id=? AND pdf_page_index=5", (rev,))
    repo.publish_page(rev, 5, route='OCR', foundation_version=1, engine_profile='fixture:v2', lines=[detected('changed outside', .3)])
    assert not g.snapshot(rev, section)['published']['stale']
    with g.database.connect() as c:
        source_page = c.execute('SELECT MIN(pdf_page_index) FROM ocr_lines WHERE book_source_revision_id=?', (rev,)).fetchone()[0]
        c.execute("UPDATE ocr_pages SET status='PREPARING' WHERE book_source_revision_id=? AND pdf_page_index=?", (rev, source_page))
    repo.publish_page(rev, source_page, route='OCR', foundation_version=1, engine_profile='fixture:v2', lines=[detected('changed inside', .3)])
    assert g.snapshot(rev, section)['published']['stale']
    with g.database.connect() as c:
        events = [dict(r) for r in c.execute('SELECT * FROM foundation_events ORDER BY id')]
        assert [e['page_start'] for e in events] == [5, source_page]
        assert events[1]['foundation_version'] > events[0]['foundation_version']
        # Footprint events, not just current-value equality, determine staleness.
        deps = json.loads(c.execute('SELECT dependencies_json FROM teaching_assets WHERE id=?', (published['id'],)).fetchone()[0])
        for page in deps['pages_used']:
            rows = [dict(r) for r in c.execute('SELECT line_ordinal,text,quad_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=? ORDER BY line_ordinal', (rev, page['pdf_page_index']))]
            from reader_service.teaching.contracts import fingerprint
            page['fingerprint'] = fingerprint(rows)
        assert not evidence.current(c, deps)


def test_identical_evidence_republication_keeps_source_ids(guide):
    _, _, g, rev, section = guide
    with g.database.connect() as c:
        original, _, deps = evidence.build(c, rev, section)
        c.execute('UPDATE ocr_pages SET foundation_version=foundation_version+1 WHERE book_source_revision_id=?', (rev,))
        fresh, _, _ = evidence.build(c, rev, section)
        assert evidence.current(c, deps)
        assert fresh == original


def test_article_contract_has_no_route_exit_or_kp_checklist(guide):
    _, _, g, rev, section = guide
    with g.database.connect() as c:
        packet, _, _ = evidence.build(c, rev, section)
    value = candidate(packet)
    value['modules'] = value['modules'][:1]
    assert validate_guide(value, packet) == value
    value['modules'][0]['text'] = '文' * 4501
    with pytest.raises(ValueError):
        validate_guide(value, packet)


def test_editorial_instruction_preserves_source_and_review_boundary(guide):
    from reader_service.teaching.contracts import REVIEWER
    fixture, runtime, g, rev, section = guide
    with g.database.connect() as c:
        packet, _, _ = evidence.build(c, rev, section)
    g.request(rev, section, str(uuid4()))
    drain(g)
    written, reviewed = runtime.messages
    with g.database.connect() as c:
        _, ledger, _ = evidence.build(c, rev, section)
        context, _, _ = writing_context.build(c, rev, packet, ledger)
    assert written == draft_messages(GENERATOR, context)
    draft = '\n\n'.join(m['text'] for m in candidate(packet)['modules'])
    projected = writing_context.formatter_source(packet, context)
    assembled = writing_context.bind_draft(draft, projected, context)
    assert '\n\n'.join(module['text'] for module in assembled['modules']) == draft
    assert all(set(module['source_ids']) <= {e['source_id'] for e in projected['evidence']}
               for module in assembled['modules'])
    assert len(reviewed) == 2
    assert reviewed[0] == {'role': 'system', 'content': REVIEWER}
    review_payload = json.loads(reviewed[1]['content'])
    assert set(review_payload) == {'source', 'candidate'}
    assert review_payload['source'] == writing_context.review_source(projected, review_payload['candidate'])
    assert {e['source_id'] for e in review_payload['source']['evidence']} == {
        source_id for module in review_payload['candidate']['modules'] for source_id in module['source_ids']
    }
    assert g.snapshot(rev, section)['published'] is not None


def test_author_context_separates_appendices_furniture_and_exam_notes():
    lines = [('26', .07), ('26', .5), ('第2章 数据', .07),
             ('2.1.1 正文', .2), ('【例2.1】正文例题', .4), ('解：保留解答', .5),
             ('命题追踪', .5), ('编码比较（2024）', .5),
             ('统考大纲要求分析C', .9), ('第2章 数据', .07), ('语言转换。', .2),
             ('注意：不要死记。', .5), ('2.1.5 本节习题精选', .5), ('不要发送习题', .5),
             ('2.1.6 答案与解析', .5), ('不要发送答案', .5)]
    packet = {'parent': {'title': '第2章 数据'}, 'evidence': [
        {'source_id': str(i), 'text': t} for i, (t, _) in enumerate(lines)]}
    ledger = {str(i): {'quad': [[0, y]] * 4} for i, (_, y) in enumerate(lines)}
    body, notes, removed = writing_context.clean_body(packet, ledger)
    assert body == '26\n2.1.1 正文\n【例2.1】正文例题\n解：保留解答\n\n注意：不要死记。'
    assert notes == ['编码比较（2024）', '统考大纲要求分析C语言转换。']
    assert len(removed) == 9


def test_author_context_uses_only_directory_titles_outside_section(guide):
    _, _, g, rev, section = guide
    with g.database.connect() as c:
        packet, ledger, _ = evidence.build(c, rev, section)
        context, _, _ = writing_context.build(c, rev, packet, ledger)
    assert context['current_section'] == packet['section']['title']
    assert context['previous_section'] is None
    assert context['next_section'] == context['chapter_contents'][1]
    assert not {'kp_ledger', 'chapter_structure_version', 'evidence'} & context.keys()
    assert not any(e['source_id'] in draft_messages(GENERATOR, context)[1]['content'] for e in packet['evidence'])


def test_kp_author_input_uses_published_meanings_without_ocr(guide):
    fixture, _, g, rev, section = guide
    fixture['knowledge'].request_prepare(rev, fixture['chapter']['outline_node_id'])
    claim_and_run(fixture)
    with g.database.connect() as c:
        packet, ledger, _ = evidence.build(c, rev, section)
        context, _, _ = writing_context.build(c, rev, packet, ledger)
        expected = [dict(r) for r in c.execute('''SELECT title,
            one_sentence_definition AS one_sentence_meaning FROM knowledge_points
            WHERE book_source_revision_id=? AND primary_section_id=?
              AND chapter_structure_version=? ORDER BY order_index''',
            (rev, section, packet['chapter_structure_version']))]
        assert expected and context['published_kps'] == expected
        c.execute("UPDATE chapter_preparations SET status='FAILED' WHERE book_source_revision_id=?", (rev,))
        unavailable, _, _ = writing_context.build(c, rev, packet, ledger)
        assert unavailable['published_kps'] == []
    # A closed field allowlist must hold even if raw material is accidentally present.
    messages = draft_messages(GENERATOR, {**context, 'body': 'OCR_SECRET',
        'textbook_exam_notes': ['EXAM_NOISE'], 'body_source_ids': ['SOURCE_SECRET']})
    wire = json.dumps(messages, ensure_ascii=False)
    assert all(word not in wire for word in ('OCR_SECRET', 'EXAM_NOISE', 'SOURCE_SECRET'))
    supplied = json.loads(messages[1]['content'].split('当前节已发布知识骨架（仅供理解，不要求逐项覆盖）：\n')[1])
    assert supplied == expected


def test_directory_title_dependency_does_not_read_neighbor_body(guide):
    fixture, _, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    sibling = fixture['sections'][1]['outline_node_id']
    with g.database.connect() as c:
        row = c.execute('SELECT dependencies_json FROM teaching_assets WHERE section_node_id=?', (section,)).fetchone()
        deps = json.loads(row[0])
        dep = next(n for n in deps['outline_nodes_used'] if n['outline_node_id'] == sibling)
        assert set(dep) == {'outline_node_id', 'identity_revision'}
        c.execute('UPDATE outline_nodes SET identity_revision=identity_revision+1 WHERE outline_node_id=?', (sibling,))
    assert g.snapshot(rev, section)['published']['stale']


def test_writer_contract_retry_keeps_clean_system_and_context(guide):
    _, runtime, g, rev, section = guide
    original = runtime.complete_for_with_metadata
    count = 0
    def complete(provider, messages, **kwargs):
        nonlocal count
        result = original(provider, messages, **kwargs)
        if messages[0]['content'] == GENERATOR:
            count += 1
            if count == 1:
                return ProviderCompletion('高频', 1, None, {'provider': provider})
        return result
    runtime.complete_for_with_metadata = complete
    g.request(rev, section, str(uuid4()))
    drain(g)
    assert count == 2
    assert runtime.messages[0] == runtime.messages[1]
    assert g.snapshot(rev, section)['published'] is not None


@pytest.mark.parametrize('configured,expected', [(None, 'openrouter'), ('deepseek', 'deepseek')])
def test_guide_generator_route_respects_explicit_configuration(guide, monkeypatch, configured, expected):
    fixture, runtime, g, rev, section = guide
    if configured is None:
        monkeypatch.delenv('GUIDED_READER_SYSTEM_PROVIDER', raising=False)
    else:
        monkeypatch.setenv('GUIDED_READER_SYSTEM_PROVIDER', configured)
    monkeypatch.setenv('GUIDED_READER_REVIEW_PROVIDER', 'openrouter')
    selected = TeachingService(g.database, runtime)
    assert selected.provider == expected
    assert selected.reviewer == 'openrouter'


def test_guide_provider_override_does_not_change_inline_provider(guide, monkeypatch):
    _, runtime, g, _, _ = guide
    monkeypatch.setenv('GUIDED_READER_SYSTEM_PROVIDER', 'openrouter')
    monkeypatch.setenv('GUIDED_READER_GUIDE_PROVIDER', 'deepseek')
    selected = TeachingService(g.database, runtime)
    assert selected.provider == 'deepseek'
    assert selected.inline.provider == 'openrouter'


def test_guide_reasoning_does_not_change_review_call(guide, monkeypatch):
    fixture, runtime, g, rev, section = guide
    monkeypatch.setenv('GUIDED_READER_SYSTEM_PROVIDER', 'openrouter')
    selected = TeachingService(g.database, runtime)
    selected.request(rev, section, str(uuid4()))
    drain(selected)
    assert runtime.options[0]['reasoning_effort'] == 'low'
    assert runtime.options[1]['reasoning_effort'] is None
    assert runtime.options[0]['model'] == selected.generator_model
    assert runtime.options[1]['model'] is None


def test_numeric_meaning_is_not_mistaken_for_table_locator(guide):
    fixture, runtime, g, rev, section = guide
    with g.database.connect() as c:
        packet, _, _ = evidence.build(c, rev, section)
    value = candidate(packet)
    value['modules'][0]['text'] = '相同的位串按无符号整数解释时代表255，按有符号补码解释时代表负一。'
    validate_guide(value, packet)
    for text in ['参见表1', '教材表1说明了这个关系', '参见图1']:
        value['modules'][0]['text'] = text
        with pytest.raises(ValueError, match='定位'):
            validate_guide(value, packet)



def test_formatting_cannot_add_remove_reorder_or_rewrite_author_text():
    packet = {'evidence': [{'source_id': 's1', 'text': '材料'}]}
    value = candidate(packet)
    draft = '\n\n'.join(m['text'] for m in value['modules'])
    original_parts = copy.deepcopy(value['modules'])
    value['modules'] = [{**value['modules'][0], 'text': draft}]
    validate_formatted(value, draft, packet)
    for changed in (draft + '新增', draft[:-1], draft.replace('表示', '描述'),
                    '\n\n'.join(m['text'] for m in reversed(original_parts))):
        with pytest.raises(ValueError, match='装配改动'):
            validate_formatted(value, changed, packet)
    value['modules'][0]['source_ids'] = ['other-section']
    with pytest.raises(ValueError, match='来源'):
        validate_formatted(value, draft, packet)
    assert validate_draft(' “位串”与“数值”\r\n\r\n要分清。 ', packet) == '位串与数值\n\n要分清。'


def test_local_binding_failure_keeps_old_guide_and_retry_recovers(guide, monkeypatch):
    _, runtime, g, rev, section = guide
    g.request(rev, section, str(uuid4()))
    drain(g)
    old = g.snapshot(rev, section)['published']
    original = writing_context.bind_draft
    def fail_binding(*_args):
        raise ValueError('local binding failed')
    monkeypatch.setattr(writing_context, 'bind_draft', fail_binding)
    g.request(rev, section, str(uuid4()), regenerate=True)
    drain(g)
    failed = g.snapshot(rev, section)
    assert failed['published'] == old
    assert failed['task']['stage'] == 'GENERATE'
    assert failed['task']['semantic_rework_count'] == 0
    assert failed['task']['state'] == 'FAILED'
    monkeypatch.setattr(writing_context, 'bind_draft', original)
    g.retry(rev, section, failed['task']['id'])
    drain(g)
    assert g.snapshot(rev, section)['published']['version'] == 2


@pytest.mark.parametrize('guide_model,provider_model,expected', [
    (None, None, 'openai/gpt-6-astra'),
    (None, 'google/gemini-3.8-flash', None),
    ('custom-guide-model', 'provider-model', 'custom-guide-model')])
def test_guide_model_selection_respects_explicit_configuration(guide, monkeypatch, guide_model, provider_model, expected):
    _, runtime, g, _, _ = guide
    monkeypatch.setenv('GUIDED_READER_SYSTEM_PROVIDER', 'openrouter')
    for key, value in [('GUIDED_READER_GUIDE_MODEL', guide_model), ('GUIDED_READER_OPENROUTER_MODEL', provider_model)]:
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    assert TeachingService(g.database, runtime).generator_model == expected


def test_reading_emphasis_is_not_exam_weight():
    assert validate_draft('阅读时怎样抓重点：重点在于理解知识的联系。', {'evidence': []})
    for phrase in ('考试重点', '考研重点', '重点考查', '高频常考', '必考'):
        with pytest.raises(ValueError, match='考试权重'):
            validate_draft(phrase, {'evidence': []})
