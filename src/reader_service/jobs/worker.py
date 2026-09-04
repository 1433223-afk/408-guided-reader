from __future__ import annotations

import threading

from reader_service.foundation import FoundationService
from reader_service.library import LibraryService

from .repository import JobRepository


class PreparationCoordinator:
    def __init__(
        self,
        library: LibraryService,
        foundation: FoundationService,
        jobs: JobRepository,
        worker_count: int = 1,
    ):
        if worker_count < 1 or worker_count > 4:
            raise ValueError("Worker count must be between 1 and 4")
        self.library = library
        self.foundation = foundation
        self.jobs = jobs
        self.worker_count = worker_count
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        if self._threads:
            return
        self.foundation.repository.reset_interrupted_pages()
        self.jobs.recover()
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
        self.jobs.cancel_other_revisions(revision_id)
        self.jobs.enqueue_pages(
            revision_id, revision["page_count"], revision["foundation_version"]
        )
        self.jobs.prioritize(revision_id, visible_pages or {current_page}, current_page)
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

    def _run(self) -> None:
        while not self._stop.is_set():
            job = self.jobs.claim()
            if job is None:
                self._wake.wait(0.25)
                self._wake.clear()
                continue
            cancelled = False
            for page_index in range(job["page_start"], job["page_end"] + 1):
                if self._stop.is_set() or self.jobs.cancellation_requested(job["id"]):
                    cancelled = True
                    break
                self.foundation.prepare_page(job["book_source_revision_id"], page_index)
            self.jobs.complete(job["id"], cancelled=cancelled)
