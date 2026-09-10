# Reviewed Section Reading Guide Development Report

## Result

`IMPLEMENTATION_READY / READY_FOR_USER_RETEST` — 2026-09-10.

One resolved Section can explicitly generate a concise Reading Guide. Only a complete candidate
that passes independent AI Review publishes. Source buttons return to the actual PDF evidence;
Guide selection opens the existing temporary Assistant. Closing/restarting restores the published
Guide. Failed or pending regeneration keeps the previous published version readable.

**USER_ACCEPTANCE PENDING. Independent narrow code acceptance PENDING. Phase closure PENDING.**
The live AI content Review described below is not independent code acceptance. The accepted brief
requires that separate narrow audit before closure; no audit invocation or independent PASS is claimed.

## Implemented

- Migration 14 adds Section-owned Teaching versions, a current-publication pointer and page-scoped
  FoundationEvents. Existing jobs gain `TEACHING_GENERATE` / `TEACHING_REVIEW`; the same durable job
  changes stage. Single-winner claims, startup requeue, request replay and Section-local concurrency
  reuse the existing SQLite worker architecture. Published content is immutable; pointer replacement
  and publication commit together. All versions cascade with their owning book.
- Deterministic evidence construction reads only the resolved real Section's half-open physical
  range, its parent positioning, and optionally its own READY KP ledger. No Learning, Master,
  Annotation, Assistant or profile state enters generation or Review. The actual KP version is
  recorded only when the ledger was supplied.
- Server-owned source IDs resolve to persisted revision/page/geometry/quote provenance. Strict JSON,
  exact fields, required route/exit modules, bounded text and reference validation precede Review.
  Foreign IDs, model-authored locators, unsupported quoted wording and exam-weight language fail.
  Review receives newly assembled allowlisted evidence, returns only a verdict and scoped issues,
  and cannot rewrite content. Rework replaces only rejected modules; three semantic FAILs terminate
  the candidate. Technical retry resumes the failed stage without consuming that counter.
- Source freshness uses declared node revisions, actual optional KP version and page-footprint
  events, with source fingerprints as a defensive check. Changed existing OCR publications append
  a page-local event and advance Foundation ordering; initial OCR preparation does not. Identical
  evidence keeps its source IDs across ordering-version changes. Unsafe source links are visibly
  unavailable; the saved Guide itself remains available with an update offer.
- The directory's Section row offers `导读`, with generate/open/close/retry/regenerate controls.
  Clicking a source revalidates it and closes the Guide so the original PDF is visible. Polling does
  not replace the old published DOM during regeneration. Directory refresh preserves expansion so
  background preparation cannot collapse the entry while it is being clicked.
- Guide selections are checked against the current published module on the server. They create a
  `READING_GUIDE` Assistant Root with no PDF quote/anchor and no durable Assistant history. Saving
  these unanchored explanations as PDF notes is unavailable; existing PDF-selected note saving is
  unchanged. User-facing controls and messages are Simplified Chinese.

## Important implementation decisions

- One direct System call per bounded generation stage; no planner, RAG, streaming, Inline Guidance,
  assessment, exam-evidence subsystem, new dependency or imported external code.
- Input bounds: at most 31 physical pages, 40,000 OCR characters and 1,600 evidence lines. Oversize or
  incomplete input fails honestly rather than truncating the Section. Output: 2–6 content-selected
  modules, mandatory route/exit, at most 2,200 body characters and 1–8 sources per module.
- Routing uses `GUIDED_READER_SYSTEM_PROVIDER` (default DeepSeek) and the existing
  `GUIDED_READER_REVIEW_PROVIDER` (default Zhipu). Guide-specific completion budgets are 16,384 / 8,192
  tokens including provider reasoning; they do not change other capabilities' provider settings.
  A `finish_reason=length` response is rejected even if it happens to parse. Structured-output retry
  is bounded to two calls per stage, in addition to the runtime's bounded transport retry.
