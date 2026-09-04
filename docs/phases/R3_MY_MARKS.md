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

Real-use, basic (29-page Primary scan):
- Select real OCR text on a prepared page, create a highlight, add a short note on a second
  selection, close and reopen the book, and confirm both render correctly on their pages.
- Delete one highlight and confirm it's gone after reopening.

Real-use, full-scale (**material gap closed**): a complete real scan of the target textbook now
exists — 348 real pages, not encrypted, sha256
`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd` (currently held in the app's own
blob store from a manual import; the earlier "~700-page" figure was the frozen blueprint's
illustrative example, not an exact page-count gate — a real, complete, non-excerpt scan of the actual
target textbook satisfies that intent regardless of its exact count). The user has already opened and
used this file in the Reader as an informal smoke check with no problems observed — real signal, but
not a substitute for this Phase's own formal acceptance record. Before closing this Phase:
- Repeat the create/reopen/delete walkthrough above against this full book specifically: annotate
  several highlights and notes spread across widely separated pages, close and reopen, confirm every
  one renders correctly with nothing degraded at this scale, then delete one and confirm.
- Record the result in the development report as actual evidence (what was annotated, what was
  checked) — do not report full-scale acceptance as passed on the strength of the user's manual
  smoke check alone.

**One gap remains, and it is not a material gap:** the cross-version regeneration round-trip (§23,
"the single most important test in the system") still cannot be executed, because reprocessing
doesn't exist yet — unchanged by the new material. Close this Phase as `IMPLEMENTATION_READY` for
same-version creation/persistence/render/delete at both scales above, and record the cross-version
gap explicitly as pending on a future reprocessing Phase — not as passed, and not as this Phase's
fault.

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
- Real-use check at both scales (29-page and the full 348-page real book) as described in
  "Acceptance," with the full-scale walkthrough actually recorded — not inferred from the user's
  earlier informal use of the book in Reader.
- One development report in `docs/development-reports/` (format in that directory's README),
  labeling the result `IMPLEMENTATION_READY` and explicitly naming the one remaining gap (the
  cross-version round-trip) rather than omitting it. The full-scale material gap is closed — the
  report should say so, with the sha256/page-count above, not repeat the old pending language.
- One git checkpoint commit.
- **This Phase requires a narrow independent (ZCode) review, after implementation and the real-use
  checks above — reversing the original judgment on this brief.** R2 introduced no new geometry
  contract, so no review was required there; R3 is different — it is the first Phase to persist real,
  irreplaceable user assets (highlights/notes) anchored to source geometry, which is `AGENTS.md` §5's
  "annotation/source anchoring" risk category by name, not a borderline or catch-all fit. Scope the
  review to exactly these, and nothing else in the Phase:
  1. `Annotation` durable identity and ownership (creation, lookup, deletion are unambiguous and
     correctly scoped to their owning book/revision);
  2. the anchor storage itself — `book_source_revision_id` + `pdf_page_index` + `quads` +
     `quote`/`context_before`/`context_after` — matches Implementation §16.1 exactly;
  3. no OCR line/cell runtime identity is persisted as part of the anchor (Implementation §16.1's
     "no OCR identifier is durable authority");
  4. `foundation_version_at_creation` is recorded and left alone — no bump, comparison, or
     re-resolution trigger anywhere in the code path;
  5. book- and annotation-deletion semantics — deleting a book removes its annotations, no orphaned
     rows, no partial deletion state;
  6. re-resolution and `NEEDS_REVIEW` were **not** pre-built despite being named in the frozen §24 R3
     entry — confirm "Not now" was actually honored, not quietly implemented "for completeness."

  This is not a full Phase code review — ordinary Reader UI, selection→highlight interaction details,
  and test structure stay off this list.
