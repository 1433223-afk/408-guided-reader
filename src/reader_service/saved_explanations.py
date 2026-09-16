from __future__ import annotations

import json
import os
import threading
from reader_service.disk import DiskSpaceError
import time
from dataclasses import dataclass

from reader_service.agent_runtime import (
    ProviderCompletion,
    ProviderFailure,
    ProviderFailureKind,
    ProviderRuntimeSet,
)
from reader_service.annotation import AnnotationService
from reader_service.assistant import AssistantService


REVIEW_SYSTEM_MESSAGE = """你是独立的 AI 审查者，只判断一条已保存解释是否被给定教材依据支持。
Original PDF 教材来源始终是阅读权威；AI 解释可以补充通识或专业知识，但不得冒充教材原文。
PASS 仅表示本次有界 AI 审查未发现阻断问题，不是真理证明、教材权威或学习掌握证据。
不得改写正文，不得推断或写入 Mastery、Progress、Learning History、Master、Knowledge 或 Teaching。
只返回一个 JSON 对象，且只能含两个字段：
{"verdict":"PASS 或 FAIL","summary":"不超过 1000 字的简体中文理由"}
不要返回 Markdown 代码围栏或其他文字。"""

MAX_STRUCTURED_ATTEMPTS = 2


class SavedExplanationError(Exception):
    def __init__(self, code: str, user_message: str):
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message


@dataclass(frozen=True, slots=True)
class ReviewVerdict:
    verdict: str
    summary: str


