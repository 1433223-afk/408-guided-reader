# R2 — Selectable Book Development Report

## Result

`READY_FOR_R2_CLOSURE: YES` — scanned textbook pages prepare progressively in the background. A prepared
page gains a line/cell overlay that supports pointer hit-testing, mouse or keyboard range extension,
cross-line selection, native DOM text selection, and normal keyboard or context-menu browser copy.
Selection painting is presentation-only: adjacent fragments on the same visual row are coalesced into
lightweight translucent runs, while the native DOM Range remains available for browser semantics
without adding a second blue paint layer.
The original PDF canvas remains the only reading
surface and continues rendering, scrolling, zooming, and navigating before preparation finishes or
when one page fails.

`USER_REAL_USE_ACCEPTANCE: PASS` — final hands-on use of the real textbook confirmed precise
selection, cross-line selection, normal right-click copy, and the polished selection presentation.

`ZCode P1-1 delta closure: CLOSED` — ZCode completed the incremental closure verification for the
original P1-1 and found no new P0/P1 issues. R2 closure status is
`READY_FOR_R2_CLOSURE: YES`.

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` — the 29-page real scan completed successfully, including a
real process-kill/restart run. A later 348-page revision supplied the focused page-3 selection
regression below, not a full sustained preparation/recovery acceptance. The frozen ~700-page
criterion is still untestable because that material has not been supplied; sustained preparation and
recovery at full-book scale remain pending.

The narrow independent ZCode review was completed. Its P1 finding about unsafe EMBEDDED geometry on
rotated or non-zero-origin effective page boxes was independently reproduced and corrected. Its P2
observation that `static/geometry.js` is not yet the live single conversion authority remains
non-blocking deferred debt; the correction did not require a broad geometry refactor. ZCode's final
P1-1 delta verification closed that finding with no new P0/P1.

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
  selections as per-line ranges, draws normalized quads, and exposes the same range as transparent
  native DOM text. Keyboard copy and the browser's normal context-menu copy path both receive the
  resolved OCR text. Reload reconstructs geometry from persisted lines.
- Selection presentation suppresses the browser's otherwise-duplicated native Range paint and merges
  only adjacent/overlapping, similarly sized selected rectangles on the same visual row. This produces
  continuous translucent runs without modifying resolved selection ranges, anonymous cell geometry,
  hit-testing, copied text, or persistence.
- Hit-testing uses two-dimensional distance to the line's actual selectable cell extent. Strongly
  overlapping OCR fragments on one visual row are ordered left-to-right before the next row. This
  keeps separately detected TOC numbers and titles independently selectable without changing cell
  persistence or identity.
- A later real-material correction makes the selection axis line-sensitive. Ordinary lines still
  resolve anonymous cell boundaries on X. A tall line whose cell centers collapse onto one visual
  column resolves boundaries on Y and clips its selection quad to the chosen vertical range. This is
  a transient Reader/resolver interpretation of the same stored cells, not a new cell field, entity,
  provider semantic, schema, or foundation version.
- RapidOCR now performs one conservative recognition-only quality retry for an unusually wide,
  low-confidence line whose recognized text is implausibly sparse relative to its detected box. The
  retry uses a padded crop, keeps the baseline line on any retry failure or implausible result, and
  translates accepted provider alignment into the same anonymous line-nested cells. The profile
  records this behavior as `sparse-line-retry-v1`; no provider field becomes product semantics.
- The EMBEDDED route is now deliberately conservative: it accepts only unrotated, zero-origin
  effective page boxes whose dimensions match the page coordinate space. Rotation, non-zero origin,
  or an indeterminate box falls back to rendered-page OCR rather than publishing suspect geometry.

## Correction findings from real use and narrow review

- Manual use found that TOC numbers such as `6.2.1` could not reliably be selected without adjacent
  title text. Inspection of the real persisted page showed `6.2.1` was already a legitimate anonymous
  five-character token-cell in its own `OCRLine`; increasing storage granularity was not the answer.
  The number and title were separate, vertically overlapping lines. Y-only line hit-testing always
  preferred whichever appeared first, while a sub-pixel top-edge difference could also put the title
  before the number in reading order. The correction uses cell-aware 2D distance and visual-row
  left-to-right ordering.
- Manual use also found that the blue custom range had no corresponding DOM `Selection`, so the
  browser treated the page as canvas imagery and offered screenshot/image behavior. OCR line text now
  lives in a transparent native text layer; every resolved custom range is mirrored into a DOM Range.
  Right-click inside the selected geometry refreshes that native range without cancelling or replacing
  the browser's context menu, while right-click elsewhere retains the original PDF Reader behavior.
- Follow-up manual review confirmed selection precision, cross-line selection, and right-click copy,
  but exposed an overly heavy visual result: the browser's native blue `::selection` paint was stacked
  with opaque-looking per-cell custom quads, revealing OCR token fragmentation and obscuring print.
  The correction makes native Range painting transparent while retaining the live DOM selection, uses
  a lighter 20% custom tint, and coalesces adjacent same-row quads only in the presentation path.
  Different rows, distant fragments, and materially different-size title glyphs remain separate so
  the UI does not invent selection geometry.
- ZCode's P1 was correct. The accepted EMBEDDED conversion divided PDF user-space coordinates by
  page width/height without subtracting the effective box origin or applying rotation. Such pages
  could look plausible enough to pass the probe while their overlay was wrong. The smallest reliable
  fix is conservative fallback OCR for those coordinate spaces, covered by real PDFium synthetic
  regressions rather than mocks.
- A post-closure real-material regression on physical PDF page 3 of `2026计算机组成原理` found that
  parts of the vertical title `本书配套资源介绍` could not be selected. The persisted OCR was complete:
  one eight-cell line covered the title, with one anonymous cell per character. However, all eight
  x extents were effectively identical because the text runs top-to-bottom. The Reader therefore
  mapped every pointer position to the same X boundary and could select only an edge or the whole
  line. The correction detects this provider-neutral geometry shape, derives transient evenly spaced
  Y boundaries from the line quad, and uses the same axis for pointer hit-testing, custom selection
  paint, copied text, and server-side resolved quads. Horizontal lines—including unusually tall,
  narrow fragments—remain X-based unless their cell centers also form one column.
- The user then clarified that the remaining report concerned textbook printed page 3, not physical
  PDF page 3. Printed page 3 maps to PDF page index 14 (physical page 15). Persisted line ordinal 5
  had the correct full-width detection quad but only text `无·`, confidence `0.54085`, and two cells;
  nearly the entire visible sentence was therefore absent from the selectable layer. Pointer
  hit-testing could not select geometry that recognition had never published. Re-running recognition
  alone on the same detected line with about `0.75 × line height` crop padding recovered
  `冯·诺依曼在研究EDVAC机时提出了“存储程序”的概念，“存储程序”的思想奠定了现代`
  at about `0.997` confidence with 42 anonymous cells.
- The sparse-line rule was calibrated read-only against all 30 matching candidates in the existing
  348-page OCR set. It recovered multiple collapsed prose lines while formula/table candidates were
  generally rejected by the improvement and plausible-length gates. Calibration did not batch
  reprocess those pages. Only the user-authorized printed-page-3 target was republished: revision
  foundation version `1 → 2`, one page-scoped `REPROCESS` event, unchanged printed-page mapping,
  byte-for-byte unchanged existing annotation `ae3162d7-c9f0-403d-a464-e2fb91c09809`, and unchanged
  OCR page/line snapshots for the other 347 pages.

## Important implementation decisions

- `PAGE_PREPARE` uses one page per durable job. This is the smallest measured batch and makes the
  recovery bound concrete: with the conservative default worker count, a crash can redo at most one
  page while still allowing page-level priority changes.
- `foundation_version` is initialized and carried through pages/jobs. For the explicitly authorized
  printed-page-3 maintenance correction, the existing publication boundary bumped the revision once
  and emitted a page-scoped `REPROCESS` event. This does not add a user-facing correction workflow,
  bulk reprocessing, migration, or cross-version anchoring.
- RapidOCR is initialized lazily inside each worker thread, so Core Service startup and original-PDF
  serving do not wait for model initialization. pypdfium2 is used only by preparation; PDF.js remains
  the Reader renderer.
- A page failure completes its durable job while leaving `OCRPage=FAILED`; retry is a separate explicit
  transition. This prevents navigation/status reconnects from causing an unbounded retry loop.
- Replacing a book's active source cancels pending work for superseded sibling revisions. Deleting a
  book cancels every revision's pending work before Library removal.
- Migration 3 performs one pre-anchor R2 compatibility reset for active machine-layer data: old
  lines are removed and existing page jobs are requeued at `foundation_version = 1`. This is not a
  reusable reprocessing/version-bump workflow. It is a bounded correction while no annotation or
  source-anchor assets exist, and leaves the original PDF, Library identity, and reading position
  untouched.
- Presentation coalescing is deliberately downstream of `resolveSelection`. It has no durable output
  and cannot become a source for copy, reload, anchoring, or cell identity; it is safe to tune as Reader
  UI without changing the Foundation storage/geometry contract.

## Deviations from Spec

None in implemented scope. General correction UI, bulk reprocessing, cross-version anchoring,
highlights, notes, Outline, other job types, layout regions, printed labels, and AI remain absent. The
single authorized printed-page-3 maintenance correction used the repository's scoped version/event
contract and did not widen R2 into a general workflow.
Cross-page continuous selection is a required Reader capability but remains deferred because it is
not a small extension of the current page-scoped pointer-capture and range model.

## Acceptance evidence

- Final user real-use acceptance: **PASS** (`USER_REAL_USE_ACCEPTANCE: PASS`). Precise selection,
  cross-line selection, normal right-click copy, and selection presentation were accepted on the real
  textbook.
- ZCode P1-1 delta closure: **closed, no new P0/P1**. Independent incremental verification reports
  `READY_FOR_R2_CLOSURE: YES`.
- `pytest` without external material: **25 passed, 2 skipped**. Covers the R1 suite plus R1→R2
  migration, version baseline, schema-enforced anonymous cells, trustworthy embedded routing,
  persisted selection-geometry reload, deterministic column reading order, page failure isolation,
  explicit retry, priority, single-winner claim, and recovery that skips a ready page. The correction
  adds visual-row fragment ordering, the one-time pre-anchor invalidation, and synthetic rotated plus
  non-zero-origin EMBEDDED fallback regressions.
- `pytest tests/test_real_ocr_acceptance.py` with both external hash-verified PDFs: **2 passed**. It ran
  the inherited nine real pages (DMA indices 0/5/7/8/9/15/16; Primary indices 0/4) and asserted
  structural line/quad/cell/selectability properties only — never exact OCR strings. Primary SHA-256:
  `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`; DMA SHA-256:
  `6cae19dfe20fc35dc3a61f2625a4cfcd6850a7e92a7dd44afbb43414bd6dcdc6`.
- `npm test`: **30 passed**. Includes R1 normalized PDF geometry plus two-dimensional selectable
  extent hit-testing for overlapping same-row fragments, cell-boundary hit-testing,
  forward/backward cross-line range resolution, copied text, normalized quad construction, and a
  non-mutating presentation-only same-row merge regression.
- `npm run test:e2e`: **PASS** on installed Chrome with the 29-page Primary scan, preserving the full
  R1 import/read/virtualize/zoom/position/reopen/delete flow while background OCR ran.
- `npm run test:e2e:r2`: **PASS**. The browser opened and rendered the PDF while preparation was
  incomplete, jumped to page 29, observed visible-page priority (`2 / 29 selectable` in the captured
  state), selected five real cells across six characters, copied the resolved text through the system
  clipboard, reloaded the page from persisted geometry, and required all 29 pages/jobs to finish
  `READY`/`SUCCEEDED`. All 29 pages correctly used the OCR route because the sample has no embedded
  text. It then reloaded again, opened real TOC page 12, selected only `6.2.1` from a separately
  detected number/title row, verified the native DOM selection and clipboard contained only that
  number, and verified the context-menu event preserved the native selection without suppressing the
  browser menu. It additionally verified that native selection paint is transparent and the custom
  paint is `rgba(65, 126, 211, 0.2)`, then captured TOC, large-heading, and ordinary-body selections.
- `npm run test:e2e:recovery`: **PASS** against the same real scan. The service was killed with two
  pages committed and one page in flight; after restart the ready count stayed **2 → 2**, preparation
  reached **29/29**, exactly one batch was redone, and maximum job attempts was **2**.
- Post-closure vertical-selection correction (2026-09-18): `npm test` **53/53 passed** and full
  `pytest` **330 passed, 2 skipped**. The targeted JS regression covers first/middle/last vertical
  boundaries, partial vertical text and quad clipping, plus a tall horizontal negative control. The
  Python regression resolves the same anonymous boundary range through `FoundationService` and
  verifies quote plus Y-clipped geometry.
- Agent real-use golden path against the existing 348-page revision
  `8ed51463-78da-448f-883a-cf26684d902b` (PDF SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`) **PASS** on physical page 3.
  A real mouse drag selected only `配套资` from vertical line 41, the DOM selection and system
  clipboard both contained exactly `配套资`, and the custom quad covered only those three glyphs.
  This correction is `IMPLEMENTATION_READY`; follow-up user retest is pending.
