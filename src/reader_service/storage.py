from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path, PurePath
from typing import BinaryIO


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class PathContainmentError(ValueError):
    pass


class ManagedPaths:
    """The only boundary allowed to construct paths inside managed storage."""

    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        # Windows packaged-app execution can virtualize LocalAppData only when the directory is
        # first created. Re-resolve after creation so containment compares canonical paths on both
        # sides of that redirection boundary.
        self.root = self.root.resolve()
        self.blob_root().mkdir(parents=True, exist_ok=True)
        self.temp_root().mkdir(parents=True, exist_ok=True)

    def resolve(self, relative: str | PurePath) -> Path:
        candidate = PurePath(relative)
        if candidate.is_absolute() or ".." in candidate.parts:
            raise PathContainmentError(f"Managed path escapes its root: {relative!s}")
        resolved = self.root.joinpath(*candidate.parts).resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise PathContainmentError(f"Managed path escapes its root: {relative!s}") from exc
        return resolved

    def database(self) -> Path:
        return self.resolve("state.sqlite3")

    def blob_root(self) -> Path:
        return self.resolve("blobs")

    def temp_root(self) -> Path:
        return self.resolve("tmp")

    def blob(self, sha256: str) -> Path:
        if not _SHA256.fullmatch(sha256):
            raise PathContainmentError("Blob identity must be a lowercase SHA-256 digest")
        return self.resolve(PurePath("blobs", sha256[:2], f"{sha256}.pdf"))

    def new_upload(self) -> tuple[Path, BinaryIO]:
        raw = tempfile.NamedTemporaryFile(
            mode="w+b", prefix="intake-", suffix=".pdf", dir=self.temp_root(), delete=False
        )
        return Path(raw.name), raw


class BlobStore:
    def __init__(self, paths: ManagedPaths):
        self.paths = paths

    def commit(self, temporary: Path, sha256: str) -> tuple[Path, bool]:
        destination = self.paths.blob(sha256)
        if destination.exists():
            temporary.unlink(missing_ok=True)
            return destination, False
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(temporary, destination)
        self._fsync_directory(destination.parent)
        return destination, True

    def delete(self, sha256: str) -> None:
        path = self.paths.blob(sha256)
        path.unlink(missing_ok=True)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        if os.name == "nt":
            return
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
