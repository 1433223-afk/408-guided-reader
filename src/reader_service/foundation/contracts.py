from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Sequence


CellPayload = tuple[float, float, int, int]
NormalizedPoint = tuple[float, float]
NormalizedQuad = tuple[NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint]


@dataclass(frozen=True, slots=True)
class DetectedLine:
    """Provider-neutral output at the Foundation boundary.

    Fine-grained cells deliberately remain anonymous tuples nested in their line.
    They are not entities and cannot be addressed independently.
    """

    quad: NormalizedQuad
    text: str
    confidence: float
    cells: tuple[CellPayload, ...]


class OcrEngine(Protocol):
    @property
    def profile(self) -> str: ...

    def prepare_page(
        self, page_image: object, page_size: tuple[int, int]
    ) -> Sequence[DetectedLine]: ...


class PagePreparationError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
