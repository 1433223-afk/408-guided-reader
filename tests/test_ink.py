from __future__ import annotations

import copy
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from uuid import uuid4

import pytest

from conftest import make_pdf
from reader_service.annotation import AnnotationRepository
from reader_service.ink import InkConflictError, InkService
from reader_service.library import LibraryService
from reader_service.library import database as database_module
from reader_service.storage import ManagedPaths


def intake(service, *, title="ink", sizes=((612, 792), (792, 612))):
    data = make_pdf(sizes)
    return service.intake(BytesIO(data), content_length=len(data), filename=title + ".pdf")["book"]


def put(*, page_index=0, stroke_id=None):
    return {"operation_id": str(uuid4()), "action": "put", "stroke_id": stroke_id or str(uuid4()),
            "stroke": {"page_index": page_index, "coordinate_version": 1, "color": "#252923",
                       "width": 0.002, "points": [[0.1, 0.2, 0.4], [0.3, 0.4, 0.7]]}}


def change(stroke_id, action):
    return {"operation_id": str(uuid4()), "action": action, "stroke_id": stroke_id}


def test_strokes_survive_reopen_without_ocr_or_rewriting_pdf(service):
    book = intake(service)
    revision = book["active_revision"]["id"]
    original_pdf = service.pdf_path(revision).read_bytes()
    ink = InkService(service.paths)
    first = put()
    second = put(page_index=1)
    second["stroke"]["color"] = "#ad3939"
    saved = ink.apply_operation(revision, first)
    ink.apply_operation(revision, second)
    assert saved == {"operation_id": first["operation_id"], "action": "put",
                     "stroke_id": first["stroke_id"], "deleted": False,
                     "stroke": {"id": first["stroke_id"], **first["stroke"]}}

    restarted = InkService(ManagedPaths(service.paths.root))
    assert restarted.list_strokes(revision, 0) == {"strokes": [saved["stroke"]]}
    assert restarted.list_strokes(revision, 1)["strokes"][0]["id"] == second["stroke_id"]
    assert service.pdf_path(revision).read_bytes() == original_pdf
    with ink.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ocr_pages").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM ocr_lines").fetchone()[0] == 0


@pytest.mark.parametrize("color", ["#252923", "#777b75", "#ad3939", "#b66a35", "#9c7b27",
                                  "#477451", "#3d658f", "#785c91", "#8b9098", "#f04452",
                                  "#f58220", "#e4b400", "#24aa62", "#2f80ed", "#a259e6"],
                         ids=["black", "grey", "red", "orange", "gold", "green", "blue", "purple",
                              "bright-grey", "bright-red", "bright-orange", "bright-yellow",
                              "bright-green", "bright-blue", "bright-purple"])
def test_palette_persists_unchanged_across_reopen_delete_and_restore(service, color):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    operation["stroke"]["color"] = color
    expected = {"id": operation["stroke_id"], **operation["stroke"]}
    assert ink.apply_operation(revision, operation)["stroke"] == expected
    reopened = InkService(ManagedPaths(service.paths.root))
    assert reopened.list_strokes(revision, 0) == {"strokes": [expected]}
    erased = reopened.apply_operation(revision, change(operation["stroke_id"], "delete"))
    assert erased["deleted"] is True and erased["stroke"] == expected
    reopened = InkService(ManagedPaths(service.paths.root))
    assert reopened.list_strokes(revision, 0) == {"strokes": []}
    restored = reopened.apply_operation(revision, change(operation["stroke_id"], "restore"))
    assert restored["deleted"] is False and restored["stroke"] == expected
    assert InkService(service.paths).list_strokes(revision, 0) == {"strokes": [expected]}


def test_delete_then_retried_put_never_revives_stroke_and_explicit_restore_does(service):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    stroke = put()
    ink.apply_operation(revision, stroke)
    erased = change(stroke["stroke_id"], "delete")
    assert ink.apply_operation(revision, erased)["deleted"] is True
    assert ink.apply_operation(revision, stroke)["deleted"] is True
    # Even a new operation with the original immutable stroke is not a restore.
    duplicate = {**stroke, "operation_id": str(uuid4())}
    assert ink.apply_operation(revision, duplicate)["deleted"] is True
    assert ink.list_strokes(revision, 0) == {"strokes": []}
    restarted = InkService(ManagedPaths(service.paths.root))
    assert restarted.list_strokes(revision, 0) == {"strokes": []}
    assert restarted.apply_operation(revision, stroke)["deleted"] is True

    restored = change(stroke["stroke_id"], "restore")
    assert ink.apply_operation(revision, restored)["deleted"] is False
    # A delayed retry of the acknowledged erase cannot erase the new restore.
    assert ink.apply_operation(revision, erased)["deleted"] is False
    assert ink.list_strokes(revision, 0)["strokes"][0]["id"] == stroke["stroke_id"]
    with ink.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ink_strokes").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM ink_operations").fetchone()[0] == 4


