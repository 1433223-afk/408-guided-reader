from __future__ import annotations

import json
import threading
from contextlib import contextmanager

import pytest

from reader_service.server import ReaderServer, handler_factory
from test_tablet_lan import lan_get


TOKEN = "test-tablet-apk-token"
FAKE_APK = b"PK\x03\x04\x00\xffdisposable-apk-fixture\x00\x80"


@contextmanager
def apk_server(service, project_root, *, tablet=True):
    class SimulatedPeerServer(ReaderServer):
        def get_request(self):
            request, address = super().get_request()
            return request, ("192.168.43.22", address[1])

    server_type = SimulatedPeerServer if tablet else ReaderServer
    server = server_type(("127.0.0.1", 0), handler_factory(
        service, TOKEN, project_root=project_root, tablet_lan=tablet))
    port = server.server_port
    if tablet:
        # Transport remains loopback; only the access-policy LAN identity is simulated.
        server.server_address = ("192.168.43.65", port)
    host = f"{'192.168.43.65' if tablet else '127.0.0.1'}:{port}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port, host
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def write_fake_package(project_root):
    package = project_root / "dist" / "android" / "GuidedReader-Tablet.apk"
    package.parent.mkdir(parents=True)
    package.write_bytes(FAKE_APK)
    return package


@pytest.mark.parametrize("query", ["", "?token=old-launch", "?token=test-tablet-apk-token&token=other",
                                   "?token=test-tablet-apk-token&token="],
                         ids=["missing", "old", "duplicate", "duplicate-empty"])
def test_tablet_apk_download_requires_one_current_credential(service, tmp_path, query):
    project = tmp_path / "project"
    write_fake_package(project)
    with apk_server(service, project) as (port, host):
        status, headers, body = lan_get(port, host, "/tablet-app.apk" + query)
        assert status == 401 and json.loads(body)["error"]
        assert FAKE_APK not in body and "Set-Cookie" not in headers


def test_tablet_apk_current_query_cookie_or_header_returns_exact_binary(service, tmp_path):
    project = tmp_path / "project"
    write_fake_package(project)
    with apk_server(service, project) as (port, host):
        status, root_headers, _ = lan_get(port, host, "/?tablet=1&token=" + TOKEN)
        assert status == 200
        cookie = root_headers["Set-Cookie"].split(";", 1)[0]
        variants = [
            ("/tablet-app.apk?token=" + TOKEN, {}),
            ("/tablet-app.apk", {"Cookie": cookie, "Origin": "http://" + host}),
            ("/tablet-app.apk", {"X-Reader-Token": TOKEN}),
        ]
        for path, auth in variants:
            status, headers, body = lan_get(port, host, path, auth)
            assert status == 200 and body == FAKE_APK
            assert headers["Content-Type"] == "application/vnd.android.package-archive"
            assert headers["Content-Length"] == str(len(FAKE_APK))
            assert headers["Content-Disposition"] == 'attachment; filename="GuidedReader-Tablet.apk"'
            assert headers["Cache-Control"] == "no-store"
            assert headers["Referrer-Policy"] == "no-referrer"
            assert "Set-Cookie" not in headers


@pytest.mark.parametrize("untrusted", [
    {"Host": "untrusted.example"}, {"Host": "127.0.0.1:8876"},
    {"Origin": "https://untrusted.example"}, {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_tablet_apk_download_rejects_host_or_origin_before_query_auth(service, tmp_path, untrusted):
    project = tmp_path / "project"
    write_fake_package(project)
    with apk_server(service, project) as (port, host):
        status, headers, body = lan_get(port, host, "/tablet-app.apk?token=" + TOKEN, untrusted)
        assert status == 403 and FAKE_APK not in body
        assert json.loads(body)["code"] == "UNTRUSTED_LOCAL_ORIGIN"
        assert "Set-Cookie" not in headers


def test_tablet_apk_missing_package_is_503_only_after_authentication(service, tmp_path):
    with apk_server(service, tmp_path / "empty-project") as (port, host):
        assert lan_get(port, host, "/tablet-app.apk")[0] == 401
        status, headers, body = lan_get(port, host, "/tablet-app.apk?token=" + TOKEN)
        assert status == 503 and "尚未就绪" in json.loads(body)["error"]
        assert "Set-Cookie" not in headers


def test_desktop_never_serves_tablet_apk_even_with_current_auth(service, tmp_path):
    project = tmp_path / "project"
    write_fake_package(project)
    with apk_server(service, project, tablet=False) as (port, host):
        for query in ("", "?token=" + TOKEN):
            status, _, body = lan_get(port, host, "/tablet-app.apk" + query, {"X-Reader-Token": TOKEN})
            assert status == 404 and FAKE_APK not in body
