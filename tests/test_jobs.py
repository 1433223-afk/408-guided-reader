from __future__ import annotations

import threading
import time
from io import BytesIO

from reader_service.foundation import DetectedLine, FoundationRepository, FoundationService
from reader_service.jobs import JobRepository, PreparationCoordinator

from conftest import make_pdf


LINE = DetectedLine(
    quad=((0.1, 0.1), (0.5, 0.1), (0.5, 0.2), (0.1, 0.2)),
    text="ready",
    confidence=0.9,
    cells=((0.1, 0.5, 0, 5),),
)


def import_revision(service, pages):
    pdf = make_pdf(tuple((612, 792) for _ in range(pages)))
    return service.intake(
        BytesIO(pdf), content_length=len(pdf), filename="jobs.pdf"
    )["book"]["active_revision"]


def test_conditional_claim_has_one_winner(service):
    revision = import_revision(service, 1)
    jobs = JobRepository(service.database)
    jobs.enqueue_pages(revision["id"], 1, revision["foundation_version"])
    barrier = threading.Barrier(3)
    claims = []

    def claim():
        barrier.wait()
        claims.append(jobs.claim())

    threads = [threading.Thread(target=claim) for _ in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join()
    assert sum(claim is not None for claim in claims) == 1


def test_recovery_skips_ready_page_and_reprocesses_only_inflight_page(service):
    revision = import_revision(service, 2)
    foundation_repository = FoundationRepository(service.database)
    foundation_repository.ensure_pages(revision["id"], 2, 1)
    assert foundation_repository.mark_preparing(revision["id"], 0)
    foundation_repository.publish_page(
        revision["id"], 0, route="OCR", foundation_version=1,
        engine_profile="fixture:v1", lines=[LINE]
    )

    calls = []

    class RecordingFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            calls.append(page_index)
            return "OCR", "fixture:v1", [LINE]

    foundation = RecordingFoundation(service, foundation_repository, lambda: None)
    jobs = JobRepository(service.database)
    jobs.enqueue_pages(revision["id"], 2, 1)
    first = jobs.claim()
    assert first is not None
    assert foundation_repository.mark_preparing(revision["id"], 1)

    # Simulate process death: durable RUNNING/PREPARING state remains.
    foundation_repository.reset_interrupted_pages()
    jobs.recover()
    coordinator = PreparationCoordinator(service, foundation, jobs, worker_count=1)
    coordinator.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and jobs.counts(revision["id"])["SUCCEEDED"] < 2:
        time.sleep(0.02)
    coordinator.stop()

    assert jobs.counts(revision["id"])["SUCCEEDED"] == 2
    assert calls == [1]
    assert [page["status"] for page in foundation.statuses(revision["id"])] == [
        "READY", "READY"
    ]


def test_visible_pages_are_prioritized_over_background_pages(service):
    revision = import_revision(service, 8)
    jobs = JobRepository(service.database)
    jobs.enqueue_pages(revision["id"], 8, 1)
    jobs.prioritize(revision["id"], {6}, 6)
    assert jobs.claim()["page_start"] == 6


def test_failed_page_retry_is_explicit_and_requeues_only_that_page(service):
    revision = import_revision(service, 1)
    repository = FoundationRepository(service.database)

    class AlwaysFails(FoundationService):
        def _extract(self, pdf_path, page_index):
            raise RuntimeError("broken page")

    foundation = AlwaysFails(service, repository, lambda: None)
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(service, foundation, jobs)
    coordinator.schedule_revision(revision["id"])
    job = jobs.claim()
    assert foundation.prepare_page(revision["id"], 0) == "FAILED"
    jobs.complete(job["id"])

    assert coordinator.retry_page(revision["id"], 0) is True
    assert repository.page_status(revision["id"], 0) == "FAILED"
    assert jobs.claim()["page_start"] == 0
    assert coordinator.retry_page(revision["id"], 0) is False
