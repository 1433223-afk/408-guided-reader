# Phase / Map the Book

## Goal

### 2026-09-19 accepted user-use correction (supersedes conflicting historical UI details below)

The user requested PDF-only page display, complete TOC entries and a front/back “其他内容” group,
then explicitly approved preservation-grade migration after existing learning assets were discovered.
Use bounded local OCR quality passes for leader-rich layouts, parse chapter extras/back matter,
verify physical targets against body headings, and preserve all IDs/owners/dependent records during
an explicit backed-up additive repair. Mark affected published maps for review without removing them.
Read Product §9.5 and Implementation §11.4 in addition to the existing authority list for this delta.
Acceptance includes the six real Insurance TOC pages, all 199 navigable entries, asset equality,
other-book isolation, normal Reader/selection/reload and crash-recovery regression. No remote AI
generation, destructive KP regeneration or new dependency is part of this correction.

### 2026-09-18 same-capability reliability correction

The user explicitly authorized framework/contract adjustments needed to make OCR and directory
construction work across books, with rollback protection. This delta rejects page-index pseudo
bookmarks, supports explicit Chinese part/chapter/section hierarchy, guards incomplete evidence,
and keeps nested chapters as learning owners. It permits a backed-up offline repair of an unowned
source revision (identity revision advanced, OCR changes through existing Foundation publication).
It does not authorize silent replacement of user assets. Original PDF reading stays independent.
The original Phase closure below is historical; this delta's tests, real-use evidence and remaining
review/user-retest gates are recorded in `docs/development-reports/OCR_OUTLINE_EVIDENCE_CORRECTION.md`.

Give the book its own directory. Establish the textbook's logical Chapter/Section tree (Outline Pass 1)
plus per-page printed-label mapping from evidence already captured, and let the user navigate the real
PDF through it.

## User-visible result

> "I can open my book's 目录, click a section such as 6.2.1, and land on that section in the real PDF —
> and the Reader can tell me which printed page I'm on, or honestly say it doesn't know."

## Authority to read

**Product Blueprint:**
- §1 — thesis; navigation is the first of the five named problems
- §2 — primary invariant (navigation lands on the real PDF; never a reconstructed surface)
- §5 — PDF page index and printed textbook page label are distinct
- §9 — Stable Outline: logical tree vs physical resolution, early logical establishment,
  best-safe-target navigation (§9.1–§9.3)
- §4.2 — background preparation may prioritize TOC pages
- §38 items 8, 9, 63 — printed label distinct from page index; Outline nodes have physical ranges;
  the logical/physical split

**Implementation Blueprint:**
- §4.1 — context boundaries; Outline is a new bounded context (no new OCR authority)
- §10 — Printed-Page Mapping in full (10.1 model, 10.2 inference, 10.3 measured evidence)
- §11 — Stable Outline: 11.1 entity, 11.2 Pass 1 (+ 11.2a watermark rule), 11.3 validation as it
  applies to logical commit, 11.5 logical/physical separation
- §20 — failure/degradation pattern: a capability is available exactly when its prerequisite state
  allows it
- §27 — deferred fallback-target P2 note

Nothing else in either blueprint is required reading for this Phase.

## Hard rules

- **The Outline is the textbook's own structure** — minted only from named evidence (embedded PDF
  bookmarks, TOC pages), with deterministic order and hierarchy; nothing AI-invented, and nothing
  heuristic-minted from body text in this slice (Product §9, Implementation §11.2).
- **Absent evidence yields UNKNOWN / UNRESOLVED, never a guess** — printed labels follow §10.2's
  run-validation rules; navigation uses only a best safe target that is actually evidenced
  (Product §9.2, Implementation §10.2).
- **Per-page label rows; no global offset constant anywhere** — not in code, configuration, or
  defaults (Product §5, Implementation §10.1/§10.3 — the two measured samples produced different
  relations).
