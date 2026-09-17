import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from types import SimpleNamespace

import pytest

from reader_service.instance import InstanceLock, InstanceProfile
from reader_service.agent_runtime import ProviderRuntimeSet, ProviderFailure
from reader_service.agent_runtime.beta import BetaEgress, PrivateCredential, ENDPOINT, MODEL
from reader_service.agent_runtime.runtime import ProviderResponse, StreamConsumerDisconnected
from reader_service.disk import DiskGuard, DiskSpaceError
from reader_service.library import LibraryService, IntakeError
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from conftest import make_pdf


@pytest.mark.parametrize("mode", ["personal", "beta"])
def test_listener_backlog_is_set_before_activation(mode, monkeypatch):
    observed = []
    activate = ThreadingHTTPServer.server_activate

    def record_activation(server):
        observed.append(server.request_queue_size)
        activate(server)

    monkeypatch.setattr(ThreadingHTTPServer, "server_activate", record_activation)
    expected = 64 if mode == "beta" else ThreadingHTTPServer.request_queue_size
    with ReaderServer(("127.0.0.1", 0), BaseHTTPRequestHandler,
                      profile=InstanceProfile(mode)) as server:
        assert observed == [expected]
        assert server.request_queue_size == expected
        assert server.socket.getsockname()[1] != 0


class Adapter:
    provider_name = "deepseek"
    def __init__(self):
        self.calls = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self.block = False
        self.failure = None
    def complete(self, endpoint, key, body, timeout):
        self.calls.append((endpoint, key, body, timeout))
        self.entered.set()
        if self.block:
            assert self.release.wait(5)
        if self.failure:
            raise self.failure
        return ProviderResponse("OK")
    def stream(self, endpoint, key, body, timeout, on_delta, on_reasoning_delta=None):
        result = self.complete(endpoint, key, body, timeout)
        on_delta(result.answer)
        return result


@pytest.fixture
def beta(tmp_path):
    credential = PrivateCredential(tmp_path / "credentials")
    guard = BetaEgress(credential, tmp_path / "AI_DISABLED")
    adapter = Adapter()
    runtime = ProviderRuntimeSet.for_beta(guard, adapter)
    return guard, adapter, runtime


def test_lock_is_process_exclusive_and_released(tmp_path):
    command = [sys.executable, "-c", "from pathlib import Path; from reader_service.instance import InstanceLock; import sys; lock=InstanceLock(Path(sys.argv[1])); lock.__enter__()", str(tmp_path)]
    env = {**os.environ, "PYTHONPATH": "src"}
    with InstanceLock(tmp_path):
        result = subprocess.run(command, env=env, capture_output=True)
        assert result.returncode != 0
        assert b"already in use" in result.stderr
    assert subprocess.run(command, env=env, capture_output=True).returncode == 0


@pytest.mark.parametrize("origin", ["http://a.example", "https://a.example/", "https://a.example?x", "https://user@a.example", "https://a.example:5000"])
def test_profile_rejects_unsafe_origin(tmp_path, origin):
    profile = InstanceProfile("beta", origin, tmp_path / "key")
    with pytest.raises(ValueError):
        profile.validate(tmp_path / "data", "127.0.0.1", 1)


def test_beta_ignores_inherited_keys_routes_and_excludes_capture(beta, monkeypatch):
    guard, adapter, runtime = beta
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_API_KEY", "must-not-be-used")
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_ENDPOINT", "https://hostile.example")
    monkeypatch.setenv("GUIDED_READER_ASSISTANT_PROVIDER", "zhipu")
    with pytest.raises(ProviderFailure):
        runtime.complete([])
    assert not adapter.calls
    guard.credentials.save("test-own-key")
    assert runtime.complete([]) == "OK"
    assert adapter.calls[0][0:2] == (ENDPOINT, "test-own-key")
    assert [p["provider"] for p in runtime.status()["providers"]] == ["deepseek"]
    assert runtime.inspector.snapshot() == []


@pytest.mark.parametrize("provider,model", [("openrouter", MODEL), ("zhipu", MODEL), ("deepseek", "other-model")])
def test_final_route_refused_before_transport(beta, provider, model):
    guard, adapter, runtime = beta
    guard.credentials.save("test-own-key")
    with pytest.raises(ProviderFailure):
        runtime.complete_for_with_metadata(provider, [], model=model)
    assert not adapter.calls


