# Four Master Screen UI — development report

## Current result — Reader restoration, 2026-09-13

`READY_FOR_USER_RETEST`: Reader now uses the stable `92febf6` interactions and PDF
geometry with a minimal paper/ink/deep-green skin. The user rejected the redesigned
Reader in manual UAT and confirmed selective restoration. Home, Book Overview and
Learning Memory retain their redesign. No `USER_ACCEPTANCE PASS` is claimed.
Retest: **http://127.0.0.1:8767/**, existing `var/manual-browser` Library.

`92febf6` is the final pre-redesign handoff: its source/dependencies match `c702316`,
with acceptance closure recorded at docs-only `1cc9439`. `c401718` introduced the redesign.
Restoration changes only `static/app.js`, `static/index.html` and `static/screens.css`.
Original toolbar, 920px PDF base width, rendering, center-based current-page calculation,
Knowledge Map location, panel ownership, Outline/Search/Marks and responsive model are
restored. New toolbar relocation, pane observers, Marks resizing and geometry overrides
are removed. Original `styles.css`, Master and Inline modules are unchanged.

The visual skin changes colors, border colors/radii, shadows and hover/focus paint.
New-page typography is scoped away from Reader. Preserved fixes include independent
child failure handling, page-input focus protection, reading-position timestamp and
Guide Escape propagation. Migration 17, Section-end records/projection and Child retry
remain. The new Reader Section-end notice is removed; the observer uses existing canvas
geometry and error toast. No backend/API/schema/dependency or Frozen Blueprint changes.
Reader Back returns to Library/Home; new Overview and Memory source entry remain available.

### Restoration verification

- `tests-e2e/reader-restoration.mjs`: PASS against the real 348-page Library copy with
  providers disabled. Baseline and restored assets use the same served backend. Page 53
  original canvas bitmap data is identical at the same scroll/zoom: canvas and CSS size
  920 × 1282; toolbar height 68px at 1600px. Canvas/viewer geometry and Outline/Search/Marks
  bounds match baseline at 1600/1280/1024px. No page errors. This is raw canvas equality,
  not screenshot equality with recolored overlays.
- Windows screenshots at all three widths inspected. At 1024px the old crowded toolbar
  extends controls beyond the visible area; this inherited limitation is preserved under
  the user's instruction not to change the responsive interaction model. Baseline equality
  does not imply narrow-screen UX acceptance.
- Adapted `four-master-screens.mjs`: PASS, including published Guide resize/close/reopen,
  source return/replacement failure, both Memory source returns, membership-only removal,
  restart, OCR-pending PDF and Section-end observation without mastery writes. Fixture
  reading position normalized to page 53 only in a disposable copy, not the user Library.
- `ask-about-this.mjs`: PASS, including real OCR pointer selection, depth 3, navigation,
  cancellation/close, AI-off access and failed first Child retry with exact identity/context.
- `inline-teaching.mjs`: PASS, including markers, zoom/narrow/source return, Assistant,
  Guide coexistence, AI-off replacement failure/retry and non-KP generation.
- `reading-position.mjs`: PASS, page 50 offset/zoom across refresh, Home reopen, slow PDF
  + pagehide and restart; Learning unchanged.
- `npm test`: **36 passed**. Python broad closure: **283 passed, 2 existing optional OCR
  skips, 166.74 seconds**, `test-results/reader-restoration-closure.xml`.
- Provider failure/generation paths use loopback mocks over real material. No external
  model call during restoration; external answer quality is not retested.

Run the entry points below plus `node tests-e2e/reader-restoration.mjs` using the same
`READER_DATA_DIR`. Ignored visual evidence: `test-results/reader-restored.png` and
`reader-restored-{1600,1280,1024}.png`. Textbooks/screenshots are not committed.
Standalone overlapping old-topology harnesses are `INTENTIONALLY_NOT_RUN`: the five
named served harnesses cover the changed surfaces, alongside broad invariant regression.

The user-directed Brief override defers Reader master composition, unified Study Pane
migration and new navigation/responsive requirements. Stop for the seven manual checks:
PDF clarity; zoom/pages; Guide; Assistant/Master; Inline Teaching; Outline/Search/Marks;
new color treatment. Further Reader interaction changes require individual user requests.
The commit containing this update is the restoration checkpoint; user retest pending.

## Historical implementation record — c401718 (superseded Reader claims)

Everything below records the initial implementation and its pre-UAT checks. Its Reader
fidelity, viewport-top current-page, unified-pane and reserved-width claims are not the
current state or acceptance evidence for the restored Reader. The user subsequently
reported Reader UAT FAIL; the current result and evidence above take precedence.

## Result

`READY_FOR_USER_RETEST` — implemented against the four accepted visual masters.
User acceptance remains pending; this report does not claim `USER_ACCEPTANCE PASS`.
Retest service: **http://127.0.0.1:8767/**, existing `var/manual-browser` Library.

## Implemented

- Shared editorial paper chrome, Home resume and compact library, Book Overview chapter
  rail and Section-grouped published Knowledge Map, source-first Reader, independent
  Learning Memory list/detail. Guide, Assistant, Master and Marks use task-selected panes.
- Server-derived current reading context and published KP counts. PDF opening remains
  independent of Outline/OCR/Knowledge/Teaching readiness. Overview preserves published
  maps during replacement and accordion state across polling.
- Migration 17 adds independent Section-end observations after a verified SQLite backup.
  Observations use visible original canvas geometry, are idempotent, do not backfill skipped
  Sections or write mastery/history, and cascade with their owning Outline/revision.
- Memory removes stale destructive controls during async selection; exact source-backed
  content and complete raw originals remain available. Membership ownership is unchanged.
