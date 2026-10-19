from __future__ import annotations

import json
import socket
from http.client import HTTPConnection
from io import BytesIO
from urllib.parse import urlparse

import pytest

from conftest import make_pdf
from reader_service.library import IntakeError
from reader_service.server import _UploadBody
from test_api import running_server


def upload_headers(base, token=None, headers=(), body=None):
    address = urlparse(base)
    connection = HTTPConnection(address.hostname, address.port, timeout=3)
    connection.putrequest("POST", "/api/books?title=PRIVATE_QUERY_CANARY")
    if token is not None:
        connection.putheader("X-Reader-Token", token)
    for name, value in headers:
        connection.putheader(name, value)
    connection.endheaders(body)
    return connection


@pytest.mark.parametrize("headers,status,code", [
    ([], 411, "PDF_UPLOAD_LENGTH_REQUIRED"),
    ([("Content-Length", "-1")], 400, "PDF_UPLOAD_INVALID_LENGTH"),
    ([("Content-Length", "not-a-length")], 400, "PDF_UPLOAD_INVALID_LENGTH"),
    ([("Content-Length", "2"), ("Content-Length", "3")], 400, "PDF_UPLOAD_INVALID_LENGTH"),
    ([("Transfer-Encoding", "chunked")], 501, "PDF_UPLOAD_TRANSFER_ENCODING_UNSUPPORTED"),
    ([("Content-Length", "3"), ("Transfer-Encoding", "chunked")], 501, "PDF_UPLOAD_TRANSFER_ENCODING_UNSUPPORTED"),
])
def test_upload_framing_has_explicit_errors(service, headers, status, code):
    with running_server(service) as (base, token):
        connection = upload_headers(base, token, headers)
        try:
            response = connection.getresponse()
            assert response.status == status
            assert json.loads(response.read())["code"] == code
            assert len(response.getheader("X-Reader-Upload-Id")) == 32
        finally:
            connection.close()
    assert service.list_books() == []
    assert not list(service.paths.temp_root().iterdir())


@pytest.mark.parametrize("headers", [[], [("Transfer-Encoding", "chunked")]])
def test_upload_auth_precedes_missing_length_and_logs_received(service, capsys, headers):
    with running_server(service) as (base, _):
        connection = upload_headers(base, headers=headers)
        try:
            response = connection.getresponse()
            assert response.status == 401
            assert response.getheader("X-Reader-Upload-Id")
            response.read()
        finally:
            connection.close()
    events = upload_events(capsys.readouterr().out)
    assert [event["event"] for event in events] == ["received", "result"]
    assert events[0]["content_length"] == "missing"
    assert events[1]["status"] == 401


def test_upload_untrusted_origin_is_rejected_before_auth_with_request_id(service, capsys):
    with running_server(service) as (base, _):
        connection = upload_headers(base, headers=[("Origin", "https://untrusted.example")])
        try:
            response = connection.getresponse()
            assert response.status == 403
            assert json.loads(response.read())["code"] == "UNTRUSTED_LOCAL_ORIGIN"
            assert response.getheader("X-Reader-Upload-Id")
        finally:
            connection.close()
    events = upload_events(capsys.readouterr().out)
    assert [event["event"] for event in events] == ["received", "result"]
    assert events[1]["status"] == 403


def upload_events(output):
    return [json.loads(line.removeprefix("PDF_UPLOAD ")) for line in output.splitlines()
            if line.startswith("PDF_UPLOAD ")]


def test_upload_logs_and_response_id_exclude_private_input(service, capsys):
    payload = make_pdf()
    with running_server(service) as (base, token):
        connection = upload_headers(base, token, [
            ("Content-Length", str(len(payload))),
            ("X-File-Name", "PRIVATE_FILENAME_CANARY.pdf"),
            ("Cookie", "private=PRIVATE_COOKIE_CANARY"),
        ], payload)
        try:
            response = connection.getresponse()
            response_id = response.getheader("X-Reader-Upload-Id")
            assert response.status == 201
            response.read()
        finally:
            connection.close()
    output = capsys.readouterr().out
    for private in (token, "PRIVATE_FILENAME_CANARY", "PRIVATE_COOKIE_CANARY", "PRIVATE_QUERY_CANARY", "%PDF"):
        assert private not in output
    events = upload_events(output)
    assert [event["event"] for event in events] == ["received", "result"]
    assert events[0]["request_id"] == events[1]["request_id"] == response_id
    assert events[0]["content_length"] == len(payload)
    assert events[1]["code"] == "PDF_UPLOAD_IMPORTED"
    assert events[1]["elapsed_ms"] >= 0


