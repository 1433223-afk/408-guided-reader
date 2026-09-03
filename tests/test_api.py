from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from reader_service.server import ReaderServer, handler_factory

from conftest import make_pdf


@contextmanager
def running_server(service):
    token = "test-launch-token"
    server = ReaderServer(("127.0.0.1", 0), handler_factory(service, token))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", token
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def request_json(url, token, *, method="GET", data=None, headers=None):
    request = Request(
        url,
        data=data,
        method=method,
        headers={"X-Reader-Token": token, **(headers or {})},
    )
    with urlopen(request) as response:
        return response.status, json.load(response)


def test_reader_api_import_open_position_reload_and_duplicate(service):
    pdf = make_pdf(((612, 792), (792, 612)))
    with running_server(service) as (base, token):
        status, imported = request_json(
            f"{base}/api/books",
            token,
            method="POST",
            data=pdf,
            headers={"Content-Type": "application/pdf", "X-File-Name": "reader.pdf"},
        )
        assert status == 201
        revision = imported["book"]["active_revision"]

        pdf_request = Request(
            f"{base}/api/revisions/{revision['id']}/pdf",
            headers={"X-Reader-Token": token, "Range": "bytes=0-7"},
        )
        with urlopen(pdf_request) as response:
            assert response.status == 206
            assert response.read().startswith(b"%PDF-")

        position_payload = json.dumps(
            {"pdf_page_index": 1, "normalized_offset": 0.42, "zoom": 1.3}
        ).encode()
        request_json(
            f"{base}/api/revisions/{revision['id']}/position",
            token,
            method="PUT",
            data=position_payload,
            headers={"Content-Type": "application/json"},
        )
        _, library = request_json(f"{base}/api/books", token)
        assert library["books"][0]["active_revision"]["position"]["pdf_page_index"] == 1
        assert library["books"][0]["active_revision"]["position"]["normalized_offset"] == 0.42

        status, duplicate = request_json(
            f"{base}/api/books",
            token,
            method="POST",
            data=pdf,
            headers={"Content-Type": "application/pdf", "X-File-Name": "again.pdf"},
        )
        assert status == 200
        assert duplicate["duplicate"] is True
        assert duplicate["book"]["revision_count"] == 1


def test_api_requires_launch_token(service):
    with running_server(service) as (base, _):
        try:
            urlopen(f"{base}/api/books")
        except HTTPError as error:
            assert error.code == 401
        else:
            raise AssertionError("API accepted a request without the per-launch token")
