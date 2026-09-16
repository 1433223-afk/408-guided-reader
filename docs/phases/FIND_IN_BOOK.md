# Phase / Find in Book

## Goal

Let a user search the text of a book they're reading and jump to where a term appears. This is
deliberately not named "R4" — the frozen §24 R4 entry ("Structure") is Outline/printed-page/layout,
a different and larger slice; this Phase is independently derived from current real state, not a
renaming of that roadmap entry.

## User-visible result

A user viewing or about to view a prepared book can type a query (a term, a formula fragment, a
phrase) and see which pages contain it, with a short surrounding snippet, and jump to that page in
the Reader. Pages not yet OCR-prepared simply don't appear in results yet — search never errors or
blocks waiting for them, exactly like selection already behaves.

## Authority to read

**Product Blueprint:**
- §2 — Primary invariant (a search result jumps to the real PDF page; it never becomes a
  reconstructed-text reading surface)
- The three "selection/search/Assistant" mentions (near the Chapter-preparation failure state and the
  Reader capability-availability failure matrix) — search is named, three times, as a co-equal
  OCR-dependent capability alongside selection (already built) and Assistant (future, out of scope)

**Implementation Blueprint:**
- §4.1 — Foundation context (OCR pages/lines) is the sole data source; no new bounded context
- §8.1, §8.3 — what Foundation actually stores (`OCRLine.text`, per page, already durable since R2)
- §20 — the general failure-degradation pattern this Phase follows (a capability is available exactly
  when its prerequisite page state allows it, never partially/incorrectly)
- §27 — "Full-text search across the book | OCR line text is already stored per page," the deferred
  item this Phase closes now that its stated precondition (Foundation existing) is satisfied

Nothing else in either blueprint is required reading for this Phase.

## Hard rules

- **A search result navigates to the real PDF page — it never renders as an alternate reading
  surface.** Snippets may quote a short amount of surrounding text (the same spirit as an
  annotation's `context_before`/`context_after`), but search must never become a way to read the book
  as extracted text instead of the original PDF (Product §2).
- **Search only covers `READY` pages.** A page not yet prepared, or `FAILED`, is simply absent from
  results — never an error, never a block, never a stale/guessed match (Product's
  "OCR current page available → selection/search/Assistant works" pattern).
- **No new OCR pass, no new engine call.** This Phase is a read path over text R2 already persisted;
  it must not trigger preparation, re-preparation, or touch `foundation_version` in any way.
- **No bulk extraction path.** Search returns short snippets and page references, not a way to
  retrieve a page's or the book's full recognized text in one call.

## Build

- A query capability over `OCRLine.text` for one book's `READY` pages: given a search string, return
  matching pages with a short snippet per match, in page order.
- Reader UI: a search entry point, a results list (page number + snippet), click-to-jump using the
  existing R1 page-navigation path.
- Whatever minimal index or query structure makes this reasonably fast on a real ~350-page book is an
  ordinary implementation choice (see "Autonomy") — this Phase does not mandate a specific mechanism.

## Not now

- **Outline-based or structural search** (searching within a chapter/section) — Outline doesn't exist.
- **Cross-book search** — one book at a time, matching how the Reader itself is scoped.
- **Fuzzy/typo-tolerant matching that compensates for OCR recognition errors** — plain, honest
  substring/normalized matching only. A term the OCR engine actually misread simply won't be found;
  that's a known, named limitation (Implementation §8.8's residual unknowns), not something this
  Phase attempts to paper over with heuristics.
- **Ranking/relevance scoring beyond page order** — page order is sufficient for a first version.
- **Highlighting every match on the page canvas** — jumping to the page is enough; painting all
  matches is a Reader-polish addition, not required to prove the capability.
- **Any AI-assisted or semantic search** — that's Assistant territory (Implementation §14), itself
  blocked by the still-open D-4/D-5 decisions (Implementation §26) and out of scope regardless.
- **The four known deferred-debt items are not touched here and have no natural tie-in to this
  Phase:** cross-page continuous selection (Reader interaction, unrelated to a page-jump result);
  the cross-version OCR regeneration round-trip (needs reprocessing, which this Phase doesn't touch);
  `static/geometry.js`'s live-authority status (this Phase never touches canvas/geometry rendering);
  and the one non-reproduced SQLite write-lock failure (no established pattern to fix — if this
  Phase's read load surfaces new contention, that gets reported, not quietly tuned away as a
  side effect).

## Acceptance

Machine:
- Query terms known to exist in real OCR'd pages (from the already-used 29-page and 348-page real
  scans) return the correct pages; a query for text that doesn't exist returns no results, not an
  error.
- A page that is `NOT_PREPARED`/`PREPARING`/`FAILED` never appears in results even if the query term
  would match its (unprepared or absent) text.
- Deleting a book or a source revision removes it from search scope (no orphaned/ghost results).

Real-use, at both real scales (29-page Primary, 348-page full scan):
- Search a real term known to appear in the 348-page book (e.g., a term already used in R2/R3's own
  real-use acceptance); confirm the returned pages are correct and jumping to a result lands on the
  right page.
- Confirm search against the 348-page book returns in a reasonable time — no visible hang; if a
  specific measured figure is worth recording, put it in the development report as evidence, not as
  an invented hard threshold this brief didn't set.

## Autonomy

Per `AGENTS.md` §5 — ordinary implementation detail needs no approval: whether to use SQLite FTS5,
a plain indexed `LIKE`/normalized-text query, or an in-memory structure per book; snippet length and
formatting; the search box's placement and interaction; result-list styling; ordinary tests and small
refactors. If the runtime's SQLite build lacks FTS5, falling back to a plain query is an ordinary
implementation contingency, not an escalation.

## Must report before proceeding

- None expected. This Phase touches only already-durable Foundation data (no new external dependency,
  no new Product decision, no user-provided material beyond what's already in place).
- If building an index requires persisting derived data at a scale or in a way that starts to look
  like a new durable entity with its own identity (rather than an ordinary, rebuildable query index),
  stop and report — that would be new ground beyond "a read path over existing data."
- Any genuine missing Product decision, a conflict with frozen authority, or an unexpected need for a
  major dependency — `AGENTS.md` §5's conditions generally.

## Completion

- Tests above passing.
- Real-use check at both scales as described in "Acceptance."
- One development report in `docs/development-reports/` (format in that directory's README), labeling
  the result `IMPLEMENTATION_READY` (no material or capability gap is expected for this Phase's own
  scope — if one surfaces, name it explicitly rather than omitting it).
- One git checkpoint commit.
- **No independent (ZCode) review required by default.** This Phase creates no durable user asset, no
  new anchor/identity contract, and no persistence beyond a rebuildable index over data Foundation
  already owns — it doesn't land on any of `AGENTS.md` §5's risk-triggered categories the way R3's
  annotation anchoring did. If the eventual design ends up persisting something that looks like new
  durable identity rather than a derived index, treat that as escalation condition 4, not something to
  ship past this default.
