from __future__ import annotations

import json
from io import BytesIO

from pypdf import PdfWriter

from reader_service.foundation import (
    DetectedLine,
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.outline import OutlineRepository, OutlineService

from conftest import make_pdf


class UnusedEngine:
    def prepare_page(self, page_image, page_size):
        raise AssertionError("not used")


def line(text, *, x=0.1, y=0.2, confidence=0.98):
    width = min(0.45, max(0.03, len(text) * 0.012))
    return DetectedLine(
        quad=((x, y), (x + width, y), (x + width, y + 0.015), (x, y + 0.015)),
        text=text,
        confidence=confidence,
        cells=(),
    )


def services(service):
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, UnusedEngine)
    labels = PageLabelService(service, PageLabelRepository(service.database))
    outline = OutlineService(service, OutlineRepository(service.database), labels)
    return foundation_repository, foundation, labels, outline


def publish(repository, revision_id, page_index, lines):
    assert repository.mark_preparing(revision_id, page_index)
    repository.publish_page(
        revision_id,
        page_index,
        route="OCR",
        foundation_version=1,
        engine_profile="fixture:v1",
        lines=lines,
    )


def bookmarked_pdf():
    writer = PdfWriter()
    for _ in range(5):
        writer.add_blank_page(width=612, height=792)
    chapter = writer.add_outline_item("第1章 基础", 0)
    section = writer.add_outline_item("1.1 第一节", 1, parent=chapter)
    subsection = writer.add_outline_item("1.1.1 小节", 2, parent=section)
    writer.add_outline_item("1.1.1.1 深层标题", 3, parent=subsection)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_bookmarks_mint_stable_tree_and_book_delete_cascades(service):
    pdf = bookmarked_pdf()
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="bookmarks.pdf")
    book = imported["book"]
    revision_id = book["active_revision"]["id"]
    _repository, _foundation, _labels, outline = services(service)

    first = outline.bootstrap(revision_id)
    second = outline.bootstrap(revision_id)
    first_shape = [
        (node["outline_node_id"], node["parent_id"], node["depth"], node["order_index"])
        for node in first["nodes"]
    ]
    assert first["evidence_source"] == "BOOKMARK"
    assert first_shape == [
        (node["outline_node_id"], node["parent_id"], node["depth"], node["order_index"])
        for node in second["nodes"]
    ]
    assert len(first_shape) == 4
    assert [node["depth"] for node in first["nodes"]] == [0, 1, 2, 3]
    by_title = {node["title"]: node for node in first["nodes"]}
    assert by_title["1.1.1.1 深层标题"]["parent_id"] == by_title["1.1.1 小节"]["outline_node_id"]
    assert all(node["identity_revision"] == node["physical_revision"] == 1 for node in first["nodes"])

    service.delete_book(book["id"])
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM outline_nodes").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM page_labels").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM outline_bootstrap_records").fetchone()[0] == 0


def test_page_label_runs_unknown_and_manual_restart_priority(service):
    pdf = make_pdf(((612, 792),) * 7)
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="labels.pdf")
    revision_id = imported["book"]["active_revision"]["id"]
    repository, foundation, labels, _outline = services(service)
    foundation.ensure_revision(revision_id)
    publish(repository, revision_id, 0, [line("封面", y=0.3)])
    publish(repository, revision_id, 1, [line("前言", y=0.3)])
    for page_index, printed in ((2, "1"), (3, "2"), (4, "3"), (5, "99")):
        x = 0.82 if int(printed) % 2 else 0.12
        publish(repository, revision_id, page_index, [line(printed, x=x, y=0.06)])
    publish(repository, revision_id, 6, [line("正文", y=0.3)])

    inferred = labels.infer(revision_id)["labels"]
    assert [(row["method"], row["printed_label"]) for row in inferred] == [
        ("NONE", None), ("NONE", None), ("INFERRED", "1"), ("INFERRED", "2"),
        ("INFERRED", "3"), ("NONE", None), ("NONE", None),
    ]
    labels.set_manual(revision_id, 0, "封")

    # New objects model a service restart/book reopen; persisted MANUAL still wins.
    restarted = PageLabelService(service, PageLabelRepository(service.database))
    rows = restarted.infer(revision_id)["labels"]
    assert rows[0]["method"] == "MANUAL"
    assert rows[0]["printed_label"] == "封"


