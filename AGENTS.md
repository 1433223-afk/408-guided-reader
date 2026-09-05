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
| `docs/phases/<PHASE>.md` | **Per-task authority.** The narrow slice of Product + Implementation authority one small increment actually needs, plus its own hard rules and acceptance. See §6. |

Together the two blueprints are the **Frozen Core**. Both are frozen; neither is read cover-to-cover
for ordinary implementation work — see §6. Full reads of both remain for architecture-level work:
preparing the next Phase brief (§7), resolving a claimed conflict, or any task not scoped to one brief.

This repository calls each implementation increment a **Phase brief** — a small, concrete slice, not
a pre-written roadmap chapter.

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
| Why was the old project retired? What evidence exists? | `docs/archive/transition/` — reference only, subject to §6 Tier C |
| What actually happened in the last completed increment? | latest report in `docs/development-reports/` |

## 4. Who does what

Three coding/review models collaborate here. **Model identity does not confer authority.** Authority
comes from the current task and its approval gate, and an agent may perform only the actions that
gate authorizes — whichever model it is.

| Role | Owns | Must not |
|---|---|---|
| **Codex** | Primary implementation, integration, test execution, repository changes. Produces implementation evidence and development reports. | Implement outside approved Product + engineering authority; self-authorize major architecture or dependency changes. |
| **ZCode** | Independent review and adjudication, when a Phase brief actually triggers it (§5, "risk-triggered review"). Attacks implementation and contract correctness. | Review an implementation path it produced; silently become the primary implementer; review by default when nothing risk-triggered it. |
| **Claude Code** | High-context architecture, planning, audit and research: preparing the next Phase brief (§7), architecture analysis, technical spikes, audit reports, and explicitly delegated implementation. | Treat its own drafting as authorization; act as final independent acceptance for work it took part in; mechanically pre-write future briefs from the roadmap. |

Binding on all three:

- `PRODUCT_BLUEPRINT.md` and `IMPLEMENTATION_BLUEPRINT.md` are the Frozen Core (§2).
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

**Hard core, loose edges.** The Frozen Core fixes goals, user-visible outcomes, product invariants
and acceptance criteria — that's the hard core, and it doesn't move without the user. Naming,
file/component decomposition, helper placement, ordinary error handling, ordinary CSS/layout, local
algorithms, test structure, small local refactors, and conventional use of a library that doesn't
change architecture or product semantics are loose edges — reversible; decide and proceed, no
permission needed. Reserve escalation for behaviour, ownership, persistence meaning and
source-of-truth semantics — the list below. (How the *next* Phase brief gets scoped: §7.)

**When to stop and report instead of proceeding.** Stop and report — never guess, and never expand
scope quietly to route around it — when:

1. a real Product decision is missing;
2. more than one valid choice would materially change user-visible behaviour;
3. the task as given would conflict with frozen Product or Implementation authority;
4. durable identity, persistence, migration, destructive behaviour, ownership or authority would
   change beyond an already-frozen rule;
5. it would reuse a substantial block of external code, or a GitHub/OSS project;
6. it would add a major dependency or materially change the technology stack;
7. required user-provided material is missing — a textbook, API key, account, credential, test
   corpus, or other input that cannot be substituted or invented;
8. the current Phase brief cannot satisfy its Acceptance without expanding scope;
9. an existing frozen decision appears objectively flawed and reopening it may be necessary.

Report concisely: the problem; why it cannot be decided alone; 1–3 options; a recommendation; the
main tradeoff. This is not permission bureaucracy — ask authority questions, not trivia questions.

**Approval gates.** Ask once, explicitly, and wait — for a missing user-controlled input, a genuine
product/architecture ambiguity, adopting a major or core external dependency, or any destructive Git
operation (`reset`, `rebase`, `clean`, force-push, history rewrite, mass deletion). Do not ask about
ordinary reversible engineering choices; decide those and proceed.

**Secrets and user material.** No `.env`, credentials, API keys or tokens are committed; a
non-secret `.env.example` is the only place environment keys are illustrated. Logs must not expose
secrets. The user's own textbook/personal files must not enter git — only bounded, hash-referenced
test fixtures are committed, the way `docs/archive/transition/` and Phase briefs already reference
sample material by path and content hash rather than storing it. Missing user-supplied material a
Phase brief needs is escalation condition 7 above.

**External reuse and major dependencies.** For a large, common or genuinely core capability — PDF
rendering, OCR, virtualization, annotation geometry, job queues, storage, or comparable
infrastructure — investigate mature OSS before building, autonomously; no approval needed just to
look. For small or local implementation, skip the ritual search and just write it. Before adopting
anything substantial, or a dependency that materially changes the stack (a UI framework, database,
PDF engine, OCR runtime/model, job system, state-machine framework, or other large runtime), report:
project; licence; what would be reused; why it fits; dependencies it brings; maintenance/risk;
recommendation — then wait for approval (escalation conditions 5–6).

**Failure never becomes success.** A bounded retry that exhausts, a review that does not run, or a
tool that fails to respond is **not** a PASS. Never convert an invocation failure into "no findings".
Report what actually happened, including when it is inconvenient.

**User-facing language.** User-visible UI defaults to Simplified Chinese. Code identifiers, logs,
internal state names and engineering documents are exempt.

