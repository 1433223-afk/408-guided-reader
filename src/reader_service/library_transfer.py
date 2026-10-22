"""One-time, checked migration of an isolated Tablet library to Android.

Archives contain a standalone SQLite backup and its immutable original PDFs.
No credentials, launch URLs, source directories, caches, or Demo marker are
included. Restore is deliberately limited to an empty, stopped local library.
"""

from __future__ import annotations

import argparse
from contextlib import closing
from datetime import UTC, datetime
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
from uuid import uuid4
import zipfile

from reader_service.library.database import Database, MIGRATIONS
from reader_service.storage import ManagedPaths


KIND = "guided-reader-library"
FORMAT_VERSION = 1
MAX_ARCHIVE_BYTES = 8 * 1024**3
MAX_TOTAL_BYTES = 16 * 1024**3
MAX_DATABASE_BYTES = 1024**3
MAX_PDF_BYTES = 2 * 1024**3
MAX_MANIFEST_BYTES = 512 * 1024
MAX_ENTRIES = 2048
_BLOB = re.compile(r"blobs/([0-9a-f]{2})/([0-9a-f]{64})\.pdf\Z")


class LibraryArchiveError(ValueError):
    """Only fixed, path/credential-free messages may cross the native UI boundary."""


def _readonly(path):
    connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
    connection.execute("PRAGMA query_only = ON")
    connection.execute("PRAGMA trusted_schema = OFF")
    return connection


def _schema(connection):
    return tuple((kind, name, table, re.sub(r"\s+", " ", sql or "").strip())
                 for kind, name, table, sql in connection.execute(
                     "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"))


@lru_cache(maxsize=1)
def _expected_schema():
    # Build from the exact current migration code, rather than trusting a
    # version number in an arbitrary incoming SQLite file.
    with tempfile.TemporaryDirectory(prefix="reader-schema-") as temporary:
        path = Path(temporary) / "state.sqlite3"
        Database(path).initialize()
        with closing(_readonly(path)) as connection:
            return _schema(connection)


def _database_info(path):
    try:
        if path.stat().st_size > MAX_DATABASE_BYTES:
            raise LibraryArchiveError("迁移包的学习数据库过大。")
        with closing(_readonly(path)) as connection:
            if _schema(connection) != _expected_schema():
                raise LibraryArchiveError("迁移包与当前 Reader 数据版本不兼容，请重新导出。")
            versions = {row[0] for row in connection.execute("SELECT version FROM schema_migrations")}
            if versions != {version for version, _ in MIGRATIONS}:
                raise LibraryArchiveError("迁移包的数据版本不完整，请重新导出。")
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok" or connection.execute("PRAGMA foreign_key_check").fetchone():
                raise LibraryArchiveError("迁移包的学习数据库校验失败。")
            books = connection.execute("SELECT count(*) FROM books").fetchone()[0]
            pages = connection.execute("SELECT coalesce(sum(page_count),0) FROM book_source_revisions WHERE status='ACTIVE'").fetchone()[0]
            blobs = []
            for digest, size in connection.execute("SELECT DISTINCT blob_sha256,byte_size FROM book_source_revisions WHERE status!='DELETED'"):
                if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or type(size) is not int or not 0 < size <= MAX_PDF_BYTES:
                    raise LibraryArchiveError("迁移包中的原 PDF 记录无效。")
                blobs.append({"path": f"blobs/{digest[:2]}/{digest}.pdf", "sha256": digest, "size": size})
            by_digest = {item["sha256"]: item for item in blobs}
            if len(by_digest) != len(blobs):
                raise LibraryArchiveError("迁移包中的原 PDF 大小记录冲突。")
            return {"books": books, "pages": pages, "blobs": sorted(blobs, key=lambda item: item["path"])}
    except LibraryArchiveError:
        raise
    except (sqlite3.Error, OSError, TypeError, ValueError) as exc:
        raise LibraryArchiveError("无法读取迁移包的学习数据库。") from exc