def test_endpoint_override_and_direct_adapter_cannot_escape(beta):
    guard, adapter, runtime = beta
    guard.credentials.save("test-own-key")
    leaf = runtime.runtimes["deepseek"]
    leaf.config = replace(leaf.config, endpoint="https://hostile.example")
    with pytest.raises(ProviderFailure):
        leaf.complete([])
    with pytest.raises(ProviderFailure):
        leaf.adapter.complete(ENDPOINT, "ignored", {"model": "other"}, 15)
    assert not adapter.calls


def test_two_mixed_calls_third_immediate_and_slot_recovery(beta):
    guard, adapter, runtime = beta
    guard.credentials.save("test-own-key")
    adapter.block = True
    with ThreadPoolExecutor(2) as pool:
        first = pool.submit(runtime.complete, [], interaction_id="assistant")
        assert adapter.entered.wait(1)
        second = pool.submit(runtime.stream_for_with_metadata, "deepseek", [], lambda delta: None, interaction_id="review")
        import time
        deadline = time.monotonic() + 2
        while guard.active < 2 and time.monotonic() < deadline:
            time.sleep(.01)
        assert guard.active == 2
        started = time.monotonic()
        with pytest.raises(ProviderFailure, match="ai_busy"):
            runtime.complete([], interaction_id="kp")
        assert time.monotonic() - started < .2
        adapter.release.set()
        assert first.result() == "OK"
        assert second.result().answer == "OK"
    assert guard.active == 0
    def disconnected(delta):
        raise StreamConsumerDisconnected()
    with pytest.raises(StreamConsumerDisconnected):
        runtime.stream_for_with_metadata("deepseek", [], disconnected)
    assert guard.active == 0
    guard.disabled_file.touch()
    with pytest.raises(ProviderFailure, match="ai_disabled"):
        runtime.complete([])
    assert guard.active == 0


def test_key_rotation_disconnect_and_validation_does_not_replay(beta):
    guard, adapter, runtime = beta
    guard.replace_key("first-test-key", adapter)
    assert len(adapter.calls) == 1
    assert adapter.calls[0][2]["max_tokens"] == 8
    assert adapter.calls[0][3] == 15
    assert guard.credentials.status() == {"configured": True, "validation": "VALIDATED"}
    guard.replace_key("second-test-key", adapter)
    runtime.complete([])
    assert adapter.calls[-1][1] == "second-test-key"
    guard.disconnect()
    with pytest.raises(ProviderFailure):
        runtime.complete([])
    assert not guard.credentials.path.exists()


@contextmanager
def server_for_beta(service, guard):
    profile = InstanceProfile("beta", "https://a.example", guard.credentials.directory)
    server = ReaderServer(("127.0.0.1", 0), handler_factory(service, "canary-launch", profile=profile, beta_guard=guard), profile=profile)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield server
    finally:
        server.stopping.set()
        server.shutdown()
        server.server_close()
        thread.join()


def request(server, path, *, method="GET", headers=None, body=None):
    conn = HTTPConnection("127.0.0.1", server.server_port, timeout=3)
    conn.request(method, path, body, {"Host": "a.example", "X-Forwarded-Proto": "https", **(headers or {})})
    response = conn.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    conn.close()
    return result


def test_http_host_origin_cookie_inspection_and_key_nonreflection(service, beta, monkeypatch):
    guard, adapter, _ = beta
    monkeypatch.setattr("reader_service.agent_runtime.deepseek.OpenAICompatibleAdapter", lambda *a, **kw: adapter)
    with server_for_beta(service, guard) as server:
        assert request(server, "/", headers={"Host": "b.example"})[0] == 403
        assert request(server, "/", headers={"X-Forwarded-Proto": "http"})[0] == 403
        status, headers, body = request(server, "/")
        assert status == 200
        assert "Secure" in headers["Set-Cookie"] and "HttpOnly" in headers["Set-Cookie"]
        cookie = headers["Set-Cookie"].split(";")[0]
        assert request(server, "/api/books")[0] == 401
        assert request(server, "/api/books", headers={"X-Reader-Token": "canary-launch"})[0] == 401
        auth = {"Cookie": cookie, "Origin": "https://a.example"}
        assert request(server, "/api/books", headers=auth)[0] == 200
        assert request(server, "/api/beta/key", method="POST", headers={"Cookie": cookie}, body='{}')[0] == 403
        assert request(server, "/api/beta/key", method="POST", headers={**auth, "Origin": "https://b.example"}, body='{}')[0] == 403
        secret = "nonreflection-secret-canary"
        status, _, response = request(server, "/api/beta/key", method="POST", headers=auth, body=json.dumps({"key": secret}))
        assert status == 200 and secret.encode() not in response
        assert request(server, "/api/beta/key", headers=auth)[2] == response
        for path in ["/api/assistant/inspection", "/api/foo/debug", "/api/assistant/bake-off"]:
            assert request(server, path, headers=auth)[0] == 404
        assert request(server, "/api/beta/key", method="DELETE", headers=auth)[0] == 200
        assert not guard.credentials.path.exists()
    assert not service.database.path.read_bytes().find(secret.encode()) >= 0


