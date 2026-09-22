# Reader Directory Redesign Development Report

## Result

The Reader's floating-card directory is replaced by a synchronized left navigator pane that can
never cover the PDF. It answers "Where am I?" (deepest authoritative outline item, uniquely
highlighted, auto-revealed, auto-expanded) and "Where do I go?" (chapter/section/subsection
navigation landing on the projected source position), with progressive editorial text folding
("展开/收起"), and a three-tier ink→gray-green visual hierarchy. The redundant "正在阅读" toolbar
label is removed; the pane itself carries the current-position expression.

## Implemented

- **Adaptive three-mode layout** (`computeDirectoryMode`, pure and unit-tested): **margin**
  (idle left canvas fits pane 304px+24 gap; PDF untouched), **split** (grid column; rendered page
  width provably unchanged), **navigation** (viewer `visibility:hidden`; click → navigate +
  auto-close; direct close restores position untouched). Mode is derived from real geometry —
  viewer width, rendered page width, inline reserve, zoom — not viewport breakpoints; re-evaluated
  on resize, zoom, dock/inline layout changes.
- **Current-item authority** (Implementation §7.5, derived projection only): the deepest unique
  OutlineNode whose range contains the reading anchor. Extends honestly to page-granular PARTIAL
  nodes via `buildOutlineKinship`: effective start = previous sibling's stored end (partition
  boundary), effective end = next known sibling start / parent end / nearest ancestor's next
  sibling / book end; same-page page-only siblings are indistinguishable (whole-page span; passive
  derivation falls to the shallower level) and a containment-gated `navigationAnchorId` tie-break
  names the clicked node until the anchor leaves its span or a deeper RESOLVED range takes over.
  No text/OCR guessing, no click-stickiness.
- **Navigation correctness**: directory clicks land via `outlineNavigationTarget` at the same
  projected coordinate the containment tests (page + normalized y). A **landing pin**
  (`goToPage` → `updateViewport` servo + `ResizeObserver(#pages)`) keeps the claimed destination
  true against async in-flow shifts (learning-footer `marginBottom` reservations, measured
  +327px); released by user intent (wheel/pointerdown/non-ctrl keydown) or relayout.
- **Progressive collapse**: chapters outside the current path start folded; nodes with real
  children fold via a low-weight editorial text affordance (hover/keyboard-focus only, muted,
  no icon/pill); fold clicks change child visibility only — never the PDF position; the current
  reading path is auto-expanded on open and on current-item change (other branches' user state
  untouched); folding away the current item is refused; manual fold state persists for the Reader
  session (per book).
- **Visual pass**: tier colors reuse project tokens (`--ink`/`--green`/`--muted`), transparent
  normal rows (removed two legacy `#reader`-scoped screens.css rules that painted constant chips
  and the pane shadow), whisper hover, fixed an indent specificity bug (indents had never
  applied), tier-aware active weight (subsection current stays 600, never 700), chapter hairlines.
- Removed the "正在阅读" reading label entirely; identity_conflict reconciliation text moved to
  `console.info` internal logging; the "依据：…" evidence line is gone from the reading UI.

## Important implementation decisions

- Navigation destination and current-identity containment share one coordinate authority
  (`buildOutlineKinship` projection) — click, landing pin, and highlight can no longer disagree.
- "Navigable node" (has a safe page destination) and "full-range trackable" (RESOLVED) are
  decoupled per Product §9.2; KP/inline still receive Section-granularity identity from the
  RESOLVED-only path — Knowledge Points semantics untouched.
- `state.directoryCollapsed` is session-scoped per book (reset on openBook), never persisted —
  directory fold state is presentation, not reading state.
- `hidden-directory` guard message stays an internal log (fail-closed storage tree still served).

## Deviations from Spec

- No Phase brief existed; this was a user-directed rework series (2026-09-22/23) with seven
  acceptance-feedback rounds, each scoped by direct user instructions.
- Five e2e files carried pre-existing stale selectors/asserts broken on main since
  `b3a7cc5`/`be8d493` (book-card `打开` button, KP dock width/viewport-width, printed-page prompt
  UI, legacy baseline missing `--font-ui`); fixed in passing because they blocked the affected
  regressions from executing at all.
