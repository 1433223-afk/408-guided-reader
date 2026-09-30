from __future__ import annotations

from io import BytesIO
import errno
import os
import shutil
from types import SimpleNamespace

import pytest

from reader_service.library import IntakeError

from conftest import make_pdf


def import_bytes(service, data, filename="book.pdf", **kwargs):
    return service.intake(BytesIO(data), content_length=len(data), filename=filename, **kwargs)


@pytest.mark.parametrize("stage", ["space", "create", "write", "fsync", "commit", "database"])
def test_storage_full_does_not_publish_partial_book(service, monkeypatch, stage):
    import sqlite3
    def full(*args, **kwargs):
        if stage == "database":
            error = sqlite3.OperationalError("database or disk is full")
            error.sqlite_errorcode = sqlite3.SQLITE_FULL
            raise error
        raise OSError(errno.ENOSPC, "disk full")
    if stage == "space":
        monkeypatch.setattr(shutil, "disk_usage", lambda _: SimpleNamespace(free=0))
    elif stage == "create":
        monkeypatch.setattr(service.paths, "new_upload", full)
    elif stage == "write":
        original = service.paths.new_upload
        class PartialWrite:
            def __init__(self, raw): self.raw = raw
            def __enter__(self): return self
            def __exit__(self, *args): self.raw.close()
            def write(self, data):
                self.raw.write(data[:64])
                full()
        def upload():
            path, raw = original()
            return path, PartialWrite(raw)
        monkeypatch.setattr(service.paths, "new_upload", upload)
    elif stage == "fsync":
        monkeypatch.setattr(os, "fsync", full)
    elif stage == "commit":
        monkeypatch.setattr(service.blobs, "commit", full)
    else:
        monkeypatch.setattr(service.repository, "create_revision", full)
    with pytest.raises(IntakeError) as failure:
        import_bytes(service, make_pdf())
    assert failure.value.code == "STORAGE_FULL"
    assert service.list_books() == []
    assert not list(service.paths.temp_root().iterdir())
    assert not list(service.paths.blob_root().rglob("*.pdf"))


def test_write_permission_is_not_reported_as_corrupt_pdf(service, monkeypatch):
    def denied():
        raise PermissionError(errno.EACCES, "denied")
    monkeypatch.setattr(service.paths, "new_upload", denied)
    with pytest.raises(IntakeError) as failure:
        import_bytes(service, make_pdf())
    assert failure.value.code == "STORAGE_WRITE_FAILED"


def test_huge_pdf_page_is_rejected_without_rendering(service):
    with pytest.raises(IntakeError) as failure:
        import_bytes(service, make_pdf(((100000, 100000),)))
    assert failure.value.code == "PDF_PAGE_RESOURCE_LIMIT"
    assert service.list_books() == []


def test_pdf_user_unit_cannot_bypass_render_budget(service):
    from pypdf import PdfWriter
    from pypdf.generic import NameObject, NumberObject
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)[NameObject("/UserUnit")] = NumberObject(100)
    stream = BytesIO()
    writer.write(stream)
    with pytest.raises(IntakeError) as failure:
        import_bytes(service, stream.getvalue())
    assert failure.value.code == "PDF_PAGE_RESOURCE_LIMIT"


def test_import_deduplicate_new_revision_position_and_delete(service):
    first_pdf = make_pdf(((612, 792),))
    first = import_bytes(service, first_pdf, "first.pdf")
    first_book = first["book"]
    first_revision = first_book["active_revision"]

    assert first["duplicate"] is False
    assert first_revision["page_count"] == 1
    assert service.pdf_path(first_revision["id"]).read_bytes() == first_pdf

    duplicate = import_bytes(service, first_pdf, "renamed.pdf")
    assert duplicate["duplicate"] is True
    assert duplicate["book"]["id"] == first_book["id"]
    assert len(service.list_books()) == 1

    second_pdf = make_pdf(((500, 700), (700, 500)))
    revised = import_bytes(
        service, second_pdf, "second-edition.pdf", book_id=first_book["id"], label="Second edition"
    )
    active = revised["book"]["active_revision"]
    assert active["id"] != first_revision["id"]
    assert active["page_count"] == 2
    assert revised["book"]["revision_count"] == 2
    assert service.revision(first_revision["id"])["status"] == "SUPERSEDED"

    position = service.save_position(active["id"], 1, 0.375, 1.4)
    assert position["pdf_page_index"] == 1
    reopened = service.list_books()[0]["active_revision"]["position"]
    assert reopened["pdf_page_index"] == 1
    assert reopened["normalized_offset"] == pytest.approx(0.375)
    assert reopened["zoom"] == pytest.approx(1.4)
    assert reopened["updated_at"]

    blob_paths = [service.paths.blob(first_revision["blob_sha256"]), service.paths.blob(active["blob_sha256"])]
    service.delete_book(first_book["id"])
    assert service.list_books() == []
    assert all(not path.exists() for path in blob_paths)


def test_shared_blob_survives_deleting_one_book(service):
    shared_pdf = make_pdf()
    original = import_bytes(service, shared_pdf, "shared.pdf")["book"]
    other_pdf = make_pdf(((400, 400),))
    second = import_bytes(service, other_pdf, "other.pdf")["book"]

    attached = import_bytes(service, shared_pdf, "shared.pdf", book_id=second["id"])["book"]
    shared_path = service.pdf_path(attached["active_revision"]["id"])
    service.delete_book(original["id"])

    assert shared_path.exists()
    assert service.pdf_path(attached["active_revision"]["id"]).read_bytes() == shared_pdf


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (b"not a pdf", "does not have a PDF header"),
        (b"%PDF-1.7\ntruncated", "missing end marker"),
    ],
)
def test_corrupt_input_commits_nothing(service, data, reason):
    with pytest.raises(IntakeError, match=reason):
        import_bytes(service, data)
    assert service.list_books() == []
    assert list(service.paths.blob_root().rglob("*.pdf")) == []


def test_encrypted_input_has_clear_failure_and_commits_nothing(service):
    data = make_pdf(encrypted=True)
    with pytest.raises(IntakeError, match="Encrypted or password-protected"):
        import_bytes(service, data)
    assert service.list_books() == []
    assert list(service.paths.blob_root().rglob("*.pdf")) == []


def test_pdf_with_empty_user_password_can_be_imported(service):
    from io import BytesIO
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.encrypt("", owner_password="owner-only")
    output = BytesIO()
    writer.write(output)
    book = import_bytes(service, output.getvalue(), "owner-restricted.pdf")["book"]
    assert book["active_revision"]["page_count"] == 1


def test_position_rejects_pages_outside_revision(service):
    book = import_bytes(service, make_pdf(), "book.pdf")["book"]
    with pytest.raises(ValueError, match="outside"):
        service.save_position(book["active_revision"]["id"], 1, 0, 1)


def test_failed_delete_is_hidden_from_reader_and_retryable(service, monkeypatch):
    book = import_bytes(service, make_pdf(), "book.pdf")["book"]
    original_delete = service.blobs.delete

    def fail_once(_sha256):
        raise OSError("simulated locked file")

    monkeypatch.setattr(service.blobs, "delete", fail_once)
    with pytest.raises(OSError, match="locked"):
        service.delete_book(book["id"])

    failed = service.list_books()
    assert failed[0]["status"] == "DELETE_FAILED"
    assert failed[0]["active_revision"] is None

    monkeypatch.setattr(service.blobs, "delete", original_delete)
    service.delete_book(book["id"])
    assert service.list_books() == []
