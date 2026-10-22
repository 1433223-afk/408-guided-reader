from __future__ import annotations

import threading
import time
import pytest
from contextlib import contextmanager
from io import BytesIO

from conftest import make_pdf

from reader_service.foundation import (
    DetectedLine,
    FoundationRepository,
    FoundationService,
)
from reader_service.jobs import JobRepository, PreparationCoordinator

LINE = DetectedLine(
    quad=((0.1, 0.1), (0.5, 0.1), (0.5, 0.2), (0.1, 0.2)),
    text="ready",
    confidence=0.9,
    cells=((0.1, 0.5, 0, 5),),
)


@pytest.mark.parametrize('job_type', ['CHAPTER_PREPARE', 'TEACHING_GENERATE', 'TEACHING_REVIEW'])
@pytest.mark.parametrize('prerequisites', [False, True])
def test_waiting_ai_job_does_not_block_new_visible_page(service, job_type, prerequisites):
    from types import SimpleNamespace

    revision = import_revision(service, 1)
    entered, release, page_ready, page_release = (threading.Event() for _ in range(4))
    with service.database.connect() as c:
        c.execute("""INSERT INTO outline_nodes(outline_node_id,book_source_revision_id,
            parent_id,depth,order_index,kind,title,start_page,resolution_state,confidence,evidence_json)
            VALUES ('chapter',?,NULL,0,0,'CHAPTER','Example',0,'PARTIAL',1,'{}')""", (revision['id'],))
        c.execute("""INSERT INTO jobs(id,job_type,book_source_revision_id,foundation_version,
            chapter_outline_node_id,chapter_identity_revision,chapter_physical_revision,
            status,priority,created_at,updated_at) VALUES ('slow-ai',?,?,1,'chapter',1,1,'QUEUED',5000,'now','now')""",
                  (job_type, revision['id']))

    def slow_ai(job):
        entered.set()
        assert release.wait(10)

    class FastFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            page_ready.set()
            if prerequisites:
                assert not entered.is_set()
                assert page_release.wait(3)
            return 'OCR', 'fixture:v1', [LINE]

    foundation = FastFoundation(service, FoundationRepository(service.database), lambda: None)
    ai = SimpleNamespace(run_job=slow_ai, repository=SimpleNamespace(recover_preparing_jobs=lambda: None))
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(service, foundation, jobs, worker_count=1, knowledge=ai, teaching=ai)
    if prerequisites:
        coordinator.schedule_revision(revision['id'])
        with service.database.connect() as c:
            c.execute("UPDATE jobs SET priority=6000 WHERE job_type='PAGE_PREPARE'")
    coordinator.start()
    try:
        if prerequisites:
            assert page_ready.wait(3)
            assert not entered.wait(.15), 'AI must retain prerequisite-page priority'
            page_release.set()
        assert entered.wait(3)
        if not prerequisites:
            coordinator.schedule_revision(revision['id'])
        assert page_ready.wait(2), 'AI network waiting occupied the only page worker'
        release.set()
        deadline = time.monotonic() + 3
        completed = 0
        while time.monotonic() < deadline:
            with service.database.connect() as c:
                completed = c.execute("SELECT COUNT(*) FROM jobs WHERE status='SUCCEEDED'").fetchone()[0]
            if completed == 2:
                break
            time.sleep(.02)
        assert completed == 2
    finally:
        page_release.set()
        release.set()
        coordinator.stop()


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


def test_two_page_workers_prepare_distinct_pages_concurrently(service):
    from types import SimpleNamespace

    revision = import_revision(service, 2)
    barrier = threading.Barrier(2)
    calls = []
    refreshes = []

    class ConcurrentFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            calls.append(page_index)
            barrier.wait(timeout=10)
            return "OCR", "fixture:v1", [LINE]

    foundation = ConcurrentFoundation(
        service, FoundationRepository(service.database), lambda: None,
    )
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(
        service, foundation, jobs, worker_count=2,
        outline=SimpleNamespace(bootstrap=lambda revision_id: refreshes.append(
            foundation.repository.prefix_progress(revision_id, 20)[0]
        )),
    )
    coordinator.schedule_revision(revision["id"])
    coordinator.start()
    try:
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline and jobs.counts(revision["id"])["SUCCEEDED"] < 2:
            time.sleep(0.02)
    finally:
        coordinator.stop()

    assert set(calls) == {0, 1}
    assert jobs.counts(revision["id"])["SUCCEEDED"] == 2
    assert [page["status"] for page in foundation.statuses(revision["id"])] == [
        "READY", "READY"
    ]
    assert refreshes and refreshes[-1] == 2


def test_priority_refresh_updates_queued_pages_in_one_statement(service):
    revision = import_revision(service, 3)
    jobs = JobRepository(service.database)
    jobs.enqueue_pages(revision["id"], 3, 1)
    writes = []

    class CountingDatabase:
        @contextmanager
        def connect(self):
            with service.database.connect() as connection:
                class Connection:
                    def execute(self, sql, parameters=()):
                        if sql.lstrip().startswith("UPDATE jobs SET priority"):
                            writes.append(sql)
                        return connection.execute(sql, parameters)
                yield Connection()

    JobRepository(CountingDatabase()).prioritize(revision["id"], {2}, 2)
    assert len(writes) == 1
    assert jobs.claim()["page_start"] == 2


