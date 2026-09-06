# Phase / Ask Deeper — UAT Rework

> **Status: CLOSED / COMPLETE (2026-09-06)** — all four stage golden paths PASS; user acceptance
> `PASS_WITH_UI_POLISH_DEFERRED`; independent narrow review PASS (P0=0 / P1=0 / P2=4 deferred).
> Authority: user adjudication of 2026-09-06 — the directed ZCode adjudication of the USER
> ACCEPTANCE FAIL, plus user decisions **D1–D3** approved in that same directive. This brief is
> the rework authority for [`ASK_DEEPER.md`](./ASK_DEEPER.md); it does **not** replace it. Every
> Hard rule, Not-now item and egress/persistence boundary of the accepted brief remains binding.
> Where the two differ, this brief governs execution of the rework only.

## Goal

Fix the three real-use failures that blocked user acceptance — contaminated Child context,
branch-hostile navigation, and unrendered Markdown/math — without changing any frozen product
semantics beyond the one user-approved amendment (Implementation §14.8, decision D1).

## Binding diagnosis (2026-09-06 adjudication)

- **P0 — Context.** `provider_child_message` leads the model-visible Child message with an
  internal-state block `【父子关系】` (plus `深度 n/5`, the `ORIGINAL_PDF` enum literal, and raw
  character offsets), and places the user's actual selected focus **last**, under a label the
  system prompt never defines for Child turns. The real failure "selected 像乐队里的节拍器 →
  answered about 父子关系" is prompt contamination plus priority inversion — an implementation
  bug, not a model error and not ancestor accumulation (the inherit set is already correctly
  minimal; the grandchild payload already excludes grandparent answers).
- **P1 — Navigation.** `active_child_id` is enforced as a lifetime existence lock
  (`ACTIVE_CHILD_ALREADY_EXISTS` forever), the frontend disables answer selection once any child
  exists, returning to a parent shows only an unlabeled `进入已有的下一层 →`, pending is rendered
  on the parent page, there is no Child-subtree close, and no scroll restoration. This is stricter
  than frozen §24.7 and fails §24.5 item 8's discoverability requirement.
- **P2 — Rendering.** Answers render via `textContent` only; `\[..\]` math and Markdown symbols
  display raw. No rendering pipeline exists.

Machine acceptance passed because payload tests assert content presence/absence only — never
ordering, focus dominance, or absence of internal terminology.

## Authority to read

Inherited: everything in [`ASK_DEEPER.md`](./ASK_DEEPER.md) §"Authority to read", plus
Implementation §14.8 **as amended 2026-09-06** and §25 register row **A-19**.

External evidence: the user-supplied Deep Research report *Recursive Explanation and Branching
Chat for a Reader-Native AI Assistant* (2026-09-06) — **pattern-only, non-authority**. Where its
suggestions conflict with the Frozen Core or the real code, the adjudication rulings in this brief
govern (notable rulings: no Node/Attempt class refactor — the existing reservation/CAS structure
already provides the semantics; no React-specific rendering stack — the Reader frontend is not
React; no Forward navigation; no branchId/graph architecture).

## User decisions (approved 2026-09-06 — no longer open)

- **D1 — Child-subtree close.** Explicit Close of a Child subtree is a legal destructive
  operation. Executed as the minimal amendment to Implementation §14.8 (see FROZEN_AMENDMENT
  below). Product Blueprint unchanged.
- **D2 — Markdown + math dependencies.** Principled approval of mature third-party libraries
  (`marked`, `DOMPurify`, `KaTeX` preferred for this non-React stack). No hand-written
  Markdown/LaTeX parser. Recorded as Decision Register **A-19**. Verify toolchain fit during
  Stage C; no further user approval needed for this adoption class.
- **D3 — Dock resize / expanded mode.** Draggable dock width + one-toggle expanded/focus mode
  (application-area, **not** browser/OS fullscreen APIs), restoring prior width on exit.

## Child Context Contract (binding)

Architecture boundary (applies to every provider call, every depth):

```
TreeState (Root/Node/turns/focus/pending — service-internal)
  → explicit semantic projection (ALLOWLIST schema below)
    → ModelVisibleContext
      → provider serializer
```

`ModelVisibleContext` is an **allowlist schema assembled field by field**, never a filtered copy
of tree state. The provider layer accepts only this schema — never Root/Node/tree/navigation
objects.

Every Child request is `[system, user]` with the user message in this fixed order (depth 2–5
identical structure; no ancestry summary by default):

