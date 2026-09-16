import json
from io import BytesIO

import pytest

from reader_service.backup import snapshot, restore, verify
from reader_service.instance import InstanceLock
from reader_service.library import LibraryService
from reader_service.storage import ManagedPaths
from conftest import make_pdf


def test_stopped_backup_restore_identity_and_key_exclusion(service, tmp_path):
    pdf = make_pdf()
    book = service.intake(BytesIO(pdf), content_length=len(pdf), filename="book.pdf")["book"]
    revision = book["active_revision"]["id"]
    service.save_position(revision, 0, .42, 1.25)
    (service.paths.root / "forbidden.key").write_text("key-exclusion-canary")
    backup = tmp_path / "backup"
    with InstanceLock(service.paths.root):
        with pytest.raises(RuntimeError):
            snapshot(service.paths.root, backup, "f" * 40)
    snapshot(service.paths.root, backup, "f" * 40, {"profile": "beta"})
    assert all(b"key-exclusion-canary" not in p.read_bytes() for p in backup.rglob("*") if p.is_file())
    result = restore(backup, tmp_path / "restored")
    assert result["bytes"] > len(pdf) and result["elapsed_seconds"] >= 0
    recovered = LibraryService(ManagedPaths(tmp_path / "restored"))
    assert recovered.pdf_path(revision).read_bytes() == pdf
    assert recovered.list_books()[0]["active_revision"]["position"]["normalized_offset"] == .42
    assert recovered.list_books()[0]["id"] == book["id"]
    with pytest.raises(ValueError, match="empty"):
        restore(backup, tmp_path / "restored")
    assert service.pdf_path(revision).read_bytes() == pdf


def test_restore_corrupt_or_extra_members_fails_closed(service, tmp_path):
    backup = tmp_path / "backup"
    snapshot(service.paths.root, backup, "a" * 40)
    (backup / "deepseek.key").write_text("canary")
    with pytest.raises(ValueError, match="Unexpected"):
        restore(backup, tmp_path / "restore")
    assert not (tmp_path / "restore").exists()
    (backup / "deepseek.key").unlink()
    with (backup / "state.sqlite3").open("ab") as f:
        f.write(b"tampering")
    with pytest.raises(ValueError, match="checksum"):
        verify(backup)


def test_manifest_traversal_and_configuration_secrets_refused(service, tmp_path):
    with pytest.raises(ValueError, match="configuration"):
        snapshot(service.paths.root, tmp_path / "bad", "a" * 40, {"api_key": "forbidden"})
    backup = tmp_path / "backup"
    snapshot(service.paths.root, backup, "a" * 40)
    manifest = json.loads((backup / "manifest.json").read_text())
    manifest["files"]["../outside"] = {"bytes": 1, "sha256": "a" * 64}
    (backup / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Disallowed"):
        restore(backup, tmp_path / "restore")
