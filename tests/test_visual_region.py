from __future__ import annotations

import base64
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

from reader_service.visual_region import (
    MAX_IMAGE_PIXELS,
    MAX_IMAGE_SIDE,
    render_visual_region,
)


def _quadrants(service, *, rotation=0, cropped=False, origin=(0, 0), size=(400, 600)):
    """A real PDF with four distinct colors; no OCR rows are prepared."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=size[0], height=size[1])
    ox, oy = origin
    page.mediabox.lower_left = origin
    page.mediabox.upper_right = (ox + size[0], oy + size[1])
    left, bottom, right, top = (ox, oy, ox + size[0], oy + size[1])
    if cropped:
        left, bottom, right, top = (ox + 50, oy + 100, ox + size[0] - 50, oy + size[1] - 100)
    page.cropbox.lower_left = (left, bottom)
    page.cropbox.upper_right = (right, top)
    half_w, half_h = (right - left) / 2, (top - bottom) / 2
    stream = DecodedStreamObject()
    stream.set_data((
        f"1 0 0 rg {left} {bottom + half_h} {half_w} {half_h} re f\n"
        f"0 1 0 rg {left + half_w} {bottom + half_h} {half_w} {half_h} re f\n"
        f"0 0 1 rg {left} {bottom} {half_w} {half_h} re f\n"
        f"1 1 0 rg {left + half_w} {bottom} {half_w} {half_h} re f\n"
    ).encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    if rotation:
        page.rotate(rotation)
    output = BytesIO()
    writer.write(output)
    payload = output.getvalue()
    return service.intake(BytesIO(payload), content_length=len(payload), filename="regions.pdf")["book"]["active_revision"]


def _image(result):
    prefix, data = result["image"]["data_url"].split(",", 1)
    assert prefix == "data:image/png;base64"
    return Image.open(BytesIO(base64.b64decode(data)))


@pytest.mark.parametrize("rotation,color", [
    (0, (255, 0, 0)), (90, (0, 0, 255)), (180, (255, 255, 0)), (270, (0, 255, 0)),
])
@pytest.mark.parametrize("cropped,origin", [(False, (0, 0)), (True, (0, 0)), (True, (25, 40))])
def test_visual_crop_uses_display_coordinates_with_rotation_and_cropbox(service, rotation, color, cropped, origin):
    revision = _quadrants(service, rotation=rotation, cropped=cropped, origin=origin)
    result = render_visual_region(service, revision["id"], 0, [.1, .1, .4, .4])
    with _image(result) as image:
        assert image.convert("RGB").getpixel((image.width // 2, image.height // 2)) == color
        assert image.size == (result["image"]["width"], result["image"]["height"])
    assert result["rect"] == [.1, .1, .4, .4]
    assert result["source_sha256"] == revision["blob_sha256"]
    with service.database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM ocr_pages").fetchone()[0] == 0


@pytest.mark.parametrize("rect", [
    None, [], [0, 0, 1], [0, 0, 1, 1, 1], [False, 0, 1, 1],
    [0, 0, float("nan"), 1], [0, 0, float("inf"), 1], [0, 0, 10**500, 1], [-.1, 0, 1, 1],
    [0, 0, 1.01, 1], [0, 0, 0, 1], [.5, 0, .1, 1], [0, 0, .0001, .0001],
])
def test_visual_crop_rejects_invalid_or_too_small_regions(service, rect):
    revision = _quadrants(service)
    with pytest.raises(ValueError):
        render_visual_region(service, revision["id"], 0, rect)


@pytest.mark.parametrize("page", [-1, 1, True, .5, "0"])
def test_visual_crop_rejects_invalid_pages(service, page):
    revision = _quadrants(service)
    with pytest.raises(ValueError):
        render_visual_region(service, revision["id"], page, [0, 0, 1, 1])


def test_visual_crop_rejects_superseded_sources(service):
    revision = _quadrants(service)
    with service.database.connect() as connection:
        connection.execute("UPDATE book_source_revisions SET status='SUPERSEDED' WHERE id=?", (revision["id"],))
    with pytest.raises(LookupError):
        render_visual_region(service, revision["id"], 0, [0, 0, 1, 1])


def test_full_page_image_stays_within_outbound_budget(service):
    revision = _quadrants(service, size=(1000, 1300))
    result = render_visual_region(service, revision["id"], 0, [0, 0, 1, 1])
    with _image(result) as image:
        assert max(image.size) <= MAX_IMAGE_SIDE
        assert image.width * image.height <= MAX_IMAGE_PIXELS
        assert min(image.size) > 1000


def test_repeated_crop_reuses_pixels_but_rechecks_source_and_does_not_share_mutable_metadata(service, monkeypatch):
    import reader_service.visual_region as visual
    revision = _quadrants(service)
    first = render_visual_region(service, revision['id'], 0, [.1, .1, .4, .4])
    def unexpected(*args):
        raise AssertionError('same immutable crop should not render again')
    monkeypatch.setattr(visual, '_render_region', unexpected)
    first['rect'][0] = .9
    second = render_visual_region(service, revision['id'], 0, [.1, .1, .4, .4])
    assert second['rect'][0] == .1
    with service.database.connect() as c:
        c.execute("UPDATE book_source_revisions SET status='SUPERSEDED' WHERE id=?", (revision['id'],))
    with pytest.raises(LookupError):
        render_visual_region(service, revision['id'], 0, [.1, .1, .4, .4])


def test_oversized_legacy_page_is_rejected_before_render(service, monkeypatch):
    import pypdfium2 as pdfium

    revision = _quadrants(service)

    class HugePage:
        def get_size(self): return 100000, 100000
        def close(self): pass
        def render(self, **kwargs): raise AssertionError("must not allocate bitmap")

    class Document:
        def __init__(self, path): pass
        def __len__(self): return 1
        def __getitem__(self, index): return HugePage()
        def close(self): pass

    monkeypatch.setattr(pdfium, "PdfDocument", Document)
    with pytest.raises(ValueError, match="尺寸过大"):
        render_visual_region(service, revision["id"], 0, [0, 0, .1, .1])
