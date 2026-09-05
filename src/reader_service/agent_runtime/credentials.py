from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes


DEEPSEEK_CREDENTIAL_TARGET = "408-guided-reader-deepseek"
DEVELOPMENT_KEY_ENV = "GUIDED_READER_DEEPSEEK_API_KEY"


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


def read_deepseek_api_key() -> str | None:
    """Read the development override or the fixed Windows generic credential.

    Credential failures intentionally collapse to ``None`` so OS error details and
    credential bytes can never reach an HTTP error surface or structured log.
    """

    if os.environ.get("GUIDED_READER_DEEPSEEK_DISABLED", "").strip() == "1":
        return None
    override = os.environ.get(DEVELOPMENT_KEY_ENV, "").strip()
    if override:
        return override
    if sys.platform != "win32":
        return None
    try:
        advapi32 = ctypes.WinDLL("Advapi32.dll")
        credential = ctypes.POINTER(_CREDENTIALW)()
        cred_read = advapi32.CredReadW
        cred_read.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
        cred_read.restype = wintypes.BOOL
        cred_free = advapi32.CredFree
        cred_free.argtypes = [ctypes.c_void_p]
        if not cred_read(DEEPSEEK_CREDENTIAL_TARGET, 1, 0, ctypes.byref(credential)):
            return None
        try:
            size = int(credential.contents.CredentialBlobSize)
            if size <= 0 or not credential.contents.CredentialBlob:
                return None
            raw = ctypes.string_at(credential.contents.CredentialBlob, size)
            # Windows generic credentials written by Credential Manager are normally
            # UTF-16LE. A UTF-8 fallback keeps programmatic generic credentials usable.
            try:
                value = raw.decode("utf-16-le") if b"\x00" in raw else raw.decode("utf-8")
            except UnicodeDecodeError:
                return None
            return value.rstrip("\x00").strip() or None
        finally:
            cred_free(credential)
    except (AttributeError, OSError, ValueError):
        return None
