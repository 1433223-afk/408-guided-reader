SCHEMA = """
CREATE TABLE master_threads (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    knowledge_point_id TEXT NOT NULL UNIQUE REFERENCES knowledge_points(knowledge_point_id),
    created_at TEXT NOT NULL
);
CREATE TABLE master_topics (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES master_threads(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK(state IN ('ACTIVE', 'RESOLVED')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT CHECK(resolved_by IS NULL OR resolved_by = 'EXPLICIT_USER_EVIDENCE')
);
CREATE UNIQUE INDEX one_active_master_topic ON master_topics(thread_id) WHERE state = 'ACTIVE';
CREATE TABLE master_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES master_threads(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES master_topics(id) ON DELETE CASCADE,
    intent_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PENDING', 'FAILED', 'COMPLETE')),
    review_mode TEXT NOT NULL CHECK(review_mode IN ('Fast', 'Standard', 'Deep')),
    review_state TEXT CHECK(review_state IN ('NOT_REQUESTED', 'PENDING', 'PASS', 'FAIL', 'TECHNICAL_FAILURE')),
    provider TEXT, model TEXT, reviewer_provider TEXT, reviewer_model TEXT,
    detail TEXT,
    UNIQUE(thread_id, intent_id, role)
);
CREATE TABLE kp_status (
    knowledge_point_id TEXT PRIMARY KEY REFERENCES knowledge_points(knowledge_point_id),
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('NOT_FULLY_CLEAR', 'UNDERSTOOD')),
    evidence_source TEXT NOT NULL,
    first_understood_at TEXT,
    updated_at TEXT NOT NULL
);
CREATE TABLE learning_events (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    knowledge_point_id TEXT NOT NULL REFERENCES knowledge_points(knowledge_point_id),
    topic_id TEXT REFERENCES master_topics(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('NOT_FULLY_CLEAR', 'UNDERSTOOD')),
    created_at TEXT NOT NULL
);
CREATE TRIGGER learning_events_no_update BEFORE UPDATE ON learning_events
BEGIN SELECT RAISE(ABORT, 'Learning history is append-only'); END;
CREATE TRIGGER learning_events_no_direct_delete BEFORE DELETE ON learning_events
WHEN EXISTS (SELECT 1 FROM book_source_revisions WHERE id = OLD.book_source_revision_id)
BEGIN SELECT RAISE(ABORT, 'Learning history can only cascade with its book'); END;
"""
