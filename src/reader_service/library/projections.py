"""Small, process-local derived views; SQLite remains the only source of truth."""
from __future__ import annotations

import copy
import sqlite3
import threading
import weakref
from collections import OrderedDict


class ProjectionCache:
    def __init__(self, path, capacity=16):
        self.path = path
        self.capacity = capacity
        self.lock = threading.RLock()
        self.views = OrderedDict()
        self.observer = None
        self.observed = None
        self.generation = 0

    def _sync(self):
        if self.observer is None:
            self.observer = sqlite3.connect(self.path, check_same_thread=False)
            weakref.finalize(self, self.observer.close)
        version = self.observer.execute("PRAGMA data_version").fetchone()[0]
        if self.observed is not None and version != self.observed:
            # A different Database instance/process, or an interrupted writer.
            self.views.clear()
            self.generation += 1
        self.observed = version

    def commit(self, connection, tables):
        # Serialize publication and invalidation, not the whole write operation.
        with self.lock:
            if self.observer is not None:
                self._sync()
                writer_version = connection.execute("PRAGMA data_version").fetchone()[0]
            connection.commit()
            self.generation += 1
            for key, (dependencies, _) in list(self.views.items()):
                if dependencies.intersection(tables):
                    del self.views[key]
            if self.observer is not None:
                self.observed = self.observer.execute("PRAGMA data_version").fetchone()[0]
                # An external writer may commit just after our write lock is
                # released. Do not acknowledge its change as our own commit.
                if connection.execute("PRAGMA data_version").fetchone()[0] != writer_version:
                    self.views.clear()

    def get(self, key, tables, build, connect):
        dependencies = frozenset(tables)
        with self.lock:
            self._sync()
            if key in self.views:
                self.views.move_to_end(key)
                value = self.views[key][1]
                cached = True
            else:
                before = self.generation
                cached = False
        if not cached:
            # A cold view can scan a whole book. Neither that read snapshot nor
            # copying its result should hold up OCR/position/favorite commits.
            with connect() as connection:
                connection.execute("BEGIN")
                value = build(connection)
            with self.lock:
                self._sync()
                # The result remains valid for this request's snapshot, but must
                # not become a cache hit if a writer committed during the build.
                if before == self.generation:
                    self.views[key] = (dependencies, value)
                    self.views.move_to_end(key)
                    while len(self.views) > self.capacity:
                        self.views.popitem(last=False)
        return copy.deepcopy(value)
