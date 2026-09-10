from uuid import uuid4

from reader_service.knowledge.repository import KnowledgeRepository, now
from reader_service.learning.display import add_display_ends


class LearningRepository:
    def __init__(self, database):
        self.database = database
        self.knowledge = KnowledgeRepository(database)

    @staticmethod
    def point(connection, revision_id, kp_id):
        row = connection.execute("""
            SELECT kp.*, node.title AS section_title FROM knowledge_points kp
            JOIN chapter_preparations chapter USING(book_source_revision_id, chapter_outline_node_id)
            JOIN outline_nodes node ON node.book_source_revision_id = kp.book_source_revision_id
                AND node.outline_node_id = kp.primary_section_id
            JOIN book_source_revisions revision ON revision.id = kp.book_source_revision_id
            WHERE kp.book_source_revision_id = ? AND kp.knowledge_point_id = ?
                AND chapter.status = 'READY' AND revision.status = 'ACTIVE'
                AND kp.chapter_structure_version = chapter.structure_version
        """, (revision_id, kp_id)).fetchone()
        if row is None:
            section = connection.execute("""
                SELECT node.*, kp.chapter_outline_node_id FROM outline_nodes node
                JOIN knowledge_points kp ON kp.primary_section_id = node.outline_node_id
                    AND kp.book_source_revision_id = node.book_source_revision_id
                JOIN chapter_preparations chapter ON chapter.book_source_revision_id = kp.book_source_revision_id
                    AND chapter.chapter_outline_node_id = kp.chapter_outline_node_id
                JOIN book_source_revisions revision ON revision.id = node.book_source_revision_id
                WHERE node.book_source_revision_id = ? AND node.outline_node_id = ? AND node.kind = 'SECTION'
                    AND chapter.status = 'READY' AND revision.status = 'ACTIVE'
                    AND chapter.structure_version = kp.chapter_structure_version
                    AND node.start_page IS NOT NULL AND node.start_y IS NOT NULL
                    AND node.end_page IS NOT NULL AND node.end_y IS NOT NULL
                LIMIT 1
            """, (revision_id, kp_id)).fetchone()
            if section is None:
                raise LookupError("学习范围不存在或章节尚未准备完成。")
            return {**dict(section), "scope_id": kp_id, "scope_kind": "SECTION",
                    "section_title": section["title"], "primary_section_id": kp_id}
        return {**dict(row), "scope_id": kp_id, "scope_kind": "KP"}

    @staticmethod
    def _thread(c, point):
        column = "section_outline_node_id" if point["scope_kind"] == "SECTION" else "knowledge_point_id"
        return c.execute(f"SELECT * FROM master_threads WHERE {column} = ? AND book_source_revision_id = ?",
                         (point["scope_id"], point["book_source_revision_id"])).fetchone()

    @staticmethod
    def _status(c, point):
        if point["scope_kind"] == "SECTION":
            row = c.execute("SELECT mastery_check_state FROM section_learning_states WHERE outline_node_id = ?", (point["scope_id"],)).fetchone()
            return row[0] if row else "AVAILABLE"
        row = c.execute("SELECT status FROM kp_status WHERE knowledge_point_id = ?", (point["scope_id"],)).fetchone()
        return row[0] if row else "UNCONFIRMED"

    def snapshot(self, revision_id, kp_id):
        with self.database.connect() as c:
            c.execute("BEGIN")
            point = self.point(c, revision_id, kp_id)
            thread = self._thread(c, point)
            status = self._status(c, point)
            topics, messages = [], []
            if thread:
                topics = [dict(r) for r in c.execute("SELECT * FROM master_topics WHERE thread_id = ? ORDER BY created_at, rowid", (thread["id"],))]
                messages = [dict(r) for r in c.execute("SELECT * FROM master_messages WHERE thread_id = ? ORDER BY created_at, rowid", (thread["id"],))]
            return {"point": point, "status": status,
                    "thread_id": thread["id"] if thread else None, "topics": topics, "messages": messages}

    def entries(self, revision_id):
        with self.database.connect() as c:
            points = [dict(r) for r in c.execute("""
                SELECT kp.*, node.title AS section_title,
                    COALESCE(s.status, 'UNCONFIRMED') AS status,
                    t.id AS thread_id
                FROM knowledge_points kp
                JOIN chapter_preparations chapter USING(book_source_revision_id, chapter_outline_node_id)
                JOIN outline_nodes node ON node.book_source_revision_id = kp.book_source_revision_id
                    AND node.outline_node_id = kp.primary_section_id
                LEFT JOIN kp_status s USING(knowledge_point_id)
                LEFT JOIN master_threads t USING(knowledge_point_id)
                WHERE kp.book_source_revision_id = ? AND chapter.status = 'READY'
                    AND kp.chapter_structure_version = chapter.structure_version
                ORDER BY kp.start_page, kp.start_y, kp.order_index
            """, (revision_id,))]
            sections = [dict(r) for r in c.execute("""
                SELECT outline_node_id, kind, parent_id, title, start_page, start_y, end_page, end_y FROM outline_nodes
                WHERE book_source_revision_id = ? AND kind IN ('SECTION', 'SUBSECTION')
                    AND start_page IS NOT NULL AND start_y IS NOT NULL
                    AND end_page IS NOT NULL AND end_y IS NOT NULL
            """, (revision_id,))]
            for section in sections:
                section["knowledge_point_ids"] = [p["knowledge_point_id"] for p in points if self._in_confirmation_scope(p, section)]
                if section["kind"] == "SECTION":
                    scoped = {"scope_kind": "SECTION", "scope_id": section["outline_node_id"], "book_source_revision_id": revision_id}
                    thread = self._thread(c, scoped)
                    section["thread_id"] = thread["id"] if thread else None
                    section["status"] = self._status(c, scoped)
            add_display_ends(c, revision_id, points)
            return {"points": points, "sections": sections}

    @staticmethod
    def _in_confirmation_scope(point, node):
        if node["kind"] == "SECTION":
            return point["primary_section_id"] == node["outline_node_id"]
        return (point["primary_section_id"] == node["parent_id"]
                and (node["start_page"], node["start_y"]) <= (point["start_page"], point["start_y"])
                < (node["end_page"], node["end_y"])
                and (point["end_page"], point["end_y"]) <= (node["end_page"], node["end_y"]))

    def _event(self, c, point, status, evidence, topic_id=None):
        timestamp = now()
        kp_id = point["knowledge_point_id"]
        self.knowledge.lock_for_learning_state(c, kp_id)
        c.execute("""INSERT INTO learning_events(id, book_source_revision_id, knowledge_point_id, topic_id, event_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                  (str(uuid4()), point["book_source_revision_id"], kp_id, topic_id, evidence, status, timestamp))
        c.execute("""
            INSERT INTO kp_status VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(knowledge_point_id) DO UPDATE SET status = excluded.status,
                evidence_source = excluded.evidence_source,
                first_understood_at = COALESCE(kp_status.first_understood_at, excluded.first_understood_at),
                updated_at = excluded.updated_at
        """, (kp_id, point["book_source_revision_id"], status, evidence,
              timestamp if status == "UNDERSTOOD" else None, timestamp))

    def _open(self, c, point):
        self._lock_scope(c, point)
        column = "section_outline_node_id" if point["scope_kind"] == "SECTION" else "knowledge_point_id"
        c.execute(f"INSERT OR IGNORE INTO master_threads(id, book_source_revision_id, {column}, created_at) VALUES (?, ?, ?, ?)",
                  (str(uuid4()), point["book_source_revision_id"], point["scope_id"], now()))
        thread_id = self._thread(c, point)["id"]
        topic = c.execute("SELECT id FROM master_topics WHERE thread_id = ? AND state = 'ACTIVE'", (thread_id,)).fetchone()
        if topic is None:
            topic_id = str(uuid4())
            c.execute("INSERT INTO master_topics VALUES (?, ?, 'ACTIVE', ?, NULL, NULL)", (topic_id, thread_id, now()))
        else:
            topic_id = topic[0]
        return thread_id, topic_id

    def _lock_scope(self, c, point):
        if point["scope_kind"] == "KP":
            self.knowledge.lock_for_learning_state(c, point["scope_id"])
        else:
            c.execute("""UPDATE chapter_preparations SET learning_state_ever_at = COALESCE(learning_state_ever_at, ?), updated_at = ?
                WHERE book_source_revision_id = ? AND chapter_outline_node_id = ? AND status = 'READY'""",
                (now(), now(), point["book_source_revision_id"], point["chapter_outline_node_id"]))

    def _section_event(self, c, point, status, topic_id=None):
        self._lock_scope(c, point)
        timestamp = now()
        c.execute("""INSERT INTO learning_events(id, book_source_revision_id, section_outline_node_id, topic_id, event_type, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""", (str(uuid4()), point["book_source_revision_id"], point["scope_id"], topic_id,
            "SECTION_CHECK_CLEAR" if status == "ANSWERED_CLEAR" else "SECTION_CHECK_HAS_UNCLEAR", status, timestamp))
        c.execute("""INSERT INTO section_learning_states(outline_node_id, book_source_revision_id, mastery_check_state, updated_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(outline_node_id) DO UPDATE SET mastery_check_state=excluded.mastery_check_state, updated_at=excluded.updated_at""",
            (point["scope_id"], point["book_source_revision_id"], status, timestamp))

    def open(self, revision_id, kp_id):
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            point = self.point(c, revision_id, kp_id)
            _, topic_id = self._open(c, point)
            if point["scope_kind"] == "SECTION":
                if self._status(c, point) != "ANSWERED_HAS_UNCLEAR":
                    self._section_event(c, point, "ANSWERED_HAS_UNCLEAR", topic_id)
            else:
                status = c.execute("SELECT status FROM kp_status WHERE knowledge_point_id = ?", (kp_id,)).fetchone()
                if status is None:
                    self._event(c, point, "NOT_FULLY_CLEAR", "KP_EXPLICIT_UNCLEAR", topic_id)
        return self.snapshot(revision_id, kp_id)

    def confirm(self, revision_id, kp_id, topic_id):
        if self.snapshot(revision_id, kp_id)["point"]["scope_kind"] == "SECTION":
            return self.clear_section(revision_id, kp_id, topic_id)
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            point = self.point(c, revision_id, kp_id)
            topic = c.execute("""SELECT topic.* FROM master_topics topic JOIN master_threads t ON t.id = topic.thread_id
                WHERE topic.id = ? AND t.knowledge_point_id = ?""", (topic_id, kp_id)).fetchone()
            if topic is None:
                raise LookupError("学习话题不存在。")
            if topic["state"] == "ACTIVE":
                c.execute("UPDATE master_topics SET state = 'RESOLVED', resolved_at = ?, resolved_by = 'EXPLICIT_USER_EVIDENCE' WHERE id = ?", (now(), topic_id))
                self._event(c, point, "UNDERSTOOD", "KP_EXPLICIT_UNDERSTOOD", topic_id)
        return self.snapshot(revision_id, kp_id)

    def clear_section(self, revision_id, section_id, topic_id=None):
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            section = self.point(c, revision_id, section_id)
            if section["scope_kind"] != "SECTION":
                raise ValueError("本节确认仅适用于二级 Section。")
            thread = self._thread(c, section)
            if topic_id:
                topic = c.execute("SELECT state FROM master_topics WHERE id=? AND thread_id=?", (topic_id, thread["id"])).fetchone() if thread else None
                if not topic:
                    raise LookupError("话题不属于本节。")
                if topic[0] == "RESOLVED":
                    # Replaying an old confirmation cannot resolve a later Section topic.
                    return self.snapshot(revision_id, section_id)
            changed = 0
            for row in c.execute("SELECT knowledge_point_id FROM knowledge_points WHERE book_source_revision_id=? AND primary_section_id=?", (revision_id, section_id)).fetchall():
                point = self.point(c, revision_id, row[0])
                if self._status(c, point) != "UNDERSTOOD":
                    self._event(c, point, "UNDERSTOOD", "SECTION_CHECK_CLEAR")
                    changed += 1
            active = c.execute("SELECT id FROM master_topics WHERE thread_id=? AND state='ACTIVE'", (thread["id"],)).fetchone() if thread else None
            if self._status(c, section) != "ANSWERED_CLEAR" or active or changed:
                self._section_event(c, section, "ANSWERED_CLEAR", active[0] if active else None)
            if active:
                c.execute("UPDATE master_topics SET state='RESOLVED', resolved_at=?, resolved_by='EXPLICIT_USER_EVIDENCE' WHERE id=?", (now(), active[0]))
        return self.snapshot(revision_id, section_id)

    def confirm_section(self, revision_id, section_id):
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            section = c.execute("SELECT * FROM outline_nodes WHERE book_source_revision_id = ? AND outline_node_id = ?", (revision_id, section_id)).fetchone()
            if section is None or section["kind"] not in {"SECTION", "SUBSECTION"}:
                raise LookupError("章节或小节不存在。")
            if section["kind"] == "SUBSECTION" and any(section[key] is None for key in ("start_page", "start_y", "end_page", "end_y")):
                raise ValueError("本小节教材范围尚未就绪。")
            owner_id = section_id if section["kind"] == "SECTION" else section["parent_id"]
            ids = [r["knowledge_point_id"] for r in c.execute("SELECT * FROM knowledge_points WHERE book_source_revision_id = ? AND primary_section_id = ?", (revision_id, owner_id)) if self._in_confirmation_scope(r, section)]
            changed = 0
            unclear = 0
            for kp_id in ids:
                point = self.point(c, revision_id, kp_id)
                status = c.execute("SELECT status FROM kp_status WHERE knowledge_point_id = ?", (kp_id,)).fetchone()
                if status is None:
                    self._event(c, point, "UNDERSTOOD", f"{section['kind']}_UNCONFIRMED_EXPLICIT_CONFIRM")
                    changed += 1
                elif status[0] == "NOT_FULLY_CLEAR":
                    unclear += 1
            if not ids:
                raise ValueError("本节尚无已发布知识点。")
            return {"changed": changed, "unclear": unclear}

    def enqueue(self, revision_id, kp_id, intent_id, question, mode):
        if not isinstance(intent_id, str) or not 1 <= len(intent_id) <= 120:
            raise ValueError("发送标识无效。")
        if not isinstance(question, str) or not 1 <= len(question.strip()) <= 2000:
            raise ValueError("请输入 1–2000 字的问题。")
        if mode not in {"Fast", "Standard", "Deep"}:
            raise ValueError("审查模式无效。")
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            point = self.point(c, revision_id, kp_id)
            thread = self._thread(c, point)
            thread_id = thread["id"] if thread else None
            existing = c.execute("""SELECT m.* FROM master_messages m JOIN master_threads t ON t.id = m.thread_id
                WHERE t.id = ? AND m.intent_id = ? AND m.role = 'user'""", (thread_id, intent_id)).fetchone()
            if existing:
                if existing["content"] != question.strip() or existing["review_mode"] != mode:
                    raise ValueError("同一次发送不能改变问题或审查模式。")
                return dict(existing), False
            pending = c.execute("""SELECT 1 FROM master_messages m JOIN master_threads t ON t.id = m.thread_id
                WHERE t.id = ? AND m.role = 'user' AND m.state IN ('PENDING', 'FAILED')""", (thread_id,)).fetchone()
            if pending:
                raise ValueError("请先等待或重试上一条未完成的问题。")
            thread_id, topic_id = self._open(c, point)
            message_id = str(uuid4())
            c.execute("""INSERT INTO master_messages(id, thread_id, topic_id, intent_id, role, content, created_at, state, review_mode)
                VALUES (?, ?, ?, ?, 'user', ?, ?, 'PENDING', ?)""", (message_id, thread_id, topic_id, intent_id, question.strip(), now(), mode))
            return dict(c.execute("SELECT * FROM master_messages WHERE id = ?", (message_id,)).fetchone()), True

    def recover(self):
        with self.database.connect() as c:
            c.execute("UPDATE master_messages SET state = 'FAILED', detail = '服务已重启，问题已保留，请重试。' WHERE role = 'user' AND state = 'PENDING'")
            c.execute("UPDATE master_messages SET review_state = 'TECHNICAL_FAILURE', detail = '审查被重启中断，请重试审查。' WHERE review_state = 'PENDING'")

    def update_message(self, message_id, **fields):
        allowed = {"state", "review_state", "provider", "model", "reviewer_provider", "reviewer_model", "detail"}
        if not fields or not set(fields) <= allowed:
            raise ValueError("Invalid message update")
        with self.database.connect() as c:
            c.execute(f"UPDATE master_messages SET {', '.join(key + ' = ?' for key in fields)} WHERE id = ?", (*fields.values(), message_id))

    def save_answer(self, question, completion):
        answer_id = str(uuid4())
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("""INSERT INTO master_messages(id, thread_id, topic_id, intent_id, role, content, created_at,
                state, review_mode, review_state, provider, model) VALUES (?, ?, ?, ?, 'assistant', ?, ?, 'COMPLETE', ?, ?, ?, ?)""",
                (answer_id, question["thread_id"], question["topic_id"], question["intent_id"], completion.answer, now(),
                 question["review_mode"], "NOT_REQUESTED" if question["review_mode"] == "Fast" else "PENDING",
                 completion.effective_config["provider"], completion.effective_config["model"]))
            c.execute("UPDATE master_messages SET state = 'COMPLETE', detail = NULL WHERE id = ?", (question["id"],))
        return answer_id
