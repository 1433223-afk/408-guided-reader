from __future__ import annotations

from contextlib import closing
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import stat
from uuid import uuid4
import zipfile

import pytest

from conftest import make_pdf
from reader_service.foundation import FoundationRepository
from reader_service.foundation.contracts import DetectedLine
from reader_service.ink import InkService
from reader_service.jobs import JobRepository
from reader_service.library import LibraryService
from reader_service.library_transfer import LibraryArchiveError, export_demo_library, library_is_empty, restore_library
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import prepare_demo


@pytest.fixture
def old_demo(tmp_path):
    root = tmp_path / "old-demo"
    prepare_demo(None, root, [])
    library = LibraryService(ManagedPaths(root))
    body = make_pdf(((100, 200),))
    book = library.intake(BytesIO(body), content_length=len(body), filename="test.pdf")["book"]
    rid = book["active_revision"]["id"]
    foundation = FoundationRepository(library.database)
    foundation.ensure_pages(rid, 1, 1)
    foundation.mark_preparing(rid, 0)
    foundation.publish_page(rid, 0, route="OCR", foundation_version=1, engine_profile="existing-desktop:v1",
                            lines=[DetectedLine(((.1,.1),(.8,.1),(.8,.2),(.1,.2)), "已有学习内容", 1.,
                                                ((.1,.2,0,1),(.2,.3,1,2),(.3,.4,2,3),(.4,.5,3,4),(.5,.6,4,5),(.6,.8,5,6)))])
    ink = InkService(library.paths)
    ink.apply_operation(rid, {"operation_id": str(uuid4()), "action": "put", "stroke_id": str(uuid4()),
                             "stroke": {"page_index": 0, "color": "#f04452", "width": .0025,
                                        "coordinate_version": 1, "points": [[.1,.1,.5],[.2,.2,.7]]}})
    library.save_position(rid, 0, .25, 1.5)
    (root / "credentials.json").write_text("private-key-must-not-leave-demo", encoding="utf-8")
    (root / "tmp" / "connection-token.txt").write_text("private-launch-token", encoding="utf-8")
    return library, rid


def package(tmp_path, old_demo):
    output = tmp_path / "transfer.grlibrary"
    export_demo_library(old_demo[0].paths.root, output)
    return output


def rewrite(source, destination, transform, *, extra=None):
    with zipfile.ZipFile(source) as original:
        entries = {item.filename: original.read(item) for item in original.infolist()}
    entries = transform(entries)
    with zipfile.ZipFile(destination, "w") as archive:
        for name, body in entries.items():
            archive.writestr(name, body)
        if extra:
            archive.writestr(*extra)


def test_export_is_readonly_and_archive_omits_credentials_source_paths_and_caches(tmp_path, old_demo):
    library, _ = old_demo
    database_before = library.paths.database().read_bytes()
    output = package(tmp_path, old_demo)
    assert library.paths.database().read_bytes() == database_before
    with zipfile.ZipFile(output) as archive:
        assert len(archive.namelist()) == 3
        manifest = archive.read("manifest.json")
        assert b"private-key" not in manifest and b"private-launch-token" not in manifest
        assert str(library.paths.root).encode() not in manifest
        assert not any("credentials" in name or "tmp" in name or ".tablet-demo" in name for name in archive.namelist())
        assert json.loads(manifest)["unfinished_tasks"] == "interrupted"


def test_restore_preserves_existing_ocr_ink_position_and_original_pdf_identity(tmp_path, old_demo):
    library, rid = old_demo
    output = package(tmp_path, old_demo)
    destination = tmp_path / "android-private-data"
    LibraryService(ManagedPaths(destination))
    assert library_is_empty(destination)
    result = restore_library(destination, output)
    assert result == {"restored": True, "books": 1, "pages": 1, "unfinished_tasks": "interrupted"}
    restored = LibraryService(ManagedPaths(destination))
    assert restored.list_books()[0]["active_revision"]["id"] == rid
    assert restored.list_books()[0]["active_revision"]["position"]["zoom"] == 1.5
    assert FoundationRepository(restored.database).overlay(rid, 0)["lines"][0]["text"] == "已有学习内容"
    assert InkService(restored.paths).list_strokes(rid, 0) == InkService(library.paths).list_strokes(rid, 0)
    assert restored.pdf_path(rid).read_bytes() == library.pdf_path(rid).read_bytes()
    assert not library_is_empty(destination)
    assert list(tmp_path.glob("android-private-data.before-import-*"))


def test_existing_local_content_is_never_replaced_even_if_archive_is_valid(tmp_path, old_demo):
    output = package(tmp_path, old_demo)
    original = old_demo[0].paths.database().read_bytes()
    with pytest.raises(LibraryArchiveError, match="已有内容"):
        restore_library(old_demo[0].paths.root, output)
    assert old_demo[0].paths.database().read_bytes() == original


@pytest.mark.parametrize("path", ["../escape", "/absolute", "blobs/aa/../../escape", "C:/escape", "blobs\\aa\\escape.pdf", ".tablet-demo.json"])
def test_zip_slip_and_unlisted_files_are_rejected_without_destination_changes(tmp_path, old_demo, path):
    source = package(tmp_path, old_demo)
    invalid = tmp_path / "invalid.grlibrary"
    rewrite(source, invalid, lambda entries: entries, extra=(path, b"not allowed"))
    destination = tmp_path / "destination"
    with pytest.raises(LibraryArchiveError, match="路径"):
        restore_library(destination, invalid)
    assert not destination.exists() and not (tmp_path / "escape").exists()


