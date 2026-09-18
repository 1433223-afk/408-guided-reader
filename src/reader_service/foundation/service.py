from __future__ import annotations

import threading
import unicodedata
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

    def search(self, revision_id: str, query: str, *, limit: int = 100) -> dict:
        # Search is deliberately read-only: it neither creates status rows nor schedules OCR.
        revision = self.library.revision(revision_id)
        if not isinstance(query, str):
            raise ValueError("Search query must be text")
        if len(query) > 120:
            raise ValueError("Search query must be at most 120 characters")
        if limit < 1 or limit > 100:
            raise ValueError("Search result limit must be between 1 and 100")
        needle = self._normalize_search_text(query)
        counts, lines = self.repository.search_snapshot(revision_id)
        coverage = {
            "ready_pages": counts["READY"],
            "total_pages": revision["page_count"],
            "complete": counts["READY"] == revision["page_count"],
            "statuses": counts,
        }
        if not needle:
            return {"query": query, "coverage": coverage, "results": [], "truncated": False}

        pages: dict[int, list[dict]] = {}
        for line in lines:
            pages.setdefault(line["pdf_page_index"], []).append(line)
        matches = []
        truncated = False
        for page_index, page_lines in pages.items():
            source = "\n".join(line["text"] for line in page_lines)
            normalized, offsets = self._normalized_with_offsets(source)
            position = normalized.find(needle)
            if position < 0:
                continue
            if len(matches) >= limit:
                truncated = True
                break
            start = offsets[position]
            end = offsets[min(position + len(needle) - 1, len(offsets) - 1)] + 1
            snippet_start = max(0, start - 32)
            snippet_end = min(len(source), end + 48)
            prefix = "…" if snippet_start else ""
            suffix = "…" if snippet_end < len(source) else ""
            snippet = source[snippet_start:snippet_end].replace("\n", " ").strip()
            matches.append({
                "pdf_page_index": page_index,
                "snippet": prefix + snippet + suffix,
                # These are transient runtime positions nested in the search response. They are
                # never persisted or treated as durable anchor identity.
                "match_ranges": self._search_match_ranges(
                    self.repository.search_page_lines(revision_id, page_index), start, end
                ),
            })
        return {"query": query, "coverage": coverage, "results": matches, "truncated": truncated}

    @staticmethod
    def _normalize_search_text(value: str) -> str:
        return "".join(unicodedata.normalize("NFKC", value).casefold().split())

    @classmethod
    def _normalized_with_offsets(cls, value: str) -> tuple[str, list[int]]:
        characters: list[str] = []
        offsets: list[int] = []
        for index, character in enumerate(value):
            normalized = cls._normalize_search_text(character)
            characters.extend(normalized)
            offsets.extend([index] * len(normalized))
        return "".join(characters), offsets

    @staticmethod
    def _search_match_ranges(
        lines: list[dict], source_start: int, source_end: int
    ) -> list[dict]:
        ranges = []
        line_start = 0
        for line in lines:
            text = line["text"]
            line_end = line_start + len(text)
            local_start = max(0, source_start - line_start)
            local_end = min(len(text), source_end - line_start)
            if local_end > local_start:
                selected = [
                    index for index, cell in enumerate(line["cells"])
                    if int(cell[3]) > local_start and int(cell[2]) < local_end
                ]
                if selected:
                    ranges.append({
                        "line_ordinal": line["line_ordinal"],
                        "cell_start": selected[0],
                        "cell_end": selected[-1] + 1,
                    })
            line_start = line_end + 1
        return ranges

    def overlay(self, revision_id: str, page_index: int) -> dict:
        revision = self.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        result = self.repository.overlay(revision_id, page_index)
        if result is None:
            raise LookupError("Preparation state not found")
        return result

    def resolve_text_selection(
        self,
        revision_id: str,
        page_index: int,
        *,
        start: dict,
        end: dict,
        context_length: int = 12,
    ) -> dict:
        """Resolve transient line/cell positions into a provider-neutral durable anchor."""
        page = self.overlay(revision_id, page_index)
        if page["status"] != "READY":
            raise ValueError("Text selection is not available until this page is prepared")
        lines = page["lines"]
        if not lines:
            raise ValueError("This page has no selectable text")
        first = self._selection_point(start, lines)
        last = self._selection_point(end, lines)
        if (first[0], first[1]) > (last[0], last[1]):
            first, last = last, first

        line_offsets: list[int] = []
        offset = 0
        for line_index, line in enumerate(lines):
            line_offsets.append(offset)
            offset += len(line["text"])
            if line_index + 1 < len(lines):
                offset += 1
        page_text = "\n".join(line["text"] for line in lines)

        selected: list[str] = []
        quads: list[list[list[float]]] = []
        global_start = None
        global_end = None
        for line_index in range(first[0], last[0] + 1):
            line = lines[line_index]
            cell_start = first[1] if line_index == first[0] else 0
            cell_end = last[1] if line_index == last[0] else len(line["cells"])
            if cell_end <= cell_start:
                continue
            cells = line["cells"][cell_start:cell_end]
            char_start = int(cells[0][2])
            char_end = int(cells[-1][3])
            if char_start < 0 or char_end > len(line["text"]) or char_end <= char_start:
                raise ValueError("Stored selectable geometry is inconsistent with its text")
            selected.append(line["text"][char_start:char_end])
            ys = [point[1] for point in line["quad"]]
            x0 = min(float(cell[0]) for cell in cells)
            x1 = max(float(cell[1]) for cell in cells)
            y0 = min(ys)
            y1 = max(ys)
            if self._uses_vertical_selection_axis(line):
                height = y1 - y0
                y0 += height * cell_start / len(line["cells"])
                y1 = min(ys) + height * cell_end / len(line["cells"])
            quads.append(
                [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
            )
            if global_start is None:
                global_start = line_offsets[line_index] + char_start
            global_end = line_offsets[line_index] + char_end

        if not selected or global_start is None or global_end is None:
            raise ValueError("Select at least one character to create a highlight")
        quote = "\n".join(selected)
        return {
            "quads": quads,
            "quote": quote,
            "context_before": page_text[max(0, global_start - context_length):global_start],
            "context_after": page_text[global_end:global_end + context_length],
            "foundation_version": page["foundation_version"],
        }

    @staticmethod
    def _uses_vertical_selection_axis(line: dict) -> bool:
        cells = line["cells"]
        if len(cells) < 2:
            return False
        xs = [float(point[0]) for point in line["quad"]]
        ys = [float(point[1]) for point in line["quad"]]
        width = max(xs) - min(xs)
        height = max(ys) - min(ys)
        if height <= width * 1.5:
            return False
        # Anonymous cells intentionally persist x extents only. Require their centers to
        # collapse onto one column before deriving transient vertical selection geometry.
        centers = [(float(cell[0]) + float(cell[1])) / 2 for cell in cells]
        return max(centers) - min(centers) <= max(width * 0.25, 0.004)

    @staticmethod
    def _selection_point(point: dict, lines: list[dict]) -> tuple[int, int]:
        if not isinstance(point, dict):
            raise ValueError("Selection endpoints must be objects")
        line_ordinal = point.get("line_ordinal")
        boundary = point.get("boundary")
        if isinstance(line_ordinal, bool) or not isinstance(line_ordinal, int):
            raise ValueError("Selection line ordinal must be an integer")
        if isinstance(boundary, bool) or not isinstance(boundary, int):
            raise ValueError("Selection cell boundary must be an integer")
        line_index = next(
            (index for index, line in enumerate(lines) if line["line_ordinal"] == line_ordinal),
            None,
        )
        if line_index is None:
            raise ValueError("Selection line is not part of this prepared page")
        if boundary < 0 or boundary > len(lines[line_index]["cells"]):
            raise ValueError("Selection cell boundary is outside its line")
        return line_index, boundary

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
