# First Chapter Knowledge Map Development Report

## Result

`IMPLEMENTATION_READY`

`AGENT_REAL_USE_PASS`

`READY_FOR_USER_RETEST`

`USER_ACCEPTANCE: PENDING RETEST`

The user-approved architecture correction and the subsequent `review_rejected` UAT rework are
implemented. The Phase remains open. Nothing in this report claims `USER_ACCEPTANCE: PASS` or adds
Learning, Mastery, Master, Teaching or Guide behavior.

The production path is now:

```text
deterministic Chapter evidence units
→ bounded Section-local semantic packets
→ deterministic private KP materialization
→ one compact whole-Chapter structural Review
→ one bounded unit-addressed packet repair when required
→ whole-Chapter re-review and deterministic validation
→ one atomic Chapter publication
```

Before publication, the Reader exposes only stage and completed/total Section progress. No private
unit, candidate title, definition or source range is user-visible.

## UAT root cause

- The original real Chapter 1 failure was attempt
  `fb1a46b5-b5e7-4a1a-b2d6-a8c4cb5e6872`. All five Sections generated successfully and produced 46
  private candidates. The Reviewer returned a valid semantic FAIL, not an output-contract failure.
- Its concrete findings were real structural-quality issues: Section 1.4 repeated language direct
  execution already taught in 1.2; Section 1.5 repeated benchmark limitations from 1.3 and
  translation-program distinctions from 1.2; Section 1.4 also repeated the von Neumann five-part
  hardware model from 1.2 while mixing it with a distinct architecture-evolution idea that needed
  narrowing rather than wholesale deletion.
- The old Review result had only a summary and Section-level repair authority. It could not identify
  the smallest evidence units. After FAIL, all candidates left process memory, so a user retry had
  to regenerate the entire Chapter.
- Reproduction also established the latency/`empty_response` cause. DeepSeek's default thinking
  consumed the completion budget and returned `finish_reason=length`, reasoning content and an
  empty answer after roughly 65–173 seconds per call. Explicit `thinking.type=disabled` reduced real
  packet calls to roughly 4–13 seconds and returned ordinary content.
- The configured `GLM-5.3-Flash` Reviewer is an always-thinking model: it rejects
  `thinking.type=disabled` with HTTP 400/provider code 1210. A safe parameter probe established that
  its bounded minimum is top-level `reasoning_effort=low`. The runtime now maps the two named
  providers accurately instead of treating their controls as equivalent.

## Implemented

- Added a local deterministic evidence-unit builder and Section-local packetizer. Every unit has a
  pipeline-local ID and server-owned Section, order, source revision and continuous physical range.
  AI receives only the current bounded packet's unit IDs/text and may return only
  `KEEP`/`MERGE`/`DROP`, title and one-sentence meaning.
- Kept semantic validation strict. Invented, missing, repeated, reordered or multiply consumed unit
  IDs, non-contiguous runs, unary `MERGE`, partial/invalid JSON and undeclared fields fail closed.
  Up to three structured attempts remain packet-local; error-code-specific retry instructions do
  not normalize or partially accept invalid output.
- Packets from one Section are classified in source order while independent Sections remain
  concurrent. A later packet receives only a bounded list of earlier private title/meaning
  summaries from that same Section, so repeated definitions are dropped without resending the
  Section's OCR or crossing a Section boundary.
- Materialization is deterministic. Section ownership, order and source range come exclusively from
  the accepted unit ledger; model output cannot create or mutate Outline, page, line, geometry,
  source-revision or durable identity fields.
- Replaced the old Review payload with a compact whole-Chapter ledger containing complete unit
  accounting, candidate membership, bounded evidence excerpts/fingerprints and overlap warnings.
  The rubric covers independently trackable granularity, duplicate/near-duplicate semantics,
  instructional specificity, split/merge quality, major learning coverage, Section/source
  faithfulness and map-level balance.
- Review findings must name one real Section and the smallest real unit-ID set. One semantic repair
  round reruns only the affected packet(s), keeps every untouched packet result in memory,
  rematerializes the whole candidate map and performs a full Chapter re-review. A second blocking
  Review publishes nothing. A valid but over-broad finding is reported honestly as
  `SEMANTIC_FAILURE / review_repair_scope_exceeded`, not misclassified as malformed Review output.
- Removed deterministic no-overlap rejection. Overlap is a Review/warning signal; no-gaps remains
  unnecessary. Continuous Chapter/Section-contained source ranges remain hard validation gates.
- Preserved the existing atomic publication transaction. `PREPARING` and `FAILED` snapshots contain
  no KPs; durable opaque IDs and the complete structure version appear together only after Review
  PASS and final validation. A READY prepare remains a no-op, so replacement publication is still
  unavailable.
- Added Migration 10 and safe packet/stage attempt observability. It records provider/model role,
  packet or Review stage, semantic/structured/transport attempt, timing, finish reason, token usage,
  content/reasoning presence and lengths, and typed failures. Structured validation failures now
  annotate the exact packet/round. Request bodies, response bodies, reasoning text, credentials and
  private candidate content are never retained.
- Kept the existing Simplified Chinese Section-progress UI and READY-only Section-grouped map. The
  KP action resolves the published `start_page/start_y` and scrolls that source anchor into the
  rendered Reader viewport.

## Acceptance evidence