def library_is_empty(data_dir) -> bool:
    """Read-only preflight. Unrecognized or damaged data is never called empty."""
    root = Path(data_dir).expanduser().resolve()
    if not root.exists():
        return True
    try:
        blob_root = root / "blobs"
        if blob_root.exists() and any(path.is_file() or path.is_symlink() for path in blob_root.rglob("*")):
            return False
        database = root / "state.sqlite3"
        if not database.exists():
            return not any(item.name not in {"tmp", "blobs"} for item in root.iterdir())
        with closing(_readonly(database)) as connection:
            if _schema(connection) != _expected_schema():
                return False
            for kind, table, _, _ in _expected_schema():
                if kind == "table" and table != "schema_migrations":
                    # Table names come solely from our own migration schema.
                    if connection.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone():
                        return False
        return True
    except (OSError, sqlite3.Error, ValueError):
        return False


def _hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _pause_snapshot(database):
    timestamp = datetime.now(UTC).isoformat()
    with closing(sqlite3.connect(database)) as snapshot:
        snapshot.execute("PRAGMA foreign_keys = ON")
        snapshot.execute("UPDATE jobs SET status='CANCELLED',cancel_requested=1 WHERE status IN ('QUEUED','RUNNING')")
        snapshot.execute("""UPDATE chapter_preparations SET status='FAILED',failure_stage='SNAPSHOT',
            failure_kind='INTERRUPTED',failure_code='library_transfer',prepare_stage=NULL,updated_at=?
            WHERE status='PREPARING'""", (timestamp,))
        snapshot.execute("""UPDATE chapter_preparations SET regeneration_state='FAILED',
            regeneration_failure_stage='SNAPSHOT',regeneration_failure_kind='INTERRUPTED',
            regeneration_failure_code='library_transfer',prepare_stage=NULL,updated_at=?
            WHERE regeneration_state='RUNNING'""", (timestamp,))
        snapshot.execute("""UPDATE chapter_pipeline_attempts SET status='INTERRUPTED',completed_at=?,
            failure_kind='INTERRUPTED',failure_code='library_transfer' WHERE status='STARTED'""", (timestamp,))
        for table in ("teaching_assets", "inline_teaching_assets"):
            snapshot.execute(f"""UPDATE {table} SET state='FAILED',terminal=0,
                failure_code='library_transfer',failure_detail='迁移不恢复未完成的生成任务。'
                WHERE state IN ('DRAFT','IN_REVIEW','REJECTED')""")
        snapshot.commit()