def test_disk_reservations_growth_failures_and_assets_remain(tmp_path):
    available = [10 * 1024**2]
    disk = DiskGuard(tmp_path, 1024**2, usage=lambda _: SimpleNamespace(free=available[0]))
    service = LibraryService(ManagedPaths(tmp_path / "data"), max_pdf_bytes=512 * 1024**2, disk_guard=disk)
    pdf = make_pdf()
    book = service.intake(BytesIO(pdf), content_length=len(pdf), filename="test.pdf")["book"]
    with disk.upload(8 * 1024**2):
        with pytest.raises(DiskSpaceError):
            with disk.upload(2 * 1024**2):
                pass
    assert disk._reserved == 0
    with pytest.raises(IntakeError):
        service.intake(BytesIO(), content_length=513 * 1024**2, filename="huge.pdf")
    available[0] = 0
    with pytest.raises(DiskSpaceError):
        service.intake(BytesIO(pdf), content_length=len(pdf), filename="test.pdf")
    assert service.pdf_path(book["active_revision"]["id"]).read_bytes() == pdf
    with service.database.connect() as c:
        assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_auth_failure_invalidates_only_current_key_and_replace_recovers(beta):
    from reader_service.agent_runtime.runtime import ProviderFailureKind
    guard, adapter, runtime = beta
    guard.credentials.save("first-test-key")
    adapter.failure = ProviderFailure(ProviderFailureKind.USER_ACTIONABLE, "auth", "rejected")
    with pytest.raises(ProviderFailure, match="key_invalid"):
        runtime.complete([])
    assert guard.credentials.status()["validation"] == "INVALID"
    calls = len(adapter.calls)
    with pytest.raises(ProviderFailure):
        runtime.complete([])
    assert len(adapter.calls) == calls
    adapter.failure = None
    guard.replace_key("second-test-key", adapter)
    guard.credentials.invalidate("first-test-key")
    assert guard.credentials.status()["validation"] == "VALIDATED"
    assert runtime.complete([]) == "OK"


def test_malformed_request_never_logs_request_canary(service, beta, capsys):
    import socket
    guard, _, _ = beta
    with server_for_beta(service, guard) as server:
        with socket.create_connection(server.server_address, timeout=3) as sock:
            sock.sendall(b"GET /?key=SECRET_CANARY extra HTTP/1.1\r\nHost: a.example\r\n\r\n")
            assert b"400" in sock.recv(4096)
    captured = capsys.readouterr()
    assert "SECRET_CANARY" not in captured.err + captured.out


def test_low_disk_worker_stays_alive_and_resumes(service):
    import time
    from reader_service.foundation import FoundationRepository, FoundationService
    from reader_service.jobs import JobRepository, PreparationCoordinator
    pdf = make_pdf()
    revision = service.intake(BytesIO(pdf), content_length=len(pdf), filename="pause.pdf")["book"]["active_revision"]
    foundation = FoundationService(service, FoundationRepository(service.database), lambda: None)
    foundation._extract = lambda *args: ("OCR", "fixture:v1", [])
    foundation.ensure_revision(revision["id"])
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(service, foundation, jobs)
    coordinator.start()
    try:
        def low():
            raise DiskSpaceError()
        service.database.growth_check = low
        deadline = time.monotonic()+3
        while not coordinator.disk_paused and time.monotonic() < deadline:
            time.sleep(.02)
        assert coordinator.health()["workers_alive"] == 1
        assert coordinator.disk_paused
        service.database.growth_check = None
        jobs.enqueue_pages(revision["id"], 1, revision["foundation_version"])
        deadline = time.monotonic()+5
        while jobs.counts(revision["id"])["SUCCEEDED"] < 1 and time.monotonic() < deadline:
            time.sleep(.02)
        assert jobs.counts(revision["id"])["SUCCEEDED"] == 1
        assert coordinator.health()["workers_alive"] == 1
    finally:
        coordinator.stop()


