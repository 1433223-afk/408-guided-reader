# AGENTS

Entry point for anyone — human or AI — working in this repository.

This file **routes and governs**. It does not specify the product or the engineering design. When it
disagrees with a blueprint, the blueprint wins and the offending line here should be deleted.

---

## 1. What this project is

**408 Guided Reader** — a new project. Not a version, fork or continuation of `408-ai-ebook`.

The earlier repository at `D:\codex\408-ai-ebook` is **frozen historical evidence**. Its product
documents, phase decisions, domain model and code carry **no authority here**.

It may still be consulted when materially relevant — for generic engineering or governance
principles, Skills, tests, implementation evidence and provenance. Mine it for what is genuinely
useful; never treat anything in it as authority for this product or its architecture.

## 2. Current authority

| Document | Role |
|---|---|
| `PRODUCT_BLUEPRINT.md` | **Product authority.** What the product is, its invariants, what is frozen vs deferred. Frozen at Gate D (2026-09-03). |
| `IMPLEMENTATION_BLUEPRINT.md` | **Engineering authority.** How it is built. Frozen at Gate D (2026-09-03). |
| `docs/phases/<PHASE>.md` | **Per-task authority.** The narrow slice of Product + Implementation authority a given Phase actually needs, plus its own hard rules and acceptance. See §6. |

Both blueprints are frozen. Neither is read cover-to-cover for ordinary implementation work — see
§6, "Phase cold-start protocol." Full reads of both remain required for architecture-level work:
opening a new Phase's brief, resolving a claimed blueprint conflict, or any task that is not scoped
to a single Phase brief.

`docs/archive/transition/**` is historical/audit/transition evidence. It is **never** authority and
**never** cold-start reading. It may be opened only when a concrete contradiction in current work
cannot be resolved without it — not by default, and not for architecture reference now that both
blueprints are frozen.

## 3. Where to look

| Question | Go to |
|---|---|
| What should the product do? | `PRODUCT_BLUEPRINT.md` |
| Is X frozen or still open? | `PRODUCT_BLUEPRINT.md` §"decisions now treated as agreed" / `IMPLEMENTATION_BLUEPRINT.md` §26 "User Decisions Required" |
| How is it built? | `IMPLEMENTATION_BLUEPRINT.md` |
| What am I building right now, and what does *this* task need to read? | `docs/phases/<PHASE>.md` — see §6 |
| Why was the old project retired? What evidence exists? | `docs/archive/transition/` — reference only, subject to §5 |
| What actually happened in a past phase? | `docs/development-reports/` |

## 4. Who does what

Three coding/review models collaborate here. **Model identity does not confer authority.** Authority
comes from the current task and its approval gate, and an agent may perform only the actions that
gate authorizes — whichever model it is.

| Role | Owns | Must not |
|---|---|---|
| **Codex** | Primary implementation, integration, test execution, repository changes. Produces implementation evidence and phase reports. | Implement outside approved Product + engineering authority; self-authorize major architecture or dependency changes. |
| **ZCode** | Independent review and adjudication. Attacks implementation and contract correctness. May orchestrate approved external reviewers where explicitly allowed. | Review an implementation path it produced; silently become the primary implementer. |
| **Claude Code** | High-context architecture, planning, audit and research: implementation plans, architecture analysis, technical spikes, audit reports, test plans, and explicitly delegated implementation. | Treat its own drafting as authorization; act as final independent acceptance for work it took part in. |

Binding on all three:

- `PRODUCT_BLUEPRINT.md` is Product authority; `IMPLEMENTATION_BLUEPRINT.md` becomes engineering
  authority only after it is reviewed and frozen (§2).
- Repository truth outranks model memory (§5).
- Review failure, or reviewer-invocation failure, never becomes PASS (§5).
- User approval gates are controlling. None of the three can waive one.
- **Independence is a property of the work, not the model.** Whoever produced a change cannot also
  be its independent acceptance — this applies to all three roles symmetrically.

Per-model role documents may be introduced later **only if they materially help**, and this file
would then route to them. They should not exist for symmetry. This file stays a router.

## 5. Working rules

**Repository truth outranks model memory.** Inspect the current repository before planning or
implementing. Never substitute chat history, recollection, or a previously seen state for what the
files say now. If a required input is missing, say so — do not infer it.

**Drafting is not authorization.** A brief, plan or design you produce is a proposal until the user
accepts it. Never mark your own work `ACCEPTED`, `APPROVED` or `FROZEN`. The existence of a plan,
a file, a stub or a passing test does not authorize the next step.

**Hard core, loose edges.** Both blueprints are frozen: goals, user-visible outcomes, product
invariants and acceptance criteria are the hard core and do not move without the user. Everything
else — naming, ordinary file/component decomposition, normal helper functions, routine error
handling, ordinary CSS/layout detail, ordinary test structure, small local refactors, conventional
use of a library that doesn't change architecture or product semantics — is a loose edge. Decide
those and proceed; do not ask permission for them.

**When to stop and report instead of proceeding.** Stop and report, rather than deciding alone or
guessing, when:

1. a real Product decision is missing, or more than one choice would materially change user-visible
   behaviour;
2. the task as given would conflict with frozen Product or Implementation authority;
3. the change touches durable identity, persistence, migration, destructive behaviour, ownership or
   authority in a way not already decided;
4. it would reuse a substantial block of external code, or a GitHub project;
5. it would add a major dependency or materially change the technology stack;
6. required user-provided material is missing — a textbook, API key, account, credential, test
   corpus, or other input that cannot be substituted or invented;
7. the assigned Phase cannot meet its acceptance criteria without expanding its scope;
8. an existing frozen decision looks objectively flawed and worth reopening.

Report: the problem; why it cannot be decided alone; 1–3 concrete options; a recommendation; the
main tradeoff. Keep it short — this is not permission bureaucracy. Escalate only decisions with
material Product, architecture, data, dependency or user-input impact; everything else is a loose
edge (above).

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

## 6. Phase cold-start protocol

Implementation work is organized into **Phases** (`docs/phases/<PHASE>.md`, template in that
directory's `README.md`, see §3). A Phase brief is the day-to-day authority for the task in front of
you — it exists precisely so that neither blueprint has to be read in full for routine work.

Default cold start for a Phase, in order:

1. this file (`AGENTS.md`);
2. the current Phase brief (`docs/phases/<PHASE>.md`);
3. only the Product Blueprint sections the Phase brief's "Authority to read" names;
4. only the Implementation Blueprint sections the Phase brief's "Authority to read" names;
5. relevant current code;
6. the latest development report or checkpoint directly relevant to this Phase, if one exists.

Do not read either blueprint cover-to-cover for a Phase unless the brief says the Phase genuinely
spans them broadly. `docs/archive/transition/**` is not cold-start material under any Phase — see §2.

The Phase brief is responsible for naming the exact authority sections; if it fails to point at
something you end up needing, that is a gap in the brief to flag (§5, escalation condition 1 or 2),
not a license to fall back to a full blueprint read by default.

## 7. Current state

Both blueprints frozen at Gate D (2026-09-03). Phase-based implementation is starting with
**R1 — Read the Book** (`docs/phases/R1_READ_THE_BOOK.md`). No implementation code exists yet: no
framework, ORM, schema, migration root, package layout, task runtime, OCR engine, or dependency set
has been installed or committed. Later phases (R2+) are named and scoped in
`IMPLEMENTATION_BLUEPRINT.md` §24 but not yet briefed.