- The brief's completed DeepTutor/STORM/OpenStax prior-art remains the basis: bounded Section unit,
  deterministic evidence IDs, generation/Review separation and reviewed atomic publication. During
  real-provider diagnosis, inspected [DeepSeek Thinking Mode documentation](https://api-docs.deepseek.com/guides/thinking_mode)
  and the existing Knowledge runtime call sites. Used the existing per-call budget facility; did not
  import pipelines, source code, new parsers or provider frameworks.

## Deviations from Spec

No product-scope deviation. Narrow code acceptance remains a separate pending pre-closure gate.
Legacy tests that asserted Teaching tables were absent now assert the tested paths leave them empty.
Historical migration tests target their stated migration or enumerate the old database's tables.
The Master E2E now waits for the actual confirm HTTP response: its old status-text predicate was
already true after Section bulk confirmation and could race the Topic write.

## Acceptance evidence

- TARGETED: **18 Guide tests PASS**, covering strict contracts, independent Review shape, retry and
  semantic limit, concurrent duplicate requests, atomic rollback, source changes during Review,
  optional KP dependency, scoped staleness, immutable evidence IDs, source degradation, HTTP auth,
  recovery, cascade and populated migration 13→14 preservation. Foundation/Annotation affected
  subset also passed (**36 tests** before the final added source-ID test).
- AGENT REAL USE, controlled HTTP providers: final `test:e2e:guide` **PASS** using a consistent
  disposable copy of the user's real **348-page** textbook. Source SHA-256:
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  Real pointer selection, existing Assistant send, every rendered source button, Reader close,
  service restart, generation failure, stage retry and atomic replacement passed. Section 6.1
  generated without READY KP and without a claimed/sent/persisted Chapter structure version.
- LIVE: `GUIDE_E2E_REAL=1` **PASS**. DeepSeek `deepseek-v4-flash` generated the Guides for
  `*1.1 计算机发展历程①` and `6.1 总线概述`; Zhipu `GLM-5.3-Flash` independently returned **PASS**
  for both, with **0 semantic rework cycles**. Inspected actual content: Section-specific reading
  actions and exit criteria, selected modules, no padded fixed template. The failure/replacement
  part deliberately used controlled HTTP providers; it is not claimed as a live replacement call.
- Actual wire inspection verified **7** successful Guide generation/Review bodies from the live
  run and **6** from the controlled run against the exact Section allowlist and durable source-ID
  ledgers. No unrelated Section or user-state fields, credentials, headers or streaming were sent.
  Test-only `guide_runner.py` captures requests/responses in the disposable Library; normal service
  startup does not persist those bodies. Generator reasoning is never passed to Review.
- Final source-ID refinement was followed by the final controlled real-book run and full regression.
  Also reopened the actual live-published 6.1 Guide on final code and followed its source successfully.
  Inspected `test-results/reading-guide-live.png` (ignored personal-material artifact).
- AFFECTED real-use: Assistant E2E **PASS** (temporary roots/children, Back, close, payload isolation,
  AI-off selection/search/navigation); Master E2E **PASS** (KP/Section history, `[PASS, PASS]` controlled
  Section reviews, confirmation, restart, retry, source/UI isolation).
- Final CLOSURE/BROAD check, without claiming closure: **232 Python PASS / 2 unchanged optional
  real-OCR skips**; **30/30 frontend PASS**. `git diff --check` passed.
- Earlier failures remain failures: missing static-module allowlist entry; directory refresh/entry
  layout; E2E source-page and POST-completion synchronization; live output exceeding reference count,
  token truncation and unsupported quotation/style output. Each was diagnosed and corrected. No
  failed candidate was published, and none was reclassified as a Review PASS.

## Known limitations / deferred debt

The bounded Guide is not a universal document generator: unresolved/missing/oversize Section evidence
or provider failure can prevent generation while PDF reading continues. Deterministic wording checks
cover the supported reference/quotation forms; semantic academic correctness still requires the
mandatory Review and user retest. No OCR correction UI, figure/formula understanding, RAG, exam
weighting, Inline Guidance or persistent Assistant workspace was added.

## Reproducible entry points

```powershell
python -m pytest tests/test_teaching.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
$env:READER_CHROMIUM='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e:guide
$env:GUIDE_E2E_REAL='1'
npm run test:e2e:guide
Remove-Item Env:GUIDE_E2E_REAL
npm run test:e2e:ask
npm run test:e2e:master
python -m pytest -o addopts='' -q
npm test
```

Retest service: **http://127.0.0.1:8766/**. Refresh, open the 348-page book, expand a Chapter in the
directory, and click a Section's `导读`. Generate, follow a source, reopen, select a phrase for
Assistant, close/reopen the Reader, and explicitly regenerate. Section 6.1 exercises the non-READY
KP path. Live generation can take several minutes including independent Review.

Before refreshing the service, verified backup
`var/manual-browser/state.sqlite3.pre-reading-guide-20260910.bak`; no pending Master calls or running
jobs existed. Migration 14 integrity/FK checks pass. **All 19 original tables' original columns/rows
match their pre-migration hashes.** New Teaching tables are empty in the source Library; test Guides
and test Learning state stayed in disposable copies. Port 8000 was not touched.

## Important files / architecture entry points

- `src/reader_service/teaching/{schema,evidence,contracts,service}.py`
- `src/reader_service/jobs/worker.py`, `foundation/repository.py`, `library/database.py`
- `src/reader_service/server.py`, `__main__.py`, `assistant/service.py`
- `src/reader_service/static/guide-ui.js`, `app.js`, `styles.css`
- `tests/test_teaching.py`, `tests-e2e/{reading-guide.mjs,guide_runner.py,guide_verify.py}`

## Same-Phase style retest — 2026-09-10

- User requested a one-page prereading guide instead of dense lecture notes. Changed only the
  generator's pedagogical prompt: 3–5 route stages, 4–6 driving questions, short prerequisites,
  3–5 pitfalls and 4–6 grouped exit goals, with distinct module responsibilities. No runtime,
  schema, reviewer, validator or skill-version changes.
- Submitted exactly one real UI regeneration for `2.1 数制与编码` in the 348-page textbook on
  port 8766. Version 2 published after real independent content Review **PASS**, with zero
  semantic reworks. Actual body: 989 characters; 5 route stages, 6 questions, 2 prerequisite
  sentences, 5 pitfalls and 6 exit goals. The former version remained available during generation.
- Real pointer-path regeneration, source jump and close/reopen **PASS**. Exact published text and
  screenshot are local ignored artifacts `.tmp/guide-2.1-preview.md` and `.tmp/guide-2.1-style.png`.
  Backed up the Library before restarting the prompt-bearing service; port 8000 was untouched.
- TARGETED: 18 Guide tests PASS. BROAD: 232 Python PASS / 2 unchanged optional OCR skips;
  30 frontend PASS. Prompt style still requires user retest; content Review does not constitute
  user acceptance or independent code acceptance. Status remains **READY_FOR_USER_RETEST**.

## Git checkpoint

The commit containing this report is the implementation/retest checkpoint. Its exact hash is supplied
in the handoff. It does not close the Phase or declare user/independent acceptance.
