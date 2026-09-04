from __future__ import annotations

from reader_service.foundation import FoundationService

from .repository import AnnotationRepository


class AnnotationService:
    MAX_NOTE_LENGTH = 1000

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
    ) -> dict:
        clean_body = self._clean_body(body)
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
        )

    def list_page(self, revision_id: str, page_index: int) -> list[dict]:
        revision = self.foundation.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        return self.repository.list_page(revision_id, page_index)

    def delete(self, revision_id: str, annotation_id: str) -> None:
        self.foundation.ensure_revision(revision_id)
        if not self.repository.delete(annotation_id, revision_id):
            raise LookupError("Annotation not found")

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
