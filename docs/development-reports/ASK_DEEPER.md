# Ask Deeper Development Report

Later user-authorized navigation/UI rework (2026-09-13):
[Assistant Workspace UI report](ASSISTANT_WORKSPACE_UI.md). This supersedes the old visible
Back/breadcrumb/Root-selector presentation below, not its frozen recursion/context semantics.

## Result

`PHASE_STATUS: CLOSED / COMPLETE`

`USER_ACCEPTANCE: PASS_WITH_UI_POLISH_DEFERRED`

`NARROW_INDEPENDENT_REVIEW: PASS (P0=0 / P1=0 / P2=4, all deferred)`

This report records the Ask Deeper implementation, the UAT rework through Stage D, the post-Stage-D
conversation-layout deltas, the user's final acceptance, and the final narrow independent review
that closes the Phase. The four review P2 observations are deferred and do not block closure; the
user separately deferred overall Assistant UI visual polish.

## Final acceptance and independent review (closure, 2026-09-06)

User real-use acceptance passed: `PASS_WITH_UI_POLISH_DEFERRED`. The functionality, recursive
interaction, context handoff, Markdown/math rendering, rendered-selection mapping, and
resize/expanded workspace were accepted. The user remains not fully satisfied with the overall
Assistant UI visual design and explicitly deferred further UI polish as separate later work — it
is not a Phase blocker, and no UI change is part of this closure.

The required narrow independent review (a fresh review-only session, scoped per the rework brief
to context projection/transport canaries, Child-subtree lifecycle, sanitizer security, and
rendered-selection/raw mapping) returned **PASS — P0 = 0, P1 = 0, P2 = 4**. All four P2 items are
deferred, none blocking:

1. marked GFM task-list syntax can leave a disabled `<input>` in the rendered DOM; a future
   rendering polish may add `input` to the DOMPurify `FORBID_TAGS`.
2. A Reader session that disappears without calling `/api/assistant/close` (e.g. a browser crash)
   leaves its pure-memory AssistantService slot until process restart; the normal close path
   reclaims properly, and the pre-existing `_session_locks` debt is gone.
3. No direct test exists for "close a Child subtree while a *sibling* creation is pending";
   implementation reading and the adjacent race tests support the current semantics.
4. `GUIDED_READER_*_MODEL` development environment overrides can still replace the frozen model
   IDs — the carried Provider Bake-off deferred debt.

A separate real-material finding: OCR can still misread math superscripts and two-dimensional
formula structure (for example `512 = 2^9` visually flattened). This is OCR/Foundation
machine-layer debt — `OUT_OF_PHASE` for Ask Deeper, non-blocking, and intentionally not touched by
this closure.

The user-supplied Deep Research report remains pattern evidence only, never authority; nothing was
adopted from it beyond the already-approved decisions D1–D3.

## Why the original user acceptance failed

The first implementation passed presence/absence tests but inverted model-visible priority. A Child
request began with `【父子关系】` plus depth, internal source enum, and character offsets, while the
actual selected `CURRENT FOCUS` appeared last. The system/Skill wording did not define that focus as
the sole explanation object for every selection-triggered explanation. In the real golden path the
user selected `像乐队里的节拍器`, but the model explained `父子关系`. This was prompt
contamination and contract failure, not provider quality.

The UAT adjudication also found that the browser treated one-active-Child as lifetime cardinality,
so a parent could not retain historical sibling explanations, and that plain `textContent` rendering
could not safely support Markdown/math or preserve raw-answer offsets after rendering.

## Authority and evidence boundary

The rework is governed by `docs/phases/ASK_DEEPER_UAT_REWORK.md`, the existing Ask Deeper authority,
Implementation §14.8 as amended by user decision D1, and Decision Register A-19. Product Blueprint
was not changed.

The user-supplied Deep Research report *Recursive Explanation and Branching Chat for a
Reader-Native AI Assistant* was pattern evidence only, never authority. Its suggestions were not
used to introduce a Node/Attempt rewrite, React rendering stack, Forward navigation, branch IDs, or
a generic graph framework. The existing reservation/CAS design and the Frozen Core remained
controlling.

## Stage A — context correctness

- Introduced the explicit boundary `TreeState → semantic projection → ModelVisibleContext →
  provider serializer`. `ModelVisibleContext` is an allowlist assembled field by field; provider
  code never receives a Root, Node, or tree/navigation object.
