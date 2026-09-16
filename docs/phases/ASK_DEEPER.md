# Phase / Ask Deeper

> **Status: CLOSED / COMPLETE (2026-09-06).** Machine acceptance, agent real-use, user acceptance
> (`PASS_WITH_UI_POLISH_DEFERRED`), and the required narrow independent review (PASS, P0=0 / P1=0 /
> P2=4 deferred) all passed. The UAT rework was executed under
> [`ASK_DEEPER_UAT_REWORK.md`](./ASK_DEEPER_UAT_REWORK.md) (user adjudication of 2026-09-06; user
> decisions D1–D3; Implementation §14.8 amended per D1). The Hard rules below remain this Phase's
> frozen record. Closure evidence: [development report](../development-reports/ASK_DEEPER.md).

## Goal

Close the local-explanation loop: any text inside an Assistant answer can itself be asked about,
producing a bounded (depth 5) temporary explanation tree, while multiple parallel question Roots
coexist, stay switchable, and clear with the Reader.

## User-visible result

> "我在 6.2 的回答里选中「总线仲裁」再问一层，面板显示 `数据的存储方式 > 总线仲裁` 层级路径和 `2/5`
> 深度；回到教材换一段文字再问，之前的树还在，可以切换回去；点 ✕ 关掉整棵树；关闭 Reader 全部清空。"

## Authority to read

**Product Blueprint:**
- §24.2 — explainable sources include the Assistant's own previous answer text
- §24.4 — depth model: nesting depth, max 5, same-level follow-up, one-active-child, retry identity,
  provider-failure no-side-effects
- §24.5 — multiple Root contexts, focus vs close, new-Root creation rules, anti-bypass
- §24.6 — Child context construction (the exact inherit list and the negative list)
- §24.7 — one-active-child scope (per parent, not global)
- §25 — shared right-side dock; tab switching is not close
- §30.1 — grounding rules that never switch off, carried through the chain
- §38 decisions 49–55 — the frozen recursion/workspace semantics this Phase implements

**Implementation Blueprint:**
- §14.1 — scope is a property of a Root; each Root resolves its own scope
- §14.3–§14.11 — Root/Node structure and structural depth unreachability; same-level multi-turn;
  Child creation and context construction; one-active-child atomicity; source-kind gating and the
  anti-bypass rule; multi-Root focus and retention; retry idempotency; provider-failure guarantees;
  grounding carry-through and the same-level context budget
- §13.8 — typed provider failures, bounded retry, cooling (already implemented; binding)
- §21.2, §21.3 — credential handling and the single egress boundary (already implemented and
  independently reviewed; unchanged and binding for every payload this Phase sends)

## Hard rules

- **Depth is nesting depth, maximum 5.** Ordinary same-level multi-turn follow-ups never increase
  depth and are available at every level, including depth 5. Depth 6 is **structurally unreachable**:
  the single depth-increasing entry point returns a typed rejection, and no code path can construct a
  depth-6 node.
- **Only a selection inside an Assistant answer turn creates a Child.** `ASSISTANT_ANSWER` content can
  never become a new Root — the source-kind gate makes the bypass structurally impossible, not merely
  forbidden by UI convention (Product §24.5, Implementation §14.7).
- **A non-Assistant Reader selection always creates a new Root at depth 1**; existing Roots are
  preserved. The current "new selection in the same scope appends to the scope conversation" behavior
  is replaced by this frozen §24.5 model — this implements frozen authority and is not a new product
  decision.
- **Multiple Roots coexist per reader session; only one has UI focus.** Focus switching (Root switch,
  back to a parent, Assistant/Master-style tab changes in the future, returning to the Reader) never
  destroys state. **Explicit close of a Root destroys exactly that Root and its descendant subtree**
  and never grants or requires anything else. Reader/app close clears all unsaved trees; service
  restart clearing them is correct behaviour.
- **One active Child per parent, atomically.** Concurrent child creations from the same parent resolve
  to exactly one winner and one typed rejection — never two active children, never a silently dropped
  request. The constraint is per parent node, never global (Product §24.7).
- **Technical retry reuses the same logical turn identity**: no new Child, no depth change, never two
  referenceable answer turns for one question. Provider failure at any depth writes no progress, no
  learning state, no Learning History, no Master record (Product §24.4 items 8–9).
- **Child context is exactly the frozen minimal list** (Product §24.6, Implementation §14.5): the
  selected range; the **complete** triggering parent answer turn; the parent's source lineage
  (sufficient to know where the discussion originated — not the full ancestor tree); the relevant
  Reader scope where needed; minimal, explicitly assembled reference context; the parent/child
  relationship; depth = parent + 1. It must **not** automatically include the entire Root conversation,
  every previous turn at the parent level, the whole ancestor tree, the full Section text, or any
  notes/highlights/learning state. Existing same-level history bounds (bounded turns and characters)
  continue to apply at every depth — no unbounded context growth.
- **Provider/model is pinned per Root** (bake-off semantics): follow-ups and children of a Root stay on
  that Root's provider; `新对话` / closing the Root unlocks a fresh choice; a provider is never switched
  inside an existing tree.
- **Pure memory.** No conversation/Root/Child tables, migrations, cache files, or any persistence;
  the normal runtime path writes no conversation content to disk (existing rule, now covering trees).
