from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from reader_service.foundation import FoundationService
from reader_service.library import LibraryService

from .repository import JobRepository

if TYPE_CHECKING:
    from reader_service.knowledge import KnowledgeService
    from reader_service.outline import OutlineService


class PreparationCoordinator:
    def __init__(
        self,
        library: LibraryService,
        foundation: FoundationService,
        jobs: JobRepository,
        worker_count: int = 1,
        outline: "OutlineService | None" = None,
        knowledge: "KnowledgeService | None" = None,
        teaching=None,
    ):
        if worker_count < 1 or worker_count > 4:
            raise ValueError("Worker count must be between 1 and 4")
        self.library = library
        self.foundation = foundation
        self.jobs = jobs
        self.worker_count = worker_count
        self.outline = outline
        self.knowledge = knowledge
        self.teaching = teaching
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._dispatch_lock = threading.Lock()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if self._threads:
            return
        self.foundation.repository.reset_interrupted_pages()
        self.jobs.recover()
        if self.knowledge is not None:
            self.knowledge.repository.recover_preparing_jobs()
        for index in range(self.worker_count):
            thread = threading.Thread(
                target=self._run,
                name=f"page-prepare-{index + 1}",
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        for thread in self._threads:
            thread.join(timeout=timeout)
        self._threads.clear()

    def schedule_revision(
        self, revision_id: str, visible_pages: set[int] | None = None, current_page: int = 0
    ) -> None:
        revision = self.foundation.ensure_revision(revision_id)
        # Keep the worker from claiming a newly enqueued row between enqueue and
        # the priority update. This is process-local scheduling coordination, not
        # a second persistence authority.
        with self._dispatch_lock:
            self.jobs.cancel_other_revisions(revision_id)
            if any(p["status"] != "READY" for p in self.foundation.statuses(revision_id)):
                self.jobs.enqueue_pages(
                    revision_id, revision["page_count"], revision["foundation_version"]
                )
                self.jobs.complete_already_ready_pages(revision_id, 0, revision["page_count"])
            self.jobs.prioritize(revision_id, visible_pages or {current_page}, current_page)
        # Viewport scheduling must never wait for Outline evidence scanning.
        self._wake.set()

    def cancel_revision(self, revision_id: str) -> None:
        self.jobs.cancel_revision(revision_id)
        self._wake.set()

    def cancel_book(self, book_id: str) -> None:
        self.jobs.cancel_book(book_id)
        self._wake.set()

    def retry_page(self, revision_id: str, page_index: int) -> bool:
        revision = self.foundation.ensure_revision(revision_id)
        if page_index < 0 or page_index >= revision["page_count"]:
            raise ValueError("Page index is outside this PDF")
        if self.foundation.repository.page_status(revision_id, page_index) != "FAILED":
            return False
        requeued = self.jobs.requeue_page(
            revision_id, page_index, revision["foundation_version"]
        )
        if not requeued:
            return False
        self._wake.set()
        return True

    def schedule_chapter(self, revision_id: str, chapter_id: str) -> tuple[dict, bool]:
        if self.knowledge is None:
            raise RuntimeError("Chapter Knowledge preparation is unavailable")
        revision = self.foundation.ensure_revision(revision_id)
        page_start, page_end = self.knowledge.required_page_range(revision_id, chapter_id)
        with self._dispatch_lock:
            self.jobs.enqueue_page_range(
                revision_id, page_start, page_end, revision["foundation_version"]
            )
            self.jobs.complete_already_ready_pages(revision_id, page_start, page_end)
            self.jobs.prioritize_range(revision_id, page_start, page_end)
            result = self.knowledge.request_prepare(revision_id, chapter_id)
        self._wake.set()
        return result

    def schedule_chapter_regeneration(
        self, revision_id: str, chapter_id: str
    ) -> tuple[dict, bool]:
        if self.knowledge is None:
            raise RuntimeError("Chapter Knowledge preparation is unavailable")
        revision = self.foundation.ensure_revision(revision_id)
        page_start, page_end = self.knowledge.required_page_range(revision_id, chapter_id)
        with self._dispatch_lock:
            result = self.knowledge.request_regenerate(revision_id, chapter_id)
            if result[1]:
                self.jobs.enqueue_page_range(
                    revision_id, page_start, page_end, revision["foundation_version"]
                )
                self.jobs.complete_already_ready_pages(revision_id, page_start, page_end)
                self.jobs.prioritize_range(revision_id, page_start, page_end)
        self._wake.set()
        return result

    def _run(self) -> None:
        while not self._stop.is_set():
            with self._dispatch_lock:
                job = self.jobs.claim()
            if job is None:
                self._wake.wait(0.25)
                self._wake.clear()
                continue
            if job["job_type"] in {"TEACHING_GENERATE", "TEACHING_REVIEW"}:
                if self.teaching is not None:
                    self.teaching.run_job(job)
                self.jobs.complete(job["id"])
                continue
            if job["job_type"] == "CHAPTER_PREPARE":
                if self.knowledge is not None:
                    self.knowledge.run_job(job)
                self.jobs.complete(job["id"], cancelled=self._stop.is_set())
                continue
            cancelled = False
            for page_index in range(job["page_start"], job["page_end"] + 1):
                if self._stop.is_set() or self.jobs.cancellation_requested(job["id"]):
                    cancelled = True
                    break
                was_ready = self.foundation.repository.page_status(job["book_source_revision_id"], page_index) == "READY"
                status = self.foundation.prepare_page(job["book_source_revision_id"], page_index)
                if not was_ready and status == "READY" and (
                    page_index < 20 or page_index % 16 == 15
                ):
                    self._refresh_map(job["book_source_revision_id"])
            self.jobs.complete(job["id"], cancelled=cancelled)

    def _refresh_map(self, revision_id: str) -> None:
        if self.outline is None:
            return
        try:
            self.outline.bootstrap(revision_id)
        except Exception as exc:
            # Mapping is an optional capability. PDF/OCR publication remains valid and
            # a later API/bootstrap attempt can retry; never expose source text or paths.
            print(f"Map bootstrap failed for revision {revision_id}: {type(exc).__name__}")