- Child depth 2–5 uses one fixed semantic payload order: exact `CURRENT FOCUS` first; direct previous
  semantic focus/question plus its complete Assistant explanation; human-readable concept path;
  then the already-authorized bounded Reader grounding.
- The projection does not recurse through complete ancestor answers and does not include sibling
  answers, other Roots/scopes, notes, highlights, study history, navigation state, offsets, internal
  source enums, pending state, or viewport state.
- The explanation Skill received one compact focus-priority sentence. It remains teaching strategy,
  not a state-machine or provider contract.
- Final HTTP-body canary tests inject Root/relationship/active-child/branch/offset metadata into
  internal state and prove that none reaches provider transport.
- Provider/model remains locked by Root; no fallback or egress-boundary change was introduced.

The accepted real-provider Stage A path used the real 348-page textbook, Root `时钟脉冲信号`, and
Child focus `像乐队里的节拍器`. The final request placed the exact focus first, included only the
direct previous turn, concept path, and bounded same-page Reader grounding, contained no application
metadata, and produced an answer about the selected analogy rather than tree structure.

## Stage B — recursive UX and lifecycle

- A parent now retains multiple historical Children. `active_child_id` is a latest/focus/reservation
  hint, not a permanent one-Child existence lock. Atomic concurrent creation still has exactly one
  winner during the pending transition.
- The Dock renders one focused explanation page. A new Child owns its pending/error/answer state and
  is focused immediately; the parent answer is not replaced by a pending placeholder.
- Back changes focus only, performs no provider call, preserves the Child, restores the parent's
  answer and per-node scroll, and leaves parent answer selection enabled.
- Breadcrumbs contain semantic selected-text labels and the compact `n/5` indicator. Historical
  Children appear under `已展开`; reopening one preserves its descendants and makes zero provider
  calls.
- User decision D1 amended Frozen Implementation §14.8: `关闭本层解释` at depth >1 aborts requests
  in that Child subtree, deletes that node and descendants only, keeps parent/siblings/Root, rejects
  late completion, and focuses the parent. `关闭此主题` at depth 1 still deletes only that Root tree.
- Root switching remains independent of recursive navigation and restores each Root's latest focused
  node without egress.
- Request identity and post-response CAS checks keep pending responses bound to their original node;
  Back, focus switches, Child close, Root close, and Reader close cannot resurrect or misattach state.

## Stage C — safe rendering and workspace ergonomics

### Rendering and raw-selection mapping

The approved non-React dependencies are exact-pinned in both manifest and lockfile:

- `marked 18.0.11`
- `dompurify 3.4.14`
- `katex 0.18.6`

There is no CDN or remote runtime dependency. The actual DOM path is:

`immutable raw answer → protect code/math → escape model HTML → marked → KaTeX → DOMPurify → DOM → raw-source-span annotations`

The renderer supports headings, paragraphs, emphasis, lists, inline/fenced code, Chinese mixing,
and `$...$`, `$$...$$`, `\(...\)`, `\[...\]` math. Model HTML is not trusted; links and images are
suppressed; the final fragment always passes through DOMPurify. KaTeX uses `trust=false`, bounded
expansion/size, and no shared mutable macro state. Answer length, math count, and TeX length are
bounded.

Visible ordinary-text nodes carry ordered raw code-point spans. A rendered selection may produce
multiple spans; the server validates ordering/non-overlap and reconstructs the exact stored raw
selection while excluding Markdown markers. Sequential mapping distinguishes repeated phrases and
works across rendered text nodes. Direct selection inside code or rendered math is explicitly and
honestly declined instead of fabricating a raw span.

The accepted real-provider C1 path used DeepSeek `deepseek-v4-pro` on the real textbook. Markdown,
lists, Chinese, and block `T=1/f` math rendered without raw markers/LaTeX. A real mouse selection of
`时钟周期` produced the exact same server `CURRENT FOCUS`; the inspected transport had no metadata
contamination. That path made three direct DeepSeek calls and did not fallback.

### Dock resize and expanded mode

- The Dock's left separator supports pointer drag and keyboard adjustment from 320 to 760 CSS px.
  Reader layout responds to the width without replacing conversation state or interfering with PDF
  selection/context menus.
- `展开` uses application-area layout only, not Fullscreen API/F11/new windows. `还原` restores the
  pre-expanded width.
