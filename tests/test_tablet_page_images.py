from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
import json
from threading import Event, Lock

import pypdfium2 as pdfium
import pytest
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, BooleanObject, DictionaryObject, NameObject, RectangleObject, TextStringObject

from conftest import make_pdf
from reader_service.tablet_page_images import PageImageUnavailable, TabletPageImages
from reader_service.visual_region import PDFIUM_RENDER_LOCK
from test_tablet_lan import lan_get, lan_request_server
from test_tablet_pdf import _desktop_server
from test_visual_region import _quadrants


def _revision(service):
    body = make_pdf(((595.275, 841.89),))
    return service.intake(BytesIO(body), content_length=len(body), filename='page.pdf')['book']['active_revision']


@pytest.mark.parametrize('rotation,color', [(0, (255, 0, 0)), (90, (0, 0, 255)), (180, (255, 255, 0)), (270, (0, 255, 0))])
def test_page_images_keep_crop_rotation_source_pixels_and_exact_width(service, rotation, color):
    from PIL import Image
    revision = _quadrants(service, rotation=rotation, cropped=True, origin=(25, 40))
    source = service.pdf_path(revision['id'])
    original = source.read_bytes()
    result = TabletPageImages(service).render(revision['id'], 0, 257)
    assert not result.cache_hit and result.width == 257
    assert (result.pdf_width, result.pdf_height) == ((300, 400) if rotation % 180 == 0 else (400, 300))
    with Image.open(BytesIO(result.body)) as image:
        assert image.format == 'PNG' and image.size == (result.width, result.height)
        assert image.convert('RGB').getpixel((image.width // 4, image.height // 4)) == color
    assert source.read_bytes() == original
    with service.database.connect() as connection:
        assert connection.execute('SELECT COUNT(*) FROM ocr_pages').fetchone()[0] == 0


def test_disk_cache_keeps_metadata_without_reopening_pdf_and_repairs_corruption(service, monkeypatch):
    revision = _revision(service)
    images = TabletPageImages(service)
    first = images.render(revision['id'], 0, 513)
    original_document = pdfium.PdfDocument
    monkeypatch.setattr(pdfium, 'PdfDocument', lambda *_: pytest.fail('cache hit reopened PDF'))
    hit = TabletPageImages(service).render(revision['id'], 0, 513)
    assert hit.cache_hit and hit.body == first.body
    assert (hit.pdf_width, hit.pdf_height, hit.width, hit.height) == (first.pdf_width, first.pdf_height, first.width, first.height)
    monkeypatch.setattr(pdfium, 'PdfDocument', original_document)
    next(images._cache_root.glob('*/*.png')).write_bytes(b'incomplete PNG')
    repaired = images.render(revision['id'], 0, 513)
    assert not repaired.cache_hit and repaired.body == first.body


def test_same_page_concurrent_requests_build_only_once(service, monkeypatch):
    import reader_service.tablet_page_images as module
    revision = _revision(service)
    images = TabletPageImages(service)
    entered, release = Event(), Event()
    actual, calls = module._render_page, []
    def blocked(*args):
        calls.append(args)
        entered.set()
        assert release.wait(3)
        return actual(*args)
    monkeypatch.setattr(module, '_render_page', blocked)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(images.render, revision['id'], 0, 256) for _ in range(4)]
        assert entered.wait(3)
        release.set()
        results = [future.result(timeout=5) for future in futures]
    assert len(calls) == 1 and len({result.body for result in results}) == 1
    assert sum(not result.cache_hit for result in results) == 1


def test_different_page_sizes_build_at_most_two_at_once(service, monkeypatch):
    from PIL import Image
    import reader_service.tablet_page_images as module
    revision = _revision(service)
    images = TabletPageImages(service)
    entered, release, guard = Event(), Event(), Lock()
    active = peak = 0
    def blocked(_source, _page, width, _count):
        nonlocal active, peak
        with guard:
            active += 1
            peak = max(peak, active)
            if active == 2:
                entered.set()
        try:
            assert release.wait(3)
            return Image.new('RGB', (width, width), 'white'), 100., 100.
        finally:
            with guard:
                active -= 1
    monkeypatch.setattr(module, '_render_page', blocked)
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(images.render, revision['id'], 0, width) for width in range(128, 134)]
        assert entered.wait(3)
        release.set()
        assert all(future.result(timeout=5).body.startswith(b'\x89PNG') for future in futures)
    assert peak == 2


