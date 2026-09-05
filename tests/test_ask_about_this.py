from __future__ import annotations

import json
import logging
import threading
from collections import deque
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError

import pytest

from conftest import make_pdf
from reader_service.agent_runtime import (
    AgentRuntime,
    PayloadInspector,
    ProviderConfig,
    ProviderFailure,
    ProviderFailureKind,
)
from reader_service.agent_runtime.credentials import (
    DEEPSEEK_CREDENTIAL_TARGET,
    read_deepseek_api_key,
)
from reader_service.agent_runtime.deepseek import DeepSeekAdapter
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.assistant import AssistantContextBuilder, AssistantService, ScopeResolver
from reader_service.foundation import (
    DetectedLine,
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.outline import OutlineRepository, OutlineService


class NeverEngine:
    def prepare_page(self, page_image, page_size):
        raise AssertionError("not used")


class MockAdapter:
    provider_name = "deepseek"

    def __init__(self, outcomes=()):
        self.calls = []
        self.outcomes = deque(outcomes)

    def complete(self, endpoint, api_key, body, timeout):
        self.calls.append({
            "endpoint": endpoint,
            "api_key": api_key,
            "body": body,
            "timeout": timeout,
        })
        outcome = self.outcomes.popleft() if self.outcomes else "这是结合当前教材上下文的中文解释。"
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def line(text: str, y: float) -> DetectedLine:
    width = 0.75 / max(1, len(text))
    cells = tuple(
        (0.1 + index * width, 0.1 + (index + 1) * width, index, index + 1)
        for index in range(len(text))
    )
    return DetectedLine(
        quad=((0.1, y), (0.85, y), (0.85, y + 0.03), (0.1, y + 0.03)),
        text=text,
        confidence=0.99,
        cells=cells,
    )


def node(node_id, parent_id, depth, order, kind, title, start_page):
    return {
        "outline_node_id": node_id,
        "parent_id": parent_id,
        "depth": depth,
        "order_index": order,
        "kind": kind,
        "title": title,
        "printed_label_hint": None,
        "start_page": start_page,
        "confidence": 1.0,
        "evidence": {"source": "BOOKMARK", "path": [order]},
    }


@pytest.fixture
def assistant_fixture(service):
    pdf = make_pdf(tuple((612, 792) for _ in range(8)))
    imported = service.intake(BytesIO(pdf), content_length=len(pdf), filename="assistant.pdf")
    revision_id = imported["book"]["active_revision"]["id"]
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, NeverEngine)
    foundation.ensure_revision(revision_id)
    for page_index in (0, 3, 5):
        assert foundation_repository.mark_preparing(revision_id, page_index)
        foundation_repository.publish_page(
            revision_id,
            page_index,
            route="OCR",
            foundation_version=1,
            engine_profile="fixture:v1",
            lines=[
                line(f"第{page_index}页前文", 0.10),
                line("总线事务由地址、数据和控制阶段组成", 0.18),
                line("同步总线使用统一时钟协调各部件", 0.26),
                line("第3页后文" if page_index == 3 else "本页后文", 0.34),
            ],
        )
    labels_repository = PageLabelRepository(service.database)
    labels_repository.ensure_unknown_rows(revision_id, 8)
    labels = PageLabelService(service, labels_repository)
    labels.set_manual(revision_id, 3, "291")
    outline_repository = OutlineRepository(service.database)
    outline_repository.commit(
        revision_id,
        [
            node("chapter", None, 0, 0, "CHAPTER", "第6章 总线", 1),
            node("section", "chapter", 1, 0, "SECTION", "6.2 总线事务和定时", 2),
            node("unique", "section", 2, 0, "SUBSECTION", "6.2.1 总线事务", 3),
            node("ambiguous-a", "section", 2, 1, "SUBSECTION", "6.2.2 同步定时", 5),
            node("ambiguous-b", "section", 2, 2, "SUBSECTION", "6.2.3 异步定时", 5),
            node("after", "section", 2, 3, "SUBSECTION", "6.2.4 总线标准", 7),
        ],
        parser_version="fixture:v1",
        evidence_source="BOOKMARK",
        evidence_digest="fixture-evidence",
        structure_digest="fixture-structure",
    )
    outline = OutlineService(service, outline_repository, labels)
    contexts = AssistantContextBuilder(foundation, outline)
    return {
        "revision_id": revision_id,
        "foundation": foundation,
        "outline": outline,
        "contexts": contexts,
        "database": service.database,
        "data_root": service.paths.root,
    }


def selection(_page_index: int) -> dict:
    return {
        "start": {"line_ordinal": 1, "boundary": 0},
        "end": {"line_ordinal": 1, "boundary": 4},
    }


