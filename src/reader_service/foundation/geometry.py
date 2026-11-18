from __future__ import annotations

from collections.abc import Iterable
from statistics import median

from .contracts import DetectedLine


def clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalize_quad(points: Iterable[Iterable[float]], width: int, height: int):
    if width <= 0 or height <= 0:
        raise ValueError("Page image has invalid dimensions")
    normalized = tuple((clamp(x / width), clamp(y / height)) for x, y in points)
    if len(normalized) != 4:
        raise ValueError("A detected line must have four quad points")
    return normalized


def line_bounds(line: DetectedLine) -> tuple[float, float, float, float]:
    xs = [point[0] for point in line.quad]
    ys = [point[1] for point in line.quad]
    return min(xs), min(ys), max(xs), max(ys)


def column_selection_indices(
    spans: list[tuple[float, float]], start: int, end: int
) -> list[int]:
    """Line indices covered by a drag from ``start`` to ``end``.

    Endpoints that sit in one narrow column keep that column. Stored order may
    place the other column between them; those lines are not part of the drag.
    """

    if start > end:
        start, end = end, start
    chosen = list(range(start, end + 1))
    if end <= start or end >= len(spans):
        return chosen
    left0, left1 = spans[start]
    right0, right1 = spans[end]
    if left1 - left0 >= 0.55 or right1 - right0 >= 0.55:
        return chosen
    overlap = min(left1, right1) - max(left0, right0)
    gap = max(left0, right0) - min(left1, right1)
    if overlap <= 0.008 and gap >= 0.08:
        return chosen
    union0 = min(left0, right0)
    union1 = max(left1, right1)
    return [
        index
        for index in chosen
        if _stays_in_selection_column(spans[index], union0, union1)
    ]


def _stays_in_selection_column(span, union0, union1) -> bool:
    overlap = min(span[1], union1) - max(span[0], union0)
    if overlap > 0.008:
        return True
    separation = max(span[0], union0) - min(span[1], union1)
    return separation < 0.08


def separate_columns(lines: Iterable[DetectedLine]) -> list[DetectedLine]:
    """Split lines that join two real text columns across a repeated gutter.

    A gutter counts only when several lines share it and both sides hold a run of
    text. Title-and-page-number gaps stay on one line.
    """

    current = list(lines)
    for _ in range(4):
        gutter = _choose_gutter(current)
        if gutter is None:
            return current
        split = [piece for line in current for piece in _split_line(line, gutter)]
        if len(split) == len(current):
            return current
        current = split
    return current


def _choose_gutter(lines: list[DetectedLine]):
    gaps = []
    for line_index, line in enumerate(lines):
        for gap in _column_gaps(line):
            gaps.append((line_index, *gap))
    if len(gaps) < 3:
        return None
    gaps.sort(key=lambda item: item[3])
    groups: list[list[tuple]] = []
    for gap in gaps:
        if groups and gap[3] - groups[-1][-1][3] <= 0.03:
            groups[-1].append(gap)
        else:
            groups.append([gap])
    best = max(groups, key=lambda group: len({item[0] for item in group}))
    if len({item[0] for item in best}) < 3:
        return None
    return (
        median(item[3] for item in best),
        median(item[1] for item in best),
        median(item[2] for item in best),
    )


def _column_gaps(line: DetectedLine) -> list[tuple[float, float, float, int]]:
    cells = line.cells
    if len(cells) < 2:
        return []
    found = []
    for index in range(len(cells) - 1):
        left, right = cells[index], cells[index + 1]
        if right[0] < left[0] - 0.002:
            return []
        gap = right[0] - left[1]
        if gap < 0.02:
            continue
        left_cells = cells[: index + 1]
        right_cells = cells[index + 1 :]
        left_width = max(cell[1] for cell in left_cells) - min(cell[0] for cell in left_cells)
        right_width = max(cell[1] for cell in right_cells) - min(cell[0] for cell in right_cells)
        left_count = sum(cell[3] - cell[2] for cell in left_cells)
        right_count = sum(cell[3] - cell[2] for cell in right_cells)
        center = (left[1] + right[0]) / 2
        if (
            left_width < 0.12
            or right_width < 0.12
            or left_count < 4
            or right_count < 4
            or not 0.2 <= center <= 0.8
        ):
            continue
        found.append((left[1], right[0], center, index))
    return found


