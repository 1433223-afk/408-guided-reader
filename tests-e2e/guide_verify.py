"""Verify actual Guide transport on the isolated real-book test Library."""
import json
import sqlite3
import sys
from pathlib import Path

from reader_service.teaching.evidence import build

data_dir, ready_section, no_kp_section = sys.argv[1:4]
with sqlite3.connect(Path(data_dir) / "state.sqlite3") as connection:
    connection.row_factory = sqlite3.Row
    rows = connection.execute("SELECT * FROM teaching_assets WHERE state='PUBLISHED'").fetchall()
    assert any(r["section_node_id"] == ready_section and "chapter_structure_version" in json.loads(r["dependencies_json"]) for r in rows)
    assert any(r["section_node_id"] == no_kp_section and "chapter_structure_version" not in json.loads(r["dependencies_json"]) for r in rows)
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    calls = [json.loads(line) for line in (Path(data_dir) / "guide-calls.jsonl").read_text(encoding="utf-8").splitlines()]
    checked = 0
    for call in calls:
        try:
            payload = json.loads(call["body"]["messages"][1]["content"])
        except json.JSONDecodeError:
            continue  # Existing plain-text Assistant contract, checked by its own suite.
        if "source" not in payload or "evidence" not in payload["source"]:
            continue
        assert set(payload) in ({"source"}, {"source", "candidate"}, {"source", "rework"})
        section_id = payload["source"]["section"]["id"]
        assert section_id in {ready_section, no_kp_section}
        revision_id = connection.execute("SELECT book_source_revision_id FROM outline_nodes WHERE outline_node_id=?", (section_id,)).fetchone()[0]
        fresh, _, _ = build(connection, revision_id, section_id, use_kp="kp_ledger" in payload["source"])
        # Persisted ledgers remain authoritative for older published versions, even
        # after a source-ID implementation refinement. IDs cannot be client-authored.
        supplied = payload["source"]
        assert {k: v for k, v in supplied.items() if k != 'evidence'} == {k: v for k, v in fresh.items() if k != 'evidence'}
        assert [e['text'] for e in supplied['evidence']] == [e['text'] for e in fresh['evidence']]
        ledgers = [json.loads(r['sources_json']) for r in connection.execute('SELECT sources_json FROM teaching_assets WHERE section_node_id=? AND sources_json IS NOT NULL', (section_id,))]
        assert any(set(ledger) == {e['source_id'] for e in supplied['evidence']}
                   and all(ledger[e['source_id']]['quote'] == e['text'] for e in supplied['evidence']) for ledger in ledgers)
        assert call["body"]["stream"] is False
        assert set(call["body"]) == {"model", "messages", "temperature", "max_tokens", "stream"}
        assert "Authorization" not in json.dumps(call["body"])
        assert "test-loopback-key" not in json.dumps(call["body"])
        checked += 1
    assert checked >= 6
    print(f"Actual Section-only generation/Review payloads verified: {checked}")
