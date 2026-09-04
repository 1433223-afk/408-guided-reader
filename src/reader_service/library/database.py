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
    (
        3,
        """
        -- R2 pre-anchor compatibility reset.  Earlier prepared geometry used a
        -- Y-only hit-test reading order and an unsafe embedded-text transform.
        -- No user anchor assets exist yet, so invalidate only the active
        -- machine layer and reuse the baseline foundation version.
        DELETE FROM ocr_lines
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );

        UPDATE ocr_pages
        SET status = 'NOT_PREPARED', route = NULL, engine_profile = NULL,
            confidence = NULL, prepared_at = NULL, failure_code = NULL
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );

        UPDATE jobs
        SET status = 'QUEUED', priority = 0, cancel_requested = 0, attempts = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE book_source_revision_id IN (
            SELECT id FROM book_source_revisions WHERE status = 'ACTIVE'
        );
        """,
    ),
    (
        4,
        """
        CREATE TABLE annotations (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind = 'TEXT'),
            quads_json TEXT NOT NULL,
            quote TEXT NOT NULL CHECK (length(quote) > 0),
            context_before TEXT NOT NULL,
            context_after TEXT NOT NULL,
            foundation_version_at_creation INTEGER NOT NULL
                CHECK (foundation_version_at_creation >= 1),
            body TEXT CHECK (body IS NULL OR (length(body) > 0 AND length(body) <= 1000)),
            highlight_style TEXT NOT NULL DEFAULT 'YELLOW'
                CHECK (highlight_style = 'YELLOW'),
            source_kind TEXT NOT NULL DEFAULT 'USER' CHECK (source_kind = 'USER'),
            verification_state TEXT CHECK (verification_state IS NULL),
            anchor_state TEXT NOT NULL DEFAULT 'OK' CHECK (anchor_state = 'OK'),
            knowledge_point_id TEXT CHECK (knowledge_point_id IS NULL),
            created_at TEXT NOT NULL
        );
        CREATE INDEX ix_annotations_revision_page
            ON annotations(book_source_revision_id, pdf_page_index, created_at, id);
        """,
    ),
    (
        5,
        """
        -- Annotation highlight style is presentation data, independent from
        -- both the durable text anchor and the optional note body. Rebuild the
        -- table so existing user assets survive while the R3 UI gains a small,
        -- explicitly bounded palette including no visible paint.
        CREATE TABLE annotations_v5 (
            id TEXT PRIMARY KEY,
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            pdf_page_index INTEGER NOT NULL CHECK (pdf_page_index >= 0),
            kind TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind = 'TEXT'),
            quads_json TEXT NOT NULL,
            quote TEXT NOT NULL CHECK (length(quote) > 0),
            context_before TEXT NOT NULL,
            context_after TEXT NOT NULL,
            foundation_version_at_creation INTEGER NOT NULL
                CHECK (foundation_version_at_creation >= 1),
            body TEXT CHECK (body IS NULL OR (length(body) > 0 AND length(body) <= 1000)),
            highlight_style TEXT NOT NULL DEFAULT 'YELLOW'
                CHECK (highlight_style IN ('YELLOW', 'GREEN', 'BLUE', 'NONE')),
            source_kind TEXT NOT NULL DEFAULT 'USER' CHECK (source_kind = 'USER'),
            verification_state TEXT CHECK (verification_state IS NULL),
            anchor_state TEXT NOT NULL DEFAULT 'OK' CHECK (anchor_state = 'OK'),
            knowledge_point_id TEXT CHECK (knowledge_point_id IS NULL),
            created_at TEXT NOT NULL
        );

        INSERT INTO annotations_v5(
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, created_at
        )
        SELECT
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, created_at
        FROM annotations;

        DROP TABLE annotations;
        ALTER TABLE annotations_v5 RENAME TO annotations;
        CREATE INDEX ix_annotations_revision_page
            ON annotations(book_source_revision_id, pdf_page_index, created_at, id);
        """,
    ),
)


class Database:
    def __init__(self, path: Path):
        self.path = path

    def initialize(self) -> None:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        # Journal mode is a database-level setting. Set it once before worker
        # threads start; repeating this pragma on every connection can itself
        # contend with an active writer and raise "database is locked".
        connection.execute("PRAGMA journal_mode = WAL")
        try:
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
                # executescript does not add a transaction of its own. Keep the
                # schema change and its migration marker atomic, which is
                # especially important once migrations preserve user assets.
                connection.executescript(
                    f"BEGIN IMMEDIATE;\n{sql}\n"
                    f"INSERT INTO schema_migrations(version) VALUES ({int(version)});\nCOMMIT;"
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
