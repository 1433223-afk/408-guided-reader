from __future__ import annotations

import re
from importlib.metadata import version
from math import isfinite

from .contracts import DetectedLine
from .geometry import clamp, normalize_quad


class RapidOcrEngine:
    """The sole translation point from RapidOCR vocabulary to Foundation types."""

    def __init__(self) -> None:
        from rapidocr import RapidOCR

        self._engine = RapidOCR()

    @property
    def profile(self) -> str:
        return f"rapidocr-{version('rapidocr')}:ppocrv6-small:onnx-cpu:quality-retry-v3"

    def prepare_page(
        self, page_image: object, page_size: tuple[int, int]
    ) -> list[DetectedLine]:
        width, height = page_size
        # RapidOCR persists non-None call options on its instance. A preceding
        # recognition-only retry (even a failed one) must not disable page detection.
        output = self._engine(
            page_image, use_det=True, use_cls=True, use_rec=True, return_word_box=True
        )
        if output.boxes is None or output.txts is None or output.scores is None:
            return []
        output = self._orientation_alternatives(page_image, output, page_size)
        output = self._leader_layout_retry(page_image, output, page_size)
        provider_cells = output.word_results or ()
        translated: list[DetectedLine] = []
        for index, (points, text, score) in enumerate(
            zip(output.boxes, output.txts, output.scores, strict=True)
        ):
            units = provider_cells[index] if index < len(provider_cells) else ()
            line_text = str(text)
            confidence = clamp(float(score))
            repaired = self._retry_sparse_line(
                page_image, points, line_text, confidence, width
            )
            if repaired is None:
                cells = self._translate_cells(
                    units,
                    line_text,
                    width,
                )
            else:
                line_text, confidence, cells = repaired
            if not cells and line_text:
                xs = [float(point[0]) / width for point in points]
                cells = ((clamp(min(xs)), clamp(max(xs)), 0, len(line_text)),)
            translated.append(
                DetectedLine(
                    quad=normalize_quad(points, width, height),
                    text=line_text,
                    confidence=confidence,
                    cells=cells,
                )
            )
        return translated

    def _leader_layout_retry(self, image, baseline, size):
        """Bounded overlapping bands for sparse, leader-rich layouts.

        This is provider-local image segmentation, not Outline classification.
        Returned word boxes are mapped back to the original display pixels.
        No title, numbering or book-specific vocabulary is manufactured here.
        """
        if sum(bool(re.search(r"[.·…⋯]{4,}", str(t))) for t in baseline.txts) < 5:
            return baseline
        try:
            from types import SimpleNamespace

            import numpy as np

            width, height = size
            boxes, texts, scores, units = [], [], [], []

            def missing_at_start(box):
                x0, y0 = box.min(axis=0)
                x1, y1 = box.max(axis=0)
                # A long leader box must not count as missing when its title's
                # first characters have already been detected in smaller pieces.
                x1 = min(x1, x0 + (y1 - y0) * 3)
                return not any(
                    min(y1, b[:, 1].max()) - max(y0, b[:, 1].min()) > (y1 - y0) * 0.4
                    and min(x1, b[:, 0].max()) - max(x0, b[:, 0].min())
                    > (x1 - x0) * 0.3
                    for b in boxes
                )

            for band in range(4):
                low, high = height * band / 4, height * (band + 1) / 4
                y0, y1 = (
                    max(0, int(low - height * 0.025)),
                    min(height, int(high + height * 0.025)),
                )
                result = self._engine(
                    image[y0:y1],
                    use_det=True,
                    use_cls=False,
                    use_rec=True,
                    return_word_box=True,
                )
                if result.boxes is None:
                    continue
                for i, (box, text, score) in enumerate(
                    zip(result.boxes, result.txts, result.scores, strict=True)
                ):
                    mapped = np.array(box, dtype=float) + (0, y0)
                    if mapped.shape != (4, 2) or not np.isfinite(mapped).all():
                        return baseline
                    center = float(mapped[:, 1].mean())
                    if (
                        not low <= center < high
                        or not isfinite(float(score))
                        or not 0 <= float(score) <= 1
                    ):
                        continue
                    normalize_quad(mapped, width, height)
                    word_boxes = []
                    for unit in result.word_results[i] if result.word_results else ():
                        if len(unit) >= 3 and unit[2] is not None:
                            word_box = np.array(unit[2]) + (0, y0)
                            if (
                                word_box.shape != (4, 2)
                                or not np.isfinite(word_box).all()
                            ):
                                return baseline
                            normalize_quad(word_box, width, height)
                            word_boxes.append((unit[0], unit[1], word_box))
                    boxes.append(mapped)
                    texts.append(str(text))
                    scores.append(float(score))
                    units.append(word_boxes)
            # Bands and the full-page detector have complementary misses. Retain
            # baseline titles where the retry has no geometry at their beginning.
            for i, (box, text, score) in enumerate(
                zip(baseline.boxes, baseline.txts, baseline.scores, strict=True)
            ):
                box = np.array(box, dtype=float)
                if missing_at_start(box):
                    boxes.append(box)
                    texts.append(str(text))
                    scores.append(float(score))
                    units.append(
                        baseline.word_results[i] if baseline.word_results else ()
                    )
            # Short labels at the left are easily erased beside long dotted leaders.
            # The bounded left-column pass recovers only absent, high-confidence boxes.
            for band in range(4):
                y0 = max(0, int(height * (band / 4 - 0.025)))
                y1 = min(height, int(height * ((band + 1) / 4 + 0.025)))
                result = self._engine(
                    image[y0:y1, : int(width * 0.45)],
                    use_det=True,
                    use_cls=False,
                    use_rec=True,
                    return_word_box=True,
                )
                if result.boxes is None:
                    continue
                for i, (box, text, score) in enumerate(
                    zip(result.boxes, result.txts, result.scores, strict=True)
                ):
                    mapped = np.array(box, dtype=float) + (0, y0)
                    if mapped.shape != (4, 2) or not np.isfinite(mapped).all():
                        return baseline
                    if (
                        not 0.8 <= float(score) <= 1
                        or mapped[:, 0].max() > width * 0.43
                        or not missing_at_start(mapped)
                    ):
                        continue
                    normalize_quad(mapped, width, height)
                    word_boxes = [
                        (u[0], u[1], np.array(u[2]) + (0, y0))
                        for u in (result.word_results[i] if result.word_results else ())
                        if len(u) >= 3 and u[2] is not None
                    ]
                    for word_box in word_boxes:
                        if (
                            word_box[2].shape != (4, 2)
                            or not np.isfinite(word_box[2]).all()
                        ):
                            return baseline
                        normalize_quad(word_box[2], width, height)
                    boxes.append(mapped)
                    texts.append(str(text))
                    scores.append(float(score))
                    units.append(word_boxes)
            # Do not impose upright recognition on an actually rotated scan, or
            # accept a partial retry. Require widespread non-leader text agreement.
            clean = lambda t: re.sub(r"[\s.·…⋯()（）0-9]", "", str(t))
            known = [clean(t) for t in baseline.txts if len(clean(t)) >= 3]
            combined = "".join(clean(t) for t in texts)
            agreed = sum(t in combined for t in known)
            if (
                not known
                or agreed < len(known) * 0.65
                or len(combined) < sum(map(len, known)) * 0.85
            ):
                return baseline
            return SimpleNamespace(
                boxes=boxes, txts=texts, scores=scores, word_results=units
            )
        except Exception:  # noqa: BLE001 — optional provider pass must retain baseline on failure.
            return baseline

    def _orientation_alternatives(self, page_image, baseline, page_size):
        """Long leaders can fool the 0/180 classifier; compare, never blindly replace."""
        suspects = [
            i
            for i, (text, score) in enumerate(zip(baseline.txts, baseline.scores))
            if float(score) < 0.85 and re.search(r"[.·…⋯]{5,}", str(text))
        ]
        if not suspects:
            return baseline
        try:
            alternative = self._engine(
                page_image,
                use_det=True,
                use_cls=False,
                use_rec=True,
                return_word_box=True,
            )
            if alternative.boxes is None:
                return baseline
            from types import SimpleNamespace

            boxes, texts, scores = (
                list(baseline.boxes),
                list(baseline.txts),
                list(baseline.scores),
            )
            units = list(baseline.word_results or [()] * len(boxes))
            index_by_box = {tuple(map(tuple, box)): i for i, box in enumerate(boxes)}
            for alt_index, box in enumerate(alternative.boxes):
                # Exact detector geometry correspondence is required. No guessed alignment.
                index = index_by_box.get(tuple(map(tuple, box)))
                score = float(alternative.scores[alt_index])
                text = str(alternative.txts[alt_index])
                alt_units = (
                    alternative.word_results[alt_index]
                    if alternative.word_results
                    else ()
                )
                if not isfinite(score) or not 0.8 <= score <= 1:
                    continue
                normalize_quad(box, *page_size)
                self._translate_cells(alt_units, text, page_size[0])
                if index is None:
                    # Detection survived but flipped recognition was filtered out by provider.
                    if score >= 0.9 and len(text.strip()) >= 2:
                        boxes.append(box)
                        texts.append(text)
                        scores.append(score)
                        units.append(alt_units)
                    continue
                old = str(baseline.txts[index])
                margin = 0.04 if index in suspects else 0.15
                if score >= float(baseline.scores[index]) + margin and sum(
                    c.isalnum() for c in text
                ) >= sum(c.isalnum() for c in old):
                    texts[index], scores[index], units[index] = text, score, alt_units
            return SimpleNamespace(
                boxes=boxes, txts=texts, scores=scores, word_results=units
            )
        except Exception:  # noqa: BLE001 - optional quality comparison preserves baseline.
            return baseline

    def _retry_sparse_line(
        self, page_image, points, line_text: str, confidence: float, page_width: int
    ):
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        line_width = max(xs) - min(xs)
        line_height = max(ys) - min(ys)
        aspect = line_width / max(line_height, 1.0)
        visible_length = len("".join(line_text.split()))
        if (
            aspect < 12
            or confidence >= 0.85
            or visible_length > max(3, int(aspect * 0.2))
        ):
            return None

        image_height, image_width = page_image.shape[:2]
        padding = max(4, round(line_height * 0.75))
        crop_x0 = max(0, int(min(xs)) - padding)
        crop_x1 = min(image_width, int(max(xs)) + padding + 1)
        crop_y0 = max(0, int(min(ys)) - padding)
        crop_y1 = min(image_height, int(max(ys)) + padding + 1)
        crop = page_image[crop_y0:crop_y1, crop_x0:crop_x1]
        if not getattr(crop, "size", 0):
            return None

        try:
            retry = self._engine(
                crop,
                use_det=False,
                use_cls=True,
                use_rec=True,
                return_word_box=True,
            )
            if not retry.txts or not retry.scores:
                return None
            retry_text = str(retry.txts[0])
            retry_score = float(retry.scores[0])
            if not isfinite(retry_score) or not 0 <= retry_score <= 1:
                return None
            retry_confidence = retry_score
            retry_visible_length = len("".join(retry_text.split()))
            if (
                retry_confidence < max(0.8, confidence + 0.1)
                or retry_visible_length < max(visible_length + 4, int(aspect * 0.3))
                or retry_visible_length > max(12, int(aspect * 3))
            ):
                return None

            word_info = retry.word_results[0] if retry.word_results else None
            cells = self._translate_retry_cells(
                word_info, retry_text, min(xs), max(xs), page_width
            )
            return retry_text, retry_confidence, cells
        except Exception:  # noqa: BLE001 - optional provider retry must preserve baseline OCR.
            # Includes malformed optional output, not just invocation failures.
            return None

    @staticmethod
    def _translate_retry_cells(
        word_info, line_text: str, x0: float, x1: float, width: int
    ):
        if word_info is not None:
            try:
                flattened = [
                    (str(character), float(column))
                    for word, columns in zip(
                        word_info.words, word_info.word_cols, strict=True
                    )
                    for character, column in zip(word, columns, strict=True)
                ]
                line_length = float(word_info.line_txt_len)
                matched = []
                cursor = 0
                for character, column in flattened:
                    start = line_text.find(character, cursor)
                    if start < 0:
                        matched = []
                        break
                    matched.append((column, start, start + len(character)))
                    cursor = start + len(character)
                if matched and line_length > 0:
                    centers = [
                        x0 + (x1 - x0) * column / line_length
                        for column, _, _ in matched
                    ]
                    boundaries = [x0]
                    boundaries.extend(
                        (centers[index - 1] + centers[index]) / 2
                        for index in range(1, len(centers))
                    )
                    boundaries.append(x1)
                    return tuple(
                        (
                            clamp(boundaries[index] / width),
                            clamp(boundaries[index + 1] / width),
                            start,
                            end,
                        )
                        for index, (_column, start, end) in enumerate(matched)
                    )
            except (AttributeError, TypeError, ValueError):
                pass

        length = len(line_text)
        if not length:
            return ()
        return tuple(
            (
                clamp((x0 + (x1 - x0) * index / length) / width),
                clamp((x0 + (x1 - x0) * (index + 1) / length) / width),
                index,
                index + 1,
            )
            for index in range(length)
        )

    @staticmethod
    def _translate_cells(provider_units, line_text: str, width: int):
        cells = []
        cursor = 0
        for unit in provider_units or ():
            if len(unit) < 3 or unit[2] is None:
                continue
            unit_text = str(unit[0])
            start = line_text.find(unit_text, cursor)
            if start < 0:
                start = cursor
            end = min(len(line_text), start + len(unit_text))
            if end <= start:
                continue
            xs = [float(point[0]) / width for point in unit[2]]
            cells.append((clamp(min(xs)), clamp(max(xs)), start, end))
            cursor = end
        return tuple(cells)
