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
        return sorted(values, key=_top_left_key)
    bounds = [line_bounds(line) for line in values]
    candidates = [
        (index, (x0 + x1) / 2)
        for index, (x0, _y0, x1, _y1) in enumerate(bounds)
        if x1 - x0 < 0.62
    ]
    if len(candidates) < 4:
        return sorted(values, key=_top_left_key)
    centres = sorted(candidates, key=lambda item: item[1])
    gaps = [
        (centres[index + 1][1] - centres[index][1], index)
        for index in range(len(centres) - 1)
    ]
    gap, split_at = max(gaps, default=(0.0, 0))
    left = centres[: split_at + 1]
    right = centres[split_at + 1 :]
    if gap < 0.18 or len(left) < 2 or len(right) < 2:
        return sorted(values, key=_top_left_key)
    split = (left[-1][1] + right[0][1]) / 2

    narrow = [line for line in values if line_bounds(line)[2] - line_bounds(line)[0] < 0.62]
    wide = sorted((line for line in values if line not in narrow), key=_top_left_key)

    def column_order(band):
        left_column = []
        right_column = []
        for line in band:
            x0, _y0, x1, _y1 = line_bounds(line)
            (left_column if (x0 + x1) / 2 < split else right_column).append(line)
        return sorted(left_column, key=_top_left_key) + sorted(right_column, key=_top_left_key)

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
