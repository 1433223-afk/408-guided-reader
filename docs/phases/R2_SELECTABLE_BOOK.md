# Phase / R2 — Selectable Book

## Goal

Make prepared pages selectable and copyable, in the background, without ever blocking reading. This
is the first machine-derived layer, and the load-bearing prerequisite nearly everything else
(annotations, Outline's body-text bootstrap, Assistant grounding, search) depends on.

## User-visible result

> **"I can select and copy text from my scanned textbook."**

While a book is open, pages the system has finished preparing let the user select a run of text with
mouse or keyboard and copy it, the way a native PDF text layer works. Pages not yet prepared, and
everything else in Reader, keep working exactly as in R1.

## Authority to read

**Product Blueprint:**
- §2 — Primary invariant (OCR must never gate or replace reading)
- §4.2 — Background preparation (progressive, prioritizable, never blocking)
- §6 (§6.1–§6.3) — OCR foundation: line geometry + fine-grained selectable geometry; no permanent
  `Word` entity; no product semantics inferred from a provider's field names
- §7, §7.1, §7.1.1 — OCR is a correctable machine layer; foundation versioning; staleness is
  footprint-scoped (context only — the correction/reprocessing machinery itself is out of scope this
  slice; see "Not now")

**Implementation Blueprint:**
- §4.1, §4.2, §4.4 — Foundation context depends only on Library (already built); downward-only
  dependency; the anti-fragment rule (cells are never an addressable entity)
- §7.4 — Selection and highlight overlay mechanics
- §8 (§8.1–§8.6, §8.8) — OCR/Layout Foundation: product requirement, page routing (embedded-text
  probe vs. OCR route), entities (`OCRPage`/`OCRLine`/cells), cell storage shape, engine (`RESOLVED`:
  RapidOCR/PP-OCRv6 on onnxruntime), adapter boundary, measurement outcome and residual unknowns.
  (§8.7 Corrections — read for context only; its workflow is explicitly deferred, see "Not now")
- §18 (§18.1–§18.4, §18.6) — Background Jobs: durable minimal queue, `PAGE_PREPARE` job type only,
  priority scheduling, concurrency/recovery/failure isolation, what must not be built
- §20 — the "Page OCR fails" row
- §23, the "Selection / highlight round-trip", "Real-textbook acceptance" and "End-to-end Reader"
  rows; §23.1 — inherited empirical fixtures (the acceptance baseline)
- §24 — the **Phase R2** entry (this brief narrows it; see "Not now" for what's deliberately cut)

Nothing else in either blueprint is required reading for this Phase.

## Hard rules

- Original PDF stays the reading authority; a page with no or failed OCR renders and navigates
  exactly as in R1 (Product §2; Implementation §20 "Page OCR fails" row).
- Preparation is background, progressive, and prioritized by what's visible — never a whole-book
  blocking step (Product §4.2; Implementation §18.3).
- Line is the anchoring geometry; cells are derived, x-approximate, y-inherited from the line, and
  carry no stable ID — never a row, never foreign-keyable, never returned as a domain object
  (Product §6.1–§6.2; Implementation §4.4, §8.3, §8.4).
- No permanent `Word` entity, and no product semantics inferred from an engine's field names
  (Product §6.2; Implementation §8.6 — engine vocabulary stops at the adapter).
- A page that fails OCR marks only that page `FAILED`; the rest of the book is unaffected
  (Implementation §18.4).
- `PAGE_PREPARE` resumes from durable domain state (`OCRPage.status`) — no separate checkpoint store
  (Implementation §18.5).

## Build

- Foundation context: `OCRPage`, `OCRLine` (+ serialized cells) persistence, a baseline
  `foundation_version` counter per `BookSourceRevision` — present and initialized, but not yet bumped
  by anything, since no correction or reprocessing trigger exists in this Phase (Implementation §8.3,
  §8.4, §4.1).
- Page routing: probe for an embedded, trustworthy text layer before falling back to the OCR route
  (Implementation §8.2).
- OCR engine adapter + RapidOCR/PP-OCRv6-on-onnxruntime as the one engine, behind the `OcrEngine`
  port (Implementation §8.5 `RESOLVED`, §8.6).
- Jobs context, minimal: one job table, small worker pool, `PAGE_PREPARE` only, priority scheduling
  (visible pages > near reading position > everything else), conditional-update claim, startup
  requeue, per-page failure isolation, cooperative cancellation (Implementation §18.1–§18.4).
- Per-page status streaming to the Reader UI so a page's selectability appears as soon as it's ready.
- Selection overlay: line boxes + cell hit-testing, pointer-to-nearest-cell-boundary mapping,
  cross-line selection as per-line ranges, browser copy of the resolved text (Implementation §7.4).

## Not now

- **OCR corrections and error reports** (Implementation §8.7; Product §7) — a real V1 obligation, but
  not required for "select and copy" to work. Deferred to its own slice once real OCR mistakes on
  real material make the priority concrete.
- **Highlights and notes** — R3. Selection exists so a user can copy text, and so R3 has geometry to
  anchor to; persisting a highlight is out of scope here.
- **Outline, and every job type except `PAGE_PREPARE`** (`OUTLINE_BUILD`, `PAGE_LABEL_INFER`,
  `CHAPTER_PREPARE`, `TEACHING_GENERATE`/`_REVIEW`, `REPROCESS`). Confirmed empirically this slice:
  the real sample PDFs carry zero embedded bookmarks, so even Outline's cheapest bootstrap path needs
  OCR of TOC pages first (Product §9.2) — Outline has no path around this Phase, and gains nothing
  from being pulled forward into it.
- **Layout detection (figures/tables), crops** — R4, and optional even there (unresolved D-3).
- **Any AI** — Assistant/Master/Teaching/Knowledge do not exist in this Phase's code path.
- **Printed-page-label inference** — R4. Navigation stays PDF-page-index-based.

## Acceptance

Machine:
- A selection/highlight-round-trip-shaped test: select → resolve to persisted quads → reload → same
  geometry. (The cross-*version* regeneration half of this round trip is R3's; here it proves the
  resolve/persist/reload path on a stable foundation.)
- Real-textbook acceptance per §23.1's inherited fixture set (nine real 王道 pages with a recorded
  line/selection/anchor baseline) — structural assertions only (line count in range, reading order
  monotonic, selection resolves to the right glyph), never exact-string assertions.
- Failure isolation: a deliberately corrupted/unrenderable page fails OCR for that page only; the
  rest of the book's pages still prepare and the book stays readable.
- Concurrency/recovery: kill the service mid-`PAGE_PREPARE` batch; on restart, already-`READY` pages
  are skipped and preparation resumes; at most the in-flight batch is redone.

Real-use, with the current real sample (`phase03/primary/…第1-29页.pdf`, 29 pages,
sha256 `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`):
- Open the book; while pages are still preparing, scroll and navigate — reading stays fluid, exactly
  as R1.
- As pages turn `READY` (watch the per-page status stream), select a run of text on that page and
  copy it into another application; verify the copied text matches the page.
- **Full-scale gap, inherited from R1, unchanged here:** no ~700-page scan exists, so sustained
  background preparation across hundreds of pages, and Jobs recovery under that load, remain
  untested at the frozen criterion's intended scale. Close this Phase as `IMPLEMENTATION_READY` on
  the 29-page material and record `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` for full-book-scale
  preparation, exactly as R1 did (`AGENTS.md` §5).

## Autonomy

Per `AGENTS.md` §5 — ordinary implementation detail needs no approval: naming and internal
decomposition of the Foundation/Jobs modules; worker-pool sizing and batch-size tuning (a tuning
parameter, not an architectural constant — Implementation §18.3); the exact streaming wire format for
per-page status; ordinary error handling, tests, small refactors; conventional use of
`onnxruntime`/the RapidOCR package once adopted (adoption itself is pre-authorized — see below).

## Must report before proceeding

- **Not expected for the OCR engine choice itself.** RapidOCR/PP-OCRv6-on-onnxruntime is already
  `RESOLVED` (Implementation §8.5, §26 D-2) — adopting it is authorized, not a fresh escalation.
- If the real sample's actual OCR behavior surfaces something the 9-page calibration didn't
  anticipate (Implementation §8.8's residual unknowns — cross-engine-version anchoring, render DPI,
  watermark contamination, in-figure text) in a way that would change this Phase's own scope or
  schema, report it rather than silently redesigning around it.
- Any genuine missing Product decision, a conflict with frozen authority, a need for a second engine
  or a major additional dependency beyond the resolved stack, or missing user-provided material (a
  full-scale scan, primarily) — `AGENTS.md` §5's conditions generally.

## Completion

- Tests above passing (unit/persistence tests plus the §23.1 fixture-based acceptance suite).
- Real-use check on the 29-page sample as described in "Acceptance."
- One development report in `docs/development-reports/` (format in that directory's README),
  labeling the result `IMPLEMENTATION_READY` / `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` explicitly.
- One git checkpoint commit.
- **This Phase requires a narrow independent (ZCode) review — not the normal no-review default.** It
  is where the `OCRPage`/`OCRLine`/cell storage shape, the anti-fragment property, and the
  `OcrEngine` adapter boundary are written for the first time: durable, and load-bearing for
  everything that anchors against this geometry later (R3 highlights, Outline, Knowledge, Assistant).
  That is `AGENTS.md` §5's "other load-bearing Frozen Core behaviour," even though it is new schema
  rather than a migration of existing data. Scope the review to exactly three things: (1) no cell has
  a stable ID and no code path returns one as a domain object (Implementation §4.4); (2) no engine
  field name, output shape or library type crosses the `OcrEngine` adapter boundary
  (Implementation §8.6); (3) the persisted entity/storage shape matches §8.3/§8.4 exactly. Ordinary
  Jobs-scheduling correctness stays on the normal tests → real-use → report path — this is not a
  full re-review of the Phase.
- The version-*bump* and reprocessing/correction semantics of `foundation_version` (§8.7) are
  deferred, not built this slice (see "Not now"). If any of that code gets written anyway, it is new
  ground beyond this brief — durable/persistence-shaped, escalation condition 4 — not something to
  fold into the review above or ship unreviewed.
