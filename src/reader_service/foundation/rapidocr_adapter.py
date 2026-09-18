from __future__ import annotations

from importlib.metadata import version

from .contracts import DetectedLine
from .geometry import clamp, normalize_quad


class RapidOcrEngine:
    """The sole translation point from RapidOCR vocabulary to Foundation types."""

    def __init__(self) -> None:
        from rapidocr import RapidOCR

        self._engine = RapidOCR()

    @property
    def profile(self) -> str:
        return f"rapidocr-{version('rapidocr')}:ppocrv6-small:onnx-cpu:sparse-line-retry-v1"

    def prepare_page(
        self, page_image: object, page_size: tuple[int, int]
    ) -> list[DetectedLine]:
        width, height = page_size
        output = self._engine(page_image, return_word_box=True)
        if output.boxes is None or output.txts is None or output.scores is None:
            return []
        provider_cells = output.word_results or ()
        translated: list[DetectedLine] = []
        for index, (points, text, score) in enumerate(
            zip(output.boxes, output.txts, output.scores, strict=True)
        ):
            line_text = str(text)
            confidence = clamp(float(score))
            repaired = self._retry_sparse_line(
                page_image, points, line_text, confidence, width
            )
            if repaired is None:
                cells = self._translate_cells(
                    provider_cells[index] if index < len(provider_cells) else (),
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
        except Exception:  # noqa: BLE001 - optional provider retry must preserve baseline OCR.
            # This is a quality retry. A failed retry must not discard the usable baseline line
            # or turn an otherwise READY page into FAILED.
            return None
        if not retry.txts or not retry.scores:
            return None
        retry_text = str(retry.txts[0])
        retry_confidence = clamp(float(retry.scores[0]))
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

    @staticmethod
    def _translate_retry_cells(word_info, line_text: str, x0: float, x1: float, width: int):
        if word_info is not None:
            try:
                flattened = [
                    (str(character), float(column))
                    for word, columns in zip(word_info.words, word_info.word_cols, strict=True)
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
