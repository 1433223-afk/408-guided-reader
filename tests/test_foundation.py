from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import sqlite3
import pytest

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


def test_legacy_oversized_page_fails_before_pdfium_render(service, monkeypatch):
    import pypdfium2 as pdfium
    revision = import_pdf(service)
    class HugePage:
        def get_size(self): return 100000, 100000
        def close(self): pass
        def render(self, **kwargs): raise AssertionError("must not allocate huge bitmap")
    class Document:
        def __init__(self, path): pass
        def __getitem__(self, index): return HugePage()
        def close(self): pass
    monkeypatch.setattr(pdfium, "PdfDocument", Document)
    foundation = FoundationService(service, FoundationRepository(service.database), FixedEngine)
    assert foundation.prepare_page(revision["id"], 0) == "FAILED"
    assert foundation.statuses(revision["id"])[0]["failure_code"] == "PDF_PAGE_RESOURCE_LIMIT"
    # The legacy-empty-page repair probe is also bounded.
    assert foundation._page_has_visible_content(service.pdf_path(revision["id"]), 0) is True


@pytest.mark.parametrize("dimensions", [(float("nan"), 100), (100, float("inf")), (0, 100), (612, 792)])
def test_render_budget_rejects_nonfinite_and_accepts_standard_pages(service, dimensions):
    from reader_service.foundation.contracts import PagePreparationError
    foundation = FoundationService(service, FoundationRepository(service.database), FixedEngine)
    if dimensions == (612, 792):
        foundation._validate_render_budget(*dimensions)
    else:
        with pytest.raises(PagePreparationError) as failure:
            foundation._validate_render_budget(*dimensions)
        assert failure.value.code == "PDF_PAGE_RESOURCE_LIMIT"


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


def test_reading_order_puts_strongly_overlapping_row_fragments_left_to_right():
    title = DetectedLine(
        quad=((0.248, 0.368), (0.333, 0.368), (0.333, 0.386), (0.248, 0.386)),
        text="title",
        confidence=1,
        cells=((0.259, 0.333, 0, 5),),
    )
    number = DetectedLine(
        quad=((0.2, 0.369), (0.26, 0.369), (0.26, 0.386), (0.2, 0.386)),
        text="6.2.1",
        confidence=1,
        cells=((0.205, 0.243, 0, 5),),
    )
    assert [line.text for line in reading_order([title, number])] == ["6.2.1", "title"]


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


def import_inked_pdf(service):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    content = DecodedStreamObject()
    content.set_data(("0 0 0 rg\n" + "".join(
        f"40 {100 + row * 12} 500 4 re f\n" for row in range(40)
    )).encode())
    page[NameObject("/Contents")] = writer._add_object(content)
    output = BytesIO()
    writer.write(output)
    payload = output.getvalue()
    return service.intake(
        BytesIO(payload), content_length=len(payload), filename="inked.pdf"
    )["book"]["active_revision"]


def import_embedded_text_pdf(service, *, rotation=0, origin=(0, 0)):
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    if origin != (0, 0):
        x, y = origin
        page.mediabox.lower_left = (x, y)
        page.mediabox.upper_right = (x + 612, y + 792)
        page.cropbox.lower_left = (x, y)
        page.cropbox.upper_right = (x + 612, y + 792)
    if rotation:
        page.rotate(rotation)
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
        (version,) for version, _ in MIGRATIONS
    ]
    connection.close()


def test_r2_geometry_correction_invalidates_active_machine_layer_without_version_bump(tmp_path):
    path = tmp_path / "r2-before-correction.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, sql in MIGRATIONS[:2]:
        connection.executescript(sql)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
    connection.execute(
        "INSERT INTO books(id, title, status, created_at) VALUES ('book', 'R2', 'ACTIVE', 'now')"
    )
    connection.execute(
        """
        INSERT INTO book_source_revisions(
            id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
            label, status, created_at, foundation_version
        ) VALUES ('revision', 'book', ?, 1, 1, '[]', 'R2', 'ACTIVE', 'now', 1)
        """,
        ("b" * 64,),
    )
    connection.execute(
        """
        INSERT INTO ocr_pages(
            book_source_revision_id, pdf_page_index, status, route,
            foundation_version, engine_profile, confidence, prepared_at
        ) VALUES ('revision', 0, 'READY', 'EMBEDDED', 1,
                  'embedded-positioned-text:v1', 1, 'now')
        """
    )
    connection.execute(
        """
        INSERT INTO ocr_lines(
            book_source_revision_id, pdf_page_index, line_ordinal,
            quad_json, text, confidence, cells_json
        ) VALUES ('revision', 0, 0, '[[0,0],[1,0],[1,1],[0,1]]', 'old', 1,
                  '[[0,1,0,3]]')
        """
    )
    connection.execute(
        """
        INSERT INTO jobs(
            id, job_type, book_source_revision_id, page_start, page_end,
            foundation_version, status, priority, cancel_requested, attempts,
            created_at, updated_at
        ) VALUES ('job', 'PAGE_PREPARE', 'revision', 0, 0, 1,
                  'SUCCEEDED', 12, 0, 1, 'now', 'now')
        """
    )
    connection.commit()
    connection.close()

    Database(path).initialize()

    connection = sqlite3.connect(path)
    assert connection.execute(
        "SELECT foundation_version FROM book_source_revisions WHERE id = 'revision'"
    ).fetchone() == (1,)
    assert connection.execute(
        "SELECT status, route, engine_profile FROM ocr_pages"
    ).fetchone() == ("NOT_PREPARED", None, None)
    assert connection.execute("SELECT COUNT(*) FROM ocr_lines").fetchone() == (0,)
    assert connection.execute(
        "SELECT status, priority, attempts FROM jobs"
    ).fetchone() == ("QUEUED", 0, 0)
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


