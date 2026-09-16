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

## Shared expansion and outer-edge scrolling (2026-09-13)

User requested Master/Assistant expansion parity and GPT-like right-edge workspace scrolling.
Master now has an explicit Expand/Restore action wired to the same `setAssistantExpanded` state,
width restoration and application-area shell as Assistant. The existing Hide action still hides
the Dock. Switching Assistant/Master does not reset expansion, draft or conversation state.
Master provider readiness is not required to expand or restore.

The cause of the middle scrollbar was that `#assistant-turns` itself had the prose max-width.
Expanded scrollports now span the full workspace right edge; only their message children have
the 1024 px prose limit. `#master-history` uses the same separation. Composer remains independently
centered at 960 px. Existing scroll owners/IDs remain intact, preserving Assistant per-node
scroll restoration and Master near-bottom handling. There is no extra nested vertical scroller.
Local code/math horizontal overflow is unchanged. No PDF geometry, Root/Child/context model,
provider, persistence, Reader toolbar, KP, Guide or Inline behavior changed.

UI/UX skill informed focus/scroll separation; no dependency or external code adoption.
Validation uses an isolated real 348-page library with localhost mocks/AI-off, not user data writes:
`assistant-workspace.mjs` checks outer scrollport right = viewport right, inner prose/composer
widths, recursive selection, historical navigation, scroll/draft restoration and mode reversal.
`conversation-composer.mjs` opens a real retained Master, adds an explicitly synthetic DOM-only
long-content fixture (not persisted), tests wheel scrolling at the right edge, Master expansion,
cross-tab mode parity, restore-to-Dock width, retained draft and unchanged review strength.
`assistant-rendering.mjs` PASS for sanitizer/Markdown/math and selection-to-source mapping.
42 JavaScript tests PASS. No external provider call, Frozen change or independent review.
Screenshots: `test-results/assistant-expanded-edge-scroll.png` and
`test-results/master-expanded-edge-scroll.png`. Human visual acceptance pending.
Final broad regression: 285 Python tests PASS, 2 unchanged optional external OCR skips.
Current 8767 serves app/Master/CSS HTTP 200 and returns two books; refresh only, no restart needed.

## Master GPT-style Topic workspace (2026-09-13, user retest pending)

Master expanded mode now has a flat, book-local list of actual durable Master Topics, not
Assistant Root/Child nodes or KP threads relabeled as Topics. Selected rows are green, long labels
truncate with native hover titles, and each row exposes scope and ACTIVE/RESOLVED status.
The central chronological conversation filters by selected Topic ID; prose and Composer share an
800 px centered lane. The existing history scrollport reaches the viewport's right edge. The
Composer retains its low-weight review-strength menu; no provider selector moved into the header.
Assistant recursion, narrow thread-history rendering and other Reader regions are unchanged.

`LearningRepository.entries()` adds only a read-only projection of existing Topics within currently
published scopes. No schema, writes, migration, provider/context or mastery rules changed. Selecting
history makes GET requests only. Resolved Topics show their own history without a misleading Send
or confirmation action; explicit continuation targets the existing ACTIVE Topic, or stages a new
question whose Topic is created by the existing send path. Draft and retry intent survive scope
navigation in memory. Memory links select the message's Topic before revealing its row.

UI/UX skill informed readable measure and lightweight navigation; existing paper/green styling
and native controls retained, no dependency or external code adopted. Earlier workspace pattern
research remains applicable; this is a local projection/layout change, not a new navigation framework.

Validation: 42 frontend tests and broad Python suite (285 passed, 2 existing optional OCR skips).
Added real-identity/read-only Topic projection coverage; affected learning suite: 22 passed.
`conversation-composer.mjs` PASS on an isolated copy of the real 348-page library: real Reader
marker entry, flat Topic switching, exact message-ID filtering, resolved-history controls, zero
navigation writes, preserved draft/mode, failed-send recovery, right-edge wheel scrolling and
expand/restore reversal. The harness locates the visible marker action at page level because its
popover placement need not remain within the original title-filtered marker locator; no KP code changed.
`assistant-workspace.mjs` PASS with five localhost mock calls and unchanged recursive flow.
No real external provider calls; full Master provider semantic evaluation intentionally not rerun
for this UI-only delta. Screenshots visually inspected: `test-results/master-topics-history.png`
(real retained conversation) and `master-expanded-edge-scroll.png` (DOM-only long-content fixture).

Port 8767 restarted with the same invocation/data directory to load the new read-only projection.
Original library still contains two books; Master module/CSS HTTP 200, Topic projection populated.
Restart clears temporary Assistant state by design, not durable books/notes/Master history.
No Frozen changes, independent review or human acceptance claimed. READY_FOR_USER_RETEST.

## Quiet expanded UI and message ruler (2026-09-13, user retest pending)

User confirmed the screenshot means a message-position ruler: hover preview, click to navigate,
and scroll-following current position within the current Topic/Node. Implemented in
`screens.js:createMessageRail`, mounted once for Assistant and Master. It observes only the
mounted conversation, previews bounded plain text (240 characters, four visible lines), and
scrolls only that conversation's existing scrollport. It neither fetches historical nodes nor
calls providers or persists content. Current-node replacement rebuilds ticks and clears old previews.
Arrow/Home/End navigation, Enter, Escape, focus preview and reduced-motion behavior are included.
Ticks remain separate from the full Topic/Root/Child navigator; no new conversation semantics.

Prior-art source inspection (patterns only, no code/dependencies adopted):
- LobeChat `src/features/Conversation/ChatList/hooks/useConversationScroll.ts` and
  `useTopicScrollPersist.ts` at https://github.com/lobehub/lobe-chat: container-scoped message
  lookup and layout-aware scroll handling. Their React/virtua and localStorage approach was not adopted.
- VS Code `src/vs/editor/browser/viewParts/overviewRuler/overviewRuler.ts` at
  https://github.com/microsoft/vscode: separate overview presentation from scroll/content ownership.
