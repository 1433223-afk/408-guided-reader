# First Chapter Knowledge Map Development Report

## Result

`IMPLEMENTATION_READY`

`AGENT_REAL_USE_PASS`

`READY_FOR_USER_RETEST`

`READY_FOR_NARROW_INDEPENDENT_REVIEW`

`USER_ACCEPTANCE: PENDING RETEST`

The user-approved UAT authority correction is implemented. A requested Chapter now generates
private candidates one existing primary Section at a time, retains successful sibling results
inside the current in-process attempt, and exposes no KP until one complete Chapter candidate set
passes structural Review, deterministic validation and one atomic publication. The Reader shows
the current stage and completed/total Section count while preparation is private.

The real 348-page Chapter 6 production-default path now completes through
`deepseek / deepseek-v4-pro → zhipu / GLM-5.3-Flash`: four Section generation calls, one Chapter
Review, 32 published KPs and four visible Section groups. The Phase remains open pending user retest
and the required narrow independent review. Nothing here claims `USER_ACCEPTANCE: PASS` or closes
the Phase.

## Implemented

- Replaced the monolithic Chapter generator request with bounded Section-scoped requests. Each
  request contains only Chapter identity, one primary Section's Outline subtree, and
  `line_ref + text` evidence. Two Section calls may run concurrently; transport or structured-output
  retry stays inside the failing Section and does not replay successful siblings.
- Kept range resolution, structural Review, validation and publication at Chapter scope. All draft
  payloads stay private; `PREPARING` and `FAILED` projections still return an empty KP list, and
  stable opaque IDs are minted only inside the existing publication transaction.
- Expanded the Chapter Review rubric to independently trackable granularity, semantic duplicates,
  instructional specificity, split/merge quality, major learning coverage, Section/source
  faithfulness and map-level balance. Review receives deterministic overlap-warning pairs and may
  distinguish legitimate shared evidence from duplication or unjustified splitting.
- Removed the deterministic no-overlap rejection. Continuous Section-contained ranges remain hard
  requirements; gaps remain allowed.
- Added Migration 9 with Chapter stage/Section progress and bounded durable generation-attempt
  metadata. Records include generator role, provider/model, Chapter/Section and logical/transport
  attempts, start/end timing, latency, finish reason, token usage, content/reasoning presence and
  lengths, and typed outcome/failure. They never store credentials, request/response bodies,
  reasoning text or candidate KP content.
- Extended the provider boundary so `empty_response` preserves safe finish/usage/length diagnostics.
  Interrupted live attempt rows become `INTERRUPTED` on restart and disposable progress restarts at
  `QUEUED`, rather than appearing indefinitely live.
- Added Simplified Chinese Reader progress for resolving, Section generation, Chapter Review,
  validation and publication. Only stage and completed/total Section count are shown before READY.
- Updated deterministic, real-provider and Map served runners for Section payloads, delayed
  `empty_response`, safe diagnostics, evolving already-resolved real-book evidence and atomic UI.

## Important implementation decisions

- The Section generator allowlist deliberately omits repeated geometry and revision fields. Those
  stay in the server-side resolver and full Chapter Review context; generation needs only stable
  identity, Section-local hierarchy, line references and source text. This reduced the largest real
  Chapter 6 request from 11,906 prompt tokens in the first corrected attempt to 5,644.
- Section concurrency is bounded to two by default (configurable from one to four) to reduce elapsed
  time without adding another job system or changing the Chapter publication boundary.
- Observability writes are an allowlisted side channel at the existing provider boundary. Provider
  results remain authoritative even if diagnostic persistence itself is unavailable; book deletion
  and other owning-state races therefore still converge safely.
- A READY prepare remains a no-op. No replacement publication, ID reconciliation, availability/
  replacement-attempt split, Learning, Mastery, Master, Teaching or ExamEvidence path was added.

## Deviations from Spec

None from the corrected accepted Phase brief. No external code, dependency or framework was added.

## Acceptance evidence

Evidence was executed in the required order: TARGETED → AGENT REAL-USE GOLDEN PATH → AFFECTED
REGRESSION → CLOSURE / BROAD.

- TARGETED: `python -m pytest tests/test_knowledge_map.py
  tests/test_ask_about_this.py::test_empty_response_attempt_observer_retains_only_safe_finish_usage_and_lengths
  -q` — **22 passed**. It covers Section-only payloads/retry, sibling non-replay, Chapter-atomic
  failure, overlap warnings, the seven Review dimensions, migration preservation, restart
  interruption, bounded safe diagnostics, READY no-op, identity/ownership/cascade and zero forbidden
  learning/teaching tables.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:knowledge` — **PASS** through the served Reader on
  the 348-page textbook (SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`), Chapter 6. A delayed Section
  returned three bounded blank responses with `finish_reason=length`; the UI showed Section progress
  and zero KP rows, a successful sibling was called once while the failing Section retried, and the
  Chapter honestly ended `GENERATION / empty_response`. UI retry converged to one atomic READY map
  with four Section groups, KP → rendered-PDF navigation, unchanged logical Outline identity,
  Reader/Find/selection/Marks/Assistant availability during failure, stable IDs after restart and
  correct book cascade.
- REAL PROVIDER: `npm run test:e2e:knowledge:real` with no generator/reviewer override — **PASS** on
  the same real Chapter through production-default
  `deepseek-v4-pro → GLM-5.3-Flash`. All four Sections succeeded on their first transport attempt,
  followed by one Chapter Review and atomic publication of 32 KPs in four groups. The largest two
  generation calls completed in 118,921 ms and 117,691 ms; the former recorded 5,644 prompt tokens,
  `finish_reason=stop`, non-empty content and bounded reasoning metadata. Five final provider calls
  were inspected; no Authorization or credential value was retained. Visual evidence:
  `test-results/knowledge-map-golden.png` and
  `test-results/knowledge-map-real-provider.png`.
