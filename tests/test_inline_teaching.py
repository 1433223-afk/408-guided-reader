import copy
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest

from reader_service.agent_runtime import ProviderCompletion, ProviderFailure, ProviderFailureKind
from reader_service.teaching import inline_contracts as contracts, inline_evidence
from reader_service.teaching.service import TeachingService
from reader_service.teaching.inline_service import InlineTeachingService
from reader_service.library.database import Database, MIGRATIONS
from test_teaching import guide, drain, Runtime as GuideRuntime


def candidate(packet):
    refs = [s['source_id'] for s in packet['evidence']]
    return {'items': [
        {'id': 'i1', 'kind': 'lead_in', 'target_id': refs[0], 'source_ids': refs[:1], 'text': '先留意概念成立的条件，再看下面怎样使用。', 'prompt': None, 'reference_thought': None},
        {'id': 'i2', 'kind': 'recall', 'target_id': refs[-1], 'source_ids': refs[:1], 'text': '停一停，用自己的话回想刚才的概念。', 'prompt': '这个概念在什么条件下适用？', 'reference_thought': '可以从前面的定义及其限制条件出发，核对自己的理解。'}]}


class Runtime:
    def __init__(self):
        self.calls = []
        self.fail_stage = None
        self.reject = False
        self.output = None
        self.review_output = None
        self.after_review = None

    def provider_identity(self, provider):
        return provider, 'test-model'

    def complete_for_with_metadata(self, provider, messages, **kwargs):
        payload = json.loads(messages[1]['content'])
        self.calls.append((provider, copy.deepcopy(payload), kwargs))
        review = 'candidate' in payload
        if self.fail_stage == ('REVIEW' if review else 'GENERATE'):
            raise ProviderFailure(ProviderFailureKind.TRANSIENT, 'timeout', '超时')
        value = candidate(payload['source']) if self.output is None else copy.deepcopy(self.output)
        if review:
            value = self.review_output or ({'verdict': 'FAIL', 'issues': [{'module_id': 'i1', 'source_ids': payload['source']['evidence'][:1] and [payload['source']['evidence'][0]['source_id']], 'detail': '提示时机不合适'}]} if self.reject else {'verdict': 'PASS', 'issues': []})
            if self.after_review:
                self.after_review()
        return ProviderCompletion(json.dumps(value), 1, None, {'provider': provider, 'model': 'test-model'})


@pytest.fixture
def inline(guide):
    f, _, g, rev, section = guide
    runtime = Runtime()
    return f, runtime, InlineTeachingService(g.database, runtime), rev, section


def test_publish_round_trip_no_kp_and_allowlisted_context(inline):
    _, r, g, rev, sec = inline
    g.request(rev, sec, str(uuid4()))
    assert not g.snapshot(rev, sec)['published']
    drain(g)
    pub = g.snapshot(rev, sec)['published']
    assert pub and len(r.calls) == 2
    assert len(pub['content']['items']) == 2
    with g.database.connect() as c:
        row = c.execute('SELECT * FROM inline_teaching_assets').fetchone()
        deps, anchors = json.loads(row['dependencies_json']), json.loads(row['sources_json'])
        assert 'chapter_structure_version' not in deps
        packet, ledger, _ = inline_evidence.build(c, rev, sec)
        for sid, anchor in pub['sources'].items():
            assert {k: v for k, v in anchor.items() if k != 'available'} == ledger[sid] == anchors[sid]
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
    for _, payload, options in r.calls:
        assert set(payload) in ({'source'}, {'source', 'candidate'})
        assert set(payload['source']) == {'section', 'parent', 'evidence'}
        assert all(set(s) == {'source_id', 'text'} for s in payload['source']['evidence'])
        assert options['interaction_id'].startswith('inline:')


def test_atomic_replacement_retry_replay_restart_and_guide_isolation(inline):
    _, r, g, rev, sec = inline
    guide_service = TeachingService(g.database, GuideRuntime())
    guide_service.request(rev, sec, str(uuid4())); drain(guide_service)
    old_guide = guide_service.snapshot(rev, sec)
    intent = str(uuid4())
    with ThreadPoolExecutor(4) as pool:
        attempts = list(pool.map(lambda _: g.request(rev, sec, intent), range(8)))
    assert len({s['task']['id'] for s in attempts}) == 1
    drain(g); first = g.snapshot(rev, sec)['published']
    r.fail_stage = 'REVIEW'
    g.request(rev, sec, str(uuid4()), regenerate=True); drain(g)
    failed = g.snapshot(rev, sec)
    assert failed['published'] == first and failed['task']['semantic_rework_count'] == 0
    restarted = InlineTeachingService(g.database, r)
    assert restarted.snapshot(rev, sec) == failed
    r.fail_stage = None
    before = len(r.calls)
    restarted.retry(rev, sec, failed['task']['id']); drain(restarted)
    assert len(r.calls) == before + 1
    assert restarted.snapshot(rev, sec)['published']['version'] == 2
    g.request(rev, sec, intent, regenerate=True)
    assert g.snapshot(rev, sec)['task']['version'] == 2
    assert guide_service.snapshot(rev, sec) == old_guide


