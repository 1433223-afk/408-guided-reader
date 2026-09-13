# Assistant reading-panel UI — 2026-09-13

## Result

Implemented interface for user review. No user acceptance claim; stop after showing the
result. Refresh http://127.0.0.1:8767/ and open an existing contextual Assistant entry.

## Presentation changes

- Lightweight Assistant/Master navigation tabs; Assistant model/expand/collapse controls
  grouped in the header. Duplicate collapse control hidden in Assistant mode; Master
  retains its existing collapse button and behavior.
- Compact authoritative scope text (Chapter / PDF or Section); draft uses a short source
  label. Temporary-explanation label, standalone model label, model-lock explanatory line
  and lifetime paragraph no longer occupy the primary visual layer. Model lock remains
  enforced, with the existing explanation in the selector tooltip.
- Closed model selector displays DeepSeek / GLM-5.3 / Gemini 3.8. Native menu options
  retain full provider/model strings and original values. No provider choice/routing changes.
- Topic selector/depth/back/close and breadcrumb have their own orderly header area.
  Existing source/branch/state bindings and destructive close action are unchanged.
- Assistant content has 15px long-form typography, clearer paragraphs/headings and quiet
  secondary save-to-note action. Follow-up input stays at the bottom, with paper styling.
  Initial draft Send gating, follow-up and saved note functions are unchanged.

No backend, persistence, authority, Mastery, Master lifecycle, PDF render/geometry or
source semantics changed. Scope is CSS, static labels/ARIA text and presentation text
formatting; no new UI framework or state architecture.

## Evidence

- npm test: 40 PASS; syntax/diff checks PASS.
- Served ask-about-this real-material harness: PASS; original OCR selection, model locking,
  root/child/sibling/depth, follow-up, Back/scroll restoration, close/cancel and failed Child
  retry identity/grounding. Loopback provider results; no external generation claim.
- reader-restoration: PASS, baseline PDF canvas pixel identity, 920x1282 canvas and 68px
  toolbar; 1600/1280/1024 original viewer/panel geometry preserved. KP -> Master exercised.
- Actual UI screenshots: test-results/assistant-reading-panel.png (Reader context) and
  assistant-reading-panel-detail.png (panel). Real 348-page PDF; generated fixture explanation
  is intentionally short, while deeper harness turns exercise long scrolling content.
- No Python rerun for this UI-only change; prior backend closure remains applicable.

## Checkpoint

Commit containing this report is the implementation checkpoint. User requested the
implemented interface first; stop for their review before any next UI iteration.
