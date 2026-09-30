"""Bound PDF geometry before allocating a render bitmap."""
import math

MAX_RENDER_PIXELS = 32_000_000
MAX_RENDER_SIDE = 16_384
PREPARATION_DPI = 200


def validate_render_size(width: float, height: float, dpi: float = PREPARATION_DPI) -> None:
    if any(not math.isfinite(v) or v <= 0 for v in (width, height, dpi)):
        raise ValueError("PDF 页面尺寸无效，无法安全显示。")
    scaled = (width * dpi / 72, height * dpi / 72)
    if any(not math.isfinite(v) or v > MAX_RENDER_SIDE for v in scaled):
        raise ValueError("PDF 页面尺寸过大，超过安全渲染范围；请使用常规页面尺寸的 PDF。")
    w, h = map(math.ceil, scaled)
    if max(w, h) > MAX_RENDER_SIDE or w * h > MAX_RENDER_PIXELS:
        raise ValueError("PDF 页面尺寸过大，超过安全渲染范围；请使用常规页面尺寸的 PDF。")