def test_beta_response_bounds_and_watchdog(monkeypatch):
    import time
    import socket
    from reader_service.agent_runtime.deepseek import OpenAICompatibleAdapter, _iter_sse_data
    with pytest.raises(ValueError):
        OpenAICompatibleAdapter._bounded_body(BytesIO(b"x"*11), 10)
    with pytest.raises(ProviderFailure):
        list(_iter_sse_data(BytesIO(b":" + b"x"*20), max_bytes=10))
    pair = socket.socketpair()
    class Connection:
        sock = pair[0]
        def __init__(self, *args, **kwargs): pass
        def connect(self): pass
        def request(self, *args, **kwargs): pass
        def getresponse(self):
            while self.sock.recv(1): pass
            raise OSError("closed")
        def close(self): self.sock.close()
    monkeypatch.setattr("reader_service.agent_runtime.deepseek._DeadlineHTTPSConnection", Connection)
    started = time.monotonic()
    try:
        with pytest.raises(ProviderFailure):
            OpenAICompatibleAdapter("deepseek", beta=True).complete(ENDPOINT, "test-key", {"model": MODEL}, .1)
        assert time.monotonic()-started < 1
    finally:
        pair[1].close()


def test_dns_deadline_and_abandoned_resolver_count(monkeypatch):
    import time
    from reader_service.agent_runtime.deepseek import _resolve_before
    release = threading.Event()
    entered = []
    def stalled(*args, **kwargs):
        entered.append(1)
        release.wait(2)
        return []
    monkeypatch.setattr("reader_service.agent_runtime.deepseek.socket.getaddrinfo", stalled)
    try:
        for _ in range(3):
            started = time.monotonic()
            with pytest.raises(TimeoutError):
                _resolve_before("fixture.invalid", 443, started+.05)
            assert time.monotonic()-started < .3
        assert len(entered) == 2
    finally:
        release.set()


def test_key_validation_busy_and_disabled_are_retryable_at_http_boundary(service, beta, monkeypatch):
    guard, adapter, _ = beta
    monkeypatch.setattr("reader_service.agent_runtime.deepseek.OpenAICompatibleAdapter", lambda *a, **kw: adapter)
    with server_for_beta(service, guard) as server:
        cookie = request(server, "/")[1]["Set-Cookie"].split(";")[0]
        headers = {"Cookie": cookie, "Origin": "https://a.example"}
        for active, disabled, code in ((2, False, "ai_busy"), (0, True, "ai_disabled")):
            guard.active = active
            if disabled:
                guard.disabled_file.touch()
            status, _, body = request(server, "/api/beta/key", method="POST", headers=headers, body='{"key":"test-fixture-key"}')
            payload = json.loads(body)
            assert status == 503 and payload["retryable"] and payload["failure_code"] == code
        guard.active = 0
    assert not adapter.calls