1. **CURRENT FOCUS** — the exact selected source text (server re-derives it from the stored
   parent answer by offset), under the **same label the system prompt defines**, and the system
   prompt must define it for **every** selection-triggered turn, not only the first: the focus is
   the sole object to explain; locator/path/grounding blocks exist only to disambiguate.
2. **DIRECT PREVIOUS TURN** — the immediate parent's focus/question and its complete Assistant
   answer. Never recursive ancestor answers.
3. **CONCEPT PATH** — human-readable exact semantic focus labels only, e.g.
   `时钟脉冲信号 › 像乐队里的节拍器 › 高低电平变化`; max 5 labels; plus one pedagogical sentence
   carrying the §24.6 item-6 relationship ("这是对上一轮回答中『…』的进一步解释").
4. **READER GROUNDING** — the frozen §24.6 items 4–5 set: Reader scope (chapter/section/page),
   bounded same-page OCR, printed-page label. Unchanged; no egress enlargement.

**Forbidden in model-visible text** (tests enforce at the final transport body): `Root`, `Child`,
`Node`, `父子关系`/parent-child relationship, active child, subtree, branch/tree IDs,
`focusedNodeId`, depth `n/5`, `ORIGINAL_PDF`/`ASSISTANT_ANSWER` enum literals, character offsets,
request/interaction IDs, status, scroll state, sibling content, descendants, accumulated
ancestry, notes, highlights, learning/mastery history.

## State semantics (binding — minimal delta, no framework refactor)

- A parent may retain **multiple historical Children** (Child A/B/C…); at any moment at most one
  is the active/focused branch (§24.7 invariant; its "mark the old branch historical" option).
  `active_child_id` stops being an existence/cardinality lock and becomes the latest-child
  pointer (navigation hint). Per-Root `focused_node_id` (already persisted across switches)
  serves as the "last visited child" hint — add no new field.
- Concurrent `create_child` on one parent: exactly one winner under the existing pending
  reservation/CAS; loser gets the typed rejection. Unchanged.
- Retry = same logical turn identity (`interaction_id`), never a new Child, never a depth change.
  Pending/error belong to the specific Child page/attempt. A late response lands only on its
  bound node/attempt (existing generation/CAS checks) and can never resurrect closed state.
  No ExplainNode/Attempt class split — the existing `AssistantNode` + reservation fields +
  `interaction_id` already carry these semantics.
- **Close Child subtree** (D1, depth > 1): delete current Child + descendants; keep parent,
  siblings, Root; focus returns to parent, which may create/enter Children again; pending
  requests inside the subtree abort; late completions are discarded typed cancellations.
- **Close Root** (depth = 1 or root switcher): destroys exactly that Root tree. Unchanged.
- After returning to a parent, its answer stays selectable; selecting a new phrase creates a new
  sibling (previous child becomes historical, nothing destroyed silently).

## UX model (binding direction; icons/widths/animation are loose edges)

Tree storage + one focused explanation page + Back + semantic breadcrumb (`A › B › C`,
exact focus labels, not a tree debugger) + `n/5` + per-parent 已展开 children list + Root
switcher (kept separate from in-Root navigation). Creating a Child saves parent scroll, focuses
the Child page immediately, and shows pending/error **there** — the parent page never shows
"正在解释…". Back restores answer, scroll and selectability, and lists 已展开 children by exact
focus label; reopening an existing Child makes **zero** provider calls. A subtle marker on
already-expanded phrases inside the parent answer is an optional loose edge. No Forward
navigation. Close labels: depth > 1 「关闭本层解释」; depth = 1 「关闭此主题」 — no internal terms.

## Rendering pipeline (D2)

`model text → sanitize → Markdown (marked; paragraphs, headings, bold/italic, lists, inline
code, fenced code) → math (KaTeX, inline & block; `trust=false`; no cross-message macro state;
bounded pathological expansion) → DOMPurify → safe DOM`. LLM output is Markdown; **no raw HTML
ever renders**. **Hard requirement:** rendered-DOM selection must map back to the stored raw
answer verbatim — compute Child-selection offsets against raw text (e.g. hidden raw-text
anchor/mapping), never against the rendered `range.toString()`, or Stage C re-breaks Stage A.

## Dock resize / expanded mode (D3)

Default compact dock; user-draggable left edge; one-toggle expanded mode filling the app content
area (no Fullscreen API); exit restores the pre-expanded width. Width/expanded state is UI
viewport preference only: session-only (no existing local-preference mechanism — do not add one),
never sent to a provider, never in learning state, never part of Root/Child/conversation
identity. Must not grow into multi-floating-window systems, per-level OS windows, a window
manager, or a nested split-pane framework.

