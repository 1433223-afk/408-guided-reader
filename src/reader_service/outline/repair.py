"""Explicit offline additive repair; never called by normal bootstrap.

The caller stages the complete database and owns backup / concurrent-write checks.
Existing nodes may be corrected in place, but may not disappear or change owner.
"""

from __future__ import annotations

import json

from .repository import now
from .service import PARSER_VERSION, _digest


def merge_preserving_assets(outline, revision_id: str, raw: list[dict]) -> dict:
    repository = outline.repository
    existing = repository.list(revision_id)
    old = {n["outline_node_id"]: n for n in existing}
    nodes = outline._build_nodes(revision_id, "TOC", raw)
    outline._apply_safe_targets(revision_id, nodes)
    new = {n["outline_node_id"]: n for n in nodes}
    if not old or not nodes or not old.keys() <= new.keys():
        missing = [n["title"] for key, n in old.items() if key not in new]
        raise RuntimeError(
            f"Asset-preserving repair requires every existing identity to survive: {missing}"
        )
    for key, before in old.items():
        if any(before[k] != new[key][k] for k in ("parent_id", "kind", "depth")):
            raise RuntimeError(
                "Asset-preserving repair refuses reparenting or kind changes"
            )
    stamp = now()
    changed = set()
    with repository.database.connect() as c:
        c.execute("BEGIN IMMEDIATE")
        # Vacate sibling order slots inside the transaction before interleaving
        # new auxiliary rows. IDs/FKs never move and no deletion cascade runs.
        temporary_offset = max(n["order_index"] for n in existing) + len(nodes) + 1
        c.execute(
            "UPDATE outline_nodes SET order_index=order_index+? WHERE book_source_revision_id=?",
            (temporary_offset, revision_id),
        )
        for n in nodes:
            key = n["outline_node_id"]
            if key not in old:
                c.execute(
                    """INSERT INTO outline_nodes(outline_node_id,book_source_revision_id,
                    parent_id,depth,order_index,kind,title,printed_label_hint,start_page,
                    resolution_state,confidence,evidence_json,identity_revision,physical_revision)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1)""",
                    (
                        key,
                        revision_id,
                        n["parent_id"],
                        n["depth"],
                        n["order_index"],
                        n["kind"],
                        n["title"],
                        n["printed_label_hint"],
                        n["start_page"],
                        "PARTIAL" if n["start_page"] is not None else "UNRESOLVED",
                        n["confidence"],
                        json.dumps(n["evidence"], ensure_ascii=False),
                    ),
                )
                continue
            before = old[key]
            # Preserve prior range until the scoped physical pass below recomputes it.
            evidence = {**before["evidence"], **n["evidence"]}
            c.execute(
                """UPDATE outline_nodes SET order_index=?,title=?,printed_label_hint=?,
                         confidence=?,evidence_json=? WHERE outline_node_id=? AND book_source_revision_id=?""",
                (
                    n["order_index"],
                    n["title"],
                    n["printed_label_hint"],
                    n["confidence"],
                    json.dumps(evidence, ensure_ascii=False),
                    key,
                    revision_id,
                ),
            )
            if n["start_page"] != before["start_page"]:
                changed.add(key)
                c.execute(
                    """UPDATE outline_nodes SET start_page=?,start_y=NULL,end_page=NULL,end_y=NULL,
                    resolution_state=?,physical_revision=physical_revision+1 WHERE outline_node_id=?""",
                    (
                        n["start_page"],
                        "PARTIAL" if n["start_page"] is not None else "UNRESOLVED",
                        key,
                    ),
                )
        c.execute(
            """UPDATE outline_bootstrap_records SET parser_version=?,evidence_source='TOC',
                     evidence_digest=?,structure_digest=?,last_conflict_digest=NULL WHERE book_source_revision_id=?""",
            (
                PARSER_VERSION,
                _digest(raw),
                outline._structure_digest(nodes),
                revision_id,
            ),
        )
    # Recompute only ranges which were already resolved. No eager KP/AI work.
    for chapter in existing:
        if chapter["kind"] == "CHAPTER" and chapter["resolution_state"] == "RESOLVED":
            outline.resolve_chapter_physical(revision_id, chapter["outline_node_id"])
    current = {n["outline_node_id"]: n for n in repository.list(revision_id)}
    for key, before in old.items():
        if any(
            before[k] != current[key][k]
            for k in ("start_page", "start_y", "end_page", "end_y")
        ):
            changed.add(key)
    affected = set()
    for key in changed | (new.keys() - old.keys()):
        node = current[key]
        while node and node["kind"] != "CHAPTER":
            node = current.get(node["parent_id"])
        if node:
            affected.add(node["outline_node_id"])
    with repository.database.connect() as c:
        for key in affected:
            prep = c.execute(
                """SELECT structure_version FROM chapter_preparations
                WHERE book_source_revision_id=? AND chapter_outline_node_id=? AND status='READY' """,
                (revision_id, key),
            ).fetchone()
            if prep:
                evidence = current[key]["evidence"]
                evidence["asset_review"] = {
                    "reason": "OUTLINE_EVIDENCE_CORRECTED",
                    "at": stamp,
                    "structure_version": prep[0],
                }
                c.execute(
                    "UPDATE outline_nodes SET evidence_json=? WHERE outline_node_id=?",
                    (json.dumps(evidence, ensure_ascii=False), key),
                )
        if (
            c.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
            or c.execute("PRAGMA foreign_key_check").fetchall()
        ):
            raise RuntimeError("Staged repair failed database integrity checks")
    return {
        "added_nodes": len(new.keys() - old.keys()),
        "preserved_ids": len(old),
        "changed_ranges": len(changed),
        "affected_chapters": sorted(affected),
    }