def test_three_semantic_cycles_and_review_rewrite_never_pass(inline):
    _, r, g, rev, sec = inline
    r.reject = True
    g.request(rev, sec, str(uuid4())); drain(g)
    snap = g.snapshot(rev, sec)
    assert snap['task']['terminal'] == 1 and snap['task']['semantic_rework_count'] == 3
    assert not snap['published'] and len(r.calls) == 6
    g.retry(rev, sec, snap['task']['id']); drain(g)
    assert len(r.calls) == 6
    r.reject = False; r.review_output = {'verdict': 'PASS', 'issues': [], 'rewrite': 'new text'}
    g.request(rev, sec, str(uuid4()), regenerate=True); drain(g)
    assert not g.snapshot(rev, sec)['published']
    assert g.snapshot(rev, sec)['task']['semantic_rework_count'] == 0


@pytest.mark.parametrize('mutation', ['page', 'foreign', 'future_recall', 'duplicate_target', 'too_many', 'empty_text', 'bad_kind', 'duplicate_id'])
def test_invalid_candidate_fails_before_review(inline, mutation):
    _, r, g, rev, sec = inline
    with g.database.connect() as c: packet, _, _ = inline_evidence.build(c, rev, sec)
    value = candidate(packet)
    if mutation == 'page': value['items'][0]['pdf_page_index'] = 1
    if mutation == 'foreign': value['items'][0]['target_id'] = 'foreign'
    if mutation == 'future_recall':
        value['items'] = [value['items'][1]]; value['items'][0]['target_id'] = packet['evidence'][0]['source_id']; value['items'][0]['source_ids'] = [packet['evidence'][-1]['source_id']]
    if mutation == 'duplicate_target': value['items'][1]['target_id'] = value['items'][0]['target_id']
    if mutation == 'too_many': value['items'] *= 4
    if mutation == 'empty_text': value['items'][0]['text'] = ''
    if mutation == 'bad_kind': value['items'][0]['kind'] = 'quiz'
    if mutation == 'duplicate_id': value['items'][1]['id'] = 'i1'
    r.output = value
    g.request(rev, sec, str(uuid4())); drain(g)
    assert len(r.calls) == 2 and all('candidate' not in call[1] for call in r.calls)
    assert not g.snapshot(rev, sec)['published']


def test_no_intervention_is_reviewed_success(inline):
    _, r, g, rev, sec = inline
    r.output = {'items': []}
    g.request(rev, sec, str(uuid4())); drain(g)
    pub = g.snapshot(rev, sec)['published']
    assert pub['no_intervention'] and pub['content'] == {'items': []} and len(r.calls) == 2


def test_unresolved_and_foreign_rejected_before_provider(inline):
    _, r, g, rev, sec = inline
    with pytest.raises(LookupError): g.request(str(uuid4()), sec, str(uuid4()))
    with g.database.connect() as c: c.execute("UPDATE outline_nodes SET resolution_state='UNRESOLVED' WHERE outline_node_id=?", (sec,))
    with pytest.raises(ValueError): g.request(rev, sec, str(uuid4()))
    assert not r.calls


def test_stale_target_suppressed_no_fuzzy_reanchor(inline):
    _, _, g, rev, sec = inline
    g.request(rev, sec, str(uuid4())); drain(g)
    pub = g.snapshot(rev, sec)['published']; item = pub['content']['items'][0]
    anchor = pub['sources'][item['target_id']]
    with g.database.connect() as c:
        c.execute('UPDATE ocr_lines SET quad_json=? WHERE book_source_revision_id=? AND pdf_page_index=? AND text=?', ('[[0.5,0.5],[0.9,0.5],[0.9,0.6],[0.5,0.6]]', rev, anchor['pdf_page_index'], anchor['quote']))
    changed = g.snapshot(rev, sec)['published']
    assert changed['stale'] and changed['omitted_count'] >= 1
    assert all(i['id'] != item['id'] for i in changed['content']['items'])
    with pytest.raises(ValueError): g.selection_context(rev, sec, pub['id'], item['id'], 'text', 0, 2)


def test_source_change_during_review_cannot_publish(inline):
    _, r, g, rev, sec = inline
    def change():
        with g.database.connect() as c: c.execute('UPDATE outline_nodes SET physical_revision=physical_revision+1 WHERE outline_node_id=?', (sec,))
    r.after_review = change
    g.request(rev, sec, str(uuid4())); drain(g)
    assert not g.snapshot(rev, sec)['published']