def test_upload_transfer_encoding_logs_only_known_values(service, capsys):
    with running_server(service) as (base, token):
        connection = upload_headers(base, token, [("Transfer-Encoding", "PRIVATE_HEADER_CANARY")])
        try:
            response = connection.getresponse()
            assert response.status == 501
            response.read()
        finally:
            connection.close()
    output = capsys.readouterr().out
    assert "PRIVATE_HEADER_CANARY" not in output
    event = upload_events(output)[0]
    assert event["transfer_encoding_present"] is True
    assert event["transfer_encoding"] == "other"


def test_upload_idle_timeout_cleans_temporary_file(service, monkeypatch):
    monkeypatch.setattr("reader_service.server._PDF_UPLOAD_IDLE_TIMEOUT_SECONDS", .08)
    with running_server(service) as (base, token):
        connection = upload_headers(base, token, [("Content-Length", "100")], b"%PDF")
        try:
            response = connection.getresponse()
            assert response.status == 408
            assert json.loads(response.read())["code"] == "PDF_UPLOAD_TIMEOUT"
            assert response.getheader("X-Reader-Upload-Id")
        finally:
            connection.close()
    assert service.list_books() == []
    assert not list(service.paths.temp_root().iterdir())


def test_upload_socket_timeout_is_limited_to_each_body_read():
    class Connection:
        timeout = None

        def gettimeout(self):
            return self.timeout

        def settimeout(self, value):
            self.timeout = value

    connection = Connection()

    class Stream:
        def read(self, size):
            assert connection.timeout == 90
            return b"a"

    body = _UploadBody(connection, Stream())
    assert body.read(1) == b"a"
    assert connection.timeout is None
    assert body.read(1) == b"a"
    assert connection.timeout is None


@pytest.mark.parametrize("failure,code", [
    (TimeoutError("PRIVATE_EXCEPTION_CANARY"), "PDF_UPLOAD_TIMEOUT"),
    (ConnectionResetError("PRIVATE_EXCEPTION_CANARY"), "PDF_UPLOAD_INTERRUPTED"),
    (OSError("PRIVATE_EXCEPTION_CANARY"), "PDF_UPLOAD_INTERRUPTED"),
])
def test_upload_stream_errors_are_not_storage_failures_and_cleanup(service, failure, code):
    class InterruptedBody:
        reads = 0

        def read(self, size):
            self.reads += 1
            if self.reads == 1:
                return b"%PDF"
            raise failure

    with pytest.raises(IntakeError) as error:
        service.intake(InterruptedBody(), content_length=8, filename="private.pdf")
    assert error.value.code == code
    assert "PRIVATE_EXCEPTION_CANARY" not in str(error.value)
    assert not list(service.paths.temp_root().iterdir())
    assert service.list_books() == []


def test_upload_short_body_is_interrupted_and_cleans_up(service):
    with pytest.raises(IntakeError) as error:
        service.intake(BytesIO(b"%PDF"), content_length=8, filename="private.pdf")
    assert error.value.code == "PDF_UPLOAD_INTERRUPTED"
    assert not list(service.paths.temp_root().iterdir())


def test_upload_sender_eof_has_interrupted_response_and_cleans_up(service):
    with running_server(service) as (base, token):
        connection = upload_headers(base, token, [("Content-Length", "100")], b"%PDF")
        try:
            connection.sock.shutdown(socket.SHUT_WR)
            response = connection.getresponse()
            assert response.status == 400
            assert json.loads(response.read())["code"] == "PDF_UPLOAD_INTERRUPTED"
            assert response.getheader("X-Reader-Upload-Id")
        finally:
            connection.close()
    assert not list(service.paths.temp_root().iterdir())
    assert service.list_books() == []
