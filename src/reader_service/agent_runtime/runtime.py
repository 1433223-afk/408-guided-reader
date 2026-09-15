from __future__ import annotations

import copy
import ipaddress
import logging
import math
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from enum import Enum
from typing import Callable, Protocol
from urllib.parse import urlparse
from uuid import uuid4

from .credentials import (
    PROVIDER_CREDENTIAL_TARGETS,
    CredentialRead,
    read_provider_api_key,
    read_provider_credential,
)


logger = logging.getLogger("reader_service.agent_runtime")

PROVIDER_NAMES = ("deepseek", "zhipu", "openrouter")
PROVIDER_DEFAULTS = {
    "deepseek": {
        "endpoint": "https://api.deepseek.com/chat/completions",
        "model": "deepseek-flash",
        "max_tokens": 4096,
        "timeout_seconds": 120.0,
    },
    "zhipu": {
        "endpoint": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        "model": "GLM-5.3-Flash",
        "max_tokens": 4096,
        "timeout_seconds": 120.0,
    },
    "openrouter": {
        "endpoint": "https://openrouter.ai/api/v1/chat/completions",
        "model": "google/gemini-3.8-flash",
        "max_tokens": 900,
        "timeout_seconds": 45.0,
    },
}
ANSWER_LENGTH_INTENT = "concise"
REASONING_STRENGTH_INTENT = "balanced"


class ProviderFailureKind(str, Enum):
    UNCONFIGURED = "UNCONFIGURED"
    TRANSIENT = "TRANSIENT"
    USER_ACTIONABLE = "USER_ACTIONABLE"
    COOLING = "COOLING"


class ProviderFailure(RuntimeError):
    def __init__(
        self,
        kind: ProviderFailureKind,
        code: str,
        user_message: str,
        *,
        diagnostics: dict | None = None,
    ):
        super().__init__(code)
        self.kind = kind
        self.code = code
        self.user_message = user_message
        self.diagnostics = copy.deepcopy(diagnostics)


class StreamConsumerDisconnected(RuntimeError):
    """The local client stopped consuming a live response; never retry provider egress."""


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    answer: str
    usage: dict | None = None
    diagnostics: dict | None = None


@dataclass(frozen=True, slots=True)
class ProviderCompletion:
    answer: str
    latency_ms: int
    usage: dict | None
    effective_config: dict
    response_metadata: dict | None = None
    ttft_ms: int | None = None


