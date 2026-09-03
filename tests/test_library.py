from __future__ import annotations

from io import BytesIO

import pytest

from reader_service.library import IntakeError

from conftest import make_pdf


def import_bytes(service, data, filename="book.pdf", **kwargs):
    return service.intake(BytesIO(data), content_length=len(data), filename=filename, **kwargs)


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
