from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from uuid import uuid4

from .database import Database


def now() -> str:
    return datetime.now(UTC).isoformat()


class LibraryRepository:
    def __init__(self, database: Database):
        self.database = database

    def list_books(self) -> list[dict]:
        query = """
            SELECT b.id AS book_id, b.title, b.status AS book_status, b.created_at AS book_created_at,
                   r.id AS revision_id, r.blob_sha256, r.byte_size, r.page_count,
                   r.page_geometry_json, r.label, r.status AS revision_status,
                   r.foundation_version,
                   r.created_at AS revision_created_at,
                   p.pdf_page_index, p.normalized_offset, p.zoom, p.updated_at,
                   (SELECT COUNT(*) FROM book_source_revisions all_r
                    WHERE all_r.book_id = b.id AND all_r.status IN ('ACTIVE', 'SUPERSEDED')) AS revision_count
            FROM books b
            JOIN book_source_revisions r ON r.book_id = b.id AND r.status = 'ACTIVE'
            LEFT JOIN reading_positions p ON p.book_source_revision_id = r.id
            WHERE b.status = 'ACTIVE'
            ORDER BY b.created_at DESC
        """
        with self.database.connect() as connection:
            books = [self._book_row(row) for row in connection.execute(query)]
            failures = connection.execute(
                """
                SELECT b.id, b.title, b.status, b.created_at, COUNT(r.id) AS revision_count
                FROM books b LEFT JOIN book_source_revisions r ON r.book_id = b.id
                WHERE b.status = 'DELETE_FAILED'
                GROUP BY b.id ORDER BY b.created_at DESC
                """
            )
            books.extend(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "revision_count": row["revision_count"],
                    "active_revision": None,
                }
                for row in failures
            )
            return books

    def get_book(self, book_id: str) -> dict | None:
        return next(
            (
                book
                for book in self.list_books()
                if book["id"] == book_id and book["status"] == "ACTIVE"
            ),
            None,
        )

    def find_revision_by_hash(self, sha256: str, book_id: str | None = None) -> dict | None:
        where = "r.blob_sha256 = ? AND r.status IN ('ACTIVE', 'SUPERSEDED')"
        parameters: list[str] = [sha256]
        if book_id:
            where += " AND r.book_id = ?"
            parameters.append(book_id)
        query = f"""
            SELECT r.*, b.title
            FROM book_source_revisions r JOIN books b ON b.id = r.book_id
            WHERE {where} ORDER BY r.created_at LIMIT 1
        """
        with self.database.connect() as connection:
            row = connection.execute(query, parameters).fetchone()
            return self._revision_row(row) if row else None

    def get_revision(self, revision_id: str) -> dict | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT r.*, b.title FROM book_source_revisions r "
                "JOIN books b ON b.id = r.book_id "
                "WHERE r.id = ? AND b.status = 'ACTIVE' "
                "AND r.status IN ('ACTIVE', 'SUPERSEDED')",
                (revision_id,),
            ).fetchone()
            return self._revision_row(row) if row else None

    def create_revision(
        self,
        *,
        book_id: str | None,
        title: str,
        sha256: str,
        byte_size: int,
        page_count: int,
        page_geometry: list[dict],
        label: str,
    ) -> tuple[str, str]:
        revision_id = str(uuid4())
        timestamp = now()
        with self.database.connect() as connection:
            if book_id is None:
                book_id = str(uuid4())
                connection.execute(
                    "INSERT INTO books(id, title, status, created_at) VALUES (?, ?, 'ACTIVE', ?)",
                    (book_id, title, timestamp),
                )
            else:
                found = connection.execute(
                    "SELECT 1 FROM books WHERE id = ? AND status = 'ACTIVE'", (book_id,)
                ).fetchone()
                if not found:
                    raise LookupError("The selected book does not exist")
                connection.execute(
                    "UPDATE book_source_revisions SET status = 'SUPERSEDED' "
                    "WHERE book_id = ? AND status = 'ACTIVE'",
                    (book_id,),
                )
            connection.execute(
                """
                INSERT INTO book_source_revisions(
                    id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
                    label, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
                """,
                (
                    revision_id,
                    book_id,
                    sha256,
                    byte_size,
                    page_count,
                    json.dumps(page_geometry, separators=(",", ":")),
                    label,
                    timestamp,
                ),
            )
        return book_id, revision_id

    def save_position(
        self, revision_id: str, page_index: int, normalized_offset: float, zoom: float
    ) -> dict:
        revision = self.get_revision(revision_id)
        if not revision:
            raise LookupError("Book source revision not found")
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        if not 0 <= normalized_offset <= 1:
            raise ValueError("In-page position must be between 0 and 1")
        if not 0.5 <= zoom <= 4:
            raise ValueError("Zoom must be between 50% and 400%")
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO reading_positions(
                    book_source_revision_id, pdf_page_index, normalized_offset, zoom, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(book_source_revision_id) DO UPDATE SET
                    pdf_page_index = excluded.pdf_page_index,
                    normalized_offset = excluded.normalized_offset,
                    zoom = excluded.zoom,
                    updated_at = excluded.updated_at
                """,
                (revision_id, page_index, normalized_offset, zoom, timestamp),
            )
        return {
            "pdf_page_index": page_index,
            "normalized_offset": normalized_offset,
            "zoom": zoom,
            "updated_at": timestamp,
        }

    def start_delete(self, book_id: str) -> list[str]:
        with self.database.connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM books WHERE id = ? AND status IN ('ACTIVE', 'DELETE_FAILED')",
                (book_id,),
            ).fetchone()
            if not exists:
                raise LookupError("Book not found")
            hashes = [
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT blob_sha256 FROM book_source_revisions WHERE book_id = ?",
                    (book_id,),
                )
            ]
            connection.execute("UPDATE books SET status = 'DELETING' WHERE id = ?", (book_id,))
            connection.execute(
                "UPDATE book_source_revisions SET status = 'DELETING' WHERE book_id = ?", (book_id,)
            )
            return hashes

    def blob_referenced_outside_book(self, sha256: str, book_id: str) -> bool:
        with self.database.connect() as connection:
            return bool(
                connection.execute(
                    "SELECT 1 FROM book_source_revisions WHERE blob_sha256 = ? AND book_id <> ? LIMIT 1",
                    (sha256, book_id),
                ).fetchone()
            )

    def finish_delete(self, book_id: str) -> None:
        with self.database.connect() as connection:
            connection.execute("DELETE FROM books WHERE id = ?", (book_id,))

    def fail_delete(self, book_id: str) -> None:
        with self.database.connect() as connection:
            connection.execute("UPDATE books SET status = 'DELETE_FAILED' WHERE id = ?", (book_id,))
            connection.execute(
                "UPDATE book_source_revisions SET status = 'DELETE_FAILED' WHERE book_id = ?",
                (book_id,),
            )

    def blob_reference_count(self, sha256: str) -> int:
        with self.database.connect() as connection:
            return connection.execute(
                "SELECT COUNT(*) FROM book_source_revisions WHERE blob_sha256 = ?", (sha256,)
            ).fetchone()[0]

    @staticmethod
    def _book_row(row: sqlite3.Row) -> dict:
        return {
            "id": row["book_id"],
            "title": row["title"],
            "status": row["book_status"],
            "created_at": row["book_created_at"],
            "revision_count": row["revision_count"],
            "active_revision": {
                "id": row["revision_id"],
                "blob_sha256": row["blob_sha256"],
                "byte_size": row["byte_size"],
                "page_count": row["page_count"],
                "page_geometry": json.loads(row["page_geometry_json"]),
                "label": row["label"],
                "status": row["revision_status"],
                "foundation_version": row["foundation_version"],
                "created_at": row["revision_created_at"],
                "position": {
                    "pdf_page_index": row["pdf_page_index"] or 0,
                    "normalized_offset": row["normalized_offset"] or 0,
                    "zoom": row["zoom"] or 1,
                    "updated_at": row["updated_at"],
                },
            },
        }

    @staticmethod
    def _revision_row(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "book_id": row["book_id"],
            "title": row["title"],
            "blob_sha256": row["blob_sha256"],
            "byte_size": row["byte_size"],
            "page_count": row["page_count"],
            "page_geometry": json.loads(row["page_geometry_json"]),
            "label": row["label"],
            "status": row["status"],
            "foundation_version": row["foundation_version"],
            "created_at": row["created_at"],
        }
