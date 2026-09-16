from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from reader_service.library.database import Database


def now() -> str:
    return datetime.now(UTC).isoformat()


class AnnotationRepository:
    def __init__(self, database: Database):
        self.database = database

    def create(
        self,
        *,
        revision_id: str,
        page_index: int,
        quads: list[list[list[float]]],
        quote: str,
        context_before: str,
        context_after: str,
        foundation_version: int,
        body: str | None,
        highlight_style: str,
    ) -> dict:
        annotation_id = str(uuid4())
        created_at = now()
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT INTO annotations(
                    id, book_source_revision_id, pdf_page_index, kind, quads_json,
                    quote, context_before, context_after, foundation_version_at_creation,
                    body, highlight_style, source_kind, verification_state, anchor_state,
                    knowledge_point_id, created_at
                ) VALUES (?, ?, ?, 'TEXT', ?, ?, ?, ?, ?, ?, ?, 'USER', NULL, 'OK',
                          NULL, ?)
                """,
                (
                    annotation_id,
                    revision_id,
                    page_index,
                    json.dumps(quads, separators=(",", ":")),
                    quote,
                    context_before,
                    context_after,
                    foundation_version,
                    body,
                    highlight_style,
                    created_at,
                ),
            )
        return self.get(annotation_id, revision_id)

    def create_ai_saved(
        self,
        *,
        revision_id: str,
        page_index: int,
        quads: list[list[list[float]]],
        quote: str,
        context_before: str,
        context_after: str,
        foundation_version: int,
        ai_content: str,
        save_intent_id: str,
        provenance: dict,
        source_grounding: dict,
    ) -> tuple[dict, bool]:
        annotation_id = str(uuid4())
        created_at = now()
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO annotations(
                    id, book_source_revision_id, pdf_page_index, kind, quads_json,
                    quote, context_before, context_after,
                    foundation_version_at_creation, body, highlight_style,
                    source_kind, verification_state, anchor_state,
                    knowledge_point_id, save_intent_id, provenance_json,
                    source_grounding_json, created_at
                ) VALUES (?, ?, ?, 'TEXT', ?, ?, ?, ?, ?, ?, 'NONE',
                          'AI_SAVED', 'PENDING', 'OK', NULL, ?, ?, ?, ?)
                ON CONFLICT(save_intent_id) DO NOTHING
                """,
                (
                    annotation_id,
                    revision_id,
                    page_index,
                    json.dumps(quads, separators=(",", ":")),
                    quote,
                    context_before,
                    context_after,
                    foundation_version,
                    ai_content,
                    save_intent_id,
                    json.dumps(provenance, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(
                        source_grounding,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    created_at,
                ),
            )
            created = cursor.rowcount == 1
        annotation = self.find_by_save_intent(save_intent_id, revision_id)
        if annotation is None:
            raise ValueError("Save intent already belongs to a different source revision")
        return annotation, created

    def get(self, annotation_id: str, revision_id: str) -> dict:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM annotations
                WHERE id = ? AND book_source_revision_id = ?
                """,
                (annotation_id, revision_id),
            ).fetchone()
            if row is None:
                raise LookupError("Annotation not found")
            return self._row(row)

    def find_by_save_intent(
        self, save_intent_id: str, revision_id: str
    ) -> dict | None:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM annotations
                WHERE save_intent_id = ? AND book_source_revision_id = ?
                """,
                (save_intent_id, revision_id),
            ).fetchone()
            return None if row is None else self._row(row)

    def list_page(self, revision_id: str, page_index: int) -> list[dict]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM annotations
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                ORDER BY created_at, id
                """,
                (revision_id, page_index),
            )
            return [self._row(row) for row in rows]

    def delete(self, annotation_id: str, revision_id: str) -> bool:
        with self.database.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM annotations WHERE id = ? AND book_source_revision_id = ?",
                (annotation_id, revision_id),
            )
            return cursor.rowcount == 1

    def update_verification(
        self,
        annotation_id: str,
        revision_id: str,
        *,
        state: str,
        provider: str | None,
        model: str | None,
        failure_kind: str | None,
        code: str | None,
        summary: str | None,
    ) -> dict | None:
        with self.database.connect(failure_write=state == "TECHNICAL_FAILURE") as connection:
            cursor = connection.execute(
                """
                UPDATE annotations
                SET verification_state = ?, review_provider = ?, review_model = ?,
                    review_failure_kind = ?, review_code = ?, review_summary = ?,
                    reviewed_at = ?
                WHERE id = ? AND book_source_revision_id = ?
                  AND source_kind = 'AI_SAVED'
                  AND verification_state IN ('PENDING', 'TECHNICAL_FAILURE')
                """,
                (
                    state,
                    provider,
                    model,
                    failure_kind,
                    code,
                    summary,
                    now(),
                    annotation_id,
                    revision_id,
                ),
            )
            if cursor.rowcount != 1:
                return None
        return self.get(annotation_id, revision_id)

    def mark_review_pending(self, annotation_id: str, revision_id: str) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE annotations
                SET verification_state = 'PENDING', review_provider = NULL,
                    review_model = NULL, review_failure_kind = NULL,
                    review_code = NULL, review_summary = NULL, reviewed_at = NULL
                WHERE id = ? AND book_source_revision_id = ?
                  AND source_kind = 'AI_SAVED'
                  AND verification_state = 'TECHNICAL_FAILURE'
                """,
                (annotation_id, revision_id),
            )
            if cursor.rowcount != 1:
                raise LookupError("Saved explanation is not retryable")
        return self.get(annotation_id, revision_id)

    def recover_interrupted_reviews(self) -> int:
        with self.database.connect(failure_write=True) as connection:
            cursor = connection.execute(
                """
                UPDATE annotations
                SET verification_state = 'TECHNICAL_FAILURE',
                    review_failure_kind = 'INTERRUPTED',
                    review_code = 'review_interrupted',
                    review_summary = ?, reviewed_at = ?
                WHERE source_kind = 'AI_SAVED'
                  AND verification_state = 'PENDING'
                """,
                (
                    "上次 AI 审查因服务停止而中断；已保存内容不受影响，可重试。",
                    now(),
                ),
            )
            return cursor.rowcount

    @staticmethod
    def _row(row) -> dict:
        keys = set(row.keys())

        def optional(name: str):
            return row[name] if name in keys else None

        provenance = optional("provenance_json")
        source_grounding = optional("source_grounding_json")
        return {
            "id": row["id"],
            "book_source_revision_id": row["book_source_revision_id"],
            "pdf_page_index": row["pdf_page_index"],
            "kind": row["kind"],
            "quads": json.loads(row["quads_json"]),
            "quote": row["quote"],
            "context_before": row["context_before"],
            "context_after": row["context_after"],
            "foundation_version_at_creation": row["foundation_version_at_creation"],
            "body": row["body"],
            "highlight_style": row["highlight_style"],
            "source_kind": row["source_kind"],
            "verification_state": row["verification_state"],
            "anchor_state": row["anchor_state"],
            "knowledge_point_id": row["knowledge_point_id"],
            "save_intent_id": optional("save_intent_id"),
            "provenance": json.loads(provenance) if provenance else None,
            "source_grounding": json.loads(source_grounding) if source_grounding else None,
            "review_provider": optional("review_provider"),
            "review_model": optional("review_model"),
            "review_failure_kind": optional("review_failure_kind"),
            "review_code": optional("review_code"),
            "review_summary": optional("review_summary"),
            "reviewed_at": optional("reviewed_at"),
            "created_at": row["created_at"],
        }
