# Regenerate READY Chapter Knowledge Map Development Report

## Result

`CLOSED / PASS`

- `AGENT_REAL_USE: PASS`
- `USER_ACCEPTANCE: PASS` — the user regenerated and inspected the real Chapter 2 Knowledge Map on
  2026-09-10 and accepted the result.
- `INDEPENDENT_NARROW_REVIEW: PASS` — `P0=0`, `P1=0`, `P2=0`;
  `CLOSURE_RECOMMENDATION: CLOSE`.
- Phase status: **CLOSED / COMPLETE** on 2026-09-10 by user approval.

The Reader now offers an explicit `重新生成知识点` action for an eligible READY Chapter. The current
Map remains visible while its complete private replacement runs and after any failure. A successful
replacement atomically advances the structure version and publishes an entirely fresh set of opaque
KP IDs.

## Implemented

- Added a replacement-attempt state independent from READY availability. Ordinary Prepare remains a
  READY no-op; duplicate regeneration requests join one durable Chapter job.
- Added a preflight regeneration guard and the same guard inside the publication write transaction.
  It blocks a permanently learned Chapter and any current durable table row that references one of
  the Chapter's published `knowledge_point_id`s.
- Added an irreversible `learning_state_ever_at` marker plus a repository boundary that future
  Learning must call in the same transaction as its first persistent learning-state write. A database
  trigger prevents clearing or rewriting that marker.
- Reused the accepted one-pass subsection generation, whole-Chapter Review, validation and publish
  path unchanged. The existing transaction inserts the complete new set with fresh IDs, removes the
  dependency-free old set and switches the version atomically.
- Added the READY UI action and honest running/failed/locked copy. No private candidate, old-ID map,
  migration control, history UI or single-KP edit is exposed.
- Closed the publication/job-completion race found by independent review: if a new preparation or
  replacement attempt is registered while the unique Chapter job is finishing its previous attempt,
  job completion atomically requeues that job instead of leaving the new attempt falsely RUNNING.

## Important implementation decisions

- Migration 11 is additive: replacement operational fields and the permanent lock live on the
  existing Chapter preparation record. No version-history table or mapping table was introduced.
- Published provider/source metadata remains untouched while a replacement runs or fails; attempt
  dependencies and failure fields are separate.
- Chapter-job completion converges against the authoritative preparation row in the same database
  transaction. Page jobs, normal success/failure and cancellation keep their existing behavior.
- The non-learning dependency check inspects existing durable tables that actually carry a
  `knowledge_point_id` column. Future learning writes must still set the permanent marker
  transactionally; deleting their current projection or history cannot unlock the Chapter.

## Deviations from Spec

None.

The existing Knowledge Map E2E had hard-coded that the one sibling book was a 29-page fixture. The
current real Library instead contains 348- and 412-page textbooks, so the test-only assertion now
captures and verifies every actual sibling by ID/page-count/hash. Its cascade-isolation product
contract is unchanged.

## Acceptance evidence

- Targeted `tests/test_knowledge_map.py`: **PASS**, including all-fresh replacement IDs, old-map
  visibility, duplicate convergence, Review failure preservation, atomic insert rollback, permanent
  learning lock, late transactional recheck, user-asset dependency block, HTTP non-disclosure and
  migration 10→11.
- Affected regression (`test_knowledge_map`, `test_jobs`, `test_api`, `test_annotations`,
  `test_library`): **PASS**, 52 tests.
- Agent real-use replacement: **PASS** with a real 348-page textbook (SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`), Chapter 3, on an isolated
  copy of the real Library. The Reader showed all 23 old KPs during replacement, then atomically
  published 23 fresh IDs; restart restored structure version 2 with the same replacement IDs. The
  source Library was not modified. Screenshot: `test-results/knowledge-map-regeneration.png`.
- Real user acceptance: **PASS** — the user regenerated the real Chapter 2 Map, inspected its final
  Knowledge Points and explicitly accepted it on 2026-09-10.
- Existing Knowledge Map real-book E2E: **PASS** — Chapter 6 failure/retry/atomic-publication,
  source navigation, restart and sibling-book cascade isolation remain intact.
- Closure broad `python -m pytest -q`: **PASS**; two real-OCR acceptance cases were skipped because
  their optional environment paths were not set. Closure broad `npm test`: **PASS**, 30/30.
- Independent narrow review first identified one P1 race between READY publication and completion of
  the reusable Chapter job. The exact interleaving was fixed and covered by
  `test_regeneration_requested_after_publish_before_job_completion_is_requeued`; the single test and
  the affected Knowledge/Jobs suites passed. Independent re-review: **PASS**, `P0=0`, `P1=0`,
  `P2=0`, `CLOSURE_RECOMMENDATION: CLOSE`; no authority conflict.
- Post-fix closure broad `python -m pytest -q`: **PASS**, 143 passed and 2 unchanged optional real-OCR
  skips. Post-fix `npm test`: **INTENTIONALLY_NOT_RUN** because the review correction touched only
  backend Chapter-job completion plus its Python test; the already-recorded 30/30 frontend closure
  result remains on the unchanged frontend/API surface.
- Not run: live external provider generation. The feature changes scheduling/publication state, not
  generator or reviewer semantics; controlled loopback providers exercised the actual HTTP/runtime
  boundary deterministically against real textbook evidence.

## Known limitations / deferred debt

- Learning/Mastery is not implemented here. Its first persistent write must use the committed
  permanent-lock boundary; the Frozen invariant forbids any implementation that omits or clears it.
- No migration, remap, manual unlock, single-KP editing or historical-version UI exists by design.

## Reproducible entry points

```powershell
python -m pytest tests/test_knowledge_map.py -q
python -m pytest tests/test_knowledge_map.py tests/test_jobs.py tests/test_api.py tests/test_annotations.py tests/test_library.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge:regenerate
npm run test:e2e:knowledge
python -m pytest -q
npm test
```

Manual path: open a READY Chapter's 学习地图, click `重新生成知识点`, confirm the old list remains
usable while stage/progress changes, then verify one complete replacement appears. A Chapter whose
permanent learning marker is present must show a disabled `本章已永久冻结` control.

## Important files / architecture entry points

- `src/reader_service/knowledge/repository.py` — eligibility, permanent lock, replacement lifecycle
  and atomic publication guard.
- `src/reader_service/library/database.py` — additive migration 11 and irreversible-lock trigger.
- `src/reader_service/knowledge/service.py`, `src/reader_service/jobs/worker.py` — existing pipeline
  reuse and explicit replacement scheduling.
- `src/reader_service/server.py`, `src/reader_service/static/app.js` — API and Reader affordance.
- `tests/test_knowledge_map.py`, `tests-e2e/knowledge-map-regeneration.mjs` — invariant and real-use
  acceptance paths.

## Git checkpoint

Authority checkpoint: `603a378`.
Implementation checkpoint: `1766205`.
Independent-review correction checkpoint: `88deb05`.
The docs-only closure checkpoint is the commit containing this final report; its exact hash is
recorded in the closure handoff.
