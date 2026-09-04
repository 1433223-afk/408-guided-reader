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
        return f"rapidocr-{version('rapidocr')}:ppocrv6-small:onnx-cpu"

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
            cells = self._translate_cells(
                provider_cells[index] if index < len(provider_cells) else (),
                line_text,
                width,
            )
            if not cells and line_text:
                xs = [float(point[0]) / width for point in points]
                cells = ((clamp(min(xs)), clamp(max(xs)), 0, len(line_text)),)
            translated.append(
                DetectedLine(
                    quad=normalize_quad(points, width, height),
                    text=line_text,
                    confidence=clamp(float(score)),
                    cells=cells,
                )
            )
        return translated

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