class SavedExplanationService:
    """Commit-first bridge from temporary Assistant state to durable Annotation."""

    def __init__(
        self,
        assistant: AssistantService,
        annotations: AnnotationService,
        runtime: ProviderRuntimeSet,
        *,
        review_provider: str | None = None,
    ):
        self.assistant = assistant
        self.annotations = annotations
        self.runtime = runtime
        self.review_provider = (
            review_provider
            or os.environ.get("GUIDED_READER_REVIEW_PROVIDER", "zhipu")
        ).strip().lower()
        if getattr(runtime, "beta_guard", None):
            self.review_provider = "deepseek"
        self._inflight: set[tuple[str, str]] = set()
        self._condition = threading.Condition()
        self.annotations.recover_interrupted_reviews()

    def save(
        self,
        revision_id: str,
        *,
        reader_session_id: str,
        root_id: str,
        node_id: str | None,
        turn_id: str,
        save_intent_id: str,
    ) -> dict:
        existing = self.annotations.find_by_save_intent(revision_id, save_intent_id)
        if existing is not None:
            scheduled = (
                self._schedule_review(revision_id, existing["id"])
                if existing["verification_state"] == "PENDING"
                else False
            )
            return {"annotation": existing, "created": False, "review_scheduled": scheduled}

        projection = self.assistant.completed_turn_projection(
            reader_session_id,
            root_id,
            turn_id,
            node_id=node_id,
        )
        annotation, created = self.annotations.create_ai_saved(
            revision_id,
            save_intent_id=save_intent_id,
            projection=projection,
        )
        scheduled = self._schedule_review(revision_id, annotation["id"])
        return {
            "annotation": annotation,
            "created": created,
            "review_scheduled": scheduled,
        }

    def retry_review(self, revision_id: str, annotation_id: str) -> dict:
        annotation = self.annotations.get(revision_id, annotation_id)
        if annotation["source_kind"] != "AI_SAVED":
            raise SavedExplanationError(
                "REVIEW_NOT_APPLICABLE", "只有 AI 保存的解释需要这项审查。"
            )
        if annotation["verification_state"] not in {"PENDING", "TECHNICAL_FAILURE"}:
            raise SavedExplanationError(
                "REVIEW_NOT_RETRYABLE", "这条解释当前不需要技术重试。"
            )
        if annotation["verification_state"] == "TECHNICAL_FAILURE":
            annotation = self.annotations.mark_review_pending(
                revision_id, annotation_id
            )
        scheduled = self._schedule_review(revision_id, annotation_id)
        return {"annotation": annotation, "review_scheduled": scheduled}

    def wait_for_idle(self, timeout: float = 5.0) -> bool:
        deadline = time.monotonic() + timeout
        with self._condition:
            while self._inflight:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return True

    def _schedule_review(self, revision_id: str, annotation_id: str) -> bool:
        key = (revision_id, annotation_id)
        with self._condition:
            if key in self._inflight:
                return False
            if getattr(self.runtime, "beta_guard", None) and len(self._inflight) >= 8:
                # The note is already durable; leave its verification retryable.
                self.annotations.update_verification(
                    revision_id, annotation_id, state="TECHNICAL_FAILURE",
                    summary="AI 正忙，请稍后重试；笔记已保存。", code="ai_busy", failure_kind="TRANSIENT")
                return False
            self._inflight.add(key)
        thread = threading.Thread(
            target=self._run_review,
            args=(revision_id, annotation_id),
            name=f"saved-explanation-review-{annotation_id[:8]}",
            daemon=True,
        )
        try:
            thread.start()
        except RuntimeError:
            with self._condition:
                self._inflight.discard(key)
                self._condition.notify_all()
            self.annotations.update_verification(
                revision_id,
                annotation_id,
                state="TECHNICAL_FAILURE",
                failure_kind=ProviderFailureKind.TRANSIENT.value,
                code="review_schedule_failure",
                summary="AI 审查未能启动；已保存内容不受影响，可重试。",
            )
            return False
        return True

    def _run_review(self, revision_id: str, annotation_id: str) -> None:
        key = (revision_id, annotation_id)
        try:
            try:
                annotation = self.annotations.get(revision_id, annotation_id)
            except LookupError:
                return
            if annotation["source_kind"] != "AI_SAVED" or annotation[
                "verification_state"
            ] not in {"PENDING", "TECHNICAL_FAILURE"}:
                return
            self._review_annotation(annotation)
        except DiskSpaceError:
            self.annotations.update_verification(
                revision_id, annotation_id, state="TECHNICAL_FAILURE",
                failure_kind="TRANSIENT", code="disk_space",
                summary="空间不足，笔记已保留；请联系管理员后重试审查。")
        finally:
            with self._condition:
                self._inflight.discard(key)
                self._condition.notify_all()

    def _review_annotation(self, annotation: dict) -> None:
        interaction_id = f"review:{annotation['id']}"
        completion: ProviderCompletion | None = None
        for attempt in range(1, MAX_STRUCTURED_ATTEMPTS + 1):
            messages = self._review_messages(
                annotation,
                invalid_feedback=attempt > 1,
            )
            try:
                completion = self.runtime.complete_for_with_metadata(
                    self.review_provider,
                    messages,
                    interaction_id=interaction_id,
                )
            except ProviderFailure as failure:
                provider, model = self._attempted_identity(interaction_id)
                self.annotations.update_verification(
                    annotation["book_source_revision_id"],
                    annotation["id"],
                    state="TECHNICAL_FAILURE",
                    provider=provider,
                    model=model,
                    failure_kind=failure.kind.value,
                    code=failure.code,
                    summary=failure.user_message,
                )
                return
            except Exception:
                provider, model = self._attempted_identity(interaction_id)
                self.annotations.update_verification(
                    annotation["book_source_revision_id"],
                    annotation["id"],
                    state="TECHNICAL_FAILURE",
                    provider=provider,
                    model=model,
                    failure_kind=ProviderFailureKind.TRANSIENT.value,
                    code="review_runtime_failure",
                    summary="AI 审查出现内部技术失败；已保存内容不受影响，可重试。",
                )
                return
            try:
                verdict = self._validate_verdict(completion.answer)
            except ValueError:
                if attempt < MAX_STRUCTURED_ATTEMPTS:
                    continue
                provider, model = self._completion_identity(completion)
                self.annotations.update_verification(
                    annotation["book_source_revision_id"],
                    annotation["id"],
                    state="TECHNICAL_FAILURE",
                    provider=provider,
                    model=model,
                    failure_kind="INVALID_STRUCTURED_VERDICT",
                    code="invalid_review_verdict",
                    summary="AI 审查连续返回无效结构；已保存内容不受影响，可重试。",
                )
                return
            provider, model = self._completion_identity(completion)
            self.annotations.update_verification(
                annotation["book_source_revision_id"],
                annotation["id"],
                state=verdict.verdict,
                provider=provider,
                model=model,
                failure_kind=None,
                code=None,
                summary=verdict.summary,
            )
            return

    @staticmethod
    def _review_messages(annotation: dict, *, invalid_feedback: bool) -> list[dict]:
        provenance = annotation["provenance"]
        grounding = annotation["source_grounding"]
        candidate = {
            "source": {
                "pdf_page_number": grounding["pdf_page_number"],
                "printed_page_label": grounding["printed_page_label"],
                "chapter_title": grounding["chapter_title"],
                "section_title": grounding["section_title"],
                "quote": annotation["quote"],
                "context_before": annotation["context_before"],
                "context_after": annotation["context_after"],
                "bounded_same_page_ocr": grounding["bounded_same_page_ocr"],
            },
            "provenance": {
                "root_focus": provenance["root_focus"],
                "child_focus": provenance["child_focus"],
                "concept_path": list(provenance["concept_path"]),
                "answer_question": provenance["answer_question"],
            },
            "ai_content": annotation["body"],
        }
        system = REVIEW_SYSTEM_MESSAGE
        if invalid_feedback:
            system += "\n上一次输出未通过结构校验；请严格按同一 JSON schema 重试。"
        return [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": json.dumps(candidate, ensure_ascii=False, separators=(",", ":")),
            },
        ]

    @staticmethod
    def _validate_verdict(answer: str) -> ReviewVerdict:
        try:
            value = json.loads(answer)
        except (TypeError, ValueError):
            raise ValueError("Review verdict is not JSON") from None
        if not isinstance(value, dict) or set(value) != {"verdict", "summary"}:
            raise ValueError("Review verdict fields are invalid")
        verdict = value["verdict"]
        summary = value["summary"]
        if verdict not in {"PASS", "FAIL"}:
            raise ValueError("Review verdict value is invalid")
        if not isinstance(summary, str) or not summary.strip() or len(summary.strip()) > 1000:
            raise ValueError("Review summary is invalid")
        return ReviewVerdict(verdict, summary.strip())

    @staticmethod
    def _completion_identity(completion: ProviderCompletion) -> tuple[str | None, str | None]:
        config = completion.effective_config or {}
        return config.get("provider"), config.get("model")

    def _attempted_identity(self, interaction_id: str) -> tuple[str | None, str | None]:
        inspector = getattr(self.runtime, "inspector", None)
        if inspector is None:
            return None, None
        calls = inspector.snapshot()
        attempted = next(
            (item for item in reversed(calls) if item.get("interaction_id") == interaction_id),
            None,
        )
        if attempted is None:
            return None, None
        provider = attempted.get("provider")
        try:
            _, model = self.runtime.provider_identity(provider)
        except ProviderFailure:
            model = None
        return provider, model


__all__ = ["ReviewVerdict", "SavedExplanationError", "SavedExplanationService"]