- Fixed Escape menu priority, async page-number overwrites, and current-page calculation
  using viewport center after PDF scaling. The reading anchor now consistently uses the
  viewport top for navigation, current page and saved position.
- Failed first Child exposes a server-owned retry action. `/api/assistant/retry-child`
  takes only session/Root/Child identity. The service reuses the retained original private
  grounded request and provider; it never creates another node, copies Master context,
  steals focus on completion, or persists temporary history. Duplicate in-flight requests
  are rejected. Closing the Child/Root/Reader cancels late completion. Success clears the
  retry-only context; failed attempts remain retryable subject to existing provider cooldown.

## Authorized scope additions

- 2026-09-12: user selected “扩大范围，补齐节末阅读记录和投影”.
- 2026-09-13: user explicitly authorized “补齐 Assistant Child 首次生成失败后的 retry contract”.

The latter resolved the reported code/Brief gap: formerly the failed Child had no retry
control, and recreating its ID returned 409 `ASSISTANT_CHILD_ID_ALREADY_EXISTS`. The new
retry endpoint leaves create semantics and existing temporary destruction boundaries intact.
No dependencies or new durable Assistant storage were added. The Blueprints retain authority.

## Acceptance evidence

- TARGETED: reading-context and Section-end tests, 3 passed; then Assistant/save/API affected
  regression, 89 passed. New retry tests cover same identity and exact request content across
  repeated failure, parent changes, duplicate requests, cancellation, and completed-node refusal.
- `npm test`: 36 passed, including Memory stale-action and exact-original regressions.
- CLOSURE: `python -m pytest -o addopts='' -q --junitxml=test-results/four-master-closure.xml`:
  **283 passed, 2 existing optional OCR skips, 160.80 seconds**.
- `tests-e2e/four-master-screens.mjs`: real 348-page served Edge path; Home Continue and
  Overview KP source; Navigator/Marks; Guide keyboard resizing, reading-position restoration,
  source return and local replacement failure; actual AI_SAVED collect control; both Memory
  source returns, removal and restart; Section-end observation without mastery/history writes;
  OCR-pending PDF/Marks; empty-library keyboard import and invalid-PDF recovery. Widths
  1600/1280/1024 checked for app overflow and reserved pane space. No uncaught page errors.
- `tests-e2e/ask-about-this.mjs`: real OCR pointer selection, depth 3, Root/Child/sibling/back
  navigation, scroll restoration, subtree close, cancellation, Reader-close cleanup, AI-off
  local capability access, and **failed first Child → explicit retry with identical identity
  and grounded request**. Existing provider cooldown was allowed to elapse, never bypassed.
- `tests-e2e/inline-teaching.mjs`: real source markers/cards, wheel movement, zoom, narrow
  viewport, source return, Assistant selection, Guide coexistence, AI-off replacement failure,
  retained publication, retry publication, and independent non-KP Section generation.
- `tests-e2e/reading-position.mjs`: page 50 and nonzero offset/zoom restored after refresh,
  Library reopen, slow PDF + pagehide and service restart; Learning projection unchanged.
- All four PNG masters were visually inspected against served Windows screenshots. The actual
  PDF aspect ratio/content and real KP/answer text are preserved, rather than replacing source
  material with the masters' illustrative content. System fonts only; no custom font download.
- Controlled provider and readiness failures above are loopback/route simulations over the real
  Library. They prove UI/contracts, not external model quality or a live remote outage.
- Original Library startup: no pending jobs/turns existed. Migration 17 backup, integrity/FKs,
  and hashes of **every pre-existing business table** verified unchanged. Only approved native
  DeepSeek `deepseek-flash` and OpenRouter `google/gemini-3.8-flash` profiles are configured;
  Zhipu remains disabled. No startup generation or external model call was made.

## Brief checklist mapping and limits

Visual fidelity: four Windows screenshots and code review. Primary navigation/reversal, source
return, explicit collection, removal, and restoration: four-screen/Assistant/Inline/position
harnesses. Readiness/degradation: controlled chapter states and Guide replacement; OCR-pending,
AI-off, failed Child retry; non-KP Inline generation. Authority: protected-table hashes, source
return assertions and Python invariant suites. Interaction/accessibility: native keyboard controls,
visible focus, tested Navigator focus return and Guide keyboard resize/Escape, real pointer
selection, pane widths and responsive overflow checks. Verification order: targeted → served
paths → affected regression → broad closure.

Legacy standalone E2E scripts which assume a full Knowledge Map inside Reader were not all
migrated/rerun. `INTENTIONALLY_NOT_RUN`: those redundant old-topology harnesses; affected risk
surfaces are covered by the four named current real-path harnesses and broad Python tests.
No independent acceptance/reviewer PASS is claimed. External provider quality is not retested
by this UI slice. The remaining gate is the user's visual/interaction retest.

## Reproducible entry points

```powershell
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/four-master-screens.mjs
node tests-e2e/ask-about-this.mjs
$env:GUIDE_E2E_REAL='0'
node tests-e2e/inline-teaching.mjs
node tests-e2e/reading-position.mjs
npm test
python -m pytest -o addopts='' -q
```

Real book SHA256: `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
All destructive tests use disposable copies. User textbooks/screenshots are not committed.
Ignored visual evidence: `test-results/four-{home,overview,reader,memory,guide}.png`.
Retest service logs: ignored `test-results/four-retest-service.{log,err}`.

## Architecture entry points

`static/screens.js`, `static/screens.css`, `static/app.js`, `static/memory-ui.js`;
`learning/reading.py`, `outline/service.py`, `assistant/service.py`, authenticated server routes.

## Git checkpoint

The commit containing this report is the implementation checkpoint; user retest is pending.
