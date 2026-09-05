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
    OpenAICompatibleAdapter,
    PayloadInspector,
    ProviderConfig,
    ProviderFailure,
    ProviderFailureKind,
    ProviderResponse,
    ProviderRuntimeSet,
)
from reader_service.agent_runtime.credentials import (
    DEEPSEEK_CREDENTIAL_TARGET,
    PROVIDER_CREDENTIAL_TARGETS,
    CredentialRead,
    read_deepseek_api_key,
)
from reader_service.agent_runtime.deepseek import DeepSeekAdapter
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.assistant import AssistantContextBuilder, AssistantService, ScopeResolver
from reader_service.assistant.service import SYSTEM_MESSAGE
from reader_service.assistant.skill import EXPLANATION_SKILL_PATH, load_explanation_skill
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


class NamedMockAdapter(MockAdapter):
    def __init__(self, provider_name, outcomes=(), usage=None):
        super().__init__(outcomes)
        self.provider_name = provider_name
        self.usage = usage

    def complete(self, endpoint, api_key, body, timeout):
        answer = super().complete(endpoint, api_key, body, timeout)
        return ProviderResponse(answer, self.usage)


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


def selection_range(start_boundary: int, end_boundary: int) -> dict:
    return {
        "start": {"line_ordinal": 1, "boundary": start_boundary},
        "end": {"line_ordinal": 1, "boundary": end_boundary},
    }