- Root, focused node, breadcrumb, historical Children, pending/answer state, and Assistant scroll
  remain in the existing DOM/state across mode changes.
- Width is session-only. It is not persisted, added to the Assistant tree, sent to the server, or
  projected into provider context.

## Stage D — risk-driven regression

### Tests actually run

- Assistant Python core: the first closure run exposed two obsolete `endswith(CURRENT FOCUS)` test
  assertions left from the pre-Stage-A payload order (`57 passed, 2 failed`). The assertions were
  corrected to require focus-first ordering; the complete direct file then passed: **59 passed**.
- JavaScript unit suite: `npm test` — **30 passed**.
- Syntax checks: `node --check` for the Assistant client, renderer, and all Ask Deeper browser
  harnesses — **PASS**.
- Assistant tree/context/lifecycle browser suite: `tests-e2e/ask-about-this.mjs` — **PASS**. It covers
  three levels, same-level depth stability, multiple Roots, Back/scroll, sibling retention,
  zero-call historical reopen, Child/Root close, in-flight cancellation, source anti-bypass,
  provider pinning, AI-off, and Reader-close cleanup.
- Rendering/security/mapping browser suite: `tests-e2e/assistant-rendering.mjs` — **PASS**. It covers
  Markdown/code/math/Chinese, raw HTML and script-like input, sanitizer execution, code/math
  isolation, exact marker-free mapping, duplicate phrases, and multi-node selections.
- Workspace browser suite and final integrated golden path:
  `tests-e2e/assistant-workspace.mjs` — **PASS** on the real 348-page textbook. It used five local
  deterministic provider calls and zero external calls.
- Reader-neighbor smoke: `tests-e2e/ask-deeper-stage-d-reader-smoke.mjs` — **PASS** on the same real
  textbook. Real pointer selection/context menu, Highlight, Add note, Find `中断向量` (10 results,
  jumped to PDF page 263), and Map `6.2.1 总线事务` (jumped to PDF page 303) all worked with the
  resized/expanded Assistant behavior present.
- One closure Python overall run:
  `python -m pytest -o addopts= -q -ra --basetemp=test-results/pytest-stage-d-overall` —
  **105 passed, 2 skipped**. The skips are the unchanged optional external OCR paths
  `READER_REAL_DMA` and `READER_REAL_PRIMARY`.
- `python -m compileall -q src`, `npm ls --depth=0 marked dompurify katex`, and
  `git diff --check` — **PASS**.

### Final agent real-use golden path

The integrated path used the real 348-page textbook with SHA-256
`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`, real browser pointer
selection, the actual localhost service/UI/HTTP boundary, and a secret-free deterministic loopback
provider:

1. selected `时钟脉冲信号`, opened the draft, selected DeepSeek identity, proved Send enabled and
   zero pre-send calls, then created a Root;
2. rendered a Markdown heading, bold phrases, list, and block math without raw markers;
3. selected rendered `像乐队里的节拍器`, created/focused its Child immediately, and observed the
   pending state only on that Child;
4. selected `高低电平变化`, reached depth 3, then used Back twice and recovered Child/Root scroll;
5. selected `时钟周期` at the Root to create a sibling; both historical Children remained visible;
6. reopened the first Child with **0** provider calls and found its grandchild intact;
7. closed that Child subtree; its grandchild disappeared while the `时钟周期` sibling and Root
   remained;
8. created `识别异常和中断` from PDF page 263 as a second Root and switched between Roots while
   preserving the first Root's sibling focus;
9. dragged the Dock, entered/exited expanded mode, restored width/scroll/tree state, and then made
   another real Reader selection/context-menu interaction;
10. inspected all five loopback request bodies: exact CURRENT FOCUS first, three Child payloads,
    sibling-answer isolation, no internal tree/source/offset metadata, no viewport state, and no
    fallback.

Visual evidence: `test-results/ask-deeper-stage-d-golden.png`.

## Post-Stage-D conversation-layout UAT deltas

The user's first near-final retest found that expanded mode correctly enlarged the workspace but also
let ordinary message cards and the composer grow across an approximately 1920 px viewport. Capping a
centered conversation lane at `56rem` fixed the viewport-wide layout, but the next retest correctly
identified that the Assistant card still occupied virtually the entire lane and retained a
document-card appearance.