def runtime(adapter, *, key="dev-secret-key", **overrides):
    config = ProviderConfig(
        endpoint="https://api.deepseek.test/chat/completions",
        model="deepseek-chat",
        max_attempts=overrides.pop("max_attempts", 3),
        cooling_seconds=overrides.pop("cooling_seconds", 30),
        **overrides,
    )
    return AgentRuntime(
        adapter,
        config=config,
        credential_loader=lambda: key,
        inspector=PayloadInspector(limit=8),
        sleeper=lambda _seconds: None,
    )


def test_scope_resolution_is_honest_and_context_is_bounded(assistant_fixture):
    contexts = assistant_fixture["contexts"]
    revision_id = assistant_fixture["revision_id"]
    unique = contexts.build(revision_id, 3, **selection(3))
    assert unique["scope"].key == "SECTION:unique"
    assert unique["scope"].section_title == "6.2.1 总线事务"
    assert unique["scope"].chapter_title == "第6章 总线"
    assert unique["printed_page_label"] == "291"
    assert unique["selected_text"] == "总线事务"
    assert len(unique["same_page_ocr_context"]) <= 1600

    ambiguous = contexts.build(revision_id, 5, **selection(5))
    assert ambiguous["scope"].key == "PAGE:5"
    assert ambiguous["scope"].section_title is None
    assert ambiguous["scope"].chapter_title == "第6章 总线"

    front = contexts.build(revision_id, 0, **selection(0))
    assert front["scope"].key == "PAGE:0"
    assert front["scope"].chapter_title is None


def test_selection_ask_follow_up_payload_and_scope_isolation(assistant_fixture):
    adapter = MockAdapter(["第一答", "追问答", "页面答", "回到节答"])
    agent = runtime(adapter)
    assistant = AssistantService(assistant_fixture["contexts"], agent)
    revision_id = assistant_fixture["revision_id"]

    first = assistant.ask_selection(
        "reader-session-1", revision_id, 3, question="这是什么意思", **selection(3)
    )
    assert first["scope"]["key"] == "SECTION:unique"
    assert first["turns"] == [{"question": "这是什么意思", "answer": "第一答"}]
    followed = assistant.follow_up(
        "reader-session-1", first["conversation_id"], "为什么？"
    )
    assert followed["conversation_id"] == first["conversation_id"]
    assert [turn["question"] for turn in followed["turns"]] == ["这是什么意思", "为什么？"]
    follow_messages = adapter.calls[1]["body"]["messages"]
    assert [message["role"] for message in follow_messages] == [
        "system", "user", "assistant", "user"
    ]
    assert "第一答" in follow_messages[2]["content"]

    page = assistant.ask_selection(
        "reader-session-1", revision_id, 5, question="页面问题", **selection(5)
    )
    assert page["scope"]["key"] == "PAGE:5"
    page_payload = json.dumps(adapter.calls[2]["body"], ensure_ascii=False)
    assert "第6章 总线" in page_payload
    assert "6.2.2 同步定时" not in page_payload
    assert "6.2.3 异步定时" not in page_payload
    assert "第一答" not in page_payload
    assert "为什么？" not in page_payload

    section_again = assistant.ask_selection(
        "reader-session-1", revision_id, 3, question="回到本节", **selection(3)
    )
    assert section_again["conversation_id"] == first["conversation_id"]
    assert page["conversation_id"] != first["conversation_id"]
    assert "页面答" not in json.dumps(adapter.calls[3]["body"], ensure_ascii=False)

    inspected = agent.inspector.snapshot()
    assert inspected[-1]["request_body"] == adapter.calls[-1]["body"]
    assert {call["endpoint"] for call in adapter.calls} == {
        "https://api.deepseek.test/chat/completions"
    }
    inspection_text = json.dumps(inspected, ensure_ascii=False)
    assert "总线事务" in inspection_text
    assert "291" in inspection_text
    assert "dev-secret-key" not in inspection_text
    assert "Authorization" not in inspection_text


def test_no_provider_means_zero_network_and_reader_data_stays_available(assistant_fixture):
    adapter = MockAdapter()
    agent = runtime(adapter, key="")
    assistant = AssistantService(assistant_fixture["contexts"], agent)
    assert assistant.status()["configured"] is False
    with pytest.raises(ProviderFailure) as caught:
        assistant.ask_selection(
            "reader-session-off",
            assistant_fixture["revision_id"],
            3,
            question="这是什么意思",
            **selection(3),
        )
    assert caught.value.kind is ProviderFailureKind.UNCONFIGURED
    assert adapter.calls == []
    assert assistant_fixture["foundation"].overlay(
        assistant_fixture["revision_id"], 3
    )["status"] == "READY"
    assert assistant_fixture["outline"].repository.list(assistant_fixture["revision_id"])