Evidence was executed in the required order: TARGETED → AGENT REAL-USE GOLDEN PATH → AFFECTED
REGRESSION → CLOSURE / BROAD.

- TARGETED: `pytest -q tests/test_knowledge_map.py` — **24 passed**. This covers deterministic unit
  accounting and ranges, Section-local bounded packets, strict semantic contracts, same-Section
  sequential context with no cross-Section leakage, packet-local technical retry, unit-addressed
  repair, whole-Chapter re-review, all seven Review dimensions, overlap-as-warning, atomic rollback,
  restart/idempotency/cascade, safe telemetry and UI/API projections.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:knowledge` — **PASS** against the prepared 348-page
  textbook (SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`), Chapter 6. It exercised a
  packet-local length/empty response and retry, a unit-addressed `instructional_specificity` FAIL,
  targeted repair, whole-Chapter re-review, atomic READY, four Section groups, source-anchor
  navigation, unchanged logical Outline identity, restart-stable IDs and book cascade.
- REAL PROVIDER GOLDEN PATH: `npm run test:e2e:knowledge:real` — **PASS** through the production
  `deepseek / deepseek-v4-pro → zhipu / GLM-5.3-Flash` route on two real Chapters:
  - Chapter 1: 13,285 source characters → 166 units / 9 packets → 67 published KPs in 5 Section
    groups; one packet-local technical failure recovered, one semantic repair round ran, and the
    rebuilt whole Chapter passed re-review.
  - Chapter 6: 7,704 source characters → 125 units / 8 packets → 54 published KPs in 4 Section
    groups; two packet-local technical failures recovered and the first whole-Chapter Review passed.
  - The final compact Review payloads were 40,034 and 30,978 characters respectively, both smaller
    than their raw Chapter source projections. No request body was retained. Both maps appeared only
    at READY, and Section-grouped rendering plus published source-anchor navigation passed.
- AFFECTED REGRESSION: API, jobs, Map the Book, Ask Deeper, AI_SAVED, annotations, Library and
  Foundation Python suites — **PASS**.
- CLOSURE / BROAD: full `pytest -q` — **144 passed, 2 skipped**; the unchanged skips are the optional
  external real-OCR entrypoints. `npm test` — **30 passed**. `python -m compileall -q src`, Node syntax
  checks for both Knowledge E2E runners and `git diff --check` also passed.
- `INTENTIONALLY_NOT_RUN`: standalone Reader/selectable-reader/annotations/find E2E runners were not
  repeated because the current Knowledge golden path exercised those actual Reader controls on the
  348-page material, while their persistence/geometry surfaces were included in affected and broad
  Python suites.

Visual evidence:

- `test-results/knowledge-map-golden.png`
- `test-results/knowledge-map-real-provider.png`

## Boundaries and deferred debt

- `REQUIRED_BEFORE_MASTERY_OR_FIRST_REGENERATION`: same-concept durable-ID reuse/new-concept mint,
  ambiguous split/merge blocking, and separation of published availability from replacement-attempt
  lifecycle. No READY-map regeneration or Learning/Mastery reference exists yet.
- Private candidates remain intentionally disposable across process/job failure. Localized repair
  preserves unaffected candidates only inside the current live attempt; a later explicit retry
  starts a fresh private Chapter attempt. This preserves the accepted no-checkpoint/no-partial-draft
  boundary.
- Provider latency and structured-output variability still exist, but they are bounded to the
  current packet or Review stage and are now diagnosable without content retention. Exhaustion
  remains an honest Chapter-local failure, never a PASS.
- User retest remains required. The Phase is not closed.

## Reproducible entry points

```powershell
pytest -q tests/test_knowledge_map.py
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge
npm run test:e2e:knowledge:real
pytest -q tests/test_api.py tests/test_jobs.py tests/test_map_the_book.py tests/test_ask_about_this.py tests/test_saved_explanations.py tests/test_annotations.py tests/test_library.py tests/test_foundation.py
pytest -q
npm test
```

Both Knowledge E2E runners copy the prepared Library to a temporary directory, clear Knowledge-only
state in that copy and delete the copy afterward. They never mutate the source acceptance Library.
The real-provider runner uses the already-authorized configured credentials.

Manual user retest: open `http://127.0.0.1:8000`, choose the failed Chapter 1, open 学习地图, click
重试准备, observe the stage and `已完成 X/Y 个小节`, then verify that the complete five-Section map
appears at once and representative `回到教材` actions land on their published source anchors.

## Important files

- `src/reader_service/knowledge/semantic.py` — deterministic units/packets, strict semantic
  validation, materialization, compact Review ledger and repair-target bounds.
- `src/reader_service/knowledge/service.py` — Section sequencing, provider calls, Chapter Review,
  localized repair, validation and atomic pipeline orchestration.
- `src/reader_service/knowledge/repository.py` and `src/reader_service/library/database.py` — durable
  progress/attempt metadata, recovery, cascade and atomic publication.
- `src/reader_service/agent_runtime/runtime.py` — per-call request retention and provider-specific
  reasoning controls at the existing egress boundary.
- `src/reader_service/static/app.js` — user-visible stage/Section progress and READY-only map.
- `tests/test_knowledge_map.py`, `tests-e2e/knowledge-map.mjs` and
  `tests-e2e/knowledge-map-real-provider.mjs` — current acceptance evidence.

## Git checkpoint

The implementation and this report are committed together as the current UAT-rework checkpoint.
