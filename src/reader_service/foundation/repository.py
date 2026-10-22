from __future__ import annotations

import json
from datetime import UTC, datetime

from reader_service.library.database import Database

from .contracts import DetectedLine


def now() -> str:
    return datetime.now(UTC).isoformat()


class FoundationRepository:
    def __init__(self, database: Database):
        self.database = database

    def ensure_pages(self, revision_id: str, page_count: int, foundation_version: int) -> None:
        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT COUNT(*) FROM ocr_pages WHERE book_source_revision_id = ? "
                "AND pdf_page_index < ?",
                (revision_id, page_count),
            ).fetchone()[0]
            if existing == page_count:
                return
            connection.executemany(
                """
                INSERT INTO ocr_pages(
                    book_source_revision_id, pdf_page_index, status, foundation_version
                ) VALUES (?, ?, 'NOT_PREPARED', ?)
                ON CONFLICT(book_source_revision_id, pdf_page_index) DO NOTHING
                """,
                ((revision_id, index, foundation_version) for index in range(page_count)),
            )

    def page_statuses(self, revision_id: str) -> list[dict]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT pdf_page_index, status, route, foundation_version, engine_profile,
                       confidence, prepared_at, failure_code
                FROM ocr_pages WHERE book_source_revision_id = ?
                ORDER BY pdf_page_index
                """,
                (revision_id,),
            )
            return [dict(row) for row in rows]

    def prefix_progress(self, revision_id: str, page_end: int) -> tuple[int, int]:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready
                FROM ocr_pages WHERE book_source_revision_id = ? AND pdf_page_index < ?
                """,
                (revision_id, page_end),
            ).fetchone()
            return int(row["ready"] or 0), int(row["total"])

    def search_snapshot(self, revision_id: str, *, connection=None) -> tuple[dict[str, int], list[dict]]:
        """Read search coverage and READY-page text from one database snapshot."""
        if connection is None:
            with self.database.connect() as connection:
                connection.execute("BEGIN")
                return self.search_snapshot(revision_id, connection=connection)
        counts = {status: 0 for status in ("READY", "NOT_PREPARED", "PREPARING", "FAILED")}
        for row in connection.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM ocr_pages
            WHERE book_source_revision_id = ?
            GROUP BY status
            """,
            (revision_id,),
        ):
            counts[row["status"]] = row["count"]
        rows = connection.execute(
            """
            SELECT lines.pdf_page_index, lines.line_ordinal, lines.text
            FROM ocr_lines AS lines
            JOIN ocr_pages AS pages
              ON pages.book_source_revision_id = lines.book_source_revision_id
             AND pages.pdf_page_index = lines.pdf_page_index
            WHERE lines.book_source_revision_id = ? AND pages.status = 'READY'
            ORDER BY lines.pdf_page_index, lines.line_ordinal
            """,
            (revision_id,),
        )
        return counts, [dict(row) for row in rows]

    def search_page_lines(self, revision_id: str, page_index: int, *, connection=None) -> list[dict]:
        """Read transient cell positions only for one READY page that actually matched."""
        if connection is None:
            with self.database.connect() as connection:
                connection.execute("BEGIN")
                return self.search_page_lines(revision_id, page_index, connection=connection)
        rows = connection.execute(
            """
            SELECT lines.line_ordinal, lines.text, lines.cells_json
            FROM ocr_lines AS lines
            JOIN ocr_pages AS pages
              ON pages.book_source_revision_id = lines.book_source_revision_id
             AND pages.pdf_page_index = lines.pdf_page_index
            WHERE lines.book_source_revision_id = ? AND lines.pdf_page_index = ?
              AND pages.status = 'READY'
            ORDER BY lines.line_ordinal
            """,
            (revision_id, page_index),
        )
        return [
            {
                "line_ordinal": row["line_ordinal"],
                "text": row["text"],
                "cells": json.loads(row["cells_json"]),
            }
            for row in rows
        ]

    def page_status(self, revision_id: str, page_index: int) -> str | None:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT status FROM ocr_pages WHERE book_source_revision_id = ? "
                "AND pdf_page_index = ?",
                (revision_id, page_index),
            ).fetchone()
            return row[0] if row else None

    def empty_ready_ocr_pages(
        self, revision_id: str, page_start: int, page_end: int
    ) -> list[int]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT page.pdf_page_index FROM ocr_pages AS page
                WHERE page.book_source_revision_id = ?
                  AND page.pdf_page_index >= ? AND page.pdf_page_index < ?
                  AND page.status = 'READY' AND page.route = 'OCR'
                  AND NOT EXISTS (
                      SELECT 1 FROM ocr_lines AS line
                      WHERE line.book_source_revision_id = page.book_source_revision_id
                        AND line.pdf_page_index = page.pdf_page_index
                  )
                ORDER BY page.pdf_page_index
                """,
                (revision_id, page_start, page_end),
            ).fetchall()
            return [int(row[0]) for row in rows]

    def reset_empty_ready_ocr_page(self, revision_id: str, page_index: int) -> bool:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE ocr_pages SET status = 'NOT_PREPARED', route = NULL,
                    engine_profile = NULL, confidence = NULL, prepared_at = NULL,
                    failure_code = NULL
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                  AND status = 'READY' AND route = 'OCR'
                  AND NOT EXISTS (
                      SELECT 1 FROM ocr_lines AS line
                      WHERE line.book_source_revision_id = ocr_pages.book_source_revision_id
                        AND line.pdf_page_index = ocr_pages.pdf_page_index
                  )
                """,
                (revision_id, page_index),
            )
            return cursor.rowcount == 1

    def mark_preparing(self, revision_id: str, page_index: int) -> bool:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE ocr_pages
                SET status = 'PREPARING', failure_code = NULL
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                  AND status IN ('NOT_PREPARED', 'FAILED')
                """,
                (revision_id, page_index),
            )
            return cursor.rowcount == 1

    def publish_page(
        self,
        revision_id: str,
        page_index: int,
        *,
        route: str,
        foundation_version: int,
        engine_profile: str,
        lines: list[DetectedLine],
    ) -> None:
        confidence = sum(line.confidence for line in lines) / len(lines) if lines else 0.0
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute(
                "SELECT status FROM ocr_pages WHERE book_source_revision_id = ? "
                "AND pdf_page_index = ?",
                (revision_id, page_index),
            ).fetchone()
            if current is None or current[0] != "PREPARING":
                raise RuntimeError("Page publication requires PREPARING state")
            old = connection.execute(
                "SELECT text,quad_json,cells_json FROM ocr_lines WHERE book_source_revision_id=? AND pdf_page_index=? ORDER BY line_ordinal",
                (revision_id, page_index),
            ).fetchall()
            previous = [(row["text"], json.loads(row["quad_json"]), json.loads(row["cells_json"])) for row in old]
            replacement = [(line.text, json.loads(json.dumps(line.quad)), json.loads(json.dumps(line.cells))) for line in lines]
            if old and previous != replacement:
                revision_version = connection.execute("SELECT foundation_version FROM book_source_revisions WHERE id=?", (revision_id,)).fetchone()[0]
                foundation_version = max(foundation_version, revision_version + 1)
                connection.execute("UPDATE book_source_revisions SET foundation_version=? WHERE id=?", (foundation_version, revision_id))
                geometry_same = [item[1:] for item in previous] == [item[1:] for item in replacement]
                connection.execute("INSERT INTO foundation_events(book_source_revision_id,event_type,page_start,page_end,foundation_version,created_at) VALUES (?,?,?,?,?,?)",
                    (revision_id, "TEXT_CORRECTION" if geometry_same else "REPROCESS", page_index, page_index, foundation_version, timestamp))
            connection.execute(
                "DELETE FROM ocr_lines WHERE book_source_revision_id = ? AND pdf_page_index = ?",
                (revision_id, page_index),
            )
            connection.executemany(
                """
                INSERT INTO ocr_lines(
                    book_source_revision_id, pdf_page_index, line_ordinal,
                    quad_json, text, confidence, cells_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    (
                        revision_id,
                        page_index,
                        ordinal,
                        json.dumps(line.quad, separators=(",", ":")),
                        line.text,
                        line.confidence,
                        json.dumps(line.cells, separators=(",", ":")),
                    )
                    for ordinal, line in enumerate(lines)
                ),
            )
            connection.execute(
                """
                UPDATE ocr_pages SET status = 'READY', route = ?, foundation_version = ?,
                    engine_profile = ?, confidence = ?, prepared_at = ?, failure_code = NULL
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                """,
                (
                    route,
                    foundation_version,
                    engine_profile,
                    confidence,
                    timestamp,
                    revision_id,
                    page_index,
                ),
            )

    def fail_page(self, revision_id: str, page_index: int, code: str) -> None:
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE ocr_pages SET status = 'FAILED', failure_code = ?, prepared_at = NULL
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                """,
                (code, revision_id, page_index),
            )

    def reset_interrupted_pages(self) -> int:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE ocr_pages SET status = 'NOT_PREPARED', failure_code = NULL
                WHERE status = 'PREPARING'
                """
            )
            return cursor.rowcount

    def overlay(self, revision_id: str, page_index: int) -> dict | None:
        with self.database.connect() as connection:
            page = connection.execute(
                """
                SELECT status, route, foundation_version, engine_profile, confidence, prepared_at,
                       failure_code
                FROM ocr_pages WHERE book_source_revision_id = ? AND pdf_page_index = ?
                """,
                (revision_id, page_index),
            ).fetchone()
            if page is None:
                return None
            result = {"pdf_page_index": page_index, **dict(page), "lines": []}
            if page["status"] != "READY":
                return result
            rows = connection.execute(
                """
                SELECT line_ordinal, quad_json, text, confidence, cells_json
                FROM ocr_lines WHERE book_source_revision_id = ? AND pdf_page_index = ?
                ORDER BY line_ordinal
                """,
                (revision_id, page_index),
            )
            result["lines"] = [
                {
                    "line_ordinal": row["line_ordinal"],
                    "quad": json.loads(row["quad_json"]),
                    "text": row["text"],
                    "confidence": row["confidence"],
                    # Anonymous arrays are nested in their line; there is no cell resource or ID.
                    "cells": json.loads(row["cells_json"]),
                }
                for row in rows
            ]
            return result
