from reader_service.outline.evidence import (
    chapter_boundary,
    named_hierarchy,
    parse_named_toc,
    usable_bookmarks,
)


def row(text, y, x=0.1):
    return {
        "text": text,
        "line_ordinal": round(y * 1000),
        "confidence": 0.99,
        "quad": ((x, y), (x + 0.15, y), (x + 0.15, y + 0.01), (x, y + 0.01)),
    }


def test_page_index_bookmarks_are_not_chapters_but_numeric_chapters_are_allowed():
    pages = [{"title": str(i), "start_page": i, "depth": 0} for i in range(1, 100)]
    assert not usable_bookmarks(pages)
    assert usable_bookmarks(
        [{"title": str(i), "start_page": i * 20, "depth": 0} for i in range(1, 10)]
    )
    assert usable_bookmarks([{"title": "Introduction", "start_page": 0, "depth": 0}])


def test_named_toc_preserves_part_chapter_section_and_repeated_section_numbers():
    lines = [
        row("第一篇 基础", 0.1),
        row("第一章 风险……(3)", 0.2),
        row("第一节 定义……(3)", 0.25),
        row("第二节 应用……(7)", 0.3),
        row("第二章 制度……(10)", 0.4),
        row("第一节 历史……(10)", 0.45),
    ]
    parsed = parse_named_toc(0, lines, lambda x: x)
    tree = named_hierarchy(parsed)
    assert [x["kind"] for x in tree] == [
        "OTHER",
        "CHAPTER",
        "SECTION",
        "SECTION",
        "CHAPTER",
        "SECTION",
    ]
    assert [x["depth"] for x in tree] == [0, 1, 2, 2, 1, 2]
    assert tree[2]["key"] != tree[-1]["key"]
    assert tree[1]["printed_label_hint"] == "3"


def test_missing_chapter_or_section_does_not_publish_incomplete_tree():
    base = [
        row("第一章 基础……(3)", 0.2),
        row("第一节 定义……(3)", 0.25),
        row("第三节 遗漏……(7)", 0.3),
    ]
    assert named_hierarchy(parse_named_toc(0, base, lambda x: x)) == []
    base[-1]["text"] = "第三章 遗漏……(7)"
    assert named_hierarchy(parse_named_toc(0, base, lambda x: x)) == []


def test_body_headings_are_not_directory_evidence():
    assert (
        parse_named_toc(0, [row("第一章 概述", 0.2), row("第一节 定义", 0.3)], str)
        == []
    )


def test_complete_toc_keeps_auxiliary_entries_without_making_them_learning_owners():
    lines = [
        row("目录", 0.05),
        row("第一章 概述……(1)", 0.15),
        row("引言……(1)", 0.2),
        row("第一节 定义……(2)", 0.25),
        row("本章总结……(8)", 0.3),
        row("思考与练习……(9)", 0.35),
        row("附录1 术语……(10)", 0.4),
        row("第三版后记……(12)", 0.45),
    ]
    tree = named_hierarchy(parse_named_toc(0, lines, str))
    assert [n["kind"] for n in tree] == [
        "CHAPTER",
        "OTHER",
        "SECTION",
        "OTHER",
        "EXERCISES",
        "OTHER",
        "OTHER",
    ]
    assert [n["depth"] for n in tree] == [0, 1, 1, 1, 1, 0, 0]
    assert all(n["title"] != "目录" for n in tree)


def test_overlapping_alternate_boxes_do_not_duplicate_page_suffix_or_titles():
    lines = [
        row("第一章 基础(1)", 0.15),
        row("(1)", 0.15, 0.85),
        row("第一节 定义……(2)", 0.25),
        row("本章总结……(8)", 0.35),
        row("第三版后记", 0.45),
        dict(row("(9", 0.45, 0.3), confidence=0.6),
        row("(12)", 0.45, 0.85),
    ]
    tree = named_hierarchy(parse_named_toc(0, lines, str))
    assert tree[0]["title"] == "第一章 基础"
    assert tree[-1]["title"] == "第三版后记"
    assert tree[-1]["printed_label_hint"] == "12"


def test_title_parentheses_are_not_page_labels():
    parsed = parse_named_toc(0,[row('第一章 合同(上)……(3)',.2),
        row('第一节 订立……(3)',.3),row('第二章 合同(下)……(10)',.4)],str)
    assert parsed[0]['title']=='第一章 合同(上)'
    assert parsed[2]['title']=='第二章 合同(下)'


def test_chapter_number_restart_is_scoped_to_explicit_part():
    lines = [
        row("第一篇 基础", 0.1),
        row("第一章 概述……(3)", 0.2),
        row("第一节 定义……(3)", 0.25),
        row("第二篇 应用", 0.4),
        row("第一章 实践……(20)", 0.5),
        row("第一节 案例……(20)", 0.6),
    ]
    tree = named_hierarchy(parse_named_toc(0, lines, str))
    assert len(tree) == 6
    assert tree[1]["key"] != tree[4]["key"]
    assert tree[2]["key"] != tree[5]["key"]
    # A missing first chapter in a new part cannot inherit the preceding owner.
    assert named_hierarchy(parse_named_toc(0, lines[:4] + lines[5:], str)) == []


def test_nested_chapter_boundary_does_not_consume_next_part_or_unresolved_chapter():
    nodes = [
        {"outline_node_id": "p", "kind": "OTHER", "depth": 0, "start_page": None},
        {"outline_node_id": "c1", "kind": "CHAPTER", "depth": 1, "start_page": 2},
        {"outline_node_id": "s", "kind": "SECTION", "depth": 2, "start_page": 3},
        {"outline_node_id": "p2", "kind": "OTHER", "depth": 0, "start_page": None},
        {"outline_node_id": "c2", "kind": "CHAPTER", "depth": 1, "start_page": None},
    ]
    assert chapter_boundary(nodes, nodes[1]) is nodes[-1]
