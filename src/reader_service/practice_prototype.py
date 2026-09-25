"""Bounded, source-specific Practice state for the Reader 2.0 demo."""

from __future__ import annotations

from reader_service.library.database import Database

SOURCE_SHA256 = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"
ANSWERS = "DABDDACA DCCBCCDD".replace(" ", "")


class PracticePrototype:
    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    def _require_source(connection, revision_id: str) -> None:
        row = connection.execute(
            "SELECT blob_sha256 FROM book_source_revisions WHERE id = ? AND status = 'ACTIVE'",
            (revision_id,),
        ).fetchone()
        if row is None or row["blob_sha256"] != SOURCE_SHA256:
            raise LookupError("这份教材没有可用的 Practice 样本。")

    @staticmethod
    def _number(value: object) -> int:
        if type(value) is not int or not 1 <= value <= len(ANSWERS):
            raise ValueError("题号无效。")
        return value

    @staticmethod
    def _record(row) -> dict:
        return {
            "number": row["question_number"],
            "attempt_count": row["attempt_count"],
            "last_correct": None if row["last_correct"] is None else bool(row["last_correct"]),
            "last_choice": row["last_choice"],
            "ever_correct": bool(row["ever_correct"]),
            "favorite": bool(row["favorite"]),
        }

    def list(self, revision_id: str) -> list[dict]:
        with self.database.connect() as connection:
            self._require_source(connection, revision_id)
            return [self._record(row) for row in connection.execute(
                "SELECT * FROM practice_prototype_state WHERE book_source_revision_id = ? ORDER BY question_number",
                (revision_id,),
            )]

    def list_favorites(self) -> list[dict]:
        """The favorite is the curation decision; no second memory copy is stored."""
        with self.database.connect() as connection:
            rows = connection.execute(
                """SELECT state.*, book.id AS book_id, book.title AS book_title,
                          exercise.title AS exercise_title,
                          section.outline_node_id AS section_id, section.title AS section_title,
                          chapter.title AS chapter_title,
                          review.id AS review_thread_id
                   FROM practice_prototype_state state
                   JOIN book_source_revisions revision
                     ON revision.id = state.book_source_revision_id
                   JOIN books book ON book.id = revision.book_id
                   LEFT JOIN outline_nodes exercise
                     ON exercise.book_source_revision_id = revision.id
                    AND exercise.kind = 'EXERCISES' AND exercise.start_page = 19
                    AND exercise.title LIKE '1.2.6%'
                   LEFT JOIN outline_nodes section
                     ON section.outline_node_id = exercise.parent_id AND section.kind = 'SECTION'
                   LEFT JOIN outline_nodes chapter
                     ON chapter.outline_node_id = section.parent_id AND chapter.kind = 'CHAPTER'
                   LEFT JOIN practice_review_threads review
                     ON review.book_source_revision_id = revision.id
                    AND review.question_number = state.question_number
                   WHERE state.favorite = 1 AND revision.status = 'ACTIVE'
                     AND revision.blob_sha256 = ? AND book.status = 'ACTIVE'
                   ORDER BY state.updated_at DESC, state.question_number""",
                (SOURCE_SHA256,),
            ).fetchall()
            return [{
                "id": f"{row['book_source_revision_id']}-{row['question_number']}",
                "book_source_revision_id": row["book_source_revision_id"],
                "book_id": row["book_id"], "book_title": row["book_title"],
                "source_kind": "PRACTICE", "source_id": row["question_number"],
                "chapter_title": row["chapter_title"],
                "section": ({"id": row["section_id"], "title": row["section_title"]}
                            if row["section_id"] else None),
                "knowledge_point": None,
                "source": {**self._record(row),
                           "exercise_title": row["exercise_title"] or "1.2.6 本节习题精选",
                           "pdf_page_index": 19 if row["question_number"] <= 3 else 20,
                           "has_review_thread": bool(row["review_thread_id"])},
            } for row in rows]

    def attempt(self, revision_id: str, number: object, choice: object) -> dict:
        number = self._number(number)
        if not isinstance(choice, str) or choice not in "ABCD":
            raise ValueError("选项无效。")
        correct = choice == ANSWERS[number - 1]
        with self.database.connect() as connection:
            self._require_source(connection, revision_id)
            connection.execute(
                """INSERT INTO practice_prototype_state
                   (book_source_revision_id, question_number, attempt_count, last_correct, ever_correct, last_choice)
                   VALUES (?, ?, 1, ?, ?, ?)
                   ON CONFLICT(book_source_revision_id, question_number) DO UPDATE SET
                     attempt_count = attempt_count + 1,
                     last_correct = excluded.last_correct,
                     ever_correct = MAX(ever_correct, excluded.ever_correct),
                     last_choice = excluded.last_choice,
                     updated_at = CURRENT_TIMESTAMP""",
                (revision_id, number, int(correct), int(correct), choice),
            )
            row = connection.execute(
                "SELECT * FROM practice_prototype_state WHERE book_source_revision_id = ? AND question_number = ?",
                (revision_id, number),
            ).fetchone()
            return self._record(row)

    def set_favorite(self, revision_id: str, number: object, favorite: object) -> dict:
        number = self._number(number)
        if type(favorite) is not bool:
            raise ValueError("收藏状态无效。")
        with self.database.connect() as connection:
            self._require_source(connection, revision_id)
            connection.execute(
                """INSERT INTO practice_prototype_state
                   (book_source_revision_id, question_number, favorite) VALUES (?, ?, ?)
                   ON CONFLICT(book_source_revision_id, question_number) DO UPDATE SET
                     favorite = excluded.favorite, updated_at = CURRENT_TIMESTAMP""",
                (revision_id, number, int(favorite)),
            )
            row = connection.execute(
                "SELECT * FROM practice_prototype_state WHERE book_source_revision_id = ? AND question_number = ?",
                (revision_id, number),
            ).fetchone()
            return self._record(row)
