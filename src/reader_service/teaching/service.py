import json
import os
import threading
import time
from functools import cached_property
from uuid import UUID, uuid4

from reader_service.agent_runtime import ProviderFailure
from reader_service.jobs.repository import now
from . import evidence, writing_context
from .contracts import (GENERATOR, REVIEWER, draft_messages, generation_messages, encoded,
                        strict_json, validate_guide, validate_review, validate_draft)


class TeachingService:
    asset_table = "teaching_assets"
    pointer_table = "section_guides"
    draft_streaming = True

    @cached_property
    def inline(self):
        from .inline_service import InlineTeachingService
        return InlineTeachingService(self.database, self.runtime)

    def __init__(self, database, runtime):
        self.database = database
        self.runtime = runtime
        self._draft_condition = threading.Condition()
        self._drafts = {}
        self.provider = os.environ.get("GUIDED_READER_GUIDE_PROVIDER",
                                       os.environ.get("GUIDED_READER_SYSTEM_PROVIDER", "openrouter")).strip().lower()
        self.reviewer = os.environ.get("GUIDED_READER_REVIEW_PROVIDER", "zhipu").strip().lower()
        self.generator_model = os.environ.get("GUIDED_READER_GUIDE_MODEL") or (
            "openai/gpt-6-astra" if self.provider == "openrouter"
            and not os.environ.get("GUIDED_READER_OPENROUTER_MODEL") else None)

    def request(self, revision_id, section_id, intent_id, *, regenerate=False):
        try:
            UUID(intent_id)
        except (ValueError, TypeError, AttributeError):
            raise ValueError("请求标识无效。") from None
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            node = evidence.section(c, revision_id, section_id)
            old = c.execute(f"SELECT id FROM {self.asset_table} WHERE book_source_revision_id=? AND section_node_id=? AND (intent_id=? OR state IN ('DRAFT','IN_REVIEW','REJECTED'))", (revision_id, section_id, intent_id)).fetchone()
            published = c.execute(f"SELECT asset_id FROM {self.pointer_table} WHERE book_source_revision_id=? AND section_node_id=?", (revision_id, section_id)).fetchone()
            if not old and (regenerate or not published):
                asset_id, job_id = str(uuid4()), str(uuid4())
                version = c.execute(f"SELECT COALESCE(MAX(version),0)+1 FROM {self.asset_table} WHERE book_source_revision_id=? AND section_node_id=?", (revision_id, section_id)).fetchone()[0]
                foundation = c.execute("SELECT foundation_version FROM book_source_revisions WHERE id=?", (revision_id,)).fetchone()[0]
                c.execute("""INSERT INTO jobs(id,job_type,book_source_revision_id,foundation_version,
                    chapter_outline_node_id,chapter_identity_revision,chapter_physical_revision,status,priority,
                    cancel_requested,attempts,created_at,updated_at) VALUES (?,'TEACHING_GENERATE',?,?,?, ?,?,'QUEUED',4000,0,0,?,?)""",
                    (job_id, revision_id, foundation, section_id, node["identity_revision"], node["physical_revision"], now(), now()))
                c.execute(f"""INSERT INTO {self.asset_table}(id,book_source_revision_id,section_node_id,version,state,stage,intent_id,job_id,created_at)
                    VALUES (?,?,?,?,'DRAFT','GENERATE',?,?,?)""", (asset_id, revision_id, section_id, version, intent_id, job_id, now()))
        view = self.snapshot(revision_id, section_id)
        if self.draft_streaming and view["task"] and view["task"]["state"] in {"DRAFT", "REJECTED", "IN_REVIEW"}:
            self._begin_draft(view["task"]["id"])
        return view

    def retry(self, revision_id, section_id, asset_id):
        with self.database.connect() as c:
            c.execute("BEGIN IMMEDIATE")
            evidence.section(c, revision_id, section_id)
            row = c.execute(f"SELECT * FROM {self.asset_table} WHERE id=? AND book_source_revision_id=? AND section_node_id=?", (asset_id, revision_id, section_id)).fetchone()
            if row is None:
                raise LookupError("导读任务不存在。")
            if row["state"] == "FAILED" and not row["terminal"]:
                newer = c.execute(f"SELECT 1 FROM {self.asset_table} WHERE book_source_revision_id=? AND section_node_id=? AND version>?", (revision_id, section_id, row["version"])).fetchone()
                if newer:
                    raise ValueError("已有更新的导读请求，请使用最新任务。")
                c.execute(f"UPDATE {self.asset_table} SET state=?,failure_code=NULL,failure_detail=NULL WHERE id=?", ("IN_REVIEW" if row["stage"] == "REVIEW" else "DRAFT", asset_id))
                c.execute("UPDATE jobs SET status='QUEUED',cancel_requested=0,updated_at=? WHERE id=?", (now(), row["job_id"]))
        view = self.snapshot(revision_id, section_id)
        if self.draft_streaming and view["task"] and view["task"]["state"] in {"DRAFT", "REJECTED", "IN_REVIEW"}:
            candidate = self._draft_candidate(view["task"]["id"])
            self._begin_draft(view["task"]["id"], reset=True)
            if view["task"]["stage"] == "REVIEW" and candidate is not None:
                self._store_draft_candidate(view["task"]["id"], candidate)
        return view

    def _begin_draft(self, asset_id, *, reset=False):
        if not self.draft_streaming:
            return
        with self._draft_condition:
            if reset or asset_id not in self._drafts:
                previous = self._drafts.get(asset_id, {})
                self._drafts[asset_id] = {
                    "sequence": int(previous.get("sequence", -1)) + 1,
                    "stage": "preparing",
                    "text": "",
                    "reasoning": "",
                    "provider": None,
                    "candidate": None,
                    "terminal": None,
                    "detail": None,
                }
                self._draft_condition.notify_all()

    def _draft_update(self, asset_id, *, stage=None, append=None, text=None,
                      append_reasoning=None, provider=None, terminal=None, detail=None):
        if not self.draft_streaming:
            return
        with self._draft_condition:
            state = self._drafts.setdefault(asset_id, {
                "sequence": 0, "stage": "preparing", "text": "", "reasoning": "",
                "provider": None, "candidate": None, "terminal": None, "detail": None,
            })
            if stage is not None:
                state["stage"] = stage
            if append:
                state["text"] += append
            if text is not None:
                state["text"] = text
            if append_reasoning:
                state["reasoning"] += append_reasoning
            if provider is not None:
                state["provider"] = provider
            if terminal is not None:
                state["terminal"] = terminal
                if terminal in {"complete", "error"}:
                    state["text"] = ""
                    state["reasoning"] = ""
                if terminal == "complete":
                    state["candidate"] = None
            if detail is not None:
                state["detail"] = detail
            state["sequence"] += 1
            self._draft_condition.notify_all()

    def draft_event(self, revision_id, section_id, asset_id, after=-1, timeout=20.0):
        """Wait for one in-memory Guide draft update; no candidate is read from storage."""
        with self.database.connect() as c:
            row = c.execute(f"SELECT state,stage,failure_code,failure_detail FROM {self.asset_table} "
                            "WHERE id=? AND book_source_revision_id=? AND section_node_id=?",
                            (asset_id, revision_id, section_id)).fetchone()
        if row is None:
            raise LookupError("导读任务不存在。")
        if not self.draft_streaming:
            raise ValueError("该教学类型不提供草稿流。")
        with self._draft_condition:
            state = self._drafts.get(asset_id)
            if state is None:
                if row["state"] == "PUBLISHED":
                    return {"type": "complete", "sequence": 0}
                if row["state"] == "FAILED":
                    return {"type": "error", "sequence": 0,
                            "code": row["failure_code"] or "GUIDE_FAILED",
                            "error": row["failure_detail"] or "导读生成失败，可以原位重试。"}
                self._drafts[asset_id] = {
                    "sequence": 0, "stage": "preparing", "text": "", "reasoning": "",
                    "provider": None, "candidate": None, "terminal": None, "detail": None,
                }
                state = self._drafts[asset_id]
            deadline = time.monotonic() + timeout
            while state["sequence"] <= after and state["terminal"] is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return {"type": "heartbeat", "sequence": after}
                self._draft_condition.wait(remaining)
            if state["terminal"] == "complete":
                return {"type": "complete", "sequence": state["sequence"]}
            if state["terminal"] == "error":
                return {"type": "error", "sequence": state["sequence"],
                        "code": "GUIDE_FAILED", "error": state["detail"] or "导读生成失败，可以原位重试。"}
            return {"type": "draft", "sequence": state["sequence"],
                    "stage": state["stage"], "text": state["text"],
                    "reasoning": state["reasoning"], "provider": state["provider"]}

    def _draft_candidate(self, asset_id):
        with self._draft_condition:
            state = self._drafts.get(asset_id)
            return state.get("candidate") if state else None

    def _store_draft_candidate(self, asset_id, candidate):
        with self._draft_condition:
            state = self._drafts.setdefault(asset_id, {
                "sequence": 0, "stage": "preparing", "text": "", "reasoning": "",
                "provider": None, "candidate": None, "terminal": None, "detail": None,
            })
            state["candidate"] = candidate

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
            row = c.execute(f"SELECT * FROM {self.asset_table} WHERE job_id=?", (job_id,)).fetchone()
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
            c.execute(f"UPDATE {self.asset_table} SET {','.join(k+'=?' for k in values)} WHERE id=? AND terminal=0 AND state!='PUBLISHED'", (*values.values(), asset_id))

    def _record_call(self, asset_id, key, role, provider, model, completion=None):
        asset = self._asset_by_id(asset_id)
        existing = json.loads(asset[key]) if asset and asset.get(key) else {}
        calls = existing.get("calls", []) if isinstance(existing, dict) else []
        entry = {"stage": role, "provider": provider, "model": model}
        if completion is not None:
            entry.update({"effective_config": completion.effective_config,
                          "latency_ms": completion.latency_ms, "ttft_ms": completion.ttft_ms,
                          "usage": completion.usage, "response_metadata": completion.response_metadata})
        calls.append(entry)
        self._update(asset_id, **{key: encoded({"calls": calls})})

    def _record_local_binding(self, asset_id, latency_ms, candidate):
        asset = self._asset_by_id(asset_id)
        existing = json.loads(asset["generator_json"]) if asset and asset.get("generator_json") else {}
        calls = existing.get("calls", []) if isinstance(existing, dict) else []
        calls.append({"stage": "SOURCE_BINDING", "provider": "local", "model": "deterministic",
                      "latency_ms": latency_ms, "ttft_ms": 0,
                      "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                      "source_count": sum(len(module["source_ids"]) for module in candidate["modules"])})
        self._update(asset_id, generator_json=encoded({"calls": calls}))

    def _asset_by_id(self, asset_id):
        with self.database.connect() as c:
            row = c.execute(f"SELECT * FROM {self.asset_table} WHERE id=?", (asset_id,)).fetchone()
            return dict(row) if row else None

    def _packet(self, asset):
        with self.database.connect() as c:
            c.execute("BEGIN")
            deps = json.loads(asset["dependencies_json"]) if asset["dependencies_json"] else None
            if deps and not evidence.current(c, deps):
                raise ValueError("导读使用的来源已变化，请重新生成。")
            return evidence.build(c, asset["book_source_revision_id"], asset["section_node_id"],
                                  use_kp=not deps or "chapter_structure_version" in deps)

    def _call(self, asset, role, system, payload, validator):
        draft = None
        if role == "GENERATE" and "rework" not in payload:
            packet = payload["source"]
            draft = self._call(asset, "WRITE", GENERATOR, payload,
                               lambda text: validate_draft(text, packet))
            started = time.perf_counter()
            value = writing_context.bind_draft(draft, packet, payload["writing_context"])
            value = validator(value)
            self._record_local_binding(asset["id"], max(0, round((time.perf_counter() - started) * 1000)), value)
            return value
        feedback = ""
        generating = role in {"WRITE", "GENERATE"}
        selected = self.provider if generating else self.reviewer
        provider, model = self.runtime.provider_identity(selected)
        model_override = self.generator_model if generating else None
        metadata_key = "generator_json" if generating else "reviewer_json"
        for attempt in range(2):
            messages = (draft_messages(system, payload["writing_context"]) if role == "WRITE" else
                        generation_messages(system + feedback, payload) if role == "GENERATE" else
                        [{"role": "system", "content": system + feedback}, {"role": "user", "content": encoded(payload)}])
            options = {
                "interaction_id": f"guide:{asset['id']}:{role}:{asset['semantic_rework_count']}:{attempt}",
                "max_tokens": 16384 if role == "GENERATE" else 8192,
                "reasoning_effort": "low" if generating and self.provider == "openrouter" else None,
                "model": model_override,
                "timeout_seconds": 120 if generating and self.provider == "openrouter" else None,
                "json_object": selected == "openrouter" and role != "WRITE",
            }
            stream_call = getattr(self.runtime, "stream_for_with_metadata", None)
            if callable(stream_call):
                def on_delta(delta):
                    if role == "WRITE":
                        self._draft_update(asset["id"], stage="generating", append=delta,
                                           provider=selected)
                def on_reasoning_delta(delta):
                    if role == "WRITE":
                        self._draft_update(asset["id"], stage="reasoning",
                                           append_reasoning=delta, provider=selected)
                completion = stream_call(selected, messages, on_delta,
                                         on_reasoning_delta=on_reasoning_delta, **options)
            else:
                completion = self.runtime.complete_for_with_metadata(selected, messages, **options)
            self._record_call(asset["id"], metadata_key, role, provider, model_override or model, completion)
            try:
                if (completion.response_metadata or {}).get("finish_reason") == "length":
                    raise ValueError("模型输出被长度预算截断，未接受不完整导读。")
                if role == "WRITE":
                    value = validator(completion.answer)
                    self._draft_update(asset["id"], stage="generating", text=value)
                    return value
                value = strict_json(completion.answer)
                if draft is not None:
                    validate_formatted(value, draft, payload["source"])
                return validator(value)
            except ValueError as exc:
                feedback = "\n上次契约验证失败：" + str(exc) + " 请严格修正格式和来源约束。"
                if attempt:
                    raise

    def run_job(self, job):
        asset = self._asset(job["id"])
        if not asset:
            self.inline.run_job(job)
            return
        if asset["state"] in {"FAILED", "PUBLISHED"}:
            return
        try:
            self._begin_draft(asset["id"])
            packet, ledger, deps = self._packet(asset)
            previous = self._draft_candidate(asset["id"])
            if asset["stage"] == "REVIEW" and previous is None:
                # Unreviewed prose is intentionally memory-only. After a process
                # restart, restart generation instead of recovering candidate text
                # from durable storage or treating the interrupted Review as PASS.
                self._update(asset["id"], state="DRAFT", stage="GENERATE", content_json=None,
                             review_verdict=None)
                self._begin_draft(asset["id"], reset=True)
                with self.database.connect() as c:
                    c.execute("UPDATE jobs SET job_type='TEACHING_GENERATE',status='QUEUED',updated_at=? "
                              "WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                return
            with self.database.connect() as c:
                c.execute("BEGIN")
                author_context, positioning, _ = writing_context.build(
                    c, asset["book_source_revision_id"], packet, ledger)
            source_packet = writing_context.formatter_source(packet, author_context)
            if asset["stage"] == "GENERATE" and previous is None:
                known = {n["outline_node_id"] for n in deps["outline_nodes_used"]}
                deps["outline_nodes_used"].extend(n for n in positioning if n["outline_node_id"] not in known)
            if not asset["dependencies_json"]:
                self._update(asset["id"], dependencies_json=encoded(deps), sources_json=encoded(ledger))
                asset = self._asset(job["id"])
            if asset["stage"] == "GENERATE":
                payload = {"source": source_packet}
                if previous is None:
                    payload["writing_context"] = author_context
                issues = json.loads(asset["issues_json"]) if asset["issues_json"] else []
                affected = {x["module_id"] for x in issues}
                if previous:
                    affected_modules = [m for m in previous["modules"] if m["id"] in affected]
                    payload["source"] = writing_context.rework_source(source_packet, issues, affected_modules)
                    payload["rework"] = {"issues": issues, "modules": affected_modules}
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
                    return validate_guide(value, source_packet)
                candidate = self._call(asset, "GENERATE", GENERATOR, payload, validate)
                self._store_draft_candidate(asset["id"], candidate)
                self._draft_update(asset["id"], stage="review",
                                   text="\n\n".join(m["text"] for m in candidate["modules"]))
                self._update(asset["id"], content_json=None, stage="REVIEW", state="IN_REVIEW", review_verdict=None)
                with self.database.connect() as c:
                    c.execute("UPDATE jobs SET job_type='TEACHING_REVIEW',status='QUEUED',updated_at=? WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                return
            candidate = validate_guide(previous, source_packet)
            review_packet = writing_context.review_source(source_packet, candidate)
            self._draft_update(asset["id"], stage="review",
                               text="\n\n".join(m["text"] for m in candidate["modules"]))
            verdict = self._call(asset, "REVIEW", REVIEWER, {"source": review_packet, "candidate": candidate},
                                 lambda value: validate_review(value, candidate, review_packet))
            if verdict["verdict"] == "FAIL":
                count = asset["semantic_rework_count"] + 1
                self._update(asset["id"], semantic_rework_count=count, review_verdict="FAIL", issues_json=encoded(verdict["issues"]),
                    state="FAILED" if count == 3 else "REJECTED", terminal=int(count == 3), stage="GENERATE",
                    failure_code="SEMANTIC_EXHAUSTED" if count == 3 else None)
                if count < 3:
                    self._draft_update(asset["id"], stage="revising")
                    with self.database.connect() as c:
                        c.execute("UPDATE jobs SET job_type='TEACHING_GENERATE',status='QUEUED',updated_at=? WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                else:
                    self._store_draft_candidate(asset["id"], None)
                    self._draft_update(asset["id"], terminal="error", detail="导读未通过独立审查，可以重新生成。")
                return
            with self.database.connect() as c:
                c.execute("BEGIN IMMEDIATE")
                live = c.execute("SELECT state,dependencies_json FROM teaching_assets WHERE id=?", (asset["id"],)).fetchone()
                owner = c.execute("SELECT status,cancel_requested FROM jobs WHERE id=?", (job["id"],)).fetchone()
                if not live or live["state"] != "IN_REVIEW" or not owner or owner["status"] != "RUNNING" or owner["cancel_requested"]:
                    return
                if not evidence.current(c, json.loads(live["dependencies_json"])):
                    raise ValueError("导读来源已变化，未发布候选。")
                c.execute("UPDATE teaching_assets SET state='PUBLISHED',stage='COMPLETE',content_json=?,review_verdict='PASS',published_at=? WHERE id=?",
                          (encoded(candidate), now(), asset["id"]))
                c.execute("INSERT INTO section_guides VALUES (?,?,?) ON CONFLICT(book_source_revision_id,section_node_id) DO UPDATE SET asset_id=excluded.asset_id", (asset["book_source_revision_id"], asset["section_node_id"], asset["id"]))
            self._draft_update(asset["id"], terminal="complete")
        except Exception as exc:
            code = exc.code if isinstance(exc, ProviderFailure) else "CONTRACT_OR_SOURCE_FAILURE" if isinstance(exc, ValueError) else "TECHNICAL_FAILURE"
            detail = str(exc) if isinstance(exc, ValueError) else "模型调用失败；教材及已发布导读不受影响。"
            self._update(asset["id"], state="FAILED", failure_code=code, failure_detail=detail)
            self._draft_update(asset["id"], terminal="error", detail=detail)
