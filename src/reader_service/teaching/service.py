import json
import os
from uuid import UUID, uuid4

from reader_service.agent_runtime import ProviderFailure
from reader_service.jobs.repository import now
from . import evidence
from .contracts import GENERATOR, REVIEWER, generation_messages, encoded, strict_json, validate_guide, validate_review


class TeachingService:
    def __init__(self, database, runtime):
        self.database = database
        self.runtime = runtime
        self.provider = os.environ.get("GUIDED_READER_SYSTEM_PROVIDER", "zhipu").strip().lower()
        self.reviewer = os.environ.get("GUIDED_READER_REVIEW_PROVIDER", "zhipu").strip().lower()

    def request(self, revision_id, section_id, intent_id, *, regenerate=False):
        try:
            UUID(intent_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("请求标识无效。") from None
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            node = evidence.section(c, revision_id, section_id)
            old = c.execute("SELECT id FROM teaching_assets WHERE book_source_revision_id=? AND section_node_id=? AND (intent_id=? OR state IN ('DRAFT','IN_REVIEW','REJECTED'))", (revision_id, section_id, intent_id)).fetchone()
            published = c.execute("SELECT asset_id FROM section_guides WHERE book_source_revision_id=? AND section_node_id=?", (revision_id, section_id)).fetchone()
            if not old and (regenerate or not published):
                asset_id, job_id = str(uuid4()), str(uuid4())
                version = c.execute("SELECT COALESCE(MAX(version),0)+1 FROM teaching_assets WHERE book_source_revision_id=? AND section_node_id=?", (revision_id, section_id)).fetchone()[0]
                foundation = c.execute("SELECT foundation_version FROM book_source_revisions WHERE id=?", (revision_id,)).fetchone()[0]
                c.execute("""INSERT INTO jobs(id,job_type,book_source_revision_id,foundation_version,
                    chapter_outline_node_id,chapter_identity_revision,chapter_physical_revision,status,priority,
                    cancel_requested,attempts,created_at,updated_at) VALUES (?,'TEACHING_GENERATE',?,?,?, ?,?,'QUEUED',4000,0,0,?,?)""",
                    (job_id, revision_id, foundation, section_id, node["identity_revision"], node["physical_revision"], now(), now()))
                c.execute("""INSERT INTO teaching_assets(id,book_source_revision_id,section_node_id,version,state,stage,intent_id,job_id,created_at)
                    VALUES (?,?,?,?,'DRAFT','GENERATE',?,?,?)""", (asset_id, revision_id, section_id, version, intent_id, job_id, now()))
        return self.snapshot(revision_id, section_id)

    def retry(self, revision_id, section_id, asset_id):
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            evidence.section(c, revision_id, section_id)
            row = c.execute("SELECT * FROM teaching_assets WHERE id=? AND book_source_revision_id=? AND section_node_id=?", (asset_id, revision_id, section_id)).fetchone()
            if row is None:
                raise LookupError("导读任务不存在。")
            if row["state"] == "FAILED" and not row["terminal"]:
                newer = c.execute("SELECT 1 FROM teaching_assets WHERE book_source_revision_id=? AND section_node_id=? AND version>?", (revision_id, section_id, row["version"])).fetchone()
                if newer:
                    raise ValueError("已有更新的导读请求，请使用最新任务。")
                c.execute("UPDATE teaching_assets SET state=?,failure_code=NULL,failure_detail=NULL WHERE id=?", ("IN_REVIEW" if row["stage"] == "REVIEW" else "DRAFT", asset_id))
                c.execute("UPDATE jobs SET status='QUEUED',cancel_requested=0,updated_at=? WHERE id=?", (now(), row["job_id"]))
        return self.snapshot(revision_id, section_id)

    def snapshot(self, revision_id, section_id):
        with self.database.connect() as c:
            c.execute("BEGIN")
            node = evidence.section(c, revision_id, section_id)
            row = c.execute("SELECT a.* FROM section_guides g JOIN teaching_assets a ON a.id=g.asset_id WHERE g.book_source_revision_id=? AND g.section_node_id=? AND a.state='PUBLISHED' AND a.review_verdict='PASS'", (revision_id, section_id)).fetchone()
            published = None
            if row:
                deps = json.loads(row["dependencies_json"])
                sources = json.loads(row["sources_json"])
                published = {"id": row["id"], "version": row["version"], "content": json.loads(row["content_json"]),
                    "stale": not evidence.current(c, deps), "published_at": row["published_at"], "sources": {}}
                used = {s for m in published["content"]["modules"] for s in m["source_ids"]}
                for source_id in used:
                    anchor = sources[source_id]
                    published["sources"][source_id] = {"pdf_page_index": anchor["pdf_page_index"],
                        "y": min(p[1] for p in anchor["quad"]), "available": evidence.safe_anchor(c, anchor)}
            latest = c.execute("SELECT id,version,state,stage,semantic_rework_count,terminal,failure_code,failure_detail FROM teaching_assets WHERE book_source_revision_id=? AND section_node_id=? ORDER BY version DESC LIMIT 1", (revision_id, section_id)).fetchone()
            return {"section": {"id": section_id, "title": node["title"]}, "published": published, "task": dict(latest) if latest else None}

    def _asset(self, job_id):
        with self.database.connect() as c:
            row = c.execute("SELECT * FROM teaching_assets WHERE job_id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def selection_context(self, revision_id, section_id, asset_id, module_id, start, end):
        from reader_service.assistant.context import ScopeResolution
        view = self.snapshot(revision_id, section_id)
        published = view["published"]
        if not published or published["id"] != asset_id:
            raise ValueError("只能选择当前已发布导读。")
        module = next((m for m in published["content"]["modules"] if m["id"] == module_id), None)
        if module is None or type(start) is not int or type(end) is not int or not 0 <= start < end <= len(module["text"]):
            raise ValueError("导读选区无效。")
        with self.database.connect() as c:
            row = c.execute("SELECT sources_json,dependencies_json FROM teaching_assets WHERE id=?", (asset_id,)).fetchone()
            sources = json.loads(row["sources_json"])
            deps = json.loads(row["dependencies_json"])
        anchor = sources[module["source_ids"][0]]
        return {"scope": ScopeResolution(f"SECTION:{section_id}", "SECTION", anchor["pdf_page_index"], section_id, view["section"]["title"]),
                "selected_text": module["text"][start:end], "source_anchor": {},
                "same_page_ocr_context": "所选来自已审查的 AI 导读，不是教材引文。以下为该模块的教材证据：\n" + "\n".join(sources[s]["quote"] for s in module["source_ids"])[:1600],
                "printed_page_label": None, "foundation_version": deps["foundation_version"]}

    def _update(self, asset_id, **values):
        allowed = {"state", "stage", "failure_code", "failure_detail", "terminal", "semantic_rework_count", "content_json", "sources_json", "dependencies_json", "issues_json", "generator_json", "reviewer_json", "review_verdict"}
        if not set(values) <= allowed:
            raise ValueError("Invalid Teaching update")
        with self.database.connect() as c:
            c.execute(f"UPDATE teaching_assets SET {','.join(k+'=?' for k in values)} WHERE id=? AND terminal=0 AND state!='PUBLISHED'", (*values.values(), asset_id))

    def _packet(self, asset):
        with self.database.connect() as c:
            c.execute("BEGIN")
            deps = json.loads(asset["dependencies_json"]) if asset["dependencies_json"] else None
            if deps and not evidence.current(c, deps):
                raise ValueError("导读使用的来源已变化，请重新生成。")
            return evidence.build(c, asset["book_source_revision_id"], asset["section_node_id"],
                                  use_kp=not deps or "chapter_structure_version" in deps)

    def _call(self, asset, role, system, payload, validator):
        feedback = ""
        selected = self.provider if role == "GENERATE" else self.reviewer
        provider, model = self.runtime.provider_identity(selected)
        self._update(asset["id"], **{("generator_json" if role == "GENERATE" else "reviewer_json"): encoded({"provider": provider, "model": model, "stage": role})})
        for attempt in range(2):
            completion = self.runtime.complete_for_with_metadata(
                self.provider if role == "GENERATE" else self.reviewer,
                generation_messages(system + feedback, payload) if role == "GENERATE" else
                [{"role": "system", "content": system + feedback}, {"role": "user", "content": encoded(payload)}],
                interaction_id=f"guide:{asset['id']}:{role}:{asset['semantic_rework_count']}:{attempt}",
                max_tokens=16384 if role == "GENERATE" else 8192)
            self._update(asset["id"], **{("generator_json" if role == "GENERATE" else "reviewer_json"): encoded({
                "effective_config": completion.effective_config, "latency_ms": completion.latency_ms,
                "usage": completion.usage, "response_metadata": completion.response_metadata})})
            try:
                if (completion.response_metadata or {}).get("finish_reason") == "length":
                    raise ValueError("模型输出被长度预算截断，未接受不完整导读。")
                return validator(strict_json(completion.answer))
            except ValueError as exc:
                feedback = "\n上次契约验证失败：" + str(exc) + " 请严格修正格式和来源约束。"
                if attempt:
                    raise

    def run_job(self, job):
        asset = self._asset(job["id"])
        if not asset or asset["state"] in {"FAILED", "PUBLISHED"}:
            return
        try:
            packet, ledger, deps = self._packet(asset)
            if not asset["dependencies_json"]:
                self._update(asset["id"], dependencies_json=encoded(deps), sources_json=encoded(ledger))
                asset = self._asset(job["id"])
            if asset["stage"] == "GENERATE":
                payload = {"source": packet}
                previous = json.loads(asset["content_json"]) if asset["content_json"] else None
                issues = json.loads(asset["issues_json"]) if asset["issues_json"] else []
                affected = {x["module_id"] for x in issues}
                if previous:
                    payload["rework"] = {"issues": issues, "modules": [m for m in previous["modules"] if m["id"] in affected]}
                def validate(value):
                    if previous:
                        if not isinstance(value, dict) or set(value) != {"modules"} or not isinstance(value["modules"], list):
                            raise ValueError("返工必须只返回受影响模块。")
                        patch = value["modules"]
                        if any(not isinstance(m, dict) for m in patch) or {m.get("id") for m in patch} != affected or len(patch) != len(affected):
                            raise ValueError("返工修改了未被拒绝的模块。")
                        changes = {m["id"]: m for m in patch}
                        if any(changes[m["id"]].get("kind") != m["kind"] for m in previous["modules"] if m["id"] in changes):
                            raise ValueError("返工不得更改模块类型。")
                        value = {"modules": [changes.get(m["id"], m) for m in previous["modules"]]}
                    return validate_guide(value, packet)
                candidate = self._call(asset, "GENERATE", GENERATOR, payload, validate)
                self._update(asset["id"], content_json=encoded(candidate), stage="REVIEW", state="IN_REVIEW", review_verdict=None)
                with self.database.connect() as c:
                    c.execute("UPDATE jobs SET job_type='TEACHING_REVIEW',status='QUEUED',updated_at=? WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                return
            candidate = validate_guide(json.loads(asset["content_json"]), packet)
            verdict = self._call(asset, "REVIEW", REVIEWER, {"source": packet, "candidate": candidate},
                                 lambda value: validate_review(value, candidate, packet))
            if verdict["verdict"] == "FAIL":
                count = asset["semantic_rework_count"] + 1
                self._update(asset["id"], semantic_rework_count=count, review_verdict="FAIL", issues_json=encoded(verdict["issues"]),
                    state="FAILED" if count == 3 else "REJECTED", terminal=int(count == 3), stage="GENERATE",
                    failure_code="SEMANTIC_EXHAUSTED" if count == 3 else None)
                if count < 3:
                    with self.database.connect() as c:
                        c.execute("UPDATE jobs SET job_type='TEACHING_GENERATE',status='QUEUED',updated_at=? WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                return
            with self.database.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                live = c.execute("SELECT state,dependencies_json FROM teaching_assets WHERE id=?", (asset["id"],)).fetchone()
                owner = c.execute("SELECT status,cancel_requested FROM jobs WHERE id=?", (job["id"],)).fetchone()
                if not live or live["state"] != "IN_REVIEW" or not owner or owner["status"] != "RUNNING" or owner["cancel_requested"]:
                    return
                if not evidence.current(c, json.loads(live["dependencies_json"])):
                    raise ValueError("导读来源已变化，未发布候选。")
                c.execute("UPDATE teaching_assets SET state='PUBLISHED',stage='COMPLETE',review_verdict='PASS',published_at=? WHERE id=?", (now(), asset["id"]))
                c.execute("INSERT INTO section_guides VALUES (?,?,?) ON CONFLICT(book_source_revision_id,section_node_id) DO UPDATE SET asset_id=excluded.asset_id", (asset["book_source_revision_id"], asset["section_node_id"], asset["id"]))
        except Exception as exc:
            code = exc.code if isinstance(exc, ProviderFailure) else "CONTRACT_OR_SOURCE_FAILURE" if isinstance(exc, ValueError) else "TECHNICAL_FAILURE"
            detail = str(exc) if isinstance(exc, ValueError) else "模型调用失败；教材及已发布导读不受影响。"
            self._update(asset["id"], state="FAILED", failure_code=code, failure_detail=detail)
