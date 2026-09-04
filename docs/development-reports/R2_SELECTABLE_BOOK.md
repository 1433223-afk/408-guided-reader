# R2 — Selectable Book Development Report

## Result

`IMPLEMENTATION_READY` — scanned textbook pages prepare progressively in the background. A prepared
page gains a line/cell overlay that supports pointer hit-testing, mouse or keyboard range extension,
cross-line selection, and normal browser copy. The original PDF canvas remains the only reading
surface and continues rendering, scrolling, zooming, and navigating before preparation finishes or
when one page fails.

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` — the available 29-page real scan completed successfully,
including a real process-kill/restart run. The frozen ~700-page criterion is still untestable because
that material has not been supplied; sustained preparation and recovery at full-book scale remain
pending.

The implementation is `READY_FOR_NARROW_ZCODE_REVIEW`. That review has not been run. Its scope remains
exactly the R2 brief's three load-bearing contracts: storage/geometry shape, the anti-fragment
invariant, and the OCR adapter boundary.

## Implemented

- Foundation schema and repository for `OCRPage` and `OCRLine`, plus baseline
  `BookSourceRevision.foundation_version = 1`. Existing R1 revisions migrate to the same baseline.
- Cells stored only as compact anonymous `(x_start, x_end, char_index_start, char_index_end)` arrays
  inside each line row. There is no cell/word table, ID, repository, endpoint, or first-class domain
  type.
- Conservative per-page routing: trustworthy positioned embedded text is used directly; sparse,
  replacement-heavy, unpositioned, or absent text falls through to OCR. Route is persisted as
  evidence.
- Provider-neutral `OcrEngine` port and one RapidOCR 3.9.2 adapter using PP-OCRv6 small
  detection/recognition on ONNX Runtime. All provider field names, shapes, and library types are
  translated inside that adapter.
- 200-DPI service-side page rendering with pypdfium2, normalized top-left line quads, derived
  x-only cells sharing line y geometry, and deterministic geometric reading order with conservative
  column detection.
- Minimal durable Jobs context with `PAGE_PREPARE` only, one-page bounded batches, configurable
  1–4 worker pool (default 1), conditional-update claiming, visible/near/background priorities,
  startup requeue, cooperative cancellation, explicit per-page retry, and progress derived only from
  `OCRPage.status`.
- Same-origin per-page status SSE and overlay JSON. Prepared visible pages gain selection immediately;
  failed pages show a retry control without covering or disabling the PDF.
- Reader selection resolves pointer positions to nearest cell boundaries, represents cross-line
  selections as per-line ranges, draws normalized quads, and writes the resolved text to the browser
  clipboard. Reload reconstructs geometry from persisted lines.

## Important implementation decisions

- `PAGE_PREPARE` uses one page per durable job. This is the smallest measured batch and makes the
  recovery bound concrete: with the conservative default worker count, a crash can redo at most one
  page while still allowing page-level priority changes.
- `foundation_version` is initialized and carried through pages/jobs, but no correction,
  reprocessing, bump, remap, or migration-to-a-new-foundation path exists in R2.
- RapidOCR is initialized lazily inside each worker thread, so Core Service startup and original-PDF
  serving do not wait for model initialization. pypdfium2 is used only by preparation; PDF.js remains
  the Reader renderer.
- A page failure completes its durable job while leaving `OCRPage=FAILED`; retry is a separate explicit
  transition. This prevents navigation/status reconnects from causing an unbounded retry loop.
- Replacing a book's active source cancels pending work for superseded sibling revisions. Deleting a
  book cancels every revision's pending work before Library removal.

## Deviations from Spec

None in implemented scope. Corrections, reprocessing/version bumps, cross-version anchoring,
highlights, notes, Outline, other job types, layout regions, printed labels, and AI remain absent.

## Acceptance evidence

- `pytest` without external material: **22 passed, 2 skipped**. Covers the R1 suite plus R1→R2
  migration, version baseline, schema-enforced anonymous cells, trustworthy embedded routing,
  persisted selection-geometry reload, deterministic column reading order, page failure isolation,
  explicit retry, priority, single-winner claim, and recovery that skips a ready page.
- `pytest tests/test_real_ocr_acceptance.py` with both external hash-verified PDFs: **2 passed**. It ran
  the inherited nine real pages (DMA indices 0/5/7/8/9/15/16; Primary indices 0/4) and asserted
  structural line/quad/cell/selectability properties only — never exact OCR strings. Primary SHA-256:
  `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`; DMA SHA-256:
  `6cae19dfe20fc35dc3a61f2625a4cfcd6850a7e92a7dd44afbb43414bd6dcdc6`.
- `npm test`: **28 passed**. Includes R1 normalized PDF geometry plus cell-boundary hit-testing,
  forward/backward cross-line range resolution, copied text, and normalized quad construction.
- `npm run test:e2e`: **PASS** on installed Chrome with the 29-page Primary scan, preserving the full
  R1 import/read/virtualize/zoom/position/reopen/delete flow while background OCR ran.
- `npm run test:e2e:r2`: **PASS**. The browser opened and rendered the PDF while preparation was
  incomplete, jumped to page 29, observed visible-page priority (`2 / 29 selectable` in the captured
  state), selected five real cells across six characters, copied the resolved text through the system
  clipboard, reloaded the page from persisted geometry, and required all 29 pages/jobs to finish
  `READY`/`SUCCEEDED`. All 29 pages correctly used the OCR route because the sample has no embedded
  text. The captured selection visually aligns with the printed page-header glyphs.
- `npm run test:e2e:recovery`: **PASS** against the same real scan. The service was killed with two
  pages committed and one page in flight; after restart the ready count stayed **2 → 2**, preparation
  reached **29/29**, exactly one batch was redone, and maximum job attempts was **2**.
- A deliberately failing page-preparation path produced `READY / FAILED / READY` across three pages;
  the original PDF bytes remained servable. The browser failure state adds a retry button rather than
  replacing the canvas.
- The final R2 screenshot was visually inspected. The translucent range sits on the expected printed
  glyphs and the copy confirmation is visible.
- `pip check` still reports the pre-existing, unrelated system-wide `httpcore2` requirement for
  `h11>=0.16` against installed `h11 0.14.0`. R2 imports neither package; this is not recorded as a
  clean environment result.
- **Not tested:** the unavailable representative ~700-page scan. Full-scale sustained background
  preparation, priority churn, and crash recovery remain
  `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING`.

## Known limitations / deferred debt

- Full-book scale requires the missing ~700-page real scan.
- Cell x extents remain recognition-alignment estimates and their y extent is line-inherited, matching
  the measured Foundation contract. Selection intentionally snaps to that ceiling.
- The measured render-DPI curve below 200 DPI, cross-engine-version geometry stability, watermark
  contamination, and rotated in-figure OCR errors remain the Frozen Core's recorded residual unknowns.
  None is silently redesigned in R2.
- Selection is page-scoped. Cross-line ranges on one page are supported; dragging one selection across
  a PDF page boundary is not part of this slice.
- OCR correction/error-report workflow and foundation-version bumps remain deferred to their own
  authorized slice.

## Reproducible entry points

```powershell
python -m pip install -e '.[test]'
npm install
guided-reader