def runtime(adapter, *, key="dev-secret-key", **overrides):
    config = ProviderConfig(
        endpoint="https://api.deepseek.test/chat/completions",
        model="deepseek-v4-pro",
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


def runtime_set(*, bakeoff_enabled, active_provider="deepseek", keys=None, outcomes=None):
    keys = keys or {name: f"{name}-secret" for name in PROVIDER_CREDENTIAL_TARGETS}
    outcomes = outcomes or {}
    inspector = PayloadInspector(limit=20)
    adapters = {}
    runtimes = {}
    for provider, target in PROVIDER_CREDENTIAL_TARGETS.items():
        adapter = NamedMockAdapter(
            provider,
            outcomes.get(provider, (f"{provider} answer",)),
            {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        )
        adapters[provider] = adapter
        defaults = ProviderConfig.from_environment(provider)
        runtimes[provider] = AgentRuntime(
            adapter,
            config=ProviderConfig(
                provider=provider,
                endpoint=f"https://{provider}.test/chat/completions",
                model=defaults.model,
                credential_target=target,
                max_tokens=defaults.max_tokens,
                max_attempts=1,
            ),
            credential_loader=lambda name=provider: keys.get(name),
            inspector=inspector,
            sleeper=lambda _seconds: None,
        )
    return ProviderRuntimeSet(
        runtimes,
        active_provider=active_provider,
        bakeoff_enabled=bakeoff_enabled,
        inspector=inspector,
    ), adapters


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
        "reader-session-1", revision_id, 3, **selection(3)
    )
    assert first["scope"]["key"] == "SECTION:unique"
    assert first["turns"] == [{"question": "总线事务", "answer": "第一答"}]
    followed = assistant.follow_up(
        "reader-session-1", first["conversation_id"], "为什么？"
    )
    assert followed["conversation_id"] == first["conversation_id"]
    assert [turn["question"] for turn in followed["turns"]] == ["总线事务", "为什么？"]
    follow_messages = adapter.calls[1]["body"]["messages"]
    assert [message["role"] for message in follow_messages] == [
        "system", "user", "assistant", "user"
    ]
    assert follow_messages[-1]["content"] == "为什么？"
    assert "第一答" in follow_messages[2]["content"]
    initial_content = adapter.calls[0]["body"]["messages"][-1]["content"]
    assert initial_content.endswith("【当前解释焦点（用户所选）】\n总线事务")
    assert initial_content.index("【同一 PDF 页的有界 OCR 语境（辅助）】") < initial_content.rindex("总线事务")
    assert "用户问题" not in initial_content
    assert "这是什么意思" not in initial_content
    assert "请只依据" not in initial_content

    page = assistant.ask_selection(
        "reader-session-1", revision_id, 5, **selection(5)
    )
    assert page["scope"]["key"] == "PAGE:5"
    page_payload = json.dumps(adapter.calls[2]["body"], ensure_ascii=False)
    assert "第6章 总线" in page_payload
    assert "6.2.2 同步定时" not in page_payload
    assert "6.2.3 异步定时" not in page_payload
    assert "第一答" not in page_payload
    assert "为什么？" not in page_payload

    section_again = assistant.ask_selection(
        "reader-session-1", revision_id, 3, **selection(3)
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


def test_same_page_selections_keep_distinct_visible_and_provider_focus(assistant_fixture):
    adapter = MockAdapter(["聚焦总线", "聚焦事务"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    revision_id = assistant_fixture["revision_id"]

    first = assistant.ask_selection(
        "reader-session-distinct", revision_id, 3, **selection_range(0, 2)
    )
    second = assistant.ask_selection(
        "reader-session-distinct", revision_id, 3, **selection_range(2, 4)
    )

    assert [turn["question"] for turn in second["turns"]] == ["总线", "事务"]
    first_focus = adapter.calls[0]["body"]["messages"][-1]["content"]
    second_focus = adapter.calls[1]["body"]["messages"][-1]["content"]
    assert first_focus.endswith("【当前解释焦点（用户所选）】\n总线")
    assert second_focus.endswith("【当前解释焦点（用户所选）】\n事务")
    assert first_focus != second_focus
    assert first["conversation_id"] == second["conversation_id"]


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
            **selection(3),
        )
    assert caught.value.kind is ProviderFailureKind.UNCONFIGURED
    assert adapter.calls == []
    assert assistant_fixture["foundation"].overlay(
        assistant_fixture["revision_id"], 3
    )["status"] == "READY"
    assert assistant_fixture["outline"].repository.list(assistant_fixture["revision_id"])


def test_status_reports_secret_safe_readiness_details():
    agent = runtime(MockAdapter(), key="status-secret-never-return")
    status = agent.status()
    assert status["configured"] is True
    assert status["credential_available"] is True
    assert status["configuration_valid"] is True
    assert status["endpoint_valid"] is True
    assert status["model_valid"] is True
    assert status["failure_state"] == "READY"
    assert status["ai_off_reason"] is None
    assert "status-secret-never-return" not in json.dumps(status)


def test_explanation_skill_is_loaded_and_compact():
    skill = load_explanation_skill()
    assert EXPLANATION_SKILL_PATH.is_file()
    assert skill in SYSTEM_MESSAGE
    assert len(skill) <= 1_200
    assert len(skill.splitlines()) <= 20
    assert "教材原文" in SYSTEM_MESSAGE
    assert "可靠的专业或通识知识" in SYSTEM_MESSAGE


def test_status_distinguishes_credential_read_failure_from_invalid_configuration():
    failed = AgentRuntime(
        MockAdapter(),
        credential_loader=lambda: (_ for _ in ()).throw(OSError("secret-like-detail")),
    ).status()
    assert failed["configured"] is False
    assert failed["credential_available"] is False
    assert failed["credential_reason"] == "CREDENTIAL_READ_FAILED"
    assert failed["ai_off_reason"] == "CREDENTIAL_READ_FAILED"
    assert "secret-like-detail" not in json.dumps(failed)

    invalid = AgentRuntime(
        MockAdapter(),
        config=ProviderConfig(endpoint="file:///not-network"),
        credential_loader=lambda: "secret",
    ).status()
    assert invalid["endpoint_valid"] is False
    assert invalid["model_valid"] is True
    assert invalid["ai_off_reason"] == "INVALID_CONFIGURATION"


def test_credential_result_repr_never_contains_secret():
    result = CredentialRead(True, "WINDOWS_CREDENTIAL_MANAGER", None, "repr-secret")
    assert "repr-secret" not in repr(result)


def test_credential_target_and_development_disable(monkeypatch):
    assert DEEPSEEK_CREDENTIAL_TARGET == "408-guided-reader-deepseek"
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_API_KEY", "test-override")
    assert read_deepseek_api_key() == "test-override"
    monkeypatch.setenv("GUIDED_READER_DEEPSEEK_DISABLED", "1")
    assert read_deepseek_api_key() is None


def test_named_provider_defaults_targets_and_environment_overrides(monkeypatch):
    expected = {
        "deepseek": (
            "deepseek-v4-pro",
            "https://api.deepseek.com/chat/completions",
            "408-guided-reader-deepseek",
        ),
        "zhipu": (
            "GLM-5.3-Flash",
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            "408-guided-reader-zhipu",
        ),
        "openrouter": (
            "google/gemini-3.8-flash",
            "https://openrouter.ai/api/v1/chat/completions",
            "408-guided-reader-openrouter",
        ),
    }
    for provider, values in expected.items():
        config = ProviderConfig.from_environment(provider)
        assert (config.model, config.endpoint, config.credential_target) == values
        config.validate()

    monkeypatch.setenv("GUIDED_READER_ZHIPU_ENDPOINT", "https://zhipu.override/v4/chat/completions")
    monkeypatch.setenv("GUIDED_READER_ZHIPU_MAX_TOKENS", "777")
    overridden = ProviderConfig.from_environment("zhipu")
    assert overridden.endpoint == "https://zhipu.override/v4/chat/completions"
    assert overridden.max_tokens == 777
    assert overridden.effective_config()["request_parameters"]["max_tokens"] == 777


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://provider.example/chat/completions",
        "http://192.168.1.8/chat/completions",
        "http://10.0.0.2/chat/completions",
    ],
)
def test_plain_http_non_loopback_endpoint_is_rejected(endpoint):
    with pytest.raises(ValueError, match="loopback"):
        ProviderConfig(endpoint=endpoint).validate()


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://127.0.0.1:8080/chat/completions",
        "http://localhost:8080/chat/completions",
        "http://[::1]:8080/chat/completions",
    ],
)
def test_plain_http_loopback_endpoint_remains_available_for_tests(endpoint):
    ProviderConfig(endpoint=endpoint).validate()