def test_png_encoding_releases_the_shared_pdfium_lock(service, monkeypatch):
    from PIL import Image
    revision = _revision(service)
    save = Image.Image.save
    def another_thread_can_render():
        acquired = PDFIUM_RENDER_LOCK.acquire(timeout=.3)
        if acquired:
            PDFIUM_RENDER_LOCK.release()
        return acquired
    def checked_save(image, *args, **kwargs):
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(another_thread_can_render).result(timeout=2)
        return save(image, *args, **kwargs)
    monkeypatch.setattr(Image.Image, 'save', checked_save)
    assert TabletPageImages(service).render(revision['id'], 0, 128).body.startswith(b'\x89PNG')


def test_render_budget_is_checked_before_allocating_bitmap(service, monkeypatch):
    revision = _revision(service)
    class Page:
        def get_size(self): return 400, 600
        def render(self, **_kwargs): pytest.fail('oversized bitmap was allocated')
        def close(self): pass
    class Document:
        def __init__(self, _): pass
        def get_formtype(self): return 0
        def __len__(self): return 1
        def __getitem__(self, _): return Page()
        def close(self): pass
    monkeypatch.setattr(pdfium, 'PdfDocument', Document)
    with pytest.raises(PageImageUnavailable, match='预算'):
        TabletPageImages(service).render(revision['id'], 0, 8192)


def test_cache_io_failure_does_not_lose_an_already_rendered_page(service, monkeypatch):
    import reader_service.tablet_page_images as module
    revision = _revision(service)
    def cannot_write(*_args): raise OSError('read-only cache')
    monkeypatch.setattr(module, '_atomic_write', cannot_write)
    result = TabletPageImages(service).render(revision['id'], 0, 128)
    assert result.body.startswith(b'\x89PNG\r\n\x1a\n') and result.width == 128


def test_cache_cleanup_is_bounded_and_does_not_remove_unrelated_files(service, tmp_path, monkeypatch):
    import reader_service.tablet_page_images as module
    revision = _revision(service)
    unrelated = tmp_path / 'keep.png'
    unrelated.write_bytes(b'user image')
    images = TabletPageImages(service)
    monkeypatch.setattr(module, '_CACHE_MAX_FILES', 1)
    images.render(revision['id'], 0, 128)
    current = images.render(revision['id'], 0, 256)
    assert len(list(images._cache_root.glob('*/*.png'))) == 1
    monkeypatch.setattr(module, '_CACHE_MAX_BYTES', 1)
    returned = images.render(revision['id'], 0, 257)
    assert not list(images._cache_root.glob('*/*.png'))
    assert returned.body.startswith(b'\x89PNG') and current.body.startswith(b'\x89PNG')
    assert unrelated.read_bytes() == b'user image'


def test_invalid_requests_and_unknown_revision_keep_distinct_errors(service, monkeypatch):
    revision = _revision(service)
    images = TabletPageImages(service)
    for page, width in [(-1, 128), (True, 128), (1, 128), (0, 127), (0, 8193), (0, True), (0, 128.5)]:
        with pytest.raises(ValueError) as error:
            images.render(revision['id'], page, width)
        assert not isinstance(error.value, PageImageUnavailable)
    with pytest.raises(LookupError):
        images.render('00000000-0000-0000-0000-000000000000', 0, 128)
    def unreadable(*_args): raise pdfium.PdfiumError('cannot render PDF')
    monkeypatch.setattr(pdfium, 'PdfDocument', unreadable)
    with pytest.raises(PageImageUnavailable):
        images.render(revision['id'], 0, 128)


