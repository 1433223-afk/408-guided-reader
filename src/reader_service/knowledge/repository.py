from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from reader_service.library.database import Database


PIPELINE_ATTEMPT_RETENTION = 512


def now() -> str:
    return datetime.now(UTC).isoformat()


class ChapterRegenerationBlocked(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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
                self.database.check_pending_ai(connection)
                attempt_id = str(uuid4())
                connection.execute(
                    """
                    INSERT INTO chapter_preparations(
                        book_source_revision_id, chapter_outline_node_id, status,
                        foundation_version, chapter_identity_revision,
                        chapter_physical_revision, structure_version, attempt_id,
                        requested_at, updated_at, prepare_stage,
                        sections_completed, sections_total,
                        attempt_foundation_version,
                        attempt_chapter_identity_revision,
                        attempt_chapter_physical_revision
                    ) VALUES (?, ?, 'PREPARING', ?, ?, ?, 0, ?, ?, ?, 'QUEUED', 0, 0, ?, ?, ?)
                    ON CONFLICT(book_source_revision_id, chapter_outline_node_id) DO UPDATE SET
                        status = 'PREPARING', foundation_version = excluded.foundation_version,
                        chapter_identity_revision = excluded.chapter_identity_revision,
                        chapter_physical_revision = excluded.chapter_physical_revision,
                        attempt_foundation_version = excluded.attempt_foundation_version,
                        attempt_chapter_identity_revision = excluded.attempt_chapter_identity_revision,
                        attempt_chapter_physical_revision = excluded.attempt_chapter_physical_revision,
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
                        chapter["foundation_version"], chapter["identity_revision"],
                        chapter["physical_revision"],
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

    def request_regenerate(self, revision_id: str, chapter_id: str) -> tuple[dict, bool]:
        """Start or join an explicit dependency-free replacement of one READY map."""
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
                raise ValueError("Knowledge Map regeneration requires one top-level Chapter")

            current = connection.execute(
                """
                SELECT * FROM chapter_preparations
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if current is None or current["status"] != "READY":
                raise ChapterRegenerationBlocked(
                    "CHAPTER_NOT_READY", "只有已经准备完成的章节才能重新生成知识点。"
                )
            if current["regeneration_state"] == "RUNNING":
                return self._snapshot_connection(connection, revision_id, chapter_id), False

            self._assert_regeneration_allowed_connection(
                connection, revision_id, chapter_id, current
            )
            attempt_id = str(uuid4())
            self.database.check_pending_ai(connection)
            cursor = connection.execute(
                """
                UPDATE chapter_preparations
                SET regeneration_state = 'RUNNING', attempt_id = ?,
                    attempt_foundation_version = ?,
                    attempt_chapter_identity_revision = ?,
                    attempt_chapter_physical_revision = ?,
                    regeneration_failure_stage = NULL,
                    regeneration_failure_kind = NULL,
                    regeneration_failure_code = NULL,
                    requested_at = ?, updated_at = ?, prepare_stage = 'QUEUED',
                    sections_completed = 0, sections_total = 0
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND status = 'READY' AND regeneration_state != 'RUNNING'
                """,
                (
                    attempt_id, chapter["foundation_version"],
                    chapter["identity_revision"], chapter["physical_revision"],
                    timestamp, timestamp, revision_id, chapter_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Chapter regeneration lost its state guard")
            self._ensure_job(
                connection,
                revision_id=revision_id,
                chapter_id=chapter_id,
                foundation_version=int(chapter["foundation_version"]),
                identity_revision=int(chapter["identity_revision"]),
                physical_revision=int(chapter["physical_revision"]),
                timestamp=timestamp,
            )
            return self._snapshot_connection(connection, revision_id, chapter_id), True

    def recover_preparing_jobs(self) -> int:
        timestamp = now()
        recovered = 0
        with self.database.connect(failure_write=True) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE chapter_pipeline_attempts
                SET status = 'INTERRUPTED', completed_at = ?,
                    failure_kind = 'INTERRUPTED', failure_code = 'service_restart'
                WHERE status = 'STARTED'
                  AND EXISTS (
                    SELECT 1 FROM chapter_preparations AS prep
                    WHERE prep.book_source_revision_id = chapter_pipeline_attempts.book_source_revision_id
                      AND prep.chapter_outline_node_id = chapter_pipeline_attempts.chapter_outline_node_id
                      AND (
                          prep.status = 'PREPARING'
                          OR (prep.status = 'READY' AND prep.regeneration_state = 'RUNNING')
                      )
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
                   OR (status = 'READY' AND regeneration_state = 'RUNNING')
                """,
                (timestamp,),
            )
            rows = connection.execute(
                """
                SELECT * FROM chapter_preparations
                WHERE status = 'PREPARING'
                   OR (status = 'READY' AND regeneration_state = 'RUNNING')
                """
            ).fetchall()
            for row in rows:
                recovered += self._ensure_job(
                    connection,
                    revision_id=row["book_source_revision_id"],
                    chapter_id=row["chapter_outline_node_id"],
                    foundation_version=int(
                        row["attempt_foundation_version"] or row["foundation_version"]
                    ),
                    identity_revision=int(
                        row["attempt_chapter_identity_revision"]
                        or row["chapter_identity_revision"]
                    ),
                    physical_revision=int(
                        row["attempt_chapter_physical_revision"]
                        or row["chapter_physical_revision"]
                    ),
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
                SET attempt_foundation_version = ?,
                    attempt_chapter_identity_revision = ?,
                    attempt_chapter_physical_revision = ?, updated_at = ?
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND attempt_id = ?
                  AND (
                      status = 'PREPARING'
                      OR (status = 'READY' AND regeneration_state = 'RUNNING')
                  )
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
                  AND attempt_id = ?
                  AND (
                      status = 'PREPARING'
                      OR (status = 'READY' AND regeneration_state = 'RUNNING')
                  )
                """,
                (
                    stage, sections_completed, sections_total, now(),
                    revision_id, chapter_id, attempt_id,
                ),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("Chapter preparation attempt is no longer current")

    def record_pipeline_attempt(
        self,
        revision_id: str,
        chapter_id: str,
        preparation_attempt_id: str,
        *,
        section_id: str | None,
        packet_or_stage_id: str,
        semantic_round: int,
        structured_attempt: int,
        provider_role: str,
        pipeline_stage: str,
        event: dict,
    ) -> None:
        status = event.get("status")
        if status not in {"STARTED", "SUCCEEDED", "FAILED", "INTERRUPTED"}:
            raise ValueError("Invalid generation attempt status")
        transport_attempt = event.get("transport_attempt")
        if isinstance(transport_attempt, bool) or not isinstance(transport_attempt, int) \
                or transport_attempt < 1:
            raise ValueError("Invalid transport attempt")
        if isinstance(semantic_round, bool) or not isinstance(semantic_round, int) \
                or semantic_round < 0:
            raise ValueError("Invalid semantic round")
        if provider_role not in {"KP_GENERATOR", "KP_STRUCTURAL_REVIEWER"}:
            raise ValueError("Invalid pipeline provider role")
        if pipeline_stage not in {"SEMANTIC_CLASSIFICATION", "STRUCTURAL_REVIEW"}:
            raise ValueError("Invalid pipeline stage")
        timestamp = now()
        completed_at = None if status == "STARTED" else timestamp
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO chapter_pipeline_attempts(
                    id, book_source_revision_id, chapter_outline_node_id,
                    preparation_attempt_id, primary_section_id,
                    packet_or_stage_id, semantic_round,
                    structured_attempt, transport_attempt, interaction_id,
                    provider, model, provider_role, pipeline_stage,
                    status, started_at, completed_at,
                    latency_ms, finish_reason, prompt_tokens, completion_tokens,
                    total_tokens, content_present, content_length,
                    reasoning_present, reasoning_length, failure_kind, failure_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(
                    book_source_revision_id, chapter_outline_node_id,
                    preparation_attempt_id, pipeline_stage, packet_or_stage_id,
                    semantic_round, structured_attempt, transport_attempt
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
                    section_id, self._bounded(packet_or_stage_id, 160),
                    semantic_round, structured_attempt, transport_attempt,
                    self._bounded(event.get("interaction_id"), 300),
                    self._bounded(event.get("provider"), 40),
                    self._bounded(event.get("model"), 120),
                    provider_role, pipeline_stage, status, timestamp, completed_at,
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
                DELETE FROM chapter_pipeline_attempts
                WHERE id IN (
                    SELECT id FROM chapter_pipeline_attempts
                    WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                    ORDER BY started_at DESC, id DESC
                    LIMIT -1 OFFSET ?
                )
                """,
                (revision_id, chapter_id, PIPELINE_ATTEMPT_RETENTION),
            )

    def pipeline_attempts(self, revision_id: str, chapter_id: str) -> list[dict]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM chapter_pipeline_attempts
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                ORDER BY started_at, semantic_round, structured_attempt,
                         transport_attempt, id
                """,
                (revision_id, chapter_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def record_structured_validation_failure(
        self,
        revision_id: str,
        chapter_id: str,
        preparation_attempt_id: str,
        *,
        packet_or_stage_id: str,
        semantic_round: int,
        structured_attempt: int,
        pipeline_stage: str,
        failure_code: str,
    ) -> None:
        """Mark the successful transport whose body failed safe schema validation."""
        if pipeline_stage not in {"SEMANTIC_CLASSIFICATION", "STRUCTURAL_REVIEW"}:
            raise ValueError("Invalid pipeline stage")
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE chapter_pipeline_attempts
                SET status = 'FAILED',
                    failure_kind = 'INVALID_STRUCTURED_OUTPUT',
                    failure_code = ?
                WHERE book_source_revision_id = ?
                  AND chapter_outline_node_id = ?
                  AND preparation_attempt_id = ?
                  AND pipeline_stage = ?
                  AND packet_or_stage_id = ?
                  AND semantic_round = ?
                  AND structured_attempt = ?
                  AND status = 'SUCCEEDED'
                """,
                (
                    self._bounded(failure_code, 120), revision_id, chapter_id,
                    preparation_attempt_id, pipeline_stage, packet_or_stage_id,
                    semantic_round, structured_attempt,
                ),
            )

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
        with self.database.connect(failure_write=True) as connection:
            connection.execute("BEGIN IMMEDIATE")
            state = connection.execute(
                """
                SELECT status, regeneration_state FROM chapter_preparations
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND attempt_id = ?
                """,
                (revision_id, chapter_id, attempt_id),
            ).fetchone()
            if state is None:
                return False
            if state["status"] == "READY" and state["regeneration_state"] == "RUNNING":
                cursor = connection.execute(
                    """
                    UPDATE chapter_preparations
                    SET regeneration_state = 'FAILED',
                        regeneration_failure_stage = ?,
                        regeneration_failure_kind = ?,
                        regeneration_failure_code = ?, updated_at = ?
                    WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                      AND status = 'READY' AND regeneration_state = 'RUNNING'
                      AND attempt_id = ?
                    """,
                    (stage, kind, code, now(), revision_id, chapter_id, attempt_id),
                )
                return cursor.rowcount == 1
            if state["status"] != "PREPARING":
                return False
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

    def lock_for_learning_state(self, connection, knowledge_point_id: str) -> None:
        """Permanently lock a Chapter inside the caller's learning-write transaction."""
        timestamp = now()
        point = connection.execute(
            """
            SELECT book_source_revision_id, chapter_outline_node_id
            FROM knowledge_points WHERE knowledge_point_id = ?
            """,
            (knowledge_point_id,),
        ).fetchone()
        if point is None:
            raise LookupError("KnowledgePoint not found")
        cursor = connection.execute(
            """
            UPDATE chapter_preparations
            SET learning_state_ever_at = COALESCE(learning_state_ever_at, ?), updated_at = ?
            WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
              AND status = 'READY'
            """,
            (
                timestamp, timestamp, point["book_source_revision_id"],
                point["chapter_outline_node_id"],
            ),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("Learning state requires a READY Chapter Knowledge Map")

    @staticmethod
    def _has_kp_linked_user_asset_connection(connection, revision_id: str, chapter_id: str) -> bool:
        """Find current durable KP references without making content an identity authority."""
        tables = connection.execute(
            """
            SELECT name FROM sqlite_schema
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
        for row in tables:
            table = row["name"]
            if table == "knowledge_points" or not table.replace("_", "").isalnum():
                continue
            quoted = '"' + table.replace('"', '""') + '"'
            columns = connection.execute(f"PRAGMA table_info({quoted})").fetchall()
            if not any(column["name"] == "knowledge_point_id" for column in columns):
                continue
            found = connection.execute(
                f"""
                SELECT 1 FROM {quoted} AS asset
                JOIN knowledge_points AS kp
                  ON kp.knowledge_point_id = asset.knowledge_point_id
                JOIN chapter_preparations AS prep
                  ON prep.book_source_revision_id = kp.book_source_revision_id
                 AND prep.chapter_outline_node_id = kp.chapter_outline_node_id
                 AND prep.structure_version = kp.chapter_structure_version
                WHERE kp.book_source_revision_id = ?
                  AND kp.chapter_outline_node_id = ?
                LIMIT 1
                """,
                (revision_id, chapter_id),
            ).fetchone()
            if found is not None:
                return True
        return False

    @classmethod
    def _assert_regeneration_allowed_connection(
        cls, connection, revision_id: str, chapter_id: str, state=None
    ) -> None:
        if state is None:
            state = connection.execute(
                """
                SELECT * FROM chapter_preparations
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                """,
                (revision_id, chapter_id),
            ).fetchone()
        if state is None or state["status"] != "READY":
            raise ChapterRegenerationBlocked(
                "CHAPTER_NOT_READY", "只有已经准备完成的章节才能重新生成知识点。"
            )
        if state["learning_state_ever_at"] is not None:
            raise ChapterRegenerationBlocked(
                "CHAPTER_PERMANENTLY_LOCKED",
                "本章知识点已经产生学习状态，整章学习地图已永久冻结。",
            )
        if cls._has_kp_linked_user_asset_connection(connection, revision_id, chapter_id):
            raise ChapterRegenerationBlocked(
                "CHAPTER_HAS_USER_ASSETS",
                "本章已有用户内容关联旧知识点，不能重新生成。",
            )

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
            replacement = bool(
                state is not None
                and state["status"] == "READY"
                and state["regeneration_state"] == "RUNNING"
            )
            first_publication = bool(state is not None and state["status"] == "PREPARING")
            if not (replacement or first_publication) or state["attempt_id"] != attempt_id:
                raise RuntimeError("Chapter publication requires the current PREPARING attempt")
            if (
                int(state["attempt_foundation_version"] or -1),
                int(state["attempt_chapter_identity_revision"] or -1),
                int(state["attempt_chapter_physical_revision"] or -1),
            ) != (foundation_version, identity_revision, physical_revision):
                raise RuntimeError("Chapter preparation dependency snapshot changed before publication")
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

            if replacement:
                self._assert_regeneration_allowed_connection(
                    connection, revision_id, chapter_id, state
                )

            prior_ids = [
                row[0] for row in connection.execute(
                    """
                    SELECT knowledge_point_id FROM knowledge_points
                    WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                    """,
                    (revision_id, chapter_id),
                )
            ]
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
                    updated_at = ?, published_at = ?, prepare_stage = NULL,
                    regeneration_state = 'IDLE',
                    regeneration_failure_stage = NULL,
                    regeneration_failure_kind = NULL,
                    regeneration_failure_code = NULL
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ?
                  AND attempt_id = ?
                  AND (
                      status = 'PREPARING'
                      OR (status = 'READY' AND regeneration_state = 'RUNNING')
                  )
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

    @classmethod
    def _snapshot_connection(cls, connection, revision_id: str, chapter_id: str) -> dict:
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
                "regeneration_state": "IDLE",
                "regeneration_allowed": False,
                "regeneration_block_code": "CHAPTER_NOT_READY",
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
        result["regeneration_allowed"] = False
        result["regeneration_block_code"] = "CHAPTER_NOT_READY"
        if result["status"] == "READY":
            if result["regeneration_state"] == "RUNNING":
                result["regeneration_block_code"] = "REGENERATION_RUNNING"
            else:
                try:
                    cls._assert_regeneration_allowed_connection(
                        connection, revision_id, chapter_id, result
                    )
                except ChapterRegenerationBlocked as blocked:
                    result["regeneration_block_code"] = blocked.code
                else:
                    result["regeneration_allowed"] = True
                    result["regeneration_block_code"] = None
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
