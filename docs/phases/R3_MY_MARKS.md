# Phase / R3 — My Marks (core)

## Goal

Let a user durably mark text on a page — highlight it, optionally attach a short note — and have
that mark survive closing and reopening the app. This is deliberately **narrower** than the frozen
§24 R3 entry: region notes, fingerprint re-resolution, and `NEEDS_REVIEW` handling are cut (see
"Not now") because their only trigger, OCR reprocessing, does not exist yet and was itself deferred
out of R2. Building re-resolution logic with no path to exercise it would be exactly the kind of
speculative implementation `AGENTS.md` §5 warns against.

## User-visible result

> **"My highlights and notes are safe."** (the frozen milestone, at the scale this slice can prove)

While reading a prepared page, the user selects a run of OCR text (as in R2) and turns it into a
durable highlight, optionally with a short note attached. The highlight renders on that page every
time the book is reopened. The user can remove a highlight they created.

## Authority to read

**Product Blueprint:**
- §8, §8.1 — Notes/Highlights anchoring product rule (geometry + quote/context, never an OCR
  identifier, as durable authority); optional KP bookkeeping (not populated this Phase — no KP exists)

**Implementation Blueprint:**
- §4.1, §4.3, §4.4 — Annotation context depends on Library + Foundation (both already built);
  `book_source_revision_id` as one of the three enforced cross-context FK anchors; the anti-fragment
  rule continuity (an annotation references geometry/quote, never a line/cell ID, as durable truth)
- §16.1, §16.1a — the `Annotation` entity and anchor model; KP field is bookkeeping only, left `NULL`
- §16.3, §16.3a — behaviour across foundation change, and the named residual risk (cross-*version*
  anchor survival is unvalidated — read for context; this Phase cannot close that gap, see "Not now")
- §16.4, §16.5 — Assistant→Note promotion and Teaching-layer independence (both name what stays
  excluded here)
- §23, the "Selection / highlight round-trip" row — "the single most important test in the system";
  this Phase proves its same-version half only (see "Acceptance")
- §24 — the **Phase R3** entry (this brief narrows it; region notes, fingerprint re-resolution and
  `NEEDS_REVIEW` are cut — see "Not now")

Nothing else in either blueprint is required reading for this Phase.

## Hard rules

- **Anchor is geometry + quote/context, never an OCR identifier** (Product §8; Implementation §16.1).
  Line ordinals and cell indices are runtime conveniences, resolved at render time — never stored as
  the durable reference.
- **A highlight always renders**, even in a state where nothing needs to have gone wrong yet: this
  Phase never produces `NEEDS_REVIEW` because nothing changes geometry, but the field exists in
  schema at its frozen shape so a later reprocessing Phase does not need a backfill migration
  (Implementation §16.1, §16.3).
- **User-authored only.** `source_kind = USER` for everything created this Phase; `AI_SAVED` and its
  verification workflow do not exist in this Phase's code path (Implementation §16.4).
- **Annotations never reference a Guide/Teaching version** (Implementation §16.5) — trivially true
  since Teaching doesn't exist yet, but the boundary is load-bearing, not incidental.
- **Deleting the owning book removes its annotations** — no orphaned rows, consistent with R1's
  book-deletion discipline and the `book_source_revision_id` FK anchor (Implementation §4.3, §6.4).
- **`foundation_version_at_creation` is recorded but never bumped or compared this Phase** — same
  precedent R2 set for `foundation_version` itself: the field exists at its frozen shape; the logic
  that acts on it (re-resolution) is deferred (Implementation §16.3).

## Build

- `Annotation` entity (Implementation §16.1) restricted to `kind = TEXT`: `book_source_revision_id`,
  `pdf_page_index`, `quads`, `quote`, `context_before`/`context_after`,
  `foundation_version_at_creation`, `body` (nullable), `highlight_style`, `source_kind = USER`,
  `anchor_state` (always `OK` this Phase).
