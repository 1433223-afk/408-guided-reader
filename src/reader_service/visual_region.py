"""Render a user-selected visual PDF region directly from the original source."""

from __future__ import annotations

import base64
import math
import threading
import copy
import weakref
from collections import OrderedDict
from contextlib import closing
from io import BytesIO
import pypdfium2 as pdfium

from reader_service.pdf_limits import validate_render_size


# PDFium is not thread safe, including when callers open different documents.
# Foundation OCR and visual-region requests share this lock.
PDFIUM_RENDER_LOCK = threading.RLock()
RENDER_DPI = 216
MAX_IMAGE_SIDE = 2048
MAX_IMAGE_PIXELS = 3_000_000
MIN_IMAGE_SIDE = 16
_REGIONS = weakref.WeakKeyDictionary()
_REGION_LOCK = threading.RLock()


def _region_rect(rect) -> list[float]:
    if not isinstance(rect, (list, tuple)) or len(rect) != 4:
        raise ValueError("请框选一个有效的教材区域。")
    if any(type(value) not in (int, float) for value in rect):
        raise ValueError("教材选区坐标无效。")
    try:
        values = list(map(float, rect))
    except OverflowError as exc:
        raise ValueError("教材选区坐标无效。") from exc
    if any(not math.isfinite(value) for value in values):
        raise ValueError("教材选区坐标无效。")
    x0, y0, x1, y1 = values
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        raise ValueError("教材选区必须完整位于当前 PDF 页面内。")
    return [x0, y0, x1, y1]


def render_visual_region(library, revision_id: str, page_index: int, rect) -> dict:
    """Return a PNG and immutable source coordinates, without OCR or stored assets.

    ``rect`` is [left, top, right, bottom] normalized against the *displayed*
    effective page, just like Reader's overlays. PDFium applies the source PDF's
    rotation and CropBox before its render-crop offsets. Do not rotate the rect
    again or translate it using the saved MediaBox dimensions.
    """
    normalized = _region_rect(rect)
    revision = library.revision(revision_id)
    if revision["status"] != "ACTIVE":
        raise LookupError("原教材当前不可用，请重新打开教材。")
    if type(page_index) is not int or not 0 <= page_index < revision["page_count"]:
        raise ValueError("PDF 页码无效。")
    pdf_path = library.pdf_path(revision_id)
    stat = pdf_path.stat()
    key = (revision["blob_sha256"], page_index, tuple(normalized), revision["page_count"],
           stat.st_size, stat.st_mtime_ns, RENDER_DPI, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS)
    with _REGION_LOCK:
        cache = _REGIONS.setdefault(library, OrderedDict())
        if key in cache:
            cache.move_to_end(key)
            return copy.deepcopy(cache[key])
    result = _render_region(pdf_path, revision, page_index, normalized)
    with _REGION_LOCK:
        cache = _REGIONS.setdefault(library, OrderedDict())
        cache[key] = result
        while len(cache) > 4 or sum(len(item["image"]["data_url"]) for item in cache.values()) > 8 * 1024 * 1024:
            cache.popitem(last=False)
    return copy.deepcopy(result)


def _render_region(pdf_path, revision, page_index, normalized):
    with PDFIUM_RENDER_LOCK:
        try:
            with closing(pdfium.PdfDocument(pdf_path)) as document:
                if len(document) != revision["page_count"]:
                    raise ValueError("原 PDF 页数与书库记录不一致，请重新打开教材。")
                with closing(document[page_index]) as page:
                    width, height = page.get_size()
                    validate_render_size(width, height, RENDER_DPI)
                    x0, y0, x1, y1 = normalized
                    region_width, region_height = (x1 - x0) * width, (y1 - y0) * height
                    # Leave room for PDFium's per-edge pixel rounding.
                    scale = min(
                        RENDER_DPI / 72,
                        (MAX_IMAGE_SIDE - 2) / max(region_width, region_height),
                        math.sqrt((MAX_IMAGE_PIXELS - 4 * MAX_IMAGE_SIDE)
                                  / (region_width * region_height)),
                    )
                    if min(region_width, region_height) * scale < MIN_IMAGE_SIDE:
                        raise ValueError("选区太小，请把需要解释的公式或图表完整框入。")
                    crop = (x0 * width, (1 - y1) * height, (1 - x1) * width, y0 * height)
                    with closing(page.render(scale=scale, crop=crop)) as bitmap:
                        with closing(bitmap.to_pil()) as image:
                            image_width, image_height = image.size
                            if (max(image.size) > MAX_IMAGE_SIDE
                                    or image_width * image_height > MAX_IMAGE_PIXELS):
                                raise ValueError("教材选区图像过大，请缩小选区。")
                            output = BytesIO()
                            image.save(output, format="PNG")
                            png = output.getvalue()
        except pdfium.PdfiumError as exc:
            raise ValueError("无法读取这块 PDF 区域，请重新打开教材后再试。") from exc

    return {
        "pdf_page_index": page_index,
        "rect": normalized,
        "source_sha256": revision["blob_sha256"],
        "image": {
            "data_url": "data:image/png;base64," + base64.b64encode(png).decode("ascii"),
            "width": image_width,
            "height": image_height,
            "mime_type": "image/png",
        },
    }
