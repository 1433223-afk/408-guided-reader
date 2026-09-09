# First Chapter Knowledge Map Development Report

## Result

`CLOSED / PASS`

- `AGENT_REAL_USE: PASS`
- `USER_ACCEPTANCE: PASS` — the user accepted the real Chapter 2 and Chapter 3 Knowledge Maps on
  2026-09-09.
- `INDEPENDENT_NARROW_REVIEW: PASS` — `P0=0`, `P1=0`, `P2=0`;
  `CLOSURE_RECOMMENDATION: CLOSE`.
- Phase status: **CLOSED / COMPLETE** on 2026-09-09 by user approval.

The Reader can prepare one requested Chapter as a private, Section-progress-visible operation and
publish the complete Section-grouped Knowledge Map atomically. No candidate KP is exposed before
publication. A valid final Review failure ends the attempt without regeneration or partial
publication.

The accepted semantic path is:

```text
Outline-subsection bounded textbook evidence
-> Section lead-in joined to the first subsection (or whole Section when it has no subsection)
-> one group-first semantic partition per resulting window
-> deterministic KP materialization
-> one compact whole-Chapter structural Review
-> deterministic validation
-> atomic Chapter publication
```

## Implemented

- Retained deterministic Outline/OCR evidence ownership. The server constructs stable ordered
  evidence units and real subsection-bounded windows. A Section lead-in is included in its first
  subsection judgment instead of becoming a separate KP window; a Section without subsections is
  one window. AI cannot author Section, page, line, geometry, source-revision or source-range fields.
- Replaced the former packet `KEEP`/`MERGE`/`DROP` and repair chain with one final group-first result
  per window: `learning_targets[{unit_ids,title,one_sentence_meaning}]` plus `non_kp_units`.
  Validation requires exact, ordered, contiguous, once-only unit accounting and fails closed on
  invented IDs, missing units, extra fields or malformed/empty output.
- Made the semantic contract absorption-first: definitions, properties, ordinary steps, examples
  and terminology are absorbed unless separate teaching, assessment, diagnosis and remediation
  paths are justified. “本章小结” and “本节小结” windows cannot mint KPs; “常见问题”, “易混淆” and
  FAQ windows likewise remain non-minting review/support material.
- Materialize private KPs deterministically from the accepted unit grouping. Source ownership,
  continuous range and order come only from the evidence ledger.
- Retained all seven Chapter Review dimensions: granularity, coverage, duplicates, instructional
  specificity, split/merge quality, source/Section faithfulness and map-level balance. Review
  consumes the compact ledger, runs once, cannot rewrite candidates, and a valid FAIL terminates the
  preparation.
- Retained same-input, same-contract bounded technical retry for transport, empty/length-limited or
  structured-output failures. There is no result-driven absorption, cleanup, audit, repair,
  re-partition or re-review stage.
- Retained secret-safe generation-attempt telemetry and the minimum Reader Section progress UI.
  Request/response bodies, reasoning, credentials and private KP content are not persisted.
- Added the authorized OpenRouter Gemini Reviewer route without a new provider framework. External
  OpenRouter traffic requires an explicit proxy or the enabled Windows user proxy and fails closed
  when no safe proxy route exists or bypass is requested. Credentials continue to use the existing
  local environment storage and are never logged.
- Kept the existing durable job lifecycle, READY no-op, opaque IDs minted at first publication,
  source navigation, ownership/cascade rules and Chapter-atomic publication. No Learning, Mastery,
  Master, Teaching or ExamEvidence writes were added.

## Important implementation decisions

- One real Outline subsection receives one semantic judgment, with its owning Section lead-in
  included only in the first subsection. Technical retry repeats identical input; prior semantic
  output and Review findings never become another semantic pass.
- Summary/FAQ/misconception evidence remains useful source material but does not create an
  additional durable learning identity. No facet/attachment persistence model was introduced.
- The production default generator remains `deepseek / deepseek-v4-flash`. The accepted Chapter 3
  path used `openrouter / google/gemini-3.8-flash` for both clean-context generation and Review;
  no higher-tier model was used.
- `tools/kp_granularity_calibration.py` is retained only as a development-time regression aid. It is
  not a production stage, publication gate or correctness oracle.

## Deviations from Spec

The accepted Phase brief listed OpenRouter proxy/region work under Not now. During UAT the user
explicitly authorized the narrow exception needed to make Gemini available as the Knowledge Map
Reviewer, including reuse of the existing Windows proxy and credential mechanism. The change is
limited to the existing OpenAI-compatible provider adapter and does not create a new provider system,
dependency or fallback that can bypass the proxy.

No other product or publication authority changed.

## Acceptance evidence

Evidence followed the required order: TARGETED -> AGENT REAL-USE GOLDEN PATH -> AFFECTED ->
CLOSURE / BROAD.

