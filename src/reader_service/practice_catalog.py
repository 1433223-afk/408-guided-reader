"""Validated single-choice Practice sources derived from existing Outline and OCR.

This reader is intentionally conservative: an ambiguous question is left in the
PDF, never exposed as a scoreable item. It does not mutate OCR or Outline.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict


QUESTION = re.compile(r"^\s*(\d{1,2})\s*[.．]\s*(?![ABCD]\s*$)")
OPTION = re.compile(r"(?<![A-Za-z])([ABCD])\s*[.．、]")
ANSWER = re.compile(r"^\s*(\d{1,2})\s*[.．]\s*([ABCD])(?:\s|$)")
SECTION_HEADING = re.compile(r"^\s*\*?\d+(?:\.\d+){1,3}(?!\d)")
LEGACY_SECTION = {"1.2.6": 0, "5.2.4": 100}


def _bounds(quad):
    return (min(p[0] for p in quad), min(p[1] for p in quad),
            max(p[0] for p in quad), max(p[1] for p in quad))


def _heading(lines, node, phrase):
    prefix = node["title"].lstrip("*").split()[0]
    return next((line for line in lines.get(node["start_page"], ())
                 if prefix in line["text"] and phrase in line["text"]), None)


def _exercise_entry_right(line):
    """End of the printed heading, even when OCR merges later page text into its line."""
    match = re.search(r"\*?\d+(?:\.\d+){1,3}\s*本节习题\S*", line["text"])
    if match:
        cells = [cell for cell in line["cells"]
                 if cell[2] < match.end() and cell[3] > match.start()]
        if cells:
            return max(cell[1] for cell in cells)
    return _bounds(line["quad"])[2]


def _after(line, heading):
    return (line["page"], line["ordinal"]) > (heading["page"], heading["ordinal"])


def _before(line, heading):
    return (line["page"], line["ordinal"]) < (heading["page"], heading["ordinal"])


def _line_stream(pages, first, last):
    return [line for page in range(first["page"], last["page"] + 1)
            for line in pages.get(page, ()) if _after(line, first) and _before(line, last)]


def _option_rect(line, start, end, *, has_previous=False, next_start=None):
    # Cells retain OCR character offsets and X geometry. They split A/B when
    # the OCR engine merged two printed options into one detected line.
    cells = [cell for cell in line["cells"] if cell[3] > start and cell[2] < end]
    if not cells:
        return None
    x0, y0, x1, y1 = _bounds(line["quad"])
    x0 = min(cell[0] for cell in cells)
    x1 = max(cell[1] for cell in cells)
    right = x1 + .006
    if next_start is not None:
        following = [cell[0] for cell in line["cells"] if cell[2] <= next_start < cell[3]]
        if not following:
            return None
        right = min(right, min(following) - .002)
    left = x0 if has_previous else x0 - .006
    if right <= left:
        return None
    return [round(max(0, left), 4), round(max(0, y0 - .001), 4),
            round(min(1, right), 4), round(min(1, y1 + .001), 4)]


def _separate_options(options):
    """Tiny OCR row overlaps must not make one pointer position pick two choices."""
    for index, first in enumerate(options):
        for second in options[index + 1:]:
            a, b = first["rect"], second["rect"]
            if a[0] >= b[2] or b[0] >= a[2] or a[1] >= b[3] or b[1] >= a[3]:
                continue
            first_mid = (a[1] + a[3]) / 2
            second_mid = (b[1] + b[3]) / 2
            if abs(first_mid - second_mid) < .004:
                return False
            upper, lower = (a, b) if first_mid < second_mid else (b, a)
            boundary = (upper[3] + lower[1]) / 2
            upper[3] = round(boundary - .0001, 4)
            lower[1] = round(boundary + .0001, 4)
            if upper[3] <= upper[1] or lower[3] <= lower[1]:
                return False
    return True


def _identity(source_sha256, section_number, printed_number):
    legacy_base = LEGACY_SECTION.get(section_number)
    if legacy_base is not None and (section_number != "1.2.6" or printed_number <= 16):
        return legacy_base + printed_number
    seed = f"{source_sha256}:{section_number}:{printed_number}".encode("utf-8")
    return 1_000_000 + int.from_bytes(hashlib.sha256(seed).digest()[:6], "big")


def _question_group(group, number, section, source_sha256):
    hits = []
    option_parts = defaultdict(list)
    current_choice = None
    for line in group:
        markers = list(OPTION.finditer(line["text"]))
        for index, marker in enumerate(markers):
            end = markers[index + 1].start() if index + 1 < len(markers) else len(line["text"])
            rect = _option_rect(line, marker.start(), end, has_previous=index > 0,
                                next_start=markers[index + 1].start() if index + 1 < len(markers) else None)
            value = line["text"][marker.end():end].strip()
            if not rect or not value:
                return None
            hits.append((line, marker.group(1), rect, value))
            current_choice = marker.group(1)
            option_parts[current_choice].append(value)
        if not markers and current_choice and .075 <= _bounds(line["quad"])[1] < .95:
            option_parts[current_choice].append(line["text"])
    if [choice for _, choice, _, _ in hits] != list("ABCD"):
        return None
    regions = defaultdict(list)
    for line, choice, rect, _ in hits:
        regions[line["page"]].append({"choice": choice, "rect": rect})
    if any(not _separate_options(options) for options in regions.values()):
        return None
    prompt = group[0]
    prompt_y = _bounds(prompt["quad"])[1]
    title = section["title"]
    section_number = title.lstrip("*").split()[0]
    source_lines = [line for line in group if .075 <= _bounds(line["quad"])[1] < .95]
    page_text = defaultdict(list)
    for line in source_lines:
        page_text[line["page"]].append(line["text"])
    return {
        "number": _identity(source_sha256, section_number, number),
        "label": number, "sectionId": section["outline_node_id"],
        "sectionTitle": title, "page": prompt["page"],
        "promptY": round(prompt_y, 4),
        "regions": [{"page": page, "options": options} for page, options in sorted(regions.items())],
        "question_ocr": "\n".join(line["text"] for line in source_lines),
        "pages": [{"pdf_page_number": page + 1, "ocr_text": "\n".join(texts)}
                  for page, texts in sorted(page_text.items())],
        "options_text": {choice: " ".join(option_parts[choice]) for choice in "ABCD"},
    }


def build_catalog(connection, revision_id: str, source_sha256: str) -> list[dict]:
    """Return sections containing validated, uniquely answered A/B/C/D items."""
    nodes = [dict(row) for row in connection.execute(
        """SELECT outline_node_id,parent_id,kind,title,start_page,order_index
           FROM outline_nodes WHERE book_source_revision_id=? AND start_page IS NOT NULL
           ORDER BY start_page,order_index""", (revision_id,))]
    pairs = []
    for node in nodes:
        if node["kind"] != "EXERCISES":
            continue
        answer = next((item for item in nodes if item["kind"] == "ANSWERS"
                       and item["parent_id"] == node["parent_id"]
                       and item["start_page"] >= node["start_page"]), None)
        if answer:
            pairs.append((node, answer))
    if not pairs:
        return []
    pages = defaultdict(list)
    for row in connection.execute(
        """SELECT lines.pdf_page_index,lines.line_ordinal,lines.text,lines.quad_json,lines.cells_json
           FROM ocr_lines lines JOIN ocr_pages page
             ON page.book_source_revision_id=lines.book_source_revision_id
            AND page.pdf_page_index=lines.pdf_page_index
           WHERE lines.book_source_revision_id=? AND page.status='READY'
           ORDER BY lines.pdf_page_index,lines.line_ordinal""", (revision_id,)):
        pages[row["pdf_page_index"]].append({
            "page": row["pdf_page_index"], "ordinal": row["line_ordinal"],
            "text": row["text"].strip(), "quad": json.loads(row["quad_json"]),
            "cells": json.loads(row["cells_json"]),
        })
    sections = []
    used_ids = set()
    for exercise, answer in pairs:
        exercise_head = _heading(pages, exercise, "本节习题")
        answer_head = _heading(pages, answer, "答案与解析")
        if not exercise_head or not answer_head:
            continue
        body = _line_stream(pages, exercise_head, answer_head)
        starts = [(pos, int(match.group(1))) for pos, line in enumerate(body)
                  if (match := QUESTION.match(line["text"]))]
        run = []
        for position, number in starts:
            if not run and number != 1:
                continue
            if run and number != run[-1][1] + 1:
                break  # A reset or gap marks another exercise block, not a continuation.
            run.append((position, number))
        if not run:
            continue
        following_sections = [_heading(pages, node, "") for node in nodes
                              if node["kind"] == "SECTION" and node["start_page"] >= answer_head["page"]]
        boundary = next((head for head in sorted((head for head in following_sections
                                                  if head and _after(head, answer_head)),
                                                 key=lambda line: (line["page"], line["ordinal"]))), None)
        if boundary is None:
            # The final answer section may run to the end of the PDF.
            last_page = max(pages)
            boundary = {"page": last_page, "ordinal": len(pages[last_page]) + 1}
        answer_lines = _line_stream(pages, answer_head, boundary)
        answer_hits = defaultdict(list)
        for pos, line in enumerate(answer_lines):
            if match := ANSWER.match(line["text"]):
                answer_hits[int(match.group(1))].append((pos, match.group(2), line))
        items = []
        section_number = exercise["title"].lstrip("*").split()[0]
        for offset, (start, number) in enumerate(run):
            stop = run[offset + 1][0] if offset + 1 < len(run) else (
                starts[len(run)][0] if len(starts) > len(run) else len(body))
            question = _question_group(body[start:stop], number, exercise, source_sha256)
            matches = answer_hits[number]
            if not question or len(matches) != 1:
                continue
            answer_pos, letter, answer_line = matches[0]
            following = min((pos for pos, _, _ in answer_hits.get(number + 1, ())
                             if pos > answer_pos), default=len(answer_lines))
            explanation = [line for line in answer_lines[answer_pos + 1:following]
                           if line["text"] and not SECTION_HEADING.match(line["text"])]
            if not explanation:
                continue
            identity = question["number"]
            if identity in used_ids:
                raise ValueError("Practice 题号发生冲突，已停止发布。")
            used_ids.add(identity)
            question.update(answer=letter, answerPage=answer_line["page"],
                            answerY=round(_bounds(answer_line["quad"])[1], 4),
                            explanation="\n".join(line["text"] for line in explanation),
                            explanation_pages=[{"pdf_page_number": page + 1,
                                                "ocr_text": "\n".join(line["text"] for line in explanation
                                                                      if line["page"] == page)}
                                               for page in sorted({line["page"] for line in explanation})])
            items.append(question)
        if items:
            sections.append({"id": {"1.2.6": "126", "5.2.4": "524"}.get(section_number,
                                                                             exercise["outline_node_id"]),
                             "title": exercise["title"],
                             "entryPage": exercise_head["page"],
                             "entryTop": round(_bounds(exercise_head["quad"])[1], 4),
                             "entryBottom": round(_bounds(exercise_head["quad"])[3], 4),
                             "entryLeft": round(min(.85, _exercise_entry_right(exercise_head) + .012), 4),
                             "questions": items})
    return sections


def public_sections(sections: list[dict]) -> list[dict]:
    """The solve UI receives geometry and answer navigation, never answer text."""
    question_keys = ("number", "label", "page", "promptY", "answerPage", "answerY", "regions")
    return [{"id": section["id"], "title": section["title"],
             "entryPage": section["entryPage"], "entryTop": section["entryTop"],
             "entryBottom": section["entryBottom"],
             "entryLeft": section["entryLeft"],
             "questions": [{key: question[key] for key in question_keys}
                           for question in section["questions"]]}
            for section in sections]
