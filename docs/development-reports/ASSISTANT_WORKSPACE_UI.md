# Assistant recursive Workspace UI rework

## Result

User-authorized UI rework (2026-09-13, “直接实现”). `IMPLEMENTATION_READY`;
user visual/interaction retest pending. This does not reopen Frozen semantics, close a new Phase,
or claim independent review. No ZCode invocation.

## Implemented

- Expanded Assistant: 256 px Topic Navigator, Root/Child hierarchy, independent current-node
  conversation. Root rows select the Root itself; Child rows select that exact historical Child.
- Narrow Dock: bounded 220 px topic trigger opens the same tree. The previous Back/select/depth
  fraction/breadcrumb/child-list combination is no longer visible. Depth is secondary Chinese text.
- Model chooser moved into the Composer, including selection-first-send, with a short provider name.
  Locked Roots permit inspecting model options but not changing them. Escape restores focus.
- Only current-node answer DOM is mounted. Navigation metadata is not rendered as conversation.
  Unchanged current turns/pending/error/retry/save state do not rerun Markdown/KaTeX rendering.
- Per-node draft, caret and scroll are memory-only, restored on navigation and cleared with
  subtree/Root/Reader cleanup. Draft staging preserves the previous node's view state.
- Browser requests opt into `X-Assistant-View: current`: response tree entries omit turn bodies;
  `current` retains the complete focused conversation. Focus lazily reloads historical turns from
  the service. Other API consumers keep their existing full-state response contract.

## Decisions / authority boundary

The user's approved redesign replaces the old navigation presentation only. Root/Child depth limit
5, selection source mapping, sibling retention, context handoff, failure handling, model pinning,
temporary lifetime, save authority, and provider egress remain unchanged. Neither Blueprint changed.
No new dependency, RAG, Tabs, generic tree framework, provider or persistent state was introduced.

Prior-art pattern reading: VS Code editorGroupView (active editor vs view state) and
react-arborist (controlled tree selection and keyboard hierarchy). No external source code or
package adopted. UI/UX skill informed keyboard hierarchy, focus visibility and content-first layout;
existing paper/green design remains in use.

## Acceptance evidence

- JavaScript suite: 42 passed. Includes new tree keyboard/selection/metadata-only coverage and
  locked model-menu inspection/keyboard dismissal.
- Python broad suite: 285 passed, 2 existing optional external OCR skips.
- `assistant-workspace.mjs`: real 348-page textbook, actual pointer selection, local mock provider.
  Root → Child → grandchild → parent → sibling; historical reopening; subtree deletion; independent
  Root selection; drafts/caret/scroll restoration; resize and expand/collapse; Markdown/math and
  payload isolation. Five localhost provider calls; historical reopen zero calls.
- `assistant-rendering.mjs`: PASS; sanitizer, Markdown/math, duplicate/multi-span raw selection,
  code/math restriction, right-click behavior.
- `saved-explanations.mjs`: PASS; Root/Child source provenance, save/retry, restart retaining the
  saved annotation but clearing the Assistant tree, explicit saved-asset deletion. Loopback only.
- Workspace also exercised Assistant → Master → Assistant without replacing the current answer
  or making a provider call; full unrelated Master workflows were not rerun.
- `ask-about-this.mjs`: PASS; same-level follow-up, retry identity, historical branches, close races,
  anti-bypass, provider pinning, Reader lifetime, AI-off and neighboring Reader capabilities.
- `ask-deeper-stage-d-reader-smoke.mjs`: PASS; real pointer selection, highlight, note,
  search `中断向量` (10 results, PDF 263), directory `6.2.1 总线事务` (PDF 303).

Real material: existing `var/manual-browser` library, copied to isolated temporary test directories;
348-page textbook SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
No original textbook or conversation was committed. Real-provider semantic evaluation was
`INTENTIONALLY_NOT_RUN`: this task changes navigation/rendering, not prompts, models or context.

Tests exposed and corrected: old CSS hiding the new topic entry; Set-based subtree cleanup for
new draft state; missing `can_retry` in render invalidation. Historical harnesses were updated for
the accepted book-overview entry and new navigation/model controls; no test failure was treated as PASS.

Screenshots: `test-results/ask-deeper-normal-chat-layout.png` and
`test-results/ask-deeper-expanded-chat-layout.png` (local, not committed). At 1920 px viewport:
expanded tree 256 px, prose/composer lane 960 px; 610 px Dock prose lane 577 px;
topic trigger ~109 px, capped at 220 px. Long code remains locally scrollable.

## Limitations / retest

- Tabs intentionally omitted; full tree is the sole navigation source.
- Only current-node Markdown is mounted; revisiting a different node still parses that node once.
  Tree summary rows are not virtualized. No claim of a large-tree benchmark.
- Scroll restoration stores pixels, not semantic paragraph anchors across arbitrary width changes.
- Existing real-provider-only legacy harnesses were not rerun; mocks prove UI/contract behavior,
  not model answer quality. No independent review or user acceptance is claimed here.

User retest: create Root, select answer → Child, create sibling, switch any tree row, type drafts
in both, expand/collapse, inspect locked Composer model list, close Child then reopen Reader.

## Entry points / checkpoint

`static/assistant-navigator.js`: tree/view shell; `static/app.js`: focus and per-node view state;
`static/screens.js` / `screens.css`: model menu and presentation; `server.py`: browser response
projection. Run browser harnesses with `READER_DATA_DIR` pointing at the prepared real library.

Checkpoint: the commit containing this report. Pre-existing related Assistant model/menu/rendering
changes were preserved and integrated; no unrelated repository changes were discarded.