def export_demo_library(source_dir, output_path):
    """Read the isolated Demo only; never modify its live SQLite or PDFs."""
    from reader_service.tablet_demo import require_demo_data
    source = Path(source_dir).expanduser().resolve()
    output = Path(output_path).expanduser().resolve()
    require_demo_data(source)
    if source == output or source in output.parents:
        raise LibraryArchiveError("迁移包必须保存到 Demo 书库之外。")
    if output.exists():
        raise LibraryArchiveError("迁移包已存在，请使用新的文件名。")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_archive = output.with_name(output.name + "." + uuid4().hex + ".tmp")
    try:
        with tempfile.TemporaryDirectory(prefix="reader-export-", dir=output.parent) as temporary:
            snapshot = Path(temporary) / "state.sqlite3"
            with closing(_readonly(source / "state.sqlite3")) as original, closing(sqlite3.connect(snapshot)) as target:
                original.backup(target)
            _database_info(snapshot)
            _pause_snapshot(snapshot)
            with closing(sqlite3.connect(snapshot)) as target:
                target.execute("PRAGMA journal_mode = DELETE")
                target.execute("VACUUM")
            info = _database_info(snapshot)
            entries = [{"path": "state.sqlite3", "size": snapshot.stat().st_size, "sha256": _hash_file(snapshot)}, *info["blobs"]]
            if len(entries) + 1 > MAX_ENTRIES or sum(item["size"] for item in entries) > MAX_TOTAL_BYTES:
                raise LibraryArchiveError("当前 Demo 书库超过单次迁移大小限制。")
            manifest = {"kind": KIND, "format_version": FORMAT_VERSION, "schema_version": MIGRATIONS[-1][0],
                        "created_at": datetime.now(UTC).isoformat(), "books": info["books"], "pages": info["pages"],
                        "unfinished_tasks": "interrupted", "files": entries}
            encoded = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(encoded) > MAX_MANIFEST_BYTES:
                raise LibraryArchiveError("当前 Demo 书库超过单次迁移数量限制。")
            with zipfile.ZipFile(temporary_archive, "w", allowZip64=True) as archive:
                archive.writestr("manifest.json", encoded, compress_type=zipfile.ZIP_DEFLATED)
                archive.write(snapshot, "state.sqlite3", compress_type=zipfile.ZIP_DEFLATED)
                original_paths = ManagedPaths(source)
                for item in info["blobs"]:
                    original = original_paths.blob(item["sha256"])
                    if original.stat().st_size != item["size"] or _hash_file(original) != item["sha256"]:
                        raise LibraryArchiveError("Demo 的原 PDF 缺失或发生变化，请稍后重新导出。")
                    archive.write(original, item["path"], compress_type=zipfile.ZIP_STORED)
            if temporary_archive.stat().st_size > MAX_ARCHIVE_BYTES:
                raise LibraryArchiveError("当前 Demo 书库超过单次迁移大小限制。")
        os.replace(temporary_archive, output)
        return {"exported": True, "books": info["books"], "pages": info["pages"], "bytes": output.stat().st_size,
                "unfinished_tasks": "interrupted"}
    except LibraryArchiveError:
        raise
    except (OSError, sqlite3.Error, zipfile.BadZipFile) as exc:
        raise LibraryArchiveError("无法导出 Demo 书库，请检查剩余空间后重试。") from exc
    finally:
        temporary_archive.unlink(missing_ok=True)


def _manifest(archive):
    infos = archive.infolist()
    names = [entry.filename for entry in infos]
    if len(infos) > MAX_ENTRIES or len(set(names)) != len(names) or "manifest.json" not in names:
        raise LibraryArchiveError("迁移包的文件清单无效。")
    total = 0
    for item in infos:
        match = _BLOB.fullmatch(item.filename)
        if (item.filename not in {"manifest.json", "state.sqlite3"} and
                (match is None or match[1] != match[2][:2])):
            raise LibraryArchiveError("迁移包包含不允许的文件路径。")
        mode = item.external_attr >> 16
        if item.is_dir() or stat.S_ISLNK(mode) or item.flag_bits & 1 or item.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise LibraryArchiveError("迁移包包含不支持的文件类型。")
        maximum = MAX_MANIFEST_BYTES if item.filename == "manifest.json" else MAX_DATABASE_BYTES if item.filename == "state.sqlite3" else MAX_PDF_BYTES
        if not 0 < item.file_size <= maximum:
            raise LibraryArchiveError("迁移包中的文件大小无效。")
        total += item.file_size
    if total > MAX_TOTAL_BYTES:
        raise LibraryArchiveError("迁移包超过单次导入大小限制。")
    manifest = json.loads(archive.read("manifest.json"))
    if (not isinstance(manifest, dict) or manifest.get("kind") != KIND
            or manifest.get("format_version") != FORMAT_VERSION or manifest.get("schema_version") != MIGRATIONS[-1][0]
            or manifest.get("unfinished_tasks") != "interrupted" or not isinstance(manifest.get("files"), list)):
        raise LibraryArchiveError("这不是当前版本的 Reader 书库迁移包。")
    expected = {}
    for item in manifest["files"]:
        if (not isinstance(item, dict) or not isinstance(item.get("path"), str) or type(item.get("size")) is not int
                or not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
                or item["path"] in expected or item["path"] == "manifest.json"):
            raise LibraryArchiveError("迁移包的文件清单无效。")
        expected[item["path"]] = item
    if set(names) != set(expected) | {"manifest.json"} or "state.sqlite3" not in expected:
        raise LibraryArchiveError("迁移包的文件清单不完整。")
    for item in infos:
        if item.filename != "manifest.json" and item.file_size != expected[item.filename]["size"]:
            raise LibraryArchiveError("迁移包中的文件大小与清单不一致。")
    return manifest, expected, total


