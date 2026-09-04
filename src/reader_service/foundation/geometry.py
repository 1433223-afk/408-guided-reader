from __future__ import annotations

from collections.abc import Iterable

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


def reading_order(lines: Iterable[DetectedLine]) -> list[DetectedLine]:
    """Deterministic geometric order with conservative two-column detection.

    Full-width lines stay in their vertical position. A two-column split is used only
    when both sides contain repeated narrow lines and have a material centre gap.
    """

    values = list(lines)
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