- Create: from an existing R2 text selection, persist the selection's resolved quads plus the quote
  and a short surrounding-text fingerprint (Product §8's "small text context before/after").
- Optional note body: the same creation action accepts an optional short text body — a highlight and
  a note are the same entity with `body` populated or not (Implementation §16.1's own shape).
- Render: on page load/reopen, draw persisted annotations from stored quads directly — no
  re-resolution needed or attempted, since nothing bumps `foundation_version` yet.
- Delete: remove an annotation the user created; removing a book removes its annotations.
- Minimal Reader UI: an action to turn the current selection into a highlight (with optional note
  text), highlights visible inline on their page, and a way to delete one.

## Not now

- **Region notes** (`kind = REGION`) — deferred to whenever layout/figure detection (R4, unresolved
  D-3) exists to give a region something meaningful to reference. Nothing here forecloses it; it's
  just not useful without VisualRegion evidence.
- **Fingerprint re-resolution and `NEEDS_REVIEW` transitions** (Implementation §16.3) — the only
  event that can trigger them is OCR reprocessing, which does not exist (deferred since R2's own
  Completion). Building the matching algorithm now would be untestable. Ship it alongside whichever
  Phase adds reprocessing/corrections.
- **The cross-*version* round-trip test itself** (Implementation §23, §16.3a) — cannot be executed
  without reprocessing. This is a **capability gap**, not a data-availability gap, and it is new to
  this Phase (R1/R2's gap was always missing *material*). Tracked explicitly in "Acceptance," not
  silently treated as satisfied by the same-version test below.
- **AI-authored notes / Save-to-Notes / verification** (Implementation §16.4) — no Assistant exists.
- **Editing an existing note's body** — delete-and-recreate is the interim path; a dedicated edit
  affordance is a small, later, non-architectural addition.
- **A cross-book notes list/browser UI** — highlights render on their own page, which is enough to
  prove and use the capability; a dedicated list view is a Reader-polish addition, not required here.
- **Cross-page continuous selection** — re-examined, not carried forward as a blocker: Implementation
  §16.1's `Annotation` schema anchors to exactly one `pdf_page_index` (singular). A highlight is
  Product-defined as single-page, so the still-deferred cross-page *selection gesture* (R2 debt) is
  not a prerequisite for a correct highlight here and is not pulled into this Phase.

## Acceptance

Machine:
- Create a highlight (with and without a note body) on real OCR'd text; assert the persisted quads,
  quote, and context match the source selection.
- Same-version round trip: create → restart the service → reload the page → the highlight renders at
  the original geometry from persisted data alone (no re-resolution attempted or needed). This proves
  §23's round-trip claim for the case this Phase can actually produce.
- Delete an annotation; assert it no longer renders and no longer persists.
- Delete the owning book; assert its annotations are gone (no orphaned rows).
- Schema/contract test: a `REGION`-kind annotation or an `AI_SAVED`/re-resolution code path is either
  absent or explicitly rejected — not half-built.

Real-use, with the current real sample (29-page Primary scan):
- Select real OCR text on a prepared page, create a highlight, add a short note on a second
  selection, close and reopen the book, and confirm both render correctly on their pages.
- Delete one highlight and confirm it's gone after reopening.
- **Two named, non-blocking gaps, carried forward honestly rather than papered over:**
  - No ~700-page scan exists — full-book-scale annotation volume/performance is untested
    (`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING`, same inherited gap as R1/R2).
  - The cross-version regeneration round-trip (§23, "the single most important test in the system")
    cannot be executed because reprocessing doesn't exist yet. Close this Phase as
    `IMPLEMENTATION_READY` for same-version creation/persistence/render/delete, and record the
    cross-version gap explicitly as pending on a future reprocessing Phase — not as passed, and not
    as this Phase's fault.

## Autonomy

Per `AGENTS.md` §5 — ordinary implementation detail needs no approval: highlight color/style choices
and their UI; exact selection→highlight interaction (button, shortcut, or both); note-body input UI;
internal module layout for the Annotation context; ordinary error handling and tests; small local
refactors.

## Must report before proceeding

- None expected. The OCR/selection dependency is already built, no new dependency is needed, and no
  open Product decision touches this scope.
- If real use surfaces a case where the same-version anchor model doesn't hold even without
  reprocessing (e.g., a selection whose resolved quads don't survive a plain reload correctly), that
  is a Foundation-contract question, not an ordinary bug — report per `AGENTS.md` §5 condition 3 or 4
  rather than quietly patching around it.
- Any genuine missing Product decision, a conflict with frozen authority, or missing user-provided
  material — `AGENTS.md` §5's conditions generally.

## Completion

- Tests above passing.
- Real-use check on the 29-page sample as described in "Acceptance."
- One development report in `docs/development-reports/` (format in that directory's README),
  labeling the result `IMPLEMENTATION_READY` and explicitly naming both gaps above (full-scale
  material and the cross-version round-trip) rather than omitting either.
- One git checkpoint commit.
- **No independent (ZCode) review required by default.** Unlike R2, this Phase does not establish a
  new geometry/storage contract — it consumes R2's Foundation geometry as-is and adds one
  straightforward entity with no reprocessing logic to get subtly wrong. If fingerprint re-resolution
  or any `NEEDS_REVIEW` transition gets written despite "Not now," that is durable/persistence-shaped
  scope beyond this brief — escalate per condition 4, don't ship it unreviewed.