- AFFECTED REGRESSION: the Map/Foundation/jobs/provider/Assistant/AI_SAVED/Annotations/API Python
  subset — **PASS**; `npm test` — **30 passed**; `npm run test:e2e:map` — **PASS** on the real 29- and
  348-page books; `npm run test:e2e:ask` — **PASS**; `npm run test:e2e:save` — **PASS**; and
  `npm run test:e2e:recovery` — **PASS** on the hash-named 29-page scan with 29/29 pages READY after
  process interruption (`readyBeforeKill=2`, `maximumAttempts=2`). The first Map invocation exposed
  two stale test assumptions that all persisted targets remain `PARTIAL` with physical revision 1;
  the runner was corrected to accept already-RESOLVED evidence while still comparing logical
  identity and physical revision across restart. The first recovery invocation omitted its required
  `READER_REAL_PDF` precondition and was rerun with the exact local blob path; neither failed
  invocation is counted as PASS.
- CLOSURE / BROAD: `python -m pytest -o addopts= -q -ra
  --basetemp=test-results/pytest-first-chapter-knowledge-uat-rework-final-2` — **140 passed, 2
  skipped**. The unchanged skips are optional `READER_REAL_DMA` / `READER_REAL_PRIMARY` entrypoints;
  the required 29- and 348-page material was exercised above. `npm test` — **30 passed**;
  `python -m compileall -q src`, Node syntax checks for the Reader and affected E2E runners, and
  `git diff --check` passed.
- `INTENTIONALLY_NOT_RUN`: standalone `reader`, `selectable-reader`, `annotations` and `find-in-book`
  E2E runners were not repeated because the Chapter golden path exercised those actual controls on
  the 348-page Reader, while their persistence and geometry surfaces were included in the broad
  Python suite.

### UAT failure root cause and correction evidence

- The old Chapter 6 generator request carried 47,287 JSON characters / 61,751 request-message bytes
  and ended after approximately eight minutes as an opaque `empty_response`.
- The first real run after Section splitting made the failure diagnosable: one still-redundant
  Section payload used 11,906 prompt tokens; DeepSeek returned `finish_reason=length`, 12,287
  completion tokens, `reasoning_present=true` and `content_length=0` after 169,767 ms. Three smaller
  sibling Sections succeeded independently and were not replayed by that retry.
- Removing generator-unneeded geometry/revision repetition reduced the failing Section to 5,644
  prompt tokens. On the production-default rerun it returned `finish_reason=stop` and 4,873 content
  characters on its first call. The Chapter reached READY rather than repeating three full-Chapter
  calls.

## Known limitations / deferred debt

- `REQUIRED_BEFORE_MASTERY_OR_FIRST_REGENERATION`: same-concept durable-ID reuse/new-concept mint,
  ambiguous split/merge blocking, and separation of published availability from replacement-attempt
  lifecycle. Until separately authorized and implemented, READY maps cannot regenerate and no
  Learning/Mastery state may be introduced.
- External provider latency/availability remains variable. Per-attempt evidence now makes blank
  content and reasoning-budget exhaustion diagnosable, while any failed required Section still
  fails the whole private Chapter attempt without weakening Review/publication authority.
- User retest and narrow independent review remain required before Phase closure.

## Reproducible entry points

```powershell
python -m pytest tests/test_knowledge_map.py tests/test_ask_about_this.py::test_empty_response_attempt_observer_retains_only_safe_finish_usage_and_lengths -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge
npm run test:e2e:knowledge:real
$env:READER_REAL_PDF='D:\codex\408-guided-reader\var\manual-browser\blobs\32\327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1.pdf'
npm run test:e2e:recovery
python -m pytest -o addopts= -q -ra --basetemp=test-results/pytest-first-chapter-knowledge-uat-rework-final-2
npm test
```

Both Knowledge E2E runners copy the prepared Library to a temporary directory, clear Knowledge-only
state in that copy, and delete the copy afterward. They never mutate the source acceptance Library.
The real-provider runner requires the already-authorized configured credentials.

Manual user retest: open `http://127.0.0.1:8000`, choose an unprepared/failed Chapter, open 学习地图,
click 准备/重试, observe stage plus `已完成 X/Y 个小节`, then verify the complete Section-grouped
map appears at once and use 回到教材 on representative KPs.

## Important files / architecture entry points

- `src/reader_service/knowledge/service.py` — Section generation, Chapter assembly/Review,
  overlap warnings, validation and failure normalization.
- `src/reader_service/knowledge/repository.py` — durable progress/attempt metadata, recovery,
  atomic publication and READY-only projection.
- `src/reader_service/library/database.py` — Migrations 8–9 and ownership/cascade constraints.
- `src/reader_service/agent_runtime/runtime.py` and `deepseek.py` — safe per-transport metadata and
  empty-response diagnostics.
- `src/reader_service/static/app.js` — user-visible stage/Section progress and atomic map rendering.
- `tests/test_knowledge_map.py`, `tests-e2e/knowledge-map.mjs`, and
  `tests-e2e/knowledge-map-real-provider.mjs` — core acceptance evidence.

## Git checkpoint

Implementation checkpoint: `900742367e393d51f3f2c025ac725f360dc43296`.

Development-report checkpoint: the docs-only commit containing this report; its exact hash is
recorded in the handoff.
