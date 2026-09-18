# KP entry and exercise-window correction — 2026-09-18

## Result

`READY_FOR_USER_RETEST` for this bounded follow-up; no new Phase or user-acceptance claim.
The Reader hides KP generation on existing auxiliary Outline roots, while genuine PARTIAL Chapters
remain eligible. Exercise-selection windows cannot mint duplicate learning identities.

## Cause and implementation

- The reported data-structures Chapter 2 attempt had one blocking Review finding: a separate
  `试题辨析` KP repeated the existing linear-list definition. A later unchanged-code attempt passed
  with 27 instead of 28 candidates. Both Review runs also incurred a transient network failure;
  network failure and semantic rejection are separate outcomes, not proof of an overly strict gate.
- `本节试题精选` was not recognized by the existing non-minting window rule. Added `试题精选` to that
  same rule and clarified its generator contract. Unit accounting remains complete; invented targets
  fail the existing validator. No repair/review loop or relaxed Review standard was introduced.
- Existing PDF bookmarks classify front-matter roots as CHAPTER. The Reader now reuses its existing
  `isAuxiliaryOutlineRoot` presentation predicate; bookmarks still bound navigation before exclusion,
  so an auxiliary page cannot inherit the preceding Chapter's generation button. Overview's initial
  fallback likewise selects a non-auxiliary Chapter.
- The preparation transaction rejects a not-READY root without any real primary Section before
  writing a job or preparation row. The READY no-op is preserved. No Outline identities/ranges,
  published KPs, Learning state, source data, schema or visual styles are rewritten.
- UI/UX skill guidance was limited to contextual action consistency and error prevention; no
  directly matching search result was found, and no design system or style changes were applied.

## Evidence

- TARGETED: `python -m pytest tests/test_knowledge_map.py tests/test_map_the_book.py -o addopts='' -q`
  — **38 PASS**. Includes non-minting exercise windows and rejection without job/Outline/KP writes.
- Frontend: `node --test tests-js/chapter-entry.test.js` — **2 PASS**; `npm test` — **51 PASS**.
  The pre-existing Chapter-entry test fixture lacked its required Reader container; only the fixture
  was corrected, and auxiliary-boundary assertions were added to the existing resolver test.
- REAL USE: `node tests-e2e/kp-front-matter.mjs` — **PASS** with a disposable backup of the actual
  412-page book, revision `9830db77-6811-45cb-822c-f54f3321450a`. Copyright/TOC entries hidden;
  READY list opens/closes; PARTIAL Chapter entry remains; return to TOC hides it; direct preparation
  request returns 400; Outline snapshot unchanged. Screenshot inspected:
  `test-results/kp-front-matter.png` (ignored user material).
- The first browser run failed because its book button locator used the older accessible name;
  updated to the actual `打开教材 …` label, then the complete run passed. Not counted as an initial PASS.
- External providers were disabled throughout the new browser test. No new live-model semantic or
  Review call was made; deterministic prevention is proven, but an improved overall live approval
  rate is not claimed. The historical Review FAIL remains FAIL. No automatic retry of user Chapters.
- BROAD: `python -m pytest -o addopts='' -q` — **329 passed / 2 unchanged optional OCR skips**;
  `git diff --check` PASS. The already-listed frontend broad result is 51/51.
- Retest service refreshed at port 8767 (HTTP 200) after verifying no queued/running jobs or pending
  Master messages and taking a consistent SQLite backup. Outline, published KP, preparation and
  all checked Master/KP-status/event/Section-state rows exactly match the pre-restart backup.
  Only the approved native DeepSeek `deepseek-flash` and OpenRouter `google/gemini-3.8-flash` routes
  were configured; Zhipu is disabled. No live generation was triggered by this work.

## Reproduce and boundaries

Set `READER_DATA_DIR` to the existing prepared Library, then run the commands above. The browser
script copies blobs and backs up SQLite into a temporary directory; never use the live Library as
a write-test fixture. Retest service is `http://127.0.0.1:8767/`.

This is a narrow reuse of known auxiliary titles and the existing non-minting marker rule, not a
generic document classifier. Novel unlabeled front matter and live provider networking are not
solved by this change. No prior published map is regenerated or cleaned up.

## Git checkpoint

The commit containing this report is the implementation checkpoint; exact hash is in the handoff.
