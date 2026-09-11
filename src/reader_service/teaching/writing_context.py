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
    body, exam, removed = clean_body(packet, ledger)
    context = {"book_title": book[0], "chapter_title": packet.get("parent", {}).get("title"),
               "chapter_contents": [r["title"] for r in siblings],
               "current_section": packet["section"]["title"],
               "previous_section": previous["title"] if previous else None,
               "next_section": following["title"] if following else None,
               "body": body}
    if exam:
        context["textbook_exam_notes"] = exam
    excluded = {e["source_id"] for e in removed}
    lines = set(body.splitlines())
    # Internal formatter allowlist; draft_messages never sends these IDs to the author.
    context["body_source_ids"] = [e["source_id"] for e in packet["evidence"]
                                  if e["source_id"] not in excluded and e["text"].strip() in lines]
    # KP titles are deliberately omitted: they are optional, not a coverage requirement.
    used = {r["outline_node_id"]: r for r in siblings + [r for r in (previous, following) if r]}
    dependencies = [{k: r[k] for k in ("outline_node_id", "identity_revision")} for r in used.values()]
    return context, dependencies, removed


def formatter_source(packet, context):
    # Cite only untouched body lines. A partially removed exam sentence is not
    # relabelled as a new source; the original server-owned ledger remains intact.
    allowed = set(context["body_source_ids"])
    return {**packet, "evidence": [e for e in packet["evidence"] if e["source_id"] in allowed]}
