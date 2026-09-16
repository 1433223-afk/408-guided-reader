from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from http.cookiejar import CookieJar
from io import BytesIO
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.foundation import DetectedLine, FoundationRepository, FoundationService
from reader_service.server import ReaderServer, handler_factory

from conftest import make_pdf


@contextmanager
def running_server(
    service,
    annotations=None,
    preparation=None,
    outline=None,
    knowledge=None,
    assistant=None,
    saved_explanations=None,
    learning=None,
    teaching=None,
):
    token = "test-launch-token"
    server = ReaderServer(
        ("127.0.0.1", 0), handler_factory(
            service, token, annotations=annotations, preparation=preparation, outline=outline,
            knowledge=knowledge, assistant=assistant, saved_explanations=saved_explanations,
            learning=learning,
            teaching=teaching,
        )
    )
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


def test_search_api_returns_results_and_authoritative_coverage(service):
    from types import SimpleNamespace

    from test_search import prepared_search

    _book, revision, foundation = prepared_search(service)
    preparation = SimpleNamespace(foundation=foundation)
    with running_server(service, preparation=preparation) as (base, token):
        status, result = request_json(
            f"{base}/api/revisions/{revision['id']}/search?q=%E4%B8%AD%E6%96%AD%E5%90%91%E9%87%8F",
            token,
        )
    assert status == 200
    assert result["coverage"]["ready_pages"] == 1
    assert result["coverage"]["statuses"]["FAILED"] == 1
    assert result["results"][0]["pdf_page_index"] == 0
    assert len(result["results"][0]["match_ranges"]) == 2


def test_plain_browser_entry_bootstraps_same_origin_api_session(service):
    with running_server(service) as (base, _):
        opener = build_opener(HTTPCookieProcessor(CookieJar()))
        with opener.open(f"{base}/") as response:
            assert response.status == 200
            assert "reader_launch=" in response.headers["Set-Cookie"]
            assert "HttpOnly" in response.headers["Set-Cookie"]
            assert "SameSite=Strict" in response.headers["Set-Cookie"]
        with opener.open(f"{base}/api/books") as response:
            assert response.status == 200
            assert json.load(response) == {"books": []}


def test_annotation_api_resolves_runtime_selection_and_persists_durable_anchor(service):
    pdf = make_pdf()
    imported = service.intake(
        BytesIO(pdf), content_length=len(pdf), filename="api-marks.pdf"
    )
    revision = imported["book"]["active_revision"]
    repository = FoundationRepository(service.database)

    class UnusedEngine:
        def prepare_page(self, page_image, page_size):
            raise AssertionError("not used")

    foundation = FoundationService(service, repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    assert repository.mark_preparing(revision["id"], 0)
    repository.publish_page(
        revision["id"],
        0,
        route="OCR",
        foundation_version=1,
        engine_profile="fixture:v1",
        lines=[DetectedLine(
            quad=((0.1, 0.2), (0.5, 0.2), (0.5, 0.3), (0.1, 0.3)),
            text="ABCD",
            confidence=1,
            cells=((0.1, 0.2, 0, 1), (0.2, 0.3, 1, 2), (0.3, 0.4, 2, 3), (0.4, 0.5, 3, 4)),
        )],
    )
    annotations = AnnotationService(foundation, AnnotationRepository(service.database))

    with running_server(service, annotations) as (base, token):
        body = json.dumps({
            "pdf_page_index": 0,
            "start": {"line_ordinal": 0, "boundary": 1},
            "end": {"line_ordinal": 0, "boundary": 3},
            "body": "API note",
            "highlight_style": "GREEN",
        }).encode()
        status, created = request_json(
            f"{base}/api/revisions/{revision['id']}/annotations",
            token,
            method="POST",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        assert status == 201
        assert created["annotation"]["quote"] == "BC"
        assert created["annotation"]["highlight_style"] == "GREEN"
        assert created["annotation"]["quads"] == [
            [[0.2, 0.2], [0.4, 0.2], [0.4, 0.3], [0.2, 0.3]]
        ]

        _, listed = request_json(
            f"{base}/api/revisions/{revision['id']}/annotations?page=0", token
        )
        assert listed["annotations"] == [created["annotation"]]

        request = Request(
            f"{base}/api/revisions/{revision['id']}/annotations/{created['annotation']['id']}",
            method="DELETE",
            headers={"X-Reader-Token": token},
        )
        with urlopen(request) as response:
            assert response.status == 204
        _, listed = request_json(
            f"{base}/api/revisions/{revision['id']}/annotations?page=0", token
        )
        assert listed == {"annotations": []}


def test_outline_and_manual_page_label_api(service):
    from reader_service.foundation import PageLabelRepository, PageLabelService
    from reader_service.outline import OutlineRepository, OutlineService

    pdf = make_pdf(((612, 792), (612, 792)))
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="map-api.pdf")
    revision_id = imported["book"]["active_revision"]["id"]
    labels = PageLabelService(service, PageLabelRepository(service.database))
    outline = OutlineService(service, OutlineRepository(service.database), labels)
    with running_server(service, outline=outline) as (base, token):
        status, tree = request_json(f"{base}/api/revisions/{revision_id}/outline", token)
        assert status == 200
        assert tree["nodes"] == []

        body = json.dumps({"printed_label": "封二"}).encode()
        status, saved = request_json(
            f"{base}/api/revisions/{revision_id}/page-labels/1",
            token,
            method="PUT",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        assert status == 200
        assert saved["page_label"]["method"] == "MANUAL"
        _, snapshot = request_json(f"{base}/api/revisions/{revision_id}/page-labels", token)
        assert snapshot["labels"][1]["printed_label"] == "封二"
