import json
import math

from . import evidence
from .contracts import fingerprint
from .inline_contracts import SKILL_VERSION


def build(connection, revision_id, section_id):
    # This first slice has no KP-identity/boundary interventions. Do not read a KP
    # ledger merely because it is READY, or claim a dependency it never consumed.
    packet, ledger, deps = evidence.build(connection, revision_id, section_id, use_kp=False)
    deps["skill_version"] = SKILL_VERSION
    for node in deps["outline_nodes_used"]:
        supplied = packet["section"] if node["outline_node_id"] == section_id else packet["parent"]
        node["title_used"] = supplied["title"]
        if node["outline_node_id"] != section_id:
            # Parent positioning consumes its logical identity/title, never its range.
            node.pop("physical_revision", None)
    counts = {}
    geometry_counts = {}
    for source in packet["evidence"]:
        counts[source["source_id"]] = counts.get(source["source_id"], 0) + 1
    for anchor in ledger.values():
        geometry = fingerprint([anchor["pdf_page_index"], anchor["quad"]])
        geometry_counts[geometry] = geometry_counts.get(geometry, 0) + 1
    safe = {}
    for source_id, anchor in ledger.items():
        quad = anchor["quad"]
        if counts[source_id] != 1 or geometry_counts[fingerprint([anchor["pdf_page_index"], quad])] != 1 or len(quad) != 4 or any(len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in quad):
            continue
        if max(p[0] for p in quad) <= min(p[0] for p in quad) or max(p[1] for p in quad) <= min(p[1] for p in quad):
            continue
        safe[source_id] = {**anchor, "quote_fingerprint": fingerprint(anchor["quote"]), "section_node_id": section_id}
    packet["evidence"] = [s for s in packet["evidence"] if s["source_id"] in safe]
    if not safe:
        raise ValueError("本节没有可可靠定位的文字证据；原 PDF 仍可阅读。")
    return packet, safe, deps


def current(connection, deps):
    if not evidence.current(connection, deps, skill_version=SKILL_VERSION):
        return False
    for node in deps["outline_nodes_used"]:
        row = connection.execute("SELECT title FROM outline_nodes WHERE book_source_revision_id=? AND outline_node_id=?", (deps["book_source_revision_id"], node["outline_node_id"])).fetchone()
        if not row or row[0] != node["title_used"]:
            return False
    return True


def available(connection, anchor):
    node = evidence.section(connection, anchor["book_source_revision_id"], anchor["section_node_id"])
    point = (anchor["pdf_page_index"], sum(p[1] for p in anchor["quad"]) / 4)
    if node["resolution_state"] != "RESOLVED" or not (node["start_page"], node["start_y"]) <= point < (node["end_page"], node["end_y"]):
        return False
    if not evidence.safe_anchor(connection, anchor):
        return False
    # Exact unique geometry is authoritative. Never seek a lookalike elsewhere.
    rows = [r for r in connection.execute("SELECT text,quad_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=?", (anchor["book_source_revision_id"], anchor["pdf_page_index"])) if json.loads(r["quad_json"]) == anchor["quad"]]
    return len(rows) == 1 and fingerprint(rows[0]["text"]) == anchor["quote_fingerprint"]
