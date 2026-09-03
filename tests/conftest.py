from __future__ import annotations

from io import BytesIO

import pytest
from pypdf import PdfWriter

from reader_service.library import LibraryService
from reader_service.storage import ManagedPaths


def make_pdf(page_sizes=((612, 792),), *, encrypted=False) -> bytes:
    writer = PdfWriter()
    for width, height in page_sizes:
        writer.add_blank_page(width=width, height=height)
    if encrypted:
        writer.encrypt("secret")
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def service(tmp_path):
    return LibraryService(ManagedPaths(tmp_path / "data"))
