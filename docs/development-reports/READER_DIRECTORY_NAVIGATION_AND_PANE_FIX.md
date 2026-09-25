# Reader Directory Navigation and Pane Fix Development Report

## Result

Directory has a fixed 304px desktop width, with no resize control, right border, or gray gutter against the PDF stage. Clicking a valid Outline item immediately marks that item current; subsequent reading scroll updates the highlight from the actual position. The user accepted this repair on 2026-09-25.

## Implemented

- Removed the Directory resize handle and its non-Practice width update path. Practice Rail keeps its separate resize handle and behavior.
- Removed the 24px Directory grid gap and right border. While Directory is open, the adjacent viewer background matches the pane.
- A Directory click synchronizes the current item at the projected destination. While its landing pin is active, the clicked node owns the highlight despite CSS-pixel rounding at a same-page boundary; user scrolling releases the pin and resumes range-based tracking. No Outline identity or source positions were changed.
- Added a focused real-book browser check for 5.4.2, same-page neighbors, other subsections, Directory geometry, and Practice Rail resize. Made the existing Directory suite independent of the Library's saved starting zoom and chapter.

## Acceptance evidence

- `node --test tests-js/directory-presentation.test.js`: 3/3 PASS.
- `node --check src/reader_service/static/app.js`: PASS.
- `node tests-e2e/directory-current-target.mjs` with `READER_DATA_DIR=var/manual-browser`: PASS. Used the real 348-page computer-organization and 412-page data-structures textbooks; checked 5.4.2 in both, adjacent subsection clicks and scroll tracking, landing coordinates, fixed Directory width/no gutter, and Practice Rail dragging.
- `node tests-e2e/directory-pane.mjs` with the same fixture: PASS. Includes margin/split/navigation modes and 250 click/highlight probes across the three-book Library.
- User manual acceptance: PASS (2026-09-25).
- Full unrelated test suite: `INTENTIONALLY_NOT_RUN` — this repair changes Directory presentation and click tracking, covered by its targeted tests and corpus-wide Directory regression.

Label: `IMPLEMENTATION_READY`.

## Reproducible entry points

- Both browser checks copy `var/manual-browser` into an isolated temporary Library before starting the Reader service.
- In PowerShell, set `$env:READER_DATA_DIR='var/manual-browser'` before running either browser check above.
- In the Reader, open 《2026计算机组成原理》 → 目录 → `5.4.2 硬布线控制器`; scroll into `5.4.3` and back toward `5.4.1`. Open Practice at PDF page 20 to verify its left drag handle still works.

## Important files / architecture entry points

- `src/reader_service/static/app.js`: Directory click, current-item derivation, layout width calculations.
- `src/reader_service/static/index.html`, `styles.css`, `screens.css`: Directory handle and pane/viewer presentation.
- `tests-e2e/directory-current-target.mjs`, `directory-pane.mjs`: focused and corpus-wide browser regression.

## Git checkpoint

This report is included in the same independent checkpoint commit as the repair.
