from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes
from dataclasses import dataclass, field


PROVIDER_CREDENTIAL_TARGETS = {
    "deepseek": "408-guided-reader-deepseek",
    "zhipu": "408-guided-reader-zhipu",
    "openrouter": "408-guided-reader-openrouter",
}
PROVIDER_KEY_ENVS = {
    "deepseek": "GUIDED_READER_DEEPSEEK_API_KEY",
    "zhipu": "GUIDED_READER_ZHIPU_API_KEY",
    "openrouter": "GUIDED_READER_OPENROUTER_API_KEY",
}
DEEPSEEK_CREDENTIAL_TARGET = PROVIDER_CREDENTIAL_TARGETS["deepseek"]
DEVELOPMENT_KEY_ENV = PROVIDER_KEY_ENVS["deepseek"]


@dataclass(frozen=True, slots=True)
class CredentialRead:
    """Secret-bearing credential result whose representation is always safe."""

    available: bool
    source: str
    reason: str | None
    key: str | None = field(default=None, repr=False)


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


class _CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", _FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def read_provider_credential(provider: str) -> CredentialRead:
    """Read a named provider credential with bounded, secret-safe diagnostics."""

    try:
        target = PROVIDER_CREDENTIAL_TARGETS[provider]
        key_env = PROVIDER_KEY_ENVS[provider]
    except KeyError as error:
        raise ValueError("unknown provider") from error
    prefix = provider.upper()
    if os.environ.get(f"GUIDED_READER_{prefix}_DISABLED", "").strip() == "1":
        return CredentialRead(False, "NONE", "DEVELOPMENT_DISABLED")
    override = os.environ.get(key_env, "").strip()
    if override:
        return CredentialRead(True, "DEVELOPMENT_OVERRIDE", None, override)
    if sys.platform != "win32":
        return CredentialRead(False, "NONE", "UNSUPPORTED_PLATFORM")
    try:
        advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
        credential = ctypes.POINTER(_CREDENTIALW)()
        cred_read = advapi32.CredReadW
        cred_read.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
        cred_read.restype = wintypes.BOOL
        cred_free = advapi32.CredFree
        cred_free.argtypes = [ctypes.c_void_p]
        if not cred_read(target, 1, 0, ctypes.byref(credential)):
            reason = "CREDENTIAL_NOT_FOUND" if ctypes.get_last_error() == 1168 else "CREDENTIAL_READ_FAILED"
            return CredentialRead(False, "WINDOWS_CREDENTIAL_MANAGER", reason)
        try:
            size = int(credential.contents.CredentialBlobSize)
            if size <= 0 or not credential.contents.CredentialBlob:
                return CredentialRead(False, "WINDOWS_CREDENTIAL_MANAGER", "CREDENTIAL_EMPTY")
            raw = ctypes.string_at(credential.contents.CredentialBlob, size)
            # Windows generic credentials written by Credential Manager are normally
            # UTF-16LE. A UTF-8 fallback keeps programmatic generic credentials usable.
            try:
                value = raw.decode("utf-16-le") if b"\x00" in raw else raw.decode("utf-8")
            except UnicodeDecodeError:
                return CredentialRead(False, "WINDOWS_CREDENTIAL_MANAGER", "CREDENTIAL_READ_FAILED")
            key = value.rstrip("\x00").strip()
            if not key:
                return CredentialRead(False, "WINDOWS_CREDENTIAL_MANAGER", "CREDENTIAL_EMPTY")
            return CredentialRead(True, "WINDOWS_CREDENTIAL_MANAGER", None, key)
        finally:
            cred_free(credential)
    except (AttributeError, OSError, ValueError):
        return CredentialRead(False, "WINDOWS_CREDENTIAL_MANAGER", "CREDENTIAL_READ_FAILED")


def read_deepseek_credential() -> CredentialRead:
    """Compatibility wrapper for the original provider-specific API."""

    return read_provider_credential("deepseek")


def read_deepseek_api_key() -> str | None:
    """Compatibility API returning the key without exposing diagnostic internals."""

    return read_deepseek_credential().key


def read_provider_api_key(provider: str) -> str | None:
    return read_provider_credential(provider).key
