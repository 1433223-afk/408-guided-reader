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

**Model identity does not confer authority.** Authority comes from the current task and its
approval gate, and an agent may perform only the actions that gate authorizes — whichever model it
is.

| Role | Owns | Must not |
|---|---|---|
| **Codex Pro — Planner** | The next Phase brief (§7), in its own separate planning conversation: current product-state assessment, next-slice candidates, the Prior-art check, product/architecture options, scope, acceptance, Not-now, authority-to-read, must-report boundaries. | Write product code; pre-design implementation trivia for the Implementer; treat its own draft as accepted. Durable output lands in repo authority docs; handover after a docs-only checkpoint. |
| **Codex Pro — Implementer** | One accepted Phase end to end, in a fresh conversation cold-started from repository authority: code-level plan, implementation, targeted tests, real-use golden path, affected regression, same-Phase bugs and UAT rework, development report and checkpoint. | Work outside accepted authority; swap implementation model mid-Phase for ordinary bugs; cold-restart on a user UAT FAIL instead of continuing this conversation. |
| **ZCode** | Independent auditor — narrow/adversarial review, high-risk and contract/security/authority audit, attack-test recommendations — when a Phase brief triggers it (§5). Exception: adjudicating a Frozen-authority conflict or a planning dead-end. | Default into the next-slice planning chain; review an implementation path whose core design it adjudicated; silently become the primary implementer; review when nothing risk-triggered it. |
| **Deep Research** | External prior-art / GitHub / technical research evidence for a Planner or the user. | Hold project authority; introduce a dependency or change Frozen semantics because a report recommends it — results are adjudicated by the Planner, the user and the authority hierarchy. |
| **Cheap / low-context models** | Credential/API preflight, config checks, model-slug lookup, narrow diagnostics, one-off low-context tasks. | Take over an in-progress Phase implementation. |

Binding on every role:

- `PRODUCT_BLUEPRINT.md` and `IMPLEMENTATION_BLUEPRINT.md` are the Frozen Core (§2).
- Repository truth outranks model memory (§5).
- Review failure, or reviewer-invocation failure, never becomes PASS (§5).
- User approval gates are controlling. No role can waive one.
- **Independence is a property of the work, not the model.** Whoever produced a change cannot also
  be its independent acceptance — symmetric across roles. No ZCode-plans → Codex-implements →
  ZCode-reviews-its-own-design.

Planner and Implementer are separate conversations on purpose: continuity comes from repository
authority, not from a persistent chat. The Planner's durable results — accepted brief, decision
records, material prior-art evidence — are written to the repo; the Implementer cold-starts from
those facts and does not inherit discarded ideas, temporary guesses, rejected options or
conversational reasoning. Small work — a CSS tweak, a button bug, a known local defect, a
same-Phase UAT delta — skips the two-conversation split: it stays in the original Implementer
conversation (reproduce → minimal fix → targeted test → real-use check → user retest), no process
tax.

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

**OpenRouter model restriction — user instruction, 2026-09-12.** For this project, the only
OpenRouter model authorized without a new explicit approval is Gemini 3.8 (the established model
ID is `google/gemini-3.8-flash`). Never independently call any other OpenRouter model, including
for experiments, diagnostics, tests, reviews, retries or automatic fallbacks. Before any exception,
report the exact model, purpose, reason Gemini 3.8 is insufficient, and expected cost/call scope;
wait for the user's explicit approval before calling it. Reporting alone is not approval.
Existing defaults, environment settings, historical approvals and broad permission to work
autonomously do not override this restriction. Check the resolved model before every real
OpenRouter call; if it is not the allowed model or is uncertain, stop that call and report.
This rule applies to all agents and scripts used on the project's behalf.

**DeepSeek re-enabled — user instruction, 2026-09-12.** The user subsequently authorized enabling
DeepSeek V4.1 Flash through the native DeepSeek provider. Its official API model ID is
`deepseek-flash` (confirmed by the official documentation and authenticated model list). This is
an exception to the earlier Gemini-only instruction for the native DeepSeek provider only; the
OpenRouter restriction above and the disabled status of other unapproved providers remain in force.

**External reuse and major dependencies.** For a large, common or genuinely core capability — PDF
rendering, OCR, virtualization, annotation geometry, job queues, storage, or comparable
infrastructure — investigate mature OSS before building, autonomously; no approval needed just to
look. For small or local implementation, skip the ritual search and just write it. Before adopting
anything substantial, or a dependency that materially changes the stack (a UI framework, database,
PDF engine, OCR runtime/model, job system, state-machine framework, or other large runtime), report:
project; licence; what would be reused; why it fits; dependencies it brings; maintenance/risk;
recommendation — then wait for approval (escalation conditions 5–6).

