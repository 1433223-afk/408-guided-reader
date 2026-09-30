from __future__ import annotations

import hashlib
import errno
import math
import os
import shutil
import sqlite3
import threading
from pathlib import Path
from typing import BinaryIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from reader_service.storage import BlobStore, ManagedPaths
from reader_service.pdf_limits import validate_render_size

from .database import Database
from .repository import LibraryRepository


class IntakeError(ValueError):
    def __init__(self, message: str, *, code: str = "INVALID_PDF"):
        super().__init__(message)
        self.code = code


class LibraryService:
    def __init__(self, paths: ManagedPaths, max_pdf_bytes: int = 2 * 1024 * 1024 * 1024):
        self.paths = paths
        self.paths.initialize()
        self.database = Database(paths.database())
        self.database.initialize()
        self.repository = LibraryRepository(self.database)
        self.blobs = BlobStore(paths)
        self.max_pdf_bytes = max_pdf_bytes
        self._mutation_lock = threading.Lock()

    def list_books(self) -> list[dict]:
        return self.repository.list_books()

    def intake(
        self,
        stream: BinaryIO,
        *,
        content_length: int,
        filename: str,
        book_id: str | None = None,
        title: str | None = None,
        label: str | None = None,
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

        temporary = None
        digest = hashlib.sha256()
        remaining = content_length
        try:
            if shutil.disk_usage(self.paths.root).free < content_length + 1024 * 1024:
                raise IntakeError("磁盘剩余空间不足，无法导入 PDF；请释放空间后重试。", code="STORAGE_FULL")
            temporary, output = self.paths.new_upload()
            with output:
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise IntakeError("The upload ended before the complete PDF arrived")
                    output.write(chunk)
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
        except IntakeError:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            raise
        except (OSError, sqlite3.Error) as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            full = (getattr(exc, "errno", None) in (errno.ENOSPC, errno.EDQUOT)
                    or getattr(exc, "winerror", None) in (39, 112)
                    or getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_FULL)
            raise IntakeError(
                "磁盘剩余空间不足，无法导入 PDF；请释放空间后重试。" if full else
                "无法保存 PDF，请检查数据目录是否可写后重试。",
                code="STORAGE_FULL" if full else "STORAGE_WRITE_FAILED") from exc
        except (PdfReadError, ValueError, TypeError, KeyError) as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
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
        # Some publisher PDFs carry owner permissions but open with an empty
        # user password. The reader can render these without a password.
        if reader.is_encrypted and not reader.decrypt(""):
            raise IntakeError("Encrypted or password-protected PDFs are not supported")
        if not reader.pages:
            raise IntakeError("The PDF contains no readable pages")

        pages: list[dict] = []
        for index, page in enumerate(reader.pages):
            box = page.mediabox
            x0, y0, x1, y1 = map(float, (box.left, box.bottom, box.right, box.top))
            if not all(math.isfinite(v) for v in (x0, y0, x1, y1)) or x1 <= x0 or y1 <= y0:
                raise IntakeError(f"Page {index + 1} has invalid media-box geometry")
            try:
                unit = float(page.get("/UserUnit", 1))
                if not math.isfinite(unit) or unit <= 0:
                    raise ValueError("PDF UserUnit 无效。")
                validate_render_size((x1 - x0) * unit, (y1 - y0) * unit)
            except ValueError as exc:
                raise IntakeError(f"第 {index + 1} 页：{exc}", code="PDF_PAGE_RESOURCE_LIMIT") from exc
            rotation = int(page.get("/Rotate", 0) or 0) % 360
            if rotation not in (0, 90, 180, 270):
                raise IntakeError(f"Page {index + 1} has an unsupported rotation")
            pages.append(
                {"media_box": [x0, y0, x1, y1], "rotation": rotation}
            )
        return pages