## Staged acceptance (binding order — no stage skipping, no full suite on a failed stage)

For user-visible interaction, **machine PASS ≠ real-use PASS**. Each stage gates on an
**agent real-use golden path**: the site actually running, the real 348-page book, real mouse
paths. Real-provider smokes within these golden paths are authorized by this brief (bounded,
inspector-verified, secret-free); the mock harness covers the rest.

- **Stage A — Context correctness (P0 only).** Golden path: Root `时钟脉冲信号`; Child selection
  `像乐队里的节拍器`. Verify final transport payload: CURRENT FOCUS = exact `像乐队里的节拍器`,
  dominant and first; canaries `ROOT_METADATA_CANARY`, `PARENT_CHILD_RELATIONSHIP_CANARY`,
  `ACTIVE_CHILD_CANARY`, `BRANCH_CANARY`, `OFFSET_CANARY` injected into internal state are all
  **absent from the final HTTP request body** (transport layer, not service intermediates); no
  `父子关系/Root/Child/node/subtree/深度 2\/5/ORIGINAL_PDF/字符范围`. Plus ≥1 real provider smoke
  confirming the model actually explains 「像乐队里的节拍器」.
- **Stage B — Recursive UX.** Golden path: `时钟脉冲信号 → 像乐队里的节拍器 → 高低电平变化`;
  Back restores parent scroll; parent re-selects `时钟周期` → new sibling; 已展开 lists both
  children; reopening the old Child makes 0 provider calls; closing one Child deletes only its
  subtree (sibling + Root intact); depth-6 still unreachable; retry/late-response identity holds.
- **Stage C — Rendering + resize.** Golden path: an answer containing `**粗体**` and block math
  `\[T=\frac{1}{f}\]` renders; the user can still precisely select plain text around rendered
  Markdown/math and Ask Deeper, with raw focus matching the visual selection verbatim; dock drag
  does not disturb Reader selection; expanded mode enters/exits, restores width, and preserves
  tree/navigation state.
- **Stage D — Regression / closure prep (only after A/B/C PASS).** Full Python suite, JS suite,
  `test:e2e:ask/r3/find/map`, provider-selector, AI-off, restart-cleanup checks; development
  report + git checkpoint; label `READY_FOR_USER_RETEST`. **USER_ACCEPTANCE PASS is declared
  only by the user.**

Required report fields per stage: Ask action clickable / Child page focused / CURRENT FOCUS
exact text / metadata contamination NONE / Parent selectable after Back YES / historical Child
count / reopen provider calls 0 / scroll restored / math rendered / rendered-selection raw match /
dock resize / expanded restore.

## Testing additions (binding)

Transport-body canaries (above); focus-dominance assertion (CURRENT FOCUS first block, exact
text); sibling isolation (Child B request excludes Child A's answer); ancestor isolation (depth-5
request contains only the direct previous answer, never depth-1–3 full answers); async identity
(pending sibling / Back / close / retry responses write only to their bound node/attempt);
render-selection mapping (Markdown/math rendering never desynchronizes UI selection from raw
answer offsets).

## Not now

Everything in `ASK_DEEPER.md` §"Not now", plus: streaming; persistence of any Assistant state;
LangGraph/XState/assistant-ui/React Flow or any graph/DAG/branchId architecture; any generic
conversation-tree framework; Forward navigation; persisted dock-width preferences; cross-page
selection; OpenRouter proxy / default-provider decisions. External projects (Open WebUI,
LibreChat, assistant-ui, LangGraph, GitChat, tldraw) remain **pattern-only**; the only approved
reuse category is the Markdown/sanitizer/KaTeX library set.

## Must report before proceeding

Unchanged from `ASK_DEEPER.md`, plus: any need to widen the Child context set beyond this brief's
allowlist; any raw-HTML rendering path; any dock-state persistence mechanism; any stage failure
that appears to require a frozen change other than the executed D1 amendment.

## Completion

All four stages' golden paths PASS + Stage D regressions + one development report (this rework
appended to the existing Ask Deeper report lineage, no closure claims) + one git checkpoint.
**Independent review: REQUIRED before closure** — the D1 frozen amendment and the D2 dependency
adoption fire `ASK_DEEPER.md` §"Must report before proceeding" escalation. Scope it narrowly:
context projection + transport canaries, close-subtree lifecycle, sanitizer path, and
render-selection mapping. The reviewer must not be the implementer.
