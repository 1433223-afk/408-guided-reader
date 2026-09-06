# Ask Deeper Development Report

## Result

`IMPLEMENTATION_READY`

`AGENT_REAL_USE_PASS`

`READY_FOR_USER_RETEST`

`READY_FOR_NARROW_INDEPENDENT_REVIEW`

`REVIEW_REQUIRED: YES`

This report records the completed Ask Deeper UAT rework through Stage D. It does not claim
`USER_ACCEPTANCE PASS` or close the Phase. The user still owns real-use acceptance; after that pass,
the required independent review remains narrowly scoped to context projection/transport canaries,
Child-subtree lifecycle, sanitizer security, and rendered-selection/raw mapping.

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
- The narrow independent review required by the rework authority remains pending user retest and is
  not replaced by these implementation tests.

## Git checkpoints

- Pre-rework authority checkpoint: `4165453`.
- UAT rework implementation checkpoint: `d453a2a`.
- The report checkpoint is the commit containing this file.
