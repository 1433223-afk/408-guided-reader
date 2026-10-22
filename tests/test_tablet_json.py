from __future__ import annotations

import gzip
import json

from test_tablet_assets import _asset_server
from test_tablet_lan import lan_get


def _large_books(service, monkeypatch):
    books = [{"id": "book-fixture", "title": "教材文字与已保存学习记录。" * 1200}]
    monkeypatch.setattr(service, "list_books", lambda: books)
    return {"books": books}


def test_tablet_large_get_json_negotiates_gzip_with_exact_payload_and_length(service, tmp_path, monkeypatch):
    expected = _large_books(service, monkeypatch)
    with _asset_server(service, tmp_path) as (port, host):
        status, headers, body = lan_get(port, host, "/api/books", {
            "X-Reader-Token": "asset-test-token", "Accept-Encoding": "br, gzip;q=0.8",
        })
    assert status == 200 and headers["Content-Encoding"] == "gzip"
    assert headers["Content-Length"] == str(len(body))
    assert headers["Vary"] == "Accept-Encoding" and headers["Cache-Control"] == "no-store"
    assert json.loads(gzip.decompress(body)) == expected
    assert len(body) < len(json.dumps(expected, ensure_ascii=False).encode()) // 5


def test_tablet_json_without_gzip_or_with_q_zero_keeps_original_bytes(service, tmp_path, monkeypatch):
    expected = _large_books(service, monkeypatch)
    raw = json.dumps(expected, ensure_ascii=False).encode("utf-8")
    with _asset_server(service, tmp_path) as (port, host):
        for encoding in (None, "identity", "gzip;q=0"):
            request = {"X-Reader-Token": "asset-test-token"}
            if encoding is not None:
                request["Accept-Encoding"] = encoding
            status, headers, body = lan_get(port, host, "/api/books", request)
            assert status == 200 and body == raw
            assert "Content-Encoding" not in headers
            assert headers["Content-Length"] == str(len(raw))
            assert headers["Vary"] == "Accept-Encoding"


def test_desktop_json_stays_uncompressed_and_tablet_auth_is_still_required(service, tmp_path, monkeypatch):
    expected = _large_books(service, monkeypatch)
    raw = json.dumps(expected, ensure_ascii=False).encode("utf-8")
    with _asset_server(service, tmp_path, tablet=False) as (port, host):
        status, headers, body = lan_get(port, host, "/api/books", {
            "X-Reader-Token": "asset-test-token", "Accept-Encoding": "gzip",
        })
        assert status == 200 and body == raw
        assert "Content-Encoding" not in headers and "Vary" not in headers
    with _asset_server(service, tmp_path) as (port, host):
        status, headers, body = lan_get(port, host, "/api/books", {"Accept-Encoding": "gzip"})
        assert status == 401 and "Content-Encoding" not in headers
        assert "books" not in json.loads(body)


def test_tablet_small_get_json_avoids_compression_overhead(service, tmp_path):
    with _asset_server(service, tmp_path) as (port, host):
        status, headers, body = lan_get(port, host, "/api/health", {
            "X-Reader-Token": "asset-test-token", "Accept-Encoding": "gzip",
        })
    assert status == 200 and json.loads(body) == {"status": "ok"}
    assert "Content-Encoding" not in headers
    assert headers["Vary"] == "Accept-Encoding"
