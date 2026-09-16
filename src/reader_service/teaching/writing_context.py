"""Reader-specific author input; the original evidence/Review packet stays intact."""
import re


def clean_body(packet, ledger):
    body, exam, removed = [], [], []
    appendix = False
    pending_exam = []
    for item in packet["evidence"]:
        text = item["text"].strip()
        compact = re.sub(r"\s+", "", text)
        anchor = ledger[item["source_id"]]
        y = sum(p[1] for p in anchor["quad"]) / 4
        # Only recognizable margin furniture, never arbitrary numbers/formula lines.
        margin = y < .09 or y > .94
        if margin and (re.fullmatch(r"\d{1,4}", compact)
                       or compact == re.sub(r"\s+", "", packet.get("parent", {}).get("title", ""))
                       or re.fullmatch(r"\d{4}年.*考研复习指导", compact)
                       or re.match(r"(?:ISBN|版权所有|翻印必究|Copyright\b)", text, re.I)):
            removed.append({**item, "reason": "page_furniture"})
            continue
        heading = re.fullmatch(r"(?:\d+(?:\.\d+)*\s*)?(?:本[节章])?(?:习题(?:精选)?|练习题|思考题|答案(?:与)?解析|参考答案)", compact)
        if heading:
            appendix = True
        elif re.match(r"^\d+\.\d+\.\d+\s+\S", text):
            appendix = False
        if appendix:
            removed.append({**item, "reason": "exercise_or_answer"})
            continue
        if compact.startswith("命题追踪"):
            pending_exam = [text[text.index("踪") + 1:].strip()]
        elif pending_exam:
            pending_exam.append(text)
        else:
            body.append(text)
            continue
        removed.append({**item, "reason": "exam_sidebar"})
        if re.search(r"[（(].*\d{4}.*[）)]\s*$", text):
            exam.append("".join(pending_exam))
            pending_exam = []
        elif len(pending_exam) >= 4:
            raise ValueError("教材考试提示边界不明确，未猜测或截断正文。")
    if pending_exam:
        raise ValueError("教材考试提示不完整，未猜测正文边界。")
    text = "\n".join(body)
    # Explicit exam commentary can span OCR lines/pages and share a sentence with prose.
    def separate(match):
        exam.append(match.group(0).lstrip("，").replace("\n", ""))
        return "。" if match.group(0).startswith("，") else ""
    text = re.sub(r"，?历年统考[^。]*。|统考大纲[^。]*。", separate, text)
    if not text.strip():
        raise ValueError("未找到可用于导读的教材正文。")
    return text.strip(), exam, removed


def build(connection, revision_id, packet, ledger):
    book = connection.execute("SELECT b.title FROM books b JOIN book_source_revisions r ON r.book_id=b.id WHERE r.id=?", (revision_id,)).fetchone()
    rows = [dict(r) for r in connection.execute("""SELECT n.* FROM outline_nodes n
        JOIN outline_nodes p ON p.outline_node_id=n.parent_id AND p.book_source_revision_id=n.book_source_revision_id
        WHERE n.book_source_revision_id=? AND n.kind='SECTION' AND p.kind='CHAPTER'
        ORDER BY p.order_index,n.order_index,n.outline_node_id""", (revision_id,))]
    current = next((i for i, r in enumerate(rows) if r["outline_node_id"] == packet["section"]["id"]), None)
    if current is None:
        raise ValueError("当前节缺少真实章节目录定位。")
    siblings = [r for r in rows if r["parent_id"] == rows[current]["parent_id"]]
    previous = rows[current - 1] if current else None
    following = rows[current + 1] if current + 1 < len(rows) else None
    body, _, removed = clean_body(packet, ledger)
    # The published semantic meaning is stored under its original database name.
    # Match the already-declared READY version; never pick unpublished/stale rows.
    raw_points = [dict(r) for r in connection.execute("""SELECT k.title,
        k.one_sentence_definition AS one_sentence_meaning,k.start_page,k.start_y FROM knowledge_points k
        JOIN chapter_preparations p ON p.book_source_revision_id=k.book_source_revision_id
          AND p.chapter_outline_node_id=k.chapter_outline_node_id
          AND p.structure_version=k.chapter_structure_version
        WHERE k.book_source_revision_id=? AND k.primary_section_id=?
          AND p.status='READY' AND k.chapter_structure_version=? ORDER BY k.order_index""",
        (revision_id, packet["section"]["id"], packet.get("chapter_structure_version")))]
    points = [{key: point[key] for key in ("title", "one_sentence_meaning")} for point in raw_points]
    context = {"book_title": book[0], "chapter_title": packet.get("parent", {}).get("title"),
               "chapter_contents": [r["title"] for r in siblings],
               "current_section": packet["section"]["title"],
               "previous_section": previous["title"] if previous else None,
               "next_section": following["title"] if following else None,
               "published_kps": points}
    excluded = {e["source_id"] for e in removed}
    lines = set(body.splitlines())
    # Internal formatter allowlist; draft_messages never sends these IDs to the author.
    context["body_source_ids"] = [e["source_id"] for e in packet["evidence"]
                                  if e["source_id"] not in excluded and e["text"].strip() in lines]
    allowed_anchors = [(source_id, ledger[source_id]) for source_id in context["body_source_ids"]]
    context["kp_sources"] = []
    for point in raw_points:
        if not allowed_anchors:
            break
        source_id, _ = min(allowed_anchors, key=lambda pair: (
            abs(pair[1]["pdf_page_index"] - point["start_page"]),
            abs(sum(p[1] for p in pair[1]["quad"]) / 4 - point["start_y"]),
        ))
        context["kp_sources"].append({
            "title": point["title"], "one_sentence_meaning": point["one_sentence_meaning"],
            "source_id": source_id,
        })
    # No OCR-derived exam notes: this experiment uses the published skeleton only.
    used = {r["outline_node_id"]: r for r in siblings + [r for r in (previous, following) if r]}
    dependencies = [{k: r[k] for k in ("outline_node_id", "identity_revision")} for r in used.values()]
    return context, dependencies, removed


