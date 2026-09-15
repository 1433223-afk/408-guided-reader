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
import reader_service.agent_runtime.deepseek as provider_adapter
from reader_service.agent_runtime.deepseek import DeepSeekAdapter
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.assistant import (
    AssistantContextBuilder,
    AssistantService,
    AssistantStateError,
    ScopeResolution,
    ScopeResolver,
    SelectionSourceKind,
)
from reader_service.assistant.service import AssistantNode, Turn
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


class StreamingMockAdapter(MockAdapter):
    def stream(self, endpoint, api_key, body, timeout, on_delta, on_reasoning_delta=None):
        self.calls.append({
            "endpoint": endpoint,
            "api_key": api_key,
            "body": body,
            "timeout": timeout,
        })
        outcome = self.outcomes.popleft() if self.outcomes else ["真实", "增量"]
        if isinstance(outcome, Exception):
            raise outcome
        for delta in outcome:
            if isinstance(delta, Exception):
                raise delta
            on_delta(delta)
        answer = "".join(outcome)
        return ProviderResponse(
            answer,
            {"prompt_tokens": 10, "completion_tokens": len(outcome), "total_tokens": 10 + len(outcome)},
        )


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


def focused(state: dict) -> dict:
    assert state["current"] is not None
    return state["current"]


def runtime(adapter, *, key="dev-secret-key", **overrides):
    config = ProviderConfig(
        endpoint="https://api.deepseek.test/chat/completions",
        model="deepseek-flash",
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

    first_state = assistant.ask_selection(
        "reader-session-1", revision_id, 3, **selection(3)
    )
    first = focused(first_state)
    assert first["scope"]["key"] == "SECTION:unique"
    assert [
        {"question": turn["question"], "answer": turn["answer"]}
        for turn in first["turns"]
    ] == [{"question": "总线事务", "answer": "第一答"}]
    followed_state = assistant.follow_up(
        "reader-session-1", first["root_id"], "为什么？"
    )
    followed = focused(followed_state)
    assert followed["root_id"] == first["root_id"]
    assert [turn["question"] for turn in followed["turns"]] == ["总线事务", "为什么？"]
    follow_messages = adapter.calls[1]["body"]["messages"]
    assert [message["role"] for message in follow_messages] == [
        "system", "user", "assistant", "user"
    ]
    assert follow_messages[-1]["content"] == "为什么？"
    assert "第一答" in follow_messages[2]["content"]
    initial_content = adapter.calls[0]["body"]["messages"][-1]["content"]
    assert initial_content.startswith("【当前解释焦点（用户所选）】\n总线事务\n")
    assert initial_content.index("【当前解释焦点（用户所选）】") < initial_content.index(
        "【教材定位（仅用于定位和消歧）】"
    )
    assert initial_content.index("【教材定位（仅用于定位和消歧）】") < initial_content.index(
        "【同一 PDF 页的有界 OCR 语境（辅助）】"
    )
    assert "用户问题" not in initial_content
    assert "这是什么意思" not in initial_content
    assert "请只依据" not in initial_content

    page_state = assistant.ask_selection(
        "reader-session-1", revision_id, 5, **selection(5)
    )
    page = focused(page_state)
    assert page["scope"]["key"] == "PAGE:5"
    page_payload = json.dumps(adapter.calls[2]["body"], ensure_ascii=False)
    assert "第6章 总线" in page_payload
    assert "6.2.2 同步定时" not in page_payload
    assert "6.2.3 异步定时" not in page_payload
    assert "第一答" not in page_payload
    assert "为什么？" not in page_payload

    section_again_state = assistant.ask_selection(
        "reader-session-1", revision_id, 3, **selection(3)
    )
    section_again = focused(section_again_state)
    assert section_again["root_id"] != first["root_id"]
    assert page["root_id"] != first["root_id"]
    assert len(section_again_state["roots"]) == 3
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


def test_root_follow_up_and_child_stream_without_changing_context_contract(
    assistant_fixture,
):
    adapter = StreamingMockAdapter([
        ["地址码", "是地址字段。"],
        ["地址字段", "用于选择位置。"],
        ["地址字段", "就是用来定位的字段。"],
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-stream-contract"

    root_events = []
    root_state = assistant.ask_selection(
        session_id,
        assistant_fixture["revision_id"],
        3,
        **selection(3),
        stream=root_events.append,
    )
    assert [event["type"] for event in root_events] == [
        "stage", "delta", "delta", "complete",
    ]
    assert root_events[0]["stage"] == "answering"
    assert "".join(event["content"] for event in root_events if event["type"] == "delta") == "地址码是地址字段。"
    assert root_events[-1]["metrics"]["output_tokens"] == 2
    assert focused(root_state)["turns"][0]["question"] == "总线事务"

    follow_events = []
    followed = assistant.follow_up(
        session_id,
        focused(root_state)["root_id"],
        "为什么？",
        stream=follow_events.append,
    )
    assert focused(followed)["depth"] == 1
    assert len(focused(followed)["turns"]) == 2
    assert "".join(event["content"] for event in follow_events if event["type"] == "delta") == "地址字段用于选择位置。"

    current = focused(followed)
    first_turn = current["turns"][-1]
    start = first_turn["answer"].index("地址字段")
    child_events = []
    child = assistant.create_child(
        session_id,
        current["root_id"],
        parent_node_id=None,
        turn_id=first_turn["turn_id"],
        start_offset=start,
        end_offset=start + len("地址字段"),
        stream=child_events.append,
    )
    assert focused(child)["depth"] == 2
    assert focused(child)["turns"][0]["question"] == "地址字段"
    child_payload = adapter.calls[2]["body"]
    assert child_payload["stream"] is True
    assert child_payload["messages"][-1]["content"].startswith(
        "【当前解释焦点（用户所选）】\n地址字段"
    )
    assert "地址字段用于选择位置。" in child_payload["messages"][-1]["content"]
    assert len(child_payload["messages"]) == 2


def test_same_page_selections_keep_distinct_visible_and_provider_focus(assistant_fixture):
    adapter = MockAdapter(["聚焦总线", "聚焦事务"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    revision_id = assistant_fixture["revision_id"]

    first_state = assistant.ask_selection(
        "reader-session-distinct", revision_id, 3, **selection_range(0, 2)
    )
    second_state = assistant.ask_selection(
        "reader-session-distinct", revision_id, 3, **selection_range(2, 4)
    )

    first = focused(first_state)
    second = focused(second_state)
    assert [turn["question"] for turn in first["turns"]] == ["总线"]
    assert [turn["question"] for turn in second["turns"]] == ["事务"]
    first_focus = adapter.calls[0]["body"]["messages"][-1]["content"]
    second_focus = adapter.calls[1]["body"]["messages"][-1]["content"]
    assert first_focus.startswith("【当前解释焦点（用户所选）】\n总线\n")
    assert second_focus.startswith("【当前解释焦点（用户所选）】\n事务\n")
    assert first_focus != second_focus
    assert first["root_id"] != second["root_id"]
    assert len(second_state["roots"]) == 2


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
            "deepseek-flash",
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


def test_named_provider_per_call_token_budget_override_keeps_default_unchanged():
    providers, adapters = runtime_set(
        bakeoff_enabled=False,
        outcomes={"deepseek": ("large structured answer", "ordinary answer")},
    )
    messages = [{"role": "user", "content": "bounded"}]
    overridden = providers.complete_for_with_metadata(
        "deepseek", messages, interaction_id="large-structure", max_tokens=12_288
    )
    defaulted = providers.complete_for_with_metadata(
        "deepseek", messages, interaction_id="ordinary-assistant"
    )

    assert [call["body"]["max_tokens"] for call in adapters["deepseek"].calls] == [
        12_288, 4096,
    ]
    assert overridden.effective_config["request_parameters"]["max_tokens"] == 12_288
    assert defaulted.effective_config["request_parameters"]["max_tokens"] == 4096
    with pytest.raises(ValueError, match="between 1 and 16384"):
        providers.complete_for_with_metadata("deepseek", messages, max_tokens=16_385)


def test_named_provider_per_call_thinking_mode_is_explicit_and_provider_scoped():
    providers, adapters = runtime_set(bakeoff_enabled=False)
    messages = [{"role": "user", "content": "bounded"}]

    deepseek = providers.complete_for_with_metadata(
        "deepseek", messages, thinking_mode="disabled"
    )
    zhipu = providers.complete_for_with_metadata(
        "zhipu", messages, reasoning_effort="low"
    )

    assert adapters["deepseek"].calls[-1]["body"]["thinking"] == {
        "type": "disabled"
    }
    assert adapters["zhipu"].calls[-1]["body"]["reasoning_effort"] == "low"
    assert deepseek.effective_config["request_parameters"]["thinking"] == "disabled"
    assert zhipu.effective_config["request_parameters"]["reasoning_effort"] == "low"
    with pytest.raises(ValueError, match="invalid for the selected provider"):
        providers.complete_for_with_metadata(
            "openrouter", messages, thinking_mode="disabled"
        )


def test_selected_provider_is_the_only_call_and_follow_up_stays_pinned(assistant_fixture):
    providers, adapters = runtime_set(bakeoff_enabled=False)
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    revision_id = assistant_fixture["revision_id"]

    first_state = assistant.ask_selection(
        "reader-session-model-select",
        revision_id,
        3,
        provider="zhipu",
        **selection(3),
    )
    first = focused(first_state)
    assert first["provider"] == "zhipu"
    assert first["model"] == "GLM-5.3-Flash"
    followed_state = assistant.follow_up(
        "reader-session-model-select", first["root_id"], "为什么？"
    )
    followed = focused(followed_state)
    assert followed["provider"] == "zhipu"
    assert followed["root_id"] == first["root_id"]
    assert len(adapters["zhipu"].calls) == 2
    assert all(
        call["body"]["reasoning_effort"] == "low"
        for call in adapters["zhipu"].calls
    )
    assert adapters["deepseek"].calls == []
    assert adapters["openrouter"].calls == []

    replacement_state = assistant.ask_selection(
        "reader-session-model-select",
        revision_id,
        3,
        provider="deepseek",
        **selection(3),
    )
    replacement = focused(replacement_state)
    assert replacement["provider"] == "deepseek"
    assert replacement["model"] == "deepseek-flash"
    assert replacement["root_id"] != first["root_id"]
    assert len(replacement["turns"]) == 1
    assert len(replacement_state["roots"]) == 2
    assert len(adapters["deepseek"].calls) == 1
    assert adapters["deepseek"].calls[0]["body"]["thinking"] == {
        "type": "disabled"
    }
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
        "deepseek-flash", "GLM-5.3-Flash", "google/gemini-3.8-flash"
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
    assert messages[0][-1]["content"].startswith(
        "【当前解释焦点（用户所选）】\n总线事务\n"
    )
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
    assert typed_messages[0][-1]["content"].startswith(
        "【当前解释焦点（用户所选）】\n总线事务\n\n"
        "【用户问题】\n机器周期就等于总线周期？\n"
    )
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


def test_streaming_runtime_uses_real_deltas_usage_and_ttft():
    adapter = StreamingMockAdapter([["地", "址", "码"]])
    agent = runtime(adapter)
    deltas = []
    result = agent.stream_with_metadata(
        [{"role": "user", "content": "bounded"}],
        deltas.append,
        interaction_id="stream-metrics",
    )
    assert deltas == ["地", "址", "码"]
    assert result.answer == "地址码"
    assert result.ttft_ms is not None
    assert result.latency_ms >= result.ttft_ms
    assert result.usage["completion_tokens"] == 3
    assert adapter.calls[0]["body"]["stream"] is True
    assert adapter.calls[0]["body"]["stream_options"] == {"include_usage": True}
    assert result.effective_config["request_parameters"]["stream"] is True


def test_streaming_runtime_retries_only_before_visible_content():
    transient = ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "暂时失败"
    )
    before_content = StreamingMockAdapter([transient, ["恢复"]])
    recovered = runtime(before_content, max_attempts=2)
    deltas = []
    assert recovered.stream_with_metadata(
        [{"role": "user", "content": "bounded"}], deltas.append
    ).answer == "恢复"
    assert len(before_content.calls) == 2
    assert deltas == ["恢复"]

    after_content = StreamingMockAdapter([["部分", transient]])
    interrupted = runtime(after_content, max_attempts=3)
    partial = []
    with pytest.raises(ProviderFailure) as caught:
        interrupted.stream_with_metadata(
            [{"role": "user", "content": "bounded"}], partial.append
        )
    assert len(after_content.calls) == 1
    assert partial == ["部分"]
    assert caught.value.diagnostics["partial_content_received"] is True
    assert caught.value.diagnostics["ttft_ms"] is not None


def test_streaming_runtime_treats_reasoning_as_visible_only_when_exposed():
    transient = ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "暂时失败"
    )

    class ReasoningThenFailureAdapter(MockAdapter):
        def stream(
            self, endpoint, api_key, body, timeout, on_delta,
            on_reasoning_delta=None,
        ):
            self.calls.append({"body": body})
            if on_reasoning_delta is not None:
                on_reasoning_delta("内部推理")
            if len(self.calls) == 1:
                raise transient
            on_delta("恢复")
            return ProviderResponse("恢复")

    hidden_adapter = ReasoningThenFailureAdapter()
    hidden_runtime = runtime(hidden_adapter, max_attempts=2)
    answer_deltas = []
    completion = hidden_runtime.stream_with_metadata(
        [{"role": "user", "content": "bounded"}], answer_deltas.append
    )
    assert completion.answer == "恢复"
    assert answer_deltas == ["恢复"]
    assert len(hidden_adapter.calls) == 2

    visible_adapter = ReasoningThenFailureAdapter()
    visible_runtime = runtime(visible_adapter, max_attempts=2)
    reasoning_deltas = []
    with pytest.raises(ProviderFailure) as caught:
        visible_runtime.stream_with_metadata(
            [{"role": "user", "content": "bounded"}],
            lambda _delta: None,
            reasoning_deltas.append,
        )
    assert reasoning_deltas == ["内部推理"]
    assert len(visible_adapter.calls) == 1
    assert caught.value.diagnostics["partial_content_received"] is True
    assert caught.value.diagnostics["ttft_ms"] is not None


def test_assistant_provider_budgets_match_current_fast_and_light_reasoning_modes(
    assistant_fixture,
):
    providers, adapters = runtime_set(bakeoff_enabled=False)
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    revision_id = assistant_fixture["revision_id"]

    assistant.ask_selection(
        "reader-session-deepseek-budget", revision_id, 3,
        provider="deepseek", **selection(3),
    )
    assistant.ask_selection(
        "reader-session-zhipu-budget", revision_id, 3,
        provider="zhipu", **selection(3),
    )

    assert adapters["deepseek"].calls[-1]["body"]["max_tokens"] == 8_192
    assert adapters["deepseek"].calls[-1]["body"]["thinking"] == {"type": "disabled"}
    assert adapters["zhipu"].calls[-1]["body"]["max_tokens"] == 16_384
    assert adapters["zhipu"].calls[-1]["body"]["reasoning_effort"] == "low"


def test_length_limited_root_can_explicitly_continue_without_rewriting_user_message(
    assistant_fixture,
):
    length_limit = ProviderFailure(
        ProviderFailureKind.TRANSIENT,
        "response_length_limit",
        "回答达到长度上限，未能完整结束；已保留收到的内容，可以继续生成。",
    )
    adapter = StreamingMockAdapter([["未完成", length_limit], ["后续完成"]])
    agent = runtime(adapter)
    assistant = AssistantService(assistant_fixture["contexts"], agent)
    session_id = "reader-session-root-continuation"
    revision_id = assistant_fixture["revision_id"]
    partial_events = []

    with pytest.raises(ProviderFailure) as caught:
        assistant.ask_selection(
            session_id, revision_id, 3, stream=partial_events.append, **selection(3)
        )
    assert caught.value.code == "response_length_limit"
    assert [event.get("content") for event in partial_events if event["type"] == "delta"] == [
        "未完成"
    ]
    assert agent.status()["cooling"] is False

    completed = assistant.ask_selection(
        session_id,
        revision_id,
        3,
        stream=lambda _event: None,
        continuation={"partial_answer": "未完成"},
        **selection(3),
    )
    turn = focused(completed)["turns"][0]
    assert turn["question"] == "总线事务"
    assert turn["answer"] == "未完成后续完成"
    continuation_messages = adapter.calls[-1]["body"]["messages"]
    assert [message["role"] for message in continuation_messages] == [
        "system", "user", "assistant", "user",
    ]
    assert continuation_messages[-2]["content"] == "未完成"
    assert "从中断处直接继续" in continuation_messages[-1]["content"]


def test_length_limited_follow_up_and_child_continue_at_the_same_level_and_identity(
    assistant_fixture,
):
    def limited():
        return ProviderFailure(
            ProviderFailureKind.TRANSIENT,
            "response_length_limit",
            "回答达到长度上限，未能完整结束；已保留收到的内容，可以继续生成。",
        )

    adapter = StreamingMockAdapter([
        ["根回答含概念"],
        ["追问前半", limited()],
        ["追问后半"],
        ["子回答前半", limited()],
        ["子回答后半"],
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-level-continuation"
    state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3,
        stream=lambda _event: None, **selection(3),
    )
    root_id = focused(state)["root_id"]

    with pytest.raises(ProviderFailure):
        assistant.follow_up(
            session_id, root_id, "为什么？", stream=lambda _event: None
        )
    state = assistant.follow_up(
        session_id,
        root_id,
        "为什么？",
        stream=lambda _event: None,
        continuation={"partial_answer": "追问前半"},
    )
    assert focused(state)["depth"] == 1
    assert focused(state)["turns"][-1]["question"] == "为什么？"
    assert focused(state)["turns"][-1]["answer"] == "追问前半追问后半"

    parent = focused(state)
    source_turn = parent["turns"][-1]
    node_id = "continued-child"
    with pytest.raises(ProviderFailure):
        assistant.create_child(
            session_id,
            root_id,
            parent_node_id=None,
            turn_id=source_turn["turn_id"],
            start_offset=source_turn["answer"].index("追问"),
            end_offset=source_turn["answer"].index("追问") + len("追问"),
            node_id=node_id,
            stream=lambda _event: None,
        )
    state = assistant.retry_child(
        session_id,
        root_id,
        node_id,
        stream=lambda _event: None,
        continuation={"partial_answer": "子回答前半"},
    )
    assert focused(state)["node_id"] == node_id
    assert focused(state)["depth"] == 2
    assert focused(state)["turns"][0]["question"] == "追问"
    assert focused(state)["turns"][0]["answer"] == "子回答前半子回答后半"


@pytest.mark.parametrize("continuation", [
    {},
    {"partial_answer": ""},
    {"partial_answer": "x" * 16_001},
    {"partial_answer": "ok", "unexpected": True},
])
def test_assistant_continuation_is_bounded_and_shape_checked(
    assistant_fixture, continuation
):
    assistant = AssistantService(assistant_fixture["contexts"], runtime(MockAdapter()))
    with pytest.raises(ValueError):
        assistant.ask_selection(
            "reader-session-invalid-continuation",
            assistant_fixture["revision_id"],
            3,
            continuation=continuation,
            **selection(3),
        )


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
    conversation_state = first_process.ask_selection(
        "reader-session-memory",
        assistant_fixture["revision_id"],
        3,
        **selection(3),
    )
    conversation = focused(conversation_state)
    first_process.follow_up(
        "reader-session-memory", conversation["root_id"], "unique-follow-up-never-persist"
    )
    assert first_process.conversation_count() == 1

    restarted = AssistantService(assistant_fixture["contexts"], runtime(MockAdapter()))
    assert restarted.conversation_count() == 0
    with pytest.raises(LookupError):
        restarted.follow_up(
            "reader-session-memory", conversation["root_id"], "还有吗"
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
    first_state = assistant.ask_selection(
        "reader-session-bounds",
        assistant_fixture["revision_id"],
        3,
        **selection(3),
    )
    first = focused(first_state)
    assistant.follow_up("reader-session-bounds", first["root_id"], "继续")
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


def test_external_openrouter_call_fails_closed_without_proxy(monkeypatch):
    monkeypatch.setattr(provider_adapter, "_configured_openrouter_proxy", lambda: None)
    with pytest.raises(ProviderFailure) as caught:
        OpenAICompatibleAdapter("openrouter").complete(
            "https://openrouter.ai/api/v1/chat/completions",
            "openrouter-test-secret",
            {"model": "google/gemini-3.8-flash", "messages": []},
            1,
        )
    assert caught.value.code == "proxy_required"
    assert caught.value.kind is ProviderFailureKind.USER_ACTIONABLE
    assert "openrouter-test-secret" not in str(caught.value)


def test_external_openrouter_call_refuses_proxy_bypass(monkeypatch):
    monkeypatch.setattr(
        provider_adapter,
        "_configured_openrouter_proxy",
        lambda: "http://127.0.0.1:7890",
    )
    monkeypatch.setattr(provider_adapter, "proxy_bypass", lambda _host: True)
    with pytest.raises(ProviderFailure) as caught:
        OpenAICompatibleAdapter("openrouter").complete(
            "https://openrouter.ai/api/v1/chat/completions",
            "openrouter-test-secret",
            {"model": "google/gemini-3.8-flash", "messages": []},
            1,
        )
    assert caught.value.code == "proxy_bypass_forbidden"
    assert caught.value.kind is ProviderFailureKind.USER_ACTIONABLE
    assert "openrouter-test-secret" not in str(caught.value)


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
                {"model": "deepseek-flash", "messages": []},
                2,
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert hits == ["/chat/completions"]


@pytest.mark.parametrize("provider", ["deepseek", "zhipu"])
def test_openai_compatible_stream_parser_handles_fragmented_utf8_done_and_usage(
    monkeypatch, provider
):
    wire = (
        'data: {"choices":[{"delta":{"reasoning_content":"private"},"finish_reason":null}]}\r\n\r\n'
        'data: {"choices":[{"delta":{"content":"地"},"finish_reason":null}]}\n\n'
        'data: {"choices":[{"delta":{"content":"址码"},"finish_reason":"stop"}],'
        '"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n'
        'data: [DONE]\n\n'
    ).encode("utf-8")
    fragments = deque([wire[:83], wire[83:117], wire[117:149], wire[149:]])

    class FragmentedResponse:
        headers = {"Content-Type": "text/event-stream; charset=utf-8"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read1(self, _size):
            return fragments.popleft() if fragments else b""

    class Opener:
        def open(self, *_args, **_kwargs):
            return FragmentedResponse()

    monkeypatch.setattr(provider_adapter, "build_opener", lambda *_args: Opener())
    deltas = []
    reasoning_deltas = []
    result = OpenAICompatibleAdapter(provider).stream(
        "http://127.0.0.1:9999/chat/completions",
        "stream-secret",
        {"model": "test", "messages": [], "stream": True},
        2,
        deltas.append,
        reasoning_deltas.append,
    )
    assert deltas == ["地", "址码"]
    assert reasoning_deltas == ["private"]
    assert result.answer == "地址码"
    assert result.usage == {
        "prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10,
    }
    assert result.diagnostics["reasoning_length"] == len("private")


@pytest.mark.parametrize("provider", ["deepseek", "zhipu"])
def test_openai_compatible_stream_rejects_length_limited_partial_answer(
    monkeypatch, provider
):
    wire = (
        'data: {"choices":[{"delta":{"content":"还没说完 | 维度 |"},'
        '"finish_reason":"length"}],"usage":{"prompt_tokens":7,'
        '"completion_tokens":4096,"total_tokens":4103}}\n\n'
        'data: [DONE]\n\n'
    ).encode("utf-8")
    fragments = deque([wire[:53], wire[53:]])

    class FragmentedResponse:
        headers = {"Content-Type": "text/event-stream; charset=utf-8"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read1(self, _size):
            return fragments.popleft() if fragments else b""

    class Opener:
        def open(self, *_args, **_kwargs):
            return FragmentedResponse()

    monkeypatch.setattr(provider_adapter, "build_opener", lambda *_args: Opener())
    deltas = []
    with pytest.raises(ProviderFailure) as caught:
        OpenAICompatibleAdapter(provider).stream(
            "http://127.0.0.1:9999/chat/completions",
            "stream-secret",
            {"model": "test", "messages": [], "stream": True},
            2,
            deltas.append,
        )

    assert deltas == ["还没说完 | 维度 |"]
    assert caught.value.kind is ProviderFailureKind.TRANSIENT
    assert caught.value.code == "response_length_limit"
    assert caught.value.user_message == (
        "回答达到长度上限，未能完整结束；已保留收到的内容，可以继续生成。"
    )
    assert caught.value.diagnostics["finish_reason"] == "length"
    assert caught.value.diagnostics["usage"]["completion_tokens"] == 4096


def test_openai_compatible_nonstream_rejects_length_limited_partial_answer(
    monkeypatch,
):
    payload = json.dumps({
        "choices": [{
            "message": {"content": "未完成的答案"},
            "finish_reason": "length",
        }],
        "usage": {"prompt_tokens": 4, "completion_tokens": 4096, "total_tokens": 4100},
    }).encode("utf-8")

    class Response(BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class Opener:
        def open(self, *_args, **_kwargs):
            return Response(payload)

    monkeypatch.setattr(provider_adapter, "build_opener", lambda *_args: Opener())
    with pytest.raises(ProviderFailure) as caught:
        OpenAICompatibleAdapter("deepseek").complete(
            "http://127.0.0.1:9999/chat/completions",
            "secret",
            {"model": "test", "messages": []},
            2,
        )

    assert caught.value.code == "response_length_limit"
    assert caught.value.diagnostics["content_length"] == len("未完成的答案")


def test_empty_response_attempt_observer_retains_only_safe_finish_usage_and_lengths():
    reasoning_canary = "PRIVATE_REASONING_BODY_MUST_NOT_BE_RETAINED"

    class EmptyResponseHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers["Content-Length"])
            self.rfile.read(length)
            payload = json.dumps({
                "choices": [{
                    "message": {"content": "", "reasoning_content": reasoning_canary},
                    "finish_reason": "length",
                }],
                "usage": {
                    "prompt_tokens": 101,
                    "completion_tokens": 202,
                    "total_tokens": 303,
                },
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), EmptyResponseHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    events = []
    runtime = AgentRuntime(
        OpenAICompatibleAdapter("deepseek"),
        config=ProviderConfig(
            provider="deepseek",
            endpoint=f"http://127.0.0.1:{server.server_port}/chat/completions",
            model="deepseek-flash",
            credential_target=DEEPSEEK_CREDENTIAL_TARGET,
            max_attempts=1,
        ),
        credential_loader=lambda: "empty-response-test-secret",
    )
    try:
        with pytest.raises(ProviderFailure) as caught:
            runtime.complete_with_metadata(
                [{"role": "user", "content": "bounded"}],
                interaction_id="empty-response-observability",
                attempt_observer=events.append,
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert caught.value.code == "empty_response"
    assert [event["status"] for event in events] == ["STARTED", "FAILED"]
    failed = events[-1]
    assert failed["finish_reason"] == "length"
    assert failed["usage"] == {
        "prompt_tokens": 101, "completion_tokens": 202, "total_tokens": 303,
    }
    assert failed["content_present"] is False
    assert failed["content_length"] == 0
    assert failed["reasoning_present"] is True
    assert failed["reasoning_length"] == len(reasoning_canary)
    serialized = json.dumps({"failure": caught.value.diagnostics, "events": events})
    assert reasoning_canary not in serialized
    assert "empty-response-test-secret" not in serialized


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
        current = asked["assistant"]["current"]
        assert current["turns"][0]["question"] == "总线事务"
        assert current["turns"][0]["answer"] == "HTTP 第一答"
        follow = json.dumps({
            "reader_session_id": "reader-session-http",
            "root_id": current["root_id"],
            "node_id": None,
            "question": "为什么？",
        }, ensure_ascii=False).encode()
        _, followed = request_json(
            f"{base}/api/assistant/follow-up",
            token,
            method="POST",
            data=follow,
            headers={"Content-Type": "application/json"},
        )
        assert len(followed["assistant"]["current"]["turns"]) == 2
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


def test_assistant_http_stream_exposes_real_lifecycle_deltas_and_metrics(assistant_fixture):
    from test_api import running_server
    from urllib.request import Request, urlopen

    adapter = StreamingMockAdapter([["地", "址码"]])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    revision_id = assistant_fixture["revision_id"]
    body = json.dumps({
        "reader_session_id": "reader-session-http-stream",
        "pdf_page_index": 3,
        **selection(3),
    }, ensure_ascii=False).encode()
    with running_server(
        assistant_fixture["foundation"].library,
        outline=assistant_fixture["outline"],
        assistant=assistant,
    ) as (base, token):
        request = Request(
            f"{base}/api/revisions/{revision_id}/assistant/ask",
            method="POST",
            data=body,
            headers={
                "X-Reader-Token": token,
                "X-Assistant-View": "current",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
        )
        with urlopen(request) as response:
            assert response.headers["Content-Type"].startswith("text/event-stream")
            wire = response.read().decode("utf-8")
    events = [
        json.loads(line.removeprefix("data: "))
        for line in wire.splitlines()
        if line.startswith("data: ")
    ]
    assert [event["type"] for event in events] == [
        "stage", "stage", "delta", "delta", "complete",
    ]
    assert [event.get("stage") for event in events[:2]] == ["preparing", "answering"]
    assert "".join(event["content"] for event in events if event["type"] == "delta") == "地址码"
    complete = events[-1]
    assert complete["assistant"]["current"]["turns"][0]["answer"] == "地址码"
    assert "turns" not in complete["assistant"]["roots"][0]
    assert complete["metrics"]["output_tokens"] == 2
    assert adapter.calls[0]["body"]["stream"] is True


def create_child_for_text(
    assistant: AssistantService,
    session_id: str,
    state: dict,
    text: str,
) -> dict:
    current = focused(state)
    turn = current["turns"][-1]
    start = turn["answer"].index(text)
    return assistant.create_child(
        session_id,
        current["root_id"],
        parent_node_id=current["node_id"],
        turn_id=turn["turn_id"],
        start_offset=start,
        end_offset=start + len(text),
    )


def test_ask_deeper_depth_one_through_five_and_same_level_at_limit(assistant_fixture):
    adapter = MockAdapter([
        "第一层含有概念甲",
        "第二层含有概念乙",
        "第三层含有概念丙",
        "第四层含有概念丁",
        "第五层回答",
        "第五层继续回答",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-depth"
    state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    assert focused(state)["depth"] == 1
    for expected_depth, text in enumerate(("概念甲", "概念乙", "概念丙", "概念丁"), start=2):
        state = create_child_for_text(assistant, session_id, state, text)
        assert focused(state)["depth"] == expected_depth

    depth_five = focused(state)
    node_count = len(state["roots"][0]["nodes"])
    with pytest.raises(AssistantStateError) as blocked:
        create_child_for_text(assistant, session_id, state, "第五层")
    assert blocked.value.code == "CHILD_DEPTH_LIMIT_REACHED"
    assert len(adapter.calls) == 5
    followed = assistant.follow_up(
        session_id,
        depth_five["root_id"],
        "还能继续同层追问吗？",
        node_id=depth_five["node_id"],
    )
    assert focused(followed)["depth"] == 5
    assert len(focused(followed)["turns"]) == 2
    assert len(followed["roots"][0]["nodes"]) == node_count


def test_assistant_answer_source_cannot_open_root(assistant_fixture):
    adapter = MockAdapter()
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    with pytest.raises(AssistantStateError) as blocked:
        assistant.ask_selection(
            "reader-session-source-gate",
            assistant_fixture["revision_id"],
            3,
            source_kind=SelectionSourceKind.ASSISTANT_ANSWER,
            **selection(3),
        )
    assert blocked.value.code == "ASSISTANT_SOURCE_REQUIRES_CHILD"
    assert adapter.calls == []
    assert assistant.conversation_count() == 0


def test_multiple_roots_focus_retention_and_close_subtree_only(assistant_fixture):
    adapter = MockAdapter(["第一树回答含子概念", "第一树第二层", "第二树回答"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-multi-root"
    root_one_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_one_id = focused(root_one_state)["root_id"]
    root_one_child_state = create_child_for_text(
        assistant, session_id, root_one_state, "子概念"
    )
    child_id = focused(root_one_child_state)["node_id"]

    root_two_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 5, **selection(5)
    )
    root_two_id = focused(root_two_state)["root_id"]
    assert len(root_two_state["roots"]) == 2
    assert {root["scope"]["key"] for root in root_two_state["roots"]} == {
        "SECTION:unique", "PAGE:5"
    }

    switched = assistant.focus(session_id, root_one_id, node_id=child_id)
    assert focused(switched)["depth"] == 2
    assert focused(switched)["turns"][0]["answer"] == "第一树第二层"
    closed = assistant.close_root(session_id, root_one_id)
    assert len(closed["roots"]) == 1
    assert closed["roots"][0]["root_id"] == root_two_id
    assert focused(closed)["root_id"] == root_two_id
    assert all(node["node_id"] != child_id for root in closed["roots"] for node in root["nodes"])


def test_child_payload_is_minimal_and_never_walks_other_roots_or_ancestors(assistant_fixture):
    adapter = MockAdapter([
        "ROOT_PARENT_SENTINEL 含父概念",
        "OTHER_ROOT_SENTINEL",
        "CHILD_PARENT_SENTINEL 含孙概念",
        "第三层回答",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-child-context"
    root_one = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_one_id = focused(root_one)["root_id"]
    root_two = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 5, **selection(5)
    )
    assistant.focus(session_id, root_one_id)
    child_state = create_child_for_text(
        assistant, session_id, assistant.state(session_id), "父概念"
    )
    child_payload = adapter.calls[2]["body"]["messages"]
    assert [message["role"] for message in child_payload] == ["system", "user"]
    child_text = child_payload[-1]["content"]
    assert child_text.startswith("【当前解释焦点（用户所选）】\n父概念\n")
    assert "ROOT_PARENT_SENTINEL 含父概念" in child_text
    assert "焦点或问题：总线事务" in child_text
    assert "总线事务 › 父概念" in child_text
    assert "总线事务" in child_text
    assert "Reader 范围：第6章 总线 › 6.2.1 总线事务" in child_text
    assert "PDF 页码：4" in child_text
    assert "291" in child_text
    assert "OTHER_ROOT_SENTINEL" not in child_text
    assert "PAGE:5" not in child_text
    assert "SECTION" not in child_text
    assert "ORIGINAL_PDF" not in child_text
    assert "字符范围" not in child_text
    assert "父子关系" not in child_text

    grandchild_state = create_child_for_text(
        assistant, session_id, child_state, "孙概念"
    )
    grandchild_payload = adapter.calls[3]["body"]["messages"]
    assert [message["role"] for message in grandchild_payload] == ["system", "user"]
    grandchild_text = grandchild_payload[-1]["content"]
    assert grandchild_text.startswith("【当前解释焦点（用户所选）】\n孙概念\n")
    assert "CHILD_PARENT_SENTINEL 含孙概念" in grandchild_text
    assert "总线事务 › 父概念 › 孙概念" in grandchild_text
    assert "ROOT_PARENT_SENTINEL" not in grandchild_text
    assert "OTHER_ROOT_SENTINEL" not in grandchild_text
    assert "PAGE:5" not in grandchild_text
    assert focused(grandchild_state)["depth"] == 3
    assert len(root_two["roots"]) == 2


def test_child_transport_body_is_allowlisted_and_metadata_canaries_never_egress(
    assistant_fixture,
):
    captured_bodies = []
    answers = deque([
        "时钟脉冲信号像乐队里的节拍器",
        "这个比喻强调统一节奏如何协调不同部件。",
    ])

    class CapturingProviderHandler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            length = int(self.headers["Content-Length"])
            captured_bodies.append(json.loads(self.rfile.read(length)))
            payload = json.dumps({
                "choices": [{"message": {"content": answers.popleft()}}]
            }, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), CapturingProviderHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    inspector = PayloadInspector(limit=8)
    agent = AgentRuntime(
        OpenAICompatibleAdapter("deepseek"),
        config=ProviderConfig(
            provider="deepseek",
            endpoint=f"http://127.0.0.1:{server.server_port}/chat/completions",
            model="deepseek-flash",
            credential_target=DEEPSEEK_CREDENTIAL_TARGET,
            max_attempts=1,
        ),
        credential_loader=lambda: "transport-test-secret",
        inspector=inspector,
    )
    assistant = AssistantService(assistant_fixture["contexts"], agent)
    session_id = "reader-session-transport-canary"
    try:
        root_state = assistant.ask_selection(
            session_id, assistant_fixture["revision_id"], 3, **selection(3)
        )
        root_id = focused(root_state)["root_id"]
        slot = assistant._sessions[session_id]
        with slot.lock:
            root = slot.state.roots[root_id]
            root.reader_session_id = "ROOT_METADATA_CANARY"
            root.scope = ScopeResolution(
                key="BRANCH_CANARY",
                kind="ORIGINAL_PDF",
                pdf_page_index=3,
                section_id="PARENT_CHILD_RELATIONSHIP_CANARY",
                section_title="6.2.1 总线事务",
                chapter_title="第6章 总线",
            )
            root.reference_context.update({
                "root_metadata": "ROOT_METADATA_CANARY",
                "parent_child_relationship": "PARENT_CHILD_RELATIONSHIP_CANARY",
                "active_child": "ACTIVE_CHILD_CANARY",
                "branch": "BRANCH_CANARY",
                "offset": "OFFSET_CANARY",
            })
            root.turns[-1].provider_user_content = "\n".join((
                "ROOT_METADATA_CANARY",
                "PARENT_CHILD_RELATIONSHIP_CANARY",
                "ACTIVE_CHILD_CANARY",
                "BRANCH_CANARY",
                "OFFSET_CANARY",
                "ASSISTANT_ANSWER",
            ))

        create_child_for_text(
            assistant, session_id, root_state, "像乐队里的节拍器"
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert len(captured_bodies) == 2
    transport_body = captured_bodies[-1]
    assert inspector.snapshot()[-1]["request_body"] == transport_body
    assert [message["role"] for message in transport_body["messages"]] == [
        "system", "user"
    ]
    user_content = transport_body["messages"][-1]["content"]
    assert user_content.startswith(
        "【当前解释焦点（用户所选）】\n像乐队里的节拍器\n"
    )
    assert user_content.index("【直接上一轮】") > user_content.index("【当前解释焦点")
    assert user_content.index("【解释路径") > user_content.index("【直接上一轮】")
    assert user_content.index("【Reader 教材依据") > user_content.index("【解释路径")
    assert "焦点或问题：总线事务" in user_content
    assert "完整讲解：时钟脉冲信号像乐队里的节拍器" in user_content
    assert "总线事务 › 像乐队里的节拍器" in user_content
    assert "PDF 页码：4" in user_content
    assert "同一 PDF 页的有界 OCR 语境" in user_content
    body_text = json.dumps(transport_body, ensure_ascii=False)
    for canary in (
        "ROOT_METADATA_CANARY",
        "PARENT_CHILD_RELATIONSHIP_CANARY",
        "ACTIVE_CHILD_CANARY",
        "BRANCH_CANARY",
        "OFFSET_CANARY",
        "ORIGINAL_PDF",
        "ASSISTANT_ANSWER",
    ):
        assert canary not in body_text
    for metadata_label in (
        "Root",
        "Child",
        "Node",
        "父子关系",
        "parent/child relationship",
        "active child",
        "branch ID",
        "当前解释深度",
        "深度 2/5",
        "字符范围",
        "active_child_id",
        "focusedNodeId",
        "request ID",
        "pending",
        "scroll position",
        "subtree",
    ):
        assert metadata_label not in body_text
    assert "transport-test-secret" not in body_text


def test_child_projection_ignores_sibling_answers(assistant_fixture):
    adapter = MockAdapter([
        "根层讲解包含第一焦点",
        "当前路径讲解包含下一焦点",
        "更深层讲解",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-sibling-isolation"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    child_state = create_child_for_text(
        assistant, session_id, root_state, "第一焦点"
    )
    root_id = focused(child_state)["root_id"]
    slot = assistant._sessions[session_id]
    with slot.lock:
        root = slot.state.roots[root_id]
        sibling_id = "historical-sibling-node"
        root.nodes[sibling_id] = AssistantNode(
            node_id=sibling_id,
            parent_node_id=None,
            depth=2,
            selected_text="SIBLING_FOCUS_CANARY",
            turns=[Turn(
                "historical-sibling-turn",
                "SIBLING_QUESTION_CANARY",
                "SIBLING_ANSWER_CANARY",
                "SIBLING_PROVIDER_CONTEXT_CANARY",
            )],
        )

    create_child_for_text(assistant, session_id, child_state, "下一焦点")
    body_text = json.dumps(adapter.calls[-1]["body"], ensure_ascii=False)
    assert "当前路径讲解包含下一焦点" in body_text
    assert "总线事务 › 第一焦点 › 下一焦点" in body_text
    assert "SIBLING_FOCUS_CANARY" not in body_text
    assert "SIBLING_QUESTION_CANARY" not in body_text
    assert "SIBLING_ANSWER_CANARY" not in body_text
    assert "SIBLING_PROVIDER_CONTEXT_CANARY" not in body_text


def test_rendered_markdown_source_spans_reconstruct_exact_visible_focus(assistant_fixture):
    raw = "粗体前**高低电平**粗体后"
    adapter = MockAdapter([raw, "精确映射后的解释"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-rendered-source-spans"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    current = focused(root_state)
    bold_start = raw.index("高低电平")
    suffix_start = raw.index("粗体后")
    child_state = assistant.create_child(
        session_id,
        current["root_id"],
        parent_node_id=None,
        turn_id=current["turns"][-1]["turn_id"],
        start_offset=0,
        end_offset=len(raw),
        source_spans=[
            {"start": 0, "end": raw.index("**")},
            {"start": bold_start, "end": bold_start + len("高低电平")},
            {"start": suffix_start, "end": len(raw)},
        ],
    )
    assert focused(child_state)["turns"][0]["question"] == "粗体前高低电平粗体后"
    transport = adapter.calls[-1]["body"]["messages"][-1]["content"]
    assert transport.startswith(
        "【当前解释焦点（用户所选）】\n粗体前高低电平粗体后\n"
    )
    assert "**" not in transport.split("【直接上一轮】", 1)[0]


def test_rendered_source_spans_reject_overlap_without_provider_call(assistant_fixture):
    adapter = MockAdapter(["重复短语重复短语"])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-invalid-source-spans"
    state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    current = focused(state)
    with pytest.raises(AssistantStateError) as rejected:
        assistant.create_child(
            session_id,
            current["root_id"],
            parent_node_id=None,
            turn_id=current["turns"][-1]["turn_id"],
            start_offset=0,
            end_offset=4,
            source_spans=[{"start": 0, "end": 4}, {"start": 2, "end": 6}],
        )
    assert rejected.value.code == "INVALID_ANSWER_SELECTION"
    assert len(adapter.calls) == 1


def test_depth_five_projection_contains_only_direct_previous_full_answer(
    assistant_fixture,
):
    adapter = MockAdapter([
        "ANCESTOR_DEPTH_ONE_FULL_ANSWER；其中有第二层焦点",
        "ANCESTOR_DEPTH_TWO_FULL_ANSWER；其中有第三层焦点",
        "ANCESTOR_DEPTH_THREE_FULL_ANSWER；其中有第四层焦点",
        "DIRECT_DEPTH_FOUR_FULL_ANSWER；其中有第五层焦点",
        "第五层最终解释",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-depth-five-context"
    state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    for text in ("第二层焦点", "第三层焦点", "第四层焦点", "第五层焦点"):
        state = create_child_for_text(assistant, session_id, state, text)

    assert focused(state)["depth"] == 5
    final_text = adapter.calls[-1]["body"]["messages"][-1]["content"]
    assert final_text.startswith("【当前解释焦点（用户所选）】\n第五层焦点\n")
    assert "焦点或问题：第四层焦点" in final_text
    assert "完整讲解：DIRECT_DEPTH_FOUR_FULL_ANSWER；其中有第五层焦点" in final_text
    assert "总线事务 › 第二层焦点 › 第三层焦点 › 第四层焦点 › 第五层焦点" in final_text
    assert "ANCESTOR_DEPTH_ONE_FULL_ANSWER" not in final_text
    assert "ANCESTOR_DEPTH_TWO_FULL_ANSWER" not in final_text
    assert "ANCESTOR_DEPTH_THREE_FULL_ANSWER" not in final_text


def test_provider_and_model_remain_pinned_across_complete_root_tree(assistant_fixture):
    providers, adapters = runtime_set(
        bakeoff_enabled=False,
        outcomes={"zhipu": ("根回答包含锁定概念", "子回答", "同层回答")},
    )
    assistant = AssistantService(assistant_fixture["contexts"], providers)
    session_id = "reader-session-tree-provider"
    root_state = assistant.ask_selection(
        session_id,
        assistant_fixture["revision_id"],
        3,
        provider="zhipu",
        **selection(3),
    )
    child_state = create_child_for_text(
        assistant, session_id, root_state, "锁定概念"
    )
    child = focused(child_state)
    followed = assistant.follow_up(
        session_id, child["root_id"], "继续", node_id=child["node_id"]
    )
    assert focused(followed)["provider"] == "zhipu"
    assert focused(followed)["model"] == "GLM-5.3-Flash"
    assert len(adapters["zhipu"].calls) == 3
    assert adapters["deepseek"].calls == []
    assert adapters["openrouter"].calls == []


def test_provider_failure_keeps_only_typed_failed_child_attempt_and_retry_identity_is_stable(
    assistant_fixture,
):
    transient = ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "AI 服务暂时不可用。"
    )
    failing_adapter = MockAdapter(["父回答含失败概念", transient])
    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(failing_adapter, max_attempts=1)
    )
    session_id = "reader-session-child-failure"
    parent_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    with pytest.raises(ProviderFailure):
        create_child_for_text(assistant, session_id, parent_state, "失败概念")
    failed = assistant.state(session_id)
    assert focused(failed)["depth"] == 2
    assert focused(failed)["pending"] is False
    assert focused(failed)["error"] == "AI 服务暂时不可用。"
    assert focused(failed)["turns"] == []
    assert len(failed["roots"][0]["nodes"]) == 1
    assert failed["roots"][0]["child_pending"] is False

    retry_adapter = MockAdapter([transient, "重试后成功"])
    retry_runtime = runtime(retry_adapter, max_attempts=2)
    retry_assistant = AssistantService(assistant_fixture["contexts"], retry_runtime)
    retried = retry_assistant.ask_selection(
        "reader-session-retry-id", assistant_fixture["revision_id"], 3, **selection(3)
    )
    inspected = retry_runtime.inspector.snapshot()
    assert len(inspected) == 2
    assert inspected[0]["interaction_id"] == inspected[1]["interaction_id"]
    assert focused(retried)["depth"] == 1
    assert retried["roots"][0]["nodes"] == []
    assert len(focused(retried)["turns"]) == 1


def test_parent_retains_sibling_children_and_reopen_is_network_free(assistant_fixture):
    adapter = MockAdapter([
        "根回答同时包含概念甲和概念乙",
        "CHILD_A_ANSWER",
        "CHILD_B_ANSWER",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-historical-siblings"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(root_state)["root_id"]
    child_a_state = create_child_for_text(assistant, session_id, root_state, "概念甲")
    child_a_id = focused(child_a_state)["node_id"]

    parent_state = assistant.focus(session_id, root_id)
    child_b_state = create_child_for_text(assistant, session_id, parent_state, "概念乙")
    child_b_id = focused(child_b_state)["node_id"]
    assert child_a_id != child_b_id
    assert len(child_b_state["roots"][0]["nodes"]) == 2
    assert [child["label"] for child in assistant.focus(session_id, root_id)["current"]["children"]] == [
        "概念甲", "概念乙"
    ]
    assert child_b_state["roots"][0]["active_child_id"] == child_b_id

    calls_before_reopen = len(adapter.calls)
    reopened = assistant.focus(session_id, root_id, node_id=child_a_id)
    assert len(adapter.calls) == calls_before_reopen
    assert focused(reopened)["turns"][0]["answer"] == "CHILD_A_ANSWER"
    child_b_payload = adapter.calls[2]["body"]["messages"][-1]["content"]
    assert "总线事务 › 概念乙" in child_b_payload
    assert "CHILD_A_ANSWER" not in child_b_payload


def test_close_child_subtree_keeps_parent_root_and_sibling(assistant_fixture):
    adapter = MockAdapter([
        "根回答同时包含概念甲和概念乙",
        "概念甲回答包含孙概念",
        "孙概念回答",
        "概念乙回答",
    ])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-close-child-subtree"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(root_state)["root_id"]
    child_a_state = create_child_for_text(assistant, session_id, root_state, "概念甲")
    child_a_id = focused(child_a_state)["node_id"]
    grandchild_state = create_child_for_text(
        assistant, session_id, child_a_state, "孙概念"
    )
    grandchild_id = focused(grandchild_state)["node_id"]
    parent_state = assistant.focus(session_id, root_id)
    child_b_state = create_child_for_text(assistant, session_id, parent_state, "概念乙")
    child_b_id = focused(child_b_state)["node_id"]

    assistant.focus(session_id, root_id, node_id=child_a_id)
    closed = assistant.close_child_subtree(session_id, root_id, child_a_id)
    assert focused(closed)["depth"] == 1
    assert focused(closed)["root_id"] == root_id
    remaining_ids = {node["node_id"] for node in closed["roots"][0]["nodes"]}
    assert child_a_id not in remaining_ids
    assert grandchild_id not in remaining_ids
    assert remaining_ids == {child_b_id}
    assert [child["label"] for child in focused(closed)["children"]] == ["概念乙"]
    assert closed["roots"][0]["active_child_id"] == child_b_id


def test_pending_child_can_close_without_late_resurrection(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingChildAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            if len(self.calls) == 1:
                return "父回答包含待关闭概念"
            entered.set()
            assert release.wait(timeout=3)
            return "不应复活的回答"

    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(BlockingChildAdapter())
    )
    session_id = "reader-session-close-pending-child"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(root_state)["root_id"]
    outcome = []

    thread = threading.Thread(
        target=lambda: _capture_result(
            outcome,
            lambda: create_child_for_text(
                assistant, session_id, root_state, "待关闭概念"
            ),
        )
    )
    thread.start()
    assert entered.wait(timeout=3)
    pending = assistant.state(session_id)
    pending_child = focused(pending)
    assert pending_child["depth"] == 2
    assert pending_child["pending"] is True
    closed = assistant.close_child_subtree(
        session_id, root_id, pending_child["node_id"]
    )
    assert focused(closed)["depth"] == 1
    assert closed["roots"][0]["nodes"] == []
    release.set()
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert isinstance(outcome[0], AssistantStateError)
    assert outcome[0].code == "REQUEST_CANCELLED"
    assert assistant.state(session_id)["roots"][0]["nodes"] == []


def test_pending_sibling_response_stays_bound_after_focus_moves(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingSiblingAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            if len(self.calls) == 1:
                return "根回答同时包含概念甲和概念乙"
            if len(self.calls) == 2:
                return "概念乙的历史回答"
            entered.set()
            assert release.wait(timeout=3)
            return "概念甲的延迟回答"

    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(BlockingSiblingAdapter())
    )
    session_id = "reader-session-pending-sibling-focus"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(root_state)["root_id"]
    child_b_state = create_child_for_text(assistant, session_id, root_state, "概念乙")
    child_b_id = focused(child_b_state)["node_id"]
    parent_state = assistant.focus(session_id, root_id)
    outcome = []
    thread = threading.Thread(
        target=lambda: _capture_result(
            outcome,
            lambda: create_child_for_text(
                assistant, session_id, parent_state, "概念甲"
            ),
        )
    )
    thread.start()
    assert entered.wait(timeout=3)
    pending = assistant.state(session_id)
    child_a_id = focused(pending)["node_id"]
    moved = assistant.focus(session_id, root_id, node_id=child_b_id)
    assert focused(moved)["turns"][0]["answer"] == "概念乙的历史回答"
    release.set()
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert isinstance(outcome[0], dict)
    final = assistant.state(session_id)
    assert focused(final)["node_id"] == child_b_id
    child_a = next(node for node in final["roots"][0]["nodes"] if node["node_id"] == child_a_id)
    assert child_a["turns"][0]["answer"] == "概念甲的延迟回答"


def test_pending_child_back_keeps_parent_focused_after_completion(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingChildAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            if len(self.calls) == 1:
                return "根回答包含延迟概念"
            entered.set()
            assert release.wait(timeout=3)
            return "延迟概念的回答"

    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(BlockingChildAdapter())
    )
    session_id = "reader-session-pending-child-back"
    root_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(root_state)["root_id"]
    outcome = []
    thread = threading.Thread(
        target=lambda: _capture_result(
            outcome,
            lambda: create_child_for_text(
                assistant, session_id, root_state, "延迟概念"
            ),
        )
    )
    thread.start()
    assert entered.wait(timeout=3)
    pending = assistant.state(session_id)
    pending_child_id = focused(pending)["node_id"]
    assert focused(pending)["pending"] is True
    backed = assistant.focus(session_id, root_id)
    assert focused(backed)["depth"] == 1
    release.set()
    thread.join(timeout=3)
    assert not thread.is_alive()
    final = assistant.state(session_id)
    assert focused(final)["depth"] == 1
    child = next(
        node for node in final["roots"][0]["nodes"]
        if node["node_id"] == pending_child_id
    )
    assert child["turns"][0]["answer"] == "延迟概念的回答"


def _capture_result(outcomes: list, action) -> None:
    try:
        outcomes.append(action())
    except Exception as exc:
        outcomes.append(exc)


def test_concurrent_child_creation_has_exactly_one_winner(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingChildAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            if len(self.calls) == 1:
                return "父回答包含并发概念"
            entered.set()
            assert release.wait(timeout=3)
            return "唯一子回答"

    adapter = BlockingChildAdapter()
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    session_id = "reader-session-concurrent-child"
    parent_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    parent = focused(parent_state)
    turn = parent["turns"][-1]
    start = turn["answer"].index("并发概念")
    results = []

    def create() -> None:
        try:
            value = assistant.create_child(
                session_id,
                parent["root_id"],
                parent_node_id=None,
                turn_id=turn["turn_id"],
                start_offset=start,
                end_offset=start + len("并发概念"),
            )
        except Exception as exc:
            results.append(exc)
        else:
            results.append(value)

    winner = threading.Thread(target=create)
    loser = threading.Thread(target=create)
    winner.start()
    assert entered.wait(timeout=3)
    loser.start()
    loser.join(timeout=3)
    release.set()
    winner.join(timeout=3)
    assert not winner.is_alive() and not loser.is_alive()
    assert sum(isinstance(result, dict) for result in results) == 1
    errors = [result for result in results if isinstance(result, AssistantStateError)]
    assert len(errors) == 1
    assert errors[0].code == "ACTIVE_CHILD_ALREADY_EXISTS"
    final = assistant.state(session_id)
    assert len(final["roots"][0]["nodes"]) == 1
    assert len(adapter.calls) == 2


def test_close_root_cancels_inflight_child_without_resurrection(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingChildAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            if len(self.calls) == 1:
                return "父回答包含关闭概念"
            entered.set()
            assert release.wait(timeout=3)
            return "不应复活的子回答"

    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(BlockingChildAdapter())
    )
    session_id = "reader-session-close-race"
    parent_state = assistant.ask_selection(
        session_id, assistant_fixture["revision_id"], 3, **selection(3)
    )
    root_id = focused(parent_state)["root_id"]
    outcome = []

    def create() -> None:
        try:
            outcome.append(create_child_for_text(
                assistant, session_id, parent_state, "关闭概念"
            ))
        except Exception as exc:
            outcome.append(exc)

    thread = threading.Thread(target=create)
    thread.start()
    assert entered.wait(timeout=3)
    closed = assistant.close_root(session_id, root_id)
    assert closed["roots"] == []
    release.set()
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert len(outcome) == 1
    assert isinstance(outcome[0], AssistantStateError)
    assert outcome[0].code == "REQUEST_CANCELLED"
    assert assistant.state(session_id)["roots"] == []


def test_reader_close_cancels_inflight_root_and_reclaims_session_slot(assistant_fixture):
    entered = threading.Event()
    release = threading.Event()

    class BlockingRootAdapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            self.calls.append({
                "endpoint": endpoint, "api_key": api_key, "body": body, "timeout": timeout,
            })
            entered.set()
            assert release.wait(timeout=3)
            return "不应复活的根回答"

    assistant = AssistantService(
        assistant_fixture["contexts"], runtime(BlockingRootAdapter())
    )
    session_id = "reader-session-root-race"
    outcome = []

    def ask() -> None:
        try:
            outcome.append(assistant.ask_selection(
                session_id, assistant_fixture["revision_id"], 3, **selection(3)
            ))
        except Exception as exc:
            outcome.append(exc)

    thread = threading.Thread(target=ask)
    thread.start()
    assert entered.wait(timeout=3)
    assistant.close_session(session_id)
    release.set()
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert isinstance(outcome[0], AssistantStateError)
    assert outcome[0].code == "REQUEST_CANCELLED"
    assert assistant.conversation_count() == 0
    assert session_id not in assistant._sessions
    assert not hasattr(assistant, "_session_locks")


def test_openrouter_reasoning_effort_is_per_call_and_reported():
    providers, adapters = runtime_set(bakeoff_enabled=False)
    messages = [{"role": "user", "content": "bounded"}]
    result = providers.complete_for_with_metadata("openrouter", messages, reasoning_effort="high")
    assert adapters['openrouter'].calls[-1]['body']['reasoning_effort'] == 'high'
    assert result.effective_config['request_parameters']['reasoning_effort'] == 'high'
    providers.complete_for_with_metadata("openrouter", messages)
    assert 'reasoning_effort' not in adapters['openrouter'].calls[-1]['body']
    for provider, effort in [('deepseek', 'high'), ('openrouter', 'max')]:
        before = len(adapters[provider].calls)
        with pytest.raises(ValueError, match='invalid for the selected provider'):
            providers.complete_for_with_metadata(provider, messages, reasoning_effort=effort)
        assert len(adapters[provider].calls) == before


def test_openrouter_json_object_mode_is_explicit_scoped_and_reported():
    providers, adapters = runtime_set(bakeoff_enabled=False)
    messages = [{"role": "user", "content": "Return a JSON object"}]
    result = providers.complete_for_with_metadata("openrouter", messages, json_object=True)
    assert adapters['openrouter'].calls[-1]['body']['response_format'] == {'type': 'json_object'}
    assert result.effective_config['request_parameters']['response_format'] == {'type': 'json_object'}
    providers.complete_for_with_metadata("openrouter", messages)
    assert 'response_format' not in adapters['openrouter'].calls[-1]['body']
    for provider, option in [('deepseek', True), ('zhipu', True), ('openrouter', 'true')]:
        before = len(adapters[provider].calls)
        with pytest.raises(ValueError):
            providers.complete_for_with_metadata(provider, messages, json_object=option)
        assert len(adapters[provider].calls) == before


@pytest.mark.parametrize('recovers', [True, False])
def test_incomplete_provider_response_is_retried_without_accepting_partial_text(monkeypatch, caplog, recovers):
    from dataclasses import replace
    from http.client import IncompleteRead
    class Broken(BytesIO):
        def read(self, *args):
            raise IncompleteRead(b'private partial provider content')
    complete = BytesIO(json.dumps({'choices': [{'message': {'content': 'complete answer'}, 'finish_reason': 'stop'}]}).encode())
    responses = iter([Broken(), complete if recovers else Broken()])
    calls = []
    class Opener:
        def open(self, request, **kwargs):
            calls.append(request)
            return next(responses)
    monkeypatch.setattr(provider_adapter, 'build_opener', lambda *args: Opener())
    config = replace(ProviderConfig.from_environment('openrouter'), endpoint='http://127.0.0.1:9999/chat', max_attempts=2)
    runtime = AgentRuntime(OpenAICompatibleAdapter('openrouter'), config=config,
                           credential_loader=lambda: 'test-key', sleeper=lambda _: None)
    if recovers:
        assert runtime.complete([{'role': 'user', 'content': 'bounded'}]) == 'complete answer'
    else:
        with pytest.raises(ProviderFailure) as failure:
            runtime.complete([{'role': 'user', 'content': 'bounded'}])
        assert failure.value.kind == ProviderFailureKind.TRANSIENT
        assert failure.value.code == 'network'
    assert len(calls) == 2
    assert 'private partial provider content' not in caplog.text


def test_model_override_is_per_call_and_reported_without_changing_provider():
    providers, adapters = runtime_set(bakeoff_enabled=False)
    default_model = providers.provider_identity("openrouter")[1]
    messages = [{"role": "user", "content": "bounded"}]
    events = []
    changed = providers.complete_for_with_metadata(
        "openrouter", messages, model="openai/gpt-6-astra", timeout_seconds=120, attempt_observer=events.append)
    ordinary = providers.complete_for_with_metadata("openrouter", messages)
    assert [c["body"]["model"] for c in adapters["openrouter"].calls] == [
        "openai/gpt-6-astra", default_model]
    assert changed.effective_config["request_parameters"]["timeout_seconds"] == 120
    assert ordinary.effective_config["request_parameters"]["timeout_seconds"] != 120
    assert changed.effective_config["model"] == "openai/gpt-6-astra"
    assert ordinary.effective_config["model"] == default_model
    assert providers.provider_identity("openrouter")[1] == default_model
    assert all(e["model"] == "openai/gpt-6-astra" for e in events)
    for invalid in ("", " ", "x" * 121, 123):
        with pytest.raises(ValueError, match="model is invalid"):
            providers.complete_for_with_metadata("openrouter", messages, model=invalid)
    assert len(adapters["openrouter"].calls) == 2


def test_failed_child_explicit_retry_reuses_grounding_and_identity(assistant_fixture):
    transient = ProviderFailure(ProviderFailureKind.TRANSIENT, 'network', '暂不可用')
    adapter = MockAdapter(['父回答含失败概念', transient, transient, '已恢复'])
    assistant = AssistantService(assistant_fixture['contexts'], runtime(adapter, max_attempts=1))
    assistant.runtime.clock = lambda: 0
    sid = 'explicit-child-retry'
    parent = assistant.ask_selection(sid, assistant_fixture['revision_id'], 3, **selection(3))
    with pytest.raises(ProviderFailure): create_child_for_text(assistant, sid, parent, '失败概念')
    child = focused(assistant.state(sid)); rid, nid = child['root_id'], child['node_id']
    assert child['can_retry'] and 'first_user_content' not in child
    assistant.runtime.clock = lambda: 31
    with pytest.raises(ProviderFailure): assistant.retry_child(sid, rid, nid)
    assistant.runtime.clock = lambda: 62
    assert focused(assistant.state(sid))['can_retry']
    # A changed parent must not alter the original first-turn grounding.
    assistant.focus(sid, rid)
    assistant._sessions[sid].state.roots[rid].turns.append(Turn('later', 'later', '不同父回答', 'later'))
    result = assistant.retry_child(sid, rid, nid)
    assert result['current']['node_id'] is None  # completion never steals focus
    restored = focused(assistant.focus(sid, rid, node_id=nid))
    assert restored['node_id'] == nid and restored['root_id'] == rid
    assert restored['error'] is None and not restored['can_retry']
    assert len(restored['turns']) == 1 and len(result['roots'][0]['nodes']) == 1
    assert adapter.calls[1]['body'] == adapter.calls[2]['body'] == adapter.calls[3]['body']
    with pytest.raises(AssistantStateError, match='首次生成失败'): assistant.retry_child(sid, rid, nid)
    assert len(adapter.calls) == 4


def test_retry_child_duplicate_and_close_cannot_resurrect(assistant_fixture):
    transient = ProviderFailure(ProviderFailureKind.TRANSIENT, 'network', '暂不可用')
    entered, release = threading.Event(), threading.Event()
    class Adapter(MockAdapter):
        def complete(self, endpoint, api_key, body, timeout):
            if len(self.calls) < 2: return super().complete(endpoint, api_key, body, timeout)
            self.calls.append({'body':body})
            entered.set(); assert release.wait(3)
            return '已恢复'
    adapter = Adapter(['父回答含失败概念', transient])
    assistant = AssistantService(assistant_fixture['contexts'], runtime(adapter,max_attempts=1))
    assistant.runtime.clock = lambda: 0
    sid = 'retry-child-cancel'
    parent = assistant.ask_selection(sid, assistant_fixture['revision_id'], 3, **selection(3))
    with pytest.raises(ProviderFailure): create_child_for_text(assistant,sid,parent,'失败概念')
    child = focused(assistant.state(sid)); rid,nid = child['root_id'],child['node_id']
    assistant.runtime.clock = lambda: 31
    outcome=[]
    thread=threading.Thread(target=lambda:_capture_result(outcome,lambda:assistant.retry_child(sid,rid,nid)))
    thread.start(); assert entered.wait(3)
    with pytest.raises(AssistantStateError) as error: assistant.retry_child(sid,rid,nid)
    assert error.value.code == 'TURN_ALREADY_PENDING'
    assistant.close_child_subtree(sid,rid,nid)
    release.set(); thread.join(3)
    assert isinstance(outcome[0],AssistantStateError) and outcome[0].code == 'REQUEST_CANCELLED'
    assert assistant.state(sid)['roots'][0]['nodes'] == []
    with pytest.raises(LookupError): assistant.retry_child(sid,rid,nid)
