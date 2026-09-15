from __future__ import annotations

import json
import ipaddress
import codecs
import os
import socket
import sys
from http.client import IncompleteRead
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import (
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
    proxy_bypass,
)

from .runtime import (
    ProviderFailure,
    ProviderFailureKind,
    ProviderResponse,
    StreamConsumerDisconnected,
)


class OpenAICompatibleAdapter:
    """Thin adapter for the named providers' OpenAI-compatible chat endpoint."""

    def __init__(self, provider_name: str):
        self.provider_name = provider_name

    def complete(
        self, endpoint: str, api_key: str, body: dict, timeout: float
    ) -> ProviderResponse:
        request = Request(
            endpoint,
            data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "408-guided-reader/0.1",
            },
        )
        try:
            # Redirects are refused so one configured endpoint can never turn into
            # an implicit call to a second host or URL.
            with build_opener(self._proxy_handler(endpoint), _NoRedirect()).open(
                request, timeout=timeout
            ) as response:
                payload = json.load(response)
        except HTTPError as error:
            self._raise_http_failure(error)
        except (ValueError, TypeError, UnicodeDecodeError) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "invalid_response",
                "AI 服务返回了无法读取的结果，请稍后再试。",
            ) from error
        except (TimeoutError, socket.timeout, URLError, OSError, IncompleteRead) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "network",
                "AI 服务暂时无法连接，请稍后再试。",
            ) from error

        usage = self._safe_usage(payload.get("usage"))
        try:
            choice = payload["choices"][0]
            message = choice["message"]
        except (KeyError, IndexError, TypeError) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "invalid_response",
                "AI 服务返回了无法读取的结果，请稍后再试。",
            ) from error
        if not isinstance(choice, dict) or not isinstance(message, dict):
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "invalid_response",
                "AI 服务返回了无法读取的结果，请稍后再试。",
            )
        answer = message.get("content")
        reasoning = message.get("reasoning_content")
        metadata = self._safe_response_metadata(
            answer=answer,
            reasoning=reasoning,
            finish_reason=choice.get("finish_reason"),
        )
        if usage is not None:
            metadata["usage"] = usage
        self._reject_length_limited_response(choice.get("finish_reason"), metadata)
        if not isinstance(answer, str) or not answer.strip():
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "empty_response",
                "AI 服务没有返回解释，请稍后再试。",
                diagnostics=metadata,
            )
        return ProviderResponse(
            answer=answer.strip(), usage=usage, diagnostics=metadata
        )

    def stream(
        self,
        endpoint: str,
        api_key: str,
        body: dict,
        timeout: float,
        on_delta,
        on_reasoning_delta=None,
    ) -> ProviderResponse:
        request = Request(
            endpoint,
            data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
                "User-Agent": "408-guided-reader/0.1",
            },
        )
        pieces: list[str] = []
        usage = None
        finish_reason = None
        reasoning_length = 0
        completed = False
        try:
            with build_opener(self._proxy_handler(endpoint), _NoRedirect()).open(
                request, timeout=timeout
            ) as response:
                content_type = str(response.headers.get("Content-Type", "")).casefold()
                if "text/event-stream" not in content_type:
                    raise ProviderFailure(
                        ProviderFailureKind.TRANSIENT,
                        "invalid_stream_response",
                        "AI 服务没有返回可读取的流式结果，请稍后再试。",
                    )
                for data in _iter_sse_data(response):
                    if data == "[DONE]":
                        completed = True
                        break
                    try:
                        payload = json.loads(data)
                    except (TypeError, ValueError) as error:
                        raise ProviderFailure(
                            ProviderFailureKind.TRANSIENT,
                            "invalid_stream_response",
                            "AI 服务返回了无法读取的流式结果，请稍后再试。",
                        ) from error
                    if not isinstance(payload, dict):
                        raise ProviderFailure(
                            ProviderFailureKind.TRANSIENT,
                            "invalid_stream_response",
                            "AI 服务返回了无法读取的流式结果，请稍后再试。",
                        )
                    candidate_usage = self._safe_usage(payload.get("usage"))
                    if candidate_usage is not None:
                        usage = candidate_usage
                    choices = payload.get("choices")
                    if not isinstance(choices, list) or not choices:
                        continue
                    choice = choices[0]
                    if not isinstance(choice, dict):
                        continue
                    if isinstance(choice.get("finish_reason"), str):
                        finish_reason = choice["finish_reason"]
                    delta = choice.get("delta")
                    if not isinstance(delta, dict):
                        continue
                    reasoning = delta.get("reasoning_content")
                    if isinstance(reasoning, str) and reasoning:
                        reasoning_length += len(reasoning)
                        if on_reasoning_delta is not None:
                            on_reasoning_delta(reasoning)
                    content = delta.get("content")
                    if isinstance(content, str) and content:
                        pieces.append(content)
                        on_delta(content)
        except StreamConsumerDisconnected:
            raise
        except HTTPError as error:
            self._raise_http_failure(error)
        except ProviderFailure:
            raise
        except (TimeoutError, socket.timeout, URLError, OSError, IncompleteRead) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "network",
                "AI 服务暂时无法连接，请稍后再试。",
            ) from error

        answer = "".join(pieces)
        metadata = self._safe_response_metadata(
            answer=answer,
            reasoning="x" * reasoning_length,
            finish_reason=finish_reason,
        )
        if usage is not None:
            metadata["usage"] = usage
        if not completed:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "incomplete_stream",
                "AI 服务的流式回答意外中断；已保留收到的内容，可明确重试。",
                diagnostics=metadata,
            )
        self._reject_length_limited_response(finish_reason, metadata)
        if not answer.strip():
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "empty_response",
                "AI 服务没有返回解释，请稍后再试。",
                diagnostics=metadata,
            )
        return ProviderResponse(answer=answer.strip(), usage=usage, diagnostics=metadata)

    @staticmethod
    def _reject_length_limited_response(
        finish_reason: object, diagnostics: dict
    ) -> None:
        if (
            isinstance(finish_reason, str)
            and finish_reason.casefold() == "length"
            and diagnostics.get("content_present") is True
        ):
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "response_length_limit",
                "回答达到长度上限，未能完整结束；已保留收到的内容，可以继续生成。",
                diagnostics=diagnostics,
            )

    def _proxy_handler(self, endpoint: str) -> ProxyHandler:
        if self.provider_name != "openrouter" or _is_loopback_endpoint(endpoint):
            return ProxyHandler({})
        proxy_url = _configured_openrouter_proxy()
        if proxy_url is None:
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "proxy_required",
                "OpenRouter/Gemini 必须通过已配置代理访问；当前未找到可用代理配置。",
            )
        return _StrictProxyHandler({"http": proxy_url, "https": proxy_url})

    def _raise_http_failure(self, error: HTTPError) -> None:
        # The remote body is used only for coarse classification and is never logged,
        # inspected, or reflected into the UI.
        try:
            raw = error.read(16 * 1024)
            remote = json.loads(raw.decode("utf-8", errors="replace"))
            message = str(remote.get("error", {}).get("message", "")).casefold()
        except (AttributeError, TypeError, ValueError, OSError):
            message = ""
        status = int(error.code)
        label = {
            "deepseek": "DeepSeek",
            "zhipu": "智谱 GLM",
            "openrouter": "OpenRouter",
        }.get(self.provider_name, "AI provider")
        if status == 403 and "model" in message and "region" in message:
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "model_region",
                f"{label} 当前地区无法访问所选模型；未更换模型或启用代理。",
            ) from error
        if status in (401, 403):
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "auth",
                f"{label} API 密钥无效或无权访问，请检查 Windows 凭据后重试。",
            ) from error
        if status == 402 or any(word in message for word in ("quota", "balance", "billing", "insufficient")):
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "quota",
                f"{label} 额度或余额不足，请处理账户额度后重试。",
            ) from error
        if status == 429 or status == 408 or 500 <= status < 600:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "remote_busy",
                "AI 服务暂时繁忙，请稍后再试。",
            ) from error
        raise ProviderFailure(
            ProviderFailureKind.USER_ACTIONABLE,
            "provider_request",
            f"{label} 拒绝了本次请求，请检查模型与账户配置。",
        ) from error

    @staticmethod
    def _safe_usage(value: object) -> dict | None:
        if not isinstance(value, dict):
            return None
        usage = {}
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            item = value.get(key)
            if isinstance(item, int) and item >= 0:
                usage[key] = item
        return usage or None

    @staticmethod
    def _safe_response_metadata(
        *, answer: object, reasoning: object, finish_reason: object
    ) -> dict:
        content_length = len(answer) if isinstance(answer, str) else 0
        reasoning_length = len(reasoning) if isinstance(reasoning, str) else 0
        metadata = {
            "content_present": bool(isinstance(answer, str) and answer.strip()),
            "content_length": content_length,
            "reasoning_present": bool(
                isinstance(reasoning, str) and reasoning.strip()
            ),
            "reasoning_length": reasoning_length,
        }
        if isinstance(finish_reason, str) and finish_reason:
            metadata["finish_reason"] = finish_reason[:120]
        return metadata