def test_hash_mismatch_and_missing_original_pdf_do_not_replace_an_empty_database(tmp_path, old_demo):
    source = package(tmp_path, old_demo)
    invalid = tmp_path / "invalid.grlibrary"
    def corrupt(entries):
        name = next(name for name in entries if name.startswith("blobs/"))
        entries[name] = b"!" + entries[name][1:]
        return entries
    rewrite(source, invalid, corrupt)
    destination = tmp_path / "destination"
    LibraryService(ManagedPaths(destination))
    original = (destination / "state.sqlite3").read_bytes()
    with pytest.raises(LibraryArchiveError, match="校验失败"):
        restore_library(destination, invalid)
    assert (destination / "state.sqlite3").read_bytes() == original
    assert library_is_empty(destination)


def test_untrusted_schema_is_rejected_even_with_recomputed_file_hash(tmp_path, old_demo):
    source = package(tmp_path, old_demo)
    malicious = tmp_path / "untrusted.sqlite3"
    with zipfile.ZipFile(source) as archive:
        malicious.write_bytes(archive.read("state.sqlite3"))
    with sqlite3.connect(malicious) as connection:
        connection.execute("CREATE TABLE private_extra_table(secret TEXT)")
    body = malicious.read_bytes()
    def replace(entries):
        manifest = json.loads(entries["manifest.json"])
        database = next(item for item in manifest["files"] if item["path"] == "state.sqlite3")
        database.update(size=len(body), sha256=hashlib.sha256(body).hexdigest())
        entries["manifest.json"] = json.dumps(manifest).encode()
        entries["state.sqlite3"] = body
        return entries
    invalid = tmp_path / "invalid.grlibrary"
    rewrite(source, invalid, replace)
    with pytest.raises(LibraryArchiveError, match="不兼容"):
        restore_library(tmp_path / "destination", invalid)


def test_size_limits_and_symlink_entries_are_rejected(tmp_path, old_demo, monkeypatch):
    import reader_service.library_transfer as module
    source = package(tmp_path, old_demo)
    monkeypatch.setattr(module, "MAX_ARCHIVE_BYTES", 10)
    with pytest.raises(LibraryArchiveError, match="大小限制"):
        restore_library(tmp_path / "destination", source)
    monkeypatch.setattr(module, "MAX_ARCHIVE_BYTES", 8 * 1024**3)
    invalid = tmp_path / "link.grlibrary"
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(invalid, "w") as target:
        for item in original.infolist():
            if item.filename == "state.sqlite3":
                item.create_system = 3
                item.external_attr = (stat.S_IFLNK | 0o777) << 16
            target.writestr(item, original.read(item))
    with pytest.raises(LibraryArchiveError, match="文件类型"):
        restore_library(tmp_path / "destination", invalid)


def test_non_demo_export_and_output_inside_library_are_rejected(tmp_path, old_demo):
    plain = tmp_path / "ordinary-user-library"
    LibraryService(ManagedPaths(plain))
    with pytest.raises(ValueError):
        export_demo_library(plain, tmp_path / "bad.grlibrary")
    with pytest.raises(LibraryArchiveError, match="之外"):
        export_demo_library(old_demo[0].paths.root, old_demo[0].paths.root / "inside.grlibrary")


def test_unfinished_work_is_interrupted_only_in_copy_and_published_text_is_preserved(tmp_path, old_demo):
    library, rid = old_demo
    jobs = JobRepository(library.database)
    jobs.enqueue_pages(rid, 1, 1)
    with library.database.connect() as connection:
        before = [tuple(row) for row in connection.execute("SELECT id,status,cancel_requested FROM jobs")]
    assert before and all(row[1] == "QUEUED" for row in before)
    output = package(tmp_path, old_demo)
    destination = tmp_path / "android"
    restore_library(destination, output)
    restored = LibraryService(ManagedPaths(destination))
    with restored.database.connect() as connection:
        after = [tuple(row) for row in connection.execute("SELECT id,status,cancel_requested FROM jobs")]
    assert [row[0] for row in after] == [row[0] for row in before]
    assert all(row[1:] == ("CANCELLED", 1) for row in after)
    with library.database.connect() as connection:
        assert [tuple(row) for row in connection.execute("SELECT id,status,cancel_requested FROM jobs")] == before
    assert FoundationRepository(restored.database).overlay(rid, 0)["lines"][0]["text"] == "已有学习内容"


def test_lan_library_download_uses_existing_auth_origin_and_fixed_artifact_path(service, tmp_path):
    from test_tablet_lan import lan_get, lan_request_server
    root = tmp_path / "package-root"
    artifact = root / "dist" / "android" / "GuidedReader-Tablet-Library.grlibrary"
    artifact.parent.mkdir(parents=True)
    auth = {"X-Reader-Token": "test-tablet-token"}
    with lan_request_server(service, project_root=root) as (port, host):
        assert lan_get(port, host, "/tablet-library.grlibrary")[0] == 401
        assert lan_get(port, host, "/tablet-library.grlibrary", auth)[0] == 503
        artifact.write_bytes(b"PK\x03\x04isolated-test-library")
        status, headers, body = lan_get(port, host, "/tablet-library.grlibrary", auth)
        assert status == 200 and body == artifact.read_bytes()
        assert headers["Content-Type"] == "application/octet-stream"
        assert headers["Content-Disposition"] == 'attachment; filename="GuidedReader-Tablet-Library.grlibrary"'
        assert headers["Referrer-Policy"] == "no-referrer"
        assert lan_get(port, host, "/tablet-library.grlibrary?token=test-tablet-token")[0] == 200
        assert lan_get(port, host, "/tablet-library.grlibrary", {**auth, "Origin": "https://untrusted.example"})[0] == 403
        assert lan_get(port, host, "/tablet-library.grlibrary/../../state.sqlite3", auth)[0] == 404
