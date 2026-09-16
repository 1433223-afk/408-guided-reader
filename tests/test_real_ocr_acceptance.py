from __future__ import annotations

import hashlib
import os
from io import BytesIO
from pathlib import Path

import pytest

from reader_service.foundation import FoundationRepository, FoundationService
from reader_service.foundation.rapidocr_adapter import RapidOcrEngine
from reader_service.library import LibraryService
from reader_service.storage import ManagedPaths


PRIMARY_SHA256 = "327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1"
DMA_SHA256 = "6cae19dfe20fc35dc3a61f2625a4cfcd6850a7e92a7dd44afbb43414bd6dcdc6"


def source(name: str, expected_sha256: str) -> Path:
    value = os.environ.get(name)
    if not value:
        pytest.skip(f"{name} is not set")
    path = Path(value)
    if not path.is_file():
        pytest.fail(f"{name} does not point to a file: {path}")
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    assert actual == expected_sha256
    return path


def intake(service: LibraryService, path: Path) -> dict:
    payload = path.read_bytes()
    return service.intake(
        BytesIO(payload), content_length=len(payload), filename=path.name
    )["book"]["active_revision"]


@pytest.mark.parametrize(
    ("environment", "expected_sha256", "page_indices"),
    [
        ("READER_REAL_DMA", DMA_SHA256, (0, 5, 7, 8, 9, 15, 16)),
        ("READER_REAL_PRIMARY", PRIMARY_SHA256, (0, 4)),
    ],
)
def test_inherited_nine_page_real_ocr_structure(
    tmp_path, environment, expected_sha256, page_indices
):
    path = source(environment, expected_sha256)
    service = LibraryService(ManagedPaths(tmp_path / environment))
    revision = intake(service, path)
    foundation = FoundationService(
        service, FoundationRepository(service.database), RapidOcrEngine, render_dpi=200
    )

    line_counts = []
    for page_index in page_indices:
        assert foundation.prepare_page(revision["id"], page_index) == "READY"
        page = foundation.overlay(revision["id"], page_index)
        assert page["route"] == "OCR"
        assert page["foundation_version"] == 1
        assert 5 <= len(page["lines"]) <= 140
        assert [line["line_ordinal"] for line in page["lines"]] == list(
            range(len(page["lines"]))
        )
        selectable = 0
        for line in page["lines"]:
            assert len(line["quad"]) == 4
            assert all(0 <= coordinate <= 1 for point in line["quad"] for coordinate in point)
            previous_end = -1
            for cell in line["cells"]:
                assert isinstance(cell, list) and len(cell) == 4
                x_start, x_end, char_start, char_end = cell
                assert 0 <= x_start <= x_end <= 1
                assert 0 <= char_start < char_end <= len(line["text"])
                assert char_start >= previous_end
                previous_end = char_end
            if line["cells"]:
                first = line["cells"][0]
                resolved = line["text"][first[2] : first[3]]
                assert resolved
                selectable += 1
        assert selectable >= max(1, len(page["lines"]) // 2)
        line_counts.append(len(page["lines"]))

    # The inherited baseline is 393 lines across all nine pages. Keep this
    # structural and tolerant to ordinary detector variation, never exact text.
    if len(page_indices) == 7:
        assert 180 <= sum(line_counts) <= 500
    else:
        assert 20 <= sum(line_counts) <= 180
