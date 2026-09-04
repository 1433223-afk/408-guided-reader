from __future__ import annotations

import threading
from pathlib import Path
from typing import Callable

from reader_service.library import LibraryService

from .contracts import OcrEngine, PagePreparationError
from .embedded import probe_embedded_text
from .geometry import reading_order
from .repository import FoundationRepository


class FoundationService:
    def __init__(
        self,
        library: LibraryService,
        repository: FoundationRepository,
        engine_factory: Callable[[], OcrEngine],
        render_dpi: int = 200,
    ):
        self.library = library
        self.repository = repository
        self.engine_factory = engine_factory
        self.render_dpi = render_dpi
        self._local = threading.local()

    def ensure_revision(self, revision_id: str) -> dict:
        revision = self.library.revision(revision_id)
        self.repository.ensure_pages(
            revision_id, revision["page_count"], revision["foundation_version"]
        )
        return revision

    def statuses(self, revision_id: str) -> list[dict]:
        self.ensure_revision(revision_id)
        return self.repository.page_statuses(revision_id)

    def overlay(self, revision_id: str, page_index: int) -> dict:
        revision = self.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        result = self.repository.overlay(revision_id, page_index)
        if result is None:
            raise LookupError("Preparation state not found")
        return result

    def prepare_page(self, revision_id: str, page_index: int) -> str:
        revision = self.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        if self.repository.page_status(revision_id, page_index) == "READY":
            return "READY"
        if not self.repository.mark_preparing(revision_id, page_index):
            return self.repository.page_status(revision_id, page_index) or "NOT_PREPARED"
        try:
            route, profile, lines = self._extract(
                self.library.pdf_path(revision_id), page_index
            )
            self.repository.publish_page(
                revision_id,
                page_index,
                route=route,
                foundation_version=revision["foundation_version"],
                engine_profile=profile,
                lines=reading_order(lines),
            )
            return "READY"
        except PagePreparationError as exc:
            self.repository.fail_page(revision_id, page_index, exc.code)
            return "FAILED"
        except Exception:
            self.repository.fail_page(revision_id, page_index, "PAGE_PREPARE_FAILED")
            return "FAILED"

    def _extract(self, pdf_path: Path, page_index: int):
        try:
            import pypdfium2 as pdfium

            document = pdfium.PdfDocument(pdf_path)
            page = document[page_index]
            width, height = page.get_size()
            embedded = probe_embedded_text(page, width, height)
            if embedded.trustworthy:
                page.close()
                document.close()
                return "EMBEDDED", "embedded-positioned-text:v2", list(embedded.lines)
            bitmap = page.render(scale=self.render_dpi / 72)
            image = bitmap.to_numpy().copy()
            bitmap.close()
            page.close()
            document.close()
        except Exception as exc:
            raise PagePreparationError("PAGE_RENDER_FAILED", str(exc)) from exc
        try:
            engine = self._engine()
            lines = list(engine.prepare_page(image, (image.shape[1], image.shape[0])))
            return "OCR", engine.profile, lines
        except Exception as exc:
            raise PagePreparationError("OCR_FAILED", str(exc)) from exc

    def _engine(self) -> OcrEngine:
        engine = getattr(self._local, "engine", None)
        if engine is None:
            engine = self.engine_factory()
            self._local.engine = engine
        return engine
