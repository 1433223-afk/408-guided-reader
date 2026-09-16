SCHEMA = """
CREATE TABLE learning_memory (
    id TEXT PRIMARY KEY,
    book_source_revision_id TEXT NOT NULL REFERENCES book_source_revisions(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('MASTER', 'AI_SAVED')),
    source_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_kind, source_id)
);
-- Soft cross-context source references: lifecycle hooks remove only the relation.
CREATE TRIGGER memory_annotation_deleted AFTER DELETE ON annotations
BEGIN DELETE FROM learning_memory WHERE source_kind = 'AI_SAVED' AND source_id = OLD.id; END;
CREATE TRIGGER memory_master_deleted AFTER DELETE ON master_messages
BEGIN DELETE FROM learning_memory WHERE source_kind = 'MASTER' AND source_id = OLD.id; END;
CREATE TRIGGER memory_eligible_source BEFORE INSERT ON learning_memory
WHEN NOT (
    (NEW.source_kind = 'AI_SAVED' AND EXISTS (
        SELECT 1 FROM annotations WHERE id = NEW.source_id
        AND book_source_revision_id = NEW.book_source_revision_id AND source_kind = 'AI_SAVED'))
    OR (NEW.source_kind = 'MASTER' AND EXISTS (
        SELECT 1 FROM master_messages m JOIN master_threads t ON t.id = m.thread_id
        WHERE m.id = NEW.source_id AND t.book_source_revision_id = NEW.book_source_revision_id
        AND m.role = 'assistant' AND m.state = 'COMPLETE'))
)
BEGIN SELECT RAISE(ABORT, 'Ineligible learning memory source'); END;
CREATE TRIGGER memory_relation_immutable BEFORE UPDATE ON learning_memory
BEGIN SELECT RAISE(ABORT, 'Remove and explicitly collect instead'); END;
"""
