from __future__ import annotations

import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .runtime import ProviderFailure, ProviderFailureKind


class DeepSeekAdapter:
    """Thin OpenAI-compatible DeepSeek chat-completions adapter."""

    provider_name = "deepseek"

    def complete(self, endpoint: str, api_key: str, body: dict, timeout: float) -> str:
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
            with build_opener(ProxyHandler({}), _NoRedirect()).open(
                request, timeout=timeout
            ) as response:
                payload = json.load(response)
        except HTTPError as error:
            self._raise_http_failure(error)
        except (TimeoutError, socket.timeout, URLError, OSError) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "network",
                "AI 服务暂时无法连接，请稍后再试。",
            ) from error

        try:
            answer = payload["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "invalid_response",
                "AI 服务返回了无法读取的结果，请稍后再试。",
            ) from error
        if not isinstance(answer, str) or not answer.strip():
            raise ProviderFailure(
                ProviderFailureKind.TRANSIENT,
                "empty_response",
                "AI 服务没有返回解释，请稍后再试。",
            )
        return answer.strip()

    @staticmethod
    def _raise_http_failure(error: HTTPError) -> None:
        # The remote body is used only for coarse classification and is never logged,
        # inspected, or reflected into the UI.
        try:
            raw = error.read(16 * 1024)
            remote = json.loads(raw.decode("utf-8", errors="replace"))
            message = str(remote.get("error", {}).get("message", "")).casefold()
        except (AttributeError, TypeError, ValueError, OSError):
            message = ""
        status = int(error.code)
        if status in (401, 403):
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "auth",
                "DeepSeek API 密钥无效或无权访问，请检查 Windows 凭据后重试。",
            ) from error
        if status == 402 or any(word in message for word in ("quota", "balance", "billing", "insufficient")):
            raise ProviderFailure(
                ProviderFailureKind.USER_ACTIONABLE,
                "quota",
                "DeepSeek 额度或余额不足，请处理账户额度后重试。",
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
            "DeepSeek 拒绝了本次请求，请检查模型与账户配置。",
        ) from error


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
