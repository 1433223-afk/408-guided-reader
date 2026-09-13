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

## Same-session typography / Master Composer UAT polish (2026-09-13)

User requested modern, consistent Master/Assistant fonts and a review-strength selector matching
the Assistant model menu. The input fallback was concrete: textarea did not inherit the interface
font, and Assistant had invalid `font: 12px/1.4 inherit` shorthand. Both now explicitly use the
same local Segoe UI / Microsoft YaHei UI sans-serif stack, 15 px input and 16 px body text.
Code and KaTeX fonts and PDF rendering are unchanged; no web fonts or network dependency.

Master now reuses the existing Composer menu implementation (`createComposerChoice` in
`screens.js`). Its low-weight `标准 ▾` trigger sits beside Send, opens upward with brief option
descriptions, and supports pointer/keyboard selection, Escape, outside dismissal and focus return.
The hidden original `master-mode` select remains the value owner: Fast/Standard/Deep values,
Standard default, actual send payload, Review routing and persistence are unchanged. Input focus,
padding and shape now match Assistant; Master Send/explicit understanding confirmation are compact.
UI/UX skill informed readable typography and shared control behavior rather than a new design system.

Targeted model-menu test PASS. `conversation-composer.mjs` PASS on an isolated copy of the real
348-page library: opened a real retained KP Master through its Reader marker; selected all three
strengths, checked keyboard/Escape, intercepted a Standard send at the UI HTTP boundary to prove
the value and failure-draft retention without invoking a provider, switched Assistant/Master,
and measured equal computed input font family / 15 px size / 24.75 px line height. Both Dock
and expanded Assistant paths passed `assistant-workspace.mjs` again. Screenshots visually checked:
`test-results/master-composer-polish.png` and the updated expanded Assistant screenshot.
42 JS tests and the broad 285 Python tests passed (2 unchanged optional OCR skips).
The focused Composer harness explicitly disables all providers; retained Master opens and its
local menu remains usable under AI-off. No real provider calls; no source-Library writes; no Frozen changes.
Full Master business-workflow E2E is `INTENTIONALLY_NOT_RUN` for this style-only delta: actual
mode/send contract is checked in the focused served-Reader test; no persistence/routing code changed.
Current port 8767 serves all three changed assets HTTP 200; no service restart is needed for this
static-only change. User refresh/retest remains pending.

## Tree-first Workspace polish (2026-09-13, user retest pending)

Only Assistant presentation changed. Expanded mode has one recursive navigator: the tree.
The redundant topic trigger is hidden there; narrow Dock retains the bounded tree-popover entry.
Child indentation increases from 16 to 24 px with faint elbow guides, shallow green current-row
highlight, ellipsis and full native hover title. Escape no longer attempts to focus an invisible
topic trigger in expanded mode. Root/Child identity, selection and provider context are unchanged.

Sidebar is 232 px (was 256); expanded prose is 1024 px (was 960). Composer remains 960 px,
with its existing input/model controls unchanged. Source and Workspace actions share one header;
depth is shown only at levels 4 and 5. Thin muted scrollbars apply only inside Assistant turns/tree.
No Reader toolbar, PDF layout, marks, library, Master surface, data directory or service code changed.
UI/UX skill informed hierarchy and keyboard focus; its generic breadcrumb suggestion was not used
because the user's tree-only direction controls.

Validation: 42 JS tests PASS; actual served 348-page `assistant-workspace.mjs` PASS, including
232/1024/960 px measurements, hidden duplicate topic/depth at Root, source header placement,
Root/Child/sibling focus, subtree close, draft/caret/scroll and expanded-mode reversal.
`conversation-composer.mjs` PASS, checking preserved Assistant/Master typography and controls.
All provider activity used isolated localhost mocks; no real external calls or original-library writes.
Updated screenshot: `test-results/ask-deeper-expanded-chat-layout.png`, visually inspected.
Port 8767 serves updated CSS/module HTTP 200 and still returns the original two books.
Static-only update: refresh, no service restart. Human visual acceptance remains pending.
Final broad regression: 285 Python tests PASS, 2 unchanged optional external OCR skips.
