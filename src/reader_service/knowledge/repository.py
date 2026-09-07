from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from reader_service.library.database import Database


GENERATION_ATTEMPT_RETENTION = 512


def now() -> str:
    return datetime.now(UTC).isoformat()


class KnowledgeRepository:
    def __init__(self, database: Database):
        self.database = database

    def request_prepare(self, revision_id: str, chapter_id: str) -> tuple[dict, bool]:
        """Persist PREPARING and its durable job atomically; duplicate requests join."""
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            chapter = connection.execute(
                """
                SELECT node.outline_node_id, node.kind, node.parent_id,
                       node.identity_revision, node.physical_revision,
                       revision.foundation_version
                FROM outline_nodes AS node
                JOIN book_source_revisions AS revision
                  ON revision.id = node.book_source_revision_id
                WHERE node.book_source_revision_id = ? AND node.outline_node_id = ?
                  AND revision.status = 'ACTIVE'
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if chapter is None:
                raise LookupError("Chapter not found")
            if chapter["kind"] != "CHAPTER" or chapter["parent_id"] is not None:
                raise ValueError("Knowledge Map preparation requires one top-level Chapter")

            current = connection.execute(
                """
                SELECT * FROM chapter_preparations
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if current is not None and current["status"] == "READY":
                return self._snapshot_connection(connection, revision_id, chapter_id), False

            created = current is None
            if current is None or current["status"] == "FAILED":
                attempt_id = str(uuid4())
                connection.execute(
                    """
                    INSERT INTO chapter_preparations(
                        book_source_revision_id, chapter_outline_node_id, status,
                        foundation_version, chapter_identity_revision,
                        chapter_physical_revision, structure_version, attempt_id,
                        requested_at, updated_at, prepare_stage,
                        sections_completed, sections_total
                    ) VALUES (?, ?, 'PREPARING', ?, ?, ?, 0, ?, ?, ?, 'QUEUED', 0, 0)
                    ON CONFLICT(book_source_revision_id, chapter_outline_node_id) DO UPDATE SET
                        status = 'PREPARING', foundation_version = excluded.foundation_version,
                        chapter_identity_revision = excluded.chapter_identity_revision,
                        chapter_physical_revision = excluded.chapter_physical_revision,
                        attempt_id = excluded.attempt_id,
                        generator_provider = NULL, generator_model = NULL,
                        reviewer_provider = NULL, reviewer_model = NULL,
                        review_summary = NULL, failure_stage = NULL,
                        failure_kind = NULL, failure_code = NULL,
                        source_payload_sha256 = NULL, review_payload_sha256 = NULL,
                        requested_at = excluded.requested_at, updated_at = excluded.updated_at,
                        published_at = NULL, prepare_stage = 'QUEUED',
                        sections_completed = 0, sections_total = 0
                    """,
                    (
                        revision_id, chapter_id, chapter["foundation_version"],
                        chapter["identity_revision"], chapter["physical_revision"],
                        attempt_id, timestamp, timestamp,
                    ),
                )
            else:
                attempt_id = current["attempt_id"]

            self._ensure_job(
                connection,
                revision_id=revision_id,
                chapter_id=chapter_id,
                foundation_version=int(chapter["foundation_version"]),
                identity_revision=int(chapter["identity_revision"]),
                physical_revision=int(chapter["physical_revision"]),
                timestamp=timestamp,
            )
            return self._snapshot_connection(connection, revision_id, chapter_id), created

    def recover_preparing_jobs(self) -> int:
        timestamp = now()
        recovered = 0
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE chapter_generation_attempts
                SET status = 'INTERRUPTED', completed_at = ?,
                    failure_kind = 'INTERRUPTED', failure_code = 'service_restart'
                WHERE status = 'STARTED'
                  AND EXISTS (
                    SELECT 1 FROM chapter_preparations AS prep
                    WHERE prep.book_source_revision_id = chapter_generation_attempts.book_source_revision_id
                      AND prep.chapter_outline_node_id = chapter_generation_attempts.chapter_outline_node_id
                      AND prep.status = 'PREPARING'
                  )
                """,
                (timestamp,),
            )
            connection.execute(
                """
                UPDATE chapter_preparations
                SET prepare_stage = 'QUEUED', sections_completed = 0,
                    sections_total = 0, updated_at = ?
                WHERE status = 'PREPARING'
                """,
                (timestamp,),
            )
            rows = connection.execute(
                "SELECT * FROM chapter_preparations WHERE status = 'PREPARING'"
            ).fetchall()
            for row in rows:
                recovered += self._ensure_job(
                    connection,
                    revision_id=row["book_source_revision_id"],
                    chapter_id=row["chapter_outline_node_id"],
                    foundation_version=int(row["foundation_version"]),
                    identity_revision=int(row["chapter_identity_revision"]),
                    physical_revision=int(row["chapter_physical_revision"]),
                    timestamp=timestamp,
                )
        return recovered

    @staticmethod
    def _ensure_job(
        connection,
        *,
        revision_id: str,
        chapter_id: str,
        foundation_version: int,
        identity_revision: int,
        physical_revision: int,
        timestamp: str,
    ) -> int:
        job_id = str(uuid4())
        cursor = connection.execute(
            """
            INSERT OR IGNORE INTO jobs(
                id, job_type, book_source_revision_id, page_start, page_end,
                foundation_version, chapter_outline_node_id,
                chapter_identity_revision, chapter_physical_revision,
                status, priority, cancel_requested, attempts, created_at, updated_at
            ) VALUES (?, 'CHAPTER_PREPARE', ?, NULL, NULL, ?, ?, ?, ?,
                      'QUEUED', 3500, 0, 0, ?, ?)
            """,
            (
                job_id, revision_id, foundation_version, chapter_id,
                identity_revision, physical_revision, timestamp, timestamp,
            ),
        )
        if cursor.rowcount == 1:
            return 1
        cursor = connection.execute(
            """
            UPDATE jobs
            SET status = 'QUEUED', cancel_requested = 0, priority = 3500,
                updated_at = ?
            WHERE job_type = 'CHAPTER_PREPARE'
              AND book_source_revision_id = ? AND chapter_outline_node_id = ?
              AND foundation_version = ? AND chapter_identity_revision = ?
              AND chapter_physical_revision = ?
              AND status IN ('SUCCEEDED', 'CANCELLED')
            """,
            (
                timestamp, revision_id, chapter_id, foundation_version,
                identity_revision, physical_revision,
            ),
        )
        return cursor.rowcount

    def update_dependencies(
        self,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        foundation_version: int,
        identity_revision: int,
        physical_revision: int,
    ) -> None:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE chapter_preparations
                SET foundation_version = ?, chapter_identity_revision = ?,
                    chapter_physical_revision = ?, updated_at = ?
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND status = 'PREPARING' AND attempt_id = ?
                """,
                (
                    foundation_version, identity_revision, physical_revision, now(),
                    revision_id, chapter_id, attempt_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Chapter preparation attempt is no longer current")

    def update_progress(
        self,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        stage: str,
        sections_completed: int,
        sections_total: int,
    ) -> None:
        allowed = {
            "QUEUED", "RESOLVING_SOURCE", "GENERATING", "REVIEWING",
            "VALIDATING", "PUBLISHING",
        }
        if stage not in allowed:
            raise ValueError("Unknown Chapter preparation stage")
        if not 0 <= sections_completed <= sections_total:
            raise ValueError("Invalid Chapter Section progress")
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE chapter_preparations
                SET prepare_stage = ?, sections_completed = ?, sections_total = ?,
                    updated_at = ?
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND status = 'PREPARING' AND attempt_id = ?
                """,
                (
                    stage, sections_completed, sections_total, now(),
                    revision_id, chapter_id, attempt_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Chapter preparation attempt is no longer current")

    def record_generation_attempt(
        self,
        revision_id: str,
        chapter_id: str,
        preparation_attempt_id: str,
        section_id: str,
        structured_attempt: int,
        event: dict,
    ) -> None:
        status = event.get("status")
        if status not in {"STARTED", "SUCCEEDED", "FAILED", "INTERRUPTED"}:
            raise ValueError("Invalid generation attempt status")
        transport_attempt = event.get("transport_attempt")
        if isinstance(transport_attempt, bool) or not isinstance(transport_attempt, int) \
                or transport_attempt < 1:
            raise ValueError("Invalid transport attempt")
        timestamp = now()
        completed_at = None if status == "STARTED" else timestamp
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO chapter_generation_attempts(
                    id, book_source_revision_id, chapter_outline_node_id,
                    preparation_attempt_id, primary_section_id,
                    structured_attempt, transport_attempt, interaction_id,
                    provider, model, provider_role, pipeline_stage,
                    status, started_at, completed_at,
                    latency_ms, finish_reason, prompt_tokens, completion_tokens,
                    total_tokens, content_present, content_length,
                    reasoning_present, reasoning_length, failure_kind, failure_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(
                    book_source_revision_id, chapter_outline_node_id,
                    preparation_attempt_id, primary_section_id,
                    structured_attempt, transport_attempt
                ) DO UPDATE SET
                    status = excluded.status,
                    completed_at = excluded.completed_at,
                    latency_ms = excluded.latency_ms,
                    finish_reason = excluded.finish_reason,
                    prompt_tokens = excluded.prompt_tokens,
                    completion_tokens = excluded.completion_tokens,
                    total_tokens = excluded.total_tokens,
                    content_present = excluded.content_present,
                    content_length = excluded.content_length,
                    reasoning_present = excluded.reasoning_present,
                    reasoning_length = excluded.reasoning_length,
                    failure_kind = excluded.failure_kind,
                    failure_code = excluded.failure_code
                """,
                (
                    str(uuid4()), revision_id, chapter_id,
                    self._bounded(preparation_attempt_id, 120),
                    section_id, structured_attempt, transport_attempt,
                    self._bounded(event.get("interaction_id"), 300),
                    self._bounded(event.get("provider"), 40),
                    self._bounded(event.get("model"), 120),
                    "KP_GENERATOR", "GENERATION", status, timestamp, completed_at,
                    self._nonnegative_int(event.get("latency_ms")),
                    self._optional_bounded(event.get("finish_reason"), 120),
                    self._nonnegative_int(usage.get("prompt_tokens")),
                    self._nonnegative_int(usage.get("completion_tokens")),
                    self._nonnegative_int(usage.get("total_tokens")),
                    self._optional_bool(event.get("content_present")),
                    self._nonnegative_int(event.get("content_length")),
                    self._optional_bool(event.get("reasoning_present")),
                    self._nonnegative_int(event.get("reasoning_length")),
                    self._optional_bounded(event.get("failure_kind"), 80),
                    self._optional_bounded(event.get("failure_code"), 120),
                ),
            )
            connection.execute(
                """
                DELETE FROM chapter_generation_attempts
                WHERE id IN (
                    SELECT id FROM chapter_generation_attempts
                    WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                    ORDER BY started_at DESC, id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (revision_id, chapter_id, GENERATION_ATTEMPT_RETENTION),
            )

    def generation_attempts(self, revision_id: str, chapter_id: str) -> list[dict]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM chapter_generation_attempts
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                ORDER BY started_at, structured_attempt, transport_attempt, id
                """,
                (revision_id, chapter_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def fail(
        self,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        stage: str,
        kind: str,
        code: str,
        generator_provider: str | None = None,
        generator_model: str | None = None,
        reviewer_provider: str | None = None,
        reviewer_model: str | None = None,
        review_summary: str | None = None,
        source_payload_sha256: str | None = None,
        review_payload_sha256: str | None = None,
    ) -> bool:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE chapter_preparations
                SET status = 'FAILED', generator_provider = ?, generator_model = ?,
                    reviewer_provider = ?, reviewer_model = ?, review_summary = ?,
                    failure_stage = ?, failure_kind = ?, failure_code = ?,
                    source_payload_sha256 = ?, review_payload_sha256 = ?,
                    updated_at = ?
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND status = 'PREPARING' AND attempt_id = ?
                """,
                (
                    generator_provider, generator_model, reviewer_provider, reviewer_model,
                    review_summary, stage, kind, code, source_payload_sha256,
                    review_payload_sha256, now(), revision_id, chapter_id, attempt_id,
                ),
            )
            return cursor.rowcount == 1

    def publish(
        self,
        revision_id: str,
        chapter_id: str,
        attempt_id: str,
        *,
        foundation_version: int,
        identity_revision: int,
        physical_revision: int,
        points: list[dict],
        generator_provider: str,
        generator_model: str,
        reviewer_provider: str,
        reviewer_model: str,
        review_summary: str,
        source_payload_sha256: str,
        review_payload_sha256: str,
    ) -> dict:
        timestamp = now()
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                """
                SELECT * FROM chapter_preparations
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if state is None or state["status"] != "PREPARING" or state["attempt_id"] != attempt_id:
                raise RuntimeError("Chapter publication requires the current PREPARING attempt")
            chapter = connection.execute(
                """
                SELECT identity_revision, physical_revision FROM outline_nodes
                WHERE book_source_revision_id = ? AND outline_node_id = ? AND kind = 'CHAPTER'
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if chapter is None or (
                int(chapter["identity_revision"]), int(chapter["physical_revision"])
            ) != (identity_revision, physical_revision):
                raise RuntimeError("Chapter Outline dependency changed before publication")

            prior_ids = [
                row[0] for row in connection.execute(
                    """
                    SELECT knowledge_point_id FROM knowledge_points
                    WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                    """,
                    (revision_id, chapter_id),
                )
            ]
            if prior_ids:
                placeholders = ",".join("?" for _ in prior_ids)
                locked = connection.execute(
                    f"SELECT 1 FROM annotations WHERE knowledge_point_id IN ({placeholders}) LIMIT 1",
                    prior_ids,
                ).fetchone()
                if locked is not None:
                    raise RuntimeError("Chapter structure is locked by a durable user asset")

            version = int(state["structure_version"]) + 1
            rows = []
            for order_index, point in enumerate(points):
                rows.append(
                    (
                        str(uuid4()), revision_id, chapter_id, version,
                        point["primary_section_id"], point["title"],
                        point["one_sentence_definition"], order_index,
                        point["start_page"], point["start_y"],
                        point["end_page"], point["end_y"],
                        foundation_version, timestamp,
                    )
                )
            connection.executemany(
                """
                INSERT INTO knowledge_points(
                    knowledge_point_id, book_source_revision_id,
                    chapter_outline_node_id, chapter_structure_version,
                    primary_section_id, title, one_sentence_definition,
                    order_index, start_page, start_y, end_page, end_y,
                    source_foundation_version, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            connection.execute(
                """
                DELETE FROM knowledge_points
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND chapter_structure_version < ?
                """,
                (revision_id, chapter_id, version),
            )
            cursor = connection.execute(
                """
                UPDATE chapter_preparations
                SET status = 'READY', foundation_version = ?,
                    chapter_identity_revision = ?, chapter_physical_revision = ?,
                    structure_version = ?, generator_provider = ?, generator_model = ?,
                    reviewer_provider = ?, reviewer_model = ?, review_summary = ?,
                    failure_stage = NULL, failure_kind = NULL, failure_code = NULL,
                    source_payload_sha256 = ?, review_payload_sha256 = ?,
                    updated_at = ?, published_at = ?, prepare_stage = NULL
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND status = 'PREPARING' AND attempt_id = ?
                """,
                (
                    foundation_version, identity_revision, physical_revision, version,
                    generator_provider, generator_model, reviewer_provider, reviewer_model,
                    review_summary, source_payload_sha256, review_payload_sha256,
                    timestamp, timestamp, revision_id, chapter_id, attempt_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Chapter publication lost its state guard")
            result = self._snapshot_connection(connection, revision_id, chapter_id)
        return result

    def snapshot(self, revision_id: str, chapter_id: str) -> dict:
        with self.database.connect() as connection:
            chapter = connection.execute(
                """
                SELECT title, kind, parent_id FROM outline_nodes
                WHERE book_source_revision_id = ? AND outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if chapter is None:
                raise LookupError("Chapter not found")
            if chapter["kind"] != "CHAPTER" or chapter["parent_id"] is not None:
                raise ValueError("Knowledge Map requires one top-level Chapter")
            return self._snapshot_connection(connection, revision_id, chapter_id)

    @staticmethod
    def _snapshot_connection(connection, revision_id: str, chapter_id: str) -> dict:
        state = connection.execute(
            """
            SELECT prep.*, chapter.title AS chapter_title
            FROM chapter_preparations AS prep
            JOIN outline_nodes AS chapter
              ON chapter.book_source_revision_id = prep.book_source_revision_id
             AND chapter.outline_node_id = prep.chapter_outline_node_id
            WHERE prep.book_source_revision_id = ? AND prep.chapter_outline_node_id = ?
            """,
            (revision_id, chapter_id),
        ).fetchone()
        if state is None:
            chapter = connection.execute(
                """
                SELECT title FROM outline_nodes
                WHERE book_source_revision_id = ? AND outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
            return {
                "book_source_revision_id": revision_id,
                "chapter_outline_node_id": chapter_id,
                "chapter_title": chapter["title"] if chapter else None,
                "status": "NOT_PREPARED",
                "structure_version": 0,
                "prepare_stage": None,
                "sections_completed": 0,
                "sections_total": 0,
                "knowledge_points": [],
            }
        result = dict(state)
        points = []
        if result["status"] == "READY":
            for row in connection.execute(
                """
                SELECT kp.*, section.title AS primary_section_title,
                       section.order_index AS primary_section_order
                FROM knowledge_points AS kp
                JOIN outline_nodes AS section
                  ON section.book_source_revision_id = kp.book_source_revision_id
                 AND section.outline_node_id = kp.primary_section_id
                WHERE kp.book_source_revision_id = ?
                  AND kp.chapter_outline_node_id = ?
                  AND kp.chapter_structure_version = ?
                ORDER BY section.order_index, kp.order_index
                """,
                (revision_id, chapter_id, result["structure_version"]),
            ):
                points.append(dict(row))
        result["knowledge_points"] = points
        return result

    @staticmethod
    def _bounded(value: object, limit: int) -> str:
        text = str(value or "")[:limit]
        if not text:
            raise ValueError("Required diagnostic field is empty")
        return text

    @staticmethod
    def _optional_bounded(value: object, limit: int) -> str | None:
        if not isinstance(value, str) or not value:
            return None
        return value[:limit]

    @staticmethod
    def _nonnegative_int(value: object) -> int | None:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
        return value

    @staticmethod
    def _optional_bool(value: object) -> int | None:
        return int(value) if isinstance(value, bool) else None
