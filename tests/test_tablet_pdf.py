from __future__ import annotations

import hashlib
import threading
from contextlib import closing, contextmanager
from http.client import HTTPConnection
from io import BytesIO

import pypdfium2 as pdfium
import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, IndirectObject, NameObject, NumberObject, RectangleObject, TextStringObject

from conftest import make_pdf
from reader_service.server import ReaderServer, handler_factory
from reader_service.tablet_pdf import TabletPdfIndex, build_page_index
from test_tablet_lan import lan_get, lan_request_server


def _inherited_pdf(*, incremental=False):
    writer = PdfWriter()
    pages = [writer.add_blank_page(width=400, height=600) for _ in range(3)]
    font = writer._add_object(DictionaryObject({
        NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
        NameObject('/BaseFont'): NameObject('/Helvetica'),
    }))
    parent = writer.root_object['/Pages']
    parent.update({
        NameObject('/Resources'): DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})}),
        NameObject('/MediaBox'): RectangleObject([0, 0, 400, 600]),
        NameObject('/CropBox'): RectangleObject([40, 80, 360, 520]),
        NameObject('/Rotate'): NumberObject(90),
    })
    stream = DecodedStreamObject()
    stream.set_data(b'0.2 0.7 0.3 rg 40 80 160 220 re f\nBT /F1 18 Tf 70 140 Td (Tablet source) Tj ET\n')
    contents = writer._add_object(stream)
    for page in pages:
        for key in ('/Resources', '/MediaBox', '/CropBox', '/Rotate'):
            page.pop(key, None)
        page[NameObject('/Contents')] = contents
    pages[1][NameObject('/Rotate')] = NumberObject(180)
    link = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Link'),
        NameObject('/Rect'): RectangleObject([50, 100, 200, 140]),
        NameObject('/Dest'): ArrayObject([pages[1].indirect_reference, NameObject('/Fit')]),
    })
    pages[0][NameObject('/Annots')] = ArrayObject([writer._add_object(link)])
    writer.add_outline_item('Second page', 1)
    output = BytesIO()
    writer.write(output)
    if incremental:
        writer = PdfWriter(PdfReader(BytesIO(output.getvalue())), incremental=True)
        writer.add_metadata({'/Subject': 'Existing incremental xref stream'})
        output = BytesIO()
        writer.write(output)
        assert b'/Type /XRef' in output.getvalue()
    # Exercise an original EOF without a trailing newline.
    return output.getvalue().rstrip(b'\r\n')


def _reference(value):
    return value.idnum, value.generation


def _serialized(value):
    output = BytesIO()
    value.write_to_stream(output)
    return output.getvalue()


def _pixel_hashes(data):
    with closing(pdfium.PdfDocument(data)) as document:
        hashes = []
        for index in range(len(document)):
            with closing(document[index]) as page, closing(page.render(scale=.4)) as bitmap:
                hashes.append((page.get_size(), hashlib.sha256(bitmap.to_numpy().tobytes()).hexdigest()))
        return hashes


@pytest.mark.parametrize('incremental', [False, True])
def test_compact_index_preserves_inheritance_page_identity_and_pixels(tmp_path, incremental):
    original = _inherited_pdf(incremental=incremental)
    source = tmp_path / 'source.pdf'
    source.write_bytes(original)
    tail = build_page_index(source)
    assert isinstance(tail, bytes) and tail
    assert source.read_bytes() == original
    combined = original + tail
    before, after = PdfReader(BytesIO(original), strict=True), PdfReader(BytesIO(combined), strict=True)
    assert len(after.pages) == len(before.pages) == 3
    assert after.trailer['/Prev'] == before._startxref
    assert _reference(after.root_object.raw_get('/Pages')) == _reference(before.root_object.raw_get('/Pages'))
    assert _reference(after.root_object.raw_get('/Outlines')) == _reference(before.root_object.raw_get('/Outlines'))
    raw_before, raw_after = PdfReader(BytesIO(original), strict=True), PdfReader(BytesIO(combined), strict=True)
    for one, two in zip(before.pages, after.pages, strict=True):
        number, generation = _reference(one.indirect_reference)
        raw_page = raw_before.get_object(IndirectObject(number, generation, raw_before))
        compact_page = raw_after.get_object(IndirectObject(number, generation, raw_after))
        # Enumerating .pages above flattens the effective values in those reader
        # caches. Fresh readers prove the compact copy kept the raw dictionaries.
        if not incremental:
            assert '/MediaBox' not in raw_page and '/Resources' not in raw_page
        assert _serialized(compact_page) == _serialized(raw_page)
        assert _reference(two.indirect_reference) == _reference(one.indirect_reference)
        assert _reference(two.raw_get('/Parent')) == _reference(one.raw_get('/Parent'))
        assert _reference(two.raw_get('/Contents')) == _reference(one.raw_get('/Contents'))
        assert list(two.mediabox) == list(one.mediabox)
        assert list(two.cropbox) == list(one.cropbox)
        assert two.rotation == one.rotation
        assert two['/Resources']['/Font']['/F1']['/BaseFont'] == '/Helvetica'
    assert _reference(after.pages[0]['/Annots'][0].get_object()['/Dest'][0]) == _reference(before.pages[1].indirect_reference)
    assert _pixel_hashes(combined) == _pixel_hashes(original)


