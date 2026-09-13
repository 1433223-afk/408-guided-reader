# Reader toolbar hierarchy — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. Reader map entry removed, context-specific learning access
retained, toolbar controls visually quieted. No user-acceptance PASS is claimed.
Retest: **http://127.0.0.1:8767/** with the existing real Library.

## Changes and boundaries

- Removed the toolbar's full Knowledge Map action and the map action on Outline chapter
  rows. Book Overview remains the accessible full-map surface. Outline tree expansion,
  page navigation and Search behavior are unchanged. The dormant hidden map implementation
  was not refactored as part of this narrow entry removal.
- Existing “正在阅读” line now shows the uniquely resolved current Section from the
  original top reading anchor. Unknown/ambiguous locations fall back to “正在阅读”; no
  title-based source lookup or mastery inference. Existing page-anchored KP status and
  Section/Subsection learning controls remain the lightweight learning entry points.
- Removed generic always-visible AI access. “继续解释” appears only when a temporary
  Assistant draft or Root already exists. It reopens that context (selecting Assistant
  if Master is currently displayed); existing PDF/Guide/Inline selection and Master
  learning/source entries remain unchanged. Reader close still destroys temporary roots.
- Toolbar-only paint overrides unify text weight, transparent controls, hover/active
  feedback and muted readiness text. Control order, sizes, grid, PDF geometry and
  responsive interaction model are unchanged. The Section hint is bounded to avoid
  expanding the heading. Guide reopen now attaches after Outline because its former
  DOM sibling was the removed map button; no Guide logic changes.
- No backend, schema, API, Inline Teaching logic, Master logic, source/Review/persistence
  authority, dependencies or Frozen Blueprint edits. This user request explicitly
  supersedes only the restored full-map toolbar access from the earlier rollback.

## Verification

- `tests-e2e/reader-restoration.mjs`: PASS on an isolated real 348-page Library copy.
  Original PDF canvas bitmap equals `92febf6`; 920 × 1282 backing/CSS size and 68px
  toolbar at 1600px. Viewer and Outline/Search/Marks bounds match at 1600/1280/1024px.
  Confirms absent map controls, absent generic AI, current Section 2.2, real KP → Master
  form → close, printed-page prompt → cancel, Search “中断向量” → result → source highlight.
- `tests-e2e/ask-about-this.mjs`: PASS, including selection, depth 3, sibling/Back,
  close → “继续解释” → same Root, failed Child retry and Reader-close cleanup. Empty
  reopened Reader has no Assistant toolbar entry; AI-off local access remains usable.
- `tests-e2e/four-master-screens.mjs`: PASS; Overview map and source navigation,
  Guide recovery, both Learning Memory source returns including Master, ownership,
  restart, independent OCR/Guide failure and no reading-derived mastery.
- `tests-e2e/inline-teaching.mjs`: PASS, disposable real Library
  `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-Iwx2L8/data`; generation/Review,
  markers/Guidance, Off/On, secondary regeneration, failure/retry, Guide coexistence,
  selection → Assistant, source return, zoom/narrow and unchanged protected tables.
- `npm test`: **38 passed**. Broad Python closure: **283 passed, 2 existing optional
  OCR skips, 151.76s**, `test-results/reader-toolbar-closure.xml`. Syntax/diff checks PASS.
- Screenshots visually inspected at 1600 and 1024px (1280 captured and geometry checked).
  Ignored evidence: `test-results/reader-restored-{1600,1280,1024}.png`.

Real PDF SHA256: `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
All mutation tests use disposable copies. Provider paths use loopback mocks; no external
model quality/availability claim or external model calls. Existing narrow toolbar overflow
behavior remains; this task does not redesign responsive controls. No fresh independent
core review: source, persistence and mastery boundaries are unchanged and invariant suites pass.

## Checkpoint

Product files: `static/app.js`, `static/index.html`, `static/screens.css`, and one Guide
DOM insertion line in `static/guide-ui.js`. The commit containing this report is the
checkpoint. Stop for manual retest; no further Reader restructuring is authorized.
