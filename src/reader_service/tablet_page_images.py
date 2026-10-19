"""Bounded, lossless original-page images for the LAN tablet reader."""

from __future__ import annotations

import logging
import math
import os
import re
import tempfile
from concurrent.futures import Future
from contextlib import closing
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from threading import BoundedSemaphore, Lock

from PIL import Image, PngImagePlugin

from reader_service.pdf_limits import MAX_RENDER_PIXELS, MAX_RENDER_SIDE, validate_render_size
from reader_service.visual_region import PDFIUM_RENDER_LOCK


_CACHE_MAX_BYTES = 256 * 1024 * 1024
_CACHE_MAX_FILES = 256
_PDF_WIDTH = 'reader_pdf_width'
_PDF_HEIGHT = 'reader_pdf_height'
_LOGGER = logging.getLogger(__name__)


class PageImageUnavailable(ValueError):
    """The requested original-page image needs the PDF.js fallback."""


@dataclass(frozen=True)
class PageImage:
    body: bytes
    pdf_width: float
    pdf_height: float
    width: int
    height: int
    cache_hit: bool


class _PageCountMismatch(ValueError):
    pass


def _render_dimensions(pdf_width: float, pdf_height: float, width: int) -> tuple[float, int]:
    if any(not math.isfinite(value) or value <= 0 for value in (pdf_width, pdf_height)):
        raise PageImageUnavailable('原 PDF 页面尺寸无效。')
    scale = width / pdf_width
    # PdfPage.render uses ceil(width * scale). Keep its allocation exactly at
    # the requested backing width even when division rounds one ULP upward.
    while math.ceil(pdf_width * scale) > width:
        scale = math.nextafter(scale, 0)
    try:
        validate_render_size(pdf_width, pdf_height, scale * 72)
    except (ValueError, OverflowError) as exc:
        raise PageImageUnavailable('本页在当前缩放下超过图像预算，请使用原 PDF 显示。') from exc
    height = math.ceil(pdf_height * scale)
    if height < 1 or max(width, height) > MAX_RENDER_SIDE or width * height > MAX_RENDER_PIXELS:
        raise PageImageUnavailable('本页在当前缩放下超过图像预算，请使用原 PDF 显示。')
    return scale, height


def _load_pdfium():
    with PDFIUM_RENDER_LOCK:
        import pypdfium2 as pdfium
        return pdfium


def _render_page(source: Path, page_index: int, width: int, page_count: int):
    try:
        pdfium = _load_pdfium()
    except Exception as exc:
        raise PageImageUnavailable('原 PDF 页图引擎不可用，请使用原 PDF 显示。') from exc

    image = None
    try:
        # All PDFium object use and destruction share the existing OCR/region
        # lock. The copied Pillow image owns its pixels after the bitmap closes.
        with PDFIUM_RENDER_LOCK:
            with closing(pdfium.PdfDocument(source)) as document:
                if document.get_formtype() != 0:
                    # Widget appearances require a form environment. Keep them
                    # on the existing PDF.js path without initializing forms or
                    # running any PDF document actions in this image renderer.
                    raise PageImageUnavailable('此 PDF 含表单，请使用原 PDF 显示。')
                if len(document) != page_count:
                    raise _PageCountMismatch('原 PDF 页数与书库记录不一致，请重新打开教材。')
                with closing(document[page_index]) as page:
                    pdf_width, pdf_height = map(float, page.get_size())
                    scale, height = _render_dimensions(pdf_width, pdf_height, width)
                    with closing(page.render(scale=scale)) as bitmap:
                        with closing(bitmap.to_pil()) as view:
                            image = view.copy()
                    if image.size != (width, height):
                        raise PageImageUnavailable('原 PDF 图像尺寸不一致，请使用原 PDF 显示。')
        return image, pdf_width, pdf_height
    except (_PageCountMismatch, PageImageUnavailable):
        if image is not None:
            image.close()
        raise
    except (pdfium.PdfiumError, OSError, ValueError, OverflowError, MemoryError) as exc:
        if image is not None:
            image.close()
        raise PageImageUnavailable('无法生成原 PDF 页图，请使用原 PDF 显示。') from exc


