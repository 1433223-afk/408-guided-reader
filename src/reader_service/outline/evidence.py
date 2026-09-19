"""Conservative source-evidence checks; no persistent identities or OCR writes."""

from __future__ import annotations

import re
from itertools import pairwise

ORDINAL = r"[0-9一二三四五六七八九十百千零〇两]+"
NAMED = re.compile(rf"^第\s*({ORDINAL})\s*([篇部章节])\s*(.+)$")
LEADER = re.compile(r"[.．·…⋯。_—-]{2,}")
PAGE_LABEL = re.compile(r"^[\s·.\-—…]*(?:\(?\s*(\d{1,4})\s*\)?)[\s·.\-—…]*$")
AUXILIARY = re.compile(
    r"^(?:封面|书名|扉页|版权(?:页|信息)?|前言|序言|序|致读者|目录|目次|(?:主要)?参考(?:文献|资料)|索引|(?:再版|第[一二三四五六七八九十0-9]+版)?后记|附录.*)$"
)
CHAPTER_EXTRAS = {
    "引言": "OTHER",
    "本章总结": "OTHER",
    "本章小结": "OTHER",
    "小结": "OTHER",
    "思考与练习": "EXERCISES",
    "习题": "EXERCISES",
    "复习思考题": "EXERCISES",
    "本章练习": "EXERCISES",
}


def ordinal(value: str) -> int:
    if value.isdigit():
        return int(value)
    digits = dict(zip("零〇一二三四五六七八九两", (0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2)))
    total = current = 0
    for character in value:
        if character in digits:
            current = digits[character]
        else:
            total += (current or 1) * {"十": 10, "百": 100, "千": 1000}[character]
            current = 0
    return total + current


def parse_named_toc(page_index: int, lines: list[dict], normalize) -> list[dict]:
    """Chinese named hierarchy; joins OCR fragments only within a visual row."""
    positioned = []
    for line in lines:
        xs, ys = zip(*line["quad"])
        y = (min(ys) + max(ys)) / 2
        if 0.04 < y < 0.97:
            positioned.append(
                {
                    **line,
                    "x": min(xs),
                    "right": max(xs),
                    "y": y,
                    "text": normalize(line["text"]),
                }
            )
    groups = []
    for line in sorted(positioned, key=lambda x: (x["y"], x["x"])):
        if not groups or abs(line["y"] - groups[-1][0]["y"]) > 0.008:
            groups.append([])
        groups[-1].append(line)
    results = []
    page_evidence = 0
    for group in groups:
        ordered = sorted(group, key=lambda x: x["x"])
        label = None
        fragments = []
        for fragment in ordered:
            value = fragment["text"]
            matches = list(re.finditer(r"\(\s*(\d{1,4})\s*\)", value))
            if matches:
                label = matches[-1][1]
                value = re.sub(r"\(\s*\d{1,4}\s*\)", "", value)
            elif fragment["x"] > 0.72 and (match := PAGE_LABEL.fullmatch(value)):
                label = match[1]
                value = ""
            value = LEADER.split(value)[0].strip(" …·.")
            if not value or not any(c.isalnum() for c in value):
                continue
            if (
                re.fullmatch(r"[()\d]+",value) or re.fullmatch(r"([A-Za-z])\1{2,}", value)
            ) and fragment["confidence"] < 0.8:
                continue  # Low-confidence leader residue, not title text.
            # Alternate detector crops can overlap a title. Deduplicate only
            # textual containment within the SAME visual row, never across rows.
            if any(value == v or value in v for v in fragments):
                continue
            fragments = [v for v in fragments if v not in value]
            fragments.append(value)
        text = " ".join(fragments)
        if label is not None:
            page_evidence += 1
        # Detached leader noise is not part of a title. Keep adjacent text
        # fragments, including separate ordinal/title detections; stop at a gap
        # larger than ordinary inter-word space before the right-hand page label.
        text = LEADER.split(text)[0].strip().rstrip("…·.")
        if text in ("目录", "目次"):
            continue  # Page heading/running header, not a directory entry.
        named = NAMED.fullmatch(text)
        if not named:
            if text not in CHAPTER_EXTRAS and not AUXILIARY.fullmatch(text):
                continue
            number, unit, title = (
                "0",
                ("附属" if text in CHAPTER_EXTRAS else "其他"),
                text,
            )
        else:
            number, unit, title = named.groups()
        results.append(
            {
                "key": f"named:{unit}:{title if unit in ('附属', '其他') else ordinal(number)}",
                "title": title
                if unit in ("附属", "其他")
                else f"第{number}{unit} {title.strip()}",
                "depth": 0,
                "named_unit": unit,
                "named_number": ordinal(number),
                "printed_label_hint": label,
                "start_page": None,
                "confidence": min(float(x["confidence"]) for x in group),
                "evidence": {
                    "source": "TOC",
                    "pdf_page_index": page_index,
                    "line_ordinals": [x["line_ordinal"] for x in group],
                },
            }
        )
    # Body headings alone are not TOC evidence.
    return results if page_evidence >= 3 else []


