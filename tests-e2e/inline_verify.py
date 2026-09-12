"""Inspect an isolated real-book run; never print textbook content or keys."""
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

root = Path(sys.argv[1])
c = sqlite3.connect(root / 'state.sqlite3')
c.row_factory = sqlite3.Row
tables = ['master_topics', 'master_messages', 'master_threads', 'kp_status',
          'section_learning_states', 'learning_events', 'annotations', 'teaching_assets', 'section_guides']
state = {t: hashlib.sha256(json.dumps(sorted([tuple(r) for r in c.execute(f'SELECT * FROM {t}')], key=str), ensure_ascii=False).encode()).hexdigest() for t in tables}
state['locks'] = [tuple(r) for r in c.execute('SELECT book_source_revision_id,chapter_outline_node_id,learning_state_ever_at FROM chapter_preparations ORDER BY book_source_revision_id,chapter_outline_node_id')]
baseline = root / 'inline-baseline.json'
if sys.argv[-1] == '--baseline':
    state['_inline_assets'] = {r['id']: list(r) for r in c.execute("SELECT * FROM inline_teaching_assets WHERE state='PUBLISHED'")}
    baseline.write_text(json.dumps(state), encoding='utf-8')
    sys.exit(0)
saved = json.loads(baseline.read_text(encoding='utf-8'))
existing = saved.pop('_inline_assets', {})
assert json.loads(json.dumps(state)) == saved, 'Learning, Guide or permanent lock mutated'
for asset_id, original in existing.items():
    assert list(c.execute('SELECT * FROM inline_teaching_assets WHERE id=?', (asset_id,)).fetchone()) == original, 'Existing published Inline asset changed'
rows = c.execute("SELECT * FROM inline_teaching_assets WHERE state='PUBLISHED'").fetchall()
new_rows = [r for r in rows if r['id'] not in existing]
assert len(new_rows) == 3
for row in new_rows:
    assert row['review_verdict'] == 'PASS'
    assert 'chapter_structure_version' not in json.loads(row['dependencies_json'])
assert not c.execute('PRAGMA foreign_key_check').fetchall()
calls = [json.loads(line) for line in (root / 'guide-calls.jsonl').read_text(encoding='utf-8').splitlines()]
teaching = 0
for call in calls:
    try: payload = json.loads(call['body']['messages'][1]['content'])
    except (ValueError, KeyError): continue
    if 'source' not in payload: continue
    teaching += 1
    assert set(payload) in ({'source'}, {'source', 'candidate'}, {'source', 'rework'})
    assert set(payload['source']) == {'section', 'parent', 'evidence'}
    assert all(set(e) == {'source_id', 'text'} for e in payload['source']['evidence'])
assert teaching >= 6
print('PASS: actual payload allowlists, publication, no KP dependency, no learning/Guide/lock writes')