These are analogous implementations, not the screenshot's Codex source. No pixel-identical or
internal-Codex implementation claim. UI/UX skill informed keyboard access, focus and reading measure.

Expanded answers now use transparent backgrounds without card borders. Questions retain a quiet
neutral bubble; Composer has one unified border with mode controls inside. Master topic confirmation,
historical continuation and lifetime explanation move to `主题操作`; no action or authority is removed.
Answer metadata, provider/reviewer chain, detailed diagnostics, learning-memory action and review
retry live under a native disclosure. Failed/unfinished review retains an honest short visible label;
user send failures and generating states remain actionable. Open answer disclosures survive polling.
Other Reader regions, providers, durability, mastery, Frozen documents and source geometry unchanged.

Validation: 43 JavaScript tests PASS, including new message-ruler keyboard/local-scroll/cleanup test;
broad Python 286 PASS / 2 unchanged optional OCR skips. Real 348-page isolated-library browser paths:
`conversation-composer.mjs` PASS (Topic isolation, pointer preview, keyboard positioning, transparent
answer/single Composer border, controlled technical-review failure disclosure/retry visibility,
draft preservation, right-edge scroll and expand/restore); `assistant-workspace.mjs` PASS
(current-Node tick count/preview, recursive selection, sibling/Root isolation, draft/scroll recovery);
`assistant-rendering.mjs` PASS (Markdown/math/sanitizer and selection mapping). Local mocks/AI-off
only; no real provider calls or original-library writes. Test fixtures are not user conversation data.

Visual evidence: `test-results/master-message-rail.png`, `master-topics-history.png`,
`ask-deeper-expanded-chat-layout.png` (local only). Corrected an old max-width selector that
initially constrained the new scroll wrapper; both outer edges now remain at the viewport edge.
Limitations: previews are excerpts, not generated summaries; very long tick lists scroll locally;
no pixel-level Codex parity or large-history performance benchmark is claimed. Human visual and
interaction acceptance remains pending. No independent review or closure.
8767 serves updated scripts/CSS HTTP 200 and original two books; static-only refresh, no restart.

## Master Review diagnosis and paired-item UAT correction (2026-09-13)

User requested a narrow Master/Assistant correction, not Reader/KP entry work. Narrow Master answers
now have transparent prose surfaces too; questions retain a light neutral bubble. Topic-title actions
are directly visible: explicit understood confirmation, explicit unclear (existing `/open` semantics),
and collecting the latest visible completed answer into learning memory. Existing per-answer memory
actions remain available. Historical continuation stays explicit. Removed lifetime copy and the
topic-action disclosure. No new mastery state or automatic inference is introduced.

Review UI distinguishes `内容审查未通过` from `审查暂未完成，可稍后重试`; review retry stays visible.
Provider/model/reviewer and technical reasons remain in details. A FAIL is never presented as PASS.
The ruler now has one item per question/answer pair, with both excerpts in the preview; it navigates
to the question. A missing answer says waiting rather than pairing with an unrelated question.
Preview uses restrained 130 ms entrance/indicator transitions, disabled for reduced-motion users.
Earlier GitHub pattern study remains applicable; no framework or external code adopted.

### Actual failure evidence (not inferred from UI wording)

- Live retained history had two Gemini/OpenRouter `TECHNICAL_FAILURE` records with the specific
  invalid-structure reason, not content verdict FAIL. The Master path has no cross-provider fallback.
- Two bounded synthetic Gemini calls using the old Review request succeeded at transport level and
  stopped normally, but strict validation failed. The diagnosed response was Markdown-fenced JSON
  (`Review verdict is not JSON`), not token truncation or rejected credentials. Historical raw
  responses were not retained, so their exact syntax cannot be retrospectively proven per record.
- Root technical defect: Review requested JSON only in prose, while its validator requires a strict
  JSON object. The already-supported OpenRouter JSON-object request option was not supplied here.
  Fixed only the Master Review call to enable it for OpenRouter; unchanged schema, two-attempt bound,
  model routing, grounding, and PASS/FAIL validation. No permissive parsing or review bypass added.
- Same synthetic request with JSON mode validated successfully. A real retained failed answer was
  retried through `LearningService.retry` on an isolated real-library copy with its original
  reviewer `openrouter / google/gemini-3.8-flash`: PASS. Answer content, message count, Topic records
  and mastery status were unchanged. Original historical answers were not silently rewritten.
- Zhipu failure was NOT reproduced. Live readiness: configured/credential available/config valid,
  Credential Manager `408-guided-reader-zhipu`, `GLM-5.3-Flash`, no cooling. Two native Zhipu calls
  completed normally with valid Review objects. This proves current small-request connectivity,
  not all historical failures or long-payload reliability. No Zhipu fault or fix is invented.
- Whitelisted environment inspection of the live process found no Assistant/Master/Review overrides:
  current defaults are DeepSeek / DeepSeek / Zhipu. All roles share named provider runtime/credential
  configuration; role selectors differ. Historical Gemini reviewer metadata is not evidence of the
  current role selector or of fallback execution. No role defaults changed in this task.

Diagnostic budget actually used: two small Zhipu calls, three small authorized Gemini calls
(two old-contract, one corrected), and one Gemini retry over an isolated retained real answer.
Only sanitized status/length/finish/schema evidence was output; credentials, headers and content
bodies were not logged/captured. Temporary diagnostics and user material are not committed.

### Verification / handoff

43 JS tests PASS; 23 affected learning tests PASS, including explicit JSON mode, content FAIL
remaining FAIL and retry recovery. Broad Python: 287 PASS / 2 existing optional OCR skips.
`conversation-composer.mjs` PASS: narrow transparent answer, direct topic action/lifetime removal,
review details and visible retry, paired preview/tick count, right-edge scrolling and mode reversal.
`assistant-workspace.mjs` PASS: paired current-node items plus existing recursive/scroll/draft golden
path. No KP entry, PDF geometry, source authority, persistence or Frozen edits. No ZCode invocation.
Screenshots: `test-results/master-narrow-quiet.png`, `master-message-rail.png` (local only).
8767 restarted with the original data path and unchanged default role configuration; original two
books and static HTTP 200 verified. Temporary Assistant clears on restart by design. Human retest
pending; if Zhipu fails again, its exact operation/error is still needed to diagnose that failure.

