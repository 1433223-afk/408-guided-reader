from __future__ import annotations

import json
import os
import sqlite3
import threading
from uuid import uuid4
from contextlib import contextmanager
from http.client import HTTPConnection
from io import BytesIO

import pytest

from conftest import make_pdf
from reader_service.__main__ import build_parser
from reader_service.library import LibraryService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import configure_demo_providers, list_source_books, prepare_demo, require_demo_data
from reader_service.tablet_network import is_private_ipv4, validate_tablet_address


@pytest.mark.parametrize("address", ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.43.65"])
def test_tablet_requires_explicit_rfc1918_ipv4(address):
    assert is_private_ipv4(address)
    assert validate_tablet_address(address, check_local=False) == address


@pytest.mark.parametrize("address", ["0.0.0.0", "127.0.0.1", "localhost", "169.254.1.2", "172.32.0.1", "100.64.0.1", "8.8.8.8", "192.0.2.1", "::1", "::ffff:192.168.1.1"])
def test_tablet_rejects_wildcard_public_reserved_and_ipv6(address):
    assert not is_private_ipv4(address)
    with pytest.raises(ValueError, match="RFC1918"):
        validate_tablet_address(address, check_local=False)


def test_desktop_cli_defaults_remain_loopback():
    args = build_parser().parse_args([])
    assert args.host == "127.0.0.1"
    assert args.port == 8765
    assert args.tablet_lan is None
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--host", "0.0.0.0"])


def test_tablet_address_must_belong_to_a_local_interface(monkeypatch):
    def unavailable_socket(*_args, **_kwargs):
        raise OSError("address is not assigned")
    monkeypatch.setattr("reader_service.tablet_network.socket.socket", unavailable_socket)
    with pytest.raises(ValueError, match="not assigned to this computer"):
        validate_tablet_address("192.168.43.65")


@contextmanager
def lan_request_server(service, peer="192.168.43.22"):
    class SimulatedPeerServer(ReaderServer):
        def get_request(self):
            request, address = super().get_request()
            return request, (peer, address[1])

    server = SimulatedPeerServer(("127.0.0.1", 0), handler_factory(service, "test-tablet-token", tablet_lan=True))
    port = server.server_port
    # TCP transport is loopback so tests run without a particular LAN adapter.
    # Only the bind identity and peer passed into the access policy are simulated.
    server.server_address = ("192.168.43.65", port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield port, f"192.168.43.65:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def lan_get(port, host, path, extra=None):
    connection = HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request("GET", path, headers={"Host": host, **(extra or {})})
        response = connection.getresponse()
        return response.status, dict(response.headers), response.read()
    finally:
        connection.close()


def test_lan_same_origin_cookie_bootstrap_and_api_auth(service):
    with lan_request_server(service) as (port, host):
        status, headers, _ = lan_get(port, host, "/?tablet=1&token=test-tablet-token")
        assert status == 200
        assert "HttpOnly" in headers["Set-Cookie"]
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        assert lan_get(port, host, "/api/books")[0] == 401
        status, _, body = lan_get(port, host, "/api/books", {"Cookie": cookie, "Origin": f"http://{host}"})
        assert status == 200 and json.loads(body) == {"books": []}


@pytest.mark.parametrize("headers", [
    {"Host": "127.0.0.1:8876"}, {"Host": "untrusted.example"},
    {"Origin": "https://untrusted.example"}, {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
])
def test_lan_rejects_untrusted_host_or_origin_even_with_token(service, headers):
    with lan_request_server(service) as (port, host):
        status, response_headers, _ = lan_get(port, host, "/?token=test-tablet-token", headers)
        assert status == 403
        assert "Set-Cookie" not in response_headers


@pytest.mark.parametrize("peer", ["8.8.8.8", "100.64.0.1", "169.254.1.1", "127.0.0.1", "::1"])
def test_lan_refuses_non_private_peer_before_bootstrap(service, peer):
    with lan_request_server(service, peer) as (port, host):
        status, headers, body = lan_get(port, host, "/?token=test-tablet-token", {"X-Forwarded-For": "192.168.43.22"})
        assert status == 403
        assert "Set-Cookie" not in headers
        assert json.loads(body)["code"] == "UNTRUSTED_TABLET_CLIENT"


def test_snapshot_selects_one_book_includes_committed_wal_and_isolates_pdf(service, tmp_path):
    first = make_pdf()
    second = make_pdf(((792, 612),))
    one = service.intake(BytesIO(first), content_length=len(first), filename="one.pdf")["book"]
    service.intake(BytesIO(second), content_length=len(second), filename="two.pdf")
    revision = one["active_revision"]
    destination = tmp_path / "tablet-data"
    with sqlite3.connect(service.paths.database()) as active_desktop:
        active_desktop.execute("PRAGMA journal_mode=WAL")
        service.save_position(revision["id"], 0, .42, 1.25)
        report = prepare_demo(service.paths.root, destination, [one["id"]])
    require_demo_data(destination)
    demo = LibraryService(ManagedPaths(destination))
    assert len(demo.list_books()) == 1
    assert demo.list_books()[0]["active_revision"]["position"]["normalized_offset"] == .42
    assert len(service.list_books()) == 2
    assert len(list_source_books(service.paths.root)) == 2
    assert report["copied_pdf_bytes"] == len(first)
    demo.pdf_path(revision["id"]).write_bytes(b"independent-demo-change")
    assert service.pdf_path(revision["id"]).read_bytes() == first
    with pytest.raises(ValueError, match="never overwritten"):
        prepare_demo(service.paths.root, destination, [one["id"]])


def test_snapshot_requires_explicit_selection_and_separate_paths(service, tmp_path):
    with pytest.raises(ValueError, match="--book-id"):
        prepare_demo(service.paths.root, tmp_path / "demo", [])
    with pytest.raises(ValueError, match="without nesting"):
        prepare_demo(service.paths.root, service.paths.root / "demo", ["anything"])
    with pytest.raises(ValueError, match="prepared"):
        require_demo_data(service.paths.root)


def test_empty_demo_is_valid_and_cannot_overwrite_learning_library(tmp_path):
    destination = tmp_path / "empty-demo"
    prepare_demo(None, destination, [])
    require_demo_data(destination)
    assert LibraryService(ManagedPaths(destination)).list_books() == []


def test_demo_marker_compares_canonical_directory_aliases(tmp_path):
    destination = tmp_path / "alias-demo"
    prepare_demo(None, destination, [])
    marker = destination / ".tablet-demo.json"
    metadata = json.loads(marker.read_text(encoding="utf-8"))
    metadata["data_dir"] = str(destination / ".." / destination.name)
    marker.write_text(json.dumps(metadata), encoding="utf-8")
    require_demo_data(destination)
    metadata["source_data_dir"] = str(destination / ".." / destination.name)
    marker.write_text(json.dumps(metadata), encoding="utf-8")
    with pytest.raises(ValueError, match="original learning library"):
        require_demo_data(destination)


@pytest.mark.parametrize("regenerating", [False, True])
def test_snapshot_does_not_resume_inherited_model_jobs(service, tmp_path, regenerating):
    from test_knowledge_map import build_fixture, claim_and_run
    from reader_service.jobs import JobRepository
    from reader_service.knowledge import KnowledgeRepository
    from reader_service.teaching.service import TeachingService
    from reader_service.teaching.inline_service import InlineTeachingService

    fixture = build_fixture(service)
    revision = fixture["revision"]["id"]
    chapter = fixture["chapter"]["outline_node_id"]
    fixture["outline"].resolve_chapter_physical(revision, chapter)
    fixture["knowledge"].request_prepare(revision, chapter)
    if regenerating:
        assert claim_and_run(fixture)["status"] == "READY"
        fixture["knowledge"].request_regenerate(revision, chapter)
    section = fixture["sections"][0]["outline_node_id"]
    TeachingService(service.database, object()).request(revision, section, str(uuid4()))
    InlineTeachingService(service.database, object()).request(revision, section, str(uuid4()))
    destination = tmp_path / "model-work-snapshot"
    prepare_demo(service.paths.root, destination, [fixture["book"]["id"]])
    demo = LibraryService(ManagedPaths(destination))
    copied_knowledge = KnowledgeRepository(demo.database)
    # Exercise the same restart recovery that the real server calls. Cancelling
    # just `jobs` regressed here because recovery would silently recreate them.
    assert copied_knowledge.recover_preparing_jobs() == 0
    assert JobRepository(demo.database).recover() == 0
    assert JobRepository(demo.database).claim() is None
    with demo.database.connect() as connection:
        state = connection.execute("SELECT status,regeneration_state FROM chapter_preparations").fetchone()
        assert tuple(state) == (("READY", "FAILED") if regenerating else ("FAILED", "IDLE"))
        for table in ("teaching_assets", "inline_teaching_assets"):
            assert connection.execute(f"SELECT state FROM {table}").fetchone()[0] == "FAILED"
        if regenerating:
            assert connection.execute("SELECT COUNT(*) FROM knowledge_points").fetchone()[0] > 0
    with service.database.connect() as connection:
        original = connection.execute("SELECT status,regeneration_state FROM chapter_preparations").fetchone()
        assert tuple(original) == (("READY", "RUNNING") if regenerating else ("PREPARING", "IDLE"))


def test_demo_provider_routes_override_other_shell_providers(monkeypatch):
    monkeypatch.setattr(os, "environ", dict(os.environ))
    monkeypatch.setenv("GUIDED_READER_ASSISTANT_PROVIDER", "openrouter")
    monkeypatch.setenv("GUIDED_READER_GUIDE_MODEL", "google/gemini-3.8-flash")
    configure_demo_providers()
    assert os.environ["GUIDED_READER_ASSISTANT_PROVIDER"] == "deepseek"
    assert os.environ["GUIDED_READER_REVIEW_PROVIDER"] == "zhipu"
    assert os.environ["GUIDED_READER_OPENROUTER_DISABLED"] == "1"
    assert os.environ["GUIDED_READER_GUIDE_MODEL"] == os.environ.get("GUIDED_READER_DEEPSEEK_MODEL", "deepseek-flash")
