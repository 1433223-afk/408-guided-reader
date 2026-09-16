# R3 — My Marks (core) Development Report

## Result

`IMPLEMENTATION_READY` — a Reader selection can now become a durable text highlight, with an optional
short note. Completing a text selection remains visually quiet; only an explicit right-click inside
that selection opens a compact menu with Copy, Highlight, and Add note as peer actions. The old fixed
bottom composer is gone. Marks render from persisted normalized quads on their original PDF page,
survive closing and reopening the book and a real Core Service process restart, and can be deleted.
The Reader keeps Marks behind a small toolbar entry until the user explicitly opens it.

`USER_REAL_USE_ACCEPTANCE: PASS` — the user completed real-use validation of the final interaction
and explicitly accepted it on 2026-09-04.

`R3_STATUS: CLOSED`

`READY_FOR_NARROW_ZCODE_REVIEW: YES` — the required narrow independent review and the post-R3
persistence-refinement review are complete and PASS; neither found a P0/P1/P2 within the authorized
durable-annotation scope.

The full-material gap is closed. Formal R3 browser acceptance used both the 29-page real Primary scan
and the complete 348-page real textbook scan (SHA-256
`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`). The user's earlier informal
full-book smoke use was useful signal but was not counted as the formal result below.

One capability gap remains: cross-version OCR regeneration anchor round-trip is untested because no
reprocessing/version-bump path exists. It is explicitly pending, not claimed as passed.

## Implemented

- Annotation context with service/repository boundaries and a schema-enforced `TEXT` / `USER` / `OK`
  R3 subset of the frozen entity.
- Durable UUID annotation identity and enforced owning `book_source_revision_id` foreign key with
  `ON DELETE CASCADE`.
- Server-side resolution of the transient R2 selection expression. Line ordinals and cell boundaries
  exist only in the create request/runtime resolver; only revision, page, normalized quads, quote,
  12-character surrounding context, and creation-time foundation version are persisted.
- Optional note body on the same Annotation entity, with a 1,000-character limit. Body and
  `highlight_style` remain orthogonal; the bounded current palette is `YELLOW`, `GREEN`, `BLUE`, and
  `NONE` (no visible paint).
- Revision/page-scoped create/list/delete API. Deletion is scoped by both annotation UUID and owning
  revision so another revision cannot delete or retrieve the mark accidentally.
- Reader UI for quiet text selection → selection-scoped right-click → Copy / Highlight / Add note,
  inline persisted style rendering, a collapsed-by-default current-page Marks panel, and explicit
  deletion. A right-click without a valid selection, or outside the selected quads, remains native.
- Migration 5 expands only the presentation-style constraint. It copies every existing Annotation
  column one-for-one, recreates the owning-revision cascade and page index, and commits the user-asset
  rebuild and schema marker atomically.
- Book deletion copy now states that highlights and notes are removed. Successful book deletion
  cascades annotations; a failed blob cleanup preserves them until the retry completes.
- WAL configuration now happens once during database initialization instead of on every connection.
  This removes a real `database is locked` race exposed by the first R1 regression run while keeping
  per-connection busy timeout and foreign-key enforcement.

## Important implementation decisions

- The client does not send durable quads/quote as trusted input. It sends the current page plus two
  transient line/cell endpoints; Foundation resolves the authoritative stored OCR overlay into the
  durable anchor and discards the runtime identity before Annotation persistence.
- Same-version rendering reads stored quads directly. It does not query OCR lines, compare foundation
  versions, or attempt any form of matching/re-resolution.
- Highlight style is presentation state, not anchor state. `NONE` still retains the same durable
  quads/quote/context and optional body; it suppresses only visible page paint.
- The selection menu is opened only by a context-menu event whose coordinates fall within the current
  resolved R2 selection. That narrow event is prevented; unrelated Reader/PDF context-menu events are
  not. The custom Copy action and Ctrl+C use the same resolved selection, and note input receives focus
  only after the user explicitly chooses Add note.
- Deferred entity values remain visible in the schema shape where required, but are constrained to
  R3's only valid values: `kind=TEXT`, `source_kind=USER`, `anchor_state=OK`, with verification and KP
  fields `NULL`. `REGION`, `AI_SAVED`, `NEEDS_REVIEW`, and KP population are rejected rather than
  half-built.