## UI deletion pass / non-disclosure controls (2026-09-13)

User explicitly retained Master's service-level fixed provider; no model selector, provider routing
or request/persistence contract change was made. This correction is static UI only.

Deleted the redundant Master status line in idle state, default PASS/not-requested review prose,
the duplicated latest-answer memory action (title action remains), and unused topic/review
disclosure CSS. Older answers retain their own memory action because they target different assets.
Required send errors and generating feedback remain. Technical Review failures show only
`审查暂未完成` and `重试`; content FAIL remains explicitly distinct. PASS has no status block.
`审查详情` is a plain button opening a bounded native popover containing technical metadata/reason,
with Escape, outside dismissal and Close. Topic/Reader changes dismiss it. No Review data is altered.
Composer review strength and Assistant model triggers have no triangle suffix; Assistant tree
collapse uses plus/minus, keeping hierarchy and keyboard semantics. No new toolbar/model label.

Both composers use native content-sized textareas (28 px minimum, 180 px maximum before scrolling),
which also size correctly when drafts are restored programmatically. Master narrow answers remain
transparent prose and user questions remain light containers. Topic confirmation/unclear/memory
actions remain next to the title with their existing authority.

Additional public prior-art inspection: Magic UI `apps/www/registry/magicui/dock.tsx`,
https://github.com/magicuidesign/magicui — distance-based neighboring magnification and return
motion. The initial Aceternity source URL was unavailable, not treated as evidence. Borrowed only
the distance-decay interaction concept; no React/Motion dependency or external code adopted.
Ruler lines now scale according to pointer distance over 48 px with restrained 160 ms easing;
neighbors participate, hit targets stay fixed, and reduced motion suppresses transitions.
Paired question/answer excerpts, current-item state and container-local positioning are unchanged.
UI/UX skill informed accessible dismissal, content sizing and non-hover-only operation.

Validation: 43 frontend tests PASS (including neighbor scale and paired navigation checks);
287 Python PASS / 2 existing optional OCR skips. Real 348-page isolated-library browser harnesses
`conversation-composer.mjs`, `assistant-workspace.mjs`, `assistant-rendering.mjs` PASS. Tests cover
textarea grow/shrink, actual detail button/Close/Escape, retained failure retry, narrow transparency,
topic/recursive navigation, scroll/draft preservation, right-edge scroll and mode reversal.
One harness assumption that a topic had only one question was corrected to verify positioning at
the actual last question in the newer real-library copy. No production workaround for that test.
Screenshots inspected: `test-results/master-review-popover.png`, `master-message-rail.png`.
Mock/AI-off only, no real provider calls or original-library writes. 8767 static HTTP 200 and original
two books verified; refresh only. No Frozen/KP-entry/other Reader structure changes, no independent
review, no closure. READY_FOR_USER_RETEST.

## Reference-image ruler correction (2026-09-14)

The user's additional screenshots exposed a presentation mismatch: centered green magnification
is not the reference's left-aligned neutral ruler. Changed only the ruler: fixed left origin,
10 px pitch, one charcoal emphasized tick, gray neighbors tapering 26/19/12/5/4 px with pointer
distance, and 140 ms easing. Hover emphasis is independent of the scroll-position aria-current;
leaving returns to the actual current item. No fabricated marks for short conversations.
Preview title is now medium-weight single-line ellipsis, answer excerpt three lighter lines.
Preview follows the hovered tick around its vertical midpoint, constrained to the scroll shell.
Keyboard focus uses the same emphasis; reduced motion suppresses transitions. Earlier public
distance-based prior-art remains relevant; no new dependency, architecture or authority change.

Validation: 43 JS suite PASS; expanded 20-round fixture checks symmetric taper, minimum tick length,
single emphasis, keyboard/local scrolling and cleanup. Real 348-page isolated-library Master and
Assistant browser paths PASS, retaining actual Topic/Node count, preview, right-edge scrolling,
recursive navigation and draft recovery. The Master harness now selects an actual retained answer
instead of assuming the next-most-recent Topic is nonempty. No product workaround or user-data write.
Updated local screenshot: `test-results/master-message-rail.png`. Human screenshot/motion retest
pending; no pixel-identical Codex claim. This is static-only; refresh 8767, no restart required.
Broad regression: 287 Python PASS / 2 unchanged optional OCR skips.

### Idle ruler correction (2026-09-14)

User supplied the idle reference: all ticks must be equally short and light. Removed visual
current-item emphasis on initial display, dismissal, and non-hover scrolling; `aria-current` still
tracks the actual reading position. Idle ticks are all 4 px; hover/keyboard preview keeps the
existing distance taper. No other presentation or conversation changes.
43 JS tests PASS, with explicit idle/start/scroll/Escape checks; served real-library Composer
browser path PASS. First browser attempt failed while copying a disappearing SQLite WAL file;
unchanged harness rerun passed, no user-data or storage-code changes. Prior broad result above
remains the baseline; this intermediate visual correction does not claim Phase/UAT closure.
Static refresh only; user visual retest pending.

Idle-length clarification (2026-09-14): user clarified that current-item color must remain dark
and rejected the 4 px idle length. Restored the earlier 14 px default length for every idle tick;
only the actual current item is charcoal. Hover taper is unchanged. Targeted ruler tests cover
equal idle lengths and current-color ownership after scroll/Escape. No conversation or other UI change.

## Master minimal actions / review deletion pass (2026-09-14)

