from __future__ import annotations

import sqlite3
from io import BytesIO

import pytest

from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.foundation import DetectedLine, FoundationRepository, FoundationService
from reader_service.library import LibraryService
from reader_service.library.database import Database, MIGRATIONS
from reader_service.storage import ManagedPaths

from conftest import make_pdf


LINES = (
    DetectedLine(
        quad=((0.1, 0.1), (0.6, 0.1), (0.6, 0.15), (0.1, 0.15)),
        text="甲乙丙丁戊",
        confidence=1,
        cells=((0.1, 0.2, 0, 1), (0.2, 0.3, 1, 2), (0.3, 0.4, 2, 3),
               (0.4, 0.5, 3, 4), (0.5, 0.6, 4, 5)),
    ),
    DetectedLine(
        quad=((0.1, 0.2), (0.6, 0.2), (0.6, 0.25), (0.1, 0.25)),
        text="己庚辛壬癸",
        confidence=1,
        cells=((0.1, 0.2, 0, 1), (0.2, 0.3, 1, 2), (0.3, 0.4, 2, 3),
               (0.4, 0.5, 3, 4), (0.5, 0.6, 4, 5)),
    ),
)


class UnusedEngine:
    profile = "unused"

    def prepare_page(self, page_image, page_size):
        raise AssertionError("prepared fixture must not invoke OCR")


def prepared_services(service):
    payload = make_pdf()
    result = service.intake(BytesIO(payload), content_length=len(payload), filename="marks.pdf")
    revision = result["book"]["active_revision"]
    foundation_repository = FoundationRepository(service.database)
    foundation = FoundationService(service, foundation_repository, UnusedEngine)
    foundation.ensure_revision(revision["id"])
    assert foundation_repository.mark_preparing(revision["id"], 0)
    foundation_repository.publish_page(
        revision["id"],
        0,
        route="OCR",
        foundation_version=revision["foundation_version"],
        engine_profile="fixture:v1",
        lines=list(LINES),
    )
    annotations = AnnotationService(foundation, AnnotationRepository(service.database))
    return result["book"], revision, annotations


def create_mark(annotations, revision_id, body=None, highlight_style="YELLOW"):
    return annotations.create_text(
        revision_id,
        page_index=0,
        start={"line_ordinal": 0, "boundary": 1},
        end={"line_ordinal": 1, "boundary": 2},
        body=body,
        highlight_style=highlight_style,
    )


def test_create_highlight_and_note_persist_only_durable_anchor(service):
    _, revision, annotations = prepared_services(service)
    highlight = create_mark(annotations, revision["id"])
    noted = annotations.create_text(
        revision["id"],
        page_index=0,
        start={"line_ordinal": 1, "boundary": 1},
        end={"line_ordinal": 1, "boundary": 4},
        body="  important bus detail  ",
        highlight_style="BLUE",
    )

    assert highlight["quote"] == "乙丙丁戊\n己庚"
    assert highlight["context_before"] == "甲"
    assert highlight["context_after"] == "辛壬癸"
    assert highlight["quads"] == [
        [[0.2, 0.1], [0.6, 0.1], [0.6, 0.15], [0.2, 0.15]],
        [[0.1, 0.2], [0.3, 0.2], [0.3, 0.25], [0.1, 0.25]],
    ]
    assert highlight["body"] is None
    assert noted["body"] == "important bus detail"
    assert noted["quote"] == "庚辛壬"
    assert noted["foundation_version_at_creation"] == 1
    assert noted["kind"] == "TEXT"
    assert noted["highlight_style"] == "BLUE"
    assert noted["source_kind"] == "USER"
    assert noted["anchor_state"] == "OK"
    assert noted["verification_state"] is None
    assert noted["knowledge_point_id"] is None

    with service.database.connect() as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(annotations)")}
    assert "line_ordinal" not in columns
    assert "cell_index" not in columns
    assert not any("engine" in column for column in columns)
    assert "review_provider" in columns
    assert noted["review_provider"] is None


def test_same_version_restart_reload_delete_and_book_cascade(service):
    book, revision, annotations = prepared_services(service)
    first = create_mark(annotations, revision["id"])
    second = create_mark(annotations, revision["id"], "survives restart")

    restarted_library = LibraryService(ManagedPaths(service.paths.root))
    restarted_foundation = FoundationService(
        restarted_library,
        FoundationRepository(restarted_library.database),
        UnusedEngine,
    )
    restarted = AnnotationService(
        restarted_foundation,
        AnnotationRepository(restarted_library.database),
    )
    reloaded = restarted.list_page(revision["id"], 0)
    assert [value["id"] for value in reloaded] == [first["id"], second["id"]]
    assert reloaded[0]["quads"] == first["quads"]

    restarted.delete(revision["id"], first["id"])
    assert [value["id"] for value in restarted.list_page(revision["id"], 0)] == [second["id"]]

    restarted_library.delete_book(book["id"])
    with restarted_library.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM annotations").fetchone()[0] == 0


def test_r3_schema_rejects_deferred_annotation_paths(service):
    _, revision, annotations = prepared_services(service)
    mark = create_mark(annotations, revision["id"])

    for column, value in (
        ("kind", "REGION"),
        ("source_kind", "AI_SAVED"),
        ("anchor_state", "NEEDS_REVIEW"),
        ("verification_state", "PENDING"),
        ("knowledge_point_id", "future-kp"),
    ):
        with pytest.raises(sqlite3.IntegrityError):
            with service.database.connect() as connection:
                connection.execute(
                    f"UPDATE annotations SET {column} = ? WHERE id = ?",
                    (value, mark["id"]),
                )

    with pytest.raises(ValueError, match="at most"):
        create_mark(annotations, revision["id"], "x" * 1001)

    with pytest.raises(ValueError, match="Highlight style"):
        create_mark(annotations, revision["id"], highlight_style="PURPLE")