class ProviderAdapter(Protocol):
    provider_name: str

    def complete(
        self, endpoint: str, api_key: str, body: dict, timeout: float
    ) -> ProviderResponse | str: ...

    def stream(
        self,
        endpoint: str,
        api_key: str,
        body: dict,
        timeout: float,
        on_delta: Callable[[str], None],
        on_reasoning_delta: Callable[[str], None] | None = None,
    ) -> ProviderResponse | str: ...


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    provider: str = "deepseek"
    endpoint: str = PROVIDER_DEFAULTS["deepseek"]["endpoint"]
    model: str = PROVIDER_DEFAULTS["deepseek"]["model"]
    credential_target: str = PROVIDER_CREDENTIAL_TARGETS["deepseek"]
    temperature: float = 0.2
    max_tokens: int = 900
    timeout_seconds: float = 45.0
    max_attempts: int = 3
    cooling_seconds: float = 30.0

    @classmethod
    def from_environment(cls, provider: str = "deepseek") -> "ProviderConfig":
        if provider not in PROVIDER_NAMES:
            raise ValueError("unknown provider")
        prefix = f"GUIDED_READER_{provider.upper()}"
        defaults = PROVIDER_DEFAULTS[provider]
        return cls(
            provider=provider,
            endpoint=os.environ.get(f"{prefix}_ENDPOINT", defaults["endpoint"]).strip(),
            model=os.environ.get(f"{prefix}_MODEL", defaults["model"]).strip(),
            credential_target=PROVIDER_CREDENTIAL_TARGETS[provider],
            temperature=_environment_float(f"{prefix}_TEMPERATURE", 0.2),
            max_tokens=_environment_int(f"{prefix}_MAX_TOKENS", defaults["max_tokens"]),
            timeout_seconds=_environment_float(
                f"{prefix}_TIMEOUT_SECONDS", defaults["timeout_seconds"]
            ),
        )

    def validate(self) -> None:
        if self.provider not in PROVIDER_NAMES:
            raise ValueError("provider is not in the named set")
        if self.credential_target != PROVIDER_CREDENTIAL_TARGETS[self.provider]:
            raise ValueError("credential target does not match provider")
        _validate_endpoint(self.endpoint)
        if not self.model or len(self.model) > 120:
            raise ValueError("provider model is invalid")
        if not 1 <= self.max_tokens <= 4096 or not 1 <= self.max_attempts <= 5:
            raise ValueError("provider request bounds are invalid")
        if not 0 <= self.temperature <= 2 or not 1 <= self.timeout_seconds <= 180:
            raise ValueError("provider request parameters are invalid")
        if not 1 <= self.cooling_seconds <= 600:
            raise ValueError("provider cooling period is invalid")

    def effective_config(
        self,
        *,
        max_tokens: int | None = None,
        thinking_mode: str | None = None,
        reasoning_effort: str | None = None,
        json_object: bool = False,
        streaming: bool = False,
    ) -> dict:
        effective_max_tokens = self.max_tokens if max_tokens is None else max_tokens
        answer_mapping = (
            f"shared Skill controls concise answer; max_tokens={effective_max_tokens} includes provider reasoning"
            if self.provider in ("deepseek", "zhipu")
            else f"max_tokens={effective_max_tokens}"
        )
        request_parameters = {
            "temperature": self.temperature,
            "max_tokens": effective_max_tokens,
            "stream": streaming,
            "timeout_seconds": self.timeout_seconds,
        }
        if thinking_mode is not None:
            request_parameters["thinking"] = thinking_mode
        if reasoning_effort is not None:
            request_parameters["reasoning_effort"] = reasoning_effort
        if json_object:
            request_parameters["response_format"] = {"type": "json_object"}
        reasoning_mapping = (
            f"provider reasoning_effort {reasoning_effort}"
            if reasoning_effort is not None
            else f"provider thinking mode {thinking_mode}"
            if thinking_mode is not None
            else "omitted (no portable OpenAI-compatible field)"
        )
        return {
            "provider": self.provider,
            "model": self.model,
            "endpoint": self.endpoint,
            "intent": {
                "answer_length": ANSWER_LENGTH_INTENT,
                "reasoning_strength": REASONING_STRENGTH_INTENT,
            },
            "request_parameters": request_parameters,
            "parameter_mapping": {
                "answer_length": answer_mapping,
                "reasoning_strength": reasoning_mapping,
            },
        }


class PayloadInspector:
    """Bounded process-memory capture of secret-free provider request bodies."""

    def __init__(self, limit: int = 20):
        self._items: deque[dict] = deque(maxlen=max(1, min(limit, 100)))
        self._lock = threading.Lock()

    def record(
        self,
        *,
        provider: str,
        endpoint: str,
        request_body: dict,
        interaction_id: str,
        attempt: int,
    ) -> None:
        item = {
            "provider": provider,
            "endpoint": endpoint,
            "interaction_id": interaction_id,
            "attempt": attempt,
            "request_body": copy.deepcopy(request_body),
        }
        with self._lock:
            self._items.append(item)

    def snapshot(self) -> list[dict]:
        with self._lock:
            return copy.deepcopy(list(self._items))