Removed Master review-details entry/popover and all assistant provider/model/reviewer/detail
rendering. PASS has no review text. Technical failure shows only `审查暂未完成 · 重试`;
content FAIL shows `内容审查未通过 · 重试`. Retry still calls the existing Review path;
no verdict, review policy or stored diagnostic is changed. Deleted the Master `仍不清楚`
button, title-level action row and duplicate latest-answer memory entry. Continuing a question
does not acquire new mastery-write authority.

`已弄懂` is in the Composer `…` menu when the current Topic is confirmable (existing Section
wording remains `都清楚了`). `收入学习记忆` is in each completed answer's `…` menu and targets
that exact message. Native popovers support keyboard focus, Escape/outside dismissal and close
on scope/Reader changes; no triangle disclosure or technical-details replacement. Transparent
answer prose, light question bubbles, auto-growing Composer, fixed service-level Master provider,
review-strength control and existing historical continuation remain unchanged.

Read `ui-ux-pro-max` fully. Two focused placement searches did not yield a verified direct match;
placement uses its general content-first/progressive-disclosure and accessible-control principles,
plus actual frequency and target ownership, not a claimed database recommendation. No redesign,
external code adoption or dependency. The ruler, KP entry, PDF geometry and other Reader UI are
unchanged. No Frozen, backend, persistence, Review/Mastery/Memory semantics or routing changes.

Validation: 43 JavaScript tests PASS. Served-browser `conversation-composer.mjs` PASS on an
isolated copy of the retained real 348-page library: menu open/Escape, exact confirmation Topic
and memory message IDs at mocked HTTP write boundaries, failed-action recovery, PASS/FAIL/technical
failure presentation, no technical-detail DOM, narrow/expanded transparency, Topic isolation,
draft/mode recovery and edge scrolling. `assistant-workspace.mjs` PASS for recursive navigation,
selection, sibling/Root isolation and draft/scroll recovery. Original data untouched; zero external
provider calls. Real-provider answer evaluation intentionally not rerun for this static UI change.
Screenshot inspected: `test-results/master-answer-more.png` (local only).
Broad regression rerun: 287 Python tests PASS, 2 unchanged optional external OCR skips.

8767 serves updated Master/CSS HTTP 200 and the original two books. Static refresh only; no service
restart or temporary-conversation clearing. Human visual/interaction acceptance remains pending;
no ZCode review or Phase closure. READY_FOR_USER_RETEST.

## Assistant latency and Zhipu readiness diagnosis (2026-09-14)

The live Zhipu failure was a local launch configuration error, not a credential/provider defect:
`.tmp/start-reader-8767.ps1` explicitly set `GUIDED_READER_ZHIPU_DISABLED=1`. The Windows
Credential Manager target `408-guided-reader-zhipu` was present and secret-free status checks showed
the credential, `GLM-5.3-Flash`, official HTTPS endpoint, configuration/model/endpoint validation and
cooling state were all healthy. Removing that local override and restarting 8767 changed Zhipu to
`READY`; a real Reader draft could select Zhipu and Send was enabled with no AI-off message. The
frontend already consumes `/api/assistant/status`: unavailable choices remain discoverable so their
specific diagnostic can be shown, while Send is disabled at the provider boundary.

One real 348-page textbook selection used 4 selected characters, 209 same-page OCR characters,
safe Chapter/Section metadata and the compact Skill. Context construction took about 1 ms. Exact
provider-reported prompt totals were 554 Zhipu tokens / 566 DeepSeek tokens for Root, 923 for a
Zhipu same-level follow-up, and 977 for a Zhipu Child. Root had zero history; follow-up carried one
bounded prior user/answer pair; Child carried the complete triggering parent answer required by the
Frozen Child contract plus the same bounded source context. No complete Section/Chapter OCR, Root
conversation, ancestor tree or unbounded history was sent. Segment token values are only local
estimates because neither provider exposes per-segment counts and no tokenizer dependency was added;
the final prompt totals above are provider usage, not estimates. True TTFT is unavailable because
the product path remains `stream=false`; total latency is not mislabeled as TTFT.

Default real totals were Zhipu Root 9.209 s, follow-up 16.015 s, Child 13.362 s, and DeepSeek Root
6.364 s. A same-prompt narrow comparison reduced Zhipu Root to 4.358 s / 315 completion tokens with
`reasoning_effort=low`, and DeepSeek Root to 2.150 s / 279 completion tokens with
`thinking=disabled`, versus 933/927 default completion tokens. Both returned complete approximately
500-character answers. Assistant now applies only these already-supported per-call parameters;
grounding, egress, history bounds and answer limits are unchanged. Provider latency still varies: a
subsequent real Zhipu Reader request took over 15 seconds, so this is a measured reduction in excess
reasoning work, not a guaranteed latency SLA or a reason to add RAG/vector storage.

Long requests now show `准备上下文` and then `正在回答` in the existing polite live region. Ask has
no review stage to fabricate; flows that actually save/review an explanation retain their existing
review feedback. Validation: 71 Assistant Python tests PASS; 43 JavaScript tests PASS; JavaScript
syntax PASS; real 348-page `ask-about-this.mjs` PASS after narrowing one stale test selector to the
Assistant model list. Live 8767 Zhipu status/draft/real answer path passed. No new endpoint,
dependency, persistence, telemetry, context category, vector DB, RAG or Frozen change.

## Genuine Assistant streaming (2026-09-14)

Assistant Root, same-level follow-up, Child and explicit Child retry now negotiate SSE on the
existing endpoints. The sole OpenAI-compatible provider adapter parses fragmented UTF-8 SSE,
multiline `data:` fields, `choices[0].delta.content`, final usage and `[DONE]`; it does not turn a
non-stream response into a typing animation. DeepSeek and Zhipu both passed direct authenticated
protocol probes before integration, so no second adapter, endpoint or dependency was required.
Reasoning-only deltas remain internal and do not delay or contaminate the visible answer with
reasoning text.