def test_dev_gate_off_routes_only_the_active_provider_and_refuses_comparison():
    providers, adapters = runtime_set(bakeoff_enabled=False, active_provider="zhipu")
    messages = [{"role": "user", "content": "same bounded context"}]
    assert providers.complete(messages) == "zhipu answer"
    assert len(adapters["zhipu"].calls) == 1
    assert adapters["deepseek"].calls == []
    assert adapters["openrouter"].calls == []
    with pytest.raises(ProviderFailure) as caught:
        providers.compare(messages, interaction_id="disabled")
    assert caught.value.code == "bakeoff_disabled"
    assert sum(len(adapter.calls) for adapter in adapters.values()) == 1


def test_selected_provider_is_the_only_call_and_follow_up_stays_pinned(assistant_fixture):
    providers, adapters = runtime_set(bakeoff_enabled=False)
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    revision_id = assistant_fixture["revision_id"]

    first = assistant.ask_selection(
        "reader-session-model-select",
        revision_id,
        3,
        provider="zhipu",
        **selection(3),
    )
    assert first["provider"] == "zhipu"
    assert first["model"] == "GLM-5.3-Flash"
    followed = assistant.follow_up(
        "reader-session-model-select", first["conversation_id"], "为什么？"
    )
    assert followed["provider"] == "zhipu"
    assert followed["conversation_id"] == first["conversation_id"]
    assert len(adapters["zhipu"].calls) == 2
    assert adapters["deepseek"].calls == []
    assert adapters["openrouter"].calls == []

    replacement = assistant.ask_selection(
        "reader-session-model-select",
        revision_id,
        3,
        provider="deepseek",
        **selection(3),
    )
    assert replacement["provider"] == "deepseek"
    assert replacement["model"] == "deepseek-v4-pro"
    assert replacement["conversation_id"] != first["conversation_id"]
    assert len(replacement["turns"]) == 1
    assert len(adapters["deepseek"].calls) == 1
    assert adapters["openrouter"].calls == []


def test_unknown_selected_provider_is_rejected_without_network(assistant_fixture):
    providers, adapters = runtime_set(bakeoff_enabled=False)
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    with pytest.raises(ProviderFailure) as caught:
        assistant.ask_selection(
            "reader-session-invalid-model",
            assistant_fixture["revision_id"],
            3,
            provider="not-a-provider",
            **selection(3),
        )
    assert caught.value.code == "invalid_active_provider"
    assert all(adapter.calls == [] for adapter in adapters.values())


def test_bakeoff_fans_out_identical_controlled_input_and_records_effective_config():
    providers, adapters = runtime_set(bakeoff_enabled=True)
    messages = [
        {"role": "system", "content": SYSTEM_MESSAGE},
        {"role": "user", "content": "PAGE\nOCR\n当前解释焦点：机器周期"},
    ]
    results = providers.compare(messages, interaction_id="comparison-1")
    assert [result["provider"] for result in results] == ["deepseek", "zhipu", "openrouter"]
    assert all(result["answer"] for result in results)
    assert all(result["usage"]["total_tokens"] == 15 for result in results)
    assert all(result["latency_ms"] >= 0 for result in results)
    bodies = [adapters[name].calls[0]["body"] for name in ("deepseek", "zhipu", "openrouter")]
    assert all(body["messages"] == messages for body in bodies)
    assert {body["temperature"] for body in bodies} == {0.2}
    assert [body["max_tokens"] for body in bodies] == [4096, 4096, 900]
    assert [body["model"] for body in bodies] == [
        "deepseek-v4-pro", "GLM-5.3-Flash", "google/gemini-3.8-flash"
    ]
    for result in results:
        effective = result["effective_config"]
        assert effective["intent"] == {
            "answer_length": "concise", "reasoning_strength": "balanced"
        }
        assert effective["parameter_mapping"]["reasoning_strength"].startswith("omitted")
    inspected = providers.inspector.snapshot()
    assert {item["provider"] for item in inspected} == {
        "deepseek", "zhipu", "openrouter"
    }
    inspected_text = json.dumps(inspected)
    assert "-secret" not in inspected_text
    assert "Authorization" not in inspected_text


