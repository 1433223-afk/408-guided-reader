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
                ) VALUES (?, ?, ?, 'TEXT', ?, ?, ?, ?, ?, ?, 'YELLOW', 'USER', NULL, 'OK',
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
                    created_at,
                ),
            )
        return self.get(annotation_id, revision_id)

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

    @staticmethod
    def _row(row) -> dict:
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
            "created_at": row["created_at"],
        }
