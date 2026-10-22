from __future__ import annotations

from contextlib import contextmanager
from http.client import HTTPConnection
from io import BytesIO
import json
import math
from pathlib import Path
import threading
from urllib.parse import urlparse, parse_qs
from uuid import uuid4

from PIL import Image
import pytest

from conftest import make_pdf
from reader_service.android_local import AndroidDocuments, android_providers, create_reader
from reader_service.agent_runtime import ProviderFailure
from reader_service.foundation.contracts import PagePreparationError
from reader_service.ink import InkService
from reader_service.storage import ManagedPaths
from reader_service.visual_region import render_visual_region


class Documents:
    calls = []
    line = {"quad": [[.1, .1], [.6, .1], [.6, .2], [.1, .2]], "text": "测试教材",
            "confidence": .99, "cells": [[.1, .2, 0, 1], [.2, .3, 1, 2], [.3, .4, 2, 3], [.4, .6, 3, 4]]}

    @classmethod
    def renderPage(cls, path, page, width, output):
        assert Path(path).is_file()
        height = math.ceil(200 * width / 100)
        Image.new("RGB", (width, height), "white").save(output, "PNG")
        cls.calls.append(("render", path, page, width))
        return json.dumps({"pdf_width": 100, "pdf_height": 200, "width": width, "height": height, "visible": True})

    @classmethod
    def extractPage(cls, path, page, dpi):
        cls.calls.append(("extract", path, page, dpi))
        return json.dumps({"route": "OCR", "engine_profile": "mlkit-test:v1", "lines": [cls.line], "visible": True})

    @staticmethod
    def cropPage(path, page, rect, width, output):
        Image.new("RGB", (300, 200), "blue").save(output, "PNG")
        return json.dumps({"width": 300, "height": 200})


class Credentials:
    online = False
    keys = {}

    @classmethod
    def isOnline(cls):
        return cls.online

    @classmethod
    def read(cls, provider):
        return cls.keys.get(provider)


@contextmanager
def reader_server(tmp_path):
    reader = create_reader(tmp_path / "private-app-data", Path(__file__).resolve().parents[1], Documents, Credentials, port=0)
    reader.run()
    try:
        yield reader
    finally:
        reader.stop()


def request(reader, method, path, *, body=None, headers=None, authenticated=True):
    port = reader.server.server_port
    token = parse_qs(urlparse(reader.url).query)["token"][0]
    headers = dict(headers or {})
    if authenticated:
        headers.setdefault("X-Reader-Token", token)
    connection = HTTPConnection("127.0.0.1", port, timeout=4)
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, dict(response.headers), response.read()
    finally:
        connection.close()


def intake(reader):
    body = make_pdf(((100, 200),))
    return reader.library.intake(BytesIO(body), content_length=len(body), filename="local-book.pdf")["book"]["active_revision"]


def test_full_core_boots_on_loopback_offline_and_preserves_authorization(tmp_path):
    with reader_server(tmp_path) as reader:
        parsed = urlparse(reader.url)
        assert parsed.hostname == "127.0.0.1" and parse_qs(parsed.query)["local"] == ["1"]
        assert request(reader, "GET", "/api/books", authenticated=False)[0] == 401
        assert request(reader, "GET", "/api/books")[0] == 200
        assert request(reader, "GET", "/api/books", headers={"Origin": "http://untrusted.example"})[0] == 403
        assert request(reader, "GET", "/api/books", headers={"Host": f"192.168.1.4:{reader.server.server_port}"})[0] == 403
        status, headers, _ = request(reader, "GET", parsed.path + "?" + parsed.query, authenticated=False)
        assert status == 200 and "HttpOnly" in headers["Set-Cookie"]
        assert request(reader, "GET", "/tablet-pen-check.html")[0] == 200
        assert request(reader, "GET", "/tablet-app.apk")[0] == 404
        assert request(reader, "GET", "/tablet-library.grlibrary")[0] == 404


def test_page_images_foundation_search_and_visuals_use_native_adapters(tmp_path, monkeypatch):
    def no_pdfium():
        pytest.fail("Android initialized desktop PDFium")
    monkeypatch.setattr("reader_service.tablet_page_images._load_pdfium", no_pdfium)
    with reader_server(tmp_path) as reader:
        revision = intake(reader)
        rid = revision["id"]
        assert reader.foundation.prepare_page(rid, 0) == "READY"
        overlay = reader.foundation.overlay(rid, 0)
        assert overlay["lines"][0]["text"] == "测试教材"
        assert overlay["lines"][0]["cells"][0] == [.1, .2, 0, 1]
        assert reader.foundation.search(rid, "教材")["results"][0]["pdf_page_index"] == 0
        status, headers, body = request(reader, "GET", f"/api/revisions/{rid}/page-image?page=0&width=256")
        assert status == 200 and body.startswith(b"\x89PNG")
        with Image.open(BytesIO(body)) as page:
            assert page.size == (256, 512)
        crop = render_visual_region(reader.library, rid, 0, [.1, .1, .4, .4])
        assert crop["image"]["width"] == 300 and crop["source_sha256"] == revision["blob_sha256"]
        assert not list(reader.documents.temporary.glob("*.png"))


