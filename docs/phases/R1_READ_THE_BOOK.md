# Phase / R1 — Read the Book

## Goal

Import a PDF and read it. No AI, no OCR, no outline, no selection.

## User-visible result

> **"I can read my textbook in this app."**

A user picks a PDF, it opens immediately, they navigate it fluidly (page-by-page and by zoom), close
the app, and reopening the same book returns them to the same page. Importing the same file twice
does nothing the second time.

## Authority to read

**Product Blueprint** (`PRODUCT_BLUEPRINT.md`):
- §1 — Product thesis
- §2 — Primary invariant: Original PDF is the reading authority
- §3.1 — Stable Book Foundation (terminology only; most of the list is later phases)
- §4, §4.1 — Progressive Book Bootstrap / Immediate readiness
- §7.2 — Different textbook/PDF revision (governs what counts as a duplicate vs. a new revision)

**Implementation Blueprint** (`IMPLEMENTATION_BLUEPRINT.md`):
- §1 — Engineering Goals and Non-Goals
- §2 — System Context
- §3 (§3.1–§3.6) — Runtime / Process Architecture, including §3.5's resolved platform decision
- §4 (§4.1–§4.4) — Bounded Contexts and Module Boundaries
- §5 (§5.1–§5.5) — Persistence and File Storage
- §6 (§6.1–§6.4) — Book / Source Foundation
- §7.1–§7.3 — PDF rendering, coordinate systems, virtualization (**not** §7.4 selection/highlight,
  §7.5 current-section resolution, or §7.6 crops — those belong to R2–R4)
- §20 — Failure / Degradation Matrix, the "PDF intake fails" and "Database corruption" rows
- §21.1 — Filesystem containment
- §23, the "Unit (deterministic)", "PDF geometry" and "End-to-end Reader" rows only
- §24 — Implementation Phase Plan, the **Phase R1** entry (this brief is derived from it; R2–R4
  entries are shown there only to make the boundary explicit, not to be pulled forward)

Nothing else in either blueprint is required reading for this Phase.

## Hard rules

- **Original PDF is the reading authority and stays readable with every other subsystem dead**
  (Implementation §1 Goal 1; Product §2). No reconstructed text/HTML ever substitutes for it.
- **Immediate readiness**: as soon as intake succeeds, the PDF is readable — never gated on OCR,
  outline or any AI step (Product §4.1).
- **Durable user assets outlive machine-layer regeneration** (Implementation §1 Goal 3). Reading
  position is such an asset even in R1, before OCR/highlights exist.
- **Downward-only context dependencies** (Implementation §4.2): Library context code must not reach
  into contexts that don't exist yet (Foundation/Outline/Knowledge/Teaching/Annotation) — there is
  nothing to depend on yet, and nothing should be stubbed in anticipation of them.
- **One containment helper for all managed filesystem paths**; blob writes are atomic — temp write +
  fsync + rename (Implementation §21.1). No other code joins paths into managed storage.
- **A materially different PDF is a new Book/source revision, not silent replacement** (Product §7.2).
  Byte-identical re-import is a no-op (Implementation §24 R1 acceptance).
- **No fine-grained persistent textbook-fragment entity becomes the reading surface** (Implementation
  §1, "the load-bearing negative requirement"). The Library schema for R1 is `Book` /
  `BookSourceRevision` + `ReadingPosition` — nothing that fragments page content.

## Build

- Library context: `Book`, `BookSourceRevision` entities and their persistence (Implementation §6.1).
- Blob store for original PDFs, with the containment + atomic-write discipline above.
- Intake: validate the file is a readable PDF, compute content identity, reject/report encrypted or
  corrupt files with a clear reason (Implementation §20, "PDF intake fails" row).
- Dedup: re-importing byte-identical content is a no-op; a materially different PDF becomes a new
  `BookSourceRevision` (Product §7.2).
- Delete: removing a book removes its blob and DB rows; no orphaned files (Implementation §6.4).
- Core Service skeleton: the local Python service (Implementation §3.2–§3.4) exposing whatever
  localhost API surface the Reader UI needs for intake, listing, opening and position persistence.
  SQLite for state (Implementation §5.1).
- Reader UI: PDF rendering, virtualized page list (only viewport + a small window actually
  rendered), zoom, page navigation (Implementation §7.1, §7.3).
- Reading position persistence: current page (and enough in-page position to feel exact) survives
  close/reopen (`ReadingPosition` schema, Implementation §24 R1).
- Coordinate-conversion module: normalized top-left `[0,1]` page coordinates (Implementation §7.2).
  Nothing consumes this yet in R1, but rendering and future selection/highlight both depend on it
  being correct now — cover it with the geometry unit tests below rather than deferring it.

## Not now

- **OCR, selection, copy** — no engine, no text layer, no overlays. That is R2.
- **Outline / navigation-by-structure** — no TOC/bookmark parsing, no chapter/section model. That is
  R4. Page-number navigation only in R1.