- TARGETED: `python -m pytest tests/test_knowledge_map.py tests/test_ask_about_this.py -q` —
  **84 passed**. This covers one-pass window contracts, Section-lead-in ownership, strict unit
  accounting, deterministic
  materialization/source authority, terminal Review failure, same-input technical retry, safe
  observability, proxy fail-closed behavior, atomic publication, restart/idempotency and cascade.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:knowledge` — **PASS** on the served Reader with the
  real 348-page textbook. It exercised Chapter 6, Section progress with no partial KP exposure, a
  same-window `empty_response` retry, terminal Review FAIL, explicit user retry, atomic READY,
  source navigation, restart-stable IDs and cascade.
- REAL USER PATH: Chapter 2 used 226 deterministic evidence units in 17 windows and published
  **42 KPs in 3 Section groups** after one Review. Observed total duration was **40.51 seconds** with
  zero technical failures. Sections 2.4 “本章小结” and 2.5 “常见问题和易混淆知识点” each published
  **0 KPs**. The user inspected the complete map and declared `USER_ACCEPTANCE: PASS`.
- REAL USER PATH: isolated Chapter 3 used 251 deterministic evidence units in 25 windows and
  published **37 KPs in 6 Section groups** after one Review. Its Section lead-ins were judged with
  the first subsection, and the former duplicated virtual-memory introduction became one learning
  identity. Observed total duration was **155.45 seconds**; one bounded technical failure recovered.
  The source Library and its existing publication were not modified. The user inspected the full
  result and declared `USER_ACCEPTANCE: PASS`.
- REAL REVIEWER EGRESS: a real `google/gemini-3.8-flash` OpenRouter call succeeded through the
  configured `127.0.0.1:7890` Windows proxy. A deliberately unavailable proxy produced a typed
  network failure with no direct fallback. No credential or provider body was printed or retained.
- AFFECTED Python regression — **117 passed** across API, jobs, Map the Book, Ask About This,
  AI_SAVED explanations, annotations, Library and Foundation suites.
- AFFECTED served E2E: `npm run test:e2e:ask`, `test:e2e:r3`, `test:e2e:find`, `test:e2e:map`, and
  `test:e2e:save` — **PASS**.
- Real-material Reader/recovery E2E: `npm run test:e2e:r2` and `npm run test:e2e:recovery` —
  **PASS**. The first isolated `r2` attempt hit a transient SQLite `database is locked`; an
  unchanged-input rerun passed, and no product code was changed or failure reclassified.
- CLOSURE / BROAD: full `python -m pytest -q` — **142 passed, 2 skipped** (144 collected; the two
  unchanged skips are optional external real-OCR entrypoints). `npm test` — **30 passed**.
- FINAL STATIC CHECKS: `python -m compileall -q src`, Node syntax checks for both Knowledge E2E
  runners, `git diff --check`, and a staged secret/user-material inspection — **PASS**.
- INDEPENDENT NARROW REVIEW: **PASS** — `P0=0`, `P1=0`, `P2=0`;
  `CLOSURE_RECOMMENDATION: CLOSE`.

The complete-Section generation experiment was removed after real 3.2/3.5 responses exceeded the
existing structured-output budget. It is not part of the implementation or checkpoint. No provider
generation was performed after the accepted Chapter 3 run.

## Known limitations / deferred debt

At this Phase's closure READY regeneration remained blocked and no Learning/Mastery state was
written. The former identity-reconciliation prerequisite was superseded later on 2026-09-09 by
Product decision 69 and the
[`REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP`](./REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md) report.

## Reproducible entry points

```powershell
python -m pytest tests/test_knowledge_map.py tests/test_ask_about_this.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:knowledge
python -m pytest -q
npm test
```

Manual verification: open `http://127.0.0.1:8000`, choose an unprepared Chapter, open 学习地图,
observe stage plus `已完成 X/Y 个小节`, and verify that one complete Section-grouped map appears only
after Review PASS. A representative `回到教材` action must navigate to its published source anchor.

## Important files / architecture entry points

- `src/reader_service/knowledge/semantic.py` — evidence units/windows, group-first contract,
  deterministic materialization and compact Review ledger.
- `src/reader_service/knowledge/service.py` — one-pass subsection-window orchestration, one Chapter Review,
  deterministic validation and atomic publication.
- `src/reader_service/agent_runtime/deepseek.py` and `runtime.py` — existing provider runtime,
  model defaults and fail-closed OpenRouter proxy routing.
- `src/reader_service/static/index.html` — Knowledge Map provider configuration surface.
- `tests/test_knowledge_map.py`, `tests-e2e/knowledge-map.mjs` and
  `tests-e2e/knowledge-map-real-provider.mjs` — primary acceptance contracts.
- `tools/kp_granularity_calibration.py` — developer-only calibration/regression aid.

## Git checkpoint

Final implementation checkpoint: `9b3109a710a6fba77d4a395fa07f221086b9c97f`.
The docs-only closure checkpoint is the commit containing this final report; its exact hash is
recorded in the closure handoff.