class DeepSeekAdapter(OpenAICompatibleAdapter):
    """Compatibility name retained for the original Ask About This tests/API."""

    def __init__(self):
        super().__init__("deepseek")

    @staticmethod
    def _raise_http_failure(error: HTTPError) -> None:
        OpenAICompatibleAdapter("deepseek")._raise_http_failure(error)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _StrictProxyHandler(ProxyHandler):
    """Refuse configured bypasses instead of ever falling back to direct egress."""

    def proxy_open(self, req, proxy, type):
        if req.host and proxy_bypass(req.host):
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "proxy_bypass_forbidden",
                "OpenRouter/Gemini 的代理配置试图绕过目标地址；已拒绝直连。",
            )
        return super().proxy_open(req, proxy, type)


def _configured_openrouter_proxy() -> str | None:
    configured = os.environ.get("GUIDED_READER_OPENROUTER_PROXY", "").strip()
    if not configured and sys.platform == "win32":
        configured = _windows_user_proxy()
    if not configured:
        return None
    if "://" not in configured:
        configured = f"http://{configured}"
    parsed = urlparse(configured)
    try:
        port = parsed.port
    except ValueError as error:
        raise ProviderFailure(
            ProviderFailureKind.USER_ACTIONABLE,
            "proxy_configuration",
            "OpenRouter/Gemini 代理配置无效；已拒绝直连。",
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.params
        or parsed.query
        or parsed.fragment
        or port is None
    ):
        raise ProviderFailure(
            ProviderFailureKind.USER_ACTIONABLE,
            "proxy_configuration",
            "OpenRouter/Gemini 代理配置无效；已拒绝直连。",
        )
    return configured


