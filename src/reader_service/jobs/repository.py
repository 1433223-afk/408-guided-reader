from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from reader_service.library.database import Database


def now() -> str:
    return datetime.now(UTC).isoformat()


class JobRepository:
    def __init__(self, database: Database):
        self.database = database

    def enqueue_pages(
        self, revision_id: str, page_count: int, foundation_version: int
    ) -> None:
        self.enqueue_page_range(revision_id, 0, page_count, foundation_version)

    def enqueue_page_range(
        self,
        revision_id: str,
        page_start: int,
        page_end: int,
        foundation_version: int,
    ) -> None:
        if page_start < 0 or page_end <= page_start:
            raise ValueError("Page preparation range is invalid")
        timestamp = now()
        with self.database.connect() as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO jobs(
                    id, job_type, book_source_revision_id, page_start, page_end,
                    foundation_version, status, priority, cancel_requested,
                    attempts, created_at, updated_at
                ) VALUES (?, 'PAGE_PREPARE', ?, ?, ?, ?, 'QUEUED', 0, 0, 0, ?, ?)
                """,
                (
                    (
                        str(uuid4()),
                        revision_id,
                        index,
                        index,
                        foundation_version,
                        timestamp,
                        timestamp,
                    )
                    for index in range(page_start, page_end)
                ),
            )

    def prioritize(
        self, revision_id: str, visible_pages: set[int], current_page: int
    ) -> None:
        timestamp = now()
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT id, page_start FROM jobs WHERE book_source_revision_id = ? "
                "AND job_type = 'PAGE_PREPARE' AND status = 'QUEUED'",
                (revision_id,),
            ).fetchall()
            # Close the read cursor before upgrading to a write. A worker may
            # commit meanwhile; a live WAL snapshot cannot then become a writer.
            for row in rows:
                index = row["page_start"]
                if index in visible_pages:
                    priority = 3000 - abs(index - current_page)
                elif abs(index - current_page) <= 4:
                    priority = 2000 - abs(index - current_page)
                else:
                    priority = max(0, 1000 - abs(index - current_page))
                connection.execute(
                    "UPDATE jobs SET priority = ?, updated_at = ? WHERE id = ?",
                    (priority, timestamp, row["id"]),
                )

    def recover(self) -> int:
        timestamp = now()
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = 'QUEUED', updated_at = ?
                WHERE status = 'RUNNING' AND cancel_requested = 0
                """,
                (timestamp,),
            )
            connection.execute(
                "UPDATE jobs SET status = 'CANCELLED', updated_at = ? "
                "WHERE status = 'RUNNING' AND cancel_requested = 1",
                (timestamp,),
            )
            return cursor.rowcount

    def claim(self) -> dict | None:
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT j.id, j.job_type, j.book_source_revision_id,
                       j.page_start, j.page_end, j.foundation_version,
                       j.chapter_outline_node_id, j.chapter_identity_revision,
                       j.chapter_physical_revision
                FROM jobs j
                JOIN book_source_revisions r ON r.id = j.book_source_revision_id
                WHERE j.status = 'QUEUED' AND j.cancel_requested = 0 AND r.status = 'ACTIVE'
                ORDER BY j.priority DESC, j.created_at, j.page_start
                LIMIT 1
                """
            ).fetchone()
            if row is None:
                return None
            cursor = connection.execute(
                """
                UPDATE jobs SET status = 'RUNNING', attempts = attempts + 1, updated_at = ?
                WHERE id = ? AND status = 'QUEUED' AND cancel_requested = 0
                """,
                (timestamp, row["id"]),
            )
            return dict(row) if cursor.rowcount == 1 else None

    def cancellation_requested(self, job_id: str) -> bool:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            return row is None or bool(row[0])

    def complete(self, job_id: str, cancelled: bool = False) -> None:
        with self.database.connect() as connection:
            if not cancelled:
                connection.execute(
                    """
                    UPDATE jobs
                    SET status = CASE
                            WHEN job_type = 'CHAPTER_PREPARE'
                             AND EXISTS (
                                SELECT 1 FROM chapter_preparations AS prep
                                WHERE prep.book_source_revision_id = jobs.book_source_revision_id
                                  AND prep.chapter_outline_node_id = jobs.chapter_outline_node_id
                                  AND (
                                      prep.status = 'PREPARING'
                                      OR (
                                          prep.status = 'READY'
                                          AND prep.regeneration_state = 'RUNNING'
                                      )
                                  )
                             )
                            THEN 'QUEUED'
                            ELSE 'SUCCEEDED'
                        END,
                        updated_at = ?
                    WHERE id = ? AND status = 'RUNNING'
                    """,
                    (now(), job_id),
                )
                return
            connection.execute(
                """
                UPDATE jobs SET status = ?, updated_at = ?
                WHERE id = ? AND status = 'RUNNING'
                """,
                ("CANCELLED", now(), job_id),
            )

    def cancel_revision(self, revision_id: str) -> None:
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE jobs SET cancel_requested = 1,
                    status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE status END,
                    updated_at = ?
                WHERE book_source_revision_id = ? AND status IN ('QUEUED', 'RUNNING')
                """,
                (timestamp, revision_id),
            )

    def cancel_other_revisions(self, revision_id: str) -> None:
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE jobs SET cancel_requested = 1,
                    status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE status END,
                    updated_at = ?
                WHERE status IN ('QUEUED', 'RUNNING')
                  AND book_source_revision_id <> ?
                  AND book_source_revision_id IN (
                      SELECT sibling.id FROM book_source_revisions sibling
                      WHERE sibling.book_id = (
                          SELECT current.book_id FROM book_source_revisions current
                          WHERE current.id = ?
                      )
                  )
                """,
                (timestamp, revision_id, revision_id),
            )

    def cancel_book(self, book_id: str) -> None:
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE jobs SET cancel_requested = 1,
                    status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE status END,
                    updated_at = ?
                WHERE status IN ('QUEUED', 'RUNNING')
                  AND book_source_revision_id IN (
                      SELECT id FROM book_source_revisions WHERE book_id = ?
                  )
                """,
                (timestamp, book_id),
            )

    def requeue_page(self, revision_id: str, page_index: int, foundation_version: int) -> bool:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = 'QUEUED', cancel_requested = 0, updated_at = ?
                WHERE job_type = 'PAGE_PREPARE' AND book_source_revision_id = ?
                  AND page_start = ? AND page_end = ? AND foundation_version = ?
                  AND status IN ('SUCCEEDED', 'CANCELLED')
                """,
                (now(), revision_id, page_index, page_index, foundation_version),
            )
            return cursor.rowcount == 1

    def counts(self, revision_id: str) -> dict[str, int]:
        result = {"QUEUED": 0, "RUNNING": 0, "SUCCEEDED": 0, "CANCELLED": 0}
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT status, COUNT(*) AS count FROM jobs "
                "WHERE book_source_revision_id = ? AND job_type = 'PAGE_PREPARE' "
                "GROUP BY status",
                (revision_id,),
            )
            for row in rows:
                result[row["status"]] = row["count"]
        return result

    def prioritize_range(self, revision_id: str, page_start: int, page_end: int) -> None:
        """Raise only the requested Chapter's prerequisite page jobs above its KP job."""
        if page_end <= page_start:
            raise ValueError("Preparation range must contain at least one page")
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET priority = 5000 - (page_start - ?), updated_at = ?
                WHERE book_source_revision_id = ? AND job_type = 'PAGE_PREPARE'
                  AND status = 'QUEUED' AND page_start >= ? AND page_start < ?
                """,
                (page_start, timestamp, revision_id, page_start, page_end),
            )

    def complete_already_ready_pages(
        self, revision_id: str, page_start: int, page_end: int
    ) -> int:
        """Converge newly replayed page jobs with their authoritative OCRPage state."""
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs SET status = 'SUCCEEDED', updated_at = ?
                WHERE job_type = 'PAGE_PREPARE' AND book_source_revision_id = ?
                  AND status = 'QUEUED' AND page_start >= ? AND page_start < ?
                  AND EXISTS (
                      SELECT 1 FROM ocr_pages AS page
                      WHERE page.book_source_revision_id = jobs.book_source_revision_id
                        AND page.pdf_page_index = jobs.page_start
                        AND page.status = 'READY'
                  )
                """,
                (now(), revision_id, page_start, page_end),
            )
            return cursor.rowcount
