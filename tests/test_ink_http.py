from __future__ import annotations

import copy
import json
import threading
from contextlib import contextmanager
from http.client import HTTPConnection
from io import BytesIO
from uuid import uuid4

import pytest

from conftest import make_pdf
from reader_service.server import ReaderServer, handler_factory
from test_ink import change, put
from test_tablet_lan import lan_get, lan_request_server


def request(port, host, method, path, *, payload=None, body=None, headers=None):
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    connection = HTTPConnection("127.0.0.1", port, timeout=4)
    try:
        connection.request(method, path, body=body, headers={
            "Host": host, "Content-Type": "application/json", **(headers or {}),
        })
        response = connection.getresponse()
        return response.status, dict(response.headers), response.read()
    finally:
        connection.close()


@contextmanager
def ink_server(service):
    data = make_pdf(((612, 792), (792, 612)))
    book = service.intake(BytesIO(data), content_length=len(data), filename="ink.pdf")["book"]
    revision = book["active_revision"]["id"]
    with lan_request_server(service) as (port, host):
        status, headers, _ = lan_get(port, host, "/?tablet=1&token=test-tablet-token")
        assert status == 200
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        yield port, host, revision, {"Cookie": cookie, "Origin": f"http://{host}"}


def test_ink_http_requires_auth_for_read_and_write_then_round_trips(service):
    with ink_server(service) as (port, host, revision, auth):
        path = f"/api/revisions/{revision}/ink"
        assert request(port, host, "GET", path + "?page=0")[0] == 401
        operation = put()
        assert request(port, host, "POST", path, payload=operation)[0] == 401
        assert request(port, host, "POST", path, payload=operation,
                       headers={"X-Reader-Token": "stale-token"})[0] == 401
        status, _, body = request(port, host, "GET", path + "?page=0", headers=auth)
        assert status == 200 and json.loads(body) == {"strokes": []}
        status, _, body = request(port, host, "POST", path, payload=operation, headers=auth)
        saved = json.loads(body)
        assert status == 200 and saved["deleted"] is False
        assert saved["stroke"] == {"id": operation["stroke_id"], **operation["stroke"]}
        status, _, body = request(port, host, "GET", path + "?page=0",
                                  headers={"X-Reader-Token": "test-tablet-token"})
        assert status == 200 and json.loads(body) == {"strokes": [saved["stroke"]]}
        assert json.loads(request(port, host, "GET", path + "?page=1", headers=auth)[2]) == {"strokes": []}


def test_ink_http_idempotency_409_delete_retry_and_restore(service):
    with ink_server(service) as (port, host, revision, auth):
        path = f"/api/revisions/{revision}/ink"
        operation = put()
        assert request(port, host, "POST", path, payload=operation, headers=auth)[0] == 200
        assert request(port, host, "POST", path, payload=operation, headers=auth)[0] == 200
        changed = copy.deepcopy(operation)
        changed["stroke"]["color"] = "#ad3939"
        status, _, body = request(port, host, "POST", path, payload=changed, headers=auth)
        assert status == 409 and json.loads(body)["code"] == "INK_CONFLICT"
        erased = change(operation["stroke_id"], "delete")
        assert json.loads(request(port, host, "POST", path, payload=erased, headers=auth)[2])["deleted"] is True
        assert json.loads(request(port, host, "POST", path, payload=operation, headers=auth)[2])["deleted"] is True
        assert json.loads(request(port, host, "GET", path + "?page=0", headers=auth)[2]) == {"strokes": []}
        restored = change(operation["stroke_id"], "restore")
        assert json.loads(request(port, host, "POST", path, payload=restored, headers=auth)[2])["deleted"] is False
        assert len(json.loads(request(port, host, "GET", path + "?page=0", headers=auth)[2])["strokes"]) == 1


@pytest.mark.parametrize("query", ["", "?page=bad", "?page=-1", "?page=2", "?page=0.5"])
def test_ink_http_invalid_page_returns_useful_400(service, query):
    with ink_server(service) as (port, host, revision, auth):
        status, _, body = request(port, host, "GET", f"/api/revisions/{revision}/ink" + query, headers=auth)
        assert status == 400 and json.loads(body)["error"]