**Acceptance is machine + real use, not tests alone.** Automated tests, persistence checks, state
invariants and failure-case coverage are machine acceptance — necessary but not sufficient. Real-use
acceptance means exercising the actual user flow with real representative material where the Phase
brief's own Acceptance calls for it (a real scanned textbook, not a synthetic one; a real selection
flow, not a mock). When the necessary scale or material genuinely isn't available, say so plainly —
label the result `IMPLEMENTATION_READY` (built and correctness-tested at the material actually
available) rather than claiming a larger-scale criterion passed, and name what's still missing as
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING`. Don't block implementation over a missing scale that a
smaller real fixture can safely stand in for while building.

**Independent review is risk-triggered, not routine.** The normal path is Codex → tests → real-use
acceptance → development report → checkpoint, with no ZCode involvement required. A Phase brief
triggers independent review only for genuinely high-risk work: durable identity,
persistence/migration, destructive regeneration, annotation/source anchoring, source-of-truth
integrity, mastery-write authority, a security boundary, or other load-bearing Frozen Core behaviour.
The brief should say so explicitly when it applies — three-model review is a surgical tool, not
ceremony for every change.

**Development reports and git checkpoints.** Every completed Phase brief gets one concise report in
`docs/development-reports/` (format in that directory's `README.md`) and at least one clean
checkpoint commit, made after tests and acceptance are done. Intermediate commit strategy during the
work is implementation-autonomous. Reports are engineering memory, not chronological diaries — they
never claim a result that wasn't achieved.

## 6. Three-tier cold-start protocol

**Tier A — read in full, every session, every role.**

1. this file (`AGENTS.md`);
2. the current Phase brief (`docs/phases/<PHASE>.md`);
3. the latest development report directly relevant to that brief, if one exists — not the whole
   history in `docs/development-reports/`.

This tier stays small enough to read in full every time: `AGENTS.md` short, the current brief 1–3
pages, each report concise (§5).

**Tier B — mandatory selective read.**

The current brief's "Authority to read" names exact `PRODUCT_BLUEPRINT.md` and
`IMPLEMENTATION_BLUEPRINT.md` sections. Read those completely. Do not read either blueprint in full
by default — they are reference authorities, not everyday cold-start manuals. If the brief fails to
name a section you turn out to need, that's a gap in the brief to flag (§5, condition 1 or 3), not a
licence to fall back to a full blueprint read.

**Tier C — query only when needed.**

Never part of cold start; consult only when a frozen rule is genuinely ambiguous, provenance/history
is needed, an old implementation is being weighed for reuse, or an evidence-dependent technical
question needs a calibration/spike report:

- `docs/archive/transition/**` (audits, semantic-delta, legacy-reuse, transition plan);
- ZCode/independent-review reports, once their accepted patch is absorbed into the Frozen Core;
- old or unrelated development reports and Phase briefs;
- unrelated blueprint sections;
- the Legacy repository (`408-ai-ebook`).

OCR/geometry/layout/anchor work may specifically pull the OCR calibration evidence — read its
conclusions, not its full working log — when that work is actually in scope.

**Role difference.** Codex executing a Phase brief gets exactly Tier A + Tier B — narrow, on purpose.
Claude preparing the *next* brief (§7) may read more broadly when genuinely necessary — current
product/code state, a wider Frozen Core section, the user's actual usage feedback, the template in
`docs/phases/README.md` — but should still avoid archive archaeology unless it's actually needed.

## 7. How the next Phase brief is generated

Phase briefs are not pre-written from the roadmap. `IMPLEMENTATION_BLUEPRINT.md` §24 states
direction; it is not a queue of ready-made briefs. The next one is derived, once the project actually
reaches that layer, from: what exists now; the previous development report; the user's actual usage
and feedback; relevant Frozen Core constraints; and deferred debt that has become relevant. Prefer
one minimal useful slice over a broad "complete phase." Do not mechanically expand the roadmap into
detailed future briefs ahead of need.

## 8. Current state

Both blueprints are frozen at Gate D (2026-09-03). R1, R2, R3, Find in Book, Map the Book and Ask
About This are closed. Find in Book passed user real-use acceptance 2026-09-04. Map the Book passed
user real-use acceptance and its required independent narrow review on 2026-09-04; the review
explicitly allowed closure with three non-blocking P2 observations recorded in its development
report. Cross-version annotation round-trip remains a pending capability gap because OCR
reprocessing does not exist.
**Ask About This** (`docs/phases/ASK_ABOUT_THIS.md`) passed user real-use acceptance and its required
independent narrow review on 2026-09-04. ZCode explicitly allowed closure with P0 = 0, P1 = 0 and
three deferred non-blocking P2 observations recorded in its development report. User decisions
**D-4** (first provider = DeepSeek) and **D-5** (§21.3 recommended egress boundary) were
resolved/confirmed 2026-09-04 and remain recorded in the brief; `IMPLEMENTATION_BLUEPRINT.md` §26
still carries them as open rows pending the user's Frozen Core sync.
**Provider Bake-off** (`docs/phases/PROVIDER_BAKEOFF.md`) is the current Phase brief — accepted
2026-09-04 and implementation-ready at checkpoint `3c5327b`: a controlled three-provider teaching-quality comparison
(DeepSeek / Zhipu GLM / OpenRouter-Gemini) through the real Ask About This path, with a dev-gated
side-by-side first-answer mode and no persistence. The user's verified 2026-09-05 preflight fixed
the experiment variables as DeepSeek = `deepseek-v4-pro`, Zhipu = `GLM-5.3-Flash`, and OpenRouter =
`google/gemini-3.8-flash`; no substitution is permitted. Comparison uses intent-level parity (same Skill/selected
text/context/message/scope and intent-level settings; per-field API parameter equality is not
required, minimal recorded mapping allowed). Non-loopback provider endpoints must be HTTPS
(includes Ask About This P2 #1). The bake-off's default-provider recommendation is a user decision;
derive later briefs per §7. Final real-material acceptance remains pending because the fixed
OpenRouter `google/gemini-3.8-flash` model returns a direct no-proxy `model_region` 403; DeepSeek and
Zhipu each completed all 10 real-book comparisons. No winner/default change or ZCode review has been
performed.
