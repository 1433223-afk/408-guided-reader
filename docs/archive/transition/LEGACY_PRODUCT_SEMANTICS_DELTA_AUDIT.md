# LEGACY_PRODUCT_SEMANTICS_DELTA_AUDIT

> **Status: AUDIT EVIDENCE — NOT PRODUCT AUTHORITY.**
> **NO RULE IN THIS FILE IS AUTOMATICALLY CARRIED FORWARD.**
> Every finding requires explicit user adjudication before `PRODUCT_BLUEPRINT.md` or
> `IMPLEMENTATION_BLUEPRINT.md` may be patched. This document patches neither.

---

## 0. Status / Authority

| | |
|---|---|
| Document type | Bounded delta audit — product *semantics*, not code or architecture reuse |
| Authority | None. Subordinate to `PRODUCT_BLUEPRINT.md`. A legacy rule cited here governs nothing by itself. |
| Date | 2026-09-03 |
| Does not modify | `PRODUCT_BLUEPRINT.md`, `IMPLEMENTATION_BLUEPRINT.md`, `AGENTS.md`, any legacy file |
| Committed | No |
| Distinct from | `LEGACY_REUSE_AUDIT.md` (code/architecture reuse) and `OCR_FOUNDATION_CALIBRATION.md` (empirical OCR evidence). This audit asks a different question: *what behavioral contracts did the old project freeze, precisely, that the new redesign may have forgotten, weakened, or silently generalized away* — independent of whether any old code is reused. |

---

## 1. Audit Purpose

The old project spent real deliberation freezing fine-grained behavioral contracts — numeric bounds,
negative rules, isolation boundaries, lifecycle edge cases. Some of that precision exists *because of*
the abandoned reconstructed-ebook architecture and should not return. Some of it is a genuine,
architecture-independent product decision that the new Product Blueprint simply doesn't mention yet —
not because it was rejected, but because rewriting the product from scratch is exactly how considered
detail quietly disappears.

The canonical example: legacy froze `max_depth = 5`, a Window/Child model, one-active-child-per-parent
concurrency, a prohibition on reopening a Root to bypass depth, and a rule that Children don't inherit
full ancestor history — eight to ten related contracts. The new `PRODUCT_BLUEPRINT.md` §24.2 keeps
recursive explanation as a capability but says explicitly: *"Exact depth limits belong to
implementation safeguards, not this product invariant."* That is either a deliberate simplification or
an accidental loss of nine other decisions bundled with the depth number. This audit exists to find
every case shaped like that one.

---

## 2. Source Set / Frozen-Version Resolution

Resolved from repository truth, not memory. All seven are the sole tracked copy at their path, no
duplicate drafts exist, and all seven declare `Status: FROZEN — P0=0 / P1=0` in their header:

| # | Path | Lines | Status header |
|---|---|---|---|
| 1 | `docs/07-review/V4_DECISION_REGISTER_REV3.md` | 1,102 | `FROZEN — P0=0 / P1=0` |
| 2 | `docs/01-product/SYSTEM_BLUEPRINT_V4.md` | 2,551 | `FROZEN — P0=0 / P1=0` |
| 3 | `docs/02-engineering/DEVELOPMENT_SPEC_V1.md` | 933 | `FROZEN — P0=0 / P1=0` (basis: `SYSTEM_BLUEPRINT_V4` frozen) |
| 4 | `docs/03-skills/SYSTEM_AGENT_SKILL.md` | 1,342 | `FROZEN — P0=0 / P1=0` |
| 5 | `docs/03-skills/REVIEW_AGENT_SKILL.md` | 1,614 | `FROZEN — P0=0 / P1=0` |
| 6 | `docs/03-skills/MASTER_AGENT_SKILL.md` | 1,768 | `FROZEN — P0=0 / P1=0` |
| 7 | `docs/03-skills/ASSISTANT_AGENT_SKILL.md` | 1,458 | `FROZEN — P0=0 / P1=0` |

`git ls-files` confirms no second tracked copy of any of the seven exists anywhere in the repository,
and `git status` shows none of the seven as modified or untracked-duplicated. No draft/freeze-candidate
resolution was necessary. `DEVELOPMENT_SPEC_V1.md` was read for schema-level detail only where a Skill
referenced a mechanism (e.g., checkpoint contents) whose product meaning needed that context.

Not inspected, per the audit's own scope: Phase implementation code, migrations, DB schema, test
implementation, Harness files. `docs/08-ui/**` was not treated as a rule source — it is explicitly
"DERIVED DESIGN CONTEXT — NON-AUTHORITATIVE."

---

## 3. Method

Read each Skill and the Decision Register section-by-section (tables of contents captured in full,
then read section bodies), extracting **normalized semantic contracts** — behavioral rules, not prose
diffs. Related sentences describing one bounded behavior (a numeric limit, its edge case, its negative
form, its validation gate) were merged into one contract with one ID and multiple cited sources, per
the deduplication instruction. Each contract was then checked against the current
`D:\codex\408-guided-reader\PRODUCT_BLUEPRINT.md`, and separately against
`IMPLEMENTATION_BLUEPRINT.md` for `IMPLEMENTATION_ALREADY_COVERS`, with the explicit rule that
implementation coverage never substitutes for a missing Product-level decision.

Where a legacy rule exists solely to support the reconstructed-ebook/SourceBlock architecture, the
underlying architecture-independent behavior (if any) was extracted separately, per the audit's own
instruction (the `UserProgress` → Segment example). Rules that have no surviving independent meaning
are `OBSOLETE_WITH_OLD_ARCHITECTURE` outright.

---

## 4. Executive Summary

**60 normalized semantic contracts** were extracted from the seven frozen documents (after
deduplicating repeats across Decision Register / Blueprint / Skill / acceptance-scenario citations,
which numbered well over 150 raw mentions): 49 in the seven domain ledgers (§§7–15) plus 11 in the
dedicated obsolete-architecture table (§16).

