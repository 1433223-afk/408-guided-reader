from __future__ import annotations

import json
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


@pytest.mark.parametrize(('texts', 'query', 'expected'), [
    (['Ａ \tß', 'ﬃ Ｂ'], 'SS ffi', [(0, 3, 4), (1, 0, 1)]),
    (['Ａ \tß', 'ﬃ Ｂ'], 'i Ｂ', [(1, 0, 3)]),
    (['㍿'], '会社', [(0, 0, 1)]),
    (['İ'], '\u0307', [(0, 0, 1)]),
    (['ＣＯＭＰＵＴＥＲ　ＢＵＳ'], 'computer bus', [(0, 0, 12)]),
    # Preserve the established per-character source normalization even for
    # combining sequences whose whole-string NFKC would compose differently.
    (['e\u0301'], 'é', []),
])
def test_search_retains_unicode_expansion_and_cross_line_cell_ranges(service, texts, query, expected):
    _book, revision, foundation = prepared_search(service)
    with service.database.connect() as c:
        c.execute("UPDATE ocr_pages SET status='PREPARING' WHERE book_source_revision_id=? AND pdf_page_index=0",
                  (revision['id'],))
    foundation.repository.publish_page(
        revision['id'], 0, route='OCR', foundation_version=1,
        engine_profile='fixture:v1', lines=[line(text) for text in texts],
    )
    response = foundation.search(revision['id'], query)
    if not expected:
        assert response['results'] == []
    else:
        assert response['results'][0]['match_ranges'] == [
            {'line_ordinal': ordinal, 'cell_start': start, 'cell_end': end}
            for ordinal, start, end in expected
        ]


def test_search_decodes_cells_only_for_matching_lines(service, monkeypatch):
    _book, revision, foundation = prepared_search(service)
    with service.database.connect() as c:
        c.execute("UPDATE ocr_pages SET status='PREPARING' WHERE book_source_revision_id=? AND pdf_page_index=0",
                  (revision['id'],))
    foundation.repository.publish_page(
        revision['id'], 0, route='OCR', foundation_version=1,
        engine_profile='fixture:v1', lines=[line('总线'), *[line('普通正文') for _ in range(100)]],
    )
    decoded = []
    original_loads = json.loads

    def loads(value, *args, **kwargs):
        decoded.append(value)
        return original_loads(value, *args, **kwargs)

    monkeypatch.setattr(json, 'loads', loads)
    result = foundation.search(revision['id'], '总线')
    assert result['results'][0]['match_ranges'] == [
        {'line_ordinal': 0, 'cell_start': 0, 'cell_end': 2}
    ]
    assert len(decoded) < 10, 'search decoded the entire matching page instead of matching rows'


def test_search_preserves_hundred_page_limit_and_truncated_flag(service):
    payload = make_pdf(tuple((612, 792) for _ in range(103)))
    imported = service.intake(BytesIO(payload), content_length=len(payload), filename='many-pages.pdf')
    revision = imported['book']['active_revision']
    foundation = FoundationService(service, FoundationRepository(service.database), UnusedEngine)
    foundation.ensure_revision(revision['id'])
    for index in range(103):
        assert foundation.repository.mark_preparing(revision['id'], index)
        foundation.repository.publish_page(
            revision['id'], index, route='OCR', foundation_version=1,
            engine_profile='fixture:v1', lines=[line('总线')],
        )
    result = foundation.search(revision['id'], '总线')
    assert [item['pdf_page_index'] for item in result['results']] == list(range(100))
    assert result['truncated'] is True
    assert all(item['match_ranges'] == [{'line_ordinal': 0, 'cell_start': 0, 'cell_end': 2}]
               for item in result['results'])
    result = foundation.search(revision['id'], '总线', limit=3)
    assert len(result['results']) == 3 and result['truncated'] is True
    with pytest.raises(ValueError, match='limit'):
        foundation.search(revision['id'], '总线', limit=101)