pytest
npm test

$env:READER_REAL_PRIMARY='D:\path\to\2026计算机组成原理_第1-29页.pdf'
$env:READER_REAL_DMA='D:\path\to\2026计算机组成原理_第320-348页.pdf'
pytest tests/test_real_ocr_acceptance.py

$env:READER_REAL_PDF=$env:READER_REAL_PRIMARY
npm run test:e2e
npm run test:e2e:r2
npm run test:e2e:recovery
```

Manual acceptance: start `guided-reader` in the user's PowerShell, import the hash-verified 29-page
Primary sample, immediately scroll/jump while the toolbar reports partial selectability, drag across
prepared text and paste it into another application, reload and repeat, and verify any failed-page
retry affordance leaves the PDF canvas readable. Repeat at ~700-page scale when that material exists.

## Important files / architecture entry points

- `src/reader_service/library/database.py` — R2 migration and schema-enforced storage shape.
- `src/reader_service/foundation/contracts.py` — provider-neutral port and line contract.
- `src/reader_service/foundation/rapidocr_adapter.py` — the only provider vocabulary boundary.
- `src/reader_service/foundation/repository.py` and `service.py` — per-page state and atomic publish.
- `src/reader_service/jobs/repository.py` and `worker.py` — durable priority queue and recovery.
- `src/reader_service/server.py` — preparation/status/overlay/retry API and SSE.
- `src/reader_service/static/selection.js` and `app.js` — range resolution and Reader overlay.
- `tests/test_real_ocr_acceptance.py`, `tests-e2e/selectable-reader.mjs`, and
  `tests-e2e/preparation-recovery.mjs` — real-material acceptance paths.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its hash is recorded in the
completion handoff.