@pytest.mark.parametrize("highlight_style", ["YELLOW", "GREEN", "BLUE", "NONE"])
def test_highlight_styles_round_trip_independently_from_note(service, highlight_style):
    _, revision, annotations = prepared_services(service)
    mark = create_mark(
        annotations,
        revision["id"],
        body="style-independent note",
        highlight_style=highlight_style,
    )

    assert mark["body"] == "style-independent note"
    assert mark["highlight_style"] == highlight_style
    assert annotations.list_page(revision["id"], 0)[0]["highlight_style"] == highlight_style


def test_v5_style_migration_preserves_existing_annotation_and_ownership(tmp_path):
    path = tmp_path / "r3-v4.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(
        "CREATE TABLE schema_migrations "
        "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for version, sql in MIGRATIONS[:4]:
        connection.executescript(sql)
        connection.execute("INSERT INTO schema_migrations(version) VALUES (?)", (version,))
    connection.execute(
        "INSERT INTO books(id, title, status, created_at) "
        "VALUES ('book', 'R3', 'ACTIVE', 'book-created')"
    )
    connection.execute(
        """
        INSERT INTO book_source_revisions(
            id, book_id, blob_sha256, byte_size, page_count, page_geometry_json,
            label, status, created_at, foundation_version
        ) VALUES ('revision', 'book', ?, 1, 1, '[]', 'R3', 'ACTIVE', 'revision-created', 1)
        """,
        ("c" * 64,),
    )
    original = (
        "mark", "revision", 0, "TEXT", "[[[0.1,0.2],[0.3,0.2],[0.3,0.25],[0.1,0.25]]]",
        "quote", "before", "after", 1, "existing note", "YELLOW", "USER", None, "OK", None,
        "annotation-created",
    )
    connection.execute(
        """
        INSERT INTO annotations(
            id, book_source_revision_id, pdf_page_index, kind, quads_json,
            quote, context_before, context_after, foundation_version_at_creation,
            body, highlight_style, source_kind, verification_state, anchor_state,
            knowledge_point_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        original,
    )
    connection.commit()
    connection.close()

    Database(path).initialize()

    backup_path = path.with_name(f"{path.name}.pre-migration-7.bak")
    assert backup_path.is_file()
    backup = sqlite3.connect(backup_path)
    assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert backup.execute("SELECT COUNT(*) FROM annotations").fetchone()[0] == 1
    backup.close()

    connection = sqlite3.connect(path)
    connection.execute("PRAGMA foreign_keys = ON")
    migrated = connection.execute(
        """
        SELECT id, book_source_revision_id, pdf_page_index, kind, quads_json,
               quote, context_before, context_after, foundation_version_at_creation,
               body, highlight_style, source_kind, verification_state, anchor_state,
               knowledge_point_id, created_at
        FROM annotations WHERE id = 'mark'
        """
    ).fetchone()
    assert migrated == original
    assert connection.execute(
        "SELECT version FROM schema_migrations ORDER BY version"
    ).fetchall() == [(version,) for version, _ in MIGRATIONS]
    connection.execute(
        """
        INSERT INTO annotations(
            id, book_source_revision_id, pdf_page_index, quads_json, quote,
            context_before, context_after, foundation_version_at_creation,
            body, highlight_style, created_at
        ) VALUES ('none', 'revision', 0,
                  '[[[0.1,0.2],[0.3,0.2],[0.3,0.25],[0.1,0.25]]]',
                  'note only', '', '', 1,
                  'no paint', 'NONE', 'new')
        """
    )
    connection.execute("DELETE FROM books WHERE id = 'book'")
    assert connection.execute("SELECT COUNT(*) FROM annotations").fetchone()[0] == 0
    connection.close()


def test_annotation_delete_is_scoped_to_owning_revision(service):
    _, first_revision, first_annotations = prepared_services(service)
    mark = create_mark(first_annotations, first_revision["id"])

    payload = make_pdf(((500, 700),))
    second_book = service.intake(
        BytesIO(payload), content_length=len(payload), filename="other.pdf"
    )["book"]
    with pytest.raises(LookupError, match="Annotation not found"):
        first_annotations.delete(second_book["active_revision"]["id"], mark["id"])
    assert first_annotations.list_page(first_revision["id"], 0)[0]["id"] == mark["id"]


def test_failed_book_delete_preserves_annotations_until_retry_completes(service, monkeypatch):
    book, revision, annotations = prepared_services(service)
    mark = create_mark(annotations, revision["id"], "user asset")
    original_delete = service.blobs.delete

    def fail_blob_delete(_sha256):
        raise OSError("simulated locked blob")

    monkeypatch.setattr(service.blobs, "delete", fail_blob_delete)
    with pytest.raises(OSError, match="locked blob"):
        service.delete_book(book["id"])
    with service.database.connect() as connection:
        assert connection.execute(
            "SELECT id FROM annotations WHERE id = ?", (mark["id"],)
        ).fetchone()[0] == mark["id"]

    monkeypatch.setattr(service.blobs, "delete", original_delete)
    service.delete_book(book["id"])
    with service.database.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM annotations").fetchone()[0] == 0