def test_concurrent_idempotent_retries_commit_exactly_once(service):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _: ink.apply_operation(revision, operation), range(8)))
    assert all(response == responses[0] for response in responses)
    with ink.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ink_strokes").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM ink_operations").fetchone()[0] == 1


def test_ledger_rejects_reused_operation_and_stroke_mutation(service):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    ink.apply_operation(revision, operation)
    reused = copy.deepcopy(operation)
    reused["stroke"]["color"] = "#3d658f"
    with pytest.raises(InkConflictError, match="operation id"):
        ink.apply_operation(revision, reused)
    reused["operation_id"] = str(uuid4())
    with pytest.raises(InkConflictError, match="immutable"):
        ink.apply_operation(revision, reused)
    assert ink.list_strokes(revision, 0)["strokes"][0]["color"] == "#252923"


def test_ids_cannot_cross_source_revisions_or_access_missing_strokes(service):
    first_revision = intake(service)["active_revision"]["id"]
    second_revision = intake(service, sizes=((500, 500),))["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    ink.apply_operation(first_revision, operation)
    with pytest.raises(InkConflictError, match="operation id"):
        ink.apply_operation(second_revision, operation)
    other_operation = {**operation, "operation_id": str(uuid4())}
    with pytest.raises(InkConflictError, match="another source revision"):
        ink.apply_operation(second_revision, other_operation)
    for action in ("delete", "restore"):
        with pytest.raises(InkConflictError, match="another source revision"):
            ink.apply_operation(second_revision, change(operation["stroke_id"], action))
        with pytest.raises(LookupError, match="stroke not found"):
            ink.apply_operation(second_revision, change(str(uuid4()), action))
    assert ink.list_strokes(second_revision, 0) == {"strokes": []}
    with pytest.raises(LookupError, match="revision not found"):
        ink.apply_operation(str(uuid4()), put())


@pytest.mark.parametrize("page_index", [-1, 2, True, 0.5, "0"])
def test_page_range_is_checked_for_reads_and_new_strokes(service, page_index):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    with pytest.raises(ValueError):
        ink.apply_operation(revision, put(page_index=page_index))
    with pytest.raises(ValueError):
        ink.list_strokes(revision, page_index)


@pytest.mark.parametrize("key,value", [
    ("coordinate_version", 2), ("coordinate_version", True),
    ("color", "#ffffff"), ("color", []),
    ("width", 0), ("width", True), ("width", 0.03), ("width", 10 ** 1000),
    ("width", float("nan")), ("width", float("inf")),
    ("points", []), ("points", [[0.1, 0.2, -0.1]]),
    ("points", [[0.1, 1.01, 0.5]]), ("points", [[0.1, 0.2, True]]),
    ("points", [[0.1, 0.2]]), ("points", [[0.1, 0.2, float("inf")]]),
    ("points", [[0.1, 0.2, 0.5]] * 1501),
])
def test_invalid_stroke_is_rejected_without_partial_state(service, key, value):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    operation["stroke"][key] = value
    with pytest.raises(ValueError):
        ink.apply_operation(revision, operation)
    with ink.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ink_strokes").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM ink_operations").fetchone()[0] == 0


@pytest.mark.parametrize("field,value", [("operation_id", "x"), ("stroke_id", None),
                                         ("action", "erase"), ("action", [])])
def test_invalid_operation_ids_and_actions(service, field, value):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    operation[field] = value
    with pytest.raises(ValueError):
        ink.apply_operation(revision, operation)


