"""Image routes reuse the adapter without retaining image payloads in diagnostics."""

import copy
import io
import json

import pytest

from reader_service.agent_runtime import (
    AgentRuntime, OpenAICompatibleAdapter, PayloadInspector, ProviderConfig, ProviderRuntimeSet,
)
from reader_service.agent_runtime.credentials import PROVIDER_CREDENTIAL_TARGETS
from reader_service.agent_runtime.runtime import PROVIDER_DEFAULTS


PNG_URL = ("data:image/png;base64,"
           "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")


def runtime_for(provider, *, model=None, inspector=None):
    config = ProviderConfig(provider=provider, endpoint=PROVIDER_DEFAULTS[provider]["endpoint"],
                            model=model or PROVIDER_DEFAULTS[provider]["model"],
                            credential_target=PROVIDER_CREDENTIAL_TARGETS[provider])
    return AgentRuntime(OpenAICompatibleAdapter(provider), config=config,
                        credential_loader=lambda: "fixture-key", inspector=inspector)


@pytest.mark.parametrize("provider,model,expected", [
    ("deepseek", "deepseek-flash", True), ("zhipu", "GLM-5.3-Flash", True),
    ("deepseek", "deepseek-v4-pro", False), ("zhipu", "GLM-4-Flash", False),
    ("openrouter", "google/gemini-3.8-flash", False),
])
def test_capability_is_exact_and_independent_of_credentials(provider, model, expected):
    runtime = runtime_for(provider, model=model)
    assert runtime.supports_images() is expected
    assert runtime.supports_images(provider, model=model) is expected
    assert runtime.status()["supports_images"] is expected
    assert runtime.supports_images("another-provider", model=model) is False
    assert runtime.supports_images(provider, model="unknown-model") is False
    assert runtime.supports_images(provider, model="") is False
    runtime.credential_loader = lambda: None
    assert runtime.status()["configured"] is False
    assert runtime.status()["supports_images"] is expected


def test_runtime_set_checks_explicit_session_model_without_switching_route():
    inspector = PayloadInspector()
    runtimes = {provider: runtime_for(provider, inspector=inspector) for provider in PROVIDER_DEFAULTS}
    routes = ProviderRuntimeSet(runtimes, active_provider="deepseek", inspector=inspector)
    assert routes.supports_images("zhipu", model="GLM-5.3-Flash") is True
    assert routes.supports_images("deepseek", model="deepseek-v4-pro") is False
    assert routes.supports_images("unknown") is False
    assert routes.active_provider == "deepseek"
    statuses = {value["provider"]: value for value in routes.status()["providers"]}
    assert statuses["deepseek"]["supports_images"] is True
    assert statuses["zhipu"]["supports_images"] is True
    assert statuses["openrouter"]["supports_images"] is False
    # Config changes cannot silently substitute another model in a locked image conversation.
    routes.runtimes["deepseek"] = runtime_for("deepseek", model="deepseek-v4-pro")
    assert routes.supports_images("deepseek") is False
    assert routes.supports_images("deepseek", model="deepseek-flash") is True


class Response(io.BytesIO):
    def __init__(self, value, content_type):
        super().__init__(value)
        self.headers = {"Content-Type": content_type}


@pytest.mark.parametrize("provider", ["deepseek", "zhipu"])
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("followup", [False, True])
def test_actual_adapter_wire_keeps_visual_content_and_does_not_retain_it(monkeypatch, provider, streaming, followup):
    from reader_service.agent_runtime import deepseek as adapter_module

    wire = []

    class Opener:
        def open(self, request, timeout):
            wire.append(json.loads(request.data))
            if streaming:
                event = json.dumps({"choices": [{"delta": {"content": "图中是队列。"}, "finish_reason": "stop"}]})
                return Response(f"data: {event}\n\ndata: [DONE]\n\n".encode(), "text/event-stream")
            return Response(json.dumps({"choices": [{"message": {"content": "图中是队列。"},
                                                      "finish_reason": "stop"}]}).encode(), "application/json")

    monkeypatch.setattr(adapter_module, "build_opener", lambda *args: Opener())
    runtime = runtime_for(provider)
    messages = [{"role": "system", "content": "依据教材裁剪图解释。"},
                {"role": "user", "content": [{"type": "text", "text": "解释图中指针。"},
                                               {"type": "image_url", "image_url": {"url": PNG_URL}}]}]
    if followup:
        messages.extend([{"role": "assistant", "content": "图中是队列。"},
                         {"role": "user", "content": "为什么要留一个空位置？"}])
    original = copy.deepcopy(messages)
    options = {"retain_request_body": False, "model": runtime.config.model}
    if provider == "deepseek":
        options["thinking_mode"] = "disabled"
    else:
        options["reasoning_effort"] = "low"
    deltas = []
    result = (runtime.stream_with_metadata(messages, deltas.append, **options) if streaming
              else runtime.complete_with_metadata(messages, **options))
    assert result.answer == "图中是队列。"
    assert len(wire) == 1
    assert wire[0]["messages"] == original
    assert wire[0]["model"] == runtime.config.model
    assert wire[0]["stream"] is streaming
    assert wire[0]["messages"][1]["content"][1]["image_url"]["url"] == PNG_URL
    assert messages == original
    assert runtime.inspector.snapshot() == []
    assert PNG_URL not in json.dumps(result.effective_config)
    assert PNG_URL not in json.dumps(result.response_metadata)
    if streaming:
        assert deltas == ["图中是队列。"]


def test_plain_text_request_remains_unchanged_and_inspectable():
    class Adapter:
        provider_name = "deepseek"

        def complete(self, endpoint, api_key, body, timeout):
            self.body = body
            return "文字回答"

    adapter = Adapter()
    runtime = AgentRuntime(adapter, credential_loader=lambda: "fixture-key")
    messages = [{"role": "system", "content": "文字上下文"}, {"role": "user", "content": "解释这一句"}]
    assert runtime.complete(messages) == "文字回答"
    assert adapter.body["messages"] == messages
    assert runtime.inspector.snapshot()[0]["request_body"]["messages"] == messages