- Annotation fetch failure cannot remove R2's text overlay; selectable text remains available even if
  the page's marks list cannot be loaded temporarily.

## Deviations from Spec

None in Product scope. This small post-R3 interaction refinement changes only loose-edge UI and the
already-frozen presentation-style field; durable identity, anchor shape, ownership, and persistence
meaning are unchanged. Region notes, AI-saved notes, editing, fingerprint re-resolution,
`NEEDS_REVIEW`, corrections/reprocessing, Outline, and Teaching remain absent as required.

The only adjacent correction was the ordinary SQLite WAL-initialization concurrency fix above. It was
required after the first R1 browser regression exposed a lock failure; the corrected full regression
then passed.

## Acceptance evidence

- User real-use acceptance: **PASS**. The accepted final interaction is intentionally quiet after
  text selection. Only an explicit right-click inside the current selected quads opens the compact
  Copy / Highlight / Add note menu. Right-click without a valid text selection, or outside the
  current selection, remains available to the browser/PDF context menu. The user confirmed the
  behavior and functionality in the live Reader.
- `pytest`: **36 passed, 2 skipped**. This covers durable anchor content, creation with/without a note,
  all four style values including `NONE`, invalid-style rejection, exact v4→v5 user-asset row
  preservation, migration marker/application, same-version restart/reload geometry, annotation
  deletion, revision-scoped ownership, schema rejection of deferred paths, successful book cascade,
  and failed-book-delete preservation before a successful retry. The two conditional R2 real-OCR
  calibration tests skip in the default run when both external Primary/DMA environment variables are
  not set; R3's required real materials were exercised by the browser acceptance below.
- `npm test`: **30 passed** — R1 geometry and R2 selection behavior remain green.
- `npm run test:e2e`: **PASS** on the real 29-page Primary scan after the WAL correction: 29 pages,
  bounded canvas virtualization, zoom geometry, position persistence/reopen, duplicate intake, and
  book deletion all passed. The initial pre-correction invocation failed with a real SQLite lock and
  is not counted as a pass.
- `npm run test:e2e:r2`: **PASS** on the real 29-page Primary scan after removing focus-stealing from
  the note composer: 29/29 OCR pages ready, selection/copy/reload passed, the precise `6.2.1` TOC
  selection remained intact, selection completion stayed quiet, right-click opened the scoped action
  menu while preserving native selection, and the custom paint remained `rgba(65, 126, 211, 0.2)`.
  The final interaction-refinement invocation passed after one bounded retry: its first independent
  temporary OCR library hit a real `database is locked` failure during job-priority update and is not
  counted as a pass. The earlier first invocation also correctly failed because auto-focusing the note
  input cleared native selection; that regression was fixed and not reclassified as success.
- `npm run test:e2e:r3`: **PASS** against the app's hash-verified prepared Library after the interaction
  refinement. The run created six annotations on PDF pages **1/12/29** of the 29-page scan and
  **1/174/348** of the 348-page scan, covering yellow, green, blue, and `NONE`, plain highlights, and
  highlight+note. It required selection completion to show no Annotation UI, proved an actual
  right-click inside selected text opened the menu, exercised Copy, and proved a right-click in the
  Reader outside the selected quads was not prevented and did not open Annotation actions. It also
  required Marks to stay collapsed after every save, verified persisted quote/context/quads/style
  plus `foundation_version_at_creation=1`, `USER`, and `OK`, reopened each book, restarted the Core
  Service, and required every stored quad—including the transparent `NONE` anchor—to remain
  addressable in the Reader. It deleted the page-174 full-book note through Marks, reopened, and
  confirmed absence. Only acceptance-created IDs were removed; original reading positions were
  restored.
- Full-scale measured page navigation through canvas + OCR overlay on the final refinement run:
  29-page pages 1/12/29 were ready in **478/258/288 ms**; 348-page pages 1/174/348 in
  **639/390/372 ms**. Placeholder count, page-scoped annotation queries, persistence, and rendering
  showed no obvious scale problem.
- One final harness invocation queried the just-created row too eagerly and failed its immediate ID
  difference check even though the row was present in SQLite. The harness now polls that postcondition
  for up to five seconds, the exact leaked acceptance row was removed, and the clean rerun above
  passed. This was a test-observation race, not counted as a product pass.
