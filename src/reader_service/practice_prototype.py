"""Bounded, source-specific Practice state for the Reader 2.0 demo."""

from __future__ import annotations

from reader_service.library.database import Database
from reader_service.practice_catalog import build_catalog, public_sections

SOURCE_SHA256 = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"
ANSWERS = "DABDDACA DCCBCCDD".replace(" ", "")
SECTION_524_ANSWERS = {
    101: "A", 102: "D", 103: "C", 104: "B", 105: "D", 106: "B", 107: "B",
    108: "B", 109: "A", 110: "C", 111: "C", 112: "A", 113: "A", 114: "C", 115: "C",
}


def printed_number(number: int) -> int:
    return number - 100 if number in SECTION_524_ANSWERS else number


def official_answer(number: int) -> str:
    return SECTION_524_ANSWERS[number] if number in SECTION_524_ANSWERS else ANSWERS[number - 1]


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
        if type(value) is not int or not 1 <= value <= 9007199254740991:
            raise ValueError("题号无效。")
        return value

    def catalog(self, revision_id: str) -> list[dict]:
        with self.database.connect() as connection:
            self._require_source(connection, revision_id)
            return build_catalog(connection, revision_id, SOURCE_SHA256)

    def public_catalog(self, revision_id: str) -> list[dict]:
        return public_sections(self.catalog(revision_id))

    def question(self, revision_id: str, number: object) -> dict | None:
        number = self._number(number)
        for section in self.catalog(revision_id):
            for question in section["questions"]:
                if question["number"] == number:
                    return question
        # The two existing, visually verified fixtures remain usable while
        # their OCR/Outline is unavailable; no new question uses this path.
        if 1 <= number <= len(ANSWERS) or number in SECTION_524_ANSWERS:
            return None
        raise ValueError("这道题尚未通过来源核对，不能作答。")

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
                          review.id AS review_thread_id
                   FROM practice_prototype_state state
                   JOIN book_source_revisions revision
                     ON revision.id = state.book_source_revision_id
                   JOIN books book ON book.id = revision.book_id
                   LEFT JOIN practice_review_threads review
                     ON review.book_source_revision_id = revision.id
                    AND review.question_number = state.question_number
                   WHERE state.favorite = 1 AND revision.status = 'ACTIVE'
                     AND revision.blob_sha256 = ? AND book.status = 'ACTIVE'
                   ORDER BY state.updated_at DESC, state.question_number""",
                (SOURCE_SHA256,),
            ).fetchall()
            outlines = {(row["book_source_revision_id"], row["outline_node_id"]): dict(row)
                        for row in connection.execute(
                            "SELECT book_source_revision_id,outline_node_id,parent_id,kind,title FROM outline_nodes")}
        catalog_by_revision = {}
        items = []
        for row in rows:
            revision_id = row["book_source_revision_id"]
            if revision_id not in catalog_by_revision:
                catalog_by_revision[revision_id] = {
                    question["number"]: question for section in self.catalog(revision_id)
                    for question in section["questions"]}
            question = catalog_by_revision[revision_id].get(row["question_number"])
            number = row["question_number"]
            if question:
                exercise = outlines.get((revision_id, question["sectionId"]))
                section = outlines.get((revision_id, exercise["parent_id"])) if exercise else None
                chapter = outlines.get((revision_id, section["parent_id"])) if section else None
                label, page, exercise_title = question["label"], question["page"], question["sectionTitle"]
            else:
                section = chapter = None
                label = printed_number(number)
                page = (227 if number <= 109 else 228) if number >= 100 else (19 if number <= 3 else 20)
                exercise_title = "5.2.4 本节习题精选" if number >= 100 else "1.2.6 本节习题精选"
            items.append({
                "id": f"{row['book_source_revision_id']}-{row['question_number']}",
                "book_source_revision_id": row["book_source_revision_id"],
                "book_id": row["book_id"], "book_title": row["book_title"],
                "source_kind": "PRACTICE", "source_id": row["question_number"],
                "chapter_title": chapter["title"] if chapter else None,
                "section": ({"id": section["outline_node_id"], "title": section["title"]}
                            if section else None),
                "knowledge_point": None,
                "source": {**self._record(row),
                           "label": label, "exercise_title": exercise_title,
                           "pdf_page_index": page,
                           "has_review_thread": bool(row["review_thread_id"])},
            })
        return items

    def attempt(self, revision_id: str, number: object, choice: object) -> dict:
        number = self._number(number)
        if not isinstance(choice, str) or choice not in "ABCD":
            raise ValueError("选项无效。")
        question = self.question(revision_id, number)
        correct = choice == (question["answer"] if question else official_answer(number))
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
        self.question(revision_id, number)
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
