from __future__ import annotations

from io import BytesIO

import pytest

from reader_service.foundation import DetectedLine, FoundationRepository, FoundationService

from conftest import make_pdf


class UnusedEngine:
    def prepare_page(self, page_image, page_size):
        raise AssertionError("search must not invoke OCR")


def line(text: str) -> DetectedLine:
    cell_width = 0.8 / max(1, len(text))
    return DetectedLine(
        quad=((0.1, 0.1), (0.9, 0.1), (0.9, 0.2), (0.1, 0.2)),
        text=text,
        confidence=1,
        cells=tuple(
            (0.1 + index * cell_width, 0.1 + (index + 1) * cell_width, index, index + 1)
            for index in range(len(text))
        ),
    )


def prepared_search(service):
    payload = make_pdf(tuple((612, 792) for _ in range(4)))
    imported = service.intake(
        BytesIO(payload), content_length=len(payload), filename="search.pdf"
    )
    revision = imported["book"]["active_revision"]
    repository = FoundationRepository(service.database)
    foundation = FoundationService(service, repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    page_lines = {
        0: [line("计算机系统总线"), line("中断"), line("向量表")],
        1: [line("NOT_PREPARED 总线")],
        2: [line("PREPARING 总线")],
        3: [line("FAILED 总线")],
    }
    for page_index, lines in page_lines.items():
        assert repository.mark_preparing(revision["id"], page_index)
        repository.publish_page(
            revision["id"], page_index, route="OCR", foundation_version=1,
            engine_profile="fixture:v1", lines=lines,
        )
    with service.database.connect() as connection:
        connection.execute(
            "UPDATE ocr_pages SET status = 'NOT_PREPARED' WHERE book_source_revision_id = ? AND pdf_page_index = 1",
            (revision["id"],),
        )
        connection.execute(
            "UPDATE ocr_pages SET status = 'PREPARING' WHERE book_source_revision_id = ? AND pdf_page_index = 2",
            (revision["id"],),
        )
        connection.execute(
            "UPDATE ocr_pages SET status = 'FAILED' WHERE book_source_revision_id = ? AND pdf_page_index = 3",
            (revision["id"],),
        )
    return imported["book"], revision, foundation


def test_search_normalizes_chinese_phrase_and_only_reads_ready_pages(service):
    _book, revision, foundation = prepared_search(service)

    term = foundation.search(revision["id"], "总线")
    assert [row["pdf_page_index"] for row in term["results"]] == [0]
    assert term["results"][0]["match_ranges"] == [
        {"line_ordinal": 0, "cell_start": 5, "cell_end": 7}
    ]
    assert term["coverage"] == {
        "ready_pages": 1,
        "total_pages": 4,
        "complete": False,
        "statuses": {"READY": 1, "NOT_PREPARED": 1, "PREPARING": 1, "FAILED": 1},
    }
    phrase = foundation.search(revision["id"], "中断向量")
    assert phrase["results"][0]["pdf_page_index"] == 0
    assert phrase["results"][0]["match_ranges"] == [
        {"line_ordinal": 1, "cell_start": 0, "cell_end": 2},
        {"line_ordinal": 2, "cell_start": 0, "cell_end": 2},
    ]
    assert "中断 向量" in phrase["results"][0]["snippet"]
    assert foundation.search(revision["id"], "不存在的词")["results"] == []


def test_search_normalizes_nfkc_case_and_bounds_results(service):
    _book, revision, foundation = prepared_search(service)
    assert foundation.search(revision["id"], "ＣＯＭＰＵＴＥＲ")["results"] == []
    with service.database.connect() as connection:
        connection.execute(
            "UPDATE ocr_lines SET text = 'Computer BUS' WHERE book_source_revision_id = ? AND pdf_page_index = 0 AND line_ordinal = 0",
            (revision["id"],),
        )
    assert foundation.search(revision["id"], "ｃｏｍｐｕｔｅｒｂｕｓ")["results"][0]["pdf_page_index"] == 0
    assert foundation.search(revision["id"], "   ")["results"] == []


def test_search_has_no_ghost_results_after_book_deletion(service):
    book, revision, foundation = prepared_search(service)
    assert foundation.search(revision["id"], "总线")["results"]
    service.delete_book(book["id"])
    with pytest.raises(LookupError):
        foundation.search(revision["id"], "总线")
    with service.database.connect() as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM ocr_lines WHERE book_source_revision_id = ?",
            (revision["id"],),
        ).fetchone()[0] == 0