def _atomic_write(path: Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.page-', suffix='.tmp', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class TabletPageImages:
    def __init__(self, library):
        self.library = library
        # v1 could contain pages rendered without their widget appearances.
        self._cache_root = library.paths.resolve('tmp/tablet-page-images-v2')
        self._cache_lock = Lock()
        self._flight_lock = Lock()
        self._flights: dict[tuple[str, int, int], Future] = {}
        self._build_slots = BoundedSemaphore(2)
        try:
            # Tablet-only startup pays the native import cost before a reader
            # opens a book. No document, bitmap, OCR or model is initialized.
            _load_pdfium()
        except Exception as exc:
            # Keep the service usable; individual image requests can still use
            # the existing fallback if this optional native engine is missing.
            _LOGGER.warning('Tablet page image engine preload unavailable (%s)', type(exc).__name__)

    def render(self, revision_id: str, page_index: int, width: int) -> PageImage:
        if type(page_index) is not int or page_index < 0:
            raise ValueError('PDF 页码无效。')
        if type(width) is not int or not 128 <= width <= 8192:
            raise ValueError('页图宽度必须为 128–8192 的整数。')
        revision = self.library.revision(revision_id)
        if page_index >= revision['page_count']:
            raise ValueError('PDF 页码无效。')
        digest = revision['blob_sha256']
        if not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('原 PDF 来源标识无效。')
        key = digest, page_index, width
        path = self._cache_root / digest / f'{page_index}-{width}.png'
        cached = self._cached(path, width)
        if cached is not None:
            return cached
        with self._flight_lock:
            pending = self._flights.get(key)
            owner = pending is None
            if owner:
                pending = self._flights[key] = Future()
        if not owner:
            return replace(pending.result(), cache_hit=True)
        try:
            with self._build_slots:
                result = self._cached(path, width)
                if result is None:
                    result = self._build(revision_id, page_index, width, revision['page_count'])
                    self._store(path, result.body)
            pending.set_result(result)
            return result
        except BaseException as exc:
            pending.set_exception(exc)
            raise
        finally:
            with self._flight_lock:
                self._flights.pop(key, None)

    def _build(self, revision_id, page_index, width, page_count):
        image, pdf_width, pdf_height = _render_page(self.library.pdf_path(revision_id), page_index, width, page_count)
        try:
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text(_PDF_WIDTH, repr(pdf_width))
            metadata.add_text(_PDF_HEIGHT, repr(pdf_height))
            output = BytesIO()
            # Encoding does not touch PDFium and can overlap the next render.
            image.save(output, format='PNG', compress_level=6, pnginfo=metadata)
            return PageImage(output.getvalue(), pdf_width, pdf_height, image.width, image.height, False)
        except (OSError, ValueError, MemoryError) as exc:
            raise PageImageUnavailable('无法编码原 PDF 页图，请使用原 PDF 显示。') from exc
        finally:
            image.close()

    def _within_cache(self, path):
        resolved = path.resolve()
        resolved.relative_to(self._cache_root.resolve())
        return resolved

    def _cached(self, path, width):
        with self._cache_lock:
            try:
                path = self._within_cache(path)
                if path.stat().st_size > _CACHE_MAX_BYTES:
                    return None
                body = path.read_bytes()
                with Image.open(BytesIO(body)) as image:
                    if image.format != 'PNG' or image.width != width:
                        return None
                    pdf_width = float(image.info[_PDF_WIDTH])
                    pdf_height = float(image.info[_PDF_HEIGHT])
                    _, height = _render_dimensions(pdf_width, pdf_height, width)
                    if image.height != height:
                        return None
                    image.verify()
                result = PageImage(body, pdf_width, pdf_height, width, height, True)
                try:
                    os.utime(path, None)
                except OSError:
                    pass
                return result
            except (OSError, ValueError, KeyError, SyntaxError, OverflowError):
                return None

    def _store(self, path, body):
        with self._cache_lock:
            try:
                path = self._within_cache(path)
                _atomic_write(path, body)
                self._prune()
            except (OSError, ValueError):
                # The returned bytes are already complete; a disposable cache
                # must never turn a successfully rendered page into a failure.
                pass

    def _prune(self):
        files = []
        for candidate in self._cache_root.glob('*/*.png'):
            try:
                path = self._within_cache(candidate)
                if candidate.is_symlink() or not path.is_file():
                    continue
                stat = path.stat()
                files.append((stat.st_mtime_ns, path, stat.st_size))
            except (OSError, ValueError):
                continue
        total, count = sum(size for _, _, size in files), len(files)
        for _, path, size in sorted(files):
            if total <= _CACHE_MAX_BYTES and count <= _CACHE_MAX_FILES:
                break
            try:
                # Recheck containment immediately before deleting this one PNG.
                self._within_cache(path).unlink(missing_ok=True)
                total -= size
                count -= 1
            except (OSError, ValueError):
                continue