class AgentRuntime:
    """One named provider runtime behind the sole provider-egress boundary."""

    def __init__(
        self,
        adapter: ProviderAdapter,
        *,
        config: ProviderConfig | None = None,
        credential_loader: Callable[[], str | None] | None = None,
        inspector: PayloadInspector | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.adapter = adapter
        self.config = config or ProviderConfig.from_environment(adapter.provider_name)
        try:
            self.config.validate()
            if adapter.provider_name != self.config.provider:
                raise ValueError("adapter provider does not match configuration")
        except ValueError:
            self._configuration_valid = False
        else:
            self._configuration_valid = True
        self.credential_loader = credential_loader or (
            lambda: read_provider_api_key(self.config.provider)
        )
        self._uses_product_credential_path = credential_loader is None
        self.inspector = inspector or PayloadInspector()
        self.sleeper = sleeper
        self.clock = clock
        self._cooling_until = 0.0
        self._lock = threading.Lock()

    def status(self) -> dict:
        credential = self._credential_read()
        endpoint_valid = self._endpoint_valid()
        model_valid = bool(self.config.model and len(self.config.model) <= 120)
        configured = self._configuration_valid and credential.available
        cooling = configured and self.clock() < self._cooling_until
        if not self._configuration_valid:
            ai_off_reason = "INVALID_CONFIGURATION"
        elif not credential.available:
            ai_off_reason = credential.reason or "CREDENTIAL_UNAVAILABLE"
        elif cooling:
            ai_off_reason = "COOLING"
        else:
            ai_off_reason = None
        return {
            "role": "ASSISTANT",
            "provider": self.config.provider,
            "model": self.config.model,
            "endpoint": self.config.endpoint,
            "configured": configured,
            "configuration_valid": self._configuration_valid,
            "endpoint_valid": endpoint_valid,
            "model_valid": model_valid,
            "credential_available": credential.available,
            "credential_source": credential.source,
            "credential_reason": credential.reason,
            "cooling": cooling,
            "failure_state": "COOLING" if cooling else "READY" if configured else "AI_OFF",
            "ai_off_reason": ai_off_reason,
            "retry_after_seconds": max(
                0, math.ceil(self._cooling_until - self.clock())
            ) if cooling else 0,
            "credential_target": self.config.credential_target,
            "effective_config": self.config.effective_config(),
        }

    def complete(self, messages: list[dict], *, interaction_id: str | None = None) -> str:
        return self.complete_with_metadata(messages, interaction_id=interaction_id).answer

    def complete_with_metadata(
        self,
        messages: list[dict],
        *,
        interaction_id: str | None = None,
        max_tokens: int | None = None,
        attempt_observer: Callable[[dict], None] | None = None,
        retain_request_body: bool = True,
        thinking_mode: str | None = None,
        reasoning_effort: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        json_object: bool = False,
        stream_callback: Callable[[str], None] | None = None,
        reasoning_stream_callback: Callable[[str], None] | None = None,
    ) -> ProviderCompletion:
        config = self.config
        if type(json_object) is not bool or (json_object and config.provider != "openrouter"):
            raise ValueError("JSON object mode is invalid for the selected provider")
        if model is not None:
            if not isinstance(model, str) or not model.strip() or len(model) > 120:
                raise ValueError("provider call model is invalid")
            config = replace(config, model=model.strip())
        if timeout_seconds is not None:
            if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)) or not 1 <= timeout_seconds <= 180:
                raise ValueError("provider call timeout is invalid")
            config = replace(config, timeout_seconds=timeout_seconds)
        effective_max_tokens = config.max_tokens if max_tokens is None else max_tokens
        if isinstance(effective_max_tokens, bool) or not 1 <= effective_max_tokens <= 16384:
            raise ValueError("provider call max_tokens must be between 1 and 16384")
        allowed_thinking_modes = {
            "deepseek": {"enabled", "disabled"},
            "zhipu": {"enabled", "disabled"},
        }
        if thinking_mode is not None and thinking_mode not in allowed_thinking_modes.get(
            config.provider, set()
        ):
            raise ValueError("thinking mode is invalid for the selected provider")
        allowed_reasoning_efforts = {
            "zhipu": {"low", "high", "max"},
            "openrouter": {"low", "medium", "high"},
        }
        if reasoning_effort is not None and reasoning_effort not in allowed_reasoning_efforts.get(
            config.provider, set()
        ):
            raise ValueError("reasoning effort is invalid for the selected provider")
        if not self._configuration_valid:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_configuration",
                f"{config.provider} 配置无效；Reader 其余能力仍可正常使用。",
            )
        api_key = self._read_key()
        if not api_key:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "unconfigured",
                f"尚未配置 {config.provider} API 密钥；Reader 其余能力仍可正常使用。",
            )
        with self._lock:
            now = self.clock()
            if now < self._cooling_until:
                raise ProviderFailure(
                    ProviderFailureKind.COOLING,
                    "cooling",
                    f"{config.provider} 连续失败，正在短暂冷却；教材阅读功能不受影响。",
                )
        if reasoning_stream_callback is not None and not callable(reasoning_stream_callback):
            raise ValueError("reasoning stream callback is invalid")
        streaming = stream_callback is not None
        body = {
            "model": config.model,
            "messages": copy.deepcopy(messages),
            "temperature": config.temperature,
            "max_tokens": effective_max_tokens,
            "stream": streaming,
        }
        if streaming:
            body["stream_options"] = {"include_usage": True}
        if thinking_mode is not None:
            body["thinking"] = {"type": thinking_mode}
        if reasoning_effort is not None:
            body["reasoning_effort"] = reasoning_effort
        if json_object:
            body["response_format"] = {"type": "json_object"}
        call_id = interaction_id or str(uuid4())
        started = time.perf_counter()
        first_content_at: float | None = None
        last_failure: ProviderFailure | None = None
        for attempt in range(1, config.max_attempts + 1):
            transport_started = time.perf_counter()
            attempt_emitted_output = False
            if retain_request_body:
                self.inspector.record(
                    provider=config.provider,
                    endpoint=config.endpoint,
                    request_body=body,
                    interaction_id=call_id,
                    attempt=attempt,
                )
            logger.info(
                "assistant_provider_call provider=%s model=%s attempt=%d interaction_id=%s",
                config.provider,
                config.model,
                attempt,
                call_id,
            )
            self._notify_attempt(
                attempt_observer,
                {
                    "status": "STARTED",
                    "provider": config.provider,
                    "model": config.model,
                    "interaction_id": call_id,
                    "transport_attempt": attempt,
                },
            )
            try:
                if streaming:
                    def emit_delta(delta: str) -> None:
                        nonlocal first_content_at, attempt_emitted_output
                        if not delta:
                            return
                        attempt_emitted_output = True
                        if first_content_at is None:
                            first_content_at = time.perf_counter()
                        assert stream_callback is not None
                        stream_callback(delta)

                    def emit_reasoning_delta(delta: str) -> None:
                        nonlocal first_content_at, attempt_emitted_output
                        if not delta or reasoning_stream_callback is None:
                            return
                        attempt_emitted_output = True
                        if first_content_at is None:
                            first_content_at = time.perf_counter()
                        reasoning_stream_callback(delta)

                    response = self.adapter.stream(
                        config.endpoint,
                        api_key,
                        body,
                        config.timeout_seconds,
                        emit_delta,
                        emit_reasoning_delta,
                    )
                else:
                    response = self.adapter.complete(
                        config.endpoint, api_key, body, config.timeout_seconds
                    )
            except StreamConsumerDisconnected:
                raise
            except ProviderFailure as failure:
                elapsed_ms = max(0, round((time.perf_counter() - started) * 1000))
                ttft_ms = (
                    max(0, round((first_content_at - started) * 1000))
                    if first_content_at is not None
                    else None
                )
                failure.diagnostics = {
                    **copy.deepcopy(failure.diagnostics or {}),
                    "latency_ms": elapsed_ms,
                    "ttft_ms": ttft_ms,
                    "partial_content_received": attempt_emitted_output,
                }
                last_failure = failure
                self._notify_attempt(
                    attempt_observer,
                    {
                        "status": "FAILED",
                        "provider": config.provider,
                        "model": config.model,
                        "interaction_id": call_id,
                        "transport_attempt": attempt,
                        "latency_ms": max(
                            0, round((time.perf_counter() - transport_started) * 1000)
                        ),
                        "failure_kind": failure.kind.value,
                        "failure_code": failure.code,
                        **copy.deepcopy(failure.diagnostics or {}),
                    },
                )
                logger.warning(
                    "assistant_provider_failure provider=%s code=%s attempt=%d interaction_id=%s",
                    config.provider,
                    failure.code,
                    attempt,
                    call_id,
                )
                if failure.code == "response_length_limit":
                    # The provider completed this attempt successfully but exhausted the
                    # caller's generation budget. Recovery is an explicit continuation,
                    # never an automatic replay or a provider-cooling condition.
                    raise
                if failure.kind is ProviderFailureKind.USER_ACTIONABLE:
                    self._start_cooling()
                    raise
                if failure.kind is not ProviderFailureKind.TRANSIENT:
                    raise
                if attempt_emitted_output:
                    # Replaying a visible partial answer would duplicate text and violate
                    # explicit recovery. The user decides whether to retry this turn.
                    self._start_cooling()
                    raise
                if attempt < config.max_attempts:
                    self.sleeper(0.35 * (2 ** (attempt - 1)))
                    continue
                self._start_cooling()
                raise
            else:
                with self._lock:
                    self._cooling_until = 0.0
                normalized = response if isinstance(response, ProviderResponse) else ProviderResponse(str(response))
                response_metadata = copy.deepcopy(normalized.diagnostics or {})
                response_metadata.setdefault("content_present", bool(normalized.answer))
                response_metadata.setdefault("content_length", len(normalized.answer))
                response_metadata.setdefault("reasoning_present", False)
                response_metadata.setdefault("reasoning_length", 0)
                self._notify_attempt(
                    attempt_observer,
                    {
                        "status": "SUCCEEDED",
                        "provider": config.provider,
                        "model": config.model,
                        "interaction_id": call_id,
                        "transport_attempt": attempt,
                        "latency_ms": max(
                            0, round((time.perf_counter() - transport_started) * 1000)
                        ),
                        "usage": copy.deepcopy(normalized.usage),
                        **response_metadata,
                    },
                )
                return ProviderCompletion(
                    answer=normalized.answer,
                    latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
                    usage=copy.deepcopy(normalized.usage),
                    effective_config=config.effective_config(
                        max_tokens=effective_max_tokens,
                        thinking_mode=thinking_mode,
                        reasoning_effort=reasoning_effort,
                        json_object=json_object,
                        streaming=streaming,
                    ),
                    response_metadata=response_metadata,
                    ttft_ms=(
                        max(0, round((first_content_at - started) * 1000))
                        if first_content_at is not None
                        else None
                    ),
                )
        assert last_failure is not None
        raise last_failure

    def stream_with_metadata(
        self,
        messages: list[dict],
        on_delta: Callable[[str], None],
        on_reasoning_delta: Callable[[str], None] | None = None,
        **kwargs,
    ) -> ProviderCompletion:
        if not callable(on_delta):
            raise ValueError("stream callback is required")
        return self.complete_with_metadata(
            messages,
            stream_callback=on_delta,
            reasoning_stream_callback=on_reasoning_delta,
            **kwargs,
        )

    def _read_key(self) -> str | None:
        return self._credential_read().key

    def _credential_read(self) -> CredentialRead:
        if self._uses_product_credential_path:
            return read_provider_credential(self.config.provider)
        try:
            value = self.credential_loader()
        except Exception:
            return CredentialRead(False, "CUSTOM_LOADER", "CREDENTIAL_READ_FAILED")
        key = value.strip() if isinstance(value, str) and value.strip() else None
        return CredentialRead(
            bool(key), "CUSTOM_LOADER", None if key else "CREDENTIAL_NOT_FOUND", key
        )

    def _endpoint_valid(self) -> bool:
        try:
            _validate_endpoint(self.config.endpoint)
        except ValueError:
            return False
        return True

    def _start_cooling(self) -> None:
        with self._lock:
            self._cooling_until = max(
                self._cooling_until, self.clock() + self.config.cooling_seconds
            )

    @staticmethod
    def _notify_attempt(observer: Callable[[dict], None] | None, event: dict) -> None:
        if observer is None:
            return
        try:
            observer(copy.deepcopy(event))
        except Exception:
            # Diagnostics are deliberately best-effort and must never change the
            # provider result or turn an otherwise valid response into a failure.
            logger.exception("provider_attempt_observer_failed")