The Reader lifecycle is visibly `准备上下文…` → `正在回答…` → incrementally appended plain text →
`完成`, after which the existing Markdown/KaTeX/sanitizer path renders the final answer. No
percentage is shown. If the provider stream ends or fails after visible content, that partial text
stays in the current temporary view and an explicit `重新回答` action is shown. Runtime retry remains
bounded only before the first visible delta; after a visible delta it never silently replays and
duplicates text. Closing a level, Root or Reader aborts its live browser stream; the existing
generation/session checks still prevent closed state from being resurrected.

Metrics come from the real provider stream, not animation timing. On the real 348-page textbook,
exact PDF-page-169 selection `地址码` through the actual Reader Assistant endpoint measured:

- DeepSeek: 259 visible deltas; client/runtime TTFT 869/833 ms; client/runtime total latency
  2398/2361 ms; 259 provider-reported output tokens; 445 output characters.
- Zhipu: 151 visible deltas; client/runtime TTFT 917/878 ms; client/runtime total latency
  2773/2734 ms; 154 provider-reported output tokens; 259 output characters.

The live UI was also driven with real pointer selection and right-click on that textbook for both
providers. Zhipu was additionally observed during a longer follow-up: the `正在回答…` state was
followed by a visibly growing unparsed plain-text stream, then a 1516-character safely rendered
final answer. DeepSeek completed the same selection flow. Browser diagnostics contained no Assistant
error and no secret; only the source PDF's existing optional-content-group warning appeared.

Validation after integration: `python -m pytest` **296 passed, 2 skipped**; `npm test` **47 passed**;
real-library `ask-about-this.mjs`, `assistant-workspace.mjs` and `assistant-rendering.mjs` all
**PASS**. The workspace/rendering provider fixtures were updated to emit real SSE instead of JSON
when `stream=true`, so affected regression exercises the actual protocol. Tests cover fragmented
UTF-8, lifecycle/deltas/metrics, preserved partial content, explicit same-identity Child retry,
no retry after a visible partial, Root/follow-up/Child contracts, close races, current-view
projection, sanitizer rendering and AI-off/Reader neighbors.

Grounding construction, selected/source context, complete triggering-parent Child handoff, bounded
same-level history, provider pinning and egress categories are unchanged. Provider payload
inspection remains bounded and in memory; API keys/Authorization headers are absent from events,
logs and errors. Conversation lifetime remains Core-Service memory only. No vector DB, RAG,
telemetry, persistence, Frozen Blueprint change or unrelated performance architecture was added.
This is an Assistant streaming increment, not a new Phase closure or independent-review claim.

## Streaming length-limit UAT correction (2026-09-15)

A real streamed answer visibly ended halfway through a Markdown table while the Reader labelled it
`完成`. The OpenAI-compatible adapter was recording provider `finish_reason` but accepted any stream
that reached `[DONE]`; therefore `finish_reason=length` at the 4096-token request ceiling was
misclassified as a successful complete answer. DeepSeek and Zhipu now reject a non-empty
length-limited response as `response_length_limit`. The Reader retains already displayed deltas and
shows the explicit recoverable message `回答达到长度上限，未能完整结束；已保留收到的内容，可以继续生成。`;
the incomplete text is not committed to temporary conversation state and no automatic retry occurs
after visible output. Normal `stop`, transport interruption and empty-response behavior are
unchanged. That checkpoint deliberately corrected classification before changing the token budget.

Validation: deterministic fragmented-SSE tests cover both DeepSeek and Zhipu `length` termination;
the non-stream compatibility path is covered too. Full Assistant Python tests, the full Python
suite and all 47 JavaScript tests PASS. The real-348-page-library Ask/Ask-Deeper browser regression
PASSes against the genuine SSE mock provider, including preserved partial content and explicit
same-identity retry. The first browser invocation did not reach Reader because the default stale
local data directory lacked the expected 348-page book; rerunning with the current manual-browser
library passed. No real provider call was needed for this deterministic protocol correction.

## Provider output budgets and explicit continuation (2026-09-15)

The Assistant's 4096-token output ceiling was traced to Provider Bake-off checkpoint
`3c5327bb` (2026-09-05). It replaced an earlier 900-token budget after real calibration showed
that provider reasoning could consume the generation allowance and leave an empty or visibly
truncated answer. It was an empirical safety setting, not a Product/Frozen limit and not a
provider maximum. The shared runtime already accepts a bounded per-call override up to 16384 tokens;
other generation paths were already using that facility.

Current official provider documentation confirms that reasoning is not a separate free budget:

- DeepSeek's Chat Completion usage reports `completion_tokens_details.reasoning_tokens` within
  `completion_tokens`; thinking and visible answer therefore share the requested generation
  allowance. The current `deepseek-flash` documentation lists substantially higher model output
  capability than this product needs, with non-thinking and thinking defaults above the old 4096
  setting. Sources checked: <https://api-docs.deepseek.com/api/create-chat-completion>,
  <https://api-docs.deepseek.com/quick_start/pricing>, and
  <https://api-docs.deepseek.com/guides/thinking_mode>.
- Zhipu documents `GLM-5.3-Flash` as forced-thinking with a 128K maximum output and states that
  thinking consumes additional tokens. Repository calibration independently observed the former
  900-token allowance being exhausted by reasoning before a visible answer. Sources checked:
  <https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash>,
  <https://docs.bigmodel.cn/cn/guide/capabilities/thinking>, and
  <https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8>.

Assistant calls now use 8192 tokens for DeepSeek's existing non-thinking fast path and 16384 for
Zhipu's existing forced-thinking `reasoning_effort=low` path. These are deliberately below the
providers' theoretical maxima: enough headroom for reasoning plus a complete textbook explanation,
without turning an ordinary Ask into an unbounded long-form generation. No new deep-mode UI,
provider, model, prompt/grounding category, RAG or automatic continuation loop was introduced.