def test_credential_target_and_development_disable(monkeypatch):
    assert DEEPSEEK_CREDENTIAL_TARGET == "408-guided-reader-deepseek"
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_API_KEY", "test-override")
    assert read_deepseek_api_key() == "test-override"
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_DISABLED", "1")
    assert read_deepseek_api_key() is None


def test_invalid_provider_configuration_disables_only_ai():
    adapter = MockAdapter()
    agent = AgentRuntime(
        adapter,
        config=ProviderConfig(endpoint="file:///not-network"),
        credential_loader=lambda: "secret",
    )
    assert agent.status()["configured"] is False
    with pytest.raises(ProviderFailure) as caught:
        agent.complete([{"role": "user", "content": "bounded"}])
    assert caught.value.kind is ProviderFailureKind.UNCONFIGURED
    assert adapter.calls == []


def test_transient_retry_is_bounded_and_cooling_short_circuits():
    transient = lambda: ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "AI 服务暂时无法连接，请稍后再试。"
    )
    adapter = MockAdapter([transient(), transient(), transient(), "恢复"])
    now = [100.0]
    agent = AgentRuntime(
        adapter,
        config=ProviderConfig(
            endpoint="https://api.deepseek.test/chat/completions",
            max_attempts=3,
            cooling_seconds=10,
        ),
        credential_loader=lambda: "secret",
        sleeper=lambda _seconds: None,
        clock=lambda: now[0],
    )
    with pytest.raises(ProviderFailure) as exhausted:
        agent.complete([{"role": "user", "content": "bounded"}])
    assert exhausted.value.kind is ProviderFailureKind.TRANSIENT
    assert len(adapter.calls) == 3
    with pytest.raises(ProviderFailure) as cooling:
        agent.complete([{"role": "user", "content": "bounded"}])
    assert cooling.value.kind is ProviderFailureKind.COOLING
    assert len(adapter.calls) == 3
    now[0] += 11
    assert agent.complete([{"role": "user", "content": "bounded"}]) == "恢复"
    assert len(adapter.calls) == 4


@pytest.mark.parametrize("code", ["auth", "quota"])
def test_user_actionable_provider_failures_do_not_retry_or_leak_secret(code, caplog):
    failure = ProviderFailure(
        ProviderFailureKind.USER_ACTIONABLE, code, "请检查 DeepSeek 账户配置。"
    )
    adapter = MockAdapter([failure])
    agent = runtime(adapter, key="top-secret-value")
    caplog.set_level(logging.INFO, logger="reader_service.agent_runtime")
    with pytest.raises(ProviderFailure) as caught:
        agent.complete([{"role": "user", "content": "教材正文 sentinel-context"}])
    assert caught.value.code == code
    assert len(adapter.calls) == 1
    log_text = caplog.text
    assert "top-secret-value" not in log_text
    assert "sentinel-context" not in log_text
    inspection_text = json.dumps(agent.inspector.snapshot(), ensure_ascii=False)
    assert "top-secret-value" not in inspection_text
    assert "Authorization" not in inspection_text