The trigger is broader than infrastructure. Interaction-model problems — conversation branching,
recursive/nested chat, tree navigation, Markdown/math rendering, editor/selection,
search/indexing, RAG, streaming, auth — are mature OSS problem domains: look before designing.
Research is likewise REQUIRED when about to hand-build a generic capability (parser, framework,
state-machine abstraction, rendering pipeline, generic navigation/tree/storage abstraction), on a
new core dependency or stack change, when the product/architecture itself is uncertain (the user
cannot name the best UX; materially different data/state/context models are live options; the
implementation is ballooning into a generic system), or when a user-acceptance failure exposes one
of those uncertainties. A clear, local, known-cause defect — a stale disabled condition, a
CSS/null/event-handler bug, a local readiness regression — needs no research. A user-visible
capability that fails user acceptance again after a fix is REQUIRED research by default, unless
the failures are demonstrably independent local bugs. Research itself is autonomous — search
GitHub, read READMEs, source, issues and PRs, compare architectures, borrow patterns; ask before
adoption, not before learning, and record what was borrowed. Copying substantive code or adopting
a dependency remains the approval case above.

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

**Test execution is tiered; user-visible interaction is proven on the real path first.** For a
bug, reproduce it before fixing. Then: minimal implementation → targeted tests (the new/changed
behaviour and its nearest invariants) → agent real-use golden path (user-visible work only) →
affected regression (existing suites that share the changed risk surface) → broad/closure suite
when justified → user retest. The golden path drives the site as actually served, with real
material and real pointer/keyboard paths, proves the key controls are genuinely operable, and
includes at least one reversal or recovery (Back / reopen / close / failure / retry). Machine PASS
≠ agent real-use PASS. A broad suite is REQUIRED at least once before Phase / UAT-rework closure,
and earlier when shared infrastructure changed, targeted failures suggest cross-module
contamination, or the blast radius is unclear. High risk ≠ full suite after every edit: it means
the corresponding invariant tests run promptly, can never be permanently skipped via
`INTENTIONALLY_NOT_RUN`, and the required broad regression cannot be escaped before the relevant
checkpoint or acceptance. A suite that shares no risk surface with the change may be skipped,
recorded in the development report as `INTENTIONALLY_NOT_RUN` with a one-line risk-based reason —
never for the current golden path, the current high-risk invariants, or a closure suite, and never
merely because it is slow. TARGETED / AFFECTED / CLOSURE are execution and report vocabulary only
— no test tags, no metadata system; a Phase brief may always require more.

**Protect concrete invariants, not hypothetical states; validate at the narrowest side-effect
boundary.** Every `disabled`, readiness gate, early return or blocking state must be able to name
the concrete invariant it protects — "safer", "might fail later", "theoretically possible" are not
invariants. Reversible local UI — open a panel, create a local draft, select, Back, focus or Root
switch, resize, reopen a historical explanation — must not depend on provider readiness,
credential availability or persistent state it does not yet need. The check runs at the real
boundary: Send checks provider readiness; Persist checks schema and durable authority; destructive
close checks deletion scope. The fail-closed hard boundaries — credential/secret, egress/security,
persistence/migration, destructive authority, source anchoring, mastery authority, durable
identity — are unchanged and absolute. This discipline moves validation; it never deletes it.

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

**Role difference.** The Implementer executing a Phase brief gets exactly Tier A + Tier B — narrow,
on purpose. The Planner preparing the *next* brief (§7) may read more broadly when genuinely
necessary — current
product/code state, a wider Frozen Core section, the user's actual usage feedback, the template in
`docs/phases/README.md` — but should still avoid archive archaeology unless it's actually needed.

## 7. How the next Phase brief is generated

Phase briefs are not pre-written from the roadmap. `IMPLEMENTATION_BLUEPRINT.md` §24 states
direction; it is not a queue of ready-made briefs. The next one is derived, once the project actually
reaches that layer, from: what exists now; the previous development report; the user's actual usage
and feedback; relevant Frozen Core constraints; and deferred debt that has become relevant. Prefer
one minimal useful slice over a broad "complete phase." Do not mechanically expand the roadmap into
detailed future briefs ahead of need. The **Planner** (§4) owns this derivation in its own
conversation; the handover artifact is the accepted brief plus decision records, never the planning
chat.

## 8. Current state

Both blueprints are frozen at Gate D (2026-09-03). Since then the Frozen Core has changed only by
user-approved amendments recorded in the blueprints themselves (Implementation §14.8 per Ask Deeper
decision D1; Decision Register A-19 for the Markdown/math/sanitizer libraries; Implementation
§12.2/§12.4/§22 for the First Chapter Knowledge Map UAT/architecture corrections accepted
2026-09-07; Product §20/§20.4 for the Reading Guide article/split-reader amendment accepted
2026-09-10). One
Frozen-level sync still awaits the user: `IMPLEMENTATION_BLUEPRINT.md` §26 carries the D-4/D-5 rows
already resolved in `ASK_ABOUT_THIS.md`.

Per-Phase status — open, closed, rework, pending user decisions — lives in the
[`docs/phases/README.md`](docs/phases/README.md) index. Phase-specific authority, decisions and
evidence live in the current Phase brief and its development report. Do not copy per-Phase detail
into this file.