def test_local_ink_position_and_text_survive_core_restart_without_a_network(tmp_path):
    data = tmp_path / "persistent-app-data"
    reader = create_reader(data, Path(__file__).resolve().parents[1], Documents, Credentials, port=0)
    reader.run()
    revision = intake(reader)
    rid = revision["id"]
    stroke_id = str(uuid4())
    try:
        assert reader.foundation.prepare_page(rid, 0) == "READY"
        payload = {"operation_id": str(uuid4()), "action": "put", "stroke_id": stroke_id,
                   "stroke": {"page_index": 0, "color": "#f04452", "width": .0025,
                              "coordinate_version": 1, "points": [[.1, .2, .5], [.4, .5, .5]]}}
        status, _, _ = request(reader, "POST", f"/api/revisions/{rid}/ink", body=json.dumps(payload), headers={"Content-Type": "application/json"})
        assert status == 200
        reader.library.save_position(rid, 0, .3, 1.2)
    finally:
        reader.stop()
    reopened = create_reader(data, Path(__file__).resolve().parents[1], Documents, Credentials, port=0)
    try:
        assert reopened.foundation.overlay(rid, 0)["lines"][0]["text"] == "测试教材"
        assert InkService(reopened.library.paths).list_strokes(rid, 0)["strokes"][0]["id"] == stroke_id
        assert reopened.library.list_books()[0]["active_revision"]["position"]["zoom"] == 1.2
    finally:
        reopened.stop()


def test_offline_and_disallowed_provider_never_reach_network(monkeypatch):
    credentials = type("Offline", (), {"isOnline": staticmethod(lambda: False), "read": staticmethod(lambda _: pytest.fail("read key while offline"))})
    runtime = android_providers(credentials)
    for provider in ("deepseek", "zhipu"):
        assert runtime.runtimes[provider].status()["ai_off_reason"] == "OFFLINE"
        with pytest.raises(ProviderFailure) as error:
            runtime.complete_for(provider, [{"role": "user", "content": "test"}])
        assert error.value.code == "offline"
    assert runtime.runtimes["openrouter"].status()["ai_off_reason"] == "PROVIDER_DISABLED"
    with pytest.raises(ProviderFailure) as error:
        runtime.complete_for("openrouter", [{"role": "user", "content": "test"}])
    assert error.value.code == "provider_disabled"


def test_online_keys_only_cross_native_to_python_boundary_without_status_leak():
    credentials = type("Online", (), {"isOnline": staticmethod(lambda: True), "read": staticmethod(lambda p: "fake-private-key" if p == "zhipu" else None)})
    runtime = android_providers(credentials)
    assert runtime.configured_providers() == ("zhipu",)
    assert runtime.preferred_provider() == "zhipu"
    assert "fake-private-key" not in json.dumps(runtime.status())


def test_native_failure_and_invalid_geometry_are_not_published(tmp_path):
    paths = ManagedPaths(tmp_path / "data")
    paths.initialize()
    class Broken(Documents):
        @classmethod
        def extractPage(cls, *_):
            raise RuntimeError("OCR_EMPTY_ON_NONBLANK_PAGE")
    documents = AndroidDocuments(paths, Broken)
    with pytest.raises(PagePreparationError) as error:
        documents.extract(Path("sample.pdf"), 0, 200)
    assert error.value.code == "OCR_EMPTY_ON_NONBLANK_PAGE"
    invalid = {**Documents.line, "cells": [[.2, .1, 0, 1]]}
    with pytest.raises(ValueError, match="geometry"):
        documents._line(invalid)


def test_stopping_core_waits_for_current_native_ocr_before_library_can_be_swapped(tmp_path, monkeypatch):
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()
    original = Documents.extractPage
    def slow_extract(*args):
        entered.set()
        assert release.wait(4)
        return original(*args)
    monkeypatch.setattr(Documents, "extractPage", slow_extract)
    reader = create_reader(tmp_path / "app", Path(__file__).resolve().parents[1], Documents, Credentials, port=0)
    reader.run()
    revision = intake(reader)
    reader.preparation.schedule_revision(revision["id"])
    assert entered.wait(3)
    closer = threading.Thread(target=lambda: (reader.stop(), stopped.set()))
    closer.start()
    try:
        assert not stopped.wait(.3)
    finally:
        release.set()
        closer.join(timeout=4)
    assert stopped.is_set()
    assert reader.foundation.overlay(revision["id"], 0)["status"] == "READY"