def named_hierarchy(rows: list[dict]) -> list[dict]:
    """Scope repeated section ordinals to the owning chapter, across page breaks."""
    if not any("named_unit" in r for r in rows):
        return rows
    has_parts = any(r.get("named_unit") in ("篇", "部") for r in rows)
    part = chapter = None
    chapter_number = section_number = part_number = 0
    new_part = False
    result = []
    for row in rows:
        unit, number = row.get("named_unit"), row.get("named_number")
        if unit in ("篇", "部"):
            if number != part_number + 1:
                return []
            part_number = number
            part = row["key"]
            chapter = None
            new_part = True
            row = {**row, "depth": 0, "kind": "OTHER"}
        elif unit == "章":
            # Missing chapter evidence must not silently absorb its sections.
            if (number != chapter_number + 1 and not (new_part and number == 1)) or (
                has_parts and part is None
            ):
                return []
            chapter_number, section_number = number, 0
            new_part = False
            chapter = f"{part}/{row['key']}" if has_parts else row["key"]
            row = {**row, "key": chapter, "depth": int(has_parts), "kind": "CHAPTER"}
        elif unit == "节":
            if chapter is None or number != section_number + 1:
                return []
            section_number = number
            row = {
                **row,
                "key": f"{chapter}/{row['key']}",
                "depth": int(has_parts) + 1,
                "kind": "SECTION",
            }
        elif unit == "附属":
            if chapter is None:
                continue  # Continuation page: never assign it to an invented chapter.
            row = {
                **row,
                "key": f"{chapter}/exercises"
                if CHAPTER_EXTRAS[row["title"]] == "EXERCISES"
                else f"{chapter}/{row['key']}",
                "depth": int(has_parts) + 1,
                "kind": CHAPTER_EXTRAS[row["title"]],
            }
        elif unit == "其他":
            row = {**row, "depth": 0, "kind": "OTHER"}
        else:
            return []
        result.append(row)
    return result


def usable_bookmarks(raw: list[dict]) -> bool:
    """Reject page-index exports, not legitimate short/numeric chapter titles."""
    if not raw:
        return False
    numbered = [x for x in raw if re.fullmatch(r"(?:第\s*)?\d+\s*(?:页)?", x["title"])]
    # A flat sequence of page labels is navigation metadata, not a chapter tree.
    if len(numbered) >= 5 and len(numbered) >= len(raw) * 0.7:
        adjacent = sum(
            a.get("start_page") is not None
            and b.get("start_page") == a["start_page"] + 1
            for a, b in pairwise(numbered)
        )
        if adjacent >= (len(numbered) - 1) * 0.8:
            return False
    return True


def chapter_boundary(nodes: list[dict], chapter: dict) -> dict | None:
    """Next node outside the chapter's subtree, regardless of container depth."""
    index = next(
        i
        for i, n in enumerate(nodes)
        if n["outline_node_id"] == chapter["outline_node_id"]
    )
    for node in nodes[index + 1 :]:
        if node["depth"] <= chapter["depth"]:
            if node["kind"] == "OTHER" and node.get("start_page") is None:
                continue  # A non-learning grouping container need not have a page label.
            # Never skip an unresolved next chapter and consume its source pages.
            return node
    return None
