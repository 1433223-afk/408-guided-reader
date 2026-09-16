from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass

from reader_service.library import LibraryService
from reader_service.library.database import Database


_ARABIC = re.compile(r"^[·.\-—_ ]*(\d{1,4})[·.\-—_ ]*$")
_ROMAN = re.compile(r"^[·.\-—_ ]*([IVXLCDM]{1,8})[·.\-—_ ]*$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class LabelCandidate:
    page_index: int
    value: int
    printed_label: str
    family: str
    side: str
    confidence: float
    evidence_ref: str


class PageLabelRepository:
    def __init__(self, database: Database):
        self.database = database

    def inference_snapshot(self, revision_id: str) -> list[dict]:
        with self.database.connect() as connection:
            rows = connection.execute(
                """
                SELECT lines.pdf_page_index, lines.line_ordinal, lines.text,
                       lines.confidence, lines.quad_json
                FROM ocr_lines AS lines
                JOIN ocr_pages AS pages
                  ON pages.book_source_revision_id = lines.book_source_revision_id
                 AND pages.pdf_page_index = lines.pdf_page_index
                WHERE lines.book_source_revision_id = ? AND pages.status = 'READY'
                ORDER BY lines.pdf_page_index, lines.line_ordinal
                """,
                (revision_id,),
            )
            return [
                {
                    **dict(row),
                    "quad": json.loads(row["quad_json"]),
                }
                for row in rows
            ]

    def inference_signature(self, revision_id: str) -> tuple[tuple[int, str, str | None], ...]:
        with self.database.connect() as connection:
            return tuple(
                (row["pdf_page_index"], row["status"], row["prepared_at"])
                for row in connection.execute(
                    """
                    SELECT pdf_page_index, status, prepared_at FROM ocr_pages
                    WHERE book_source_revision_id = ? ORDER BY pdf_page_index
                    """,
                    (revision_id,),
                )
            )

    def ensure_unknown_rows(self, revision_id: str, page_count: int) -> None:
        with self.database.connect() as connection:
            existing = connection.execute(
                "SELECT COUNT(*) FROM page_labels WHERE book_source_revision_id = ?",
                (revision_id,),
            ).fetchone()[0]
            if existing == page_count:
                return
            connection.executemany(
                """
                INSERT INTO page_labels(
                    book_source_revision_id, pdf_page_index, printed_label,
                    confidence, method, evidence_ref
                ) VALUES (?, ?, NULL, 0, 'NONE', NULL)
                ON CONFLICT(book_source_revision_id, pdf_page_index) DO NOTHING
                """,
                ((revision_id, page_index) for page_index in range(page_count)),
            )

    def publish_inference(self, revision_id: str, inferred: dict[int, dict]) -> list[str]:
        conflicts: list[str] = []
        with self.database.connect() as connection:
            existing = {
                row["pdf_page_index"]: dict(row)
                for row in connection.execute(
                    "SELECT * FROM page_labels WHERE book_source_revision_id = ?",
                    (revision_id,),
                )
            }
            for page_index, value in inferred.items():
                current = existing.get(page_index)
                if current and current["method"] == "MANUAL":
                    continue
                if current and current["method"] == "INFERRED":
                    if current["printed_label"] != value["printed_label"]:
                        conflicts.append(
                            f"PDF page {page_index + 1}: existing {current['printed_label']} "
                            f"!= inferred {value['printed_label']}"
                        )
                    continue
                connection.execute(
                    """
                    UPDATE page_labels
                    SET printed_label = ?, confidence = ?, method = 'INFERRED', evidence_ref = ?
                    WHERE book_source_revision_id = ? AND pdf_page_index = ? AND method = 'NONE'
                    """,
                    (
                        value["printed_label"],
                        value["confidence"],
                        value["evidence_ref"],
                        revision_id,
                        page_index,
                    ),
                )
        return conflicts

    def set_manual(self, revision_id: str, page_index: int, printed_label: str) -> dict:
        with self.database.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE page_labels
                SET printed_label = ?, confidence = 1, method = 'MANUAL',
                    evidence_ref = ?
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                """,
                (printed_label, f"MANUAL:pdf-page:{page_index}", revision_id, page_index),
            )
            if cursor.rowcount != 1:
                raise LookupError("Page label row not found")
        return self.get(revision_id, page_index)

    def list(self, revision_id: str) -> list[dict]:
        with self.database.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT pdf_page_index, printed_label, confidence, method, evidence_ref
                    FROM page_labels WHERE book_source_revision_id = ?
                    ORDER BY pdf_page_index
                    """,
                    (revision_id,),
                )
            ]

    def get(self, revision_id: str, page_index: int) -> dict:
        with self.database.connect() as connection:
            row = connection.execute(
                """
                SELECT pdf_page_index, printed_label, confidence, method, evidence_ref
                FROM page_labels
                WHERE book_source_revision_id = ? AND pdf_page_index = ?
                """,
                (revision_id, page_index),
            ).fetchone()
            if row is None:
                raise LookupError("Page label row not found")
            return dict(row)

    def resolve_labels(self, revision_id: str) -> dict[str, int]:
        """Return only labels with one safe target; one MANUAL row disambiguates inference."""
        with self.database.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT pdf_page_index, printed_label, method
                    FROM page_labels
                    WHERE book_source_revision_id = ? AND printed_label IS NOT NULL
                    ORDER BY pdf_page_index
                    """,
                    (revision_id,),
                )
            ]
        grouped: dict[str, list[dict]] = {}
        for row in rows:
            grouped.setdefault(row["printed_label"], []).append(row)
        resolved: dict[str, int] = {}
        for label, matches in grouped.items():
            manual = [row for row in matches if row["method"] == "MANUAL"]
            safe = manual if len(manual) == 1 else matches
            if len(safe) == 1:
                resolved[label] = safe[0]["pdf_page_index"]
        return resolved


class PageLabelService:
    """Per-page label inference from already-persisted READY header/footer OCR lines."""

    def __init__(self, library: LibraryService, repository: PageLabelRepository):
        self.library = library
        self.repository = repository
        self._lock = threading.Lock()
        self._last_signature: dict[str, tuple[tuple[int, str, str | None], ...]] = {}

    def infer(self, revision_id: str) -> dict:
        with self._lock:
            revision = self.library.revision(revision_id)
            self.repository.ensure_unknown_rows(revision_id, revision["page_count"])
            signature = self.repository.inference_signature(revision_id)
            conflicts = []
            if self._last_signature.get(revision_id) != signature:
                candidates = self._candidates(self.repository.inference_snapshot(revision_id))
                inferred = self._fit_runs(candidates)
                conflicts = self.repository.publish_inference(revision_id, inferred)
                self._last_signature[revision_id] = signature
            rows = self.repository.list(revision_id)
            return {
                "labels": rows,
                "inferred_count": sum(row["method"] == "INFERRED" for row in rows),
                "manual_count": sum(row["method"] == "MANUAL" for row in rows),
                "unknown_count": sum(row["method"] == "NONE" for row in rows),
                "conflicts": conflicts,
            }

    def list(self, revision_id: str) -> list[dict]:
        return self.infer(revision_id)["labels"]

    def set_manual(self, revision_id: str, page_index: int, printed_label: str) -> dict:
        revision = self.library.revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        if not isinstance(printed_label, str):
            raise ValueError("Printed page label must be text")
        value = " ".join(printed_label.split()).strip()
        if not value or len(value) > 32:
            raise ValueError("Printed page label must contain 1 to 32 characters")
        self.repository.ensure_unknown_rows(revision_id, revision["page_count"])
        return self.repository.set_manual(revision_id, page_index, value)

    @staticmethod
    def _candidates(rows: list[dict]) -> list[LabelCandidate]:
        result: list[LabelCandidate] = []
        for row in rows:
            quad = row["quad"]
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
            x = (min(xs) + max(xs)) / 2
            y = (min(ys) + max(ys)) / 2
            if not (y < 0.095 or y > 0.925) or not (x < 0.28 or x > 0.72):
                continue
            text = row["text"].strip()
            arabic = _ARABIC.fullmatch(text)
            roman = _ROMAN.fullmatch(text)
            if arabic:
                value = int(arabic.group(1))
                if value < 1:
                    continue
                family = "ARABIC"
                printed = arabic.group(1)
            elif roman:
                try:
                    value = _roman_to_int(roman.group(1))
                except ValueError:
                    continue
                family = "ROMAN"
                printed = roman.group(1).upper()
            else:
                continue
            result.append(
                LabelCandidate(
                    page_index=int(row["pdf_page_index"]),
                    value=value,
                    printed_label=printed,
                    family=family,
                    side="LEFT" if x < 0.5 else "RIGHT",
                    confidence=float(row["confidence"]),
                    evidence_ref=(
                        f"OCRLine:page={row['pdf_page_index']};line={row['line_ordinal']};"
                        f"band={'HEADER' if y < 0.5 else 'FOOTER'}"
                    ),
                )
            )
        return result

    @staticmethod
    def _fit_runs(candidates: list[LabelCandidate]) -> dict[int, dict]:
        by_family: dict[str, dict[int, list[LabelCandidate]]] = {}
        for candidate in candidates:
            by_family.setdefault(candidate.family, {}).setdefault(candidate.page_index, []).append(candidate)

        inferred: dict[int, dict] = {}
        for family, by_page in by_family.items():
            observations: list[LabelCandidate] = []
            for page_index in sorted(by_page):
                # Ambiguous evidence on one page is not evidence for a run.
                unique = {(item.value, item.printed_label): item for item in by_page[page_index]}
                if len(unique) == 1:
                    observations.append(next(iter(unique.values())))
            groups: dict[int, list[LabelCandidate]] = {}
            for item in observations:
                groups.setdefault(item.value - item.page_index, []).append(item)
            for offset, items in groups.items():
                items.sort(key=lambda item: item.page_index)
                components: list[list[LabelCandidate]] = []
                current: list[LabelCandidate] = []
                for item in items:
                    if current and item.page_index - current[-1].page_index > 2:
                        components.append(current)
                        current = []
                    current.append(item)
                if current:
                    components.append(current)
                for component in components:
                    if len(component) < 3 or component[-1].page_index - component[0].page_index < 2:
                        continue
                    parity = sum(
                        1
                        for item in component
                        if item.side == ("RIGHT" if item.value % 2 else "LEFT")
                    ) / len(component)
                    reverse_parity = sum(
                        1
                        for item in component
                        if item.side == ("LEFT" if item.value % 2 else "RIGHT")
                    ) / len(component)
                    if max(parity, reverse_parity) < 0.75:
                        continue
                    observed = {item.page_index: item for item in component}
                    for page_index in range(component[0].page_index, component[-1].page_index + 1):
                        value = page_index + offset
                        direct = observed.get(page_index)
                        if direct:
                            printed = direct.printed_label
                            confidence = min(0.98, max(0.75, direct.confidence))
                            evidence_ref = direct.evidence_ref
                        else:
                            # A single-page hole bounded by the same validated relation is safe.
                            if page_index - 1 not in observed or page_index + 1 not in observed:
                                continue
                            printed = str(value) if family == "ARABIC" else _int_to_roman(value)
                            confidence = 0.72
                            evidence_ref = (
                                f"INTERPOLATED:between-pdf-pages:{page_index - 1},{page_index + 1}"
                            )
                        prior = inferred.get(page_index)
                        candidate = {
                            "printed_label": printed,
                            "confidence": confidence,
                            "evidence_ref": evidence_ref,
                        }
                        if prior is None or candidate["confidence"] > prior["confidence"]:
                            inferred[page_index] = candidate
        return inferred


def _roman_to_int(value: str) -> int:
    numbers = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    text = value.upper()
    total = 0
    previous = 0
    for character in reversed(text):
        number = numbers[character]
        total += -number if number < previous else number
        previous = max(previous, number)
    if total < 1 or _int_to_roman(total) != text:
        raise ValueError("Invalid Roman numeral")
    return total


def _int_to_roman(value: int) -> str:
    if value < 1 or value > 3999:
        raise ValueError("Roman numeral outside supported range")
    parts = (
        (1000, "M"), (900, "CM"), (500, "D"), (400, "CD"),
        (100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
        (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I"),
    )
    output = []
    remaining = value
    for number, token in parts:
        count, remaining = divmod(remaining, number)
        output.append(token * count)
    return "".join(output)
