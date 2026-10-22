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

    def _sync(self):
        if self.observer is None:
            self.observer = sqlite3.connect(self.path, check_same_thread=False)
            weakref.finalize(self, self.observer.close)
        version = self.observer.execute("PRAGMA data_version").fetchone()[0]
        if self.observed is not None and version != self.observed:
            # A different Database instance/process, or an interrupted writer.
            self.views.clear()
        self.observed = version

    def commit(self, connection, tables):
        # Serialize publication and invalidation, not the whole write operation.
        with self.lock:
            if self.observer is not None:
                self._sync()
            connection.commit()
            for key, (dependencies, _) in list(self.views.items()):
                if dependencies.intersection(tables):
                    del self.views[key]
            if self.observer is not None:
                self.observed = self.observer.execute("PRAGMA data_version").fetchone()[0]

    def get(self, key, tables, build, connect):
        dependencies = frozenset(tables)
        with self.lock:
            self._sync()
            if key in self.views:
                self.views.move_to_end(key)
                return copy.deepcopy(self.views[key][1])
            before = self.observed
            with connect() as connection:
                connection.execute("BEGIN")
                value = build(connection)
            self._sync()
            if before == self.observed:
                self.views[key] = (dependencies, value)
                while len(self.views) > self.capacity:
                    self.views.popitem(last=False)
            return copy.deepcopy(value)
