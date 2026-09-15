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

SECTION_SCHEMA = """
CREATE TABLE master_threads_section_upgrade (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    knowledge_point_id TEXT UNIQUE REFERENCES knowledge_points(knowledge_point_id),
    created_at TEXT NOT NULL,
    section_outline_node_id TEXT UNIQUE REFERENCES outline_nodes(outline_node_id),
    CHECK ((knowledge_point_id IS NOT NULL) != (section_outline_node_id IS NOT NULL))
);
INSERT INTO master_threads_section_upgrade SELECT id, book_source_revision_id, knowledge_point_id, created_at, NULL FROM master_threads;
DROP TABLE master_threads;
ALTER TABLE master_threads_section_upgrade RENAME TO master_threads;

CREATE TABLE section_learning_states (
    outline_node_id TEXT PRIMARY KEY REFERENCES outline_nodes(outline_node_id),
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    reading_reached_end_at TEXT,
    mastery_check_state TEXT NOT NULL CHECK(mastery_check_state IN ('ANSWERED_CLEAR', 'ANSWERED_HAS_UNCLEAR')),
    updated_at TEXT NOT NULL
);
CREATE TABLE learning_events_section_upgrade (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    knowledge_point_id TEXT REFERENCES knowledge_points(knowledge_point_id),
    topic_id TEXT REFERENCES master_topics(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('NOT_FULLY_CLEAR', 'UNDERSTOOD', 'ANSWERED_CLEAR', 'ANSWERED_HAS_UNCLEAR')),
    created_at TEXT NOT NULL,
    section_outline_node_id TEXT REFERENCES outline_nodes(outline_node_id),
    CHECK ((knowledge_point_id IS NOT NULL) != (section_outline_node_id IS NOT NULL))
);
INSERT INTO learning_events_section_upgrade SELECT *, NULL FROM learning_events;
DROP TRIGGER learning_events_no_update;
DROP TRIGGER learning_events_no_direct_delete;
DROP TABLE learning_events;
ALTER TABLE learning_events_section_upgrade RENAME TO learning_events;
CREATE TRIGGER learning_events_no_update BEFORE UPDATE ON learning_events
BEGIN SELECT RAISE(ABORT, 'Learning history is append-only'); END;
CREATE TRIGGER learning_events_no_direct_delete BEFORE DELETE ON learning_events
WHEN EXISTS (SELECT 1 FROM book_source_revisions WHERE id = OLD.book_source_revision_id)
BEGIN SELECT RAISE(ABORT, 'Learning history can only cascade with its book'); END;
"""


STABLE_TOPIC_SCHEMA = """
CREATE TEMP TABLE master_topic_identity_merge_plan (
    thread_id TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL,
    latest_id TEXT NOT NULL,
    latest_state TEXT NOT NULL,
    latest_resolved_at TEXT,
    latest_resolved_by TEXT
);
INSERT INTO master_topic_identity_merge_plan
SELECT grouped.thread_id,
    (SELECT id FROM master_topics
     WHERE thread_id = grouped.thread_id ORDER BY created_at, rowid LIMIT 1),
    (SELECT id FROM master_topics
     WHERE thread_id = grouped.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1),
    (SELECT state FROM master_topics
     WHERE thread_id = grouped.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1),
    (SELECT resolved_at FROM master_topics
     WHERE thread_id = grouped.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1),
    (SELECT resolved_by FROM master_topics
     WHERE thread_id = grouped.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1)
FROM (SELECT thread_id FROM master_topics GROUP BY thread_id HAVING COUNT(*) > 1) AS grouped;

DROP TRIGGER learning_events_no_update;
UPDATE master_messages
SET topic_id = (
    SELECT plan.canonical_id FROM master_topic_identity_merge_plan AS plan
    WHERE plan.thread_id = master_messages.thread_id
)
WHERE thread_id IN (SELECT thread_id FROM master_topic_identity_merge_plan);
UPDATE learning_events
SET topic_id = (
    SELECT plan.canonical_id
    FROM master_topics AS topic
    JOIN master_topic_identity_merge_plan AS plan ON plan.thread_id = topic.thread_id
    WHERE topic.id = learning_events.topic_id
)
WHERE topic_id IN (
    SELECT topic.id FROM master_topics AS topic
    JOIN master_topic_identity_merge_plan AS plan ON plan.thread_id = topic.thread_id
);
DELETE FROM master_topics
WHERE id IN (
    SELECT topic.id FROM master_topics AS topic
    JOIN master_topic_identity_merge_plan AS plan ON plan.thread_id = topic.thread_id
    WHERE topic.id != plan.canonical_id
);
UPDATE master_topics
SET state = (
        SELECT plan.latest_state FROM master_topic_identity_merge_plan AS plan
        WHERE plan.canonical_id = master_topics.id
    ),
    resolved_at = (
        SELECT plan.latest_resolved_at FROM master_topic_identity_merge_plan AS plan
        WHERE plan.canonical_id = master_topics.id
    ),
    resolved_by = (
        SELECT plan.latest_resolved_by FROM master_topic_identity_merge_plan AS plan
        WHERE plan.canonical_id = master_topics.id
    )
WHERE id IN (SELECT canonical_id FROM master_topic_identity_merge_plan);

DROP INDEX one_active_master_topic;
CREATE UNIQUE INDEX one_master_topic_per_thread ON master_topics(thread_id);
CREATE TRIGGER learning_events_no_update BEFORE UPDATE ON learning_events
BEGIN SELECT RAISE(ABORT, 'Learning history is append-only'); END;
DROP TABLE master_topic_identity_merge_plan;
"""


MASTER_REASONING_SCHEMA = """
ALTER TABLE master_messages ADD COLUMN reasoning_mode TEXT NOT NULL DEFAULT 'Quick'
    CHECK(reasoning_mode IN ('Quick', 'Deep'));
"""
