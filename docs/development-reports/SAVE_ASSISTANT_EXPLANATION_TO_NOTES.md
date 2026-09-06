# Save Assistant Explanation to Notes Development Report

## Result

`IMPLEMENTATION_READY` / `AGENT_REAL_USE_PASS` / `READY_FOR_USER_RETEST` /
`READY_FOR_NARROW_INDEPENDENT_REVIEW`.

Users can explicitly save one completed Root or Child Assistant answer as a durable, visibly
AI-authored Annotation. The save commits before Review begins. Marks presents SOURCE, PROVENANCE,
and AI CONTENT separately, and Review changes only verification metadata on that same asset.
Assistant conversations remain process-memory-only.

This report does not claim `USER_ACCEPTANCE PASS` and does not close the Phase.

## Implemented

- Added migration 7 for `AI_SAVED` Annotation rows: durable save-intent identity, exact AI content,
  separate provenance/grounding JSON, bounded verification metadata, and the existing owning-revision
  cascade. Existing USER rows are copied field-for-field, and any non-empty pre-migration Annotation
  table receives a verified SQLite backup before rebuild.
- Added a one-turn Assistant projection that copies the Root's resolved Original-PDF anchor. Child
  focus and concept path enter only PROVENANCE; no Root, Child, sibling, descendant, or conversation
  state is persisted.
- Added commit-first save and post-commit Review services plus save/retry HTTP endpoints. Review input
  is reconstructed from a strict field allowlist, structured verdict validation has bounded attempts,
  and semantic or technical failure preserves the asset unchanged.
- Added startup recovery for an interrupted durable `PENDING` Review. A new service marks it as the
  honest retryable `TECHNICAL_FAILURE / review_interrupted` state without making a network call or
  changing SOURCE, PROVENANCE, or AI CONTENT.
- Added per-completed-turn 「保存到笔记」 controls, immediate save feedback, distinct AI_SAVED Marks,
  verification/retry UI, SOURCE page navigation, and existing scoped deletion/reopen behavior.

## Important implementation decisions

- `save_intent_id` is a durable unique idempotency key. Concurrent clicks, HTTP retries, and
  response-loss replay converge on one Annotation; Review retries update that row only.
- Reviewer routing uses `GUIDED_READER_REVIEW_PROVIDER` exactly and never falls back silently.
  Provider/model identity is recorded only from the attempted or completed Review route.
- The Review thread starts only after the Annotation transaction has committed. A scheduling failure
  is itself recorded as retryable technical metadata rather than being returned as a failed save.
- No generic job/workflow system and no new dependency were introduced.

## Deviations from Spec

None. Prior-art remained `NOT_NEEDED`; no product direction was reopened.

## Acceptance evidence

- TARGETED: `python -m pytest -q tests/test_saved_explanations.py tests/test_annotations.py
  tests/test_api.py` — **28 passed**. This covers Root/Child promotion, exact anchor/provenance/content,
  concurrent idempotency, commit-before-blocked-Review, PASS/FAIL/timeout/auth/cooling/invalid verdict,
  retry-in-place, migration preservation/backup, interruption recovery, ownership, delete and cascade.
- AGENT REAL-USE GOLDEN PATH: `npm run test:e2e:save` — **PASS** through the served UI with real pointer
  selection on the 348-page textbook, SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`. It saved the Child
  `像乐队里的节拍器`, observed immediate PENDING save success, verified SOURCE `时钟脉冲信号` on PDF
  page 25, separate Child PROVENANCE and exact AI CONTENT, preserved the asset through injected Review
  failure, retried the same Annotation to PASS, cleared the Assistant tree across restart, reopened the
  durable asset, then deleted it and confirmed absence after a second restart. Screenshot:
  `test-results/saved-explanation-golden.png`.
- REAL REVIEWER: the same guarded browser path with `READER_REAL_REVIEW=1` — **PASS**. The Assistant
  remained loopback-only; Review made exactly one bounded external call through the configured Windows
  Credential Manager route to `zhipu / GLM-5.3-Flash`. Inspection contained no Authorization header or
  credential value. The provider returned a valid `PASS`, and the actual UI plus durable metadata
  updated honestly. This is an AI verification result, not textbook authority or mastery evidence.
- AFFECTED REGRESSION: 83 Python Annotation/Assistant/API/Search/Map tests — **PASS**;
  `npm run test:e2e:r3` and `npm run test:e2e:ask` — **PASS**; Assistant workspace and rendering suites
  — **PASS**; Find and Map real-book smoke paths — **PASS**. These cover R3 create/list/delete/restart,
  selection/context menu/Marks, Assistant identity/source/lifecycle, provider routing/failure/secret
  hygiene, Markdown/math/sanitization, and Reader UI integration.
- CLOSURE / BROAD: `python -m pytest -o addopts= -q -ra
  --basetemp=test-results/pytest-save-final` — **117 passed, 2 skipped**. The skips are unchanged optional
  external OCR checks because `READER_REAL_DMA` and `READER_REAL_PRIMARY` were not set; OCR calibration
  is outside this Phase, while the required prepared 348-page real-material UI path did run.
- `npm test` — **30 passed**. `python -m compileall -q src`, JavaScript syntax checks, pinned dependency
  inspection, and `git diff --check` — **PASS**.
- The user has not yet performed UAT. The required narrow independent review was deliberately not run
  by the Implementer and remains the next review gate.

## Known limitations / deferred debt

- Review is non-streaming and single-item only. A semantic FAIL is durable metadata and has no rewrite
  loop in this Phase.
- Assistant history, whole-tree save, Mastery/Progress/Learning History, Teaching assets, multimodal
  explanation, and default-provider/OpenRouter decisions remain out of scope.

## Reproducible entry points

- Targeted: `python -m pytest -q tests/test_saved_explanations.py tests/test_annotations.py
  tests/test_api.py`
- Broad: `python -m pytest -o addopts= -q -ra --basetemp=test-results/pytest-save-final`
- Deterministic real-book UI: set `READER_DATA_DIR` to the prepared two-book Library, then run
  `npm run test:e2e:save`.
- Explicit real-review smoke, only when the configured credential is authorized for use: also set
  `READER_REAL_REVIEW=1`. The script limits Zhipu transport attempts and does not send Assistant calls
  externally.
- Manual replay: open the 348-page book, select `时钟脉冲信号` on PDF page 25, create Child
  `像乐队里的节拍器`, save that completed answer, inspect all three Marks sections and Review state,
  close Child/Root/Reader, restart, reopen/delete, then restart once more.

## Important files / architecture entry points

- `src/reader_service/saved_explanations.py` — commit-first promotion and allowlisted Review lifecycle.
- `src/reader_service/assistant/service.py` and `assistant/context.py` — one-turn projection and Root
  source-anchor retention in temporary memory.
- `src/reader_service/annotation/` — AI_SAVED validation, persistence, verification updates, recovery,
  idempotency, ownership, and deletion.
- `src/reader_service/library/database.py` — migration 7 and verified pre-migration backup.
- `src/reader_service/server.py` — save and Review-retry HTTP contracts.
- `src/reader_service/static/app.js` and `styles.css` — save controls and separated Marks presentation.
- `tests/test_saved_explanations.py` and `tests-e2e/saved-explanations.mjs` — authoritative Phase test
  and golden-path entry points.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its exact hash is recorded in the
completion handoff.
