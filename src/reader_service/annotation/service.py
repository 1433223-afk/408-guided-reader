from __future__ import annotations

import copy

from reader_service.foundation import FoundationService

from .repository import AnnotationRepository


class AnnotationService:
    MAX_NOTE_LENGTH = 1000
    MAX_AI_CONTENT_LENGTH = 100_000
    HIGHLIGHT_STYLES = frozenset({"YELLOW", "GREEN", "BLUE", "NONE"})
    VERIFICATION_STATES = frozenset({"PENDING", "PASS", "FAIL", "TECHNICAL_FAILURE"})

    def __init__(self, foundation: FoundationService, repository: AnnotationRepository):
        self.foundation = foundation
        self.repository = repository

    def create_text(
        self,
        revision_id: str,
        *,
        page_index: int,
        start: dict,
        end: dict,
        body: str | None = None,
        highlight_style: str = "YELLOW",
    ) -> dict:
        clean_body = self._clean_body(body)
        clean_highlight_style = self._clean_highlight_style(highlight_style)
        anchor = self.foundation.resolve_text_selection(
            revision_id,
            page_index,
            start=start,
            end=end,
        )
        return self.repository.create(
            revision_id=revision_id,
            page_index=page_index,
            quads=anchor["quads"],
            quote=anchor["quote"],
            context_before=anchor["context_before"],
            context_after=anchor["context_after"],
            foundation_version=anchor["foundation_version"],
            body=clean_body,
            highlight_style=clean_highlight_style,
        )

    def list_page(self, revision_id: str, page_index: int) -> list[dict]:
        revision = self.foundation.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        return self.repository.list_page(revision_id, page_index)

    def get(self, revision_id: str, annotation_id: str) -> dict:
        self.foundation.ensure_revision(revision_id)
        return self.repository.get(annotation_id, revision_id)

    def find_by_save_intent(
        self, revision_id: str, save_intent_id: str
    ) -> dict | None:
        self.foundation.ensure_revision(revision_id)
        return self.repository.find_by_save_intent(
            self._clean_save_intent_id(save_intent_id), revision_id
        )

    def create_ai_saved(
        self, revision_id: str, *, save_intent_id: str, projection: dict
    ) -> tuple[dict, bool]:
        revision = self.foundation.ensure_revision(revision_id)
        if projection.get("revision_id") != revision_id:
            raise ValueError("Saved explanation source revision does not match the request")
        page_index = projection.get("pdf_page_index")
        if not isinstance(page_index, int) or isinstance(page_index, bool):
            raise ValueError("Saved explanation PDF page is invalid")
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Saved explanation PDF page is outside this source revision")
        ai_content = projection.get("ai_content")
        if not isinstance(ai_content, str) or not ai_content.strip():
            raise ValueError("Only a completed Assistant answer can be saved")
        if len(ai_content) > self.MAX_AI_CONTENT_LENGTH:
            raise ValueError(
                "Assistant answer is too large to save completely; nothing was saved"
            )
        source = projection.get("source")
        provenance = projection.get("provenance")
        source_grounding = projection.get("source_grounding")
        if not isinstance(source, dict):
            raise ValueError("Saved explanation SOURCE is invalid")
        self._validate_provenance(provenance)
        self._validate_source_grounding(source_grounding)
        required_source = {
            "quads", "quote", "context_before", "context_after", "foundation_version"
        }
        if set(source) != required_source or not isinstance(source["quote"], str) \
                or not source["quote"]:
            raise ValueError("Saved explanation SOURCE is incomplete")
        return self.repository.create_ai_saved(
            revision_id=revision_id,
            page_index=page_index,
            quads=copy.deepcopy(source["quads"]),
            quote=source["quote"],
            context_before=source["context_before"],
            context_after=source["context_after"],
            foundation_version=source["foundation_version"],
            ai_content=ai_content,
            save_intent_id=self._clean_save_intent_id(save_intent_id),
            provenance=copy.deepcopy(provenance),
            source_grounding=copy.deepcopy(source_grounding),
        )

    def update_verification(
        self,
        revision_id: str,
        annotation_id: str,
        *,
        state: str,
        provider: str | None = None,
        model: str | None = None,
        failure_kind: str | None = None,
        code: str | None = None,
        summary: str | None = None,
    ) -> dict | None:
        if state not in self.VERIFICATION_STATES - {"PENDING"}:
            raise ValueError("Verification result state is invalid")
        if summary is not None:
            if not isinstance(summary, str):
                raise ValueError("Verification summary must be text")
            summary = summary.strip()
            if len(summary) > 1000:
                raise ValueError("Verification summary must be at most 1000 characters")
        return self.repository.update_verification(
            annotation_id,
            revision_id,
            state=state,
            provider=provider,
            model=model,
            failure_kind=failure_kind,
            code=code,
            summary=summary or None,
        )

    def mark_review_pending(self, revision_id: str, annotation_id: str) -> dict:
        self.foundation.ensure_revision(revision_id)
        return self.repository.mark_review_pending(annotation_id, revision_id)

    def recover_interrupted_reviews(self) -> int:
        return self.repository.recover_interrupted_reviews()

    def delete(self, revision_id: str, annotation_id: str) -> None:
        self.foundation.ensure_revision(revision_id)
        if not self.repository.delete(annotation_id, revision_id):
            raise LookupError("Annotation not found")

    @staticmethod
    def _clean_save_intent_id(value: str) -> str:
        if (
            not isinstance(value, str)
            or not 8 <= len(value) <= 128
            or any(character.isspace() for character in value)
        ):
            raise ValueError("Save intent id is invalid")
        return value

    @staticmethod
    def _validate_provenance(value: object) -> None:
        expected = {"root_focus", "child_focus", "concept_path", "answer_question"}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("Saved explanation PROVENANCE is invalid")
        if not isinstance(value["root_focus"], str) or not value["root_focus"].strip():
            raise ValueError("Saved explanation Root provenance is missing")
        if value["child_focus"] is not None and (
            not isinstance(value["child_focus"], str) or not value["child_focus"].strip()
        ):
            raise ValueError("Saved explanation Child provenance is invalid")
        if (
            not isinstance(value["answer_question"], str)
            or not value["answer_question"].strip()
            or not isinstance(value["concept_path"], list)
            or not value["concept_path"]
            or any(not isinstance(item, str) or not item.strip() for item in value["concept_path"])
        ):
            raise ValueError("Saved explanation concept path is invalid")

    @staticmethod
    def _validate_source_grounding(value: object) -> None:
        expected = {
            "pdf_page_number", "printed_page_label", "chapter_title",
            "section_title", "bounded_same_page_ocr",
        }
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("Saved explanation Reader grounding is invalid")
        if not isinstance(value["pdf_page_number"], int) or value["pdf_page_number"] < 1:
            raise ValueError("Saved explanation Reader page is invalid")
        if not isinstance(value["bounded_same_page_ocr"], str):
            raise ValueError("Saved explanation Reader context is invalid")

    @classmethod
    def _clean_body(cls, body: str | None) -> str | None:
        if body is None:
            return None
        if not isinstance(body, str):
            raise ValueError("Note body must be text")
        value = body.strip()
        if not value:
            return None
        if len(value) > cls.MAX_NOTE_LENGTH:
            raise ValueError(f"Note body must be at most {cls.MAX_NOTE_LENGTH} characters")
        return value

    @classmethod
    def _clean_highlight_style(cls, highlight_style: str) -> str:
        if not isinstance(highlight_style, str):
            raise ValueError("Highlight style must be text")
        value = highlight_style.strip().upper()
        if value not in cls.HIGHLIGHT_STYLES:
            allowed = ", ".join(sorted(cls.HIGHLIGHT_STYLES))
            raise ValueError(f"Highlight style must be one of: {allowed}")
        return value
