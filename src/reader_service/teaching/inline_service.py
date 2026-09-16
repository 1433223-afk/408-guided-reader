import json
import os

from reader_service.agent_runtime import ProviderFailure
from reader_service.jobs.repository import now
from . import evidence, inline_evidence as sources, inline_contracts as contract
from .contracts import encoded, strict_json
from .service import TeachingService


class InlineTeachingService(TeachingService):
    asset_table = "inline_teaching_assets"
    pointer_table = "section_inline_teaching"
    draft_streaming = False

    def __init__(self, database, runtime):
        super().__init__(database, runtime)
        # Guide may use its own latency-tuned provider; Inline Teaching keeps the
        # established System provider and model routing.
        self.provider = os.environ.get("GUIDED_READER_SYSTEM_PROVIDER", "openrouter").strip().lower()
        self.generator_model = os.environ.get("GUIDED_READER_INLINE_MODEL") or (
            "google/gemini-3.8-flash" if self.provider == "openrouter" else None)
        self.reviewer = os.environ.get("GUIDED_READER_REVIEW_PROVIDER", "openrouter").strip().lower()
        self.reviewer_model = "google/gemini-3.8-flash" if self.reviewer == "openrouter" else None
        if getattr(runtime, "beta_guard", None):
            self.provider = self.reviewer = "deepseek"
            self.generator_model = self.reviewer_model = "deepseek-flash"

    def request(self, revision_id, section_id, intent_id, *, regenerate=False):
        with self.database.connect() as c:
            c.execute("BEGIN")
            node = evidence.section(c, revision_id, section_id)
            if node["resolution_state"] != "RESOLVED":
                raise ValueError("本节范围尚未确定，不能生成行间教学；PDF 阅读不受影响。")
        return super().request(revision_id, section_id, intent_id, regenerate=regenerate)

    def snapshot(self, revision_id, section_id):
        with self.database.connect() as c:
            c.execute("BEGIN")
            node = evidence.section(c, revision_id, section_id)
            row = c.execute("""SELECT a.* FROM section_inline_teaching p JOIN inline_teaching_assets a
                ON a.id=p.asset_id AND a.book_source_revision_id=p.book_source_revision_id
                AND a.section_node_id=p.section_node_id WHERE p.book_source_revision_id=?
                AND p.section_node_id=? AND a.state='PUBLISHED' AND a.review_verdict='PASS'""", (revision_id, section_id)).fetchone()
            published = None
            if row:
                deps, ledger = json.loads(row["dependencies_json"]), json.loads(row["sources_json"])
                candidate = json.loads(row["content_json"])
                visible, anchors, omitted = [], {}, 0
                for item in candidate["items"]:
                    anchor = ledger[item["target_id"]]
                    if not sources.available(c, anchor):
                        omitted += 1
                        continue
                    visible.append(item)
                    for sid in set(item["source_ids"] + [item["target_id"]]):
                        anchors[sid] = {**ledger[sid], "available": sources.available(c, ledger[sid])}
                published = {"id": row["id"], "version": row["version"], "content": {"items": visible},
                    "sources": anchors, "stale": not sources.current(c, deps), "omitted_count": omitted,
                    "no_intervention": not candidate["items"], "published_at": row["published_at"]}
            latest = c.execute("""SELECT id,version,state,stage,semantic_rework_count,terminal,failure_code,failure_detail
                FROM inline_teaching_assets WHERE book_source_revision_id=? AND section_node_id=?
                ORDER BY version DESC LIMIT 1""", (revision_id, section_id)).fetchone()
            return {"section": {"id": section_id, "title": node["title"]}, "published": published,
                    "task": dict(latest) if latest else None}

    def selection_context(self, revision_id, section_id, asset_id, item_id, field, start, end):
        from reader_service.assistant.context import ScopeResolution
        view = self.snapshot(revision_id, section_id)
        published = view["published"]
        if not published or published["id"] != asset_id:
            raise ValueError("只能解释当前已发布且可定位的行间教学。")
        item = next((i for i in published["content"]["items"] if i["id"] == item_id), None)
        if not item or field not in {"text", "prompt", "reference_thought"}:
            raise ValueError("教学选区无效。")
        text = item[field]
        if not isinstance(text, str) or type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
            raise ValueError("教学选区无效。")
        anchor = published["sources"][item["target_id"]]
        return {"scope": ScopeResolution(f"SECTION:{section_id}", "SECTION", anchor["pdf_page_index"], section_id, view["section"]["title"]),
            "selected_text": text[start:end], "source_anchor": {},
            "same_page_ocr_context": "所选来自已独立审查的 AI 行间教学，不是教材引文。证据：\n" + "\n".join(published["sources"][sid]["quote"] for sid in item["source_ids"])[:1600],
            "teaching_lineage": {"asset_id": asset_id, "item_id": item_id, "field": field, "version": published["version"], "section_id": section_id},
            "printed_page_label": None, "foundation_version": anchor["foundation_version"]}

    def _packet(self, asset):
        with self.database.connect() as c:
            c.execute("BEGIN")
            if asset["dependencies_json"] and not sources.current(c, json.loads(asset["dependencies_json"])):
                raise ValueError("行间教学来源已变化，请重新生成。")
            return sources.build(c, asset["book_source_revision_id"], asset["section_node_id"])

    def _call(self, asset, role, system, payload, validator):
        generating = role == "GENERATE"
        selected = self.provider if generating else self.reviewer
        provider, model = self.runtime.provider_identity(selected)
        metadata_key = "generator_json" if generating else "reviewer_json"
        self._update(asset["id"], **{metadata_key: encoded({"provider": provider,
            "model": (self.generator_model if generating else self.reviewer_model) or model, "stage": role})})
        feedback = ""
        for attempt in range(2):
            completion = self.runtime.complete_for_with_metadata(selected,
                [{"role": "system", "content": system + feedback}, {"role": "user", "content": encoded(payload)}],
                interaction_id=f"inline:{asset['id']}:{role}:{asset['semantic_rework_count']}:{attempt}",
                max_tokens=8192, model=self.generator_model if generating else self.reviewer_model,
                json_object=selected == "openrouter",
                reasoning_effort="low" if generating and selected == "openrouter" else None,
                timeout_seconds=120 if generating and selected == "openrouter" else None)
            self._update(asset["id"], **{metadata_key: encoded({
                "effective_config": completion.effective_config, "latency_ms": completion.latency_ms,
                "usage": completion.usage, "response_metadata": completion.response_metadata})})
            try:
                if (completion.response_metadata or {}).get("finish_reason") == "length":
                    raise ValueError("输出被截断，未接受不完整教学。")
                return validator(strict_json(completion.answer))
            except ValueError as exc:
                feedback = "\n上次格式或来源验证失败：" + str(exc)
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
                if asset["content_json"]:
                    payload["rework"] = {"candidate": json.loads(asset["content_json"]), "issues": json.loads(asset["issues_json"])}
                candidate = self._call(asset, "GENERATE", contract.GENERATOR, payload, lambda v: contract.validate(v, packet))
                self._update(asset["id"], content_json=encoded(candidate), stage="REVIEW", state="IN_REVIEW", review_verdict=None)
                with self.database.connect() as c:
                    c.execute("UPDATE jobs SET job_type='TEACHING_REVIEW',status='QUEUED',updated_at=? WHERE id=? AND status='RUNNING'", (now(), job["id"]))
                return
            candidate = contract.validate(json.loads(asset["content_json"]), packet)
            verdict = self._call(asset, "REVIEW", contract.REVIEWER, {"source": packet, "candidate": candidate}, lambda v: contract.review(v, candidate, packet))
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
                live = c.execute("SELECT state,dependencies_json,sources_json FROM inline_teaching_assets WHERE id=?", (asset["id"],)).fetchone()
                owner = c.execute("SELECT status,cancel_requested FROM jobs WHERE id=?", (job["id"],)).fetchone()
                if not live or live["state"] != "IN_REVIEW" or not owner or owner["status"] != "RUNNING" or owner["cancel_requested"]:
                    return
                if not sources.current(c, json.loads(live["dependencies_json"])) or any(not sources.available(c, json.loads(live["sources_json"])[i["target_id"]]) for i in candidate["items"]):
                    raise ValueError("来源已变化或无法可靠定位，未发布候选。")
                c.execute("UPDATE inline_teaching_assets SET state='PUBLISHED',stage='COMPLETE',review_verdict='PASS',published_at=? WHERE id=?", (now(), asset["id"]))
                c.execute("INSERT INTO section_inline_teaching VALUES (?,?,?) ON CONFLICT(book_source_revision_id,section_node_id) DO UPDATE SET asset_id=excluded.asset_id", (asset["book_source_revision_id"], asset["section_node_id"], asset["id"]))
        except Exception as exc:
            code = exc.code if isinstance(exc, ProviderFailure) else "CONTRACT_OR_SOURCE_FAILURE" if isinstance(exc, ValueError) else "TECHNICAL_FAILURE"
            self._update(asset["id"], state="FAILED", failure_code=code, failure_detail=str(exc) if isinstance(exc, ValueError) else "模型调用失败；原 PDF 和已发布教学仍可使用。")
