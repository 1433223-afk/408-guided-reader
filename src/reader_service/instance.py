"""Deployment configuration and an OS-held lock; no product identity lives here."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class InstanceProfile:
    name: str = "personal"
    public_origin: str | None = None
    credential_dir: Path | None = None
    ai_disabled_file: Path | None = None
    disk_margin: int = 2 * 1024**3

    @property
    def beta(self) -> bool:
        return self.name == "beta"

    @property
    def host(self) -> str:
        return urlsplit(self.public_origin or "").netloc

    def validate(self, data_dir: Path, host: str, workers: int) -> None:
        if self.name not in {"personal", "beta"}:
            raise ValueError("Unknown profile")
        if not self.beta:
            return
        origin = urlsplit(self.public_origin or "")
        if (origin.scheme != "https" or not origin.hostname or origin.username or origin.password
                or origin.path or origin.query or origin.fragment or origin.port not in (None, 443)
                or not re.fullmatch(r"[a-z0-9.-]+(?::443)?", origin.netloc)):
            raise ValueError("Beta requires a canonical HTTPS public origin")
        if host != "127.0.0.1" or workers != 1:
            raise ValueError("Beta requires 127.0.0.1 and one preparation worker")
        if not data_dir.is_absolute() or not self.credential_dir or not self.credential_dir.is_absolute():
            raise ValueError("Beta requires explicit absolute data and credential directories")
        for root in (data_dir, self.credential_dir):
            if any(item.is_symlink() for item in (root, *root.parents)):
                raise ValueError("Instance paths must not contain symlinks")
        data, credentials = data_dir.resolve(), self.credential_dir.resolve()
        if data == credentials or data in credentials.parents or credentials in data.parents:
            raise ValueError("Data and credential directories must be disjoint")
        if self.disk_margin < 0:
            raise ValueError("Disk safety margin must be nonnegative")


class InstanceLock:
    """Kernel releases the lock on process exit. Never unlink the locked inode."""
    def __init__(self, data_dir: Path):
        self.root = data_dir.resolve()
        self.file = None

    def __enter__(self):
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / ".instance.lock"
        if path.is_symlink():
            raise ValueError("Invalid instance lock")
        self.file = path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt
                if path.stat().st_size == 0:
                    self.file.write(b"0")
                    self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            self.file = None
            raise RuntimeError("Data directory is already in use") from None
        return self

    def __exit__(self, *args):
        if self.file:
            self.file.close()
            self.file = None
