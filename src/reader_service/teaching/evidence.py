import json

from .contracts import SKILL_VERSION, fingerprint


def section(connection, revision_id, section_id):
    row = connection.execute("""SELECT n.* FROM outline_nodes n JOIN book_source_revisions r
        ON r.id=n.book_source_revision_id WHERE r.status='ACTIVE' AND n.book_source_revision_id=?
        AND n.outline_node_id=? AND n.kind='SECTION'""", (revision_id, section_id)).fetchone()
    if row is None:
        raise LookupError("真实节不存在。")
    return dict(row)


def build(connection, revision_id, section_id, *, use_kp=True):
    node = section(connection, revision_id, section_id)
    if node["resolution_state"] != "RESOLVED" or any(node[k] is None for k in ("start_page", "start_y", "end_page", "end_y")):
        raise ValueError("本节物理范围尚未确定；可继续阅读 PDF，稍后生成导读。")
    if node["end_page"] - node["start_page"] > 30:
        raise ValueError("本节超出单次导读的 31 页预算，未发送任何教材内容。")
    revision = dict(connection.execute("SELECT * FROM book_source_revisions WHERE id=?", (revision_id,)).fetchone())
    deps = {"book_source_revision_id": revision_id, "foundation_version": revision["foundation_version"],
            "skill_version": SKILL_VERSION, "outline_nodes_used": [], "pages_used": []}
    def node_dep(n):
        deps["outline_nodes_used"].append({k: n[k] for k in ("outline_node_id", "identity_revision", "physical_revision")})
    node_dep(node)
    packet = {"section": {"id": section_id, "title": node["title"],
              "physical_range": {k: node[k] for k in ("start_page", "start_y", "end_page", "end_y")}}, "evidence": []}
    parent = connection.execute("SELECT * FROM outline_nodes WHERE outline_node_id=? AND book_source_revision_id=?", (node["parent_id"], revision_id)).fetchone()
    if parent:
        parent = dict(parent)
        packet["parent"] = {"id": parent["outline_node_id"], "title": parent["title"]}
        node_dep(parent)
    ledger = {}
    length = 0
    for page_index in range(node["start_page"], node["end_page"] + 1):
        if page_index == node["end_page"] and node["end_y"] == 0:
            continue
        page = connection.execute("SELECT * FROM ocr_pages WHERE book_source_revision_id=? AND pdf_page_index=?", (revision_id, page_index)).fetchone()
        if page is None or page["status"] != "READY":
            raise ValueError("本节教材文字尚未准备完成；PDF 阅读不受影响，请稍后重试。")
        lines = [dict(r) for r in connection.execute("SELECT line_ordinal,text,quad_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=? ORDER BY line_ordinal", (revision_id, page_index))]
        deps["pages_used"].append({"pdf_page_index": page_index, "fingerprint": fingerprint(lines)})
        low = node["start_y"] if page_index == node["start_page"] else 0
        high = node["end_y"] if page_index == node["end_page"] else 1
        for line in lines:
            quad = json.loads(line["quad_json"])
            # Source ownership follows the resolved physical half-open interval.
            if not low <= sum(p[1] for p in quad) / 4 < high or not line["text"].strip():
                continue
            anchor = {"pdf_page_index": page_index, "quad": quad, "quote": line["text"],
                      "foundation_version": page["foundation_version"], "book_source_revision_id": revision_id}
            # Foundation ordering is provenance, not evidence identity. An identical
            # re-publication must not invalidate citations during stage-local retry.
            source_id = "s_" + fingerprint([section_id, {k: v for k, v in anchor.items() if k != "foundation_version"}])[:24]
            ledger[source_id] = anchor
            packet["evidence"].append({"source_id": source_id, "text": line["text"]})
            length += len(line["text"])
    if not ledger or length > 40000 or len(ledger) > 1600:
        raise ValueError("本节证据为空或超出单次导读预算；未截断或发送不完整的教材内容。")
    if use_kp and parent and parent["kind"] == "CHAPTER":
        prep = connection.execute("SELECT status,structure_version FROM chapter_preparations WHERE book_source_revision_id=? AND chapter_outline_node_id=?", (revision_id, parent["outline_node_id"])).fetchone()
        if prep and prep["status"] == "READY":
            points = [dict(r) for r in connection.execute("SELECT knowledge_point_id,title FROM knowledge_points WHERE book_source_revision_id=? AND primary_section_id=? AND chapter_structure_version=? ORDER BY order_index", (revision_id, section_id, prep["structure_version"]))]
            if points:
                packet["kp_ledger"] = points
                packet["chapter_structure_version"] = prep["structure_version"]
                deps["chapter_structure_version"] = prep["structure_version"]
                deps["chapter_outline_node_id"] = parent["outline_node_id"]
    return packet, ledger, deps


def current(connection, deps, *, skill_version=SKILL_VERSION):
    for event in connection.execute("SELECT page_start,page_end FROM foundation_events WHERE book_source_revision_id=? AND foundation_version>?",
                                    (deps["book_source_revision_id"], deps["foundation_version"])):
        if any(event["page_start"] <= page["pdf_page_index"] <= event["page_end"] for page in deps["pages_used"]):
            return False
    for node in deps["outline_nodes_used"]:
        row = connection.execute("SELECT identity_revision,physical_revision FROM outline_nodes WHERE book_source_revision_id=? AND outline_node_id=?", (deps["book_source_revision_id"], node["outline_node_id"])).fetchone()
        if row is None or any(row[k] != node[k] for k in ("identity_revision", "physical_revision") if k in node):
            return False
    for page in deps["pages_used"]:
        rows = [dict(r) for r in connection.execute("SELECT line_ordinal,text,quad_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=? ORDER BY line_ordinal", (deps["book_source_revision_id"], page["pdf_page_index"]))]
        if fingerprint(rows) != page["fingerprint"]:
            return False
    if "chapter_structure_version" in deps:
        row = connection.execute("SELECT structure_version FROM chapter_preparations WHERE book_source_revision_id=? AND chapter_outline_node_id=?", (deps["book_source_revision_id"], deps["chapter_outline_node_id"])).fetchone()
        if row is None or row[0] != deps["chapter_structure_version"]:
            return False
    return deps["skill_version"] == skill_version


def safe_anchor(connection, anchor):
    # Never remap a saved source ID to new geometry after OCR reprocessing.
    page = connection.execute("SELECT status FROM ocr_pages WHERE book_source_revision_id=? AND pdf_page_index=?", (anchor["book_source_revision_id"], anchor["pdf_page_index"])).fetchone()
    if page is None or page[0] != "READY":
        return False
    return any(json.loads(row["quad_json"]) == anchor["quad"] for row in connection.execute(
        "SELECT quad_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=?",
        (anchor["book_source_revision_id"], anchor["pdf_page_index"])))
