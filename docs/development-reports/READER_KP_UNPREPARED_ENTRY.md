# Reader unprepared Chapter KP entry — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. No user acceptance claim. Refresh http://127.0.0.1:8767/.

## Fix

The toolbar chapter resolver required a fully RESOLVED Chapter or Section. Never-prepared
Chapters have PARTIAL Outline bookmarks with a start page but no exact vertical/end range,
so their entry was hidden before preparation could be requested.

When no exact context exists, uniquely owned page-level Chapter bookmarks now identify the
Chapter to prepare. The next Chapter bookmark ends that navigation context. Duplicate
start-page ambiguity stays unavailable. No exact ranges are invented or persisted; existing
Chapter preparation still resolves and validates its own source evidence.

The same entry shows `＋ 生成本章知识点`, genuine preparation stages, `生成失败 · 重试`,
or `N 个知识点`; READY retains the local read-only list. No backend, schema, KP identity,
freeze/publication, source authority, PDF geometry, CSS or other Reader control changes.

## Evidence

- Targeted Chapter entry tests: 2 PASS. Preparation duplicate-click/context isolation,
  READY list/source navigation, PARTIAL bookmark boundary and ambiguity covered.
- Broad regression: npm suite 39 PASS before adding the extra bookmark test (both updated
  Chapter tests then PASS); Python 283 PASS / 2 existing optional OCR skips, 162.233s.
  XML: `test-results/reader-kp-unprepared-closure.xml`.
- `tests-e2e/reader-restoration.mjs`: PASS. Original PDF canvas pixels and 920 × 1282
  rendering remain identical to stable baseline; 68px toolbar and three-width panel
  geometry unchanged. All state labels and local READY list work.
- `READER_KP_LIST_ONLY=1 node tests-e2e/knowledge-map.mjs`: PASS on a disposable backup
  of the real 348-page textbook, SHA256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  Chapter 5 中央处理器 was asserted PARTIAL and NOT_PREPARED before clicking the toolbar.
  Actual source resolution/generation pipeline -> structural Review FAIL -> toolbar retry
  -> READY with 25 KPs -> local Reader list -> source PDF -> Overview. Stages observed
  across all 9 Sections. Existing loopback provider exercises the actual pipeline;
  zero external calls, no live-model quality claim. User library was not mutated.
- Syntax/whitespace checks PASS. Existing serving process uses current frontend files.

## Existing preparation failures observed, outside this UI fix

Two earlier real-material attempts did not reach READY and are not counted as PASS:
computer-organization Chapter 4 stopped at DETERMINISTIC_VALIDATION /
`deterministic_validation_failed`; data-structures Chapter 4 stopped at RANGE_RESOLUTION /
`HEADING_NOT_RESOLVED`. The toolbar exposed these failures and allowed retry. Their exact
backend cause was not adjudicated by this UI fix; no validation gate was bypassed here. The later
data-structures heading-resolution investigation and correction is recorded in
[`CHAPTER_HEADING_RESOLUTION.md`](./CHAPTER_HEADING_RESOLUTION.md).

## Reproduce / checkpoint

Use the existing Reader on an unprepared Chapter, including its initial title page.
The real harness uses `READER_DATA_DIR=var/manual-browser`, `READER_KP_LIST_ONLY=1` and an
installed `READER_CHROMIUM` path. Commit containing this report is the checkpoint.