def _split_line(line: DetectedLine, gutter) -> list[DetectedLine]:
    center, gutter_x0, gutter_x1 = gutter
    cells = line.cells
    best = None
    for index in range(len(cells) - 1):
        left, right = cells[index], cells[index + 1]
        if right[0] < left[0] - 0.002:
            return [line]
        gap = right[0] - left[1]
        gap_center = (left[1] + right[0]) / 2
        overlaps = min(right[0], gutter_x1) - max(left[1], gutter_x0) > 0
        if gap < 0.02 or (abs(gap_center - center) > 0.04 and not overlaps):
            continue
        if best is None or gap > best[0]:
            best = (gap, index)
    if best is None:
        return [line]
    split_at = cells[best[1] + 1][2]
    pieces = [
        _line_piece(line, 0, split_at),
        _line_piece(line, split_at, len(line.text)),
    ]
    return [piece for piece in pieces if piece is not None] or [line]


def _line_piece(line: DetectedLine, char0: int, char1: int) -> DetectedLine | None:
    text = line.text[char0:char1]
    if not text.strip():
        return None
    cells = tuple(
        (x0, x1, max(start, char0) - char0, min(end, char1) - char0)
        for x0, x1, start, end in line.cells
        if end > char0 and start < char1
    )
    if not cells:
        return None
    y0 = min(point[1] for point in line.quad)
    y1 = max(point[1] for point in line.quad)
    x0 = min(cell[0] for cell in cells)
    x1 = max(cell[1] for cell in cells)
    return DetectedLine(
        quad=((x0, y0), (x1, y0), (x1, y1), (x0, y1)),
        text=text,
        confidence=line.confidence,
        cells=cells,
    )


def reading_order(lines: Iterable[DetectedLine]) -> list[DetectedLine]:
    """Deterministic geometric order with conservative two-column detection.

    Lines that cross a repeated column gutter are split first. Full-width lines stay
    in their vertical position. A two-column split is used only when both sides
    contain repeated narrow lines and have a material centre gap.
    """

    values = separate_columns(lines)
    if len(values) < 4:
        return _visual_row_order(values)
    bounds = [line_bounds(line) for line in values]
    candidates = [
        (index, (x0 + x1) / 2)
        for index, (x0, _y0, x1, _y1) in enumerate(bounds)
        if x1 - x0 < 0.62
    ]
    if len(candidates) < 4:
        return _visual_row_order(values)
    centres = sorted(candidates, key=lambda item: item[1])
    gaps = [
        (centres[index + 1][1] - centres[index][1], index)
        for index in range(len(centres) - 1)
    ]
    gap, split_at = max(gaps, default=(0.0, 0))
    left = centres[: split_at + 1]
    right = centres[split_at + 1 :]
    if gap < 0.18 or len(left) < 2 or len(right) < 2:
        return _visual_row_order(values)
    split = (left[-1][1] + right[0][1]) / 2

    narrow = [line for line in values if line_bounds(line)[2] - line_bounds(line)[0] < 0.62]
    wide = _visual_row_order(line for line in values if line not in narrow)

    def column_order(band):
        left_column = []
        right_column = []
        for line in band:
            x0, _y0, x1, _y1 = line_bounds(line)
            (left_column if (x0 + x1) / 2 < split else right_column).append(line)
        return _visual_row_order(left_column) + _visual_row_order(right_column)

    ordered = []
    remaining = narrow
    for separator in wide:
        separator_y = line_bounds(separator)[1]
        before = [line for line in remaining if line_bounds(line)[1] < separator_y]
        ordered.extend(column_order(before))
        ordered.append(separator)
        remaining = [line for line in remaining if line not in before]
    ordered.extend(column_order(remaining))
    return ordered


def _top_left_key(line: DetectedLine):
    x0, y0, _x1, _y1 = line_bounds(line)
    return round(y0, 4), x0


def _visual_row_order(lines: Iterable[DetectedLine]) -> list[DetectedLine]:
    """Order strongly overlapping fragments left-to-right as one visual row."""

    rows: list[list[DetectedLine]] = []
    for line in sorted(lines, key=_top_left_key):
        x0, y0, _x1, y1 = line_bounds(line)
        height = max(y1 - y0, 1e-9)
        target = None
        for row in reversed(rows[-4:]):
            row_y0 = min(line_bounds(item)[1] for item in row)
            row_y1 = max(line_bounds(item)[3] for item in row)
            overlap = max(0.0, min(y1, row_y1) - max(y0, row_y0))
            if overlap / min(height, max(row_y1 - row_y0, 1e-9)) >= 0.6:
                target = row
                break
        if target is None:
            rows.append([line])
        else:
            target.append(line)
    return [
        line
        for row in rows
        for line in sorted(row, key=lambda item: line_bounds(item)[0])
    ]
