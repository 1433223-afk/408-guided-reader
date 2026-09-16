# Reader centered navigation and progress — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. No user-acceptance PASS is claimed.
Retest: **http://127.0.0.1:8767/**, existing real Library.

## UI changes

- Page navigation is a separately centered toolbar group. Its center equals the viewport
  center at 1600/1280/1024px. The toolbar remains 68px tall; PDF geometry is unchanged.
  Side tools retain their existing horizontal-scroll interaction when space is limited.
- Notes/Marks uses `▤`, distinct from Inline Teaching `✦`. Accessible name is “本页笔记与标记”.
  Outline, Search, Notes, Inline Teaching and its secondary action have subtle borders,
  quiet backgrounds and hover/active affordance; OCR readiness remains plain status text.
- Current-chapter KP preparation is restored as a bounded button. The target comes from
  the current resolved Section's chapter ownership or a unique resolved Chapter range;
  no first-chapter fallback. Missing structure permits preparation; PREPARING shows
  `prepare_stage` and real completed/total Section counts; failure retries existing
  `/prepare`; READY shows only current-Section published KP count and links to Overview.
  No full-map Reader rendering, draft KPs or new persistence behavior. Late responses
  cannot overwrite a different current chapter. Repeated clicks cannot duplicate sends.
- Generation feedback adds a subtle animated activity ring alongside existing real
  phase text. KP shows source preparation/generation/review/validation/publication;
  Guide/Inline show generation/review; Master reflects pending answer/review messages;
  Assistant retains its actual pending explanation state. No fake percentages or
  fabricated review stage. Reduced-motion keeps a static indicator and real phase text.
  Guide has an adjacent failure retry action; existing backend retry/terminal rules remain.
- Overview's existing generation status now also displays its actual preparation stage.
  READY navigation saves reading position and uses the existing Reader-close lifecycle
  before opening Overview; temporary Assistant and durable Master semantics stay separate.

## Verification

- Real 348-page PDF SHA256:
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
- `tests-e2e/reader-restoration.mjs`: PASS, original canvas bitmap identical to `92febf6`,
  920 × 1282 backing/CSS size; toolbar 68px; viewer and Outline/Search/Marks geometry
  identical at all three widths. Checks exact page-group center, real Notes/printed-page
  prompt/Search source highlights/KP → Master, and current-chapter button phases,
  failure → retry → READY → Overview's current Section map. KP stage transitions use
  controlled route responses over the real Reader; no live chapter generation claimed.
- `tests-e2e/ask-about-this.mjs`: PASS, real OCR selection, contextual resume, depth 3,
  sibling/Back/close, failed Child retry identity and Reader lifecycle.
- `tests-e2e/four-master-screens.mjs`: PASS; Overview, Guide failure/recovery, Memory
  exact source returns, membership-only removal, restart and no reading-derived mastery.
- `tests-e2e/inline-teaching.mjs`: PASS on disposable real Library
  `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-lmP17b/data`;
  generation/Review, display/Off/On, regeneration failure/retry, source/Assistant/Guide,
  narrow viewport, zoom, published-asset and protected-table preservation.
- `tests-js/chapter-entry.test.js`: departed chapter response isolation, duplicate-click
  prevention, current-Section-only count and correct Overview target PASS.
- `npm test`: **39 passed**. Python closure: **283 passed, 2 existing optional OCR skips,
  168.51 seconds**, `test-results/reader-toolbar-progress-closure.xml`.
- Syntax and whitespace checks PASS. Windows toolbar/PDF screenshots visually inspected.
  Ignored evidence: `test-results/reader-restored-{1600,1280,1024}.png`.

All mutation flows use disposable copies; generation/review/failure checks use loopback
providers or route controls. No external model quality or live-outage acceptance claim.
No backend/schema/API, PDF rendering, source anchoring, mastery authority, Inline business
logic, Assistant/Master lifecycle or dependency changes. No new independent core review:
this slice changes presentation and reuses existing guarded preparation/navigation actions.

## Checkpoint

Product entry points: `static/index.html`, `static/screens.css`, `static/screens.js`
(bounded chapter entry), `static/app.js`, and progress presentation in Guide/Inline/Master.
The commit containing this report is the checkpoint. Stop for manual retest.
