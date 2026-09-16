# Inline Teaching current-Section entry — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. No user-acceptance or independent-review PASS is claimed.
The user requested only the Inline Teaching toolbar entry change on the restored Reader.

## Implemented

`✦ 行间教学` replaces the checkbox and management trigger. No whole-book Section
selector. The existing Reader top reading anchor and resolved Section ranges determine
the target, independently of an open Guidance card's source. No Section means no guessed
fallback. Click generates absent teaching, toggles published visibility locally, retries
technical failure at its owned stage, or starts a new candidate after terminal failure.
Generation/Review/pending states block duplicate submission and expose lightweight labels.
An async snapshot cannot generate for a Section the user has already left.

Product changes are limited to `static/inline-ui.js` and Inline-specific toolbar CSS in
`static/styles.css`. Other toolbar controls, app.js, PDF rendering/layout, anchoring,
Guidance/Assistant source lineage, Review, persistence and regeneration backend are unchanged.

## User-confirmed secondary action

The user explicitly retained manual regeneration through a lightweight `···` button,
visible only when current-Section teaching is READY. Its menu contains only “重新生成”.
No right-click or Shift+F10 handler. Ordinary click remains generate/On/Off/failure retry.
The secondary menu closes on Section change, pending work, failure, Escape, outside click,
toolbar scroll or resize. It cannot regenerate a Section different from the one that
opened it. Keyboard Enter opens the secondary action and Escape returns focus.

## Verification so far

- `tests-js/inline-entry.test.js`: async double-click and navigation race, DRAFT/Review/
  publication, local Off/On, no-Section and technical/terminal failure action tests PASS.
- `npm test`: **38 passed**.
- `tests/test_inline_teaching.py`: **20 passed**.
- Broad Python: **283 passed, 2 existing optional OCR skips, 137.65s**;
  `test-results/inline-entry-closure.xml`.
- `tests-e2e/inline-teaching.mjs`: **PASS**, real 348-page Library in disposable copy
  `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-PNbdDN/data`. Real Outline/page/
  wheel navigation into Section, direct generation, Review, published markers/cards,
  Off/On, restart, existing Guidance → Assistant selection, source return, zoom/narrow,
  Guide coexistence, failed replacement preservation and toolbar retry, non-KP generation.
  Failed replacement is requested through `···` → “重新生成” with AI disabled;
  retry uses the real main toolbar button. The menu contains exactly one action, supports
  Enter/Escape and disappears on failure. Provider calls use loopback mocks, not live external models.
  Existing published assets, Guide/Learning tables and payload allowlists verified unchanged.
  Menu screenshot `test-results/inline-entry-menu.png` visually inspected. The menu uses
  the original Reader-level overlay host so PDF-local controls cannot cover its click target;
  toolbar/PDF stacking and layout rules are unchanged.
- `tests-e2e/reader-restoration.mjs`: PASS, unchanged raw PDF canvas pixels and 920 × 1282
  canvas/CSS size; viewer and Outline/Search/Marks geometry match baseline at
  1600/1280/1024px. Screenshot inspected. Toolbar height remains 68px at 1600px.
- Syntax and whitespace checks PASS. Original user Library is not mutated by these tests.

The existing Outline jumps to a Section's page rather than its vertical heading offset;
the real test then wheels into the actual Section range. No Outline navigation changes.
This is a local entry change; no new source/persistence/Review authority or dependencies.
No fresh independent core review invoked. Existing backend invariant coverage retained.

## Retest and checkpoint

Refresh **http://127.0.0.1:8767/** using the existing `var/manual-browser` Library.
Check current-Section generation → Review → displayed markers → Off → On; READY-only
`···` → regenerate; failed work retries through the main button and preserves old publication.
The commit containing this report is the checkpoint. Stop for user retest; no additional
Reader redesign is authorized. Existing narrow-screen toolbar behavior is unchanged.
