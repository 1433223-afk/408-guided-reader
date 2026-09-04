from __future__ import annotations

from dataclasses import dataclass

from .contracts import DetectedLine
from .geometry import clamp, reading_order


@dataclass(frozen=True, slots=True)
class EmbeddedProbe:
    trustworthy: bool
    lines: tuple[DetectedLine, ...]


def probe_embedded_text(page, width: float, height: float) -> EmbeddedProbe:
    """Conservatively accept positioned embedded text; otherwise return no evidence."""

    # PDFium character boxes are in PDF user space.  The simple conversion below
    # is exact only for an unrotated effective page box whose origin is (0, 0).
    # Falling back to rendered-page OCR is preferable to publishing a plausible
    # but misplaced overlay for every other case.
    try:
        left, bottom, right, top = map(float, page.get_bbox())
        rotation = int(page.get_rotation()) % 360
    except Exception:
        return EmbeddedProbe(False, ())
    tolerance = 1e-4
    if (
        rotation != 0
        or abs(left) > tolerance
        or abs(bottom) > tolerance
        or abs((right - left) - width) > tolerance
        or abs((top - bottom) - height) > tolerance
    ):
        return EmbeddedProbe(False, ())

    text_page = page.get_textpage()
    count = text_page.count_chars()
    if count == 0:
        return EmbeddedProbe(False, ())
    raw = text_page.get_text_range()
    visible = [character for character in raw if not character.isspace()]
    replacement_ratio = raw.count("\ufffd") / max(1, len(visible))
    if len(visible) < 30 or replacement_ratio > 0.02:
        return EmbeddedProbe(False, ())

    characters = []
    positioned = 0
    for index, character in enumerate(raw[:count]):
        try:
            left, bottom, right, top = map(float, text_page.get_charbox(index))
        except Exception:
            characters.append((character, None))
            continue
        if right > left and top > bottom:
            positioned += 1
            # This branch is guarded above: PDFium exposes bottom-left PDF
            # coordinates on an unrotated, zero-origin effective page box.
            # Foundation is normalized top-left display space.
            characters.append(
                (
                    character,
                    (
                        clamp(left / width),
                        clamp((height - top) / height),
                        clamp(right / width),
                        clamp((height - bottom) / height),
                    ),
                )
            )
        else:
            characters.append((character, None))
    if positioned / max(1, len(visible)) < 0.95:
        return EmbeddedProbe(False, ())

    lines = _group_lines(characters)
    if not lines:
        return EmbeddedProbe(False, ())
    return EmbeddedProbe(True, tuple(reading_order(lines)))


def _group_lines(characters) -> list[DetectedLine]:
    rows: list[list[tuple[str, tuple[float, float, float, float]]]] = []
    for character, box in characters:
        if character in "\r\n":
            if rows and rows[-1]:
                rows.append([])
            continue
        if box is None or character.isspace():
            continue
        center_y = (box[1] + box[3]) / 2
        target = next(
            (
                row
                for row in reversed(rows[-4:])
                if row and abs(center_y - _row_center(row)) <= max(0.006, _row_height(row) * 0.55)
            ),
            None,
        )
        if target is None:
            target = []
            rows.append(target)
        target.append((character, box))

    lines: list[DetectedLine] = []
    for row in rows:
        if not row:
            continue
        row.sort(key=lambda item: item[1][0])
        text = "".join(item[0] for item in row)
        x0 = min(item[1][0] for item in row)
        y0 = min(item[1][1] for item in row)
        x1 = max(item[1][2] for item in row)
        y1 = max(item[1][3] for item in row)
        cells = tuple((box[0], box[2], index, index + 1) for index, (_char, box) in enumerate(row))
        lines.append(
            DetectedLine(
                quad=((x0, y0), (x1, y0), (x1, y1), (x0, y1)),
                text=text,
                confidence=1.0,
                cells=cells,
            )
        )
    return lines


def _row_center(row) -> float:
    return sum((item[1][1] + item[1][3]) / 2 for item in row) / len(row)


def _row_height(row) -> float:
    return max(item[1][3] - item[1][1] for item in row)
