"""Exercise the real vendor handler with a small, isolated PDF.js package tree."""

from __future__ import annotations

import threading
from http.client import HTTPConnection

import pytest

from reader_service.server import ReaderServer, handler_factory


RESOURCE_FILES = {
    "wasm/jbig2.wasm": b"\x00asm\x01\x00\x00\x00jbig2-6.3.289",
    "wasm/jbig2_nowasm_fallback.js": b"export default 'jbig2-fallback-6.3.289';",
    "wasm/openjpeg.wasm": b"\x00asm\x01\x00\x00\x00openjpeg-6.3.289",
    "wasm/openjpeg_nowasm_fallback.js": b"export default 'openjpeg-fallback-6.3.289';",
    "wasm/qcms_bg.wasm": b"\x00asm\x01\x00\x00\x00qcms-6.3.289",
    "cmaps/Adobe-Japan1-UCS2.bcmap": b"cmap-6.3.289\x00\xff",
    "standard_fonts/FoxitSans.pfb": b"\x80\x01font-pfb-6.3.289",
    "standard_fonts/LiberationSans-Regular.ttf": b"\x00\x01\x00\x00font-ttf-6.3.289",
    "iccs/CGATS001Compat-v2-micro.icc": b"icc-6.3.289\x00\xff",
}


@pytest.fixture
def resource_server(service, tmp_path):
    project = tmp_path / "project"
    package = project / "node_modules" / "pdfjs-dist"
    for relative, body in RESOURCE_FILES.items():
        target = package / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    (package / "build").mkdir()
    (package / "build" / "pdf.mjs").write_bytes(b"export const version = '6.3.289';")
    (package / "build" / "pdf.worker.mjs").write_bytes(b"export const workerVersion = '6.3.289';")
    # These files really exist: rejecting a bad path must not rely on its absence.
    (package / "outside.wasm").write_bytes(b"private-parent-resource")
    (package / "wasm" / "nested").mkdir()
    (package / "wasm" / "nested" / "inside.wasm").write_bytes(b"private-nested-resource")
    (package / "wasm" / "blocked.txt").write_bytes(b"private-disallowed-extension")
    (package / "cmaps" / "wrong.wasm").write_bytes(b"private-wrong-resource-class")
    (package / "wasm" / "directory.wasm").mkdir()
    katex_font = project / "node_modules" / "katex" / "dist" / "fonts" / "KaTeX_Main-Regular.woff2"
    katex_font.parent.mkdir(parents=True)
    katex_font.write_bytes(b"existing-katex-font")

    server = ReaderServer(("127.0.0.1", 0), handler_factory(
        service, "resource-test-launch-token", project_root=project,
    ))
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()

    def request(target, headers=None):
        # HTTPConnection preserves raw ../ and backslashes for the handler to reject.
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        try:
            connection.request("GET", target, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.headers, response.read()
        finally:
            connection.close()

    try:
        yield package, request
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("relative", RESOURCE_FILES)
def test_pdfjs_auxiliary_resources_serve_exact_package_bytes(resource_server, relative):
    _package, request = resource_server
    status, headers, body = request("/vendor/pdfjs/" + relative)
    assert status == 200
    assert body == RESOURCE_FILES[relative]
    assert int(headers["Content-Length"]) == len(body)
    if relative.endswith(".wasm"):
        assert headers["Content-Type"] == "application/wasm"
    elif relative.endswith(".js"):
        assert headers["Content-Type"] == "text/javascript; charset=utf-8"
    else:
        assert headers["Content-Type"] and "text/html" not in headers["Content-Type"]


@pytest.mark.parametrize("target", [
    "/vendor/pdfjs/wasm/../outside.wasm",
    "/vendor/pdfjs/wasm/..\\outside.wasm",
    "/vendor/pdfjs/wasm/%2e%2e/outside.wasm",
    "/vendor/pdfjs/wasm/%2E%2E%2Foutside.wasm",
    "/vendor/pdfjs/wasm/%2e%2e%5coutside.wasm",
    "/vendor/pdfjs/wasm/%252e%252e%252foutside.wasm",
    "/vendor/pdfjs/wasm/nested/inside.wasm",
    "/vendor/pdfjs/wasm/nested\\inside.wasm",
    "/vendor/pdfjs/wasm/jbig2.wasm:secret",
    "/vendor/pdfjs/wasm/jbig2.wasm::$DATA",
    "/vendor/pdfjs/wasm/jbig2.wasm%3Asecret",
    "/vendor/pdfjs/wasm/%6abig2.wasm",
    "/vendor/pdfjs/wasm/jbig2.wasm%00.js",
    "/vendor/pdfjs/wasm/blocked.txt",
    "/vendor/pdfjs/cmaps/wrong.wasm",
    "/vendor/pdfjs/standard_fonts/jbig2.wasm",
    "/vendor/pdfjs/iccs/fallback.js",
    "/vendor/pdfjs/build/pdf.mjs",
    "/vendor/pdfjs/wasm/",
    "/vendor/pdfjs/wasm",
])
def test_pdfjs_resource_route_rejects_non_basename_or_wrong_kind(resource_server, target):
    _package, request = resource_server
    status, _headers, body = request(target)
    assert status == 404
    assert b"private-" not in body
    assert RESOURCE_FILES["wasm/jbig2.wasm"] not in body


@pytest.mark.parametrize("relative", ["wasm/missing.wasm", "wasm/directory.wasm"])
def test_pdfjs_missing_or_directory_resource_is_not_served(resource_server, relative):
    _package, request = resource_server
    status, _headers, body = request("/vendor/pdfjs/" + relative)
    assert status == 503
    assert b"Frontend dependency is unavailable" in body


def test_pdfjs_resource_symlink_cannot_escape_its_resource_directory(resource_server):
    package, request = resource_server
    link = package / "wasm" / "escape.wasm"
    try:
        link.symlink_to(package / "outside.wasm")
    except (OSError, NotImplementedError) as error:
        pytest.skip(f"This host cannot create a file symlink: {error}")
    status, _headers, body = request("/vendor/pdfjs/wasm/escape.wasm")
    assert status == 404
    assert b"private-parent-resource" not in body


@pytest.mark.parametrize("target,expected", [
    ("/vendor/pdf.mjs", b"export const version = '6.3.289';"),
    ("/vendor/pdf.worker.mjs", b"export const workerVersion = '6.3.289';"),
    ("/vendor/fonts/KaTeX_Main-Regular.woff2", b"existing-katex-font"),
])
def test_existing_vendor_routes_keep_their_anonymous_local_access(resource_server, target, expected):
    _package, request = resource_server
    status, headers, body = request(target)
    assert status == 200
    assert body == expected
    assert headers.get("Set-Cookie") is None
    if target.endswith(".mjs"):
        assert headers["Content-Type"] == "text/javascript; charset=utf-8"


@pytest.mark.parametrize("headers", [
    {"Host": "untrusted.example"},
    {"Origin": "https://untrusted.example"},
    {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_pdfjs_resources_preserve_the_local_host_origin_gate(resource_server, headers):
    _package, request = resource_server
    status, response_headers, body = request("/vendor/pdfjs/wasm/jbig2.wasm", headers)
    assert status == 403
    assert b"UNTRUSTED_LOCAL_ORIGIN" in body
    assert response_headers.get("Set-Cookie") is None
    assert RESOURCE_FILES["wasm/jbig2.wasm"] not in body
