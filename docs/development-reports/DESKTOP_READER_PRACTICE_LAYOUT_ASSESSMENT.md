# Desktop Reader / Practice layout assessment — 2026-09-25

## Result

Read-only assessment for a bounded 王道 10–20 question Practice prototype. No Practice feature, data model, or product code was implemented. Evidence is the current `main` source at `92921fe`, the Reader/Directory reports, and saved real-book Reader screenshots (`test-results/directory-polish-wide.png`, `directory-split-1440.png`, `reader-kp-list.png`). A fresh served-browser flow was not run; this is a code and existing-evidence assessment, not UAT.

## Current layout

- `#reader` is a CSS Grid with a full-width toolbar and `#viewer`/`#pages` as the PDF stage. The Directory `#outline-panel` is a 304 px left navigator with geometry-selected margin, split, and navigation modes. Navigation mode hides the viewer. Directory identity and fold state belong to the existing Outline projection and can stay intact.
- Chapter KP list, Guide, and Assistant/Master compete for one right slot. Assistant and Master are tabs in the same `#assistant-panel`; Guide has a separate panel but shares its width. Search, marks, and the older knowledge-map panel are right-side floating panels. Learning Memory is a separate full-screen space, reached from the global header; saved entries can return to Reader sources.
- Teaching entry/learning markers/inline guidance live on or just beside PDF pages. Prepared OCR text is a page-wide `.text-overlay` above the canvas; selection, search quads, and annotation quads use it. Page canvases and overlays are virtualized and rebuilt on render/zoom.

## Reuse and smallest preparatory changes

1. Keep Directory's tree, navigation, current-item tracking, and folding. A left-area view switch can host Directory and Practice; Practice must own only its view, not change Outline state.
2. Keep the Assistant/Master dock and its existing right resize behavior. Practice can use the normal PDF-selection-to-Assistant path; no new AI workspace is needed. Guide/KP right-slot exclusion remains as is.
3. Adjust the Reader shell before requiring both side areas at once. At roughly 1600 px with a 410 px right dock, the current 304+24 px Directory cannot keep a 920 px PDF page unchanged, so `computeDirectoryMode` chooses navigation and hides the PDF. A Practice view must keep the PDF visible, using a narrower rendered page or a one-side fallback at constrained widths. This is a layout policy change, with page/scroll/zoom anchoring checks.
4. Add left resize at the shell/grid and `computeDirectoryMode` geometry boundary (currently a hard-coded 304 px pane and 328 px grid column). Right resize already exists in `app.js`/`guide-ui.js`. Avoid separate width systems for Directory and Practice.
5. For a manual small question corpus, mount only option hit targets above the OCR overlay and only in active Practice mode. Use normalized page coordinates and remount after page render/overlay/zoom; leave all other page pixels to selection, highlights, Guide/inline markers, and Master controls. Check target overlap and pointer/keyboard behavior on real 王道 pages. No automatic question segmentation is present.
6. Normalize panel transitions: Guide currently hides `#outline-panel` directly in `guide-ui.js`, bypassing `closeDirectory()` and its grid/mode cleanup. The left Practice view should use one shell close/switch path.

## Authority boundary

Product §2 keeps the original PDF primary. Product §25 fixes the shared Assistant/Master right dock. Product §31 leaves exercise-to-KP mapping, adaptive selection, auto-scoring, wrong-question flow, and Practice Progress deferred unless separately approved. A UI-only/manual 10–20 question prototype can be the next slice; those deferred semantics should not be inferred from an option click. No Agent framework is needed.

## Entry points and verification status

- Shell, Directory mode, page render/selection, and right resize: `src/reader_service/static/app.js`, `styles.css`, `index.html`.
- KP right panel: `src/reader_service/static/screens.js` and `screens.css`.
- Guide and inline PDF controls: `guide-ui.js`, `inline-ui.js`; Assistant/Master: `app.js`, `master-ui.js`; Learning Memory: `memory-ui.js`.
- Existing real-book layout evidence: `docs/development-reports/READER_DIRECTORY_REDESIGN.md` and `READER_SINGLE_RIGHT_DOCK.md`.
- Tests: `INTENTIONALLY_NOT_RUN` — no product code changed. A future prototype should exercise Directory/Practice switching, PDF select → Assistant, option clicks, zoom/page virtualization, both resize handles, and a close/reopen recovery on real 王道 pages.

## Git checkpoint

Assessment document only; no Phase closure or implementation checkpoint claimed.