- map-the-book's two-book fixture no longer exists on disk; rebuilt from
  `var/manual-browser/state.sqlite3.pre-migration-7.bak` + current blobs + the 29-page blob from
  `var/reader-data` (recorded in reproducible entry points).

## Acceptance evidence

- `npm test` (tests-js): **59/59 PASS** (includes `computeDirectoryMode` threshold unit tests).
- `tests-e2e/directory-pane.mjs` (new, real 348-page textbook copy): **PASS** — margin@1920 /
  split@1440 / navigation@1280+1024 geometry invariants (open/close never moves page, zoom,
  scroll, rendered width), active-item tracking, Esc close preserving position, KP/peer
  exclusion, reopen restore, progressive-collapse suite (defaults, aria-expanded, hover/focus
  reveal, keyboard Enter, fold-never-navigates, session persistence, auto-expand on entering a
  folded branch, current-item fold refusal), trailing-node cases (1.3.1/1.3.3/1.3.4, sequence
  1.3.1→1.3.3→1.3.4→1.3.2, 2.1.5/2.1.6, 3.3.5/3.3.6), scroll-away re-projection, and a
  **corpus-wide consistency sweep** over every library book (数据结构 412p: 54 probes,
  保险学 364p: 149, 计组 348p: 47 — each click asserts landing on the independently recomputed
  projected start ±3px and exactly one `aria-current` equal to the clicked item).
- `tests-e2e/reader-restoration.mjs`: PASS (canvas pixels identical vs 92febf6 baseline; toolbar/
  search/marks geometry identical at 1600/1280/1024).
- `tests-e2e/kp-reader-overlay.mjs`, `tests-e2e/map-the-book.mjs` (two real books),
  `tests-e2e/guide-split-reader.mjs`: PASS.
- Real material: the user's live three-book library (`var/manual-browser` copies; never mutated
  in place). Manual acceptance: direction, hierarchy+collapse, and the visual passes were
  accepted across rounds; screenshots in `test-results/directory-*.png`.
- Python suite: `INTENTIONALLY_NOT_RUN` — zero backend changes; no shared risk surface.

Label: `IMPLEMENTATION_READY`.

## Known limitations / deferred debt

- After the landing pin is released, async footer reservations above the viewport can still shift
  content once (pre-existing reader behavior, out of scope).
- Passive (unclicked) highlight at a same-page page-only pair intentionally falls to the shallower
  level — geometry cannot distinguish those siblings; only navigation names one.
- Chapter/Section start_y for TOC-derived books remains page-granular in Foundation; the
  directory projects stored partition boundaries but does not mint new ranges.

## Reproducible entry points

- Run: `python -m reader_service --data-dir var/manual-browser` (verification port used: 8767).
- Directory e2e: `set READER_DATA_DIR=var\manual-browser && node tests-e2e/directory-pane.mjs`.
- map-the-book fixture rebuild: copy `var/manual-browser/blobs` → temp; add
  `var/reader-data/blobs/32/327da74e…pdf`; sqlite-backup
  `var/manual-browser/state.sqlite3.pre-migration-7.bak` as its `state.sqlite3`.
- Manual replay: open each book, open 目录 at ≥1600/1440/≤1280 widths, click chapter /
  习题精选 / 答案与解析 / same-page pairs, fold/unfold, scroll away and back.

## Important files / architecture entry points

- `src/reader_service/static/app.js`: `computeDirectoryMode` / `evaluateDirectoryMode` /
  `applyDirectoryMode`, `buildOutlineKinship` + `outlineNavigationTarget` +
  `isOutlineAncestor` + `expandDirectoryPath`, `renderReaderSectionHint` (derivation),
  `renderOutline` (tree + fold), landing pin in `goToPage`/`updateViewport`.
- `src/reader_service/static/styles.css` (directory block) and the two `screens.css` `:is()`
  lists the directory was removed from.
- `tests-e2e/directory-pane.mjs` — the corpus sweep is the standing invariant for any future
  outline-data shape change.

## Git checkpoint

`<filled by the commit>`