def test_owner_encrypted_pdf_is_source_only(tmp_path, service):
    writer = PdfWriter()
    writer.add_blank_page(width=400, height=600)
    writer.encrypt(user_password='', owner_password='owner-password')
    output = BytesIO()
    writer.write(output)
    source = tmp_path / 'owner-encrypted.pdf'
    source.write_bytes(output.getvalue())
    assert PdfReader(source).decrypt('')
    assert build_page_index(source) is None
    assert source.read_bytes() == output.getvalue()
    data = output.getvalue()
    revision = service.intake(BytesIO(data), content_length=len(data), filename='owner-encrypted.pdf')['book']['active_revision']
    with lan_request_server(service) as (port, host):
        status, headers, body = lan_get(port, host, f'/api/revisions/{revision["id"]}/pdf?tablet=1', {'X-Reader-Token': 'test-tablet-token'})
        assert status == 200 and headers['X-Reader-PDF-View'] == 'source'
        assert body == data


def _linearization_marker_pdf(kind):
    # These fixtures exercise the header's semantic guard, not a complete
    # linearization implementation or its hint tables.
    writer = PdfWriter()
    page = writer.add_blank_page(width=400, height=600)
    first = writer._objects[0]
    target = page if kind == 'later-object' else first
    value = NumberObject(1)
    if kind == 'zero':
        value = NumberObject(0)
    elif kind == 'string':
        value = TextStringObject('1')
    elif kind == 'indirect':
        value = writer._add_object(NumberObject(1))
    elif kind == 'float':
        value = FloatObject(1.0)
    if kind == 'body-text':
        contents = DecodedStreamObject()
        contents.set_data(b'BT (/Linearized 1 /L 123) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(contents)
    else:
        target[NameObject('/Linearized')] = value
    target[NameObject('/L')] = NumberObject(0)
    for _ in range(8):
        output = BytesIO()
        writer.write(output)
        data = output.getvalue()
        if target['/L'] == len(data):
            break
        target[NameObject('/L')] = NumberObject(len(data))
    else:
        pytest.fail('Fixture size did not stabilize')
    if kind == 'wrong-length':
        target[NameObject('/L')] = NumberObject(len(data) - 1)
        output = BytesIO()
        writer.write(output)
        data = output.getvalue()
    return data


@pytest.mark.parametrize('kind,source_only', [
    ('positive', True), ('float', True), ('zero', False), ('string', False),
    ('indirect', False), ('wrong-length', False), ('later-object', False), ('body-text', False),
])
def test_only_direct_positive_first_object_linearization_with_matching_length_is_skipped(tmp_path, kind, source_only):
    data = _linearization_marker_pdf(kind)
    source = tmp_path / 'header.pdf'
    source.write_bytes(data)
    assert (build_page_index(source) is None) is source_only
    assert source.read_bytes() == data


def test_linearization_guard_also_bypasses_a_preexisting_tail_cache(service):
    data = _linearization_marker_pdf('positive')
    revision = service.intake(BytesIO(data), content_length=len(data), filename='header.pdf')['book']['active_revision']
    cache = service.paths.resolve(f'tmp/tablet-pdf-index-v1/{revision["blob_sha256"]}.tail')
    cache.parent.mkdir(parents=True)
    cache.write_bytes(b'preexisting tail from before the header guard')
    index = TabletPdfIndex(service)
    assert index.tail_for(revision['id']) is None
    assert index.tail_for(revision['id']) is None
    assert service.pdf_path(revision['id']).read_bytes() == data


def test_index_is_built_once_and_reused_from_cache(service, monkeypatch):
    data = make_pdf(((400, 600), (400, 600)))
    revision = service.intake(BytesIO(data), content_length=len(data), filename='cache.pdf')['book']['active_revision']
    import reader_service.tablet_pdf as module
    real_builder, calls = module.build_page_index, []
    def counted(source):
        calls.append(source)
        return real_builder(source)
    monkeypatch.setattr(module, 'build_page_index', counted)
    index = TabletPdfIndex(service)
    tail = index.tail_for(revision['id'])
    assert tail and tail.is_file()
    assert index.tail_for(revision['id']) == tail
    assert TabletPdfIndex(service).tail_for(revision['id']) == tail
    assert len(calls) == 1
    assert service.pdf_path(revision['id']).read_bytes() == data


def test_failed_index_does_not_switch_representation_later(service, monkeypatch):
    data = make_pdf()
    revision = service.intake(BytesIO(data), content_length=len(data), filename='fallback.pdf')['book']['active_revision']
    import reader_service.tablet_pdf as module
    calls = []
    def unavailable(source):
        calls.append(source)
        raise OSError('temporary cache problem')
    monkeypatch.setattr(module, 'build_page_index', unavailable)
    index = TabletPdfIndex(service)
    assert index.tail_for(revision['id']) is None
    monkeypatch.setattr(module, 'build_page_index', lambda _: pytest.fail('source-only decision changed'))
    assert index.tail_for(revision['id']) is None
    assert len(calls) == 1


@contextmanager
def _desktop_server(service):
    server = ReaderServer(('127.0.0.1', 0), handler_factory(service, 'desktop-test-token'))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_compact_ranges_cross_source_tail_and_keep_auth_and_desktop_boundaries(service):
    original = _inherited_pdf()
    revision = service.intake(BytesIO(original), content_length=len(original), filename='ranges.pdf')['book']['active_revision']
    endpoint = f'/api/revisions/{revision["id"]}/pdf'
    auth = {'X-Reader-Token': 'test-tablet-token'}
    with lan_request_server(service) as (port, host):
        assert lan_get(port, host, endpoint + '?tablet=1')[0] == 401
        status, headers, compact = lan_get(port, host, endpoint + '?tablet=1', auth)
        assert status == 200 and headers['X-Reader-PDF-View'] == 'compact'
        assert compact.startswith(original) and len(compact) > len(original)
        assert headers['Content-Length'] == str(len(compact))
        assert headers['Cache-Control'] == 'no-store'
        for start, end in [(0, 15), (len(original) - 12, len(original) + 19), (len(original), len(original) + 31)]:
            status, headers, body = lan_get(port, host, endpoint + '?tablet=1', {**auth, 'Range': f'bytes={start}-{end}'})
            assert status == 206 and body == compact[start:end + 1]
            assert headers['Content-Range'] == f'bytes {start}-{end}/{len(compact)}'
        status, headers, body = lan_get(port, host, endpoint + '?tablet=1', {**auth, 'Range': 'bytes=-48'})
        assert status == 206 and body == compact[-48:]
        assert headers['Content-Range'] == f'bytes {len(compact) - 48}-{len(compact) - 1}/{len(compact)}'
        assert lan_get(port, host, endpoint + '?tablet=1', {**auth, 'Range': f'bytes={len(compact)}-'})[0] == 416
        assert lan_get(port, host, endpoint + '?tablet=1')[0] == 401
        assert lan_get(port, host, endpoint, auth)[2] == original
    with _desktop_server(service) as port:
        connection = HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            connection.request('GET', endpoint + '?tablet=1', headers={'X-Reader-Token': 'desktop-test-token'})
            response = connection.getresponse()
            assert response.status == 200 and response.read() == original
            assert response.getheader('X-Reader-PDF-View') != 'compact'
        finally:
            connection.close()