def test_vertical_selection_resolves_partial_text_and_y_geometry(service):
    revision = import_pdf(service)
    repository = FoundationRepository(service.database)
    vertical = DetectedLine(
        quad=((0.825, 0.09), (0.933, 0.09), (0.933, 0.546), (0.825, 0.546)),
        text="本书配套资源介绍",
        confidence=0.99,
        cells=tuple((0.824, 0.932, index, index + 1) for index in range(8)),
    )

    class VerticalEngine:
        profile = "vertical-fixture:v1"

        def prepare_page(self, page_image, page_size):
            return [vertical]

    foundation = FoundationService(service, repository, VerticalEngine)
    assert foundation.prepare_page(revision["id"], 0) == "READY"
    resolved = foundation.resolve_text_selection(
        revision["id"], 0,
        start={"line_ordinal": 0, "boundary": 2},
        end={"line_ordinal": 0, "boundary": 5},
    )

    assert resolved["quote"] == "配套资"
    assert [
        [[x, round(y, 6)] for x, y in quad]
        for quad in resolved["quads"]
    ] == [[[0.824, 0.204], [0.932, 0.204], [0.932, 0.375], [0.824, 0.375]]]


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
    assert overlay["engine_profile"] == "embedded-positioned-text:v2"
    assert overlay["lines"] and overlay["lines"][0]["cells"]


def test_rotated_and_non_zero_origin_embedded_text_fall_back_to_ocr(service):
    for rotation, origin in ((90, (0, 0)), (0, (50, 100))):
        revision = import_embedded_text_pdf(service, rotation=rotation, origin=origin)
        calls = []
        foundation = FoundationService(
            service, FoundationRepository(service.database), lambda: FixedEngine(calls)
        )
        assert foundation.prepare_page(revision["id"], 0) == "READY"
        overlay = foundation.overlay(revision["id"], 0)
        assert overlay["route"] == "OCR"
        assert overlay["engine_profile"] == "fixture-engine:v1"
        assert calls


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


def test_empty_ocr_retries_nonblank_page_but_accepts_blank_page(service):
    inked = import_inked_pdf(service)
    blank = import_pdf(service)

    class TransientEmptyEngine:
        profile = "fixture:empty-retry"

        def __init__(self):
            self.calls = 0

        def prepare_page(self, image, size):
            self.calls += 1
            return [] if self.calls == 1 else [LINE]

    inked_foundation = FoundationService(
        service, FoundationRepository(service.database), TransientEmptyEngine
    )
    assert inked_foundation.prepare_page(inked["id"], 0) == "READY"
    assert inked_foundation._engine().calls == 2
    assert len(inked_foundation.overlay(inked["id"], 0)["lines"]) == 1

    blank_foundation = FoundationService(
        service, FoundationRepository(service.database), TransientEmptyEngine
    )
    assert blank_foundation.prepare_page(blank["id"], 0) == "READY"
    assert blank_foundation._engine().calls == 1
    assert blank_foundation.overlay(blank["id"], 0)["lines"] == []


def test_nonblank_page_cannot_publish_empty_ocr_and_legacy_hole_repairs(service):
    revision = import_inked_pdf(service)
    repository = FoundationRepository(service.database)

    class EmptyEngine:
        profile = "fixture:empty"

        def prepare_page(self, image, size):
            return []

    foundation = FoundationService(service, repository, EmptyEngine)
    assert foundation.prepare_page(revision["id"], 0) == "FAILED"
    assert foundation.overlay(revision["id"], 0)["failure_code"] == "OCR_EMPTY_ON_NONBLANK_PAGE"

    repository.mark_preparing(revision["id"], 0)
    repository.publish_page(
        revision["id"], 0, route="OCR", foundation_version=1,
        engine_profile="legacy:empty", lines=[],
    )
    repaired = FoundationService(
        service, repository, lambda: FixedEngine()
    )
    assert repaired.repair_empty_ocr_pages(revision["id"], 0, 1) == [0]
    assert len(repaired.overlay(revision["id"], 0)["lines"]) == 1


def test_parallel_ocr_serializes_pdfium_rendering(service, monkeypatch):
    import pypdfium2 as pdfium

    revision = import_pdf(service, pages=2)
    original_document = pdfium.PdfDocument
    count_lock = threading.Lock()
    start = threading.Barrier(2)
    active = 0
    peak = 0

    class TrackingDocument:
        def __init__(self, path):
            nonlocal active, peak
            with count_lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            self.document = original_document(path)

        def __getitem__(self, index):
            return self.document[index]

        def close(self):
            nonlocal active
            self.document.close()
            with count_lock:
                active -= 1

    class ParallelFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            start.wait(timeout=5)
            return super()._extract(pdf_path, page_index)

    monkeypatch.setattr(pdfium, "PdfDocument", TrackingDocument)
    foundation = ParallelFoundation(
        service, FoundationRepository(service.database), FixedEngine,
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(
            lambda index: foundation._extract(service.pdf_path(revision["id"]), index),
            range(2),
        ))
    assert [result[0] for result in results] == ["OCR", "OCR"]
    assert peak == 1
    assert active == 0
