import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from urllib.error import HTTPError
from uuid import uuid4

import pytest

from reader_service.memory import LearningMemory
from reader_service.library.database import Database
from reader_service.annotation.repository import AnnotationRepository
from test_learning import learning, idle
from test_api import running_server, request_json
from conftest import make_pdf
from test_saved_explanations import services
from test_ask_about_this import assistant_fixture, selection, focused


def rows(database):
    with database.connect() as c:
        return {r[0]: [tuple(v) for v in c.execute(f'SELECT * FROM "{r[0]}" ORDER BY rowid')]
                for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('learning_memory', 'schema_migrations')")}


def master_answer(learning):
    f, master, runtime, points = learning
    revision, kp = f['revision']['id'], points[0]['knowledge_point_id']
    master.send(revision, kp, {'intent_id': 'memory-question', 'question': '为什么？', 'review_mode': 'Fast'})
    idle(master)
    return revision, master.snapshot(revision, kp)['messages'][-1]


def test_master_idempotency_no_copy_no_writes_restart_and_remove(learning, service):
    revision, answer = master_answer(learning)
    memory = LearningMemory(service.database)
    assert memory.list() == []
    before = rows(service.database)
    calls = len(learning[2].calls)
    with ThreadPoolExecutor(8) as pool:
        collected = list(pool.map(lambda _: memory.collect(revision, 'MASTER', answer['id']), range(16)))
    assert len({item['id'] for item in collected}) == 1
    item = memory.get(revision, collected[0]['id'])
    assert item['source']['content'] == answer['content']
    assert item['source']['question'] == '为什么？'
    assert item['knowledge_point']['id'] == learning[3][0]['knowledge_point_id']
    assert item['section']['id'] == learning[3][0]['primary_section_id']
    assert 'pdf_page_index' not in item['source']
    assert set(collected[0]) == {'id', 'book_source_revision_id', 'source_kind', 'source_id', 'created_at'}
    for review in ['PASS', 'FAIL', 'PENDING', 'NOT_REQUESTED', 'TECHNICAL_FAILURE']:
        with service.database.connect() as c:
            c.execute('UPDATE master_messages SET review_state = ? WHERE id = ?', (review, answer['id']))
        assert memory.get(revision, item['id'])['source']['review_state'] == review
    with service.database.connect() as c:
        c.execute('UPDATE master_messages SET review_state = ? WHERE id = ?', (answer['review_state'], answer['id']))
    Database(service.database.path).initialize()
    assert LearningMemory(Database(service.database.path)).get(revision, item['id']) == item
    memory.remove(revision, item['id']); memory.remove(revision, item['id'])
    assert memory.list() == []
    memory.collect(revision, 'MASTER', answer['id'])
    assert len(memory.list()) == 1
    assert rows(service.database) == before
    assert len(learning[2].calls) == calls


def test_ineligible_ownership_http_and_source_cascades(learning, service):
    revision, answer = master_answer(learning)
    memory = LearningMemory(service.database)
    pdf = make_pdf(((300, 300),))
    sibling = service.intake(BytesIO(pdf), content_length=len(pdf), filename='sibling.pdf')['book']
    sibling_revision = sibling['active_revision']['id']
    with pytest.raises(LookupError): memory.collect(sibling_revision, 'MASTER', answer['id'])
    snapshot = learning[1].snapshot(revision, learning[3][0]['knowledge_point_id'])
    with pytest.raises(LookupError): memory.collect(revision, 'MASTER', snapshot['messages'][0]['id'])
    for state in ['PENDING', 'FAILED']:
        with service.database.connect() as c:
            c.execute('UPDATE master_messages SET state = ? WHERE id = ?', (state, answer['id']))
        with pytest.raises(LookupError): memory.collect(revision, 'MASTER', answer['id'])
    with service.database.connect() as c: c.execute("UPDATE master_messages SET state='COMPLETE' WHERE id=?", (answer['id'],))
    with running_server(service) as (url, token):
        endpoint = f'{url}/api/revisions/{revision}/memory'
        data = json.dumps({'source_kind': 'MASTER', 'source_id': answer['id']}).encode()
        for method, route in [('POST', endpoint), ('GET', url+'/api/memory')]:
            with pytest.raises(HTTPError) as error: request_json(route, 'wrong', method=method, data=data if method == 'POST' else None)
            assert error.value.code == 401
        _, response = request_json(endpoint, token, method='POST', data=data)
        item = response['item']
        _, replay = request_json(endpoint, token, method='POST', data=data)
        assert replay == response
        with pytest.raises(HTTPError): request_json(endpoint, token, method='POST', data=json.dumps({'source_kind': 'MASTER', 'source_id': answer['id'], 'content': 'bypass'}).encode())
        wrong = f'{url}/api/revisions/{sibling_revision}/memory/{item["id"]}'
        with pytest.raises(HTTPError): request_json(wrong, token)
        request_json(wrong, token, method='DELETE')
        assert len(memory.list()) == 1
        with pytest.raises(HTTPError) as error: request_json(endpoint+'/'+item['id'], 'wrong', method='DELETE')
        assert error.value.code == 401
    before = service.repository.get_book(sibling['id'])
    service.delete_book(learning[0]['book']['id'])
    assert memory.list() == []
    assert service.repository.get_book(sibling['id']) == before


def test_assistant_must_save_first_and_annotation_cascade(assistant_fixture):
    assistant, annotations, saved, providers, adapters = services(assistant_fixture,
        assistant_answers=('完整的 **解释**，保持原文。',), review_answers=('{"verdict":"FAIL","summary":"有界审查未通过"}',))
    revision = assistant_fixture['revision_id']
    memory = LearningMemory(assistant_fixture['database'])
    state = assistant.ask_selection('memory-session', revision, 3, **selection(3))
    root = focused(state); turn = root['turns'][0]['turn_id']
    with pytest.raises(LookupError): memory.collect(revision, 'AI_SAVED', turn)
    result = saved.save(revision, reader_session_id='memory-session', root_id=root['root_id'], node_id=None, turn_id=turn, save_intent_id='memory-save')
    assert saved.wait_for_idle()
    annotation = annotations.get(revision, result['annotation']['id'])
    before = rows(assistant_fixture['database'])
    item = memory.collect(revision, 'AI_SAVED', annotation['id'])
    resolved = memory.get(revision, item['id'])
    assert resolved['source'] == annotation
    assert resolved['source']['verification_state'] == 'FAIL'
    assert resolved['knowledge_point'] is None
    memory.remove(revision, item['id'])
    assert annotations.get(revision, annotation['id']) == annotation
    assert rows(assistant_fixture['database']) == before
    memory.collect(revision, 'AI_SAVED', annotation['id'])
    annotations.delete(revision, annotation['id'])
    assert memory.list() == []


def test_populated_migration_preserves_every_existing_row(learning, service):
    revision, answer = master_answer(learning)
    repo = AnnotationRepository(service.database)
    repo.create(revision_id=revision, page_index=0, quads=[[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]], quote='source', context_before='', context_after='', foundation_version=1, body='user', highlight_style='YELLOW')
    repo.create_ai_saved(revision_id=revision, page_index=0, quads=[[[.1,.1],[.2,.1],[.2,.2],[.1,.2]]], quote='source', context_before='', context_after='', foundation_version=1, ai_content='exact', save_intent_id='saved-memory', provenance={}, source_grounding={})
    before = rows(service.database)
    with service.database.connect() as c:
        for trigger in ['memory_annotation_deleted', 'memory_master_deleted', 'memory_eligible_source', 'memory_relation_immutable']:
            c.execute(f'DROP TRIGGER {trigger}')
        c.execute('DROP TABLE learning_memory')
        c.execute('DELETE FROM schema_migrations WHERE version=16')
    service.database.initialize()
    assert rows(service.database) == before
    with sqlite3.connect(str(service.database.path)+'.pre-migration-16.bak') as backup:
        assert backup.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert backup.execute('SELECT count(*) FROM master_messages').fetchone()[0] == 2
    with service.database.connect() as c:
        assert c.execute('PRAGMA foreign_key_check').fetchall() == []
        with pytest.raises(sqlite3.IntegrityError):
            c.execute('INSERT INTO learning_memory VALUES (?, ?, ?, ?, ?)', (str(uuid4()), revision, 'MASTER', 'missing', 'now'))