def test_real_acroform_uses_pdfjs_fallback_without_initializing_forms(service, monkeypatch):
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=600)
    widget = writer._add_object(DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Widget'),
        NameObject('/FT'): NameObject('/Tx'), NameObject('/T'): TextStringObject('student'),
        NameObject('/V'): TextStringObject('Stored form value'),
        NameObject('/Rect'): RectangleObject([40, 400, 300, 440]),
        NameObject('/P'): page.indirect_reference,
    }))
    page[NameObject('/Annots')] = ArrayObject([widget])
    writer.root_object[NameObject('/AcroForm')] = writer._add_object(DictionaryObject({
        NameObject('/Fields'): ArrayObject([widget]), NameObject('/NeedAppearances'): BooleanObject(True),
    }))
    output = BytesIO()
    writer.write(output)
    data = output.getvalue()
    revision = service.intake(BytesIO(data), content_length=len(data), filename='acroform.pdf')['book']['active_revision']
    def must_not_run(*_args, **_kwargs): pytest.fail('forms were initialized or rendered')
    monkeypatch.setattr(pdfium.PdfDocument, 'init_forms', must_not_run)
    monkeypatch.setattr(pdfium.PdfPage, 'render', must_not_run)
    with pytest.raises(PageImageUnavailable, match='表单'):
        TabletPageImages(service).render(revision['id'], 0, 257)


def test_http_page_images_require_auth_on_cold_and_warm_cache_and_report_geometry(service):
    from PIL import Image
    revision = _quadrants(service, rotation=90, cropped=True, origin=(25, 40))
    endpoint = f'/api/revisions/{revision["id"]}/page-image'
    auth = {'X-Reader-Token': 'test-tablet-token'}
    with lan_request_server(service) as (port, host):
        assert lan_get(port, host, endpoint + '?page=0&width=257')[0] == 401
        status, headers, body = lan_get(port, host, endpoint + '?page=0&width=257', auth)
        assert status == 200 and headers['Content-Type'] == 'image/png'
        assert headers['Content-Length'] == str(len(body))
        assert headers['Cache-Control'] == 'no-store'
        assert headers['X-Reader-Image-Cache'] == 'miss'
        assert float(headers['X-Reader-Page-Width']) == 400
        assert float(headers['X-Reader-Page-Height']) == 300
        assert int(headers['X-Reader-Image-Width']) == 257
        assert headers['Server-Timing'].startswith('page-image;dur=')
        with Image.open(BytesIO(body)) as image:
            assert image.format == 'PNG' and image.width == 257
            assert image.height == int(headers['X-Reader-Image-Height'])
            assert image.convert('RGB').getpixel((image.width // 4, image.height // 4)) == (0, 0, 255)
        status, warm_headers, warm_body = lan_get(port, host, endpoint + '?page=0&width=257', auth)
        assert status == 200 and warm_headers['X-Reader-Image-Cache'] == 'hit'
        assert warm_body == body
        assert lan_get(port, host, endpoint + '?page=0&width=257')[0] == 401
        assert lan_get(port, host, endpoint + '?page=0&width=127', auth)[0] == 400
        assert lan_get(port, host, endpoint + '?page=1&width=257', auth)[0] == 400
        status, _, error = lan_get(port, host, endpoint + '?page=0&width=8192', auth)
        assert status == 422 and json.loads(error)['code'] == 'TABLET_PAGE_IMAGE_UNSUPPORTED'
        assert lan_get(port, host, '/api/revisions/00000000-0000-0000-0000-000000000000/page-image?page=0&width=257', auth)[0] == 404


def test_http_page_image_route_is_unavailable_on_desktop_even_with_valid_token(service):
    revision = _revision(service)
    with _desktop_server(service) as port:
        status, _, _ = lan_get(port, f'127.0.0.1:{port}', f'/api/revisions/{revision["id"]}/page-image?page=0&width=257', {'X-Reader-Token': 'desktop-test-token'})
        assert status == 404