@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"{}", b"null", b"x" * (64 * 1024 + 1)],
                         ids=["empty", "broken-json", "array", "empty-object", "null", "oversized"])
def test_ink_http_invalid_json_or_size_cannot_write_partial_strokes(service, body):
    with ink_server(service) as (port, host, revision, auth):
        path = f"/api/revisions/{revision}/ink"
        status, _, response_body = request(port, host, "POST", path, body=body, headers=auth)
        assert status == 400 and json.loads(response_body)["error"]
        assert json.loads(request(port, host, "GET", path + "?page=0", headers=auth)[2]) == {"strokes": []}


def test_ink_http_missing_revision_or_stroke_is_404(service):
    with ink_server(service) as (port, host, revision, auth):
        missing = f"/api/revisions/{uuid4()}/ink"
        assert request(port, host, "GET", missing + "?page=0", headers=auth)[0] == 404
        assert request(port, host, "POST", missing, payload=put(), headers=auth)[0] == 404
        path = f"/api/revisions/{revision}/ink"
        assert request(port, host, "POST", path, payload=change(str(uuid4()), "delete"), headers=auth)[0] == 404


@pytest.mark.parametrize("untrusted", [
    {"Host": "untrusted.example"}, {"Host": "127.0.0.1:8876"},
    {"Origin": "https://untrusted.example"}, {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_ink_http_host_origin_policy_applies_before_read_or_write(service, untrusted):
    with ink_server(service) as (port, host, revision, auth):
        path = f"/api/revisions/{revision}/ink"
        headers = {**auth, **untrusted}
        assert request(port, host, "GET", path + "?page=0", headers=headers)[0] == 403
        assert request(port, host, "POST", path, payload=put(), headers=headers)[0] == 403
        assert request(port, host, "GET", "/tablet-ink.js", headers=headers)[0] == 403
        assert request(port, host, "GET", "/tablet-pen-check.html", headers=headers)[0] == 403
        assert json.loads(request(port, host, "GET", path + "?page=0", headers=auth)[2]) == {"strokes": []}


def test_ink_assets_follow_existing_static_policy_and_probe_requires_session(service):
    with ink_server(service) as (port, host, _, auth):
        for path in ("/tablet-ink.js", "/tablet-ink-store.js", "/tablet-pen.js",
                     "/tablet-pen-check.js", "/tablet-pen-check.css"):
            status, headers, body = request(port, host, "GET", path, headers=auth)
            assert status == 200 and body
            expected_type = "javascript" if path.endswith(".js") else "text/css"
            assert expected_type in headers["Content-Type"]
            # Application code holds no credential and keeps the existing JS/CSS policy.
            assert request(port, host, "GET", path)[0] == 200
        status, _, body = request(port, host, "GET", "/tablet-pen-check.html")
        assert status == 401 and "error" in json.loads(body)
        assert b"test-tablet-token" not in body
        status, headers, body = request(port, host, "GET", "/tablet-pen-check.html", headers=auth)
        assert status == 200 and "text/html" in headers["Content-Type"] and b"<html" in body


def test_desktop_has_no_ink_endpoint_or_ink_service(service, monkeypatch):
    def forbidden_constructor(_paths):
        raise AssertionError("Desktop must not initialize the tablet InkService")
    monkeypatch.setattr("reader_service.server.InkService", forbidden_constructor)
    server = ReaderServer(("127.0.0.1", 0), handler_factory(service, "desktop-ink-test"))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_port
        host = f"127.0.0.1:{port}"
        headers = {"X-Reader-Token": "desktop-ink-test"}
        path = f"/api/revisions/{uuid4()}/ink"
        assert request(port, host, "GET", path + "?page=0", headers=headers)[0] == 404
        assert request(port, host, "POST", path, payload=put(), headers=headers)[0] == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
