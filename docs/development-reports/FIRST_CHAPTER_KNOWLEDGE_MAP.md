# First Chapter Knowledge Map Development Report

## Result

`IMPLEMENTATION_READY`

The Reader can prepare one requested Chapter on demand, show honest Simplified Chinese
`NOT_PREPARED` / `PREPARING` / `READY` / `FAILED` states, publish one complete Knowledge Map only
after deterministic validation and structural Review, group the durable KPs by their existing
primary Section, and navigate each KP back to its real PDF source range. Failure and retry remain
Chapter-local and do not block reading or the existing Reader tools.

This report does not claim `USER_ACCEPTANCE: PASS` and does not close the Phase. User retest and the
required narrow independent review remain pending.

## Implemented

- Added Migration 8, extending the existing durable job table with `CHAPTER_PREPARE` while
  preserving page jobs, and adding source-revision-owned `chapter_preparations` and
  `knowledge_points` with cascade and publication constraints.
- Added a Knowledge bounded context with private draft IDs, Chapter-scoped source projection,
  deterministic range/schema checks, fresh allowlisted structural Review, typed failure,
  generator/reviewer provenance and payload digests.
- Publishes stable KP IDs and one structure version in one SQLite transaction. Non-`READY` reads
  always return an empty KP list; a mid-transaction fault rolls back the whole publication.
- Resolves physical fields only for the requested Chapter and its necessary Section/Subsection
  subtree. Repository guards compare the logical identity snapshot before physical updates; no
  logical Outline field is written.
- Reuses the existing worker/runtime/provider/storage boundaries. Duplicate HTTP requests,
  concurrent clicks, response replay, restart recovery and explicit retry converge on the same
  Chapter attempt/version. A running job also converges safely when book deletion wins the race.
- Added authenticated Chapter map/prepare/local-inspection HTTP endpoints and a Reader affordance
  in both the Chapter Outline row and toolbar.
- Added a Section-grouped map, KP definition, real source-page action, explicit retry, non-blocking
  failure copy, and deletion messaging that includes the Chapter Knowledge Map.
- Added deterministic and real-provider served-UI acceptance runners plus migration, atomicity,
  failure, idempotency, cascade, concurrency and compatibility tests.

## Important implementation decisions

- Chapter preparation uses the existing durable job substrate. Target Chapter page jobs are raised
  above the Chapter job; already-authoritative READY OCR pages are converged without reprocessing.
- Embedded bookmarks remain the logical authority and safe page-granularity fallback. OCR heading
  matching only supplies target-subtree geometry, and the publication transaction rechecks the
  Chapter identity/physical revision dependency.
- Generator and reviewer receive independent calls and fresh contexts. A different configured
  route is supported and preferred; an actual same-provider clean-context route is recorded
  honestly when used.
- KP structured generation and structural Review use per-call `max_tokens=12288`. Real runs showed
  that the provider reasoning channel could consume the prior 4096 budget and return an empty
  response. The override is bounded to these two KP calls; ordinary Assistant calls retain their
  configured defaults, verified at the transport and effective-config boundaries.
- Local payload inspection is bounded process memory and secret-free. It exists to prove the final
  generation/Review allowlists and is not a second durable draft store.

## Deviations from Spec

None. No external code, dependency, new job framework, storage technology, Learning/Mastery/Master/
Teaching/ExamEvidence write, sibling-Chapter preparation or whole-book physical pass was added.

## Acceptance evidence

Evidence was executed in the required order: TARGETED → AGENT REAL-USE GOLDEN PATH → AFFECTED
REGRESSION → CLOSURE / BROAD.

- TARGETED: `python -m pytest -q tests/test_knowledge_map.py tests/test_jobs.py
  tests/test_map_the_book.py tests/test_api.py
  tests/test_ask_about_this.py::test_named_provider_per_call_token_budget_override_keeps_default_unchanged`
  — **29 passed**. This includes migration preservation, one-Chapter scope, full logical-identity
  preservation, target-only physical mutation, atomic rollback, non-READY empty reads, typed
  generation/Review/range/validation failures, retries, concurrent requests, restart recovery,
  book-delete/job concurrency, no orphan rows and no forbidden state tables.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:knowledge` — **PASS** through the actually served UI
  on the real 348-page textbook, SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`, Chapter 6. It proved one
  Chapter only; unchanged logical Outline projection; only Chapter 6 necessary physical fields
  changed; `REVIEW FAIL → explicit retry → atomic READY`; four Section groups; KP → rendered PDF
  source navigation; Find, Outline, selection, highlight/Marks and Assistant usability during
  failure; Reader close/reopen; service restart with the same structure version and KP IDs; and
  book cascade without changing the 29-page sibling book.