- Printed-page-3 OCR-collapse correction against that same 348-page revision: **PASS**. The corrected
  target is PDF page index 14 / physical page 15, not the earlier physical-page-3 vertical-title case.
  A real browser mouse drag selected and copied exactly `冯·诺依曼在研究EDVAC`; after a full reload
  and reopen, a second drag selected and copied exactly `提出了“存储程序”的概念`. The custom selection
  quad covered the intended glyph run in both cases. The page remained `READY`, its printed label
  remained `3`, and the existing annotation remained unchanged.
- Printed-page-3 correction closure tests (2026-09-18): adapter/Foundation target **15 passed**;
  `npm test` **53/53 passed**; full `pytest` **335 passed, 2 skipped**. Adapter regressions cover the
  padded recognition-only retry, no retry cost for normal lines, failure fallback to baseline,
  provider-alignment translation into anonymous cells, and rejection of implausibly long retry text.
- Current R1 browser regression invocation is **not a PASS**: two default-DPR runs stopped before
  selection at the pre-existing pixel-alignment assertion (`deviceLeft = 362.5` at DPR 2.5). A
  supported DPR-2 run reached teardown but exited on a Windows `EBUSY` while deleting its temporary
  SQLite database, so it also cannot be recorded as PASS. The full Python/JS suites and the live
  Reader golden path above passed; no R1 layout code changed in this correction.
