from __future__ import annotations

from dataclasses import dataclass

from .contracts import DetectedLine
from .geometry import clamp, reading_order


@dataclass(frozen=True, slots=True)
class EmbeddedProbe:
    trustworthy: bool
    lines: tuple[DetectedLine, ...]


def probe_embedded_text(page, width: float, height: float) -> EmbeddedProbe:
    """Accept a usable embedded text layer in rendered-page coordinates.

    Character boxes stay in PDF user space. They are mapped through the page box
    and clockwise rotation so the overlay matches the rendered page, including a
    shifted crop box. Sparse, garbled, or unpositioned layers return no evidence
    and the caller renders the page for OCR.
    """

    try:
        left, bottom, right, top = map(float, page.get_bbox())
        rotation = int(page.get_rotation()) % 360
    except Exception:
        return EmbeddedProbe(False, ())
    if rotation not in (0, 90, 180, 270) or width <= 0 or height <= 0:
        return EmbeddedProbe(False, ())
    box_width = right - left
    box_height = top - bottom
    if rotation in (90, 270):
        box_width, box_height = box_height, box_width
    if (
        box_width <= 0
        or box_height <= 0
        or abs(box_width - width) > 2
        or abs(box_height - height) > 2
    ):
        return EmbeddedProbe(False, ())

    try:
        text_page = page.get_textpage()
        count = text_page.count_chars()
        raw = text_page.get_text_range() if count else ""
    except Exception:
        return EmbeddedProbe(False, ())
    if count == 0 or not raw:
        return EmbeddedProbe(False, ())
    visible = [character for character in raw if not character.isspace()]
    replacement_ratio = raw.count("\ufffd") / max(1, len(visible))
    if len(visible) < 30 or replacement_ratio > 0.02:
        return EmbeddedProbe(False, ())

    page_box = (left, bottom, right, top)
    characters = []
    positioned = 0
    visible_seen = 0
    for index, character in enumerate(raw[:count]):
        if character in "\r\n":
            characters.append((character, None))
            continue
        if character.isspace():
            continue
        visible_seen += 1
        try:
            char_left, char_bottom, char_right, char_top = map(
                float, text_page.get_charbox(index)
            )
        except Exception:
            continue
        box = _display_char_box(
            char_left,
            char_bottom,
            char_right,
            char_top,
            page_box,
            rotation,
            width,
            height,
        )
        if box is None:
            continue
        positioned += 1
        characters.append((character, box))
    if positioned / max(1, visible_seen) < 0.95:
        return EmbeddedProbe(False, ())

    lines = _group_lines(characters)
    if not lines:
        return EmbeddedProbe(False, ())
    return EmbeddedProbe(True, tuple(reading_order(lines)))


def _display_char_box(
    char_left: float,
    char_bottom: float,
    char_right: float,
    char_top: float,
    page_box: tuple[float, float, float, float],
    rotation: int,
    width: float,
    height: float,
):
    corners = (
        (char_left, char_bottom),
        (char_left, char_top),
        (char_right, char_bottom),
        (char_right, char_top),
    )
    points = [
        _display_point(x, y, page_box, rotation, width, height) for x, y in corners
    ]
    if any(point is None for point in points):
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    if x1 - x0 < 1e-6 or y1 - y0 < 1e-6:
        return None
    center_x = (x0 + x1) / 2
    center_y = (y0 + y1) / 2
    if not -0.02 <= center_x <= 1.02 or not -0.02 <= center_y <= 1.02:
        return None
    return (clamp(x0), clamp(y0), clamp(x1), clamp(y1))


def _display_point(x: float, y: float, page_box, rotation: int, width: float, height: float):
    left, bottom, right, top = page_box
    if rotation == 0:
        display_x, display_y = x - left, top - y
    elif rotation == 90:
        display_x, display_y = y - bottom, x - left
    elif rotation == 180:
        display_x, display_y = right - x, y - bottom
    else:
        display_x, display_y = top - y, right - x
    if width <= 0 or height <= 0:
        return None
    return display_x / width, display_y / height


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