def restore_library(data_dir, archive_path):
    """Validate fully in staging, then swap only an empty stopped destination."""
    destination = Path(data_dir).expanduser().resolve()
    source = Path(archive_path).expanduser().resolve()
    if not library_is_empty(destination):
        raise LibraryArchiveError("本机书库已有内容，不能覆盖；请保留现有书库。")
    if source == destination or destination in source.parents:
        raise LibraryArchiveError("请从系统文件选择器重新选择迁移包。")
    if not source.is_file() or source.stat().st_size > MAX_ARCHIVE_BYTES:
        raise LibraryArchiveError("迁移包不存在或超过单次导入大小限制。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix=".reader-import-", dir=destination.parent) as temporary:
            staged = Path(temporary) / "library"
            staged.mkdir()
            with zipfile.ZipFile(source) as archive:
                manifest, expected, total = _manifest(archive)
                if shutil.disk_usage(destination.parent).free < total + 64 * 1024 * 1024:
                    raise LibraryArchiveError("平板剩余空间不足，无法导入书库。")
                for name, item in expected.items():
                    # Only the fixed, verified relative names above reach disk.
                    output = staged.joinpath(*name.split("/"))
                    output.parent.mkdir(parents=True, exist_ok=True)
                    digest = hashlib.sha256()
                    written = 0
                    with archive.open(name) as incoming, output.open("xb") as target:
                        for block in iter(lambda: incoming.read(1024 * 1024), b""):
                            written += len(block)
                            if written > item["size"]:
                                raise LibraryArchiveError("迁移包的文件大小无效。")
                            digest.update(block)
                            target.write(block)
                        target.flush()
                        os.fsync(target.fileno())
                    if written != item["size"] or digest.hexdigest() != item["sha256"]:
                        raise LibraryArchiveError("迁移包的文件校验失败，请重新复制。")
            info = _database_info(staged / "state.sqlite3")
            expected_blobs = {item["path"]: item for item in info["blobs"]}
            if ({name: item for name, item in expected.items() if name != "state.sqlite3"} != expected_blobs
                    or manifest.get("books") != info["books"] or manifest.get("pages") != info["pages"]):
                raise LibraryArchiveError("迁移包的原 PDF 与学习数据库不一致。")
            if not library_is_empty(destination):
                raise LibraryArchiveError("本机书库已有内容，不能覆盖；请保留现有书库。")
            backup = destination.with_name(destination.name + ".before-import-" + uuid4().hex)
            existed = destination.exists()
            if existed:
                os.replace(destination, backup)
            try:
                os.replace(staged, destination)
            except BaseException:
                if existed:
                    os.replace(backup, destination)
                raise
            # Keep the previous empty directory intact, including any unknown
            # app-local files. It is never merged into the restored library.
            return {"restored": True, "books": info["books"], "pages": info["pages"], "unfinished_tasks": "interrupted"}
    except LibraryArchiveError:
        raise
    except (zipfile.BadZipFile, ValueError, KeyError, OSError, sqlite3.Error, RuntimeError) as exc:
        raise LibraryArchiveError("无法导入书库，迁移包可能损坏；原书库未被替换。") from exc


def main():
    parser = argparse.ArgumentParser(description="Export an isolated Tablet Demo library without credentials")
    parser.add_argument("--source-data-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = export_demo_library(args.source_data_dir, args.output)
    except (LibraryArchiveError, ValueError) as exc:
        parser.exit(1, str(exc) + "\n")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
