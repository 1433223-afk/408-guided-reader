"""The Beta-only credential and egress boundary. No inherited provider secrets."""
from __future__ import annotations

import os
import stat
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path

from .runtime import ProviderFailure, ProviderFailureKind

ENDPOINT = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-flash"


def refusal(code: str, message: str) -> ProviderFailure:
    return ProviderFailure(ProviderFailureKind.UNCONFIGURED, code, message)


def check_route(provider: str, endpoint: str, model: str) -> None:
    if (provider, endpoint, model) != ("deepseek", ENDPOINT, MODEL):
        raise refusal("beta_route_denied", "Beta 仅支持 DeepSeek，请刷新后重试。")


class PrivateCredential:
    def __init__(self, directory: Path):
        self.directory = directory.resolve()
        if directory.is_symlink():
            raise ValueError("Credential directory must not be a symlink")
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._check_private(self.directory, directory=True)
        self.path = self.directory / "deepseek.key"
        self.lock = threading.RLock()
        self.validation = "UNCONFIGURED" if not self.path.exists() else "STORED"

    @staticmethod
    def _check_private(path: Path, *, directory=False):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or (not directory and not stat.S_ISREG(info.st_mode)):
            raise ValueError("Invalid private credential path")
        if os.name != "nt" and (info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077):
            raise ValueError("Credential ownership or permissions are unsafe")

    @staticmethod
    def validate_input(value):
        if not isinstance(value, str) or not 8 <= len(value) <= 512 or any(ord(c) < 33 or ord(c) > 126 for c in value):
            raise ValueError("请输入有效的 DeepSeek Key。")
        return value

    def load(self):
        with self.lock:
            if not self.path.exists():
                return None
            self._check_private(self.directory, directory=True)
            self._check_private(self.path)
            with self.path.open("r", encoding="utf-8") as source:
                return self.validate_input(source.read(513))

    def invalidate(self, failed_key):
        with self.lock:
            if self.load() == failed_key:
                self.validation = "INVALID"

    def save(self, value):
        self.validate_input(value)
        with self.lock:
            self._check_private(self.directory, directory=True)
            fd, name = tempfile.mkstemp(prefix=".key-", dir=self.directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    if os.name != "nt":
                        os.fchmod(output.fileno(), 0o600)
                    output.write(value)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(name, self.path)
                self.validation = "VALIDATED"
            finally:
                Path(name).unlink(missing_ok=True)

    def disconnect(self):
        with self.lock:
            self.path.unlink(missing_ok=True)
            self.validation = "UNCONFIGURED"

    def status(self):
        try:
            configured = bool(self.load())
        except (OSError, ValueError):
            return {"configured": False, "validation": "UNAVAILABLE"}
        return {"configured": configured, "validation": self.validation if configured else "UNCONFIGURED"}


class BetaEgress:
    def __init__(self, credentials: PrivateCredential, disabled_file: Path | None = None, growth_check=None):
        self.credentials = credentials
        self.disabled_file = disabled_file
        self.growth_check = growth_check
        self.stopping = False
        self._lock = threading.Lock()
        self.active = 0
        self._credential_update = threading.Lock()

    @property
    def disabled(self):
        return self.stopping or bool(self.disabled_file and self.disabled_file.exists())

    @contextmanager
    def call(self, provider, endpoint, body, *, key=None):
        # Last boundary after role/model overrides, repeated for every retry/stream.
        check_route(provider, endpoint, body.get("model"))
        with self._lock:
            if self.disabled:
                raise refusal("ai_disabled", "管理员已暂停新 AI 调用，教材和已保存内容仍可阅读。")
            if self.active >= 2:
                raise refusal("ai_busy", "AI 正忙，请稍后重试。")
            if self.growth_check:
                self.growth_check()
            self.active += 1
        try:
            actual_key = key if key is not None else self.credentials.load()
            if not actual_key:
                raise refusal("key_missing", "请先设置自己的 DeepSeek Key；教材仍可阅读。")
            if key is None and self.credentials.validation == "INVALID":
                raise refusal("key_invalid", "DeepSeek Key 已失效，请在 Key 设置中更换。")
            try:
                yield actual_key
            except ProviderFailure as error:
                if key is None and error.code == "auth":
                    self.credentials.invalidate(actual_key)
                    raise refusal("key_invalid", "DeepSeek Key 已失效，请在 Key 设置中更换。") from None
                raise
        finally:
            with self._lock:
                self.active -= 1

    def replace_key(self, value, adapter):
        self.credentials.validate_input(value)
        if not self._credential_update.acquire(blocking=False):
            raise refusal("key_busy", "Key 正在更新，请稍后重试。")
        try:
            body = {"model": MODEL, "messages": [{"role": "user", "content": "Reply OK."}],
                    "max_tokens": 8, "thinking": {"type": "disabled"}, "stream": False}
            with self.call("deepseek", ENDPOINT, body, key=value) as candidate:
                # One bounded request, no retries, no prompt or provider payload capture.
                adapter.complete(ENDPOINT, candidate, body, 15)
            self.credentials.save(value)
        except ProviderFailure as error:
            if error.code in {"ai_busy", "ai_disabled", "key_busy"}:
                raise
            raise refusal("key_validation_failed", "Key 未通过验证或服务暂不可用，原有连接保持不变。") from None
        finally:
            self._credential_update.release()

    def disconnect(self):
        if not self._credential_update.acquire(blocking=False):
            raise refusal("key_busy", "Key 正在更新，请稍后重试。")
        try:
            self.credentials.disconnect()
        finally:
            self._credential_update.release()


class GuardedAdapter:
    """Every transport attempt consumes the one instance-wide guard."""
    provider_name = "deepseek"

    def __init__(self, adapter, guard):
        self.adapter, self.guard = adapter, guard

    def complete(self, endpoint, api_key, body, timeout):
        with self.guard.call(self.adapter.provider_name, endpoint, body) as key:
            return self.adapter.complete(endpoint, key, body, timeout)

    def stream(self, endpoint, api_key, body, timeout, on_delta, on_reasoning_delta=None):
        with self.guard.call(self.adapter.provider_name, endpoint, body) as key:
            return self.adapter.stream(endpoint, key, body, timeout, on_delta, on_reasoning_delta)


class DisabledInspector:
    def record(self, **kwargs):
        pass

    def snapshot(self):
        return []
