from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


MIGRATIONS = (
    (
        1,
        """
        CREATE TABLE books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE', 'DELETING', 'DELETE_FAILED')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE book_source_revisions (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            blob_sha256 TEXT NOT NULL,
            byte_size INTEGER NOT NULL CHECK (byte_size > 0),
            page_count INTEGER NOT NULL CHECK (page_count > 0),
            page_geometry_json TEXT NOT NULL,
            label TEXT NOT NULL,
            status TEXT NOT NULL
                CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'DELETING', 'DELETE_FAILED', 'DELETED')),
            created_at TEXT NOT NULL,
            UNIQUE (book_id, blob_sha256)
        );
        CREATE INDEX ix_source_revisions_blob ON book_source_revisions(blob_sha256);
        CREATE UNIQUE INDEX ux_one_active_revision_per_book
            ON book_source_revisions(book_id) WHERE status = 'ACTIVE';

        CREATE TABLE reading_positions (
            book_source_revision_id TEXT PRIMARY KEY
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            normalized_offset REAL NOT NULL CHECK (normalized_offset >= 0 AND normalized_offset <= 1),
            zoom REAL NOT NULL CHECK (zoom >= 0.5 AND zoom <= 4),
            updated_at TEXT NOT NULL
        );
        """,
    ),
)


class Database:
    def __init__(self, path: Path):
        self.path = path

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            applied = {
                row[0] for row in connection.execute("SELECT version FROM schema_migrations")
            }
            for version, sql in MIGRATIONS:
                if version in applied:
                    continue
                connection.executescript(sql)
                connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