def _windows_user_proxy() -> str:
    try:
        import winreg

        path = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
            enabled = int(winreg.QueryValueEx(key, "ProxyEnable")[0])
            raw = str(winreg.QueryValueEx(key, "ProxyServer")[0]).strip()
    except (ImportError, OSError, TypeError, ValueError):
        return ""
    if enabled != 1 or not raw:
        return ""
    if "=" not in raw:
        return raw
    routes = {}
    for item in raw.split(";"):
        name, separator, value = item.partition("=")
        if separator and value.strip():
            routes[name.strip().casefold()] = value.strip()
    return routes.get("https") or routes.get("http") or ""


def _is_loopback_endpoint(endpoint: str) -> bool:
    hostname = urlparse(endpoint).hostname
    if not hostname:
        return False
    if hostname.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def _iter_sse_data(response):
    """Yield complete SSE data fields while tolerating arbitrary byte fragmentation."""
    decoder = codecs.getincrementaldecoder("utf-8")()
    buffer = ""
    data_lines: list[str] = []
    read = getattr(response, "read1", None) or response.read
    while True:
        chunk = read(4096)
        if not chunk:
            buffer += decoder.decode(b"", final=True)
            break
        buffer += decoder.decode(chunk)
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.removesuffix("\r")
            if not line:
                if data_lines:
                    yield "\n".join(data_lines)
                    data_lines = []
                continue
            if line.startswith(":"):
                continue
            field, separator, value = line.partition(":")
            if separator and value.startswith(" "):
                value = value[1:]
            if field == "data":
                data_lines.append(value)
    if buffer:
        line = buffer.removesuffix("\r")
        field, separator, value = line.partition(":")
        if separator and value.startswith(" "):
            value = value[1:]
        if field == "data":
            data_lines.append(value)
    if data_lines:
        yield "\n".join(data_lines)
