"""Offline, explicit, dependency-free book repair. Never run alongside the server.

Default is a dry run. --apply requires an expected PDF hash, creates a verified
database backup, and publishes a fully validated staged database. User assets or
active jobs refuse the operation. No provider calls except the existing local OCR.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import tempfile
from pathlib import Path

from reader_service.foundation import (
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.foundation.geometry import reading_order
from reader_service.foundation.rapidocr_adapter import RapidOcrEngine
from reader_service.library import LibraryService
from reader_service.library.database import Database
from reader_service.library.repository import LibraryRepository
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.storage import ManagedPaths

SOURCE_TABLES = {
    "reading_positions",
    "ocr_pages",
    "ocr_lines",
    "page_labels",
    "outline_nodes",
    "outline_bootstrap_records",
    "jobs",
    "foundation_events",
}


def assert_unowned(connection, revision):
    for (table,) in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall():
        columns = {
            row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')
        }
        if ("book_source_revision_id" in columns and table not in SOURCE_TABLES
            and connection.execute(
                f'SELECT 1 FROM "{table}" WHERE book_source_revision_id=? LIMIT 1',
                (revision,),
            ).fetchone()):
            raise RuntimeError(f"Repair refused: durable dependent in {table}")
        for foreign in connection.execute(f'PRAGMA foreign_key_list("{table}")'):
            if (foreign[2] == "outline_nodes" and table != "outline_nodes"
                and connection.execute(
                    f'SELECT 1 FROM "{table}" WHERE "{foreign[3]}" IN '
                    "(SELECT outline_node_id FROM outline_nodes WHERE book_source_revision_id=?) LIMIT 1",
                    (revision,),
                ).fetchone()):
                raise RuntimeError(f"Repair refused: Outline dependent in {table}")
    if connection.execute(
        "SELECT 1 FROM jobs WHERE status IN ('RUNNING','QUEUED') LIMIT 1"
    ).fetchone():
        raise RuntimeError(
            "Stop the server and finish active jobs before offline repair"
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    paths = ManagedPaths(args.data_dir)
    library = LibraryService(paths)
    pdf = library.pdf_path(args.revision)
    if hashlib.sha256(pdf.read_bytes()).hexdigest() != args.expected_sha256:
        raise RuntimeError("PDF fingerprint mismatch")
    source = sqlite3.connect(args.data_dir / "state.sqlite3")
    assert_unowned(source, args.revision)
    previous_identity = source.execute(
        "SELECT COALESCE(MAX(identity_revision),0) FROM outline_nodes WHERE book_source_revision_id=?",
        (args.revision,),
    ).fetchone()[0]
    source_snapshot = "\n".join(source.iterdump())
    with tempfile.TemporaryDirectory(prefix="reader-evidence-repair-") as temporary:
        stage_path = Path(temporary) / "state.sqlite3"
        stage = sqlite3.connect(stage_path)
        source.backup(stage)
        stage.close()
        library.database = Database(stage_path)
        library.repository = LibraryRepository(library.database)
        foundation = FoundationService(
            library, FoundationRepository(library.database), RapidOcrEngine
        )
        repository = OutlineRepository(library.database)
        labels = PageLabelService(library, PageLabelRepository(library.database))
        outline = OutlineService(library, repository, labels)
        candidates = set()
        with library.database.connect() as c:
            for page, text, score in c.execute(
                "SELECT pdf_page_index,text,confidence FROM ocr_lines WHERE book_source_revision_id=?",
                (args.revision,),
            ):
                if score < 0.85 and re.search(r"[.·…⋯]{5,}", text):
                    candidates.add(page)
        for page in sorted(candidates):
            route, profile, lines = foundation._extract(pdf, page)
            with library.database.connect() as c:
                c.execute(
                    "UPDATE ocr_pages SET status='PREPARING' WHERE book_source_revision_id=? AND pdf_page_index=?",
                    (args.revision, page),
                )
            foundation.repository.publish_page(
                args.revision,
                page,
                route=route,
                foundation_version=library.revision(args.revision)[
                    "foundation_version"
                ],
                engine_profile=profile,
                lines=reading_order(lines),
            )
            print("Prepared repair candidate", page + 1, flush=True)
        # Explicit user-authorized IDENTITY correction, confined to an unowned revision.
        with library.database.connect() as c:
            assert_unowned(c, args.revision)
            c.execute(
                "DELETE FROM outline_nodes WHERE book_source_revision_id=?",
                (args.revision,),
            )
            c.execute(
                "DELETE FROM outline_bootstrap_records WHERE book_source_revision_id=?",
                (args.revision,),
            )
        result = outline.bootstrap(args.revision)
        nodes = result["nodes"]
        if (
            not nodes
            or result["identity_conflict"]
            or result["waiting_for_toc_completion"]
        ):
            raise RuntimeError("No validated replacement tree; live database untouched")
        with library.database.connect() as c:
            c.execute(
                "UPDATE outline_nodes SET identity_revision=? WHERE book_source_revision_id=?",
                (previous_identity + 1, args.revision),
            )
            assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            assert not c.execute("PRAGMA foreign_key_check").fetchall()
        print(
            json.dumps(
                {
                    "apply": args.apply,
                    "nodes": len(nodes),
                    "chapters": sum(n["kind"] == "CHAPTER" for n in nodes),
                    "sections": sum(n["kind"] == "SECTION" for n in nodes),
                    "repaired_pages": sorted(candidates),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        if args.apply:
            # Recheck live state: refuse if it changed while staging.
            assert_unowned(source, args.revision)
            if "\n".join(source.iterdump()) != source_snapshot:
                raise RuntimeError(
                    "Live database changed during repair; refusing replacement"
                )
            backup = args.data_dir / "before-evidence-repair.sqlite3"
            if backup.exists():
                raise RuntimeError(
                    "Backup already exists; never overwrite a recovery point"
                )
            target = sqlite3.connect(backup)
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup verification failed; live database untouched')
            target.close()
            repaired = sqlite3.connect(stage_path)
            repaired.backup(source)
            repaired.close()
            print("Published staged repair. Backup:", backup, flush=True)
    source.close()


if __name__ == "__main__":
    main()