- Real-material visual QA: **PASS**. The captured 348-page page-174 flow shows the compact menu at the
  right-click location beside real selected OCR text, the three peer actions, four style choices, and
  the inline short-note editor with `NONE` selected. The same selection had no menu before the tested
  right-click. The page remains full width, and Marks is only the small toolbar glyph and count badge.
  The automated real-browser flow then saved, reopened, restarted, and deleted that exact note.
- Live migration evidence: the prepared Library upgraded in place to schema migrations
  `[1,2,3,4,5]`, retained all **377/377** prepared pages across the two books, passed
  `PRAGMA foreign_key_check`, and left its pre-existing user Annotation untouched while cleaning only
  test-created marks.
- Post-refinement narrow independent review: **PASS, no P0/P1/P2**. Scope was limited to v4→v5
  Annotation preservation, owning-revision cascade, style/body orthogonality, unchanged durable anchor
  and creation-time foundation version semantics, runtime OCR identity isolation, and absence of
  deferred re-resolution/`NEEDS_REVIEW`/Region/AI paths. The reviewer made no edits and ran its focused
  suite: **14 passed**.
- **Not tested / pending capability gap:** cross-version OCR regeneration round-trip. There is still no
  authorized reprocessing path with which to execute it; same-version success is not substituted for
  that stronger evidence.

## Known limitations / deferred debt

- Cross-version OCR regeneration anchor round-trip remains **pending**. Reprocessing/version bump,
  fingerprint re-resolution, and explicit `NEEDS_REVIEW` behavior do not yet exist, so same-version
  success is not substituted for this future load-bearing acceptance requirement.
- Cross-page continuous selection is **required but deferred**. It needs a multi-page selection owner
  beyond the current page-scoped pointer-capture and range model; R3 does not redefine it as optional
  or permanently unsupported.
- `static/geometry.js` as the single live conversion authority remains **P2 deferred**. It is the
  tested normalized PDF/viewport conversion module but is not yet Foundation's sole live authority
  for server-side EMBEDDED conversion; conservative OCR fallback continues to contain the risk.
- A clean R2 real-OCR rerun passed, but one immediately preceding temporary-library run hit SQLite
  write contention while prioritizing preparation jobs. That first invocation is **not** counted as
  PASS; the bounded rerun passed 29/29 pages. It did not affect the real prepared R3 Library or
  Annotation semantics, but the remaining transient preparation concurrency is known.
- Region notes, AI-saved notes/verification, existing-note editing, and a cross-book marks browser are
  intentionally outside this core slice.

## Reproducible entry points

```powershell
pytest
npm test

$env:READER_REAL_PDF='D:\path\to\the-29-page-primary-scan.pdf'
npm run test:e2e
npm run test:e2e:r2

# Data directory must already contain the prepared, hash-verified 29- and 348-page books.
$env:READER_DATA_DIR='D:\path\to\reader-data'
npm run test:e2e:r3
```

Manual replay: open a prepared real page and drag a text selection; no Annotation UI should appear.
Right-click inside the selection, then use Copy or choose a style and select Highlight; for a note,
choose Add note and save the inline editor. Right-click outside the selected text and confirm the
browser retains its normal context-menu behavior. Confirm Marks remains a small toolbar entry until
explicitly opened. Return to the Library, reopen the book, and confirm the mark remains on the same
glyphs (or remains listed without page paint for `NONE`). Delete one mark from its Marks card, reopen
again, and confirm it stays gone.

## Important files / architecture entry points

- `src/reader_service/library/database.py` — migrations 4/5, R3 constraints, style palette migration,
  owning-revision FK/cascade.
- `src/reader_service/foundation/service.py` — transient selection → durable anchor resolution.
- `src/reader_service/annotation/` — Annotation service and repository boundaries.
- `src/reader_service/server.py` — revision/page-scoped Annotation HTTP API.
- `src/reader_service/static/app.js` and `styles.css` — selection save flow, inline paint, Marks panel.
- `tests/test_annotations.py`, `tests/test_api.py` — anchor/storage/ownership/deletion contracts.
- `tests-e2e/annotations.mjs` — two-scale create/reopen/process-restart/delete acceptance.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its exact hash is recorded in the
completion handoff.
