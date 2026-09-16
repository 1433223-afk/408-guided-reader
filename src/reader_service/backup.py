"""Stopped-instance snapshots. Directory format avoids archive extraction/traversal."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import time
from pathlib import Path

from reader_service.instance import InstanceLock


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def empty_directory(path):
    if path.is_symlink() or (path.exists() and any(path.iterdir())):
        raise ValueError("Destination must be an empty real directory")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)


def allowed(relative):
    return relative == "state.sqlite3" or bool(re.fullmatch(r"blobs/[0-9a-f]{2}/[0-9a-f]{64}\.pdf", relative))


def validate_data(root):
    db = root / "state.sqlite3"
    if db.is_symlink() or not db.is_file():
        raise ValueError("Missing database")
    with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as c:
        if c.execute("PRAGMA integrity_check").fetchall() != [("ok",)] or c.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("SQLite integrity or foreign key verification failed")
        schema = c.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        for sha, size in c.execute("SELECT blob_sha256,byte_size FROM book_source_revisions WHERE status!='DELETED'"):
            relative = f"blobs/{sha[:2]}/{sha}.pdf"
            if not allowed(relative):
                raise ValueError("Invalid blob reference")
            blob = root / relative
            if blob.is_symlink() or not blob.is_file() or blob.stat().st_size != size or digest(blob) != sha:
                raise ValueError("Referenced blob verification failed")
    return schema


def validate_config(config):
    if not isinstance(config, dict) or set(config) - {"profile", "public_origin", "port", "disk_margin_mib", "prepare_workers"}:
        raise ValueError("Backup configuration contains unsupported fields")
    if "profile" in config and config["profile"] not in {"beta", "personal"}:
        raise ValueError("Invalid profile configuration")
    for key, low, high in (("port", 1, 65535), ("disk_margin_mib", 0, 1048576), ("prepare_workers", 1, 4)):
        if key in config and (type(config[key]) is not int or not low <= config[key] <= high):
            raise ValueError("Invalid numeric configuration")
    if "public_origin" in config:
        from urllib.parse import urlsplit
        origin = urlsplit(config["public_origin"])
        if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
            raise ValueError("Invalid public origin configuration")
    return config


def snapshot(source: Path, destination: Path, release: str, config=None):
    source, destination = source.resolve(), destination.absolute()
    if source == destination.resolve() or source in destination.resolve().parents:
        raise ValueError("Backup destination must be outside live data")
    if not re.fullmatch(r"[0-9a-f]{40}", release):
        raise ValueError("Release must be a full Git commit hash")
    config = validate_config(config or {})
    # No environment, key directory, temporary file or migration backup is copied.
    with InstanceLock(source):
        schema = validate_data(source)
        empty_directory(destination)
        with sqlite3.connect((source / "state.sqlite3").as_uri() + "?mode=ro", uri=True) as src:
            with sqlite3.connect(destination / "state.sqlite3") as out:
                src.backup(out)
                out.execute("PRAGMA journal_mode=DELETE")
        blob_root = source / "blobs"
        if blob_root.is_symlink():
            raise ValueError("Symlink in blob store")
        for path in blob_root.rglob("*"):
            if path.is_symlink():
                raise ValueError("Symlink in blob store")
            if path.is_file():
                relative = path.relative_to(source).as_posix()
                if not allowed(relative) or path.parent.name != path.stem[:2] or digest(path) != path.stem:
                    raise ValueError("Unexpected or corrupt blob")
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        validate_data(destination)
        files = {p.relative_to(destination).as_posix(): {"sha256": digest(p), "bytes": p.stat().st_size}
                 for p in destination.rglob("*") if p.is_file() and allowed(p.relative_to(destination).as_posix())}
        manifest = {"format": 1, "release": release, "schema": schema, "config": config, "files": files,
                    "credentials": "EXCLUDED_REENTER_AFTER_RESTORE"}
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(destination)
    return manifest


def verify(root: Path):
    root = root.resolve()
    manifest_path = root / "manifest.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 4 * 1024**2:
        raise ValueError("Invalid manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != 1 or not re.fullmatch(r"[0-9a-f]{40}", manifest.get("release", "")):
        raise ValueError("Unsupported manifest")
    validate_config(manifest.get("config", {}))
    files = manifest["files"]
    if not isinstance(files, dict) or "state.sqlite3" not in files:
        raise ValueError("Invalid manifest files")
    for relative, expected in files.items():
        if not allowed(relative):
            raise ValueError("Disallowed backup member")
        path = root / relative
        if (path.is_symlink() or root not in path.resolve().parents or not path.is_file()
                or path.stat().st_size != expected["bytes"] or digest(path) != expected["sha256"]):
            raise ValueError("Backup checksum mismatch")
    for path in root.rglob("*"):
        if path.is_symlink() or (path.is_file() and path.relative_to(root).as_posix() not in {*files, "manifest.json"}):
            raise ValueError("Unexpected backup member")
    if validate_data(root) != manifest["schema"]:
        raise ValueError("Schema mismatch")
    return manifest


def restore(source: Path, destination: Path):
    start = time.perf_counter()
    manifest = verify(source)
    destination = destination.absolute()
    if destination.resolve() == source.resolve() or source.resolve() in destination.resolve().parents:
        raise ValueError("Restore destination must be isolated")
    empty_directory(destination)
    # A restore is never allowed to overwrite a live or populated installation.
    with InstanceLock(destination):
        for relative in manifest["files"]:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / relative, target)
            if digest(target) != manifest["files"][relative]["sha256"]:
                raise ValueError("Restored checksum mismatch")
        validate_data(destination)
    return {"bytes": sum(item["bytes"] for item in manifest["files"].values()),
            "elapsed_seconds": round(time.perf_counter() - start, 3), "release": manifest["release"],
            "schema": manifest["schema"], "credentials": "REENTER_REQUIRED"}


def main():
    parser = argparse.ArgumentParser(description="Stopped-service Beta backup / isolated restore")
    parser.add_argument("action", choices=("backup", "verify", "restore"))
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--release")
    parser.add_argument("--config", type=Path, help="Allowlisted nonsecret instance JSON")
    args = parser.parse_args()
    if args.action != "verify" and args.destination is None:
        parser.error("--destination is required")
    if args.action == "backup":
        result = snapshot(args.source, args.destination, args.release or "", json.loads(args.config.read_text(encoding="utf-8")) if args.config else {})
    elif args.action == "restore":
        result = restore(args.source, args.destination)
    else:
        result = verify(args.source)
    print(json.dumps({k: v for k, v in result.items() if k != "files"}))


if __name__ == "__main__":
    main()