- A deliberately failing page-preparation path produced `READY / FAILED / READY` across three pages;
  the original PDF bytes remained servable. The browser failure state adds a retry button rather than
  replacing the canvas.
- The final R2 screenshots were visually inspected. The page-29 range sits on the expected printed
  glyphs; the TOC screenshot shows a tight selection around only `6.2.1`, with the adjacent title
  unselected; and the large-heading and ordinary-body fixtures show lightweight, readable selection
  runs instead of stacked solid token blocks. Differently sized `第` / `1` / `章` fragments are not
  incorrectly unioned into one oversized rectangle.
- The user's existing 29-page Library record was upgraded in place on the live `8766` service. It
  retained the original PDF and 80% reading zoom, re-prepared 29/29 pages, and exposed the corrected
  page-12 number-before-title text order.
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
- Because the frozen cell payload has no per-cell Y extents, confirmed vertical lines divide the line
  quad evenly by anonymous cell count. This avoids the previous unselectable state and matched the real
  page-3 glyphs, but it remains an inferred selectable boundary rather than provider geometry.
- The measured render-DPI curve below 200 DPI, cross-engine-version geometry stability, watermark
  contamination, and rotated in-figure OCR errors remain the Frozen Core's recorded residual unknowns.
  None is silently redesigned in R2.
