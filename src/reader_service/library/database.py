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
    (
        2,
        """
        ALTER TABLE book_source_revisions
            ADD COLUMN foundation_version INTEGER NOT NULL DEFAULT 1
            CHECK (foundation_version >= 1);

        CREATE TABLE ocr_pages (
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            status TEXT NOT NULL DEFAULT 'NOT_PREPARED'
                CHECK (status IN ('NOT_PREPARED', 'PREPARING', 'READY', 'FAILED')),
            route TEXT CHECK (route IS NULL OR route IN ('EMBEDDED', 'OCR')),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            engine_profile TEXT,
            confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
            prepared_at TEXT,
            failure_code TEXT,
            PRIMARY KEY (book_source_revision_id, pdf_page_index)
        );
        CREATE INDEX ix_ocr_pages_revision_status
            ON ocr_pages(book_source_revision_id, status, pdf_page_index);

        CREATE TABLE ocr_lines (
            book_source_revision_id TEXT NOT NULL,
            pdf_page_index INTEGER NOT NULL,
            line_ordinal INTEGER NOT NULL CHECK (line_ordinal >= 0),
            quad_json TEXT NOT NULL,
            text TEXT NOT NULL,
            confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
            cells_json TEXT NOT NULL,
            PRIMARY KEY (book_source_revision_id, pdf_page_index, line_ordinal),
            FOREIGN KEY (book_source_revision_id, pdf_page_index)
                REFERENCES ocr_pages(book_source_revision_id, pdf_page_index)
                ON DELETE CASCADE
        );

        CREATE TABLE jobs (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL CHECK (job_type = 'PAGE_PREPARE'),
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            page_start INTEGER NOT NULL CHECK (page_start >= 0),
            page_end INTEGER NOT NULL CHECK (page_end >= page_start),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            status TEXT NOT NULL
                CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED')),
            priority INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (
                job_type, book_source_revision_id, page_start, page_end, foundation_version
            )
        );
        CREATE INDEX ix_jobs_claim
            ON jobs(status, cancel_requested, priority DESC, created_at);
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
