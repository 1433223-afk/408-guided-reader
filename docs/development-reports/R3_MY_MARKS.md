# R3 — My Marks (core) Development Report

## Result

`IMPLEMENTATION_READY` — a Reader selection can now become a durable text highlight, with an optional
short note. Marks render from persisted normalized quads on their original PDF page, survive closing
and reopening the book and a real Core Service process restart, and can be deleted.

`READY_FOR_USER_REAL_USE_REVIEW: YES`

`READY_FOR_NARROW_ZCODE_REVIEW: YES` — the required narrow independent review is complete and PASS;
it found no P0/P1/P2 within the authorized durable-annotation scope.

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
- Optional note body on the same Annotation entity, with a 1,000-character limit, plus a fixed yellow
  highlight style.
- Revision/page-scoped create/list/delete API. Deletion is scoped by both annotation UUID and owning
  revision so another revision cannot delete or retrieve the mark accidentally.
- Reader UI for selection → optional note → Save highlight, inline persisted highlight paint, a
  current-page Marks panel, and explicit deletion.
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
- Deferred entity values remain visible in the schema shape where required, but are constrained to
  R3's only valid values: `kind=TEXT`, `source_kind=USER`, `anchor_state=OK`, with verification and KP
  fields `NULL`. `REGION`, `AI_SAVED`, `NEEDS_REVIEW`, and KP population are rejected rather than
  half-built.
- Annotation fetch failure cannot remove R2's text overlay; selectable text remains available even if
  the page's marks list cannot be loaded temporarily.

## Deviations from Spec

None in Product scope. Region notes, AI-saved notes, editing, fingerprint re-resolution,
`NEEDS_REVIEW`, corrections/reprocessing, Outline, and Teaching remain absent as required.

The only adjacent correction was the ordinary SQLite WAL-initialization concurrency fix above. It was
required after the first R1 browser regression exposed a lock failure; the corrected full regression
then passed.

## Acceptance evidence

- `pytest`: **31 passed, 2 skipped**. This covers durable anchor content, creation with/without a note,
  same-version restart/reload geometry, annotation deletion, revision-scoped ownership, schema
  rejection of deferred paths, successful book cascade, and failed-book-delete preservation before a
  successful retry. The two conditional R2 real-OCR calibration tests skip in the default run when
  both external Primary/DMA environment variables are not set; R3's required real materials were
  exercised by the browser acceptance below.
- `npm test`: **30 passed** — R1 geometry and R2 selection behavior remain green.
- `npm run test:e2e`: **PASS** on the real 29-page Primary scan after the WAL correction: 29 pages,
  bounded canvas virtualization, zoom geometry, position persistence/reopen, duplicate intake, and
  book deletion all passed. The initial pre-correction invocation failed with a real SQLite lock and
  is not counted as a pass.
- `npm run test:e2e:r2`: **PASS** on the real 29-page Primary scan after removing focus-stealing from
  the note composer: 29/29 OCR pages ready, selection/copy/reload passed, the precise `6.2.1` TOC
  selection remained intact, the browser context menu kept native selection, and the custom paint
  remained `rgba(65, 126, 211, 0.2)`. The first invocation correctly failed because auto-focusing the
  note input cleared native selection; that regression was fixed and not reclassified as success.
- `npm run test:e2e:r3`: **PASS** twice against the app's real prepared Library. Each run created six
  annotations spread across PDF pages **1/12/29** of the 29-page scan and **1/174/348** of the full
  348-page scan, alternating plain highlights and highlight+note. It verified persisted quote,
  context, quads, `foundation_version_at_creation=1`, `USER`, and `OK`; closed/reopened each book;
  killed and restarted the Core Service against the same database; compared every persisted anchor;
  and required each quad to render in the Reader. It deleted the page-174 full-book mark through the
  Reader, reopened, and confirmed absence. All acceptance-created marks were then cleaned up by exact
  ID and original reading positions restored.
- Full-scale measured page navigation through canvas + OCR overlay on the final R3 run: 29-page pages
  1/12/29 were ready in **283/231/165 ms**; 348-page pages 1/174/348 in **234/254/258 ms**. Placeholder
  count, page-scoped annotation queries, persistence, and rendering showed no obvious scale problem.
- One final harness invocation queried the just-created row too eagerly and failed its immediate ID
  difference check even though the row was present in SQLite. The harness now polls that postcondition
  for up to five seconds, the exact leaked acceptance row was removed, and the clean rerun above
  passed. This was a test-observation race, not counted as a product pass.
- Manual real-use/visual walkthrough: **PASS**. On the 348-page book's PDF page 23, real OCR title text
  was selected and saved with the note `R3 人工验收：标题锚点`; the yellow highlight visually landed on
  the original glyphs and the Marks panel showed its quote/note. Returning to Library and reopening
  restored it at the same location. That manual acceptance mark was then removed by exact ID.
- Live migration evidence: the user's existing Library upgraded in place to schema migrations
  `[1,2,3,4]`, remained WAL-backed, retained all **377/377** previously prepared pages across the two
  books, and ended acceptance with zero temporary annotations.
- Narrow independent review: **PASS, no P0/P1/P2**. Scope was limited to durable identity/ownership,
  anchor shape, runtime OCR identity isolation, creation-time foundation version, book/annotation
  deletion, and absence of deferred re-resolution/`NEEDS_REVIEW`. The reviewer made no edits and ran
  its focused suite: **9 passed**.
- **Not tested / pending capability gap:** cross-version OCR regeneration round-trip. There is still no
  authorized reprocessing path with which to execute it; same-version success is not substituted for
  that stronger evidence.

## Known limitations / deferred debt

- Cross-version fingerprint re-resolution and explicit `NEEDS_REVIEW` behavior remain pending on the
  future Phase that introduces OCR reprocessing/corrections. This remains the load-bearing capability
  gap named by Frozen §16.3a/§23.
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

Manual replay: open a prepared real page, drag a text selection, optionally enter a short note, choose
**Save highlight**, and inspect both inline paint and the current-page **Marks** panel. Return to the
Library, reopen the book, and confirm the mark remains on the same glyphs. Delete one mark from its
Marks card, reopen again, and confirm it stays gone.

## Important files / architecture entry points

- `src/reader_service/library/database.py` — migration 4, R3 constraints, owning-revision FK/cascade.
- `src/reader_service/foundation/service.py` — transient selection → durable anchor resolution.
- `src/reader_service/annotation/` — Annotation service and repository boundaries.
- `src/reader_service/server.py` — revision/page-scoped Annotation HTTP API.
- `src/reader_service/static/app.js` and `styles.css` — selection save flow, inline paint, Marks panel.
- `tests/test_annotations.py`, `tests/test_api.py` — anchor/storage/ownership/deletion contracts.
- `tests-e2e/annotations.mjs` — two-scale create/reopen/process-restart/delete acceptance.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its exact hash is recorded in the
completion handoff.
