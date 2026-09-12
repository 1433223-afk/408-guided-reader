TEACHING_SCHEMA = r"""
CREATE TABLE jobs_v14 (
            id TEXT PRIMARY KEY,
            job_type TEXT NOT NULL
                CHECK (job_type IN ('PAGE_PREPARE', 'CHAPTER_PREPARE', 'TEACHING_GENERATE', 'TEACHING_REVIEW')),
            book_source_revision_id TEXT NOT NULL
                REFERENCES book_source_revisions(id) ON DELETE CASCADE,
            page_start INTEGER CHECK (page_start IS NULL OR page_start >= 0),
            page_end INTEGER CHECK (
                page_end IS NULL OR (page_start IS NOT NULL AND page_end >= page_start)
            ),
            foundation_version INTEGER NOT NULL CHECK (foundation_version >= 1),
            chapter_outline_node_id TEXT,
            chapter_identity_revision INTEGER
                CHECK (chapter_identity_revision IS NULL OR chapter_identity_revision >= 1),
            chapter_physical_revision INTEGER
                CHECK (chapter_physical_revision IS NULL OR chapter_physical_revision >= 1),
            status TEXT NOT NULL
                CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED')),
            priority INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (
                (job_type = 'PAGE_PREPARE'
                    AND page_start IS NOT NULL AND page_end IS NOT NULL
                    AND chapter_outline_node_id IS NULL
                    AND chapter_identity_revision IS NULL
                    AND chapter_physical_revision IS NULL)
                OR
                (job_type IN ('CHAPTER_PREPARE', 'TEACHING_GENERATE', 'TEACHING_REVIEW')
                    AND page_start IS NULL AND page_end IS NULL
                    AND chapter_outline_node_id IS NOT NULL
                    AND chapter_identity_revision IS NOT NULL
                    AND chapter_physical_revision IS NOT NULL)
            ),
            FOREIGN KEY (book_source_revision_id, chapter_outline_node_id)
                REFERENCES outline_nodes(book_source_revision_id, outline_node_id)
                ON DELETE CASCADE
        );

        INSERT INTO jobs_v14 SELECT * FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_v14 RENAME TO jobs;
CREATE INDEX ix_jobs_claim
            ON jobs(status, cancel_requested, priority DESC, created_at);
        CREATE UNIQUE INDEX ux_jobs_page_prepare
            ON jobs(job_type, book_source_revision_id, page_start, page_end, foundation_version)
            WHERE job_type = 'PAGE_PREPARE';
        CREATE UNIQUE INDEX ux_jobs_chapter_prepare
            ON jobs(
                job_type, book_source_revision_id, chapter_outline_node_id,
                foundation_version, chapter_identity_revision, chapter_physical_revision
            ) WHERE job_type = 'CHAPTER_PREPARE';


CREATE TABLE teaching_assets (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    section_node_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'READING_GUIDE' CHECK(kind='READING_GUIDE'),
    version INTEGER NOT NULL CHECK(version>=1),
    state TEXT NOT NULL CHECK(state IN ('DRAFT','IN_REVIEW','REJECTED','FAILED','PUBLISHED')),
    stage TEXT NOT NULL CHECK(stage IN ('GENERATE','REVIEW','COMPLETE')),
    semantic_rework_count INTEGER NOT NULL DEFAULT 0 CHECK(semantic_rework_count BETWEEN 0 AND 3),
    terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1)),
    failure_code TEXT,
    failure_detail TEXT,
    intent_id TEXT NOT NULL,
    job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    content_json TEXT,
    dependencies_json TEXT,
    sources_json TEXT,
    issues_json TEXT,
    generator_json TEXT,
    reviewer_json TEXT,
    review_verdict TEXT CHECK(review_verdict IS NULL OR review_verdict IN ('PASS','FAIL')),
    created_at TEXT NOT NULL,
    published_at TEXT,
    UNIQUE(book_source_revision_id, section_node_id, version),
    UNIQUE(book_source_revision_id, section_node_id, intent_id),
    UNIQUE(book_source_revision_id, section_node_id, id),
    FOREIGN KEY(book_source_revision_id,section_node_id)
        REFERENCES outline_nodes(book_source_revision_id,outline_node_id) ON DELETE CASCADE,
    CHECK(state!='PUBLISHED' OR (review_verdict='PASS' AND content_json IS NOT NULL
        AND dependencies_json IS NOT NULL AND sources_json IS NOT NULL
        AND generator_json IS NOT NULL AND reviewer_json IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE foundation_events (
    id INTEGER PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK(event_type IN ('TEXT_CORRECTION','REPROCESS')),
    page_start INTEGER NOT NULL CHECK(page_start>=0),
    page_end INTEGER NOT NULL CHECK(page_end>=page_start),
    foundation_version INTEGER NOT NULL CHECK(foundation_version>=1),
    created_at TEXT NOT NULL
);
CREATE INDEX ix_foundation_events_footprint ON foundation_events(book_source_revision_id,foundation_version,page_start,page_end);
CREATE UNIQUE INDEX ux_teaching_inflight ON teaching_assets(book_source_revision_id,section_node_id)
    WHERE state IN ('DRAFT','IN_REVIEW','REJECTED');
CREATE TABLE section_guides (
    book_source_revision_id TEXT NOT NULL,
    section_node_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(book_source_revision_id,section_node_id),
    FOREIGN KEY(book_source_revision_id,section_node_id,asset_id)
        REFERENCES teaching_assets(book_source_revision_id,section_node_id,id) ON DELETE CASCADE
);
CREATE TRIGGER teaching_terminal BEFORE UPDATE ON teaching_assets
WHEN OLD.terminal=1 AND (NEW.state!=OLD.state OR NEW.terminal!=1)
BEGIN SELECT RAISE(ABORT,'Terminal Teaching failure'); END;
CREATE TRIGGER teaching_published_immutable BEFORE UPDATE ON teaching_assets
WHEN OLD.state='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'Published Teaching is immutable'); END;
CREATE TRIGGER teaching_pointer_insert BEFORE INSERT ON section_guides
WHEN NOT EXISTS(SELECT 1 FROM teaching_assets WHERE id=NEW.asset_id AND state='PUBLISHED' AND review_verdict='PASS')
BEGIN SELECT RAISE(ABORT,'Teaching must pass Review'); END;
CREATE TRIGGER teaching_pointer_update BEFORE UPDATE ON section_guides
WHEN NOT EXISTS(SELECT 1 FROM teaching_assets WHERE id=NEW.asset_id AND state='PUBLISHED' AND review_verdict='PASS')
BEGIN SELECT RAISE(ABORT,'Teaching must pass Review'); END;
"""

