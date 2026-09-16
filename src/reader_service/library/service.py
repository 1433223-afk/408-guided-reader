from __future__ import annotations

import hashlib
import os
import sqlite3
import threading
from contextlib import nullcontext
from pathlib import Path
from typing import BinaryIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from reader_service.storage import BlobStore, ManagedPaths
from reader_service.disk import DiskSpaceError

from .database import Database, MIGRATIONS
from .repository import LibraryRepository


class IntakeError(ValueError):
    pass


class LibraryService:
    def __init__(self, paths: ManagedPaths, max_pdf_bytes: int = 2 * 1024 * 1024 * 1024, *, disk_guard=None):
        self.paths = paths
        self.paths.initialize()
        self.database = Database(paths.database())
        if disk_guard:
            needs_migration = True
            if paths.database().exists():
                with sqlite3.connect(paths.database().resolve().as_uri()+"?mode=ro", uri=True) as check:
                    try:
                        current = check.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
                        needs_migration = current != MIGRATIONS[-1][0]
                    except sqlite3.OperationalError:
                        pass
            if needs_migration:
                disk_guard.check()
        self.database.initialize()
        self.disk_guard = disk_guard
        self.database.growth_check = disk_guard.check if disk_guard else None
        self.repository = LibraryRepository(self.database)
        self.blobs = BlobStore(paths)
        self.max_pdf_bytes = max_pdf_bytes
        self._mutation_lock = threading.Lock()

    def list_books(self) -> list[dict]:
        return self.repository.list_books()

    def intake(
        self, stream: BinaryIO, *, content_length: int, **kwargs
    ) -> dict:
        if content_length <= 0 or content_length > self.max_pdf_bytes:
            raise IntakeError("请选择不超过 512 MiB 的 PDF。" if self.disk_guard else "Invalid PDF intake size")
        reservation = self.disk_guard.upload(content_length) if self.disk_guard else nullcontext(None)
        with reservation as consumed:
            return self._intake(stream, content_length=content_length, consumed=consumed, **kwargs)

    def _intake(
        self,
        stream: BinaryIO,
        *,
        content_length: int,
        filename: str,
        book_id: str | None = None,
        title: str | None = None,
        label: str | None = None,
        consumed=None,
    ) -> dict:
        if content_length <= 0:
            raise IntakeError("The selected file is empty")
        if content_length > self.max_pdf_bytes:
            raise IntakeError("The PDF is larger than the configured intake limit")
        clean_filename = Path(filename).name.strip() or "book.pdf"
        clean_title = (title or Path(clean_filename).stem).strip()
        if not clean_title:
            raise IntakeError("A book title is required")
        clean_label = (label or clean_filename).strip() or clean_filename

        temporary, output = self.paths.new_upload()
        digest = hashlib.sha256()
        remaining = content_length
        try:
            with output:
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise IntakeError("The upload ended before the complete PDF arrived")
                    output.write(chunk)
                    if consumed:
                        consumed(len(chunk))
                    digest.update(chunk)
                    remaining -= len(chunk)
                output.flush()
                os.fsync(output.fileno())

            page_geometry = self._validate_pdf(temporary)
            sha256 = digest.hexdigest()
            with self._mutation_lock:
                duplicate = self.repository.find_revision_by_hash(sha256, book_id)
                if not book_id and duplicate is None:
                    duplicate = self.repository.find_revision_by_hash(sha256)
                if duplicate:
                    temporary.unlink(missing_ok=True)
                    book = self.repository.get_book(duplicate["book_id"])
                    return {"duplicate": True, "book": book}

                _, blob_created = self.blobs.commit(temporary, sha256)
                try:
                    created_book_id, _ = self.repository.create_revision(
                        book_id=book_id,
                        title=clean_title,
                        sha256=sha256,
                        byte_size=content_length,
                        page_count=len(page_geometry),
                        page_geometry=page_geometry,
                        label=clean_label,
                    )
                except Exception:
                    if blob_created and self.repository.blob_reference_count(sha256) == 0:
                        self.blobs.delete(sha256)
                    raise
                return {"duplicate": False, "book": self.repository.get_book(created_book_id)}
        except (IntakeError, DiskSpaceError):
            temporary.unlink(missing_ok=True)
            raise
        except (PdfReadError, OSError, ValueError, TypeError, KeyError) as exc:
            temporary.unlink(missing_ok=True)
            if self.disk_guard:
                raise IntakeError("PDF 无法导入，请检查文件或可用空间。") from None
            raise IntakeError(f"The PDF is corrupt or unreadable: {exc}") from exc

    def revision(self, revision_id: str) -> dict:
        revision = self.repository.get_revision(revision_id)
        if not revision:
            raise LookupError("Book source revision not found")
        return revision

    def pdf_path(self, revision_id: str) -> Path:
        return self.paths.blob(self.revision(revision_id)["blob_sha256"])

    def save_position(
        self, revision_id: str, page_index: int, normalized_offset: float, zoom: float
    ) -> dict:
        return self.repository.save_position(revision_id, page_index, normalized_offset, zoom)

    def delete_book(self, book_id: str) -> None:
        with self._mutation_lock:
            hashes = self.repository.start_delete(book_id)
            try:
                for sha256 in hashes:
                    if not self.repository.blob_referenced_outside_book(sha256, book_id):
                        self.blobs.delete(sha256)
                self.repository.finish_delete(book_id)
            except Exception:
                self.repository.fail_delete(book_id)
                raise

    @staticmethod
    def _validate_pdf(path: Path) -> list[dict]:
        with path.open("rb") as pdf:
            if b"%PDF-" not in pdf.read(1024):
                raise IntakeError("The selected file does not have a PDF header")
            pdf.seek(max(0, path.stat().st_size - 4096))
            if b"%%EOF" not in pdf.read():
                raise IntakeError("The PDF is incomplete (missing end marker)")

        reader = PdfReader(path, strict=True)
        if reader.is_encrypted:
            raise IntakeError("Encrypted or password-protected PDFs are not supported")
        if not reader.pages:
            raise IntakeError("The PDF contains no readable pages")

        pages: list[dict] = []
        for index, page in enumerate(reader.pages):
            box = page.mediabox
            x0, y0, x1, y1 = map(float, (box.left, box.bottom, box.right, box.top))
            if x1 <= x0 or y1 <= y0:
                raise IntakeError(f"Page {index + 1} has invalid media-box geometry")
            rotation = int(page.get("/Rotate", 0) or 0) % 360
            if rotation not in (0, 90, 180, 270):
                raise IntakeError(f"Page {index + 1} has an unsupported rotation")
            pages.append(
                {"media_box": [x0, y0, x1, y1], "rotation": rotation}
            )
        return pages
