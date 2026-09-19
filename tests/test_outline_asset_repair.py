from io import BytesIO

import pytest
from conftest import make_pdf
from test_map_the_book import services

from reader_service.knowledge import KnowledgeRepository
from reader_service.outline.repair import merge_preserving_assets
from reader_service.outline.service import _digest


def fixture(service):
    pdf = make_pdf(((612, 792),) * 5)
    revision = service.intake(
        BytesIO(pdf), content_length=len(pdf), filename="repair.pdf"
    )["book"]["active_revision"]["id"]
    _, _, _, outline = services(service)

    def entry(key, title, depth, kind, page):
        return {
            "key": key,
            "title": title,
            "depth": depth,
            "kind": kind,
            "start_page": page,
            "printed_label_hint": None,
            "confidence": 1,
            "evidence": {"source": "BOOKMARK"},
        }

    raw = [
        entry("c", "第一章 基础", 0, "CHAPTER", 0),
        entry("s", "第一节 定义", 1, "SECTION", 0),
    ]
    nodes = outline._build_nodes(revision, "TOC", raw)
    outline.repository.commit(
        revision,
        nodes,
        parser_version="old",
        evidence_source="TOC",
        evidence_digest=_digest(raw),
        structure_digest=outline._structure_digest(nodes),
    )
    chapter, section = [n["outline_node_id"] for n in nodes]
    with service.database.connect() as c:
        c.execute(
            """INSERT INTO chapter_preparations(book_source_revision_id,chapter_outline_node_id,status,
            foundation_version,chapter_identity_revision,chapter_physical_revision,structure_version,attempt_id,
            generator_provider,generator_model,reviewer_provider,reviewer_model,requested_at,updated_at,published_at)
            VALUES(?,?,'READY',1,1,1,1,'attempt','test','test','test','test','now','now','now')""",
            (revision, chapter),
        )
        c.execute(
            """INSERT INTO knowledge_points VALUES('kp',?,?,1,?,'定义','含义',0,0,.2,1,.5,1,'now')""",
            (revision, chapter, section),
        )
    return revision, outline, raw, entry, chapter


def test_additive_repair_keeps_all_foreign_keys_published_records_and_warns(service):
    revision, outline, raw, entry, chapter = fixture(service)
    with service.database.connect() as c:
        before = [tuple(x) for x in c.execute("SELECT * FROM knowledge_points")]
        prep = [tuple(x) for x in c.execute("SELECT * FROM chapter_preparations")]
    result = merge_preserving_assets(
        outline, revision, [raw[0], entry("intro", "引言", 1, "OTHER", 0), raw[1]]
    )
    assert result["preserved_ids"] == 2 and result["added_nodes"] == 1
    snapshot = KnowledgeRepository(service.database).snapshot(revision, chapter)
    assert snapshot["status"] == "READY" and snapshot["needs_review"]
    assert snapshot["knowledge_points"][0]["knowledge_point_id"] == "kp"
    with service.database.connect() as c:
        assert before == [tuple(x) for x in c.execute("SELECT * FROM knowledge_points")]
        assert prep == [
            tuple(x) for x in c.execute("SELECT * FROM chapter_preparations")
        ]
        assert not c.execute("PRAGMA foreign_key_check").fetchall()
    # Repeating a no-op repair does not clear the pending review.
    merge_preserving_assets(
        outline, revision, [raw[0], entry("intro", "引言", 1, "OTHER", 0), raw[1]]
    )
    assert KnowledgeRepository(service.database).snapshot(revision, chapter)[
        "needs_review"
    ]


@pytest.mark.parametrize("mode", ["remove", "reparent", "kind"])
def test_identity_destruction_is_refused_before_writing(service, mode):
    revision, outline, raw, _entry, _chapter = fixture(service)
    before = outline.repository.list(revision)
    candidate = (
        raw[:1]
        if mode == "remove"
        else [
            raw[0],
            dict(raw[1], **({"depth": 0} if mode == "reparent" else {"kind": "OTHER"})),
        ]
    )
    with pytest.raises(RuntimeError, match="identity|identit|reparenting"):
        merge_preserving_assets(outline, revision, candidate)
    assert outline.repository.list(revision) == before