- Selection is page-scoped. Cross-line ranges on one page are supported. Continuous dragging across a
  PDF page boundary is **required but deferred**, not optional and not permanently unsupported; it
  needs a multi-page selection owner beyond the current per-overlay pointer-capture model and was not
  pulled into this narrow correction.
- `static/geometry.js` remains the tested normalized PDF/viewport conversion module but is not yet the
  live single authority for Foundation's server-side EMBEDDED conversion. This ZCode P2 is non-blocking;
  the P1 is contained by conservative OCR fallback rather than a broad geometry architecture change.
- A general OCR correction/error-report UI, bulk reprocessing policy, migration, and cross-version
  anchoring remain deferred. The prospective sparse-line retry and one explicitly authorized
  page-scoped maintenance correction do not create those workflows.

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
retry affordance leaves the PDF canvas readable. For selection presentation, inspect page 12 (TOC and
number), page 13 (large heading), and page 14 (ordinary body) for a continuous, translucent result
that leaves the original print legible. Repeat at ~700-page scale when that material exists.

## Important files / architecture entry points

- `src/reader_service/library/database.py` — R2 migration and schema-enforced storage shape.
- `src/reader_service/foundation/contracts.py` — provider-neutral port and line contract.
- `src/reader_service/foundation/rapidocr_adapter.py` — the only provider vocabulary boundary.
- `src/reader_service/foundation/repository.py` and `service.py` — per-page state and atomic publish.
- `src/reader_service/jobs/repository.py` and `worker.py` — durable priority queue and recovery.
- `src/reader_service/server.py` — preparation/status/overlay/retry API and SSE.
- `src/reader_service/static/selection.js` and `app.js` — range resolution and Reader overlay.
- `tests/test_rapidocr_adapter.py`, `tests/test_real_ocr_acceptance.py`,
  `tests-e2e/selectable-reader.mjs`, and
  `tests-e2e/preparation-recovery.mjs` — real-material acceptance paths.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its hash is recorded in the
completion handoff.
