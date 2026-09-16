"""Explicit curation only. No provider, learning-state writer or content storage."""
from uuid import uuid4

from reader_service.annotation.repository import AnnotationRepository
from reader_service.library.repository import now


class LearningMemory:
    def __init__(self, database):
        self.database = database

    @staticmethod
    def _owner(c, revision):
        row = c.execute("""SELECT r.id, b.id AS book_id, b.title AS book_title
            FROM book_source_revisions r JOIN books b ON b.id = r.book_id
            WHERE r.id = ? AND r.status = 'ACTIVE' AND b.status = 'ACTIVE'""", (revision,)).fetchone()
        if row is None:
            raise LookupError("教材不存在或已不可用。")
        return dict(row)

    @staticmethod
    def _source(c, revision, kind, source_id):
        kp_id = section_id = None
        if kind == 'MASTER':
            row = c.execute("""SELECT m.*, t.knowledge_point_id, t.section_outline_node_id
                FROM master_messages m JOIN master_threads t ON t.id = m.thread_id
                WHERE m.id = ? AND t.book_source_revision_id = ?
                AND m.role = 'assistant' AND m.state = 'COMPLETE'""", (source_id, revision)).fetchone()
            if row is None:
                raise LookupError("只能收录已持久保存且完成的 Master 回答。")
            source = dict(row)
            question = c.execute("""SELECT content FROM master_messages
                WHERE thread_id = ? AND topic_id = ? AND intent_id = ? AND role = 'user'""",
                (row['thread_id'], row['topic_id'], row['intent_id'])).fetchone()
            topic = c.execute("SELECT * FROM master_topics WHERE id = ? AND thread_id = ?",
                              (row['topic_id'], row['thread_id'])).fetchone()
            source['question'] = question[0] if question else None
            source['topic'] = dict(topic) if topic else None
            kp_id, section_id = row['knowledge_point_id'], row['section_outline_node_id']
        elif kind == 'AI_SAVED':
            row = c.execute("SELECT * FROM annotations WHERE id = ? AND book_source_revision_id = ? AND source_kind = 'AI_SAVED'",
                            (source_id, revision)).fetchone()
            if row is None:
                raise LookupError("请先将 Assistant 回答保存到笔记，再收录这条 AI 笔记。")
            source = AnnotationRepository._row(row)
            kp_id = source['knowledge_point_id']
            # Saved titles are not identity. Derive Section only from the actual PDF
            # anchor wholly contained in one resolved Section; never infer a KP.
            quads = source['quads']
            ys = [point[1] for quad in quads for point in quad]
            if ys:
                page = source['pdf_page_index']
                candidates = [r['outline_node_id'] for r in c.execute("""SELECT * FROM outline_nodes
                    WHERE book_source_revision_id = ? AND kind = 'SECTION'
                    AND start_page IS NOT NULL AND start_y IS NOT NULL
                    AND end_page IS NOT NULL AND end_y IS NOT NULL""", (revision,))
                    if (r['start_page'], r['start_y']) <= (page, min(ys))
                    and (page, max(ys)) < (r['end_page'], r['end_y'])]
                if len(candidates) == 1:
                    section_id = candidates[0]
        else:
            raise ValueError("学习记忆来源类型无效。")
        kp = c.execute("SELECT knowledge_point_id AS id, title, primary_section_id FROM knowledge_points WHERE knowledge_point_id = ? AND book_source_revision_id = ?",
                       (kp_id, revision)).fetchone() if kp_id else None
        if kp:
            section_id = kp['primary_section_id']
        section = c.execute("SELECT outline_node_id AS id, title FROM outline_nodes WHERE outline_node_id = ? AND book_source_revision_id = ? AND kind = 'SECTION'",
                            (section_id, revision)).fetchone() if section_id else None
        return {'source': source, 'section': dict(section) if section else None,
                'knowledge_point': dict(kp) if kp else None}

    def collect(self, revision, kind, source_id):
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("缺少持久来源标识。")
        with self.database.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            self._owner(c, revision)
            self._source(c, revision, kind, source_id)
            c.execute("""INSERT INTO learning_memory VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(source_kind, source_id) DO NOTHING""", (str(uuid4()), revision, kind, source_id, now()))
            row = c.execute("SELECT * FROM learning_memory WHERE book_source_revision_id = ? AND source_kind = ? AND source_id = ?",
                            (revision, kind, source_id)).fetchone()
            if row is None:
                raise LookupError("来源归属不匹配。")
            return dict(row)

    def list(self):
        with self.database.connect() as c:
            c.execute('BEGIN')
            result = []
            for row in c.execute("""SELECT m.* FROM learning_memory m
                JOIN book_source_revisions r ON r.id = m.book_source_revision_id
                JOIN books b ON b.id = r.book_id WHERE b.status = 'ACTIVE' AND r.status = 'ACTIVE'
                ORDER BY m.created_at DESC, m.id"""):
                result.append(self._resolve(c, row))
            return result

    def _resolve(self, c, row):
        revision = row['book_source_revision_id']
        return {**dict(row), **self._owner(c, revision), 'id': row['id'],
                **self._source(c, revision, row['source_kind'], row['source_id'])}

    def get(self, revision, membership_id):
        with self.database.connect() as c:
            c.execute('BEGIN')
            row = c.execute('SELECT * FROM learning_memory WHERE id = ? AND book_source_revision_id = ?', (membership_id, revision)).fetchone()
            if row is None:
                raise LookupError("这条学习记忆已移出或来源已删除。")
            return self._resolve(c, row)

    def remove(self, revision, membership_id):
        with self.database.connect() as c:
            c.execute('BEGIN IMMEDIATE')
            self._owner(c, revision)
            c.execute('DELETE FROM learning_memory WHERE id = ? AND book_source_revision_id = ?', (membership_id, revision))