def test_beta_all_role_defaults_and_guide_review_same_key_clean_context(service, beta, monkeypatch):
    from uuid import uuid4
    from test_teaching import Runtime, drain
    from test_knowledge_map import build_fixture
    from reader_service.teaching.service import TeachingService
    from reader_service.teaching.inline_service import InlineTeachingService
    from reader_service.learning.service import LearningService
    from reader_service.knowledge import KnowledgeService
    fixture = build_fixture(service)
    for name in ("GUIDED_READER_GUIDE_PROVIDER", "GUIDED_READER_REVIEW_PROVIDER", "GUIDED_READER_MASTER_PROVIDER", "GUIDED_READER_SYSTEM_PROVIDER", "GUIDED_READER_KP_GENERATOR_PROVIDER", "GUIDED_READER_KP_REVIEW_PROVIDER"):
        monkeypatch.setenv(name, "zhipu")
    monkeypatch.setenv("GUIDED_READER_GUIDE_MODEL", "hostile-model")
    guard, adapter, runtime = beta
    guard.credentials.save("one-user-fixture-key")
    responses = Runtime()
    def complete(endpoint, key, body, timeout):
        adapter.calls.append((endpoint, key, body))
        result = responses.complete_for_with_metadata("deepseek", body["messages"])
        return ProviderResponse(result.answer)
    adapter.complete = complete
    guide = TeachingService(service.database, runtime)
    inline = InlineTeachingService(service.database, runtime)
    master = LearningService(service.database, fixture["foundation"], runtime)
    kp = KnowledgeService(service, fixture["foundation"], fixture["outline"], fixture["knowledge"].repository, runtime)
    assert (inline.provider, inline.reviewer, inline.generator_model, inline.reviewer_model) == ("deepseek", "deepseek", MODEL, MODEL)
    assert master.provider == master.reviewer == kp.generator_provider == kp.reviewer_provider == "deepseek"
    fixture["outline"].resolve_chapter_physical(fixture["revision"]["id"], fixture["chapter"]["outline_node_id"])
    revision, section = fixture["revision"]["id"], fixture["sections"][0]["outline_node_id"]
    guide.request(revision, section, str(uuid4()))
    drain(guide)
    assert guide.snapshot(revision, section)["published"]
    assert all(endpoint == ENDPOINT and key == "one-user-fixture-key" and body["model"] == MODEL for endpoint,key,body in adapter.calls)
    review_messages = adapter.calls[-1][2]["messages"]
    assert len(review_messages) == 2
    assert "candidate" in json.loads(review_messages[1]["content"])
    assert "REAL_GUIDE_REASONING_CANARY" not in json.dumps(review_messages)
    responses.reject = True
    previous = guide.snapshot(revision, section)["published"]
    guide.request(revision, section, str(uuid4()), regenerate=True)
    drain(guide)
    assert guide.snapshot(revision, section)["published"] == previous
    assert guide.snapshot(revision, section)["task"]["state"] == "FAILED"


def test_low_disk_restart_retains_read_access_and_recovers_pending_job(service):
    from reader_service.foundation import FoundationRepository, FoundationService
    from reader_service.jobs import JobRepository, PreparationCoordinator
    import time
    pdf = make_pdf()
    revision = service.intake(BytesIO(pdf), content_length=len(pdf), filename="recovery.pdf")["book"]["active_revision"]
    foundation = FoundationService(service, FoundationRepository(service.database), lambda: None)
    foundation.ensure_revision(revision["id"])
    jobs = JobRepository(service.database)
    jobs.enqueue_pages(revision["id"],1,revision["foundation_version"])
    jobs.claim()
    disk = DiskGuard(service.paths.root, usage=lambda _: SimpleNamespace(free=1024**3))
    reopened = LibraryService(service.paths, disk_guard=disk)
    foundation = FoundationService(reopened, FoundationRepository(reopened.database), lambda: None)
    coordinator = PreparationCoordinator(reopened, foundation, JobRepository(reopened.database))
    coordinator.start()
    try:
        deadline=time.monotonic()+2
        while not coordinator.disk_paused and time.monotonic()<deadline:
            time.sleep(.01)
        assert coordinator.disk_paused and coordinator.health()["workers_alive"]==1
        assert reopened.pdf_path(revision["id"]).read_bytes()==pdf
        assert coordinator.jobs.counts(revision["id"])["QUEUED"]==1
    finally:
        coordinator.stop()


def test_deadline_survives_connection_close_body_drip(monkeypatch):
    import socket
    import time
    from http.client import HTTPResponse
    from reader_service.agent_runtime.deepseek import OpenAICompatibleAdapter
    pair=socket.socketpair()
    class Connection:
        sock=pair[0]
        def __init__(self,*args,**kwargs): pass
        def connect(self): pass
        def request(self,*args,**kwargs): pass
        def getresponse(self):
            response=HTTPResponse(self.sock)
            response.begin()
            self.sock=None  # Real HTTPConnection does this for will_close responses.
            return response
        def close(self): pass
    monkeypatch.setattr("reader_service.agent_runtime.deepseek._DeadlineHTTPSConnection",Connection)
    def drip():
        try:
            pair[1].sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")
            for _ in range(30):
                pair[1].sendall(b" ")
                time.sleep(.02)
        except OSError:
            pass
    thread=threading.Thread(target=drip);thread.start()
    start=time.monotonic()
    try:
        with pytest.raises(ProviderFailure):
            OpenAICompatibleAdapter("deepseek",beta=True).complete(ENDPOINT,"fixture-key",{"model":MODEL},.08)
        assert time.monotonic()-start<.4
    finally:
        pair[0].close();pair[1].close();thread.join()