def test_bakeoff_missing_credential_and_provider_failure_are_isolated():
    transient = ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "zhipu 暂时不可用。"
    )
    providers, adapters = runtime_set(
        bakeoff_enabled=True,
        keys={"deepseek": "deepseek-secret", "openrouter": "openrouter-secret"},
        outcomes={"zhipu": (transient,)},
    )
    results = providers.compare(
        [{"role": "user", "content": "bounded"}], interaction_id="missing-zhipu"
    )
    by_name = {result["provider"]: result for result in results}
    assert by_name["zhipu"]["available"] is False
    assert by_name["zhipu"]["error"]["kind"] == "UNCONFIGURED"
    assert adapters["zhipu"].calls == []
    assert by_name["deepseek"]["answer"] == "deepseek answer"
    assert by_name["openrouter"]["answer"] == "openrouter answer"

    failing, failing_adapters = runtime_set(
        bakeoff_enabled=True,
        outcomes={"zhipu": (transient,)},
    )
    isolated = {result["provider"]: result for result in failing.compare(
        [{"role": "user", "content": "bounded"}], interaction_id="failing-zhipu"
    )}
    assert isolated["zhipu"]["error"]["kind"] == "TRANSIENT"
    assert len(failing_adapters["zhipu"].calls) == 1
    assert isolated["deepseek"]["answer"]
    assert isolated["openrouter"]["answer"]


def test_bakeoff_selection_is_memory_only_and_close_clears_it(assistant_fixture):
    providers, adapters = runtime_set(bakeoff_enabled=True)
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    comparison = assistant.bake_off_selection(
        "reader-session-bakeoff",
        assistant_fixture["revision_id"],
        3,
        **selection(3),
    )
    assert comparison["question"] == "总线事务"
    assert comparison["scope"]["key"] == "SECTION:unique"
    assert assistant.conversation_count() == 0
    assert assistant.comparison_count() == 1
    messages = [adapters[name].calls[0]["body"]["messages"] for name in PROVIDER_CREDENTIAL_TARGETS]
    assert messages[0] == messages[1] == messages[2]
    assert messages[0][0]["content"] == SYSTEM_MESSAGE
    assert messages[0][-1]["content"].endswith("【当前解释焦点（用户所选）】\n总线事务")
    typed = assistant.bake_off_selection(
        "reader-session-bakeoff",
        assistant_fixture["revision_id"],
        3,
        question="机器周期就等于总线周期？",
        **selection(3),
    )
    assert typed["question"] == "机器周期就等于总线周期？"
    assert typed["selected_text"] == "总线事务"
    typed_messages = [adapters[name].calls[1]["body"]["messages"] for name in PROVIDER_CREDENTIAL_TARGETS]
    assert typed_messages[0] == typed_messages[1] == typed_messages[2]
    assert typed_messages[0][-1]["content"].endswith("【用户问题】\n机器周期就等于总线周期？")
    assistant.close_session("reader-session-bakeoff")
    assert assistant.comparison_count() == 0
    with assistant_fixture["database"].connect() as connection:
        names = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert not any("benchmark" in name or "bake" in name or "comparison" in name for name in names)


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
    adapter = MockAdapter(["memory-only-answer", "memory-only-follow-up-answer"])
    agent = runtime(adapter)
    first_process = AssistantService(assistant_fixture["contexts"], agent)
    conversation = first_process.ask_selection(
        "reader-session-memory",
        assistant_fixture["revision_id"],
        3,
        **selection(3),
    )
    first_process.follow_up(
        "reader-session-memory", conversation["conversation_id"], "unique-follow-up-never-persist"
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
            assert b"unique-follow-up-never-persist" not in content
            assert b"memory-only-answer" not in content
            assert b"memory-only-follow-up-answer" not in content


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


def test_openrouter_model_region_failure_is_specific_and_secret_safe():
    body = json.dumps({
        "error": {"message": "This model is not available in your region top-secret-value"}
    }).encode()
    error = HTTPError(
        "https://openrouter.ai/api/v1/chat/completions",
        403,
        "remote status",
        {},
        BytesIO(body),
    )
    with pytest.raises(ProviderFailure) as caught:
        OpenAICompatibleAdapter("openrouter")._raise_http_failure(error)
    assert caught.value.code == "model_region"
    assert caught.value.kind is ProviderFailureKind.USER_ACTIONABLE
    assert "top-secret-value" not in caught.value.user_message


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
                {"model": "deepseek-v4-pro", "messages": []},
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
            "question": "不应成为用户可见消息",
        }, ensure_ascii=False).encode()
        _, asked = request_json(
            f"{base}/api/revisions/{revision_id}/assistant/ask",
            token,
            method="POST",
            data=body,
            headers={"Content-Type": "application/json"},
        )
        conversation = asked["conversation"]
        assert conversation["turns"][0]["question"] == "总线事务"
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