def test_request_size_limit_and_boundary_values(service):
    revision = intake(service)["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    operation["excess"] = "x" * (64 * 1024)
    with pytest.raises(ValueError, match="64 KiB"):
        ink.apply_operation(revision, operation)
    # Integer-to-float normalization may grow a request that was just under the wire limit.
    operation = put()
    operation["stroke"]["points"] = [[0, 0.12345678901234567, 0.12345678901234567]] * 1450
    with pytest.raises(ValueError, match="64 KiB"):
        ink.apply_operation(revision, operation)
    for color in InkService.COLORS:
        operation = put()
        operation["stroke"].update(color=color.upper(), width=InkService.MIN_WIDTH,
                                   points=[[0, 1, 0]])
        assert ink.apply_operation(revision, operation)["stroke"]["color"] == color
    operation = put()
    operation["stroke"].update(width=InkService.MAX_WIDTH, points=[[1, 0, 1]] * 1500)
    assert len(ink.apply_operation(revision, operation)["stroke"]["points"]) == 1500


def test_revision_deletion_cascades_strokes_and_ledger(service):
    book = intake(service)
    revision = book["active_revision"]["id"]
    ink = InkService(service.paths)
    operation = put()
    ink.apply_operation(revision, operation)
    ink.apply_operation(revision, change(operation["stroke_id"], "delete"))
    service.delete_book(book["id"])
    with ink.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ink_strokes").fetchone()[0] == 0
        assert connection.execute("SELECT COUNT(*) FROM ink_operations").fetchone()[0] == 0
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_additive_migration_preserves_existing_text_annotations(tmp_path, monkeypatch):
    paths = ManagedPaths(tmp_path / "before-ink")
    with monkeypatch.context() as previous:
        previous.setattr(database_module, "MIGRATIONS", tuple(
            migration for migration in database_module.MIGRATIONS if migration[0] < 27))
        library = LibraryService(paths)
    revision = intake(library)["active_revision"]["id"]
    repository = AnnotationRepository(library.database)
    mark = repository.create(
        revision_id=revision, page_index=0,
        quads=[[[0.1, 0.1], [0.3, 0.1], [0.3, 0.2], [0.1, 0.2]]],
        quote="existing text", context_before="before", context_after="after",
        foundation_version=1, body="existing note", highlight_style="BLUE",
    )
    with library.database.connect() as connection:
        original_row = dict(connection.execute("SELECT * FROM annotations").fetchone())
        original_schema = connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'annotations'").fetchone()[0]
        assert not connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 'ink_strokes'").fetchone()
    ink = InkService(paths)
    operation = put()
    ink.apply_operation(revision, operation)
    ink.apply_operation(revision, change(operation["stroke_id"], "delete"))
    assert repository.get(mark["id"], revision) == mark
    with ink.database.connect() as connection:
        assert dict(connection.execute("SELECT * FROM annotations").fetchone()) == original_row
        assert connection.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'annotations'").fetchone()[0] == original_schema
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == max(
            version for version, _ in database_module.MIGRATIONS)


def test_v28_palette_migration_preserves_active_deleted_strokes_and_operation_ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(database_module, "MIGRATIONS", tuple(
        migration for migration in database_module.MIGRATIONS if migration[0] <= 28))
    paths = ManagedPaths(tmp_path / "three-color-ink")
    with monkeypatch.context() as previous:
        previous.setattr(database_module, "MIGRATIONS", tuple(
            migration for migration in database_module.MIGRATIONS if migration[0] <= 27))
        library = LibraryService(paths)
        revision = intake(library)["active_revision"]["id"]
        ink = InkService(paths)
        original = []
        for color in ("#252923", "#ad3939", "#3d658f"):
            operation = put()
            operation["stroke"]["color"] = color
            ink.apply_operation(revision, operation)
            original.append(operation)
        erased = change(original[1]["stroke_id"], "delete")
        ink.apply_operation(revision, erased)
        # Leave non-default rowids so merely reinserting in default order
        # cannot pass the preservation check by accident.
        with ink.database.connect() as connection:
            connection.execute("UPDATE ink_strokes SET rowid = rowid + 100")
            connection.execute("UPDATE ink_operations SET rowid = rowid + 200")

    def snapshot():
        with library.database.connect() as connection:
            return {
                "strokes": [dict(row) for row in connection.execute("SELECT rowid, * FROM ink_strokes ORDER BY rowid")],
                "operations": [dict(row) for row in connection.execute("SELECT rowid, * FROM ink_operations ORDER BY rowid")],
            }

    before = snapshot()
    assert len(before["strokes"]) == 3 and len(before["operations"]) == 4
    assert sum(row["deleted"] for row in before["strokes"]) == 1
    # An error after the copy/drop/rename sequence must roll back all DDL and rows,
    # including the ledger, rather than leaving half of the new schema committed.
    with monkeypatch.context() as failure:
        failure.setattr(database_module, "MIGRATIONS", tuple(
            (version, sql + "\nINSERT INTO missing_ink_migration_table VALUES (1);" if version == 28 else sql)
            for version, sql in database_module.MIGRATIONS))
        with pytest.raises(sqlite3.OperationalError, match="missing_ink_migration_table"):
            database_module.Database(paths.database()).initialize()
    assert snapshot() == before
    with library.database.connect() as connection:
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 27
        assert not connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name IN ('ink_strokes_v28', 'ink_operations_v28')").fetchone()

    upgraded = InkService(paths)
    assert snapshot() == before
    assert upgraded.apply_operation(revision, original[1])["deleted"] is True
    assert upgraded.apply_operation(revision, erased)["deleted"] is True
    with pytest.raises(InkConflictError):
        upgraded.apply_operation(revision, {**original[0], "stroke_id": original[2]["stroke_id"]})
    assert {stroke["color"] for stroke in upgraded.list_strokes(revision, 0)["strokes"]} == {"#252923", "#3d658f"}
    for color in ("#777b75", "#b66a35", "#9c7b27", "#477451", "#785c91"):
        operation = put()
        operation["stroke"]["color"] = color
        assert upgraded.apply_operation(revision, operation)["stroke"]["color"] == color
    with upgraded.database.connect() as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 28
        assert connection.execute("SELECT COUNT(*) FROM ink_operations").fetchone()[0] == 9
    library.delete_book(library.list_books()[0]["id"])
    assert snapshot() == {"strokes": [], "operations": []}


def test_v29_bright_palette_migration_preserves_old_colors_rowids_and_ledger(tmp_path, monkeypatch):
    paths = ManagedPaths(tmp_path / "eight-color-ink")
    old_colors = ("#252923", "#777b75", "#ad3939", "#b66a35", "#9c7b27",
                  "#477451", "#3d658f", "#785c91")
    bright_colors = ("#8b9098", "#f04452", "#f58220", "#e4b400", "#24aa62", "#2f80ed", "#a259e6")
    with monkeypatch.context() as previous:
        previous.setattr(database_module, "MIGRATIONS", tuple(
            migration for migration in database_module.MIGRATIONS if migration[0] <= 28))
        library = LibraryService(paths)
        revision = intake(library)["active_revision"]["id"]
        ink = InkService(paths)
        original = []
        for color in old_colors:
            operation = put()
            operation["stroke"]["color"] = color
            ink.apply_operation(revision, operation)
            original.append(operation)
        erased = change(original[1]["stroke_id"], "delete")
        ink.apply_operation(revision, erased)
        with ink.database.connect() as connection:
            connection.execute("UPDATE ink_strokes SET rowid = rowid + 500, "
                               "created_at = '2026-10-20T00:00:00Z', updated_at = '2026-10-20T00:00:01Z'")
            connection.execute("UPDATE ink_operations SET rowid = rowid + 800, "
                               "created_at = '2026-10-20T00:00:02Z'")

    def snapshot():
        with library.database.connect() as connection:
            return {
                "strokes": [dict(row) for row in connection.execute("SELECT rowid, * FROM ink_strokes ORDER BY rowid")],
                "operations": [dict(row) for row in connection.execute("SELECT rowid, * FROM ink_operations ORDER BY rowid")],
            }

    before = snapshot()
    with monkeypatch.context() as failure:
        failure.setattr(database_module, "MIGRATIONS", tuple(
            (version, sql + "\nINSERT INTO missing_bright_palette_table VALUES (1);" if version == 29 else sql)
            for version, sql in database_module.MIGRATIONS))
        with pytest.raises(sqlite3.OperationalError, match="missing_bright_palette_table"):
            database_module.Database(paths.database()).initialize()
    assert snapshot() == before
    with library.database.connect() as connection:
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 28

    upgraded = InkService(paths)
    assert snapshot() == before
    assert [stroke["color"] for stroke in upgraded.list_strokes(revision, 0)["strokes"]] == [
        color for color in old_colors if color != old_colors[1]]
    assert upgraded.apply_operation(revision, original[1])["deleted"] is True
    assert upgraded.apply_operation(revision, erased)["deleted"] is True
    restored = upgraded.apply_operation(revision, change(original[1]["stroke_id"], "restore"))
    assert restored["stroke"]["color"] == old_colors[1] and restored["deleted"] is False
    for color in bright_colors:
        operation = put()
        operation["stroke"]["color"] = color
        assert upgraded.apply_operation(revision, operation)["stroke"]["color"] == color
    assert {stroke["color"] for stroke in InkService(paths).list_strokes(revision, 0)["strokes"]} == set(
        old_colors + bright_colors)
    with upgraded.database.connect() as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0] == 29
        assert not connection.execute(
            "SELECT 1 FROM sqlite_master WHERE name IN ('ink_strokes_v29', 'ink_operations_v29')").fetchone()
    library.delete_book(library.list_books()[0]["id"])
    assert snapshot() == {"strokes": [], "operations": []}