def test_viewport_reschedule_does_not_enqueue_whole_book_again(service):
    revision = import_revision(service, 8)
    foundation = FoundationService(
        service, FoundationRepository(service.database), lambda: None,
    )

    class CountingJobs(JobRepository):
        def __init__(self, database):
            super().__init__(database)
            self.enqueues = 0

        def enqueue_pages(self, *args):
            self.enqueues += 1
            return super().enqueue_pages(*args)

    jobs = CountingJobs(service.database)
    coordinator = PreparationCoordinator(service, foundation, jobs)
    coordinator.schedule_revision(revision["id"], {0}, 0)
    coordinator.schedule_revision(revision["id"], {6}, 6)

    assert jobs.enqueues == 1
    assert jobs.claim()["page_start"] == 6


def test_early_page_directory_refresh_is_coalesced(service):
    from types import SimpleNamespace

    revision = import_revision(service, 20)

    class FastFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            return "OCR", "fixture:v1", [LINE]

    foundation = FastFoundation(
        service, FoundationRepository(service.database), lambda: None,
    )
    jobs = JobRepository(service.database)
    refreshes = []
    coordinator = PreparationCoordinator(
        service, foundation, jobs, worker_count=1,
        outline=SimpleNamespace(bootstrap=lambda revision_id: refreshes.append(revision_id)),
    )
    coordinator.schedule_revision(revision["id"])
    coordinator.start()
    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and jobs.counts(revision["id"])["SUCCEEDED"] < 20:
            time.sleep(0.02)
    finally:
        coordinator.stop()

    assert jobs.counts(revision["id"])["SUCCEEDED"] == 20
    assert 1 <= len(refreshes) <= 6


def test_directory_refresh_does_not_block_page_ocr(service):
    from types import SimpleNamespace

    revision = import_revision(service, 8)
    entered = threading.Event()
    release = threading.Event()

    class FastFoundation(FoundationService):
        def _extract(self, pdf_path, page_index):
            return "OCR", "fixture:v1", [LINE]

    def slow_refresh(revision_id):
        entered.set()
        release.wait(timeout=10)

    foundation = FastFoundation(
        service, FoundationRepository(service.database), lambda: None,
    )
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(
        service, foundation, jobs, worker_count=1,
        outline=SimpleNamespace(bootstrap=slow_refresh),
    )
    coordinator.schedule_revision(revision["id"])
    coordinator.start()
    try:
        assert entered.wait(timeout=5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and jobs.counts(revision["id"])["SUCCEEDED"] < 8:
            time.sleep(0.02)
        assert jobs.counts(revision["id"])["SUCCEEDED"] == 8
    finally:
        release.set()
        coordinator.stop()


def test_reopening_resumes_cancelled_unfinished_pages(service):
    revision = import_revision(service, 3)
    repository = FoundationRepository(service.database)
    foundation = FoundationService(service, repository, lambda: None)
    jobs = JobRepository(service.database)
    coordinator = PreparationCoordinator(service, foundation, jobs)
    coordinator.schedule_revision(revision["id"])
    jobs.cancel_revision(revision["id"])
    assert jobs.counts(revision["id"])["CANCELLED"] == 3

    coordinator.schedule_revision(revision["id"], {2}, 2)
    assert jobs.counts(revision["id"])["QUEUED"] == 3
    assert jobs.claim()["page_start"] == 2


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
    assert repository.page_status(revision["id"], 0) == "NOT_PREPARED"
    retried = jobs.claim()
    assert retried["page_start"] == 0
    assert coordinator.retry_page(revision["id"], 0) is False
    assert foundation.prepare_page(revision["id"], 0) == "FAILED"
    jobs.complete(retried["id"])
    assert coordinator.retry_page(revision["id"], 0) is True


def test_ready_book_reopen_never_scans_outline_or_enqueues_new_version(service):
    from types import SimpleNamespace

    revision = import_revision(service, 2)
    repository = FoundationRepository(service.database)
    repository.ensure_pages(revision['id'], 2, 1)
    for page in range(2):
        repository.mark_preparing(revision['id'], page)
        repository.publish_page(revision['id'], page, route='OCR', foundation_version=1,
                                engine_profile='fixture:v1', lines=[LINE])
    foundation = FoundationService(service, repository, lambda: None)
    jobs = JobRepository(service.database)
    def forbidden(*args):
        raise AssertionError('Viewport scheduling must not scan Outline')
    coordinator = PreparationCoordinator(service, foundation, jobs,
                                         outline=SimpleNamespace(bootstrap=forbidden))
    for page in [0, 1, 0]:
        coordinator.schedule_revision(revision['id'], {page}, page)
    assert jobs.claim() is None
    assert all(p['status'] == 'READY' for p in foundation.statuses(revision['id']))