- REAL PROVIDER: one authorized `zhipu / GLM-5.3-Flash → zhipu / GLM-5.3-Flash` clean-context run
  completed **READY**, publishing 23 KPs in four Section groups after inspecting the final source and
  Review payloads. Subsequent bounded reruns captured external instability honestly: one Review
  `empty_response` at the prior 4096 Review budget, one zhipu generation `network` failure and one
  deepseek generation `empty_response`. All remained `FAILED`, exposed zero KPs and never fabricated
  Review PASS. Targeted transport inspection proves both final KP call roles carry
  `max_tokens=12288` while the ordinary Assistant stays at 4096; the later real generation failures
  also recorded 12288 on every attempt. No credential or Authorization value was captured.
- Visual evidence:
  `test-results/knowledge-map-golden.png` and
  `test-results/knowledge-map-real-provider.png`.
- AFFECTED REGRESSION: the Foundation/jobs/Map/Annotations/Search/Assistant/AI_SAVED/API/Library
  Python subset — **116 passed**; `npm run test:e2e:map` — **PASS** on both 29- and 348-page books;
  `npm run test:e2e:save` — **PASS** with AI_SAVED Review/persistence/restart/cascade; and
  `npm run test:e2e:recovery` — **PASS** on the hash-named 29-page real scan with 29/29 pages READY
  after process interruption (`readyBeforeKill=2`, `maximumAttempts=2`). The first recovery command
  invocation omitted its required `READER_REAL_PDF` and failed before starting; the corrected exact
  blob-path rerun above is the PASS evidence.
- CLOSURE / BROAD: `python -m pytest -o addopts= -q -ra
  --basetemp=test-results/pytest-first-chapter-knowledge-final` — **131 passed, 2 skipped**. The two
  skips are unchanged optional `READER_REAL_DMA` / `READER_REAL_PRIMARY` entrypoints; real 29- and
  348-page material was exercised by the served flows above. `npm test` — **30 passed**.
  `python -m compileall -q src`, `node --check` for the Reader and both new E2E runners, and
  `git diff --check` also passed.
- `INTENTIONALLY_NOT_RUN`: standalone `reader`, `selectable-reader`, `annotations`, `find-in-book`
  and `ask-about-this` E2E runners were not repeated because the Chapter golden path exercised those
  same served UI controls on the 348-page book, while the direct Map and AI_SAVED served regressions
  plus the broad Python suite covered their changed persistence/provider risk surfaces.

Overall agent evidence: `AGENT_REAL_USE_PASS`, `READY_FOR_USER_RETEST`, and
`READY_FOR_NARROW_INDEPENDENT_REVIEW`.

## Known limitations / deferred debt

- External provider availability remains variable. Typed transport/empty-response failures are
  visible and safely retryable; they do not weaken the publication gate. No additional provider
  fallback was invented.
- The feature intentionally prepares only one explicitly requested Chapter and does not implement
  Learning, Mastery, Progress, Master, Teaching or ExamEvidence state.
- User acceptance and the risk-triggered narrow independent review are still required before Phase
  closure.

## Reproducible entry points

```powershell
python -m pytest -q tests/test_knowledge_map.py tests/test_jobs.py tests/test_map_the_book.py tests/test_api.py
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge
$env:READER_REAL_KP_GENERATOR='zhipu'
$env:READER_REAL_KP_REVIEWER='zhipu'
npm run test:e2e:knowledge:real
python -m pytest -o addopts= -q -ra --basetemp=test-results/pytest-first-chapter-knowledge-final
npm test
```

The deterministic golden path copies the prepared Library into a temporary directory and deletes
the copy afterward. The real-provider path does the same but requires an authorized configured
credential. Neither runner mutates the source acceptance Library.

## Important files / architecture entry points

- `src/reader_service/knowledge/service.py` — Chapter pipeline, provider calls, allowlists, range and
  Review validation, failure normalization.
- `src/reader_service/knowledge/repository.py` — durable Chapter state, convergent job creation,
  atomic publication and READY-only projection.
- `src/reader_service/outline/service.py` and `outline/repository.py` — target-only physical
  resolution and logical identity guard.
- `src/reader_service/library/database.py` — Migration 8 and ownership/cascade constraints.
- `src/reader_service/jobs/` — shared durable page/Chapter scheduling and recovery.
- `src/reader_service/agent_runtime/runtime.py` — bounded per-call token override while preserving
  Assistant defaults.
- `src/reader_service/server.py` and `static/app.js` — HTTP contract and user-visible Reader flow.
- `tests/test_knowledge_map.py`, `tests-e2e/knowledge-map.mjs`, and
  `tests-e2e/knowledge-map-real-provider.mjs` — core acceptance evidence.

## Git checkpoint

Implementation checkpoint: `89f3f67e536dba5e00733a12b5796684bf8fbdc7`.
