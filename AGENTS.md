# AGENTS

Entry point for anyone — human or AI — working in this repository.

This file **routes and governs**. It does not specify the product or the engineering design. When it
disagrees with a blueprint, the blueprint wins and the offending line here should be deleted.

---

## 1. What this project is

**408 Guided Reader** — a new project. Not a version, fork or continuation of `408-ai-ebook`.

The earlier repository at `D:\codex\408-ai-ebook` is **frozen historical evidence**. Its product
documents, phase decisions, domain model and code carry **no authority here**. Its commits are
useful only as provenance citations.

## 2. Current authority

| Document | Role |
|---|---|
| `PRODUCT_BLUEPRINT.md` | **Product authority.** What the product is, its invariants, what is frozen vs deferred. |
| `IMPLEMENTATION_BLUEPRINT.md` | **Engineering authority — does not exist yet.** |

**Right now the required reading is exactly two files: this one and `PRODUCT_BLUEPRINT.md`.**

`IMPLEMENTATION_BLUEPRINT.md` becomes engineering authority only after it is written, reviewed and
frozen. Until then there is no approved architecture, and none may be assumed. Once it is frozen,
required reading becomes those three files.

`docs/archive/transition/**` is historical/audit/transition evidence. It is **never** authority and
**never** cold-start reading. See §4 for the one situation in which it may be opened.

## 3. Where to look

| Question | Go to |
|---|---|
| What should the product do? | `PRODUCT_BLUEPRINT.md` |
| Is X frozen or still open? | `PRODUCT_BLUEPRINT.md` — its "decisions now treated as agreed" and "deferred" sections |
| How is it built? | `IMPLEMENTATION_BLUEPRINT.md` — **unanswerable until that exists** |
| Why was the old project retired? What evidence exists? | `docs/archive/transition/` — reference only, subject to §4 |
| What actually happened in a past phase? | `docs/development-reports/` |

## 4. Working rules

**Repository truth outranks model memory.** Inspect the current repository before planning or
implementing. Never substitute chat history, recollection, or a previously seen state for what the
files say now. If a required input is missing, say so — do not infer it.

**Drafting is not authorization.** A brief, plan or design you produce is a proposal until the user
accepts it. Never mark your own work `ACCEPTED`, `APPROVED` or `FROZEN`. The existence of a plan,
a file, a stub or a passing test does not authorize the next step.

**Do not consult the transition archive for architecture.** While the engineering design is being
drafted, `docs/archive/transition/**` must not be used as a source of structure — that would let
retired code shape the new architecture. It may be consulted only during an explicit, separately
authorized reuse-reconciliation step, once the architecture is otherwise settled.

**Approval gates.** Ask once, explicitly, and wait — for a missing user-controlled input, a genuine
product/architecture ambiguity, adopting a major or core external dependency, or any destructive Git
operation (`reset`, `rebase`, `clean`, force-push, history rewrite, mass deletion). Do not ask about
ordinary reversible engineering choices; decide those and proceed.

**Freeze invariants, not trivia.** Naming, module organization, helper placement, local algorithms
and test layout are reversible — just choose. Reserve freezing for behaviour, ownership, persistence
meaning and source-of-truth semantics.

**Secrets never get committed.** No `.env`, credentials, API keys or tokens. A non-secret
`.env.example` is the only place environment keys are illustrated.

**External reuse.** For a large, core or genuinely complex block, investigate mature open-source
solutions before building — when that research is materially useful. For small or local
implementation, do not perform ritual GitHub searches; just write it. Adopting a major or core
external project requires a fit analysis (what is reused, maintenance state, licence, integration
cost, lock-in, self-build alternative) and user approval before adoption.

**Failure never becomes success.** A bounded retry that exhausts, a review that does not run, or a
tool that fails to respond is **not** a PASS. Never convert an invocation failure into "no findings".
Report what actually happened, including when it is inconvenient.

**Development reports.** Every formal implementation phase ends with one concise report in
`docs/development-reports/`: objective, what was built, real architecture decisions made, modules
changed, state/schema changes, validation performed, known limitations and debt, dependencies
adopted, deviations from plan, handoff notes. It is a log for humans and context for future AI —
not a source dump.

## 5. Current state

Baseline only. **No engineering architecture has been selected** — no framework, ORM, schema,
migration root, package layout, task runtime, OCR engine, or dependency set. No implementation code
exists, and none should be written before `IMPLEMENTATION_BLUEPRINT.md` is frozen.
