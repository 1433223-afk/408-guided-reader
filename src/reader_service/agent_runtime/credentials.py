from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes
from dataclasses import dataclass, field


DEEPSEEK_CREDENTIAL_TARGET = "408-guided-reader-deepseek"
DEVELOPMENT_KEY_ENV = "GUIDED_READER_DEEPSEEK_API_KEY"


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


def read_deepseek_credential() -> CredentialRead:
    """Read DeepSeek credentials and return only bounded, secret-safe diagnostics."""
    if os.environ.get("GUIDED_READER_DEEPSEEK_DISABLED", "").strip() == "1":
        return CredentialRead(False, "NONE", "DEVELOPMENT_DISABLED")
    override = os.environ.get(DEVELOPMENT_KEY_ENV, "").strip()
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
        if not cred_read(DEEPSEEK_CREDENTIAL_TARGET, 1, 0, ctypes.byref(credential)):
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


def read_deepseek_api_key() -> str | None:
    """Compatibility API returning the key without exposing diagnostic internals."""

    return read_deepseek_credential().key