class ProviderRuntimeSet:
    """Named routing for one active provider and a dev-only three-way comparison."""

    def __init__(
        self,
        runtimes: dict[str, AgentRuntime],
        *,
        active_provider: str = "deepseek",
        bakeoff_enabled: bool = False,
        inspector: PayloadInspector | None = None,
    ):
        if set(runtimes) != set(PROVIDER_NAMES):
            raise ValueError("the runtime set must contain exactly the named providers")
        self.runtimes = dict(runtimes)
        self.active_provider = active_provider
        self.bakeoff_enabled = bakeoff_enabled
        self.inspector = inspector or next(iter(runtimes.values())).inspector

    @classmethod
    def from_environment(cls) -> "ProviderRuntimeSet":
        from .deepseek import OpenAICompatibleAdapter

        inspector = PayloadInspector()
        runtimes = {
            provider: AgentRuntime(
                OpenAICompatibleAdapter(provider),
                config=ProviderConfig.from_environment(provider),
                inspector=inspector,
            )
            for provider in PROVIDER_NAMES
        }
        return cls(
            runtimes,
            active_provider=os.environ.get(
                "GUIDED_READER_ASSISTANT_PROVIDER", "deepseek"
            ).strip().lower(),
            bakeoff_enabled=os.environ.get(
                "GUIDED_READER_PROVIDER_BAKEOFF", ""
            ).strip() == "1",
            inspector=inspector,
        )

    def status(self) -> dict:
        provider_statuses = [self.runtimes[name].status() for name in PROVIDER_NAMES]
        active = next(
            (item for item in provider_statuses if item["provider"] == self.active_provider),
            None,
        )
        if active is None:
            active = {
                "role": "ASSISTANT",
                "provider": self.active_provider,
                "model": None,
                "endpoint": None,
                "configured": False,
                "configuration_valid": False,
                "endpoint_valid": False,
                "model_valid": False,
                "credential_available": False,
                "credential_source": "NONE",
                "credential_reason": "INVALID_ACTIVE_PROVIDER",
                "cooling": False,
                "failure_state": "AI_OFF",
                "ai_off_reason": "INVALID_ACTIVE_PROVIDER",
                "retry_after_seconds": 0,
                "credential_target": None,
                "effective_config": None,
            }
        return {
            **active,
            "active_provider": self.active_provider,
            "bakeoff_enabled": self.bakeoff_enabled,
            "providers": provider_statuses,
        }

    def complete(self, messages: list[dict], *, interaction_id: str | None = None) -> str:
        return self.complete_for(
            self.active_provider, messages, interaction_id=interaction_id
        )

    def complete_for(
        self,
        provider: str,
        messages: list[dict],
        *,
        interaction_id: str | None = None,
    ) -> str:
        return self.complete_for_with_metadata(
            provider, messages, interaction_id=interaction_id
        ).answer

    def complete_for_with_metadata(
        self,
        provider: str,
        messages: list[dict],
        *,
        interaction_id: str | None = None,
        max_tokens: int | None = None,
        attempt_observer: Callable[[dict], None] | None = None,
        retain_request_body: bool = True,
        thinking_mode: str | None = None,
        reasoning_effort: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        json_object: bool = False,
    ) -> ProviderCompletion:
        runtime = self.runtimes.get(provider)
        if runtime is None:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_active_provider",
                "所选 provider 不在允许的命名集合中；Reader 其余能力仍可使用。",
            )
        return runtime.complete_with_metadata(
            messages,
            interaction_id=interaction_id,
            max_tokens=max_tokens,
            attempt_observer=attempt_observer,
            retain_request_body=retain_request_body,
            thinking_mode=thinking_mode,
            reasoning_effort=reasoning_effort,
            model=model,
            timeout_seconds=timeout_seconds,
            json_object=json_object,
        )

    def stream_for_with_metadata(
        self,
        provider: str,
        messages: list[dict],
        on_delta: Callable[[str], None],
        on_reasoning_delta: Callable[[str], None] | None = None,
        **kwargs,
    ) -> ProviderCompletion:
        runtime = self.runtimes.get(provider)
        if runtime is None:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_active_provider",
                "所选 provider 不在允许的命名集合中；Reader 其余能力仍可使用。",
            )
        return runtime.stream_with_metadata(
            messages, on_delta, on_reasoning_delta, **kwargs
        )

    def provider_identity(self, provider: str | None = None) -> tuple[str, str]:
        selected = provider or self.active_provider
        runtime = self.runtimes.get(selected)
        if runtime is None:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_active_provider",
                "所选 provider 不在允许的命名集合中；Reader 其余能力仍可使用。",
            )
        return selected, runtime.config.model

    def compare(self, messages: list[dict], *, interaction_id: str) -> list[dict]:
        if not self.bakeoff_enabled:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "bakeoff_disabled",
                "Provider Bake-off 仅在开发配置显式启用时可用。",
            )
        results: dict[str, dict] = {}
        eligible = []
        for name in PROVIDER_NAMES:
            runtime = self.runtimes[name]
            status = runtime.status()
            if status["configured"]:
                eligible.append((name, runtime))
            else:
                results[name] = self._unavailable_result(status)
        with ThreadPoolExecutor(max_workers=len(PROVIDER_NAMES), thread_name_prefix="provider-bakeoff") as executor:
            futures = {
                executor.submit(
                    runtime.complete_with_metadata,
                    copy.deepcopy(messages),
                    interaction_id=f"{interaction_id}:{name}",
                ): (name, runtime)
                for name, runtime in eligible
            }
            for future in as_completed(futures):
                name, runtime = futures[future]
                try:
                    completion = future.result()
                except ProviderFailure as failure:
                    results[name] = self._failure_result(runtime, failure)
                except Exception:
                    results[name] = self._failure_result(
                        runtime,
                        ProviderFailure(
                            ProviderFailureKind.TRANSIENT,
                            "runtime_failure",
                            f"{name} 调用出现内部失败；其他 provider 不受影响。",
                        ),
                    )
                else:
                    results[name] = {
                        "provider": name,
                        "model": runtime.config.model,
                        "endpoint": runtime.config.endpoint,
                        "available": True,
                        "answer": completion.answer,
                        "latency_ms": completion.latency_ms,
                        "usage": completion.usage,
                        "effective_config": completion.effective_config,
                        "error": None,
                    }
        return [results[name] for name in PROVIDER_NAMES]

    @staticmethod
    def _unavailable_result(status: dict) -> dict:
        return {
            "provider": status["provider"],
            "model": status["model"],
            "endpoint": status["endpoint"],
            "available": False,
            "answer": None,
            "latency_ms": None,
            "usage": None,
            "effective_config": status["effective_config"],
            "error": {
                "kind": ProviderFailureKind.UNCONFIGURED.value,
                "code": str(status["ai_off_reason"] or "unconfigured").lower(),
                "message": f"{status['provider']} 当前不可用：{status['ai_off_reason'] or '未配置'}。",
            },
        }

    @staticmethod
    def _failure_result(runtime: AgentRuntime, failure: ProviderFailure) -> dict:
        return {
            "provider": runtime.config.provider,
            "model": runtime.config.model,
            "endpoint": runtime.config.endpoint,
            "available": True,
            "answer": None,
            "latency_ms": None,
            "usage": None,
            "effective_config": runtime.config.effective_config(),
            "error": {
                "kind": failure.kind.value,
                "code": failure.code,
                "message": failure.user_message,
            },
        }


def _validate_endpoint(endpoint: str) -> None:
    parsed = urlparse(endpoint)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("provider endpoint must be one complete HTTP(S) URL")
    if parsed.scheme == "http" and not _is_loopback_host(parsed.hostname):
        raise ValueError("plain HTTP is permitted only for loopback endpoints")


def _is_loopback_host(host: str) -> bool:
    if host.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _environment_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return -1


def _environment_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except ValueError:
        return -1.0
