from pathlib import PurePath

import pytest

from reader_service.storage import ManagedPaths, PathContainmentError


def test_all_managed_paths_are_contained(tmp_path):
    paths = ManagedPaths(tmp_path / "managed")
    paths.initialize()

    assert paths.database().is_relative_to(paths.root)
    assert paths.blob("a" * 64).is_relative_to(paths.root)
    with pytest.raises(PathContainmentError):
        paths.resolve(PurePath("..", "escape.pdf"))
    with pytest.raises(PathContainmentError):
        paths.resolve(tmp_path / "absolute.pdf")
    with pytest.raises(PathContainmentError):
        paths.blob("not-a-hash")


def test_new_storage_root_is_canonicalized_after_creation(tmp_path):
    paths = ManagedPaths(tmp_path / "not-created-yet")
    assert not paths.root.exists()

    paths.initialize()

    assert paths.root == paths.root.resolve()
    assert paths.database().is_relative_to(paths.root)
