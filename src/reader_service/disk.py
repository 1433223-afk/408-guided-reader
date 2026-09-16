from __future__ import annotations

import shutil
import threading
from contextlib import contextmanager


class DiskSpaceError(ValueError):
    def __init__(self):
        super().__init__("空间不足，请联系管理员；教材和已保存内容仍可阅读。")


class DiskGuard:
    """Reserve declared upload growth, recheck real free bytes, never delete assets."""
    def __init__(self, root, margin=2 * 1024**3, usage=shutil.disk_usage):
        self.root, self.margin, self.usage = root, margin, usage
        self._reserved = 0
        self._lock = threading.RLock()

    def check(self, growth=64 * 1024):
        with self._lock:
            if self.usage(self.root).free < self.margin + self._reserved + growth:
                raise DiskSpaceError()

    @contextmanager
    def upload(self, length):
        with self._lock:
            self.check(length)
            self._reserved += length
        remaining = length
        def consumed(count):
            nonlocal remaining
            with self._lock:
                remaining -= count
                self._reserved -= count
                self.check()
        try:
            yield consumed
        finally:
            with self._lock:
                self._reserved -= remaining