def formatter_source(packet, context):
    """Return the smallest source projection needed to bind the draft.

    Page furniture, exercises, answers and exam sidebars are removed before any
    provider egress.  The source IDs still point at the original server-owned
    ledger; this projection neither mints nor remaps source authority.
    """
    allowed = set(context["body_source_ids"])
    return {
        "section": {key: packet["section"][key] for key in ("id", "title")},
        "evidence": [e for e in packet["evidence"] if e["source_id"] in allowed],
    }


def review_source(packet, candidate):
    """Project fresh evidence to exactly the sources cited by the candidate.

    Review still receives every source the candidate claims supports it, while
    avoiding a second copy of hundreds of unrelated OCR lines.  Validation uses
    the same projection, so an unknown or dropped source continues to fail closed.
    """
    cited = {
        source_id
        for module in candidate["modules"]
        for source_id in module["source_ids"]
    }
    return {
        "section": {key: packet["section"][key] for key in ("id", "title")},
        "evidence": [e for e in packet["evidence"] if e["source_id"] in cited],
    }


def rework_source(packet, issues, modules):
    """Keep targeted semantic rework on the evidence named by Review/current modules."""
    cited = {source_id for issue in issues for source_id in issue["source_ids"]}
    cited.update(source_id for module in modules for source_id in module["source_ids"])
    return {
        "section": dict(packet["section"]),
        "evidence": [item for item in packet["evidence"] if item["source_id"] in cited],
    }


def bind_draft(draft, packet, context):
    """Deterministically split an unchanged draft and bind real source IDs.

    This is storage/source assembly, not semantic authorship.  It replaces the
    model formatter that was both slow and capable of accidentally rewriting the
    already accepted Writer prose.
    """
    paragraphs = draft.split("\n\n")
    parts = []
    current = ""
    for paragraph in paragraphs:
        combined = paragraph if not current else current + "\n\n" + paragraph
        if current and len(combined) > 1400:
            parts.append(current)
            current = paragraph
        else:
            current = combined
    if current:
        parts.append(current)
    evidence = packet["evidence"]
    evidence_by_id = {item["source_id"]: item for item in evidence}

    def features(text):
        compact = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]+", "", text).casefold()
        return {compact[i:i + 2] for i in range(max(0, len(compact) - 1))}

    def source_ids(text):
        wanted = features(text)
        chosen = []
        scored_kps = sorted(context.get("kp_sources", []), key=lambda point: (
            -len(wanted & features(point["title"] + point["one_sentence_meaning"])),
            point["source_id"],
        ))
        for point in scored_kps:
            if len(wanted & features(point["title"] + point["one_sentence_meaning"])) <= 0:
                continue
            if point["source_id"] in evidence_by_id and point["source_id"] not in chosen:
                chosen.append(point["source_id"])
            if len(chosen) == 6:
                break
        scored_lines = sorted(evidence, key=lambda item: (
            -len(wanted & features(item["text"])), item["source_id"]
        ))
        for item in scored_lines:
            if item["source_id"] not in chosen:
                chosen.append(item["source_id"])
            if len(chosen) == 8:
                break
        return chosen

    title = (context["current_section"].strip().lstrip("*") + "导读")[-32:]
    return {"modules": [
        {"id": f"m{index}", "kind": "article", "title": title if index == 1 else "继续阅读",
         "text": text, "source_ids": source_ids(text)}
        for index, text in enumerate(parts, 1)
    ]}
