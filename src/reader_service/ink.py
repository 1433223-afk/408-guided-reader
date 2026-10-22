from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from uuid import UUID

from reader_service.library.database import Database
from reader_service.storage import ManagedPaths


class InkConflictError(ValueError):
    code = "INK_CONFLICT"
    status_code = 409


class InkService:
    """Durable page-space strokes, independent of OCR and PDF render lifetime."""

    MAX_POINTS = 1500
    MAX_OPERATION_BYTES = 64 * 1024
    COLORS = frozenset({"#252923", "#777b75", "#ad3939", "#b66a35", "#9c7b27",
                        "#477451", "#3d658f", "#785c91", "#8b9098", "#f04452",
                        "#f58220", "#e4b400", "#24aa62", "#2f80ed", "#a259e6"})
    MIN_WIDTH = 0.0003
    MAX_WIDTH = 0.02

    def __init__(self, paths: ManagedPaths):
        self.database = Database(paths.database())
        self.database.initialize()

    def list_strokes(self, revision_id: str, page_index: int) -> dict:
        with self.database.connect() as connection:
            revision = self._revision(connection, revision_id)
            self._page_index(page_index, revision["page_count"])
            rows = connection.execute(
                "SELECT * FROM ink_strokes WHERE book_source_revision_id = ? "
                "AND pdf_page_index = ? AND deleted = 0 ORDER BY created_at, rowid",
                (revision_id, page_index),
            )
            return {"strokes": [self._stroke(row) for row in rows]}

    def apply_operation(self, revision_id: str, payload: dict) -> dict:
        operation = self._operation(payload)
        encoded = json.dumps(operation, sort_keys=True, separators=(",", ":"), allow_nan=False)
        if len(encoded.encode("utf-8")) >= self.MAX_OPERATION_BYTES:
            raise ValueError("Ink operation must be smaller than 64 KiB")
        fingerprint = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        operation_id = operation["operation_id"]
        stroke_id = operation["stroke_id"]
        action = operation["action"]

        with self.database.connect() as connection:
            # Serialize ledger checking and state changes across request threads.
            connection.execute("BEGIN IMMEDIATE")
            revision = self._revision(connection, revision_id)
            previous = connection.execute(
                "SELECT * FROM ink_operations WHERE operation_id = ?", (operation_id,)
            ).fetchone()
            if previous and (
                previous["book_source_revision_id"] != revision_id
                or previous["payload_sha256"] != fingerprint
            ):
                raise InkConflictError("Ink operation id was already used for another request")

            row = connection.execute(
                "SELECT * FROM ink_strokes WHERE id = ?", (stroke_id,)
            ).fetchone()
            if row and row["book_source_revision_id"] != revision_id:
                raise InkConflictError("Ink stroke belongs to another source revision")

            if not previous:
                if action == "put":
                    stroke = operation["stroke"]
                    self._page_index(stroke["page_index"], revision["page_count"])
                    if row:
                        if self._stroke(row) != {"id": stroke_id, **stroke}:
                            raise InkConflictError("Ink strokes are immutable; use a new stroke id")
                        # A delayed put must never undo a later erase.
                    else:
                        connection.execute(
                            "INSERT INTO ink_strokes("
                            "id, book_source_revision_id, pdf_page_index, coordinate_version, "
                            "color, width, points_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (stroke_id, revision_id, stroke["page_index"],
                             stroke["coordinate_version"], stroke["color"], stroke["width"],
                             json.dumps(stroke["points"], separators=(",", ":"))),
                        )
                else:
                    if not row:
                        raise LookupError("Ink stroke not found")
                    connection.execute(
                        "UPDATE ink_strokes SET deleted = ?, updated_at = CURRENT_TIMESTAMP "
                        "WHERE id = ? AND book_source_revision_id = ?",
                        (int(action == "delete"), stroke_id, revision_id),
                    )
                connection.execute(
                    "INSERT INTO ink_operations(operation_id, book_source_revision_id, "
                    "stroke_id, action, payload_sha256) VALUES (?, ?, ?, ?, ?)",
                    (operation_id, revision_id, stroke_id, action, fingerprint),
                )

            current = connection.execute(
                "SELECT * FROM ink_strokes WHERE id = ? AND book_source_revision_id = ?",
                (stroke_id, revision_id),
            ).fetchone()
            return {
                "operation_id": operation_id,
                "action": action,
                "stroke_id": stroke_id,
                "deleted": bool(current["deleted"]),
                "stroke": self._stroke(current),
            }

    @staticmethod
    def _revision(connection: sqlite3.Connection, revision_id: str) -> sqlite3.Row:
        if not isinstance(revision_id, str) or not revision_id:
            raise ValueError("Source revision id is invalid")
        revision = connection.execute(
            "SELECT r.page_count FROM book_source_revisions r JOIN books b ON b.id = r.book_id "
            "WHERE r.id = ? AND b.status = 'ACTIVE' AND r.status IN ('ACTIVE', 'SUPERSEDED')",
            (revision_id,),
        ).fetchone()
        if revision is None:
            raise LookupError("Book source revision not found")
        return revision

    @staticmethod
    def _stroke(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "page_index": row["pdf_page_index"],
            "color": row["color"],
            "width": row["width"],
            "points": json.loads(row["points_json"]),
            "coordinate_version": row["coordinate_version"],
        }

    @classmethod
    def _operation(cls, value: object) -> dict:
        if not isinstance(value, dict):
            raise ValueError("Ink operation must be an object")
        try:
            size = len(json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        except (TypeError, ValueError, OverflowError, RecursionError) as exc:
            raise ValueError("Ink operation must contain finite JSON values") from exc
        if size >= cls.MAX_OPERATION_BYTES:
            raise ValueError("Ink operation must be smaller than 64 KiB")
        action = value.get("action")
        if not isinstance(action, str) or action not in {"put", "delete", "restore"}:
            raise ValueError("Ink operation action is invalid")
        required = {"operation_id", "action", "stroke_id"}
        if action == "put":
            required.add("stroke")
        if set(value) != required:
            raise ValueError("Ink operation fields are invalid")
        result = {
            "operation_id": cls._uuid(value.get("operation_id"), "operation"),
            "action": action,
            "stroke_id": cls._uuid(value.get("stroke_id"), "stroke"),
        }
        if action == "put":
            result["stroke"] = cls._clean_stroke(value["stroke"])
        return result

    @classmethod
    def _clean_stroke(cls, value: object) -> dict:
        fields = {"page_index", "coordinate_version", "color", "width", "points"}
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError("Ink stroke fields are invalid")
        page_index = value["page_index"]
        if type(page_index) is not int or page_index < 0:
            raise ValueError("Ink page index is invalid")
        if type(value["coordinate_version"]) is not int or value["coordinate_version"] != 1:
            raise ValueError("Ink coordinate version is unsupported")
        color = value["color"]
        if not isinstance(color, str) or color.lower() not in cls.COLORS:
            raise ValueError("Ink color must use the supported palette")
        width = cls._number(value["width"], "width", cls.MIN_WIDTH, cls.MAX_WIDTH)
        points = value["points"]
        if not isinstance(points, list) or not 1 <= len(points) <= cls.MAX_POINTS:
            raise ValueError("Ink stroke must contain between 1 and 1500 points")
        clean_points = []
        for point in points:
            if not isinstance(point, list) or len(point) != 3:
                raise ValueError("Ink points must contain x, y, and pressure")
            clean_points.append([cls._number(number, "point", 0, 1) for number in point])
        return {"page_index": page_index, "coordinate_version": 1, "color": color.lower(),
                "width": width, "points": clean_points}

    @staticmethod
    def _uuid(value: object, label: str) -> str:
        if not isinstance(value, str):
            raise ValueError(f"Ink {label} id must be a UUID")
        try:
            parsed = str(UUID(value))
        except (ValueError, AttributeError) as exc:
            raise ValueError(f"Ink {label} id must be a UUID") from exc
        if parsed != value.lower():
            raise ValueError(f"Ink {label} id must be a canonical UUID")
        return parsed

    @staticmethod
    def _number(value: object, label: str, minimum: float, maximum: float) -> float:
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not minimum <= value <= maximum or not math.isfinite(value)):
            raise ValueError(f"Ink {label} is outside its allowed range")
        return float(value)

    @staticmethod
    def _page_index(value: object, page_count: int) -> None:
        if type(value) is not int or value < 0 or value >= page_count:
            raise ValueError("Page index is outside this PDF")