`finish_reason=length` remains a failure, never `完成`. It bypasses retry and cooling, retains the
already streamed text, and exposes `继续生成` only for that typed failure. Clicking it explicitly
resends the original bounded grounding/messages plus at most 16000 characters of the retained
partial answer and one internal instruction to continue from the cutoff without repetition.
Successful output is joined into the same Root/follow-up/Child answer; the original selection or
typed user message, Root/Child identity and depth remain unchanged. Other partial transport failures
retain the existing `重新回答` recovery. No automatic provider call is made.

Verification: all Assistant Python tests PASS, including provider-specific request budgets,
non-cooling length failure, bounded continuation payload shape, exact original user message,
same-level follow-up and same-identity Child continuation. JavaScript stream tests PASS. The served
real-348-page-library `ask-about-this.mjs` path PASSes the deterministic SSE `length` scenario:
partial text remains visible, `完成` is absent, `继续生成` is explicit, the DeepSeek request uses
8192 with thinking disabled, and the completed answer combines both pieces. Provider maxima and
reasoning accounting were documentation/calibration findings; this correction did not spend another
real-provider call or claim a new latency benchmark. Frozen Blueprints are unchanged.

## Master workspace morph UAT polish (2026-09-15)

Master Expand/Restore now keeps the existing workspace and Composer DOM in place while the Dock
surface opens from its right-edge origin. The workspace and focused conversation anchor move for
220 ms with `cubic-bezier(.2,.72,.22,1)`; the Topic sidebar starts after 96 ms and fades/slides 10 px
for 124 ms. Restore reverses the ordering: the sidebar leaves in 96 ms while the paper surface and
conversation begin after 36 ms and settle over 184 ms, still ending at 220 ms. Width is never
animated, so long answers reflow once at the final layout instead of on every frame. Reduced-motion
switches to the same final state synchronously.

The real 348-page retained-Master flow verifies the same `#master-question` node, draft, selection,
focus, current Topic, answer scroll and Topic-list scroll across expand and restore. The focused
browser run measured 269 ms from pointer click through Playwright polling after the declared 220 ms
animation. Screenshots are `test-results/master-morph-before.png` and
`test-results/master-morph-after.png`. `conversation-composer.mjs`, all 47 JavaScript tests, and the
real-book `assistant-workspace.mjs` regression PASS; the latter required only narrowing its stale
model-option test selector to the Assistant-owned menu after Master gained its own menu. External
provider calls remained zero. Port 8767 serves the current app and is ready for direct retest.

No Assistant behavior, Reader layout, PDF geometry, Master Topic/history/model/Review/Mastery
semantics, persistence, API, schema or dependency changed in this motion-only correction.

## Assistant workspace morph and selection-open latency (2026-09-15)

Assistant Expand/Restore now uses the accepted Master Workspace Morph timing and easing while
retaining the existing Assistant workspace and Composer DOM. The focused conversation moves with
the workspace for 220 ms using `cubic-bezier(.2,.72,.22,1)`; the recursive Topic tree follows after
96 ms with a 124 ms fade/10 px slide. Restore reverses the sequence: the tree leaves in 96 ms and
the workspace settles after a 36 ms delay over 184 ms. Reduced-motion applies the same final state
synchronously. Root/Child focus, current node, history and tree scroll, Composer draft/caret/focus,
model choice and pending/error/retry UI remain attached to their original DOM/state.

The selection-to-Assistant pause was local Reader work, not provider wait. Opening the panel called
`captureZoomAnchor()`, synchronously read geometry across the 348-page document, then
`relayoutPages()` removed and recreated the PDF page wrappers. On the real textbook the baseline
recorded 391 page-DOM mutations, a roughly 122 ms click-adjacent long task, shell visibility at
38.9 ms and first frame at 57.2 ms. The selection entry now stages the draft and opens the already
mounted Assistant shell as a fixed overlay without changing `.assistant-dock-open`; status refresh
and the eventual provider request remain asynchronous. The selection toolbar exits over 90 ms.
The final same-path browser run recorded shell visibility at 20.1 ms, first frame at 39.6 ms, no
long task at or above 50 ms in the 300 ms observation window, zero destructive page mutations and
unchanged PDF canvas identity. Ordinary later toolbar reopening keeps its existing Dock path.

Validation: all 47 JavaScript tests PASS. `assistant-workspace.mjs` PASS on the isolated copy of the
real 348-page textbook, including Root/Child/sibling navigation, pending-state rapid Expand/Restore,
failure-state Expand/Restore with the same retry UI, same Composer identity, draft/caret/focus/model,
history and tree scroll, Dock resize, reduced motion, preserved PDF canvas identity and zero external
provider calls. `ask-about-this.mjs` PASS for the full adjacent Assistant contract and Reader-close /
AI-off recovery. Screenshots are `test-results/assistant-morph-before.png` and
`test-results/assistant-morph-after.png`. Port 8767 responds with the current no-store static app.

No Root/Child, maximum-depth, context handoff, provider routing, request payload, persistence,
Assistant/Master authority, PDF geometry or other Reader interaction changed. This UAT correction is
`READY_FOR_USER_RETEST`; it does not claim user acceptance or reopen a Phase.

## Reader auxiliary-panel performance audit (2026-09-15)

The Reader's auxiliary panels now change presentation without calling the PDF rebuild path. The
audit covered Assistant, Master, Reading Guide, Inline Teaching/Guidance, Outline, the current
chapter KP drawer, Search, and Notes/Marks in both directions, plus Assistant/Guide resizing and
Assistant/Master/Guide expand and restore. The frozen Guide split-reader behavior remains: Guide
still occupies its separate resizable reading column and the PDF stays visible. Existing panel
ownership, source anchors, provider requests, Master lifecycle, Learning Memory ownership and PDF
zoom behavior are unchanged.

