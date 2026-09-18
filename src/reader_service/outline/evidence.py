"""Conservative source-evidence checks; no persistent identities or OCR writes."""

from __future__ import annotations

import re
from itertools import pairwise

ORDINAL = r"[0-9一二三四五六七八九十百千零〇两]+"
NAMED = re.compile(rf"^第\s*({ORDINAL})\s*([篇部章节])\s*(.+)$")
LEADER = re.compile(r"[.．·…⋯。_—-]{2,}")
PAGE_LABEL = re.compile(r"^[\s·.\-—…]*(?:\(?\s*(\d{1,4})\s*\)?)[\s·.\-—…]*$")


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
        text = " ".join(x["text"] for x in ordered).strip()
        label = None
        label_match = re.search(r"\(\s*(\d{1,4})\s*\)\s*$", text)
        if label_match:
            label = label_match[1]
            text = text[: label_match.start()]
        elif ordered[-1]["x"] > 0.72:
            match = PAGE_LABEL.fullmatch(ordered[-1]["text"])
            if match:
                label = match[1]
                text = " ".join(x["text"] for x in ordered[:-1])
        if label is not None:
            page_evidence += 1
        text = LEADER.split(text)[0].strip()
        named = NAMED.fullmatch(text)
        if not named:
            if (
                text not in ("思考与练习", "习题", "复习思考题", "本章练习")
                or label is None
            ):
                continue
            number, unit, title = "0", "练习", text
        else:
            number, unit, title = named.groups()
        results.append(
            {
                "key": f"named:{unit}:{ordinal(number)}",
                "title": title
                if unit == "练习"
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
        elif unit == "练习":
            if chapter is None:
                continue  # Continuation page: never assign it to an invented chapter.
            row = {
                **row,
                "key": f"{chapter}/exercises",
                "depth": int(has_parts) + 1,
                "kind": "EXERCISES",
            }
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
