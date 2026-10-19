from __future__ import annotations

import gzip
import json
import threading
from contextlib import contextmanager

from reader_service.server import ReaderServer, handler_factory
from reader_service.tablet_assets import asset_response
from test_tablet_lan import lan_get


@contextmanager
def _asset_server(service, project_root, *, tablet=True):
    class PrivatePeerServer(ReaderServer):
        def get_request(self):
            request, address = super().get_request()
            return request, ('192.168.43.22', address[1])
    server_type = PrivatePeerServer if tablet else ReaderServer
    server = server_type(('127.0.0.1', 0), handler_factory(service, 'asset-test-token', project_root=project_root, tablet_lan=tablet))
    port = server.server_port
    host = f'{"192.168.43.65" if tablet else "127.0.0.1"}:{port}'
    if tablet:
        server.server_address = ('192.168.43.65', port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port, host
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _asset_project(tmp_path):
    project = tmp_path / 'frontend'
    build = project / 'node_modules/pdfjs-dist/build'
    build.mkdir(parents=True)
    module = build / 'pdf.mjs'
    module.write_bytes(b'export const reader = "Paper Reader";\n' * 100)
    wasm = project / 'node_modules/pdfjs-dist/wasm/probe.wasm'
    wasm.parent.mkdir()
    wasm.write_bytes(b'\x00asm\x01\x00\x00\x00' + b'\x00' * 2048)
    return project, module


def test_asset_variants_respect_gzip_q_zero_and_revalidate_edits(tmp_path):
    source = tmp_path / 'module.js'
    original = b'const paper = "Reader";\n' * 200
    source.write_bytes(original)
    raw, raw_etag, compressed = asset_response(source, 'identity, gzip;q=0')
    assert raw == original and not compressed
    zipped, zipped_etag, compressed = asset_response(source, 'br, gzip;q=0.8')
    assert compressed and gzip.decompress(zipped) == original
    assert zipped_etag != raw_etag
    assert asset_response(source, 'identity') == (raw, raw_etag, False)
    source.write_bytes(original + b'// edited\n')
    updated, updated_etag, _ = asset_response(source, 'gzip')
    assert updated_etag != zipped_etag
    assert gzip.decompress(updated) == original + b'// edited\n'


def test_lan_js_css_wasm_gzip_etag_and_edit_revalidation(service, tmp_path):
    project, module = _asset_project(tmp_path)
    with _asset_server(service, project) as (port, host):
        for endpoint in ('/vendor/pdf.mjs', '/styles.css', '/vendor/pdfjs/wasm/probe.wasm'):
            status, raw_headers, raw = lan_get(port, host, endpoint, {'Accept-Encoding': 'identity'})
            assert status == 200 and raw_headers['Cache-Control'] == 'private, no-cache'
            assert 'Content-Encoding' not in raw_headers
            status, headers, zipped = lan_get(port, host, endpoint, {'Accept-Encoding': 'gzip'})
            assert status == 200 and headers['Content-Encoding'] == 'gzip'
            assert gzip.decompress(zipped) == raw
            assert headers['Content-Length'] == str(len(zipped))
            assert headers['Vary'] == 'Accept-Encoding'
            assert headers['ETag'] != raw_headers['ETag']
            status, cached_headers, body = lan_get(port, host, endpoint, {'Accept-Encoding': 'gzip', 'If-None-Match': headers['ETag']})
            assert status == 304 and body == b''
            assert cached_headers['Cache-Control'] == 'private, no-cache'
            assert cached_headers['ETag'] == headers['ETag']
        status, before, _ = lan_get(port, host, '/vendor/pdf.mjs', {'Accept-Encoding': 'gzip'})
        module.write_bytes(module.read_bytes() + b'// new asset version\n')
        status, after, body = lan_get(port, host, '/vendor/pdf.mjs', {'Accept-Encoding': 'gzip', 'If-None-Match': before['ETag']})
        assert status == 200 and after['ETag'] != before['ETag']
        assert gzip.decompress(body) == module.read_bytes()
        status, headers, body = lan_get(port, host, '/vendor/pdf.mjs', {'Accept-Encoding': 'gzip;q=0'})
        assert status == 200 and 'Content-Encoding' not in headers and body == module.read_bytes()


def test_html_and_api_remain_uncached_and_unauthenticated_data_is_rejected(service, tmp_path):
    project, _ = _asset_project(tmp_path)
    with _asset_server(service, project) as (port, host):
        status, headers, _ = lan_get(port, host, '/?tablet=1&token=asset-test-token', {'Accept-Encoding': 'gzip'})
        assert status == 200 and 'HttpOnly' in headers['Set-Cookie']
        assert headers['Cache-Control'] == 'no-store'
        assert 'ETag' not in headers and 'Content-Encoding' not in headers
        request_headers = {'X-Reader-Token': 'asset-test-token', 'Accept-Encoding': 'gzip', 'If-None-Match': '*'}
        status, headers, body = lan_get(port, host, '/api/books', request_headers)
        assert status == 200 and json.loads(body) == {'books': []}
        assert headers['Cache-Control'] == 'no-store'
        assert 'ETag' not in headers and 'Content-Encoding' not in headers
        assert lan_get(port, host, '/api/books', {'Accept-Encoding': 'gzip'})[0] == 401


def test_desktop_assets_keep_original_no_store_response(service, tmp_path):
    project, module = _asset_project(tmp_path)
    with _asset_server(service, project, tablet=False) as (port, host):
        status, headers, body = lan_get(port, host, '/vendor/pdf.mjs', {'Accept-Encoding': 'gzip', 'If-None-Match': '*'})
        assert status == 200 and body == module.read_bytes()
        assert headers['Cache-Control'] == 'no-store'
        assert 'ETag' not in headers and 'Content-Encoding' not in headers
