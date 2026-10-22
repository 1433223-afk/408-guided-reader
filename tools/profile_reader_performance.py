"""Local Reader survey, using a SQLite backup and disposable imported books.

No provider calls. Source PDFs and source Library are read-only. Output contains
timings/counts, never OCR, notes, conversation contents or launch credentials.
"""
from __future__ import annotations

import argparse
import cProfile
import contextlib
import gc
import json
import pstats
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

from reader_service.foundation import FoundationRepository, FoundationService, PageLabelRepository, PageLabelService
from reader_service.foundation.rapidocr_adapter import RapidOcrEngine
from reader_service.learning.repository import LearningRepository
from reader_service.library import LibraryService
from reader_service.library.database import Database
from reader_service.memory import LearningMemory
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.practice_prototype import PracticePrototype
from reader_service.practice_catalog import build_catalog
from reader_service.storage import ManagedPaths
from reader_service.visual_region import render_visual_region


def memory_mib():
    """Current and process-lifetime peak working set; excludes child processes."""
    if sys.platform != "win32":
        return None, None
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    get_memory = ctypes.WinDLL("psapi").GetProcessMemoryInfo
    get_memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    if not get_memory(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return None, None
    return tuple(round(value / 1024**2, 1) for value in (
        counters.WorkingSetSize, counters.PeakWorkingSetSize))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(tempfile.mkdtemp(prefix="reader-performance-survey-"))
    snapshot = root / "library"
    snapshot.mkdir()
    source = sqlite3.connect(args.library.resolve().joinpath("state.sqlite3").as_uri() + "?mode=ro", uri=True)
    destination = sqlite3.connect(snapshot / "state.sqlite3")
    source.backup(destination)
    source.close()
    destination.close()
    shutil.copytree(args.library / "blobs", snapshot / "blobs")
    results = {"snapshot": str(snapshot), "operations": [], "imports": []}
    library = LibraryService(ManagedPaths(snapshot))
    foundation = FoundationService(library, FoundationRepository(library.database), RapidOcrEngine)
    labels = PageLabelService(library, PageLabelRepository(library.database))
    outline = OutlineService(library, OutlineRepository(library.database), labels)
    practice = PracticePrototype(library.database)
    learning = LearningRepository(library.database)
    memory = LearningMemory(library.database)
    books = library.list_books()
    revision = next(book["active_revision"]["id"] for book in books
                    if book["active_revision"]["page_count"] == 348)
    sql = {"connections": 0, "statements": 0}
    original_connect = Database.connect

    @contextlib.contextmanager
    def counted_connect(database):
        sql["connections"] += 1
        with original_connect(database) as connection:
            def statement(_):
                sql["statements"] += 1
            connection.set_trace_callback(statement)
            yield connection

    def measure(name, action, repeats=3, profile=False):
        rows = []
        profiler = cProfile.Profile() if profile else None
        for _ in range(repeats):
            before = dict(sql)
            started = time.perf_counter()
            if profiler:
                profiler.enable()
            value = action()
            if profiler:
                profiler.disable()
            elapsed = (time.perf_counter() - started) * 1000
            encoded = json.dumps(value, ensure_ascii=False).encode()
            rows.append({"ms": round(elapsed, 3), "bytes": len(encoded),
                         **{key: sql[key] - before[key] for key in sql},
                         "rss_mib": memory_mib()[0]})
        result = {"name": name, "rows": rows}
        if profiler:
            stats = pstats.Stats(profiler)
            result["profile"] = [
                {"file": Path(file).name, "line": line, "function": function,
                 "calls": values[1], "own_s": round(values[2], 5), "total_s": round(values[3], 5)}
                for (file, line, function), values in sorted(
                    stats.stats.items(), key=lambda item: item[1][3], reverse=True)[:18]]
        results["operations"].append(result)
        print(name, [row["ms"] for row in rows], flush=True)
        return value

    Database.connect = counted_connect
    try:
        measure("library-list", library.list_books)
        measure("page-statuses", lambda: foundation.statuses(revision))
        measure("overlay-51", lambda: foundation.overlay(revision, 50))
        measure("outline-snapshot", lambda: outline.stored_snapshot(revision))
        measure("outline-reading-context", lambda: outline.reading_context(revision, 50, .4))
        measure("learning-entries", lambda: learning.entries(revision))
        measure("learning-entries-profiled", lambda: learning.entries(revision), repeats=1, profile=True)
        measure("memory-list", memory.list)
        search_result = measure("search-common", lambda: foundation.search(revision, "计算机"))
        measure("search-absent", lambda: foundation.search(revision, "PERF_SURVEY_ABSENT"))

        def search_one_connection():
            # Laboratory prototype only: actual code should pass an explicit
            # operation-scoped reader, never patch a shared Database instance.
            with counted_connect(library.database) as connection:
                @contextlib.contextmanager
                def reuse():
                    yield connection
                library.database.connect = reuse
                try:
                    return foundation.search(revision, "计算机")
                finally:
                    del library.database.connect

        reused = measure("prototype-search-one-connection", search_one_connection)
        results["search_same_result"] = reused == search_result
        catalog = measure("practice-catalog-first", lambda: practice.public_catalog(revision), repeats=1, profile=True)
        results["practice_sections"] = len(catalog)
        results["practice_questions"] = sum(len(section["questions"]) for section in catalog)
        measure("practice-catalog-repeat", lambda: practice.public_catalog(revision))
        measure("practice-records", lambda: practice.list(revision))
        measure("practice-favorites", practice.list_favorites)
        full_catalog = practice.catalog(revision)
        results["scoped_section_equality"] = {}
        for section in (full_catalog[0], next(section for section in full_catalog if section["id"] == "524"), full_catalog[-1]):
            def scoped(section=section):
                with library.database.connect() as connection:
                    source = practice._require_source(connection, revision)
                    return build_catalog(connection, revision, source, section_id=section["id"])
            value = measure("practice-scoped-" + section["id"], scoped)
            results["scoped_section_equality"][section["id"]] = value == [section]
        measure("visual-crop-repeat", lambda: render_visual_region(library, revision, 250, [.10, .15, .9, .68]))
    finally:
        Database.connect = original_connect

    # Intake runs separately from the prepared Library; no background OCR.
    imported = LibraryService(ManagedPaths(root / "imports"))
    samples = json.loads(args.samples.read_text(encoding="utf-8"))
    for sample in samples[:2]:
        path = Path(sample["pdf"])
        for repeat in range(2):
            profiler = cProfile.Profile()
            started = time.perf_counter()
            profiler.enable()
            with path.open("rb") as stream:
                value = imported.intake(stream, content_length=path.stat().st_size, filename=path.name)
            profiler.disable()
            elapsed = time.perf_counter() - started
            stats = pstats.Stats(profiler)
            result = {"label": sample["label"], "duplicate": value["duplicate"],
                      "mib": round(path.stat().st_size / 1024**2, 1),
                      "seconds": round(elapsed, 4), "rss_mib": memory_mib()[0],
                      "phases": [{"function": function, "calls": values[1],
                                  "own_s": round(values[2], 5), "total_s": round(values[3], 5)}
                                 for (_, _, function), values in stats.stats.items()
                                 if function in {"_validate_pdf", "_initialize_stream", "read", "readinto",
                                                 "_find_eof_marker", "find_revision_by_hash", "_read_pdf_structure"}]}
            results["imports"].append(result)
            print("import", result["label"], repeat, result["seconds"], result["rss_mib"], flush=True)
    results["rss_before_gc_mib"] = memory_mib()[0]
    gc.collect()
    results["rss_after_gc_mib"] = memory_mib()[0]
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Survey artifacts:", root, flush=True)


if __name__ == "__main__":
    main()
