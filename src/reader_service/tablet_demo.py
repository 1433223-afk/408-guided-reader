"""Prepare an independent, small book library for the opt-in tablet demo."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from reader_service.storage import ManagedPaths


_MARKER = ".tablet-demo.json"


def default_demo_dir() -> Path:
    base = Path(os.environ["LOCALAPPDATA"]) if os.environ.get("LOCALAPPDATA") else Path.cwd() / "var"
    return base / "408GuidedReaderAndroidTabletDemo"


def require_demo_data(path: Path) -> None:
    root = path.expanduser().resolve()
    marker = root / _MARKER
    try:
        metadata = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("Tablet LAN requires an independent library prepared by reader_service.tablet_demo prepare") from exc
    if not isinstance(metadata, dict) or metadata.get("kind") != "android-tablet-demo":
        raise ValueError("Tablet Demo marker does not match this independent data directory")
    # Windows MSIX LocalAppData virtualization can expose two textual paths to
    # the same directory; compare canonical paths, including older Demo markers.
    stored_dir = metadata.get("data_dir")
    source_dir = metadata.get("source_data_dir")
    if not isinstance(stored_dir, str) or Path(stored_dir).expanduser().resolve() != root:
        raise ValueError("Tablet Demo marker does not match this independent data directory")
    if source_dir is not None:
        if not isinstance(source_dir, str):
            raise ValueError("Tablet Demo source directory marker is invalid")
        source_root = Path(source_dir).expanduser().resolve()
        if source_root == root or source_root in root.parents or root in source_root.parents:
            raise ValueError("Tablet Demo may not serve the original learning library or a nested directory")


def configure_demo_providers() -> None:
    # Keep the normal Windows Credential Manager reader. Scope route changes
    # to this demo process, even if the launching shell has other overrides.
    for role in ("ASSISTANT", "MASTER", "SYSTEM", "GUIDE", "INLINE", "KP_GENERATOR"):
        os.environ[f"GUIDED_READER_{role}_PROVIDER"] = "deepseek"
    for role in ("REVIEW", "KP_REVIEW"):
        os.environ[f"GUIDED_READER_{role}_PROVIDER"] = "zhipu"
    os.environ["GUIDED_READER_OPENROUTER_DISABLED"] = "1"
    os.environ["GUIDED_READER_PROVIDER_BAKEOFF"] = "0"
    for role in ("GUIDE", "INLINE"):
        os.environ[f"GUIDED_READER_{role}_MODEL"] = os.environ.get("GUIDED_READER_DEEPSEEK_MODEL", "deepseek-flash")


def _source_connection(source: Path) -> sqlite3.Connection:
    database = source / "state.sqlite3"
    if not database.is_file():
        raise ValueError("Source library has no state.sqlite3")
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def list_source_books(source: Path) -> list[dict]:
    with closing(_source_connection(source.expanduser().resolve())) as connection:
        return [dict(row) for row in connection.execute("""
            SELECT b.id, b.title, r.page_count, r.byte_size
            FROM books b JOIN book_source_revisions r ON r.book_id=b.id
            WHERE b.status='ACTIVE' AND r.status='ACTIVE' ORDER BY b.created_at DESC
        """)]


def prepare_demo(source: Path | None, destination: Path, book_ids: list[str]) -> dict:
    destination = destination.expanduser().resolve()
    source = source.expanduser().resolve() if source is not None else None
    if source is not None and (source == destination or source in destination.parents or destination in source.parents):
        raise ValueError("Source and Demo directories must be separate, without nesting")
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Demo destination must be new or empty; existing Demo learning data is never overwritten")
    if source is not None:
        if not book_ids:
            raise ValueError("Select at least one --book-id; use list-books first (the whole library is never copied implicitly)")
        available = {book["id"]: book for book in list_source_books(source)}
        if set(book_ids) - available.keys():
            raise ValueError("Selected book ID is not active in the source library")
    elif book_ids:
        raise ValueError("--book-id requires --source-data-dir")

    destination.mkdir(parents=True, exist_ok=True)
    paths = ManagedPaths(destination)
    paths.initialize()
    destination = paths.root
    copied_bytes = 0
    selected = []
    if source is None:
        from reader_service.library import LibraryService
        LibraryService(paths)
    else:
        # SQLite's backup API includes a consistent committed WAL snapshot,
        # unlike copying a database file while the desktop is still running.
        with closing(_source_connection(source)) as original, closing(sqlite3.connect(paths.database())) as snapshot:
            original.backup(snapshot)
            snapshot.row_factory = sqlite3.Row
            snapshot.execute("PRAGMA foreign_keys = ON")
            snapshot.execute("BEGIN")
            snapshot.execute("PRAGMA defer_foreign_keys = ON")
            placeholders = ",".join("?" for _ in book_ids)
            snapshot.execute(f"DELETE FROM books WHERE id NOT IN ({placeholders})", book_ids)
            # Do not inherit queued background model calls or unfinished work.
            # Published OCR/Directory/learning assets and positions remain.
            snapshot.execute("UPDATE jobs SET status='CANCELLED',cancel_requested=1 WHERE status IN ('QUEUED','RUNNING')")
            # Startup recovery reconstructs KP jobs from preparation state,
            # even when the copied job itself was cancelled. Stop that intent
            # in the snapshot while preserving already-published structures.
            timestamp = datetime.now(UTC).isoformat()
            snapshot.execute("""UPDATE chapter_preparations SET status='FAILED',
                failure_stage='SNAPSHOT',failure_kind='INTERRUPTED',failure_code='tablet_demo_snapshot',
                prepare_stage=NULL,updated_at=? WHERE status='PREPARING'""", (timestamp,))
            snapshot.execute("""UPDATE chapter_preparations SET regeneration_state='FAILED',
                regeneration_failure_stage='SNAPSHOT',regeneration_failure_kind='INTERRUPTED',
                regeneration_failure_code='tablet_demo_snapshot',prepare_stage=NULL,updated_at=?
                WHERE regeneration_state='RUNNING'""", (timestamp,))
            snapshot.execute("""UPDATE chapter_pipeline_attempts SET status='INTERRUPTED',
                completed_at=?,failure_kind='INTERRUPTED',failure_code='tablet_demo_snapshot'
                WHERE status='STARTED'""", (timestamp,))
            for asset_table in ("teaching_assets", "inline_teaching_assets"):
                snapshot.execute(f"""UPDATE {asset_table} SET state='FAILED',terminal=0,
                    failure_code='tablet_demo_snapshot',failure_detail='Demo 副本不继承原库未完成的生成任务。'
                    WHERE state IN ('DRAFT','IN_REVIEW','REJECTED')""")
            violations = snapshot.execute("PRAGMA foreign_key_check").fetchone()
            if violations:
                raise ValueError("Demo snapshot has inconsistent references; original library was not changed")
            selected = [dict(row) for row in snapshot.execute("SELECT id,title FROM books WHERE status='ACTIVE'")]
            blobs = list(snapshot.execute("SELECT DISTINCT blob_sha256,byte_size FROM book_source_revisions WHERE status != 'DELETED'"))
            snapshot.commit()
            snapshot.execute("VACUUM")
            if snapshot.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("Demo snapshot verification failed")
        original_paths = ManagedPaths(source)
        for digest, size in blobs:
            original_pdf = original_paths.blob(digest)
            if not original_pdf.is_file() or original_pdf.stat().st_size != size:
                raise ValueError("A selected source PDF is missing or changed; the incomplete Demo cannot be served")
            copied_pdf = paths.blob(digest)
            copied_pdf.parent.mkdir(parents=True, exist_ok=True)
            # Physical copy isolates content, deletion and NTFS attributes.
            # A hard link would share the underlying file with the real book.
            shutil.copyfile(original_pdf, copied_pdf)
            copied_bytes += size

    metadata = {
        "kind": "android-tablet-demo", "created_at": datetime.now(UTC).isoformat(),
        "data_dir": str(destination), "source_data_dir": str(source) if source else None,
        "books": selected, "copied_pdf_bytes": copied_bytes,
    }
    (destination / _MARKER).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list-books", help="Read source IDs without changing its library")
    listing.add_argument("--source-data-dir", type=Path, required=True)
    prepare = commands.add_parser("prepare", help="Create a new isolated Demo, never overwrite one")
    prepare.add_argument("--source-data-dir", type=Path)
    prepare.add_argument("--book-id", action="append", default=[])
    prepare.add_argument("--data-dir", type=Path, default=default_demo_dir())
    args = parser.parse_args()
    try:
        if args.command == "list-books":
            result = list_source_books(args.source_data_dir)
        else:
            result = prepare_demo(args.source_data_dir, args.data_dir, args.book_id)
    except (ValueError, sqlite3.Error, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