The shared cause was broader than the earlier selection-to-Assistant path. Ordinary Assistant and
Master close/reopen still captured geometry for every one of the 348 page wrappers and scheduled
`relayoutPages()`. Search, Marks and the former Knowledge panel inherited the same cost when they
closed the Dock. Guide and Inline Teaching shared a layout callback that called the same rebuild for
open, close, expand, restore and every divider-width update. A direct baseline on the real book
measured 74–99 ms Long Tasks for Assistant open/close and the panels that closed it, and 87–147 ms
Long Tasks for Guide transitions. Each action removed 8–12 rendered PDF descendants, replaced the
canvas nodes and, for Guide, displaced the saved scroll position while the new placeholders were
laid out.

Panel layout callbacks now only apply their panel DOM/class change. Dock and Guide resizing no
longer capture a PDF anchor or rebuild page wrappers; only actual Zoom and browser-window resize
retain `relayoutPages()`. The selection-created Assistant still uses the accepted overlay entry,
while ordinary toolbar reopen keeps the existing Dock presentation. Master learning-control
refreshes now decorate already-rendered pages directly instead of using PDF relayout as a refresh
mechanism. `captureZoomAnchor()` itself locates the nearest ordered page with a binary search over
page offsets and reads one final rectangle, replacing the previous whole-book rectangle scan while
preserving the same normalized anchor result.

Inline Guidance exposed one second issue after the shared rebuild was removed: opening a card could
synchronously recalculate every rendered page and then repeat the work through Viewer and card
`ResizeObserver`s. One run reached exactly 50 ms without touching a canvas. Card open now lays out
only its anchored source page, and observer-triggered marker recomputations are coalesced into one
animation frame. Source availability, marker collision rules, active-card placement and local
on/off persistence are unchanged.

The reproducible audit is `tests-e2e/reader-panel-performance.mjs`. It runs against an isolated
SQLite backup and the real 348-page textbook
(`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`). For each of 29 pointer
operations it observes Long Tasks for 600 ms, PDF subtree removals, wrapper and canvas object
identity, backing and CSS canvas dimensions, zoom, vertical scroll and horizontal scroll. The final
run recorded zero Long Tasks at or above 50 ms, zero PDF subtree removals, unchanged canvas/wrapper
identity and dimensions, and zero zoom/scroll movement for every operation. Representative shell
state timings were Assistant close 5.8 ms and open 0.4 ms; Master open 15.2 ms and close 6.2 ms;
Guide open 15.8 ms and reopen 19.1 ms; Inline card open 21.5 ms, close 28.2 ms and disable 38.4 ms;
KP drawer open 18.6 ms; Search open 26.6 ms; Marks open 11.1 ms. These are local browser timings,
not a cross-device latency SLA.

Validation passed: all 47 JavaScript tests; the new real-book panel-performance audit;
`assistant-workspace.mjs`; `ask-about-this.mjs`; `guide-split-reader.mjs`;
`inline-teaching.mjs`; `kp-reader-overlay.mjs`; and `reading-position.mjs`. The two older affected
browser fixtures were updated only to enter through the current Book Overview route and consume the
already-established Assistant SSE contract. No real provider call, backend/schema change, new
dependency or Frozen Product change was made. This correction is `READY_FOR_USER_RETEST`; it does
not claim user acceptance.

## Docked panel resize layout correction (2026-09-16)

The no-relayout performance correction exposed a presentation regression: desktop Guide and the
shared Assistant/Master Dock remained absolutely/fixed positioned while the Viewer only simulated
the occupied width with a right margin. Each PDF page also retained the inline horizontal offset
computed when the Viewer was full width. Resizing a panel therefore changed neither the page offset
nor the panel's participation in layout; the PDF could appear clipped beneath the panel instead of
yielding and recentering.

Desktop Guide and Assistant/Master now occupy a real second CSS Grid column below the shared Reader
toolbar. Updating the existing width custom property resizes that column and the Viewer together.
Existing page wrappers use CSS auto margins while a Dock is open, so pages that fit recenter inside
the new Viewer width without changing canvas dimensions. Pages wider than the remaining Viewer keep
normal horizontal overflow and the existing scroll position. The selection-created Assistant and
the explicit narrow-screen presentation remain overlays; expanded workspaces retain their existing
full-surface behavior. No Reader state, panel lifecycle or provider path changed.

The real-348-page targeted audit now has a resize-only path covering Assistant, Master and Guide.
It asserts real-column positioning, exact Viewer/panel boundary adjacency, conserved width, page
centering when the page fits, stable current page/zoom/scroll, unchanged wrapper/canvas identity and
dimensions, zero PDF subtree removals and no Long Task at or above 50 ms. The final run measured
Assistant close/open at 5.3/0.4 ms and resize first-frame at 7.3 ms; Master open at 12.9 ms and resize
first-frame at 7.0 ms; Guide open/close/reopen at 16.2/0.3/16.2 ms and resize first-frame at 11.9 ms.
Every resize conserved width exactly and produced no qualifying Long Task. The focused Assistant
navigator/Master marker tests and the served real-book Guide split-reader regression also PASS.

No `relayoutPages()` call, geometry scan, PDF/OCR render, backend/schema change, dependency or
Frozen Product semantic change was introduced. This correction is `READY_FOR_USER_RETEST`; it does
not claim user acceptance.

## Full-width Reader toolbar and Dock closure correction (2026-09-16)

The first Grid-column correction was being overridden by a later `:has(#inline-open)` rule. Because
every Reader contains that control, the rule always forced the Reader back to one explicit column
and enabled horizontal scrolling on the toolbar control group. A docked panel then occupied an
implicit second column that `grid-column: 1 / -1` did not span, cutting the toolbar at the PDF/Dock
boundary. This was a CSS cascade defect; Inline Teaching state and behavior were not involved.