The next real-user retest found the remaining hierarchy issue: the normal Dock still rendered a
short user message as a yellow full-row strip, while both modes repeated the same topic in a large
heading, selector, answer heading, and user turn. The final narrow delta therefore applies the chat
hierarchy to both modes. User turns are intrinsically sized and right aligned; Assistant explanations
are wider, left aligned natural reading surfaces without the large white card. Expanded mode retains
the stricter 48%/82% maxima and 46rem composer. The leading rendered Markdown heading is hidden only
when its normalized visible text exactly equals that turn's question; the stored raw answer and
source mapping are unchanged.

The header now uses two compact levels: a low-weight Assistant identity/model row, then one semantic
navigation row. The Root selector is the first path segment and Child breadcrumb segments continue
after it, so Root switching and the semantic path remain without repeating the Root label in a
separate large title. Depth and the existing close action remain in that row at low visual weight;
no previous/next/forward navigation was added. Expanded mode uses an opaque focus surface, so its
intentional whitespace no longer exposes a ghosted PDF underneath. Code, tables, and block math keep
local horizontal overflow rather than widening ordinary prose.

`tests-e2e/assistant-workspace.mjs` was rerun at a real 1920×1080 Chromium viewport against the real
348-page textbook and deterministic loopback provider: **PASS**. Expanded workspace/lane measured
1920/896 px; the long Assistant answer measured 732 px, the short user bubble 92 px, and the centered
composer 736 px. Header/topic controls measured 992/220 px. In the 573 px normal Dock, the same short
user bubble measured 92 px while the Assistant reading surface measured 536 px. A deliberately
oversized code line had a 726 px viewport and 1540 px scroll width, proving local overflow.
Markdown/math, rendered selection to Child, two-level depth, Back, breadcrumb, siblings, historical
reopen, Child-subtree close, Root switching, scroll, provider payload isolation, and exit width/state
restoration all remained green. External provider calls: zero. Both final screenshots were visually
inspected for repetition, control density, conversation axis, card weight, and intentional whitespace
rather than accepted from measurements alone. Evidence:
`test-results/ask-deeper-normal-chat-layout.png` (normal Dock) and
`test-results/ask-deeper-expanded-chat-layout.png` (expanded).

## Intentionally skipped extended tests

The complete historical R3, Find, and Map browser acceptance suites were not repeated. Stage D used
the explicit risk-driven smoke above because the shared risk surface was Reader pointer selection,
context menus, DOM layout, and navigation—not persistence/restart/identity coverage already closed
by those Phases. This is a deliberate regression decision, not missing evidence.

The real-provider Stage A/B/C harnesses and provider bake-off were not rerun during Stage D. Stage A
and C1 already had accepted bounded real-provider evidence, while Stage D needed state/lifecycle and
workspace consistency; the deterministic loopback path exercised those transitions without
duplicating external egress. No R3/Find/Map full E2E, provider bake-off, OpenRouter retry, or unrelated
historical browser suite was run.

## Security and persistence result

No new provider endpoint, proxy, redirect, fallback, telemetry, credential handling, DB table,
migration, durable Assistant identity, Assistant history file, note/mastery write, or context/egress
category was added. Assistant trees and Dock preferences remain memory/session-only. Inspection and
tests contain no Authorization header or secret. Viewport state and tree/navigation metadata are
absent from final provider HTTP bodies.

## Known deferred debt

- Direct Ask Deeper selection inside rendered formulas or code is not supported; the UI states this
  explicitly. Formula/image semantic understanding remains a later multimodal capability.
- Streaming, persistent Assistant history, saved AI notes, Forward navigation, cross-page selection,
  persisted Dock preferences, generic graph frameworks, and default-provider/OpenRouter-region
  decisions remain outside this Phase.
- The four independent-review P2 observations above are deferred; none blocks closure.
- Overall Assistant UI visual polish is deferred by explicit user decision
  (`PASS_WITH_UI_POLISH_DEFERRED`); no UI change ships in this closure.
- OCR misreading of math superscripts / two-dimensional formula structure is Foundation
  machine-layer debt, `OUT_OF_PHASE` here.

## Git checkpoints

- Pre-rework authority checkpoint: `4165453`.
- UAT rework implementation checkpoint: `d453a2a`.
- Post-Stage-D UI delta checkpoints: `0f21ba4` (expanded reading width), `7c9204b` (expanded
  message layout), `5ffd272` (conversation hierarchy in both modes).
- The closure checkpoint is the commit containing this file.
