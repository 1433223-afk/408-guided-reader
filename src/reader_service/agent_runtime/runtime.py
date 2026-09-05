from __future__ import annotations

import copy
import logging
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Protocol
from urllib.parse import urlparse
from uuid import uuid4

from .credentials import (
    DEEPSEEK_CREDENTIAL_TARGET,
    CredentialRead,
    read_deepseek_api_key,
    read_deepseek_credential,
)


logger = logging.getLogger("reader_service.agent_runtime")


class ProviderFailureKind(str, Enum):
    UNCONFIGURED = "UNCONFIGURED"
    TRANSIENT = "TRANSIENT"
    USER_ACTIONABLE = "USER_ACTIONABLE"
    COOLING = "COOLING"


class ProviderFailure(RuntimeError):
    def __init__(self, kind: ProviderFailureKind, code: str, user_message: str):
        super().__init__(code)
        self.kind = kind
        self.code = code
        self.user_message = user_message


class ProviderAdapter(Protocol):
    provider_name: str

    def complete(self, endpoint: str, api_key: str, body: dict, timeout: float) -> str: ...


@dataclass(frozen=True, slots=True)
class ProviderConfig:
    endpoint: str = "https://api.deepseek.com/chat/completions"
    model: str = "deepseek-chat"
    temperature: float = 0.2
    max_tokens: int = 900
    timeout_seconds: float = 45.0
    max_attempts: int = 3
    cooling_seconds: float = 30.0

    @classmethod
    def from_environment(cls) -> "ProviderConfig":
        return cls(
            endpoint=os.environ.get(
                "GUIDED_READER_DEEPSEEK_ENDPOINT",
                "https://api.deepseek.com/chat/completions",
            ).strip(),
            model=os.environ.get("GUIDED_READER_DEEPSEEK_MODEL", "deepseek-chat").strip(),
            temperature=_environment_float("GUIDED_READER_DEEPSEEK_TEMPERATURE", 0.2),
            max_tokens=_environment_int("GUIDED_READER_DEEPSEEK_MAX_TOKENS", 900),
            timeout_seconds=_environment_float("GUIDED_READER_DEEPSEEK_TIMEOUT_SECONDS", 45.0),
        )

    def validate(self) -> None:
        parsed = urlparse(self.endpoint)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.netloc
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("DeepSeek endpoint must be one complete HTTP(S) URL")
        if not self.model or len(self.model) > 120:
            raise ValueError("DeepSeek model is invalid")
        if not 1 <= self.max_tokens <= 4096 or not 1 <= self.max_attempts <= 5:
            raise ValueError("DeepSeek request bounds are invalid")
        if not 0 <= self.temperature <= 2 or not 1 <= self.timeout_seconds <= 180:
            raise ValueError("DeepSeek request parameters are invalid")
        if not 1 <= self.cooling_seconds <= 600:
            raise ValueError("DeepSeek cooling period is invalid")


class PayloadInspector:
    """Bounded process-memory capture of exact provider request bodies."""

    def __init__(self, limit: int = 20):
        self._items: deque[dict] = deque(maxlen=max(1, min(limit, 100)))
        self._lock = threading.Lock()

    def record(self, *, endpoint: str, request_body: dict, interaction_id: str, attempt: int) -> None:
        item = {
            "provider": "deepseek",
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
    """ASSISTANT-only runtime and the sole caller of the provider adapter."""

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
        self.config = config or ProviderConfig.from_environment()
        try:
            self.config.validate()
        except ValueError:
            self._configuration_valid = False
        else:
            self._configuration_valid = True
        self.credential_loader = credential_loader or read_deepseek_api_key
        self._uses_product_credential_path = (
            credential_loader is None or credential_loader is read_deepseek_api_key
        )
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
            "provider": "deepseek",
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
            "credential_target": DEEPSEEK_CREDENTIAL_TARGET,
        }

    def complete(self, messages: list[dict], *, interaction_id: str | None = None) -> str:
        if not self._configuration_valid:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_configuration",
                "DeepSeek 配置无效；Reader 其余能力仍可正常使用。",
            )
        api_key = self._read_key()
        if not api_key:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "unconfigured",
                "尚未配置 DeepSeek API 密钥；阅读、选择、标记、搜索和目录仍可正常使用。",
            )
        with self._lock:
            now = self.clock()
            if now < self._cooling_until:
                raise ProviderFailure(
                    ProviderFailureKind.COOLING,
                    "cooling",
                    "AI 服务连续失败，正在短暂冷却；教材阅读功能不受影响。",
                )
        body = {
            "model": self.config.model,
            "messages": copy.deepcopy(messages),
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": False,
        }
        call_id = interaction_id or str(uuid4())
        last_failure: ProviderFailure | None = None
        for attempt in range(1, self.config.max_attempts + 1):
            self.inspector.record(
                endpoint=self.config.endpoint,
                request_body=body,
                interaction_id=call_id,
                attempt=attempt,
            )
            logger.info(
                "assistant_provider_call provider=deepseek model=%s attempt=%d interaction_id=%s",
                self.config.model,
                attempt,
                call_id,
            )
            try:
                answer = self.adapter.complete(
                    self.config.endpoint, api_key, body, self.config.timeout_seconds
                )
            except ProviderFailure as failure:
                last_failure = failure
                logger.warning(
                    "assistant_provider_failure provider=deepseek code=%s attempt=%d interaction_id=%s",
                    failure.code,
                    attempt,
                    call_id,
                )
                if failure.kind is ProviderFailureKind.USER_ACTIONABLE:
                    self._start_cooling()
                    raise
                if failure.kind is not ProviderFailureKind.TRANSIENT:
                    raise
                if attempt < self.config.max_attempts:
                    self.sleeper(0.35 * (2 ** (attempt - 1)))
                    continue
                self._start_cooling()
                raise
            else:
                with self._lock:
                    self._cooling_until = 0.0
                return answer
        assert last_failure is not None
        raise last_failure

    def _read_key(self) -> str | None:
        return self._credential_read().key

    def _credential_read(self) -> CredentialRead:
        if self._uses_product_credential_path:
            return read_deepseek_credential()
        try:
            value = self.credential_loader()
        except Exception:
            return CredentialRead(False, "CUSTOM_LOADER", "CREDENTIAL_READ_FAILED")
        key = value.strip() if isinstance(value, str) and value.strip() else None
        return CredentialRead(
            bool(key), "CUSTOM_LOADER", None if key else "CREDENTIAL_NOT_FOUND", key
        )

    def _endpoint_valid(self) -> bool:
        parsed = urlparse(self.config.endpoint)
        return bool(
            parsed.scheme in ("http", "https")
            and parsed.netloc
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
        )

    def _start_cooling(self) -> None:
        with self._lock:
            self._cooling_until = max(
                self._cooling_until, self.clock() + self.config.cooling_seconds
            )


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
