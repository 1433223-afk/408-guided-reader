"""Verify actual Guide transport on the isolated real-book test Library."""
import json
import sqlite3
import sys
from pathlib import Path

from reader_service.teaching.evidence import build
from reader_service.teaching import writing_context
from reader_service.teaching.contracts import GENERATOR, draft_messages, validate_draft

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
            if call["body"]["messages"][0]["content"].startswith(GENERATOR):
                matches = []
                for sid in (ready_section, no_kp_section):
                    rev = connection.execute('SELECT book_source_revision_id FROM outline_nodes WHERE outline_node_id=?', (sid,)).fetchone()[0]
                    packet, ledger, _ = build(connection, rev, sid)
                    context, _, _ = writing_context.build(connection, rev, packet, ledger)
                    matches.append(draft_messages(GENERATOR, context)[1]['content'])
                assert call['body']['messages'][1]['content'] in matches
                assert call['body']['stream'] is True
                assert call['body']['stream_options'] == {'include_usage': True}
                if call['provider'] == 'openrouter':
                    assert call['body']['reasoning_effort'] == 'low'
                checked += 1
            continue  # Existing plain-text Assistant contract, checked by its own suite.
        if "source" not in payload or "evidence" not in payload["source"]:
            continue
        assert set(payload) in ({"source"}, {"source", "candidate"}, {"source", "rework"}, {"source", "draft"})
        section_id = payload["source"]["section"]["id"]
        assert section_id in {ready_section, no_kp_section}
        revision_id = connection.execute("SELECT book_source_revision_id FROM outline_nodes WHERE outline_node_id=?", (section_id,)).fetchone()[0]
        fresh, fresh_ledger, _ = build(connection, revision_id, section_id, use_kp=True)
        context, _, _ = writing_context.build(connection, revision_id, fresh, fresh_ledger)
        # Persisted ledgers remain authoritative for older published versions, even
        # after a source-ID implementation refinement. IDs cannot be client-authored.
        supplied = payload["source"]
        if 'draft' in payload:
            author_texts = []
            for prior in calls:
                if prior['body']['messages'][0]['content'].startswith(GENERATOR) and prior['body']['messages'][1]['content'] == draft_messages(GENERATOR, context)[1]['content']:
                    try:
                        author_texts.append(validate_draft(prior['answer'], fresh))
                    except ValueError:
                        pass  # Rejected author output must not become the assembly input.
            assert payload['draft'] in author_texts
        projected = writing_context.formatter_source(fresh, context)
        if 'candidate' in payload:
            expected_source = writing_context.review_source(projected, payload['candidate'])
        elif 'rework' in payload:
            expected_source = writing_context.rework_source(projected, payload['rework']['issues'], payload['rework']['modules'])
        else:
            expected_source = projected
        assert supplied['section'] == expected_source['section']
        assert supplied['evidence'] == expected_source['evidence']
        ledgers = [json.loads(r['sources_json']) for r in connection.execute('SELECT sources_json FROM teaching_assets WHERE section_node_id=? AND sources_json IS NOT NULL', (section_id,))]
        assert any({e['source_id'] for e in supplied['evidence']} <= set(ledger)
                   and all(ledger[e['source_id']]['quote'] == e['text'] for e in supplied['evidence']) for ledger in ledgers)
        assert call["body"]["stream"] is True
        assert call["body"]["stream_options"] == {"include_usage": True}
        expected_fields = {"model", "messages", "temperature", "max_tokens", "stream", "stream_options"}
        if call["provider"] == "openrouter" and "candidate" not in payload:
            expected_fields.add("reasoning_effort")
            assert call["body"]["reasoning_effort"] == "low"
        if call["provider"] == "openrouter":
            expected_fields.add("response_format")
            assert call["body"]["response_format"] == {"type": "json_object"}
        assert set(call["body"]) == expected_fields
        assert "Authorization" not in json.dumps(call["body"])
        assert "test-loopback-key" not in json.dumps(call["body"])
        checked += 1
    assert checked >= 6
    print(f"Actual Section-only generation/Review payloads verified: {checked}")