- **Logical identity commits early and is minted once** — physical resolution is per-node and
  progressive; this slice never mints a node from body evidence (Product §9.1, Implementation §11.5 —
  Pass 2 is out of scope). No later physical evidence — this slice's own label fits, or a future Pass 2
  refinement — ever creates, re-IDs, or re-parents an existing logical node (Product §9.1 verbatim,
  §38 item 63, Implementation §11.1 "stable identity, minted once", §11.2 Pass 2 "never creates a
  node"). Bootstrap (re)runs must re-derive the same identities from the same evidence; a parser
  change that would alter an already-minted node set, hierarchy, or order is an IDENTITY-tier effect
  under §11.4 — reported, never silently re-run into a new tree.
- **Navigation goes through the existing R1 page-navigation path and lands on the real PDF page** —
  the directory is never a reconstructed-text reading surface (Product §2).
- **Watermark/overprint stripping is a classification-copy normalization only** — stored recognized
  text is never mutated (Implementation §11.2a, §8.7).

## Build

- New Outline context: `OutlineNode` exactly per §11.1, with both revision counters present from day
  one; neither counter bumps in this slice.
- Pass 1 logical bootstrap over existing evidence: embedded PDF bookmarks read via the
  already-installed pypdf; TOC pages parsed from already-persisted READY `OCRLine` rows (through a
  watermark-normalized classification copy), producing title / printed-label / level / order; either
  source alone mints the tree (§11.2). For a newly imported book the bootstrap (re)attempts as early
  pages become READY — it never waits for whole-book body OCR (§11.5).
- Logical-commit sanity per §11.3's logical half: identity/title/level/parent/order commit with no
  range-validation gate; sibling start-page monotonicity where a start page is evidenced; a validation
  failure blocks that node's fields, never the tree's visibility.
- New PageLabel rows per §10.1, inferred per §10.2 by fitting locally consistent monotonic runs over
  existing READY header/footer band lines — no new OCR pass, no new engine call; manual override
  records `MANUAL` and always wins.
- Join: a TOC entry's printed label resolves to a PDF page through PageLabel → the node's
  `start_page` (`resolution_state` at most PARTIAL); a label that maps to no page leaves the node
  present in the directory with an honest un-navigable state.
- Reader UI: a collapsible 目录 panel; click navigates via the existing `goToPage` path; the Reader
  shows the current page's printed label when known and offers per-page manual override; user-visible
  UI is Simplified Chinese per `AGENTS.md` §5.

## Not now

- **Pass 2 physical resolution** — body heading detection, end-page/end-y refinement, RESOLVED
  transitions. This slice claims at most PARTIAL start evidence. When this Phase closes, do not report
  "R4 complete": layout detection and full physical resolution remain.
- **Layout detection / VisualRegion / on-demand crops** — D-3 is still an open user decision and
  independently deferrable (§24).
- **Outline correction UI and the §11.4 tier machinery** — no durable dependents exist yet; the three
  tiers stay a frozen future contract.
- **KP association, Chapter Preparation, Assistant scope consumption** — R5/R6 territory; D-4/D-5
  remain open user decisions.
- **Structure-scoped search** (search within a chapter/section) — revisit after the directory exists.
- **The standing deferred-debt list is untouched** — cross-page continuous selection; the
  cross-version OCR regeneration round-trip (this slice is read-only over Foundation data and never
  touches `foundation_version`); `static/geometry.js` live-authority status; the non-reproduced SQLite
  write lock (this slice's write volume is one bounded tree mint plus one label fit — any recurrence
  gets reported, not quietly tuned); and the lazy/idle OCR resource-policy observation item.
- **No AI of any kind in this slice.**

## Acceptance

Machine:
- A synthetic PDF with embedded bookmarks mints the correct tree; deleting the book cascades
  Outline/PageLabel rows with no ghost rows.
- A TOC-line parsing fixture (including a watermark-contaminated heading line) yields correct
  title/label/level and never mutates stored line text.
- Label fitting: a consistent run infers `INFERRED` labels; pages outside any validated run
  (front matter) stay UNKNOWN; a deliberately corrupted outline/label set is rejected, never silently
  accepted.
- Bootstrap idempotence: re-running the bootstrap (including after more pages become READY) re-derives
  the same `outline_node_id` set, hierarchy, and order — no remint, no re-parent.
- Manual override wins over inference, and the persisted `MANUAL` value still wins after a service
  restart and book reopen — not only within the process that set it; a node whose label maps to no
  page stays present and honestly un-navigable.

Real-use, both real books (29-page sample and 348-page textbook):
- Open the 目录, click a section already exercised in earlier acceptances (e.g. the 6.2.1 TOC entry),
  and land on the correct real PDF page; the shown printed label matches the physical book; a page
  with no recoverable label displays no guess.
- The directory exists without waiting for any preparation beyond what has already happened; nothing
  regresses in reading, selection, marks, or search.

## Autonomy

Per `AGENTS.md` §5, ordinary implementation detail needs no approval: TOC-parse heuristics (numbering
patterns like `7.3.3`, `一、`), confidence thresholds within §10.2's own rules, bootstrap retry bounds
for fresh imports, panel placement and interaction, API shape, test structure, and small local
refactors.

One boundary is explicitly **not** loose here: the TOC-parse heuristics are load-bearing. Their output
determines which durable nodes are minted and their level/parent/order, so while Codex designs and
tunes the parser freely, every such change is bound by the mint-once / no-remint Hard rule above and
by real-corpus acceptance below — a heuristic adjustment that would change an already-minted tree is
an IDENTITY-tier effect to report, not silent re-tuning.

## Must report before proceeding

- TOC parsing on the real corpus proves unreliable enough that evidence beyond §11.2's named sources
  (bookmarks / TOC pages) seems required — that is a Product §9 question, not an implementation one.
- The work reveals a need to alter the frozen §11.1 / §10.1 entity shapes.
- Any major dependency or substantial external reuse (none is expected: pypdf and the existing OCR
  layer suffice).
- Any honest-empty behaviour the blueprints don't already answer.

## Completion

- Machine + real-use acceptance above; both real books are already prepared, so no material gap is
  expected — label the result `IMPLEMENTATION_READY` if so, and name any gap explicitly if one
  surfaces.
- One development report in `docs/development-reports/` (format in that directory's README); one git
  checkpoint commit.
- **Independent (ZCode) review is required for this Phase** — it mints durable identity
  (`outline_node_id`) and installs the validation/honesty contract that later layers key on
  (`AGENTS.md` §5 risk-triggered categories, the way R3's annotation anchoring did). Scope the review
  to identity minting, logical-commit validation, label-inference honesty, and cascade correctness —
  not UI polish.