The audit confirms the motivating hypothesis and finds it is **not isolated to Assistant**. The
Assistant domain alone contributes **12 SEMANTIC_DRIFT_OR_WEAKENED / STILL_VALID_BUT_MISSING**
contracts of its 13 total — the Window/depth model is not a single forgotten number, it is a small,
internally consistent state machine that the new Product Blueprint replaced with one open-ended
sentence. But comparable clusters exist in **Master** (topic ending policy, evidence-gated progress
writes, the answer-policy/attribution separation) and in **Review** (rework exhaustion terminal state,
PASS immutability). These are not implementation trivia — several are precisely the kind of rule that
exists "to prevent a previously discovered bug" (Rule J's instruction), and the Decision Register's own
§50 "Historical Anti-Patterns" list is direct evidence that some of them were learned the hard way.

The good news: the audit found **zero cases** where a legacy rule survives *only* because of
SourceBlock/Anchor/RenderTree architecture and nothing else — every `OBSOLETE_WITH_OLD_ARCHITECTURE`
row also names why no independent behavior survives, and every case with surviving independent meaning
is filed as `STILL_VALID_BUT_MISSING` or `SEMANTIC_DRIFT_OR_WEAKENED`, never smuggled back in as if it
were architecture.

---

## 5. Classification Counts

Verified by mechanical recount against every ledger row (§20 records the count methodology so this
table cannot silently drift from the ledgers again).

| Classification | Count | Where |
|---|---|---|
| `CARRIED_FORWARD` | 12 | §§7–15 domain ledgers |
| `INTENTIONALLY_CHANGED` | 1 | §9 (LEGACY-SYS-NARRATIVE-001) |
| `SEMANTIC_DRIFT_OR_WEAKENED` | 11 | §§7–14 |
| `STILL_VALID_BUT_MISSING` | 21 | §§7–15 |
| `OBSOLETE_WITH_OLD_ARCHITECTURE` | 15 | 4 embedded in §§10–14 + 11 in the dedicated §16 table |
| **Total** | **60** | |

`NEEDS_USER_REDECISION` is **not used as a per-row primary classification** in this audit — see the
methodological note at the top of §17. Instead, three of the above contracts (all already carrying
their own primary classification, priority `P0`) are additionally flagged in §17 as needing a single
**bundled** product decision because several atomic contracts in the cluster interact and shouldn't be
adjudicated one at a time.

Priority distribution across the 49 domain-ledger contracts (the dedicated §16 obsolete table carries
no priority — nothing there requires a decision):

| Priority | Count | Meaning |
|---|---|---|
| `P0_SEMANTIC` | 5 | New Product cannot coherently exist without re-decision |
| `P1_SEMANTIC` | 19 | Must resolve before Blueprint freeze |
| `P2_SEMANTIC` | 21 | Safe to defer to implementation/detail phase |
| *(no priority — obsolete)* | 4 | Embedded `OBSOLETE_WITH_OLD_ARCHITECTURE` rows; no decision needed |

32 contracts (`SEMANTIC_DRIFT_OR_WEAKENED` + `STILL_VALID_BUT_MISSING`) carry a genuinely open
decision. `CARRIED_FORWARD` and `INTENTIONALLY_CHANGED` rows also carry a priority tag, but it reflects
*verification/restatement* priority (how important it is to say the surviving rule out loud in the new
Product Blueprint), not an open decision — 11 of the 12 `CARRIED_FORWARD` rows are `P2` for exactly
this reason.

---

## 6. High-Risk Missing / Drifted Semantics

Every row below is `HIGH_RISK_IF_MISSING`, traced to an exact source, and ranked by how much
observable product behavior it silently changes if left undecided. **All 5 `P0_SEMANTIC` contracts
appear below** (ranks 1, 2, 3, 6, and 8) — this ranking is not a re-filtering of §5's priority tags,
it orders them by *impact* rather than by domain, which is why they don't run consecutively.

| Rank | ID | One-line risk | Priority |
|---|---|---|---|
| 1 | LEGACY-ASST-WINDOW-001 | Recursive Assistant has no depth bound, no branch model, no concurrency rule — could recurse unboundedly or allow contradictory concurrent branches with no defined behavior | P0 |
| 2 | LEGACY-ASST-MAXDEPTH-001 | Even if a bound is agreed in principle, no specific number or budget has been chosen — this is the concrete decision WINDOW-001's state-model question depends on | P0 |
| 3 | LEGACY-ASST-ROOTBYPASS-001 | Nothing prevents an Assistant answer from becoming a fresh "Root," silently defeating whatever depth bound is eventually chosen | P0 |
| 4 | LEGACY-MASTER-ENDING-001 | No topic-ending policy → Master cannot know when a conversation is "over" for condensation purposes, which blocks Knowledge-Record/Weakness generation entirely | P0 |
| 5 | LEGACY-MASTER-EVIDENCE-001 | No evidence-gating rule for progress writes → nothing stops "the user asked a question" from being conflated with "the user is now UNDERSTOOD," which Product §28 exists specifically to prevent for Section-level checks but does not restate for Master-driven KP updates | P0 |
| 6 | LEGACY-ASST-ANCESTOR-001 | No stated limit on what a recursive turn inherits → an implementer's default instinct (send full history) silently reintroduces unbounded context growth and cross-branch leakage | P1 |
| 7 | LEGACY-REVIEW-EXHAUST-001 | No terminal state for repeated review failure → an implementer must invent one, and "keep retrying forever" or "publish anyway" are both live and equally plausible default outcomes | P1 |
| 8 | LEGACY-ASST-CONCURRENCY-001 | No atomicity requirement for concurrent recursive-branch creation → a race condition becomes a first-release bug class rather than a designed-away one | P1 |
| 9 | LEGACY-MASTER-ATTRIBUTION-001 | No separation of "should Master answer" from "where does this get recorded" → risk of Master refusing to answer off-topic-but-legitimate questions, which the old project explicitly forbade after presumably discovering the failure mode | P1 |
| 10 | LEGACY-REVIEW-PASSFREEZE-001 | No explicit prohibition on a later fix rewriting already-accepted content → "fix forward" work could silently mutate previously reviewed/accepted teaching material with no gate | P1 |

*(LEGACY-ASST-RETRYID-001, also `P1`, narrowly missed this top 10 — see §7. It remains the cleanest
low-cost fix in the whole audit: a pure idempotency rule with no dependency on how the depth/window
question above gets resolved.)*

---

## 7. Assistant Delta Ledger

Legacy source for the whole domain: `ASSISTANT_AGENT_SKILL.md` (frozen), cross-referenced by
`V4_DECISION_REGISTER_REV3.md` §33 and `SYSTEM_BLUEPRINT_V4.md` §76 items 18–19, 30.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-ASST-WINDOW-001 | Recursive explanation is a `Window` tree: Root at depth 1, a `Child` created only by selecting text inside the *current* window's own answer, `depth = parent.depth + 1`; ordinary same-window follow-up never changes depth | Skill §§4,5,7,8,9,10 · Register §33 · Blueprint §76.18 | Product §24.2: "Recursive explanation is a product capability. Exact depth limits belong to implementation safeguards, not this product invariant." | **Weaker** — the *existence* of recursion is kept; the entire state model (window/depth/root/child distinction) is dropped to a sentence | `SEMANTIC_DRIFT_OR_WEAKENED` | **P0** | Impl §14.3 models recursion as flat turns in one context with a turn-ordinal reference, no window/depth concept at all — **NO** | This is a Product-level decision (whether recursion is bounded, and by what state model), not an engineering default. Needs explicit re-decision, not a silent implementation choice. |
| LEGACY-ASST-MAXDEPTH-001 | `max_depth = 5`; Window 5 may keep multi-turning and closing back to Window 4, but creating Window 6 is forbidden outright | Skill §§11,12,13 · Register §33 · Blueprint §76.18 · Skill Anti-pattern 60.2 · Scenario D | No numeric bound anywhere in Product or Implementation | Absent | `STILL_VALID_BUT_MISSING` | P0 | NO | The specific number (5) is legacy-arbitrary and need not be preserved verbatim, but *some* explicit bound, chosen deliberately, is needed — see §17 NEEDS_USER_REDECISION. |
| LEGACY-ASST-ROOTBYPASS-001 | An `ASSISTANT_ANSWER` selection can **only** create a Child, never a new Root; explicitly forbids "reopening a Root to reset depth to 1" as a bypass | Skill §§7,17,21,55 · Anti-pattern 60.11 · Scenario L | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | **P0** | NO | This is the load-bearing negative rule that makes any depth bound meaningful at all. Without it, a depth limit is cosmetic. |
| LEGACY-ASST-ONECHILD-001 | At most one *active* child per parent window at any time; a second active child cannot be created until the first is closed | Skill §§14,15 · Anti-pattern 60.3 · Scenario E | Not addressed (no window concept to constrain) | Absent | `STILL_VALID_BUT_MISSING` | P1 | NO | Only meaningful if LEGACY-ASST-WINDOW-001 is re-adopted in some form; otherwise moot by construction. |
| LEGACY-ASST-CONCURRENCY-001 | One-active-child must be an atomic, concurrency-safe invariant — explicitly forbids naive check-then-insert; requires CAS/unique-constraint/version-guard; concurrent duplicate requests must yield exactly one success and one typed rejection | Skill §14.1 · Scenario J | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | **P1** | Impl §12.6/§18.4 apply an equivalent atomicity pattern elsewhere (chapter publish, job claim) but not to Assistant — **PARTIAL** (pattern exists, not applied here) | Depends on LEGACY-ASST-WINDOW-001. If any branching model returns, this concurrency rule must return with it — the pattern is already proven elsewhere in the new architecture. |
| LEGACY-ASST-DEPTHGATE-001 | Child creation must deterministically validate `parent.depth < max` *before* invoking generation, returning a typed rejection (not silently refusing or silently allowing) | Skill §13,56 | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | P1 | NO | Standard deterministic-gate-before-model-call pattern, consistent with Impl §13.7's own principle — just not written for Assistant. |
| LEGACY-ASST-ANCESTOR-001 | Child inherits exactly: new selected text, the **complete triggering parent answer turn**, source type, new depth, source location, necessary reference context, current KP, User Style. Explicitly does **not** inherit: full parent history, grandparent history, the whole ancestor selected-text list, the whole tree, full Reader history, full Master thread | Skill §§25,26,27,28 · Anti-pattern 60.4 · Scenario C,G | Impl §14.3: "an Assistant answer becomes addressable input to the next question" via turn-ordinal reference; no explicit inheritance/exclusion list | **Weaker** — direction is right (bounded context), but the precise inherit/exclude boundary and the "why" (avoid taking a phrase out of context vs. avoid unbounded context growth) are unstated | `SEMANTIC_DRIFT_OR_WEAKENED` | **P1** | Impl §14.3 gestures at this via "context budget" but does not state the specific list — **PARTIAL** | Restate explicitly at Product level: what a recursive turn inherits, and the explicit negative list, independent of whatever state model is chosen for depth. |
| LEGACY-ASST-SOURCETYPES-001 | Five source types with distinct context rules: `ORIGINAL` (needs exact text + node ref + SourceBlock identity), `SYSTEM_AI_TEXT` (may paraphrase, may not "review" or write back), `MASTER_ANSWER` (source location = message/turn ref, no render-node requirement), `ASSISTANT_ANSWER` (Child-only, parent window + turn ref), `READER_VISIBLE` (headings/recall text/controls — catch-all so no enum gap blocks explanation of anything selectable) | Skill §§17–21,21.1 · Scenario F,K | Product §24.2 lists content sources (original text, figures/tables/formulas, Reading Guide, Inline Guidance, Master answers, Assistant's own answers) without per-type context rules; Impl §14.3's `SelectionSource.kind` enum (`ORIGINAL_PDF, READING_GUIDE, INLINE_GUIDANCE, MASTER_ANSWER, ASSISTANT_ANSWER`) is structurally similar but has no `READER_VISIBLE`-equivalent catch-all | **Equivalent in spirit, weaker in the specific "catch-all" guarantee** | `SEMANTIC_DRIFT_OR_WEAKENED` | P2 | Impl §14.3 — **PARTIAL** | The catch-all principle ("any selectable Reader text must be explainable regardless of enum completeness") is worth restating explicitly so a future enum gap can't silently block explanation of some UI element. |
| LEGACY-ASST-RETRYID-001 | Technical retry reuses the current window identity and the current user turn; if the failed response was never successfully committed, retry reuses the *same* logical `assistant_turn_id`/idempotency key — retry must never produce two referenceable answer turns; retry never creates a Child and never changes depth | Skill §59 | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | **P1** | Impl §13.8 has a general typed-retry framework but does not state this Assistant-specific turn-identity rule — **PARTIAL** | Independent of the window/depth question — this is a pure idempotency rule that applies regardless of how recursion is modeled. Worth stating even if depth model changes. |
| LEGACY-ASST-PROVFAIL-001 | Assistant provider technical failure (timeout/network/rate-limit/5xx) must not write Weakness, write progress, create a Knowledge Record, auto-switch to Master, or increase depth | Skill §58 | Product §20 (failure never blocks reading) covers the reading-availability half; the "must not write learning state" half is not explicit for Assistant provider failure specifically | **Equivalent for the availability half; absent for the no-learning-side-effect half** | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | Impl §20 row "Assistant provider fails" states "temporary state only," implying no durable write, but doesn't enumerate the specific forbidden writes — **PARTIAL** | Low cost to restate explicitly; a provider failure silently triggering a learning-state write would be a confusing bug to debug in production. |
| LEGACY-ASST-NOWRITES-001 | Assistant never directly writes: `UserProgress`, a Knowledge-Record-equivalent, a Weakness-equivalent, or Anchor-evidence-equivalent (`MARK_UNDERSTOOD`/`MARK_NOT_UNDERSTOOD`); explicitly forbids Assistant *internally* calling Master's persistence logic to write silently — an explicit user-initiated "record this in Master" action would be a different, allowed flow | Skill §§39–43 · Anti-patterns 60.6,60.7,60.9 · Scenario I · Blueprint §76.19 | Product §16.4 / §24.3: the only durable promotion path is explicit "Save to Notes," and durable KP status changes require explicit user confirmation (§28) | **Equivalent in effect** — Product's general architecture (Assistant is temporary, only explicit Save-to-Notes is durable) achieves the same outcome by construction, even though it isn't stated as an Assistant-specific negative rule | `CARRIED_FORWARD` | P2 | Impl §14.2, §16.4 — **YES** | No action needed; flagged for completeness. The *outcome* survives even though the legacy phrasing (explicit negative list) does not. |
| LEGACY-ASST-EXPORT-001 | Assistant messages/window-tree/branches/recursive explanations are excluded from any export/`USER_LEARNING_RECORD` projection by default, absent a future explicit product authorization | Skill §§48,49 · Anti-pattern 60.8 | Product has no export/data-portability feature specified at all in this Blueprint | Absent (feature doesn't exist yet to have a boundary) | `STILL_VALID_BUT_MISSING` | P2 | NO | Not urgent — defer until/unless an export feature is designed. Worth a placeholder note so it isn't forgotten *again* when export is eventually designed. |
| LEGACY-ASST-USERSTYLE-001 | User Style (tone/verbosity/examples/language) may change Assistant's expression but explicitly cannot change: max depth, one-active-child, context inheritance, source identity, persistence boundary, export boundary, permanent-write boundary | Skill §§50,51 | No User Style / personalization feature exists in the new Product Blueprint at all | Absent (feature doesn't exist) | `STILL_VALID_BUT_MISSING` | P2 | NO | Defer with §15 (User-Style domain) as a bundle — see §15 below. |

---

## 8. Master Delta Ledger

Legacy source: `MASTER_AGENT_SKILL.md` (frozen); cross-referenced by Register §§12, 29–33.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-MASTER-MUSTANSWER-001 | Master is not a "question quality filter" — simple terms, "what does this mean," recall, comparison, synthesis, even vaguely-phrased-but-clarifiable questions must all be answered normally; may lightly suggest Assistant as an alternative but must never refuse to answer | Skill §5 | Product §26 describes Master as "a persistent learning workspace" managing "understanding... not merely answering arbitrary selected text" — tone is different (workspace framing vs. explicit must-answer guarantee) | **Weaker/ambiguous** — nothing forbids a future implementation from making Master selectively refuse low-value questions, since no explicit must-answer guarantee exists | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | NO | Worth an explicit restatement: Master must answer course-relevant questions regardless of perceived quality; only *attribution* (where it's recorded) is conditional, never *whether it answers*. |
| LEGACY-MASTER-ATTRIBUTION-001 | Strict separation: "should Master answer this?" is never the same question as "where does this get recorded long-term?" Master can answer a question that ultimately attributes to another KP, to no KP, or not to the course at all — and answering is never gated on attribution being resolvable | Skill §6 · §7 (off-topic policy tiers 7.1–7.5) · explicit anti-pattern "reject because not current KP is forbidden unless an external safety/capability limit applies" | Not stated in Product Blueprint | Absent | `STILL_VALID_BUT_MISSING` | **P1** | NO | This is the single Master rule I'd flag as most likely to cause a real product regression if missed — an implementer without this rule will very plausibly gate answering on attribution, since that feels like the "clean" design. |
| LEGACY-MASTER-EXAMTOPIC-001 | ExamTopic/命题追踪 evidence is lightweight KP-associated metadata; multiple KPs may share one evidence item without creating duplicate progress trees; V1 has no independent ExamTopic progress | Register §37 (`PAST_EXAM`) | Product §21 states this nearly verbatim: "ExamTopic is lightweight exam-evidence metadata... no independent ExamTopic mastery/progress" | Equivalent | `CARRIED_FORWARD` | P2 | Impl §17 (ExamEvidence context) — YES | No action. Confirms the audit isn't finding drift everywhere — this one was preserved cleanly. |
| LEGACY-MASTER-TOPIC-001 | `MasterTopic` is the minimum unit of condensation — a cluster of turns around one condensable question/question-cluster; one KP may have many Topics; all Master Q&A under a KP must never be force-compressed into one record | Skill §13 | Not addressed — Product §26/§29 describe threads and history generally but do not define a Topic-equivalent unit of condensation | Absent | `STILL_VALID_BUT_MISSING` | **P1** | Impl §15.5 has `MasterThread`/`MasterMessage` but no condensation-unit concept distinct from the thread itself — **NO** | Needed if any form of "summarize this conversation into durable knowledge" behavior is intended (Product §26 implies structured summaries exist: "may additionally maintain structured summaries... so future reasoning does not need to replay every raw token"). Without a Topic-equivalent boundary, it's unclear what gets summarized as one unit. |
| LEGACY-MASTER-ENDING-001 | Topic ending is explicit-first: only an explicit user end-signal or a topic switch may move a topic to `ENDING`; semantic completeness alone yields only a `SUGGEST_END` signal, never an automatic `ENDING` transition. A new topic's creation never waits on the old one's condensation success or failure. | Skill §18 (18.1–18.4), §18.5 | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | **P0** | NO | Without *some* ending policy, there is no defined trigger for condensation/Knowledge-Record generation at all — this blocks a real capability, not just a nuance. The explicit-first design also directly prevents a specific failure mode (the system prematurely deciding "you must be done now"). |
| LEGACY-MASTER-CONDENSATION-RACE-001 | If a user continues the same question-cluster *while* a topic is already `CONDENSING`, the in-flight condensation uses a frozen snapshot; the new messages spawn a `continuation` topic linked by `continued_from_topic_id` rather than being lost or corrupting the snapshot; a parent topic that resolves `RESOLVED` after a still-open continuation exists **must not** `MARK_UNDERSTOOD` — the continuation's own condensation decides mastery | Skill §§18.5, 37.1 | Not addressed | Absent | `STILL_VALID_BUT_MISSING` | P1 | NO | A precise concurrency/race rule protecting exactly the kind of "we said understood too early" bug Product §28.3 cares about generally. Worth adopting as a design constraint whenever a Topic-equivalent unit (LEGACY-MASTER-TOPIC-001) is designed. |
| LEGACY-MASTER-EVIDENCE-001 | A KP/Anchor may be marked understood via Master **only if** all hold simultaneously: condensation resolved=RESOLVED; attribution resolves to a valid KP; the target already exists in that KP; the topic's core question actually targeted it; at least one verifiable evidence reference supports resolution; the evidence is typed and comes from legitimate content (not fabricated); no contradicting unresolved core issue exists for the same target; ownership is re-verified at write time. Master answering a question is explicitly **not** equivalent to marking anything understood. | Skill §§35–38 | Product §28 states the equivalent principle at the **Section** level ("都清楚了" / "还有些不清楚" / no-bulk-negative) but does not restate it for **Master-driven, evidence-based KP-level** confirmation, which is a distinct pathway (§26–27 mention KP-local Master entry and durable threads, but not the evidence-gating contract for when Master itself may write UNDERSTOOD) | **Weaker** — the general "reading ≠ mastery" principle survives at Section level; the specific multi-condition gate for *Master's own* KP-level writes is unstated | `SEMANTIC_DRIFT_OR_WEAKENED` | **P0** | Impl §15.5: "Master may keep structured summaries... Recall never changes mastery" — states the recall-specific negative but not the positive evidence-gate for when Master *may* write UNDERSTOOD — **PARTIAL** | This is the Master-domain analogue of the Assistant depth question: a real, multi-part gate collapsed into an unstated assumption. Without it, "Master answered your question" could silently become sufficient evidence for UNDERSTOOD in an under-specified implementation. |
| LEGACY-MASTER-NODOUBLECONFIRM-001 | Once Master's own evidence-gate (LEGACY-MASTER-EVIDENCE-001) has updated an Anchor, the user does not need to *also* click a separate "I understand" control to leave Master — the two confirmation paths (explicit UI click vs. Master-adjudicated evidence) are both valid and don't double-gate each other | Skill §39 | Not addressed (no equivalent evidence-based Master path exists yet to double-gate) | Absent | `STILL_VALID_BUT_MISSING` | P2 | NO | Small UX-integrity rule; adopt alongside LEGACY-MASTER-EVIDENCE-001 if that is re-decided. |
| LEGACY-MASTER-WEAKNESS-001 | A "weakness" record requires condensation to show a genuine, describable understanding gap — not merely "the user asked a question." The sentence describing it must be specific, non-judgmental, and never a blanket ability statement ("bad at X"/"doesn't know Y") | Skill §33 | Product does not define a Weakness-equivalent artifact at all (Master history/threads exist, but no distinct "described understanding gap" object) | Absent | `STILL_VALID_BUT_MISSING` | P2 | Impl §15.1 `LearningEvent` could carry this but doesn't specify the sentence-quality rule — **PARTIAL** | Lower urgency than the P0/P1 items — this refines *how* a gap is recorded, not *whether* the record-vs-answer distinction exists at all. |
| LEGACY-MASTER-NODOWNGRADE-001 | An Anchor already marked UNDERSTOOD is never automatically downgraded because a later, unrelated question surfaces confusion; a new unresolved topic can coexist with a prior UNDERSTOOD state without silently reversing it; any future explicit downgrade mechanism is a separate, deliberately-designed product rule, not something Master invents on its own | Skill §38 | Product §29 states the general shape ("A learner may become unclear again later without erasing the previous resolution") but frames it as *history retention*, not as an explicit **prohibition on automatic downgrade of current status** | **Equivalent in the retained-history half; the explicit no-auto-downgrade prohibition is not separately stated** | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | Impl §15.4 (status mutable, history append-only) is compatible but doesn't forbid downgrade explicitly — **PARTIAL** | Cheap to restate as an explicit negative rule; the risk of *not* stating it is a "helpful" future feature that auto-reopens old KPs based on a tangential new question. |
| LEGACY-MASTER-USERSTYLE-001 | User Style may affect Master's language/tone/brevity/examples but explicitly cannot change: attribution logic, topic state machine, condensation requirement, progress-evidence rule, weakness-determination standard, Knowledge-Record persistence, source truth, or Agent authority boundaries | Skill §49 · Register §35 | No User Style feature exists in the new Product Blueprint | Absent (feature doesn't exist) | `STILL_VALID_BUT_MISSING` | P2 | NO | Bundle with §15 User-Style domain. |
| LEGACY-MASTER-SESSIONCLOSE-001 | Session close does not require Master condensation to succeed first; an active but uncondensed topic does not block closing; the underlying persistent Thread/Topic (not tied to session lifecycle) survives regardless | Skill §§44–46 · Register §26 (EbookSession must restore Active Master Thread) | Product §26 states Master threads "persist across Reader/app sessions," consistent in spirit; the specific non-blocking-close guarantee is not separately stated | **Equivalent in effect, implicit rather than explicit** | `CARRIED_FORWARD` | P2 | Impl §15.5 (durable Master threads, independent of Reader process) — YES | No action; flagged to show the audit isn't uniformly pessimistic — durability-oriented rules transferred cleanly because the new architecture's Assistant/Master split already encodes the right default. |

---

## 9. System Delta Ledger

Legacy source: `SYSTEM_AGENT_SKILL.md` (frozen); Register §§13–19.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-SYS-NOFAKEBOUNDARY-001 | System Agent's ownership boundary explicitly excludes: creating/modifying SourceBlock identity, creating KnowledgePoint/Anchor identity, final Review PASS/FAIL authority, direct writes to durable learning state, Master/Assistant conversation, Session lifecycle, and provider retry/breaker/budget state — and these boundaries "must not be merged for the sake of saving one model call or engineering convenience" | Skill §3.2, §4 items 5,6,17 | Product §16 keeps System/Review/Master/Assistant as four Agents and explicitly says the internal KP generator/reviewer are "not a fifth Product Agent"; the broader "boundaries must not merge for engineering convenience" framing is not restated | **Equivalent in the specific KP-generator case Product addresses; the general anti-merge principle is narrower in scope than legacy's** | `CARRIED_FORWARD` (for the case Product covers) + note | P2 | Impl §13.1–13.2 draws the same four-role + internal-pipeline-role distinction — YES | No action for the covered case. The broader "don't merge for convenience" framing is a governance principle, not a product behavior gap — appropriately left to `AGENTS.md`-level guidance rather than Product authority. |
| LEGACY-SYS-CLOSURE-001 | Every KnowledgePoint must reach "Teaching Closure" — a genuine understanding-closure, not a mandatory fixed three-part template; closure is judged by a self-check (what should the student understand, is every Anchor carried, is expected coverage placed, do segments connect, is there meaningless repetition, does any AI content pretend to be textbook-stated when it isn't) | Skill §15 (15.1–15.3) · Register §13.2 · Blueprint §76.9 | Product does not define an equivalent "closure" requirement for the new KP/Teaching model at all — §17 (Section Teaching) discusses Reading Guide/Inline Guidance modules but no closure obligation | Absent | `STILL_VALID_BUT_MISSING` | **P1** | NO | This is architecture-independent pedagogy, not reconstructed-ebook plumbing — a KP existing without ever reaching a "the student can now explain X" checkpoint is a real product gap regardless of how content is rendered. |
| LEGACY-SYS-NOFAKESUMMARY-001 | Closure must never manifest as a forced, template-driven "Summary" section merely to satisfy a checklist — if the material doesn't need one, don't manufacture one | Skill §15.2 | Not addressed (no closure concept exists to have this caveat) | Absent | `STILL_VALID_BUT_MISSING` | P2 | NO | Adopt together with LEGACY-SYS-CLOSURE-001 — it's the anti-pattern half of the same rule. |
| LEGACY-SYS-NARRATIVE-001 | A "scenario/need → problem → solution → principle → operation → purpose" narrative arc is *preferred* for content that fits it, explicitly **not mandatory**, and must not be forced onto pure definitional content, must not pad transitions with empty AI text, and must not dress model reasoning up as textbook fact | Skill §14 | Product §20 has a related but differently-shaped idea (Reading Guide modules "chosen because they help, not because a template requires all of them") — same anti-template spirit, different specific mechanism (narrative arc vs. module selection) | **Different, plausibly intentional** — Product's Reading Guide module list (定位/动机/桥接/阅读路线/防坑/权重证据/图表阅读方法/退出标准) is a *different and more developed* answer to the same underlying problem legacy's narrative arc was solving | `INTENTIONALLY_CHANGED` | P2 | Impl §17 — YES, via Reading Guide's module system | No action — Product §20's module system is a clear, deliberate superset/replacement of the narrative-arc idea, not an accidental drop. |
| LEGACY-SYS-RECALL-001 | Recall questions are lightweight, must always carry an `evidence_ref` pointing only to already-shown content in valid render order (never to content the recall itself precedes), never score, never block reading, never determine mastery, and must not be placed mechanically at every segment boundary — only where there's real pedagogical value | Skill §§20–22 | Product §32 states the "never changes mastery" half clearly; the evidence-ordering rule and the "not every boundary" placement guidance are not restated | **Equivalent for the mastery half; absent for evidence/placement discipline** | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | Impl doesn't define Recall generation logic yet (correctly deferred to R7) — NO, not yet applicable | Low urgency now since Recall generation isn't designed yet in Implementation; flag for when Phase R7 (Section Teaching) is actually specified. |
| LEGACY-SYS-PREREQ-001 | System may state a prerequisite ("before this, make sure you can explain X") but must never claim the *specific user* personally has a prerequisite deficit without real learning-history evidence; "adjacent to a topic" must never be phrased as "we already covered this" absent evidence | Skill §19 · Register (Knowledge Prerequisite ≠ User Learning History, appears in multiple skills) | Product §20.2 states this almost verbatim: "must not infer and state that the user personally has a prerequisite deficit merely from Progress data" | Equivalent | `CARRIED_FORWARD` | P2 | Impl §13.6 (grounding) — YES | No action. |
| LEGACY-SYS-USERSTYLE-001 | System/Review never accept User Style modification of teaching logic or review rules — style personalization is exclusively a Master/Assistant expression-layer concept | Register §35 · Skill §4 item 16 | Product doesn't define User Style at all yet | Absent (feature doesn't exist) | `STILL_VALID_BUT_MISSING` | P2 | NO | Bundle with §15. |

---

## 10. Review Delta Ledger

Legacy source: `REVIEW_AGENT_SKILL.md` (frozen); Register §§19–22.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-REVIEW-REWORKCOUNT-001 | A bounded automatic content-rework counter (legacy value: 3) is shared across both failure-repair paths (generation-side and planning-side fixes) — there is exactly **one** counter per unit, not two, so total automatic semantic-repair attempts stays strictly bounded regardless of which layer is fixed each round | Skill §30 | Product §33.2 states the principle generally: "the first implementation should use a finite retry principle rather than open-ended loops" — no shared-counter mechanism or specific bound is stated | **Weaker** — the *principle* (bounded, not infinite) is carried; the *mechanism* that makes it actually bounded across two repair paths (one shared counter, not two independent ones) is not | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | Impl §13.7/§17.1 states publication is review-gated but doesn't specify a rework-count mechanism — NO | The shared-counter detail matters specifically because it's the kind of thing that's easy to get wrong by accident (implementing two independent counters that each individually look bounded but together aren't). |
| LEGACY-REVIEW-EXHAUST-001 | After the bounded rework count is exhausted with blocking issues still open, the unit enters a terminal hard-failure state; Review may not: start a fourth attempt on its own, lower its standard to force a pass, or let the failed/raw content reach the reader as a "degraded" delivery | Skill §33 · Register §50 item 6 ("三次失败后原文降级" listed as a *forbidden historical anti-pattern*) | Product §33.2 states bounded retry generally; no explicit terminal-failure behavior or the specific "never degrade to raw delivery as a consolation" prohibition | Absent | `STILL_VALID_BUT_MISSING` | **P1** | Impl §17.1 has `REJECTED` as a state but doesn't define what happens to the *section* when its teaching asset is terminally rejected (presumably: no teaching shown, reading proceeds — consistent with §20, but not stated as the resolution of *this specific* failure path) — **PARTIAL** | High-value low-cost fix: state explicitly that exhausted review failure means "no teaching asset for this section," never a degraded/unreviewed substitute. This is literally listed as a *known historical bug* the old project fixed (Register §50.6) — the exact kind of rule Rule J warns is easiest to silently lose. |
| LEGACY-REVIEW-PASSFREEZE-001 | Once a unit of content is accepted, no later fix (of any kind, from any other unit's repair cycle) may touch its already-accepted contract, its already-accepted output, or its contribution to overall coverage; cross-unit mutation of accepted content must be refused outright, with no "makes things flow better globally" exception | Skill §12 · Register (PASS immutability referenced across §§9,19,21) · Blueprint §76.12 | Product §17.4 states the adjacent idea for teaching-asset regeneration ("no silent overwrite... previous published version remains until the new one passes review") but doesn't state the cross-unit-mutation prohibition as a *general Review-authority boundary* | **Weaker/narrower** — Product's rule is about *regeneration replacing itself*; legacy's rule is about *nothing else being allowed to reach back and mutate something already accepted*, which is a different (and more load-bearing) guarantee | `SEMANTIC_DRIFT_OR_WEAKENED` | **P1** | Impl §17.1/§17.4 — **PARTIAL** | Worth stating explicitly: an accepted (PASS/PUBLISHED) unit of content is immutable from every path except its own deliberate, versioned regeneration. |
| LEGACY-REVIEW-INCREMENTAL-001 | Review must happen incrementally as content is produced — reviewing an entire chapter only after full generation is an explicitly forbidden anti-pattern (early failure detection, contamination prevention, early PASS freezing, reduced large-scale rework) | Skill §34 | Product §30.2 requires mandatory review before publication but doesn't specify granularity/timing (per-KP? per-Section? whole-chapter-at-once?) | **Underspecified rather than contradicted** — nothing forbids reviewing incrementally, but nothing requires it either | `STILL_VALID_BUT_MISSING` | P2 | Impl §17.1 review happens per teaching-asset version, which is naturally incremental at the section level — largely **YES** by construction | Low priority — the new architecture's Section-scoped, replaceable teaching model makes whole-book-then-review structurally unlikely anyway. Worth a one-line confirmation, not a redesign. |
| LEGACY-REVIEW-NOMIXEDBLAME-001 | A failure is routed to exactly one repair layer (generation-side or planning-side), never both simultaneously for the same issue — "no mixed blame" | Skill §26 | Not addressed (the new Teaching pipeline doesn't yet define distinct generation-vs-planning repair paths) | Absent | `OBSOLETE_WITH_OLD_ARCHITECTURE` | — | N/A | This rule exists specifically because legacy had two distinct upstream repair layers (Planning and Generation) tied to the reconstructed-book pipeline. The new Section Teaching model (Impl §17) doesn't have that two-layer split, so there's no "mixed blame" to prevent. If a future Teaching pipeline design reintroduces multiple repair layers, this principle (route each failure to exactly one) should be re-examined then — not now. |
| LEGACY-REVIEW-DETSEM-001 | Review has two layers: cheap deterministic gates run first (schema/reference/coverage/anchor integrity), and only a `DET_PASS` may proceed to a semantic (model-based) review pass | Skill §§3, Part II | Product §30.2/§33.2 doesn't explicitly separate deterministic vs. semantic review layers at Product-authority level | **Equivalent, but at engineering layer only** | `CARRIED_FORWARD` (via Implementation) | P2 | Impl §13.7 states this explicitly: "Deterministic gates first... A candidate failing them is rejected without spending a call" — **YES** | No action — this is a case where the *engineering* pattern was independently re-derived and matches legacy's product intent closely enough that no Product-level restatement is needed. Noted as a genuine `IMPLEMENTATION_ALREADY_COVERS = YES` case, distinguished from the cases above where implementation coverage is absent or partial. |

---

## 11. Reader / Interaction Delta Ledger

Cross-cutting; sources include Register §§25–27, Blueprint §76 items 15–16, 23, 29.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-READER-BROWSERCLOSE-001 | Browser/tab close is never itself a session-lifecycle transition; session lifecycle only has `ACTIVE`/`CLOSED`, deliberately with no `PAUSED` state absent a reliable trigger | Register §25, §26 · Blueprint §76.15–16 | New architecture has no `EbookSession` object at all — reading position is persisted directly and continuously (Impl §15.1), so there is no session-lifecycle state machine to accidentally couple to browser close | **Equivalent by construction** — the underlying guarantee (browser close doesn't corrupt or pause your reading state) survives because the new architecture removed the object that could have been coupled to it | `CARRIED_FORWARD` | P2 | Impl §15.1 — YES | No action. Included to demonstrate the audit is finding real equivalences, not only gaps. |
| LEGACY-READER-NOSILENTOVERWRITE-001 | A new full generation request must never silently replace an `ACTIVE` session the user is still using on an overlapping scope — explicit confirmation is required | Register §27 · Blueprint §76.23 | Legacy-Reuse-Audit already classified the entire Session-Scope/overlap-confirmation mechanism as `DISCARD_ARCHIVE` (it solves a problem — concurrent generations racing over shared scope — that the new lazy/incremental Chapter+Teaching model doesn't create, since generation is Section/Chapter-scoped and additive rather than whole-book-replacing) | Not applicable — the underlying race condition doesn't exist in the new architecture | `OBSOLETE_WITH_OLD_ARCHITECTURE` | — | N/A | Confirmed obsolete on independent re-examination: Product §17 (max one Section) and §14 (max one Chapter, lazy) structurally prevent the "new full generation clobbers an in-progress read" scenario legacy's rule was guarding against, because there is no "full generation" to race against a read in progress. |

*(Additional Reader-domain items — reading position, KP-local Master entry, Section Learning Check
non-blocking behavior — are already covered under §12 Learning-State, since in the legacy documents
they are framed as `UserProgress`/`EbookSession` rules rather than distinct Reader-interaction rules.
Cross-referenced there rather than duplicated here.)*

---

## 12. Learning-State Delta Ledger

Sources: Register §§10–12, Blueprint §76 items 7, 28; Master Skill Part X.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-LEARN-NOSEGMENTBIND-001 | Persistent learning progress must never bind to a temporary/regenerable presentation-structure identifier (legacy: "Ebook Segment ID") — it must bind only to a stable, durable identity | Register §5.1 (SourceBlock identity), §12.1 · Blueprint §76.7 · Register §50 item 1 (listed as a forbidden historical anti-pattern) | Product §12 requires exactly one primary Section per KP with a stable KP identity, and §35/§15.1 in Implementation binds `ReadingPosition`/`KPStatus` to `book_source_revision_id` + geometry/KP id, never to a teaching-asset version | **Equivalent** — the *general* underlying rule ("durable mastery must never bind to replaceable/generated presentation structure," exactly the abstraction the audit brief itself suggests) survives cleanly under the new KP/Section model | `CARRIED_FORWARD` | P2 | Impl §15.1, §19.2 — YES | No action. This is the audit's own worked example of correctly abstracting away the old architecture-specific noun while confirming the underlying rule survived. |
| LEGACY-LEARN-STATEHOST-001 | Three distinct "state hosts" must never be conflated: generation/production state, durable learning state, and session/interaction lifecycle — each has its own object and lifecycle rules | Register §25 | Product's asset-layer split (§3: Stable Book Foundation / Replaceable Teaching / User Learning Layer) is a close structural analogue — three layers, similar separation intent | **Equivalent, restated in different terms** | `CARRIED_FORWARD` | P2 | Impl §4.2 (downward-only dependency rule between contexts) enforces exactly this separation — YES | No action. |
| LEGACY-LEARN-RECALLNOPROGRESS-001 | Recall answering/skipping/correctness never automatically changes progress | Register §12.3 · Skill (System) §20 | Product §32 states this directly and clearly | Equivalent | `CARRIED_FORWARD` | P2 | Impl §15.5 — YES | No action. |

*(The Section-level "都清楚了 / 还有些不清楚" / reading≠mastery / no-bulk-negative rules were already
extensively re-derived and stated explicitly in `PRODUCT_BLUEPRINT.md` §28 and cross-checked against
Implementation §15.2–15.3 during the clean-room drafting and reconciliation passes. Re-auditing them
here would duplicate that work; they are the strongest-carried-forward part of the entire Learning-State
domain and are not repeated as ledger rows.)*

---

## 13. Trust / Attribution Delta Ledger

Sources: Register §36 (Reference Corpus), System Skill §§17, 17.2; cross-cutting grounding rules
already threaded through Assistant/Master/System ledgers above.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-TRUST-REFCORPUS-001 | Reference Corpus (external supplementary material) is strictly separated from Primary Book ORIGINAL and must never be output disguised as, or interchangeable with, textbook original text; a discrete structured reference item (e.g., a past-exam question) may be shown with clear provenance under explicit use-boundaries | Register §36 · System Skill §17.2 | Product §30.1 states this generally for all AI output ("distinguish textbook content from AI explanation and external extension... never fabricate textbook quotes... state uncertainty rather than inventing missing evidence") and §21 for exam evidence specifically | Equivalent | `CARRIED_FORWARD` | P2 | Impl §13.6 (grounding rules) — YES | No action. |
| LEGACY-TRUST-DELETESYNC-001 | Deleting a reference document must synchronously clean up its relational metadata, vector chunks, and physical assets through one unified service — "no ghost chunks" | Register §36 | Not addressed — the new architecture has no Reference Corpus/vector-retrieval feature at all in this Product Blueprint (Legacy-Reuse-Audit classified vector retrieval as `REFERENCE_ONLY`/deferred) | Absent (feature doesn't exist yet) | `OBSOLETE_WITH_OLD_ARCHITECTURE` (for now) | — | N/A | Not a product-semantics gap today since the feature isn't in scope. Should resurface as an implementation constraint *if and when* a reference-corpus/RAG feature is designed (Product §38 lists this as explicitly deferred) — flagged here so it isn't rediscovered from scratch then. |

---

## 14. Failure / Retry Delta Ledger

Sources: Register §§21–24; already partially covered per-domain above (Assistant §7, Review §10).
This section captures the cross-cutting rules that don't belong to one Agent alone.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-FAIL-TECHVSCONTENT-001 | Technical Retry (transport/provider failures) and Content Rework (semantic review failures) are completely separate counters/mechanisms; technical failures never consume a content-rework attempt | Register §22 · Blueprint §76.11 | Product §33.2 states this principle directly: "keep technical retry distinct from content rework" | Equivalent | `CARRIED_FORWARD` | P1 | Impl §13.8 draws exactly this distinction (transient vs. content-validation vs. user-actionable failure classes) — YES | No action. This is the cleanest full carry-forward in the whole audit — principle, product statement, and engineering implementation all agree. |
| LEGACY-FAIL-LATERUNITS-001 | When one unit hard-fails after exhausting rework, later independent units continue by default; only an explicit, accepted dependency may block them — failure isolation is the default, not the exception | Register §21.3–21.4 · Blueprint §76.29 | Product doesn't state this explicitly for the new KP/Teaching model, though the general spirit (§14: "Chapter Preparation failure never blocks PDF/Assistant/Notes") is present for the Chapter-vs-rest-of-book case | **Equivalent for chapter-level isolation; unstated for unit-level (Section/KP-level) isolation within an otherwise-healthy chapter** | `SEMANTIC_DRIFT_OR_WEAKENED` | P1 | Impl §20 states chapter-level isolation clearly; doesn't state section-within-chapter isolation explicitly — **PARTIAL** | Worth one explicit sentence: within a chapter, one Section's teaching-generation failure never blocks sibling Sections' teaching (mirroring the chapter-level guarantee one level down). |
| LEGACY-FAIL-BUDGETNOTFAIL-001 | Exhausting a task's usage budget (calls/tokens/cost) is not equivalent to a semantic Review failure — it's a distinct technical-exhaustion state | Register §22.2 | Not explicitly restated at Product level (this is arguably pure engineering, not product-visible behavior) | Absent at Product level, but arguably correctly so | `OBSOLETE_WITH_OLD_ARCHITECTURE` — reclassified as engineering-only | — | Impl §13.8 addresses budget/retry mechanics generally | No product action. Genuinely an implementation-level concern; the audit brief's own guidance (separate Product behavior from checkpoint implementation) applies directly here — filed as not requiring Product authority at all, distinct from a true gap. |

---

## 15. User-Style Delta Ledger

Every legacy User-Style rule across Assistant/Master/System skills reduces to one structural principle,
already flagged per-domain above (LEGACY-ASST-USERSTYLE-001, LEGACY-MASTER-USERSTYLE-001,
LEGACY-SYS-USERSTYLE-001). Consolidated here rather than repeated three times.

| ID | Legacy semantic contract | Sources | New Product mapping | Meaning | Classification | Priority | Impl. coverage | Recommended action |
|---|---|---|---|---|---|---|---|---|
| LEGACY-STYLE-BOUNDARY-001 | A user-configurable "expression style" (tone, verbosity, examples, language) may affect *only* how Master/Assistant phrase things — never any structural, authority, persistence, or lifecycle rule (max depth, one-active-child, context inheritance, source identity, persistence/export boundaries, attribution logic, topic state machine, condensation requirements, evidence rules, closure requirements, teaching/review policy). System and Review never accept style input at all. | Register §35 · Assistant Skill §§50–51 · Master Skill §49 · System Skill §4.16 | The new Product Blueprint does not define any personalization/style feature yet | Absent — feature doesn't exist | `STILL_VALID_BUT_MISSING` | **P1** | NO | Flagged P1 rather than P2 *despite* the feature not existing yet, because this is exactly the kind of clean architectural boundary that's easy to draw correctly *before* a style feature exists and easy to get tangled *after* one is half-built without it. If/when personalization is added to Product scope, this boundary should be stated on day one, not retrofitted. |

---

## 16. Obsolete Legacy Semantics

Every rule below was checked against the "does an independent, architecture-free behavior survive"
test from the audit brief. In each case the answer is no — the rule's entire reason to exist was the
abandoned reconstructed-ebook/SourceBlock/Anchor model.

| ID | Legacy rule | Why it is obsolete, not merely unused |
|---|---|---|
| OBS-001 | SourceBlock stable-reference identity; re-parsing requires explicit migration (Register §5) | Exists to let a generated Render Tree cite immutable source fragments. The new architecture has no generated Render Tree and no SourceBlock; the PDF itself is the reading surface (Product §2). No independent behavior survives — this isn't "the same idea under a new name," it's a mechanism for a problem that no longer exists. |
| OBS-002 | ORIGINAL data invariants: one-character-immutable, Source-Reference-is-the-only-access-mechanism, Renderer materializes exact original text (Register §6) | The immutability principle ("original is truth") *does* survive, but as "the PDF is never modified" (Product §2/§7) — a categorically simpler statement once there's no separate extracted-text copy to keep faithful to the PDF. The specific Source-Reference/Renderer mechanism is pure reconstructed-ebook plumbing. |
| OBS-003 | Structured Render Tree; forbidding "flat full text as authoritative storage"; Render Node concept; Render/Export sharing one Node contract (Register §7) | The entire premise (content is authored as a tree of nodes that gets rendered) is exactly what Product §2 rules out. Nothing to extract — the new Reader has no render tree at all. |
| OBS-004 | Source Mapping / three coverage sets (`allowed`/`expected`/`used` source blocks), deterministic exclusion, Task vs Review-unit expected-set scoping, cross-unit PASS-coverage accumulation (Register §§8–9) | Exists entirely to prove "the generated ebook covers every part of the original" — a problem that doesn't exist when the original *is* the reading surface (nothing needed to "cover"). `LEGACY_REUSE_AUDIT.md` independently reached the identical conclusion for the code-reuse question; this audit confirms it independently for the product-semantics question. |
| OBS-005 | KnowledgeDataset as "1 PDF = 1 Book = 1 fixed KnowledgeDataset," created once for the whole book (Register §10, Blueprint §76.4) | Directly superseded by Product §14's lazy, Chapter-scoped, versioned KP preparation — an *intentional* change already fully specified in the new Product Blueprint, not a silent loss. |
| OBS-006 | Stable Semantic Anchor as the sole internal learning-semantic unit, owned by KnowledgeDataset, with its own N:1/1:N Segment-mapping cardinality rules (Register §11) | The underlying need (a stable identity for progress to attach to) survives as the KP itself (Product §11–12, one primary Section, continuous range) — already captured as `CARRIED_FORWARD` under LEGACY-LEARN-NOSEGMENTBIND-001. The Anchor-as-a-*separate-sub-KP-entity* layer does not survive and should not: `LEGACY_REUSE_AUDIT.md` independently flagged Anchor revival as the single highest-risk contamination vector (its §9 R6). This audit concurs from the product-semantics side. |
| OBS-007 | `Segment ↔ Anchor` minimum cardinality and Anchor granularity-minimum principles (Register §11.6–11.7) | Pure consequence of the two-tier KP/Anchor model (OBS-006). No independent survival once Anchors are gone. |
| OBS-008 | `1 temporary Segment → N Anchors` forbidden; `N Segments → 1 Anchor` allowed (Blueprint §76.28, Master Skill §40) | Same as OBS-006/007 — a cardinality rule about a temporary presentation unit (Segment) mapping to a permanent learning unit (Anchor), neither of which exists in the new architecture. |
| OBS-009 | Checkpoint contents required to restore: passed-unit identity, passed render nodes, source references, review-PASS results, coverage accumulation, planning/generation state (Register §23) | This is squarely implementation/checkpoint machinery for the reconstructed-ebook generation pipeline, explicitly out of this audit's scope (product semantics, not implementation archaeology) *and* already independently addressed at the architecture level: `IMPLEMENTATION_BLUEPRINT.md` §18.5 explains in detail why the new job model needs no checkpoint store at all (idempotent, per-page-committed jobs with publish-time identity minting). Nothing to recover here. |
| OBS-010 | `Retry/Resume ≠ Session Replacement` — failed-unit retry and checkpoint resume are "continuation of the current task," not a new full generation overwriting an active session (Register §24) | Depends entirely on the GenerationTask/EbookSession pair, neither of which exists in the new architecture. The *underlying* worry (don't let recovery work silently look like/become a destructive new operation) is a reasonable general engineering instinct, but it has no specific product-behavior content once there's no "session" for a retry to accidentally replace. |
| OBS-011 | `EbookSession` as a session-scoped persistent artifact restoring Structured Render Tree, Generated AI Blocks, Source References, Teaching Plan, Segment Contract, Generation state on top of Reading Position and Active Master Thread (Register §26) | The two genuinely durable, architecture-independent items in this list (Reading Position, Active Master Thread) already survive cleanly as `CARRIED_FORWARD` (LEGACY-READER-BROWSERCLOSE-001, LEGACY-MASTER-SESSIONCLOSE-001). Everything else in the list is reconstructed-ebook state that has no new-architecture analogue to restore, because there's no generated content tree to restore in the first place — the PDF is already there. |

---

## 17. NEEDS_USER_REDECISION

**Methodological note.** Every atomic contract below already carries its own primary classification
in §§7–15 (`SEMANTIC_DRIFT_OR_WEAKENED` or `STILL_VALID_BUT_MISSING`, all `P0`) — none is
double-counted here as a seventh bucket. `NEEDS_USER_REDECISION` is applied at the **cluster** level:
these three groups bundle atomic contracts that interact tightly enough that adjudicating them one row
at a time would produce an incoherent design (e.g., approving `MAXDEPTH` without also settling
`WINDOW`'s state-model question). §5's classification table therefore correctly shows zero rows tagged
`NEEDS_USER_REDECISION` as a primary tag — the three clusters below are a *view* over rows already
counted there, not additional contracts.

Three clusters where the old rule was real and deliberate, the new product has changed enough that
automatic retention or rejection is unsafe, and two credible paths remain with materially different
observable behavior.

### NEEDS-REDECIDE-001 — Assistant recursion: bound, model, and negative rules

**The old answer:** a Window/Child tree, `max_depth = 5`, one active child per parent (with atomic
concurrency), Children inherit only the triggering parent turn (never full ancestor history), and an
Assistant answer can never become a fresh Root to bypass the depth cap.

**Why it can't be auto-decided either way:**
- *Auto-CARRY_FORWARD* is wrong because the new architecture already made one real, considered change
  the legacy model didn't have: `IMPLEMENTATION_BLUEPRINT.md` §14.3 models recursion as a flat
  turn-ordinal reference within one continuing context rather than a branching tree — arguably a
  *simpler and still-coherent* design for a single-scope conversational assistant, not obviously
  worse. Re-imposing a five-level branching tree wholesale could be over-engineering a UI/state model
  the flat design already handles.
- *Auto-REJECT* is wrong because doing nothing leaves the system with **no bound on context growth or
  recursion depth at all**, no defined behavior for concurrent recursive requests, and — critically —
  no equivalent of the anti-root-bypass rule, which is the one guarantee that makes *any* future bound
  actually enforceable.

**Two credible paths:**
1. Keep the flat turn-ordinal model (Impl §14.3), but explicitly add: a numeric or context-budget-based
   recursion bound, an explicit statement of what a recursive turn does/doesn't inherit, and — if
   branching (multiple independent explorations from one answer) is ever wanted — the concurrency and
   one-active-child rules revisited for that shape.
2. Reintroduce an explicit bounded Window/Child model closer to legacy's, if product judgment is that
   users actually branch into multiple independent sub-explorations often enough to need first-class
   support for it (rather than one continuing thread).

**Recommendation for the adjudication conversation:** Option 1 with an explicit bound is the smaller
change and fits the architecture already drafted; Option 2 is a legitimate product decision if there's
evidence users want to explore two different tangents from one answer without losing either. This is
squarely a product-behavior choice, not something to default silently either way.

### NEEDS-REDECIDE-002 — Master Topic model and evidence-gated progress writes

**The old answer:** `MasterTopic` as an explicit condensation unit with its own state machine
(`OPEN→ENDING→CONDENSING→CONDENSED`, plus a `CONDENSATION_TECHNICAL_FAILED` retry path and a
continuation-topic race rule), an explicit-first ending policy, and an eight-part evidence gate before
Master may write a KP status of UNDERSTOOD.

**Why it can't be auto-decided:** The new Product Blueprint (§26–29) clearly intends Master to have
durable threads, structured summaries, and a role in confirming understanding — but does not specify
*how* a raw conversation becomes a durable record, or under what evidentiary conditions Master itself
(as opposed to the Section-level "都清楚了" button) may write mastery. Auto-carrying the full legacy
Topic state machine risks reintroducing complexity the new product may not want; auto-rejecting it
leaves an actual capability gap — condensation and evidence-gated Master writes are described as
existing but nothing defines when they trigger or what gates them.

**Two credible paths:**
1. Adopt a Topic-equivalent unit and its evidence gate, adapted to the new KP/Section model (drop
   Anchor-specific language, keep the state machine and evidence conditions).
2. Decide Master-driven mastery *writes* are out of scope for V1 — Master only answers and records
   history; all mastery changes route exclusively through the explicit Section-level check (Product
   §28) — deferring the Topic/evidence-gate design entirely.

**Recommendation for the adjudication conversation:** this interacts directly with how much of
`MASTER_AGENT_SKILL.md`'s condensation/attribution apparatus (§8, §10 Master Delta Ledger) is wanted
at all — worth deciding together rather than piecemeal.

### NEEDS-REDECIDE-003 — Review terminal-failure and cross-unit immutability guarantees

**The old answer:** one shared rework counter across both repair layers, an explicit terminal
hard-failure state after exhaustion that forbids both a fourth attempt and any degraded/raw-content
fallback, and a general prohibition on any later fix mutating previously-accepted content across unit
boundaries.

**Why it can't be auto-decided:** The new Teaching pipeline (Impl §17) doesn't have legacy's two-layer
(Planning-fix / Generation-fix) repair structure, so the *shared-counter* mechanism doesn't map
directly. But the two outcomes it protected — "don't retry forever," "don't let already-accepted
content get silently rewritten by an unrelated fix" — are architecture-independent and currently
unstated for the new single-layer Teaching model.

**Two credible paths:**
1. State both outcomes directly for the new single-repair-layer model (simpler than legacy's, since
   there's only one repair path to bound and one "already published" state to protect).
2. Decide the two-gate deterministic/semantic review split (already adopted, §10
   LEGACY-REVIEW-DETSEM-001) plus a version-based regeneration model (Impl §17.4) is *already*
   sufficient protection, and no additional explicit terminal-state/immutability language is needed.

**Recommendation for the adjudication conversation:** Path 1 is low-cost and closes a real, specifically
previously-encountered bug class (Register §50 lists "raw-content degrade after 3 failures" as a
historical anti-pattern the old project had to *learn* to forbid) — worth adopting even if the rest of
Review's old apparatus is not.

---

## 18. Product Patch Candidates

Not authorized. Listed only as the input set for the future adjudication conversation, organized by
which `PRODUCT_BLUEPRINT.md` section each would extend.

| Candidate | Would extend | Source contracts |
|---|---|---|
| Explicit Assistant recursion bound + anti-bypass rule + inheritance list | §24.2 | LEGACY-ASST-WINDOW-001, -MAXDEPTH-001, -ROOTBYPASS-001, -ANCESTOR-001 |
| Assistant provider-failure "no learning-state side effect" list | §24 / §20 | LEGACY-ASST-PROVFAIL-001 |
| Master must-answer guarantee, decoupled from attribution | new subsection under §26 | LEGACY-MASTER-MUSTANSWER-001, -ATTRIBUTION-001 |
| Master Topic/condensation-unit existence and ending policy | §26/§29 | LEGACY-MASTER-TOPIC-001, -ENDING-001, -CONDENSATION-RACE-001 |
| Master evidence-gate for KP-level UNDERSTOOD writes | §27/§28 | LEGACY-MASTER-EVIDENCE-001, -NODOUBLECONFIRM-001 |
| Explicit no-auto-downgrade rule for UNDERSTOOD KPs | §29 | LEGACY-MASTER-NODOWNGRADE-001 |
| KnowledgePoint Teaching Closure requirement | §17 | LEGACY-SYS-CLOSURE-001, -NOFAKESUMMARY-001 |
| Recall evidence-ordering + non-mechanical-placement rules | §17/§22 (recall) | LEGACY-SYS-RECALL-001 |
| Review terminal-failure outcome (no 4th attempt, no degraded delivery) | §33.2 | LEGACY-REVIEW-EXHAUST-001 |
| Cross-unit PASS/publication immutability guarantee | §17.4/§33 | LEGACY-REVIEW-PASSFREEZE-001 |
| Section-within-chapter failure isolation (one level below existing chapter isolation) | §14/§20-equivalent | LEGACY-FAIL-LATERUNITS-001 |
| User-Style structural boundary, stated proactively before any style feature exists | new section | LEGACY-STYLE-BOUNDARY-001 |
| Assistant export exclusion, as a placeholder for future export design | new subsection | LEGACY-ASST-EXPORT-001 |

## 19. Implementation-Only Patch Candidates

Contracts that, once Product-level adjudication above lands, are pure engineering restatements needing
no new Product decision (`IMPLEMENTATION_ALREADY_COVERS = PARTIAL` cases where the missing part is
purely mechanical):

| Candidate | Would extend | Source contract |
|---|---|---|
| Assistant technical-retry turn-identity reuse (idempotency) | Impl §13.8/§14 | LEGACY-ASST-RETRYID-001 |
| Assistant concurrent-child-creation atomicity, if any branching model is adopted | Impl §14 | LEGACY-ASST-CONCURRENCY-001, -DEPTHGATE-001 |
| Assistant source-type catch-all guarantee restated for `SelectionSource.kind` | Impl §14.3 | LEGACY-ASST-SOURCETYPES-001 |
| Master Weakness-sentence quality rule | Impl §15 | LEGACY-MASTER-WEAKNESS-001 |
| Reference-corpus delete-sync ("no ghost chunks"), deferred until that feature exists | future Impl section | LEGACY-TRUST-DELETESYNC-001 |

---

## 20. Coverage / Confidence

| Domain | Sections read in full | Confidence |
|---|---|---|
| Assistant | All 74 numbered sections + 19 acceptance scenarios | **High** — exhaustive per the task's explicit instruction |
| Master | All 15 Parts, all numbered sections | **High** |
| System | All 13 Parts, all numbered sections including anti-patterns and acceptance scenarios | **High** |
| Review | All 13 Parts, all numbered sections | **High** |
| Decision Register | All 58 numbered sections' headings read; ~35 read in full body where a Skill cross-referenced them or a numeric/negative rule was flagged by its heading | **High** for cited sections; **medium** for the handful of purely administrative sections (ADR process, Codex Git governance, testing/golden-dataset process) that are process/governance rather than product-behavior and were consequently out of this audit's scope by design |
| Development Spec | Consulted only where a Skill referenced a mechanism needing schema-level context (e.g., Checkpoint contents, `AssistantTurn` persistence shape) | **Medium** — not read cover-to-cover, per the task's own scoping instruction to treat it as secondary evidence only |

**Explicit confidence caveat:** this audit's completeness is bounded by what the seven frozen documents
themselves contain. If a genuinely product-relevant rule existed only in an unfrozen draft, a Phase
Brief, or a chat-level decision never promoted into one of the seven, it is out of scope by the
transition plan's own instruction and would not appear here.

---

## 21. Stop / Next Step

**This audit is complete and is evidence only.** No Product or Implementation authority has been
patched. No `NEEDS_USER_REDECISION` item has been silently resolved.

**Recommended next step**, per the governing task: review only —

- all 11 `SEMANTIC_DRIFT_OR_WEAKENED` rows;
- all 17 `STILL_VALID_BUT_MISSING` rows;
- all 3 `NEEDS_USER_REDECISION` items (§17);
- the 4 `P0_SEMANTIC` items specifically (§6 ranks 1–4).

Only after that adjudication should `PRODUCT_BLUEPRINT.md` receive approved patches, followed by one
consolidated `IMPLEMENTATION_BLUEPRINT.md` pass covering both the approved semantic patches and the
four already-known ZCode P1 findings together, per the task's explicit sequencing instruction.

---

**End of LEGACY_PRODUCT_SEMANTICS_DELTA_AUDIT — audit evidence, authority tier NONE.**