- **Highlights, notes, annotations** — R3.
- **Any AI** — Assistant, Master, Teaching, Knowledge Map do not exist in R1's code path at all.
- **Layout detection, figure/table geometry, crops** — R4 (optional even there).
- **Printed-page-label inference** — R4. R1 navigates by PDF page index only.
- Do not stub schema, tables or module boundaries for later contexts "to save time later" — build
  exactly what R1's own schema (`Book`, `BookSourceRevision`, `ReadingPosition`) requires.

## Acceptance

- Navigate a real scanned textbook fluidly (smooth scroll/page-turn, responsive zoom); close and
  reopen the app and land on the same page (Implementation §24 R1).
- Geometry unit tests pass: rotation, non-zero-origin media boxes, mixed page sizes, normalized
  round-trip stability (Implementation §23, "PDF geometry" row).
- Duplicate import of the same file is a no-op; importing a materially different PDF for what the
  user considers "the same book" produces a new source revision, not silent data loss (Product §7.2).
- A deliberately corrupt or encrypted PDF fails intake with a clear reason and commits nothing
  (Implementation §20).
- End-to-end Reader test passes with AI entirely disabled (there is none in R1 to disable, but the
  test should already be structured per Implementation §23's "End-to-end Reader" row so R2+ can
  extend it): import → read immediately → close → reopen → same position.
- **Real-textbook material, and the gap in it — see "Must report before proceeding" below.** The
  frozen acceptance criterion calls for opening *"a real 700-page scanned textbook."* No asset of
  that scale is currently available to Codex (see below); use the largest available real excerpt for
  everything gradable at small scale, and flag the full-scale gap rather than fabricating a
  substitute or silently downgrading the criterion. This does **not** block R1 implementation: build
  and correctness-test against the 29-page excerpt, close R1 as `IMPLEMENTATION_READY`, and record
  the 700-page criterion as `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` in the development report
  (`AGENTS.md` §5) until a full scan is supplied or the user explicitly accepts the smaller sample as
  final.

## Autonomy

Per `AGENTS.md` §5, "hard core, loose edges" — ordinary implementation detail is delegated, no
approval needed:

- naming of modules, classes, endpoints, files;
- how the Core Service and Reader UI are internally decomposed, so long as §3's process/transport
  shape (localhost HTTP/SSE, Python backend, browser-hosted UI, no shell) is respected;
- choice of PDF rendering library on the Chromium-class browser target (e.g. pdf.js or an
  equivalent) — a conventional, non-major-architecture-changing library choice;
- virtualization strategy, exact zoom UX, ordinary CSS/layout;
- ORM/DB-access helper structure within SQLite (Implementation §5.5 leaves this as a recommendation,
  not a freeze);
- test file organization and ordinary test helpers;
- small local refactors while building.

## Must report before proceeding

- **Missing user-provided material — the 700-page scanned textbook.** The only real 408-textbook
  scans currently available (outside the repository, per policy) are bounded excerpts:
  `phase03/primary/2026计算机组成原理_第1-29页.pdf` (29 pages, 12.6 MB,
  sha256 `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`),
  `phase04/dma/2026计算机组成原理_第320-348页.pdf` (29 pages, 13.5 MB), and an 11-page runtime
  fixture. There is also no complete book of *any* length among them — the largest is 29 pages, far
  short of the ~700-page target the acceptance criterion names, and full-scale checks (sustained
  virtualization performance, navigation across hundreds of pages, position persistence deep into a
  large book) cannot be genuinely exercised without one. Two unrelated reference PDFs exist
  (唐朔飞/白中英 DMA excerpts) but are a different textbook/author and not a substitute. **This is
  reported, not blocking: build and validate R1 against the 29-page excerpt, close as
  `IMPLEMENTATION_READY`, and record `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` for the 700-page
  criterion in the development report.** The user should supply a full scanned textbook, or
  explicitly accept the 29-page excerpt as sufficient for R1 closure, before R1 is called fully
  accepted at its intended scale.
- Any case where a real product decision turns out to be missing, or a task would conflict with
  frozen Product/Implementation authority, or would require a major dependency/stack change not
  already implied by §3.4/§3.5 (Python backend, Chromium-class browser, no shell) — per `AGENTS.md`
  §5's escalation conditions generally.

## Completion

- Unit tests for geometry/coordinate conversion (Implementation §23, "Unit (deterministic)" and
  "PDF geometry" rows) passing.
- An end-to-end Reader test (import → read → close → reopen → same position; duplicate import is a
  no-op) passing, structured so R2+ can extend it with OCR/selection later.
- One development report in `docs/development-reports/` (format in that directory's README) and a
  git checkpoint commit (`AGENTS.md` §5). Its Acceptance evidence must explicitly record the
  29-page-vs-700-page gap and label the result `IMPLEMENTATION_READY` /
  `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` per the "Acceptance" section above — not silently omitted.
- No independent (ZCode) review is required by default for R1 — nothing in its scope is on the
  risk-triggered list (`AGENTS.md` §5). If something durable-identity- or persistence-shaped turns up
  during implementation that wasn't anticipated here, that's escalation condition 3 or 4, not a
  silent expansion.