def test_toc_classification_copy_mints_complete_tree_without_mutating_ocr(service):
    pdf = make_pdf(((612, 792),) * 5)
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="toc.pdf")
    revision_id = imported["book"]["active_revision"]["id"]
    repository, foundation, labels, outline = services(service)
    foundation.ensure_revision(revision_id)
    contaminated = "1.1 第一节 刺猬云印·在线打印"
    assert OutlineService.classification_text(
        "7.3.3 DMA 方式公众号：小兔网盘免费分享无水印PDF"
    ) == "7.3.3 DMA 方式"
    toc_lines = [
        line("目录", x=0.43, y=0.05),
        line("第1章 基础", x=0.10, y=0.20), line("10", x=0.84, y=0.20),
        line(contaminated, x=0.15, y=0.25), line("11", x=0.84, y=0.25),
        line("1.1.1 小节", x=0.20, y=0.30), line("12", x=0.84, y=0.30),
        line("1.2 第二节", x=0.15, y=0.35), line("13", x=0.84, y=0.35),
    ]
    publish(repository, revision_id, 0, toc_lines)
    waiting = outline.bootstrap(revision_id)
    assert waiting["nodes"] == []
    assert waiting["waiting_for_toc_completion"] is True
    publish(repository, revision_id, 1, [line("正文", y=0.2)])

    first = outline.bootstrap(revision_id)
    assert first["evidence_source"] == "TOC"
    assert [node["title"] for node in first["nodes"]] == [
        "第1章 基础", "1.1 第一节", "1.2 第二节", "1.1.1 小节"
    ]
    assert all(node["start_page"] is None for node in first["nodes"])
    with service.database.connect() as connection:
        stored = connection.execute(
            "SELECT text FROM ocr_lines WHERE book_source_revision_id = ? AND text = ?",
            (revision_id, contaminated),
        ).fetchone()
    assert stored[0] == contaminated

    ids = {
        node["outline_node_id"]: (node["parent_id"], node["order_index"])
        for node in first["nodes"]
    }
    publish(repository, revision_id, 2, [line("更多正文", y=0.2)])
    second = outline.bootstrap(revision_id)
    assert ids == {
        node["outline_node_id"]: (node["parent_id"], node["order_index"])
        for node in second["nodes"]
    }

    # A later parser/evidence result that would change the durable tree is reported,
    # never silently reminted or reparented.
    with service.database.connect() as connection:
        connection.execute(
            """
            UPDATE ocr_lines SET text = '1.1 已改变'
            WHERE book_source_revision_id = ? AND pdf_page_index = 0 AND text = ?
            """,
            (revision_id, contaminated),
        )
    conflict = outline.bootstrap(revision_id)
    assert conflict["identity_conflict"] is True
    assert ids == {
        node["outline_node_id"]: (node["parent_id"], node["order_index"])
        for node in conflict["nodes"]
    }
    assert any(node["title"] == "1.1 第一节" for node in conflict["nodes"])


def test_outline_target_mapping_is_partial_and_rejects_nonmonotonic_sibling(service):
    pdf = make_pdf(((612, 792),) * 6)
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="bad-map.pdf")
    revision_id = imported["book"]["active_revision"]["id"]
    repository, foundation, labels, outline = services(service)
    foundation.ensure_revision(revision_id)
    publish(repository, revision_id, 0, [
        line("目录", x=0.43, y=0.05),
        line("第1章 基础", x=0.1, y=0.20), line("10", x=0.84, y=0.20),
        line("1.1 第一节", x=0.15, y=0.25), line("11", x=0.84, y=0.25),
        line("1.2 第二节", x=0.15, y=0.30), line("12", x=0.84, y=0.30),
    ])
    publish(repository, revision_id, 1, [line("正文", y=0.2)])
    labels.set_manual(revision_id, 4, "11")
    labels.set_manual(revision_id, 2, "12")
    result = outline.bootstrap(revision_id)
    by_title = {node["title"]: node for node in result["nodes"]}
    assert by_title["1.1 第一节"]["start_page"] == 4
    assert by_title["1.1 第一节"]["resolution_state"] == "PARTIAL"
    assert by_title["1.2 第二节"]["start_page"] is None
    assert by_title["1.2 第二节"]["resolution_state"] == "UNRESOLVED"

    outline.set_manual_page_label(revision_id, 4, "旧页码")
    outline.set_manual_page_label(revision_id, 1, "11")
    corrected = {node["title"]: node for node in outline.bootstrap(revision_id)["nodes"]}
    assert corrected["1.1 第一节"]["start_page"] == 1
    assert corrected["1.2 第二节"]["start_page"] == 2
    assert corrected["1.1 第一节"]["identity_revision"] == 1
    assert corrected["1.1 第一节"]["physical_revision"] == 1


def test_schema_has_exact_outline_and_page_label_contract_fields(service):
    with service.database.connect() as connection:
        outline_fields = {row[1] for row in connection.execute("PRAGMA table_info(outline_nodes)")}
        label_fields = {row[1] for row in connection.execute("PRAGMA table_info(page_labels)")}
    assert {
        "book_source_revision_id", "outline_node_id", "identity_revision", "parent_id",
        "depth", "order_index", "kind", "title", "printed_label_hint", "start_page",
        "start_y", "end_page", "end_y", "resolution_state", "physical_revision",
        "confidence", "evidence_json",
    } <= outline_fields
    assert {
        "book_source_revision_id", "pdf_page_index", "printed_label", "confidence",
        "method", "evidence_ref",
    } == label_fields