def test_conversations_are_memory_only_clear_on_close_and_restart(assistant_fixture):
    adapter = MockAdapter(["memory-only-answer"])
    agent = runtime(adapter)
    first_process = AssistantService(assistant_fixture["contexts"], agent)
    conversation = first_process.ask_selection(
        "reader-session-memory",
        assistant_fixture["revision_id"],
        3,
        question="unique-question-never-persist",
        **selection(3),
    )
    assert first_process.conversation_count() == 1

    restarted = AssistantService(assistant_fixture["contexts"], runtime(MockAdapter()))
    assert restarted.conversation_count() == 0
    with pytest.raises(LookupError):
        restarted.follow_up(
            "reader-session-memory", conversation["conversation_id"], "还有吗"
        )

    first_process.close_session("reader-session-memory")
    assert first_process.conversation_count() == 0
    with assistant_fixture["database"].connect() as connection:
        names = {
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    assert not any("assistant" in name or "conversation" in name for name in names)
    for path in assistant_fixture["data_root"].rglob("*"):
        if path.is_file():
            content = path.read_bytes()
            assert b"unique-question-never-persist" not in content
            assert b"memory-only-answer" not in content


def test_notes_and_highlights_are_not_context_inputs(assistant_fixture):
    foundation = assistant_fixture["foundation"]
    annotations = AnnotationService(
        foundation, AnnotationRepository(assistant_fixture["database"])
    )
    annotations.create_text(
        assistant_fixture["revision_id"],
        page_index=3,
        start=selection(3)["start"],
        end=selection(3)["end"],
        body="private-note-must-never-egress",
    )
    adapter = MockAdapter(["答"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    assistant.ask_selection(
        "reader-session-private",
        assistant_fixture["revision_id"],
        3,
        question="解释",
        **selection(3),
    )
    payload = json.dumps(adapter.calls[0]["body"], ensure_ascii=False)
    assert "private-note-must-never-egress" not in payload


def test_follow_up_history_has_a_hard_character_bound(assistant_fixture):
    adapter = MockAdapter(["答" * 12_000, "有界追问答"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    first = assistant.ask_selection(
        "reader-session-bounds",
        assistant_fixture["revision_id"],
        3,
        question="解释",
        **selection(3),
    )
    assistant.follow_up("reader-session-bounds", first["conversation_id"], "继续")
    prior = adapter.calls[1]["body"]["messages"][1:-1]
    assert sum(len(message["content"]) for message in prior) <= 8_000


def test_scope_resolver_does_not_mutate_outline(assistant_fixture):
    repository = assistant_fixture["outline"].repository
    before = repository.list(assistant_fixture["revision_id"])
    resolver = ScopeResolver(assistant_fixture["outline"])
    for page_index in range(8):
        resolver.resolve(assistant_fixture["revision_id"], page_index)
    after = repository.list(assistant_fixture["revision_id"])
    assert after == before


@pytest.mark.parametrize(
    ("status", "message", "kind"),
    [
        (401, "invalid top-secret-value", ProviderFailureKind.USER_ACTIONABLE),
        (402, "billing top-secret-value", ProviderFailureKind.USER_ACTIONABLE),
        (429, "rate limit top-secret-value", ProviderFailureKind.TRANSIENT),
        (429, "insufficient balance top-secret-value", ProviderFailureKind.USER_ACTIONABLE),
        (500, "remote top-secret-value", ProviderFailureKind.TRANSIENT),
        (400, "bad top-secret-value", ProviderFailureKind.USER_ACTIONABLE),
        (302, "redirect top-secret-value", ProviderFailureKind.USER_ACTIONABLE),
    ],
)
def test_deepseek_http_failures_are_typed_and_remote_body_is_never_reflected(
    status, message, kind
):
    body = json.dumps({"error": {"message": message}}).encode()
    error = HTTPError(
        "https://api.deepseek.test/chat/completions",
        status,
        "remote status",
        {},
        BytesIO(body),
    )
    with pytest.raises(ProviderFailure) as caught:
        DeepSeekAdapter._raise_http_failure(error)
    assert caught.value.kind is kind
    assert "top-secret-value" not in caught.value.user_message
    assert "top-secret-value" not in str(caught.value)


def test_deepseek_adapter_refuses_redirect_to_second_endpoint():
    hits = []

    class RedirectingHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            hits.append(self.path)
            if self.path == "/chat/completions":
                self.send_response(302)
                self.send_header("Location", "/second-endpoint")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"choices":[{"message":{"content":"unsafe"}}]}')

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), RedirectingHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(ProviderFailure):
            DeepSeekAdapter().complete(
                f"http://127.0.0.1:{server.server_port}/chat/completions",
                "secret",
                {"model": "deepseek-chat", "messages": []},
                2,
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert hits == ["/chat/completions"]


def test_assistant_http_contract_round_trips_and_close_clears(assistant_fixture):
    from test_api import request_json, running_server

    adapter = MockAdapter(["HTTP 第一答", "HTTP 追问答"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    revision_id = assistant_fixture["revision_id"]
    with running_server(
        assistant_fixture["foundation"].library,
        outline=assistant_fixture["outline"],
        assistant=assistant,
    ) as (base, token):
        _, status = request_json(f"{base}/api/assistant/status", token)
        assert status["configured"] is True
        body = json.dumps({
            "reader_session_id": "reader-session-http",
            "pdf_page_index": 3,
            **selection(3),
            "question": "这是什么意思",
        }, ensure_ascii=False).encode()
        _, asked = request_json(
            f"{base}/api/revisions/{revision_id}/assistant/ask",
            token,
            method="POST",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        conversation = asked["conversation"]
        assert conversation["turns"][0]["answer"] == "HTTP 第一答"
        follow = json.dumps({
            "reader_session_id": "reader-session-http",
            "conversation_id": conversation["conversation_id"],
            "question": "为什么？",
        }, ensure_ascii=False).encode()
        _, followed = request_json(
            f"{base}/api/assistant/follow-up",
            token,
            method="POST",
            data=follow,
            headers={"Content-Type": "application/json"},
        )
        assert len(followed["conversation"]["turns"]) == 2
        _, inspection = request_json(f"{base}/api/assistant/inspection", token)
        assert len(inspection["calls"]) == 2
        close = json.dumps({"reader_session_id": "reader-session-http"}).encode()
        from urllib.request import Request, urlopen
        request = Request(
            f"{base}/api/assistant/close",
            method="POST",
            data=close,
            headers={"X-Reader-Token": token, "Content-Type": "application/json"},
        )
        with urlopen(request) as response:
            assert response.status == 204
        assert assistant.conversation_count() == 0