# New Section-atomic asset kind. Existing Guide rows, jobs and pointers are untouched.
INLINE_TEACHING_SCHEMA = r"""
CREATE TABLE inline_teaching_assets (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    section_node_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'INLINE_GUIDANCE' CHECK(kind='INLINE_GUIDANCE'),
    version INTEGER NOT NULL CHECK(version>=1),
    state TEXT NOT NULL CHECK(state IN ('DRAFT','IN_REVIEW','REJECTED','FAILED','PUBLISHED')),
    stage TEXT NOT NULL CHECK(stage IN ('GENERATE','REVIEW','COMPLETE')),
    semantic_rework_count INTEGER NOT NULL DEFAULT 0 CHECK(semantic_rework_count BETWEEN 0 AND 3),
    terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1)),
    failure_code TEXT,
    failure_detail TEXT,
    intent_id TEXT NOT NULL,
    job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    content_json TEXT,
    dependencies_json TEXT,
    sources_json TEXT,
    issues_json TEXT,
    generator_json TEXT,
    reviewer_json TEXT,
    review_verdict TEXT CHECK(review_verdict IS NULL OR review_verdict IN ('PASS','FAIL')),
    created_at TEXT NOT NULL,
    published_at TEXT,
    UNIQUE(book_source_revision_id, section_node_id, version),
    UNIQUE(book_source_revision_id, section_node_id, intent_id),
    UNIQUE(book_source_revision_id, section_node_id, id),
    FOREIGN KEY(book_source_revision_id,section_node_id)
        REFERENCES outline_nodes(book_source_revision_id,outline_node_id) ON DELETE CASCADE,
    CHECK(state!='PUBLISHED' OR (review_verdict='PASS' AND content_json IS NOT NULL
        AND dependencies_json IS NOT NULL AND sources_json IS NOT NULL
        AND generator_json IS NOT NULL AND reviewer_json IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_inline_teaching_inflight ON inline_teaching_assets(book_source_revision_id,section_node_id)
    WHERE state IN ('DRAFT','IN_REVIEW','REJECTED');
CREATE TABLE section_inline_teaching (
    book_source_revision_id TEXT NOT NULL,
    section_node_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(book_source_revision_id,section_node_id),
    FOREIGN KEY(book_source_revision_id,section_node_id,asset_id)
        REFERENCES inline_teaching_assets(book_source_revision_id,section_node_id,id) ON DELETE CASCADE
);
CREATE TRIGGER inline_teaching_terminal BEFORE UPDATE ON inline_teaching_assets
WHEN OLD.terminal=1 AND (NEW.state!=OLD.state OR NEW.terminal!=1)
BEGIN SELECT RAISE(ABORT,'Terminal Teaching failure'); END;
CREATE TRIGGER inline_teaching_published_immutable BEFORE UPDATE ON inline_teaching_assets
WHEN OLD.state='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'Published Teaching is immutable'); END;
CREATE TRIGGER inline_teaching_pointer_insert BEFORE INSERT ON section_inline_teaching
WHEN NOT EXISTS(SELECT 1 FROM inline_teaching_assets WHERE id=NEW.asset_id AND state='PUBLISHED' AND review_verdict='PASS')
BEGIN SELECT RAISE(ABORT,'Teaching must pass Review'); END;
CREATE TRIGGER inline_teaching_pointer_update BEFORE UPDATE ON section_inline_teaching
WHEN NOT EXISTS(SELECT 1 FROM inline_teaching_assets WHERE id=NEW.asset_id AND state='PUBLISHED' AND review_verdict='PASS')
BEGIN SELECT RAISE(ABORT,'Teaching must pass Review'); END;
"""
