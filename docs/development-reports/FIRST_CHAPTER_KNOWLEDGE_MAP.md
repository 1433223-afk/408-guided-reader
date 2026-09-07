# First Chapter Knowledge Map Development Report

## Result

`IMPLEMENTATION_READY`

`AGENT_REAL_USE_PASS`

`READY_FOR_USER_RETEST`

`READY_FOR_NARROW_INDEPENDENT_REVIEW`

`USER_ACCEPTANCE: PENDING RETEST`

The user-approved UAT authority correction and the subsequent `review_rejected` UAT rework are
implemented. A requested Chapter generates private candidates one existing primary Section at a
time. A valid blocking Review now returns typed, candidate/Section-addressed findings; one bounded
semantic repair round regenerates only the smallest affected Section set, retains successful
sibling candidates, and sends the reassembled complete Chapter through Review again. No KP is
exposed until one complete candidate set passes structural Review, deterministic validation and one
atomic publication. The Reader continues to show only stage and completed/total Section progress.

Before the second UAT failure, the real 348-page Chapter 6 production-default path completed through
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
- Replaced the non-actionable `verdict + summary` KP Review result with a strict typed finding
  contract: rubric dimension, blocking/warning severity, candidate indices, evidence Sections,
  smallest repair Section set and an actionable detail. Invalid/missing targets fail closed as
  `invalid_review_output`; Review still judges and never rewrites candidates.
- Added one bounded private semantic-repair round. Only Sections named by blocking findings are
  regenerated as complete Section candidate sets; unaffected candidates remain in memory. The
  reassembled Chapter receives fresh range resolution, whole-Chapter Review and deterministic
  validation before the unchanged atomic publication transaction. A second blocking Review remains
  terminal `review_rejected` and publishes nothing.
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
- The repair budget is deliberately one round. This bounds latency/cost and prevents Review from
  turning into an unbounded generator loop while still making a precise first rejection useful.

## Deviations from Spec

None from the corrected accepted Phase brief. No external code, dependency or framework was added.

## Acceptance evidence

Evidence was executed in the required order: TARGETED → AGENT REAL-USE GOLDEN PATH → AFFECTED
REGRESSION → CLOSURE / BROAD.

- TARGETED: `python -m pytest tests/test_knowledge_map.py -q` — **23 passed**. In addition to the
  original Section/atomicity invariants, it proves typed finding validation, one-Section repair,
  unaffected sibling non-replay, complete-Chapter re-review, repair-attempt observability, bounded
  second rejection, and fail-closed behavior when Review supplies no actionable target.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:knowledge` — **PASS** through the served Reader on
  the 348-page textbook (SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`), Chapter 6. A delayed Section
  returned three bounded blank responses with `finish_reason=length`; the UI showed Section progress
  and zero KP rows, a successful sibling was called once while the failing Section retried, and the
  Chapter honestly ended `GENERATION / empty_response`. UI retry then exercised a blocking
  `instructional_specificity` finding, displayed private repair progress as `0/1 个小节`, regenerated
  only that Section, re-reviewed the complete Chapter, and converged to one atomic READY map with
  four Section groups. KP → rendered-PDF navigation, unchanged logical Outline identity,
  Reader/Find/selection/Marks/Assistant availability during failure, stable IDs after restart and
  correct book cascade also passed.
- PRIOR REAL-PROVIDER EVIDENCE: `npm run test:e2e:knowledge:real` with no generator/reviewer
  override passed before this narrower Review-contract rework on the same real Chapter through
  production-default
  `deepseek-v4-pro → GLM-5.3-Flash`. All four Sections succeeded on their first transport attempt,
  followed by one Chapter Review and atomic publication of 32 KPs in four groups. The largest two
  generation calls completed in 118,921 ms and 117,691 ms; the former recorded 5,644 prompt tokens,
  `finish_reason=stop`, non-empty content and bounded reasoning metadata. Five final provider calls
  were inspected; no Authorization or credential value was retained. Visual evidence:
  `test-results/knowledge-map-golden.png` and
  `test-results/knowledge-map-real-provider.png`. It was deliberately not rerun for this UAT repair:
  the user requested diagnosis and a bounded repair implementation rather than another brute-force
  whole-Chapter provider run; current real-provider confirmation is the user retest.
- AFFECTED REGRESSION: API/jobs/Map/Assistant/AI_SAVED/Annotations Python suites — **PASS**;
  `npm test` — **30 passed**.
- CLOSURE / BROAD: `python -m pytest -o addopts= -q -ra
  --basetemp=test-results/pytest-first-chapter-review-repair-closure` — **142 passed, 2
  skipped**. The unchanged skips are optional `READER_REAL_DMA` / `READER_REAL_PRIMARY` entrypoints;
  the required 348-page material was exercised above. `npm test` — **30 passed**;
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

### Second UAT `review_rejected` root cause and correction evidence

- The failed Chapter 1 attempt `fb1a46b5-b5e7-4a1a-b2d6-a8c4cb5e6872` ran from
  `2026-09-07T00:23:09Z` to `00:30:37Z`. All five Sections generated 46 private candidates. Section
  generation completed near `00:27:18Z`; Review then took about 199 seconds after one logged network
  retry and returned a valid semantic FAIL, not invalid structured output.
- Review accepted Sections 1.1–1.3 and the sole overlap warning. It identified real repetition in
  summary/FAQ Sections: 1.4 language direct-execution versus 1.2 language levels; 1.5 benchmark
  limitations versus 1.3 benchmarks; 1.5 translation-program distinctions versus 1.2 translator
  types; and the five-part hardware clause of 1.4 hardware/evolution versus 1.2 von Neumann
  components. Source inspection confirmed that the first three are recap/FAQ restatements; the last
  candidate also contains a distinct architecture-evolution idea that should be narrowed rather
  than discarded.
- The previous contract retained only `verdict + summary`; the service therefore had no validated
  machine-addressable repair targets. On FAIL, all 46 disposable candidates left scope and a later
  retry would regenerate all five Sections. The new path keeps candidates private inside the live
  attempt, repairs only typed targets, and re-reviews the full Chapter once.

## Known limitations / deferred debt

- `REQUIRED_BEFORE_MASTERY_OR_FIRST_REGENERATION`: same-concept durable-ID reuse/new-concept mint,
  ambiguous split/merge blocking, and separation of published availability from replacement-attempt
  lifecycle. Until separately authorized and implemented, READY maps cannot regenerate and no
  Learning/Mastery state may be introduced.
- External provider latency/availability remains variable. Per-attempt evidence now makes blank
  content and reasoning-budget exhaustion diagnosable, while any failed required Section still
  fails the whole private Chapter attempt without weakening Review/publication authority.
- The already-failed Chapter 1 candidates cannot be resumed: they predate the repair contract and
  were intentionally disposable/non-durable. Its next user retry must perform one fresh initial
  Section generation pass; any actionable Review rejection inside that new attempt can use targeted
  repair without replaying unaffected Sections.
- User retest and narrow independent review remain required before Phase closure.

## Reproducible entry points

```powershell
python -m pytest tests/test_knowledge_map.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge
npm run test:e2e:knowledge:real
$env:READER_REAL_PDF='D:\codex\408-guided-reader\var\manual-browser\blobs\32\327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1.pdf'
npm run test:e2e:recovery
python -m pytest -o addopts= -q -ra --basetemp=test-results/pytest-first-chapter-review-repair-closure
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

Review-repair UAT checkpoint: `aac3658c799c1af7ef2256f0c67f7b4e06ba4cb4`.

Development-report checkpoint: the docs-only commit containing this report; its exact hash is
recorded in the handoff.