- **The egress and credential boundary is the already-reviewed one, unchanged**: one configured
  endpoint per provider, redirects refused, system proxies ignored, secrets never in
  status/inspection/logs/errors; payload inspection remains bounded and in-memory.
- **Scope isolation is unchanged**: each Root resolves its own scope (SECTION only when uniquely
  determined; honest PAGE fallback); PAGE conversations never merge into SECTION conversations;
  different Roots and scope keys never share history.

## Build

- Service-side, in-memory per reader session: `AssistantRoot` (scope, created-from selection source,
  provider/model pinning, same-level turns at depth 1) and `AssistantNode` (depth 2..5, parent
  reference, active-child reference, same-level turns), with the single `create_child` entry point
  (typed validation before any provider call: depth < 5, valid selection within the parent's most
  recent answer turn, no existing active child), per-parent compare-and-set, retry idempotency keys,
  and close-Root subtree destruction — per Implementation §14.3–§14.9.
- Typed selection-source routing: non-Assistant source → new Root; `ASSISTANT_ANSWER` → `create_child`
  on the owning node, with no code path from answer content to a Root (§14.7).
- Client: selecting text inside an answer bubble gains a 「再问一层」 action; breadcrumb / back-to-parent
  navigation; a `n/5` depth indicator (especially near the limit); a retained-Root switcher whose
  labels derive from each Root's originating selected text — never internal terms such as Root/Child/
  Window (§24.5 item 9); explicit per-Root close; the existing provider-lock UI and follow-up input are
  unchanged in role.
- **Lifecycle race (must fix if violated):** if the existing stale-response / close / new-root race can
  corrupt the new Root/Child lifecycle — e.g. an in-flight response resurrecting a closed Root or
  attaching to the wrong node — fix it in this Phase with tests. The **`_session_locks` reclamation
  remains deferred debt**: fix it only if the new lifecycle implementation removes it naturally and at
  low risk; it is *not* a completion blocker, and this Phase must not expand into lock/governance work
  to retire it.

## Not now

- **Streaming responses** — a separate later slice, not merged here.
- **Save to Notes** and its verification requirement; **figure/formula explanation and multimodal**
  (awaits D-3 and a multimodal provider); **Master, KP, Chapter Preparation, Teaching/Reading Guide**;
  any review capability; **cross-page selection**; **OpenRouter proxy work and the default-provider
  decision** (open user decisions, unrelated to and unblocked by this Phase).
- **Not a future order.** Everything in this Not-now list is excluded from *this* Phase only. After
  Ask Deeper closes, the next slice is re-adjudicated from actual product state per `AGENTS.md` §7.

## Acceptance

Machine (mock provider; no real key needed):
- Depth 6 is unreachable; same-level follow-ups work at depth 5 without depth change.
- An `ASSISTANT_ANSWER` selection cannot create a Root (structurally rejected); a non-Assistant
  selection creates a new Root while prior Roots survive.
- Concurrent child creations on one parent yield exactly one Child; the loser gets a typed rejection.
- Technical retry creates no Child and does not change depth; a provider failure at any depth writes
  nothing durable.
- Closing a Root destroys its subtree only; other Roots and their states are untouched; focus
  switching preserves all temporary state.
- Child provider payload is exactly the frozen §24.6 list — payload-inspection assertions verify the
  presence of the complete triggering parent turn and the absence of other Roots, other scopes'
  histories, the full ancestor tree, and notes/highlights.
- Cross-Root and cross-scope history isolation; PAGE never merges into SECTION.
- After service restart: zero residue in database and process state; no new tables or files; Reader
  close clears all trees.

Real-use (348-page book, either callable provider):
- From a real answer (e.g. the 大端/小端 explanation), drill 2–3 levels into embedded terms and verify
  each level's answer stays focused on its own selection, not the whole ancestry.
- Mid-tree, select new textbook text → a new Root opens; switch back → the first tree is intact at its
  previous depth and focus; the `n/5` indicator and explicit close behave as frozen.
- Close and reopen the Reader: everything is gone; `新对话` unlocks model choice again.

## Autonomy

Breadcrumb form, depth indicator placement, Root switcher layout, close/back affordances, label
truncation, panel styling, test structure, and small local refactors are loose edges per
`AGENTS.md` §5 — the requirement is only that the user can clearly understand the current Root, its
parent chain, the current depth, how to switch Roots, and how to close one. The state-machine
semantics and Hard rules above are not loose.

## Must report before proceeding

Stop and report (`AGENTS.md` §5), never route around, if implementation reveals any need to:
- enlarge the Child provider payload/context set beyond frozen §24.6 / Implementation §14.x;
- change the existing egress or security boundary, or introduce any persistence;
- change source or scope authority semantics;
- touch any other high-risk authority boundary (durable identity, destructive behaviour, mastery
  authority, a new provider endpoint/egress category).

Any of these flips this Phase's review requirement from NO to YES: the work stops for user/adjudication
before proceeding, and independent review becomes required for closure.

## Completion

- Machine acceptance with the mock adapter and real-use acceptance on the 348-page book as above;
  one development report in `docs/development-reports/`; one git checkpoint.
- **Independent (ZCode) review: NOT required by default.** This Phase mints no durable identity, adds
  no persistence or migration, performs no destructive regeneration, changes no source-anchor or
  mastery authority, and opens no new provider endpoint or egress category. The escalation conditions
  in "Must report before proceeding" are exactly what would change that — if any fired, review becomes
  required before closure and the report must say so.
