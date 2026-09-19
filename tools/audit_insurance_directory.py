"""Read-only real-fixture audit. No production book identifiers or offsets in parser.

Compare a repair --report JSON against independently transcribed TOC expectations.
"""

import argparse
import json
from pathlib import Path

from reader_service.outline.service import OutlineService


def audit(nodes, expected):
    ordered = OutlineService._topological(nodes)
    chapters = [n for n in ordered if n["kind"] == "CHAPTER"]
    assert len(nodes) == 205 and len(chapters) == 25
    assert [OutlineService._heading_parts(n['title'])[1] for n in chapters] == expected['chapter_titles']
    for chapter, (start, sections, summary, exercise) in zip(
        chapters, expected["chapter_section_summary_exercise_pdf_pages"], strict=True
    ):
        children = [n for n in ordered if n["parent_id"] == chapter["outline_node_id"]]
        assert chapter["start_page"] == start - 1, chapter["title"]
        found = [
            n["start_page"] + 1 if n["start_page"] is not None else None
            for n in children
            if n["kind"] == "SECTION"
        ]
        assert found == sections, (chapter["title"], found, sections)
        for title, target in [
            ("引言", start),
            ("本章总结", summary),
            ("思考与练习", exercise),
        ]:
            matches = [n for n in children if n["title"] == title]
            assert len(matches) == 1 and matches[0]["start_page"] == target - 1, (
                chapter["title"],
                title,
                matches,
                target,
            )
    compact = lambda s: "".join(s.split())
    for title, page in zip(
        expected["back_matter_titles"], expected["back_matter_pdf_pages"], strict=True
    ):
        matches = [n for n in nodes if compact(n["title"]) == compact(title)]
        assert (
            len(matches) == 1
            and matches[0]["parent_id"] is None
            and matches[0]["start_page"] == page - 1
        ), (title, matches)
    for title, page in zip(expected["front_matter_titles"], expected["front_matter_pdf_pages"], strict=True):
        assert (
            len(
                [
                    n
                    for n in nodes
                    if n["title"] == title
                    and n["parent_id"] is None
                    and n["start_page"] == page - 1
                ]
            )
            == 1
        ), title
    assert sum(n["kind"] == "SECTION" for n in nodes) == 84
    assert sum(n["kind"] == "EXERCISES" for n in nodes) == 25
    assert not any("mmm" in n["title"] for n in nodes)
    return {
        "nodes": 205,
        "chapters": 25,
        "sections": 84,
        "chapter_extras": 75,
        "front_and_back": 15,
        "parts": 6,
        "targets_checked": 199,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    expected = json.loads(
        (
            Path(__file__).parents[1] / "tests/fixtures/insurance_toc_pages.json"
        ).read_text(encoding="utf8")
    )
    print(audit(json.loads(args.report.read_text(encoding="utf8")), expected))
