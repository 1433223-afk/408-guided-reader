from __future__ import annotations

from io import BytesIO
import sqlite3

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from reader_service.foundation import DetectedLine, FoundationRepository, FoundationService
from reader_service.foundation.geometry import reading_order
from reader_service.library.database import Database, MIGRATIONS

from conftest import make_pdf


LINE = DetectedLine(
    quad=((0.1, 0.2), (0.7, 0.2), (0.7, 0.3), (0.1, 0.3)),
    text="总线DMA",
    confidence=0.97,
    cells=(
        (0.1, 0.2, 0, 1),
        (0.2, 0.3, 1, 2),
        (0.3, 0.4, 2, 3),
        (0.4, 0.5, 3, 4),
        (0.5, 0.6, 4, 5),
    ),
)


def positioned_line(x, y, text):
    return DetectedLine(
        quad=((x, y), (x + 0.25, y), (x + 0.25, y + 0.04), (x, y + 0.04)),
        text=text,
        confidence=1,
        cells=((x, x + 0.25, 0, len(text)),),
    )


def test_reading_order_detects_columns_before_sorting_top_to_bottom():
    values = [
        positioned_line(0.58, 0.12, "right-1"),
        positioned_line(0.1, 0.2, "left-2"),
        positioned_line(0.58, 0.22, "right-2"),
        positioned_line(0.1, 0.1, "left-1"),
    ]
    assert [line.text for line in reading_order(values)] == [
        "left-1", "left-2", "right-1", "right-2"
    ]


class FixedEngine:
    profile = "fixture-engine:v1"

    def __init__(self, calls=None):
        self.calls = calls

    def prepare_page(self, page_image, page_size):
        if self.calls is not None:
            self.calls.append(page_size)
        return [LINE]


def import_pdf(service, pages=1):
    payload = make_pdf(tuple((612, 792) for _ in range(pages)))
    result = service.intake(
        BytesIO(payload), content_length=len(payload), filename="fixture.pdf"
    )
    return result["book"]["active_revision"]


def import_embedded_text_pdf(service):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = writer._add_object(DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    ))
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = DecodedStreamObject()
    content.set_data(
        b"BT /F1 14 Tf 72 700 Td (Trustworthy positioned embedded text layer for selection.) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(content)
    output = BytesIO()
    writer.write(output)
    payload = output.getvalue()
    return service.intake(
        BytesIO(payload), content_length=len(payload), filename="embedded.pdf"
    )["book"]["active_revision"]


def test_foundation_schema_enforces_anonymous_nested_cells_and_baseline_version(service):
    revision = import_pdf(service)
    with service.database.connect() as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(ocr_lines)")
        }
    assert revision["foundation_version"] == 1
    assert "ocr_pages" in tables and "ocr_lines" in tables
    assert not any("cell" in table.lower() or "word" in table.lower() for table in tables)
    assert "cells_json" in columns
    assert "foundation_version" not in columns


def test_r1_database_upgrade_initializes_existing_revision_at_foundation_version_one(tmp_path):
    path = tmp_path / "r1.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    connection.executescript(MIGRATIONS[0][1])
    connection.execute("INSERT INTO schema_migrations(version) VALUES (1)")
    connection.execute(
        "INSERT INTO books(id, title, status, created_at) VALUES ('book', 'R1', 'ACTIVE', 'now')"
    )
    connection.execute(
        """
        INSERT INTO book_source_revisions(
            id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
            label, status, created_at
        ) VALUES ('revision', 'book', ?, 1, 1, '[]', 'R1', 'ACTIVE', 'now')
        """,
        ("a" * 64,),
    )
    connection.commit()
    connection.close()

    Database(path).initialize()

    connection = sqlite3.connect(path)
    assert connection.execute(
        "SELECT foundation_version FROM book_source_revisions WHERE id = 'revision'"
    ).fetchone()[0] == 1
    assert connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall() == [
        (1,), (2,)
    ]
    connection.close()


def test_prepare_persist_reload_keeps_line_quad_and_cell_range_geometry(service):
    revision = import_pdf(service)
    repository = FoundationRepository(service.database)
    foundation = FoundationService(service, repository, FixedEngine)

    assert foundation.prepare_page(revision["id"], 0) == "READY"
    first = foundation.overlay(revision["id"], 0)
    reloaded = FoundationRepository(service.database).overlay(revision["id"], 0)

    assert first == reloaded
    line = reloaded["lines"][0]
    selected = line["cells"][1:5]
    quad = [
        [selected[0][0], 0.2],
        [selected[-1][1], 0.2],
        [selected[-1][1], 0.3],
        [selected[0][0], 0.3],
    ]
    assert line["text"][selected[0][2] : selected[-1][3]] == "线DMA"
    assert quad == [[0.2, 0.2], [0.6, 0.2], [0.6, 0.3], [0.2, 0.3]]
    assert reloaded["route"] == "OCR"
    assert reloaded["foundation_version"] == 1


def test_trustworthy_positioned_text_uses_embedded_route_without_ocr(service):
    revision = import_embedded_text_pdf(service)

    class ForbiddenEngine:
        def __init__(self):
            raise AssertionError("OCR engine must not initialize for a trustworthy embedded layer")

    foundation = FoundationService(
        service, FoundationRepository(service.database), ForbiddenEngine
    )
    assert foundation.prepare_page(revision["id"], 0) == "READY"
    overlay = foundation.overlay(revision["id"], 0)
    assert overlay["route"] == "EMBEDDED"
    assert overlay["engine_profile"] == "embedded-positioned-text:v1"
    assert overlay["lines"] and overlay["lines"][0]["cells"]


def test_one_page_failure_does_not_block_other_pages_or_pdf_reading(service):
    revision = import_pdf(service, pages=3)
    repository = FoundationRepository(service.database)

    class SelectiveFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            if page_index == 1:
                raise RuntimeError("deliberately corrupt page")
            return "OCR", "fixture-engine:v1", [LINE]

    foundation = SelectiveFoundation(service, repository, FixedEngine)
    assert [foundation.prepare_page(revision["id"], index) for index in range(3)] == [
        "READY", "FAILED", "READY"
    ]
    assert [page["status"] for page in foundation.statuses(revision["id"])] == [
        "READY", "FAILED", "READY"
    ]
    assert service.pdf_path(revision["id"]).read_bytes().startswith(b"%PDF-")