def test_recall_selection_no_learning_writes_or_fake_anchor(inline):
    _, _, g, rev, sec = inline
    def learning_state():
        with g.database.connect() as c:
            names = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'") if any(s in r[0] for s in ('learning', 'master', 'status', 'annotation', 'chapter_preparation'))]
            return {name: [tuple(r) for r in c.execute(f'SELECT * FROM {name}')] for name in names}
    before = learning_state()
    g.request(rev, sec, str(uuid4())); drain(g)
    pub = g.snapshot(rev, sec)['published']
    for field in ('text', 'prompt', 'reference_thought'):
        ctx = g.selection_context(rev, sec, pub['id'], 'i2', field, 0, 2)
        assert ctx['source_anchor'] == {} and ctx['teaching_lineage']['asset_id'] == pub['id']
    assert learning_state() == before


def test_consumed_titles_and_parent_identity_not_unused_parent_range(inline):
    f, _, g, rev, sec = inline
    g.request(rev, sec, str(uuid4())); drain(g)
    with g.database.connect() as c:
        c.execute('UPDATE outline_nodes SET physical_revision=physical_revision+1 WHERE outline_node_id=?', (f['chapter']['outline_node_id'],))
    assert not g.snapshot(rev, sec)['published']['stale']
    with g.database.connect() as c:
        c.execute("UPDATE outline_nodes SET title=title||'新标题' WHERE outline_node_id=?", (sec,))
    assert g.snapshot(rev, sec)['published']['stale']


def test_ambiguous_geometry_is_not_offered_as_generator_target(inline):
    _, _, g, rev, sec = inline
    with g.database.connect() as c:
        packet, ledger, _ = inline_evidence.build(c, rev, sec)
        first = ledger[packet['evidence'][0]['source_id']]
        second = ledger[packet['evidence'][1]['source_id']]
        c.execute('UPDATE ocr_lines SET quad_json=? WHERE book_source_revision_id=? AND pdf_page_index=? AND text=?',
                  (json.dumps(first['quad']), rev, second['pdf_page_index'], second['quote']))
        packet, ledger, _ = inline_evidence.build(c, rev, sec)
        assert not any(a['quad'] == first['quad'] and a['pdf_page_index'] == first['pdf_page_index'] for a in ledger.values())


def test_worker_dispatch_recovery_and_owner_cascade(inline):
    _, r, g, rev, sec = inline
    from reader_service.jobs import JobRepository
    jobs = JobRepository(g.database)
    g.request(rev, sec, str(uuid4()))
    dispatcher = TeachingService(g.database, r)
    first = jobs.claim(); dispatcher.run_job(first); jobs.complete(first['id'])
    review_job = jobs.claim()
    assert review_job['job_type'] == 'TEACHING_REVIEW'
    # A process interruption after claim requeues the same durable candidate.
    jobs.recover()
    drain(dispatcher)
    assert g.snapshot(rev, sec)['published'] and len(r.calls) == 2
    with g.database.connect() as c:
        c.execute('DELETE FROM books WHERE id=(SELECT book_id FROM book_source_revisions WHERE id=?)', (rev,))
        assert c.execute('SELECT COUNT(*) FROM inline_teaching_assets').fetchone()[0] == 0
        assert c.execute('SELECT COUNT(*) FROM section_inline_teaching').fetchone()[0] == 0
        assert not c.execute('PRAGMA foreign_key_check').fetchall()


def test_additive_migration_preserves_existing_rows_and_pointers(guide, tmp_path):
    _, _, g, rev, sec = guide
    g.request(rev, sec, str(uuid4())); drain(g)
    # Recreate the actual v14 schema, copy its existing data, then migrate forward.
    old = tmp_path / 'v14.sqlite3'
    c = sqlite3.connect(old)
    for version, sql in MIGRATIONS:
        if version >= 15: break
        c.executescript(sql)
    c.execute('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY)')
    c.executemany('INSERT INTO schema_migrations VALUES (?)', [(v,) for v, _ in MIGRATIONS if v < 15]); c.commit(); c.close()
    # Use a real populated pre-v15 backup, removing only new empty schema on this disposable copy.
    with g.database.connect() as source:
        c = sqlite3.connect(old); source.backup(c)
        c.execute('DROP TABLE section_inline_teaching'); c.execute('DROP TABLE inline_teaching_assets'); c.execute('DELETE FROM schema_migrations WHERE version=15'); c.commit()
        baseline = {t: c.execute(f'SELECT * FROM {t}').fetchall() for t in ('teaching_assets', 'section_guides', 'jobs')}; c.close()
    db = Database(old); db.initialize()
    with db.connect() as c:
        assert {t: [tuple(r) for r in c.execute(f'SELECT * FROM {t}')] for t in baseline} == baseline
        assert not c.execute('PRAGMA foreign_key_check').fetchall()
        assert c.execute("SELECT count(*) FROM inline_teaching_assets").fetchone()[0] == 0
