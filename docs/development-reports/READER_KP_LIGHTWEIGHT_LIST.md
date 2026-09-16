# Reader lightweight Chapter KP list — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. User acceptance is pending.
Retest at http://127.0.0.1:8767/ after refresh.

## Implemented

- Current Chapter READY entry displays total published KP count and opens a read-only
  Reader overlay. Section groups show KP titles, authoritative learning status and PDF
  source actions. Missing status/source remains explicitly unavailable. No management,
  regeneration, mastery writes or draft KP display is added to this list.
- Close, Escape, source navigation, Chapter/revision departure and the footer Overview
  action close the overlay. Asynchronous list responses cannot cross chapter lifetimes.
  The footer retains the existing save-position / Reader-close lifecycle.
- Toolbar buttons are 32px high with shared padding; icon-only controls are 32px square.
  Notes now uses a local inline SVG sticky-note drawing. Existing controls and progress
  keep their semantics and hidden/active states. No new dependency or static endpoint.
- Existing Chapter preparation/retry and genuine phase/count projection are reused.
  No backend, schema, model routing, source authority, PDF geometry, Outline/Search,
  Assistant/Master or Inline Teaching business logic change.

## Acceptance evidence

- `node --test tests-js/chapter-entry.test.js`: PASS; departed context, duplicate clicks,
  Chapter total, local READY list, authoritative status/source and footer ownership.
- `tests-e2e/reader-restoration.mjs`: PASS on real 348-page textbook (SHA256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`).
  47 published KPs displayed inside Reader; source jump, reopen and Overview footer
  exercised. Controlled phases/failure/retry check every projected stage.
  Canvas bitmap identical to stable `92febf6`; 920 × 1282 canvas, 68px toolbar;
  PDF/viewer and Outline/Search/Marks geometry unchanged at 1600/1280/1024px.
  All toolbar button heights and icon squares asserted; screenshots visually inspected.
- `READER_KP_LIST_ONLY=1 node tests-e2e/knowledge-map.mjs`: PASS on disposable SQLite
  backup and real source blobs. Actual Chapter 6 preparation pipeline, generator retry,
  structural Review failure, toolbar retry, successful publication of 7 KPs, local list,
  PDF jump and Overview. Observed real queued/source/generating/reviewing stage changes.
  Provider transport uses the existing loopback fixture; zero external provider calls.
  This proves runtime wiring and recovery, not live model quality.
- `tests-e2e/inline-teaching.mjs`: PASS, real source with loopback generator/Review;
  generation, display/off/on, regeneration failure/retry, source and Guide/Assistant flow.
- Broad closure: `npm test` 39 PASS; Python 283 PASS / 2 existing optional OCR skips,
  163.519s, `test-results/reader-kp-list-closure.xml`.
- `git diff --check` PASS; existing port 8767 responds with current assets.

All mutations used disposable libraries. Initial outdated READY-to-Overview assertions
were updated to the requested local-list contract before passing. The Knowledge harness
now backs up SQLite safely and resets only FAILED preparations in this bounded mode;
existing learned structures remain intact.

## Reproduction and checkpoint

Set `READER_DATA_DIR=D:\codex\408-guided-reader\var\manual-browser` for real harnesses;
set `READER_CHROMIUM` to installed Edge if not autodetected. The Knowledge toolbar mode
uses `READER_KP_LIST_ONLY=1`. Screenshots are ignored under `test-results/reader-kp-list.png`.
Implementation entry points: `static/screens.js`, `screens.css`, `index.html`, `app.js`.
The commit containing this report is the checkpoint. Stop for user retest.