The conflicting single-column and toolbar-scroll rules are removed. The toolbar now spans the full
explicit Reader grid while only the second row switches between one column and `PDF | Dock`.
Control gaps, divider margins and excess minimum width were tightened enough to keep the accepted
toolbar hierarchy intact. At 1440 px the accepted direct controls remain visible; at 960 px only the
Zoom group moves behind a `...` control, with the menu collapsed by default and keyboard Escape
support. Both widths have zero toolbar/control-group horizontal overflow. Guide, Assistant and
Master continue to share the same Dock column and page auto-centering rule. Closing any Dock
immediately returns the second-column width to the Viewer; the real-book runs measured a 0 px
page-center error after every close without changing the current page, zoom, vertical or horizontal
scroll.

Assistant and Guide resize handles are transparent at rest. Hover, keyboard focus and dragging use
one 1 px neutral gray line (`rgba(91, 98, 93, .28)`) instead of the previous green treatment.

The resize-only real-348-page audit now also asserts full Reader-width toolbar bounds, zero toolbar
and control-group horizontal overflow, immediate Viewer-width restoration and PDF recentering after
Assistant, Master and Guide close, plus neutral handle states. All checks PASS at 1440 px and 960 px.
The final 1440 px run recorded no Long Task at or above 50 ms, zero PDF subtree removals, unchanged
wrapper/canvas identity and dimensions, and stable current page/zoom/scroll. Resize first-frame times
were 6.8 ms for Assistant, 5.5 ms for Master and 6.7 ms for Guide. The focused Assistant
navigator/Master marker tests and served real-book Guide split-reader regression also PASS.

No `relayoutPages()` call, full-book geometry scan, PDF/OCR rebuild, backend/schema change,
dependency or Product semantic change was introduced. This correction is `READY_FOR_USER_RETEST`;
it does not claim user acceptance.

## Guide and conversation Dock parity correction (2026-09-16)

User retest showed that the Guide could still be resized across most of a 1920 px Reader. It was a
real Grid column rather than an overlay, but its independent width rule allowed roughly 1600 px and
left too little PDF viewport to read, producing the same practical failure as covering the source.
Assistant and Master were already bounded to a 320–760 px Dock with 410 px default width and at
least 280 px reserved for the Reader.

Guide now uses those same bounds and default width. Its paper background, border, heading controls,
menu, scrollbars and resize affordance use the same low-saturation Reader treatment as the
conversation Dock. Guide and conversation resize handles now have identical 12 px hit areas, 1 px
neutral indicators, hover/focus timing and dragging state. Their content scrollbars also share the
same thin neutral thumb and hover color.

The served real-348-page Guide split-reader path PASSes at both 1440 px and the reported 1920 px
viewport. It verifies the 410 px default, exact 760 px maximum, Viewer/Guide boundary adjacency,
matching Guide/Assistant handle geometry and active color, matching scrollbar properties, pointer
and keyboard resizing, expand/restore, close/reopen, retained Guide reading position, source return
and window resizing. The focused all-Dock performance path also PASSes: no Long Task at or above
50 ms, no PDF subtree removal, stable wrapper/canvas identity and dimensions, and unchanged page,
zoom and scroll. No PDF relayout, OCR work, business behavior or product semantics changed.

This correction is `READY_FOR_USER_RETEST`; it does not claim user acceptance.

## Reading Guide first-generation interaction correction (2026-09-16)

Opening an unpublished Section Guide previously exposed the expanded reading surface with no primary
action; the only generation command lived in the overflow menu. The Guide now opens in its normal
410 px Dock and presents `生成本节导读` directly in the content area. While the task runs, that same
area reports preparation, generation, independent Review and revision stages. A first-publication
failure exposes an enabled in-place retry. A published Guide still opens directly to its article;
its overflow menu contains only the existing low-frequency regeneration action. Expand and overflow
controls stay hidden until a published article exists, so an unpublished Guide cannot enter the
empty focus layout or offer a meaningless restore action.

The controlled real-348-page flow PASSes first generation, observable generation and Review stages,
publication, close/reopen and service-restart recovery, failed regeneration preserving the old
article, first-publication failure with in-place retry, reviewed replacement and generation without
a READY KP ledger. The failure CTA is asserted enabled and retains the Reader's green primary-action
hover instead of inheriting the generic pale button hover. The served split-reader regression also
PASSes pointer and keyboard resize, expand/restore, close/reopen, source return, retained Guide
position and PDF visibility. The broader Dock performance harness was attempted but stopped before
its Guide checks because the current manual Library lacks the `继续 Master 对话` control expected by
its Master fixture; that unrelated fixture failure is not recorded as a PASS.

No Guide endpoint, persistence, Review/publication rule, PDF geometry, canvas/OCR path, dependency or
Frozen Product semantic changed. This correction is `READY_FOR_USER_RETEST`; it does not claim user
acceptance.

## Reading Guide control, selection and close-centering correction (2026-09-16)

The Guide-specific expand interaction and overflow menu are removed. A published Guide now exposes
`重新生成` directly beside Close; generation and retry continue through the existing task lifecycle
and in-place status controls. The Guide prose uses the same transparent-blue native selection
treatment as the Reader. Its shared light selection toolbar is narrowed to exactly `复制` and
`问 AI`; PDF selections retain Highlight, Note and Close because their source-authority workflow is
unchanged.

Closing the Guide previously removed the Grid column but allowed an old inline page offset to
override the normal auto margins. At zoomed layouts this left the PDF visibly off center even when
horizontal scroll had already returned to zero. Reader page wrappers now keep CSS auto centering
across Dock transitions. When a page remains wider than the restored viewport, Guide close measures
only the current page and updates only the Viewer horizontal scroll to center it. No all-book scan,
`relayoutPages()`, wrapper/canvas replacement or OCR work occurs.

The controlled real-348-page Guide flow PASSes direct regeneration placement, absence of Expand/More,
transparent-blue Guide selection, the exact Copy/Ask-AI action set, generation/Review/publication,
failure retry and restart recovery. The served split-reader regression PASSes pointer/keyboard
resize, close/reopen, source return and high-zoom close centering with the same canvas identity,
page, zoom and vertical scroll. This correction is `READY_FOR_USER_RETEST`; it does not claim user
acceptance.
