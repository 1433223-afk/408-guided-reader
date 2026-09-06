# Phase / First Chapter Knowledge Map

> **Status: ACCEPTED — ready for implementation (2026-09-06).** This brief was accepted after
> Planner second review. It is the implementation authority for this Phase; it does not reopen or
> amend either Frozen Blueprint.

## Goal

Deliver the first durable Learning Structure slice: prepare and publish one coherent Chapter
Knowledge Map on demand, using only the physical resolution that Chapter needs, and make the map
useful in the Reader without building Learning, Master, or Teaching ahead of it.

## User-visible result

> “我可以为正在读的一个章节准备学习地图，看到按教材小节分组的知识点，并从知识点回到对应教材；
> 准备失败不会影响阅读，我可以诚实地看到状态并重试。”

The existing Map the Book remains the textbook's logical directory/navigation. This new Chapter
Knowledge Map identifies the learning units within one Chapter; it is not a replacement Outline.

## Authority to read

**Directly relevant development reports (Tier A):**

- `docs/development-reports/MAP_THE_BOOK.md` — current logical Outline identity, navigation,
  incremental publication, and physical-target limitations
- `docs/development-reports/SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md` — latest closed product state,
  current AgentRuntime/Review routing, persistence, failure, egress, and real-book test path

**Product Blueprint:**

- §2, §3.1, §4.2–§4.3 — Original PDF authority, Stable Book Foundation, and lazy preparation
- §7.1–§7.1.1 — foundation-version and footprint-scoped dependency rules
- §9.1–§9.5 — logical Outline identity, progressive physical resolution, and correction granularity
- §11–§16 — KP definition, primary Section ownership, continuous ranges, lazy Chapter preparation,
  atomic publication, structure protection, and structural Review
- §18–§19.1 — optional AI, failure isolation, and the distinction between reading readiness and
  mastery readiness
- §30.1, §33.1–§33.2 — grounding, System/Review authority, and context independence
- §38 decisions 2–3, 9, 13–19, 62–64 — the corresponding frozen decisions

**Implementation Blueprint:**

- §4.1–§4.3, §5.3–§5.4 — Knowledge boundaries, cross-context references, schema modularity, and
  transaction boundaries
- §8.1, §8.3–§8.4, §8.6 — the OCR/layout evidence consumed by range resolution
- §11.1–§11.5 — Stable Outline entities, authoritative construction, target-scoped range resolution,
  logical identity, and physical revision boundaries
- §12.1–§12.6 — Chapter state machine, preparation pipeline, draft/stable identity, validation,
  structural protection, concurrency, and idempotency
- §13.1–§13.8 — AgentRuntime, provider separation, structured output, Review, and typed failure
- §17.6 — atomic Chapter Knowledge Map publication
- §18.1–§18.6 — existing background-job substrate, recovery, and infrastructure limits
- §19.1–§20 — dependency versions, staleness, migration discipline, and degradation
- §21.2–§23 — credentials, egress, backup/logging, observability, and test strategy
- §24 R6 — roadmap direction and R6 acceptance intent

Nothing else from either Blueprint is required reading for this Phase.

## Prior-art check

**REQUIRED — completed for planning.** Document hierarchy and heading/range recognition are mature
problem domains. The bounded check inspected Docling's heading-hierarchy source and PR 3688, plus
Marker's section-header processor. The usable pattern is: preserve the authoritative existing
hierarchy, combine multiple signals for physical matching, and require deterministic validation
before publication. No external code, dependency, framework, or architecture is approved for
adoption. If implementation discovers such a need, stop and report under `AGENTS.md` §5.

## Hard rules

- **One real Chapter is the maximum preparation scope.** The Phase may prepare the Chapter the user
  requested and nothing broader. It must not pre-generate KPs for sibling Chapters or the whole book
  (Product §14; Implementation §12.1–§12.2).
- **Outline remains the textbook structure authority.** Preparation may improve only the requested
  Chapter's necessary physical resolution. It must never mint, delete, rename, reorder, reparent, or
  replace logical Outline nodes, and it must not turn into a separate whole-book Pass 2
  (Product §9; Implementation §11.2–§11.5).
- **Only the minimum prerequisite is in scope.** The requested Chapter and its child
  Section/Subsection nodes must become sufficiently resolved for trustworthy KP ranges; unrelated
  nodes remain untouched. Preparation never waits for a whole-book readiness signal
  (Implementation §11.5).
- **KP semantics are load-bearing.** A KP is an independently worthwhile learning-state unit, not a
  paragraph or heading mechanically copied into a list. Every KP has exactly one existing primary
  Section and one continuous source range in the first version (Product §§11–13).
- **Original PDF remains source authority.** Every published range belongs to the owning book source
  revision and resolves to real textbook geometry. A generated title or definition never becomes a
  replacement source quote (Product §2; Implementation §12.4).
- **Drafts are private and disposable.** Draft identities remain pipeline-local. Stable durable KP
  identities and the Chapter structure version are minted only at atomic publication
  (Implementation §12.2–§12.4).
- **`READY` is atomic.** A Chapter publishes one complete, internally coherent version in one
  transaction. No partial or failed draft may be user-visible as `READY`; a failed candidate cannot
  damage a previously published version (Product §14.1; Implementation §12.2, §17.6).
- **Structural Review gates publication.** Unlike user-owned Save-to-Notes promotion, this
  system-generated durable structure does not publish until independent structural Review and
  deterministic validation pass. Review failure, invalid output, exhausted retry, unavailable
  reviewer, or invocation failure never becomes PASS or `READY` (Product §16; Implementation
  §13.7–§13.8).
- **Review context is fresh and allowlisted.** It may contain only this Chapter's candidate KP map,
  the necessary Chapter/Section Outline projection, its bounded source text/layout evidence, and
  required generation provenance. It must not contain other Chapters, Assistant trees or saved
  explanations, notes/highlights, Learning/Mastery/Progress, Master threads, Teaching assets,
  unrelated navigation state, or secrets (Implementation §13.3, §21.2–§21.5).
- **Review independence is role/context independence first.** A genuinely different configured
  provider/model is preferred where available; an actual same-provider clean-context route is an
  honest fallback. No silent fallback may masquerade as the intended reviewer, and provider
  unavailability never authorizes publication (Product §16; Implementation §13.4, §13.7).
- **Failure is Chapter-local and non-blocking.** A failed or pending preparation leaves PDF reading,
  OCR selection/copy, Find, Outline navigation, Notes/Highlights, Marks, and Assistant usable. The
  user sees an honest failure state and can retry (Product §14, §18–§19).
- **Requests converge.** Duplicate clicks, HTTP retries, response-loss replay, concurrent requests,
  worker restart, and retry must converge on one logical Chapter preparation/publication, not
  duplicate maps, versions, or KPs (Implementation §12.6, §18.4).
- **No learning or teaching writes.** This Phase writes no `KPStatus`, `SectionLearningState`,
  `LearningEvent`, Master thread/topic/message, Reading Guide, Inline Guidance, Recall, Progress,
  Mastery, ExamEvidence, or Teaching asset. Chapter publication may make future KP-dependent
  capabilities eligible; it must not infer or write their state.
- **No generic platform expansion.** Use the existing storage, AgentRuntime, provider boundary, and
  durable job substrate. Do not introduce a generic workflow/state-machine system, RAG layer,
  vector store, knowledge graph, new storage technology, or second job framework.

## Build

- The minimum Reader affordance to request/open one Chapter's Knowledge Map and show honest
  `NOT_PREPARED`, `PREPARING`, `READY`, and `FAILED` semantics (exact internal names and Simplified
  Chinese wording are implementation loose edges).
- Target-Chapter-only physical matching/resolution sufficient to validate the Chapter and its child
  Section/Subsection source ranges, without changing their logical identities.
- The existing-authority pipeline for one Chapter: bounded source projection → KP generation →
  deterministic range resolution → independent structural Review → deterministic validation →
  atomic publication.
- Durable Chapter preparation state, published structure version, stable KnowledgePoint identity,
  source-revision ownership, ranges, generation/reviewer provenance, and correct book-delete cascade.
- A user-visible `READY` map grouped by primary Section, with the minimum useful KP presentation and
  a KP → textbook navigation action that returns to the real source range.
- Honest failure presentation, explicit retry, duplicate-request convergence, worker/service restart
  recovery, and preservation/reopen of the published map.
- The minimum observability and local payload inspection needed to prove scope, Review routing,
  failure semantics, and secret hygiene.

## Not now

- `KPStatus`, Section Learning Check, Reading Position changes, `SectionLearningState`, Learning
  History, Master, or any Mastery/Progress write.
- Reading Guide, Inline Guidance, Recall, Teaching generation/publication, or ExamEvidence.
- Whole-book Outline Pass 2, whole-book range completion, whole-book KP generation, or background
  preparation of sibling Chapters.
- Persistent Assistant history, changes to AI_SAVED explanation semantics, Streaming, or overall
  Assistant UI redesign/polish.
- OCR correction/reprocessing, formula/superscript OCR, Vision, figure/formula understanding, or
  cross-page selection. These remain V2/backlog unless later evidence shows they block a mainline
  slice.
- RAG, authoritative RAG, vector retrieval, a knowledge graph, generic workflow infrastructure, or a
  new UI design system.
- OpenRouter proxy/region work or the default Assistant-provider decision.
- This list is not a future construction order. After closure, the next slice is re-adjudicated from
  the actual product state under `AGENTS.md` §7.

## Acceptance

### TARGETED

With deterministic generation/Review doubles, fault injection, and a real database where persistence
is under test:

1. One requested Chapter transitions honestly through not-prepared/preparing to one atomic `READY`
   publication; no sibling Chapter is prepared or physically changed.
2. Target-Chapter physical matching preserves every logical Outline node's identity, title, order,
   hierarchy, and ownership while advancing only necessary physical evidence.
3. Every published KP has exactly one valid primary Section in the requested Chapter, a valid
   source revision, deterministic order, and a continuous range contained by the appropriate
   Chapter/Section boundaries.
4. Draft IDs are never durable/user-visible; stable IDs and one structure version appear only in the
   publication transaction.
5. Generation, range-resolution, semantic Review, technical Review, invalid structured output,
   deterministic-validation, and publication failures each remain non-READY and expose no partial
   KP set. A failed candidate cannot overwrite an existing published version.
6. Final generator and Review transports contain only their declared Chapter-scoped allowlists;
   canaries prove the absence of other Chapters, Assistant state, annotations, learning state,
   Teaching assets, unrelated user material, and secrets.
7. The actual generator/reviewer provider/model route and typed failure are recorded honestly;
   silent fallback and invocation-failure-as-PASS are impossible.
8. Duplicate click, HTTP retry, response-loss replay, concurrent prepare calls, worker interruption,
   service restart, and explicit retry converge without duplicate preparations, versions, or KPs.
9. `FAILED`/`PREPARING` preparation leaves reading, OCR selection/copy, Find, Outline, Marks,
   Notes/Highlights, and Assistant usable.
10. The Section-grouped map and KP → textbook action resolve through the published KP's real source
    range and source revision, not through generated wording.
11. Migration/upgrade preserves existing Book, BookSourceRevision, Outline, USER Annotation, and
    AI_SAVED Annotation identity, ownership, anchors, content, restart recovery, and deletion
    semantics.
12. Book deletion removes the owning Chapter preparation/map/KPs without cross-book effects, and
    retrying or deleting a book cannot leave user-visible orphan maps.
13. Preparation, publication, Review, failure, retry, and navigation perform zero writes to Learning,
    Mastery, Progress, Master, Teaching, and ExamEvidence state.
14. AI-off and missing reviewer credentials keep the Reader usable and never fabricate `READY`.

### AGENT REAL-USE GOLDEN PATH

Use the real 348-page textbook through the actually served UI with real pointer/keyboard interaction.
Prefer an unprepared Chapter 6 and:

1. open/select a Section in that Chapter and observe an honest not-prepared state;
2. request its Knowledge Map and observe preparing state without losing Reader interaction;
3. inspect local state/observability and prove that only Chapter 6 and its necessary child ranges are
   being processed;
4. complete one bounded real generator + reviewer path when an authorized configured route is
   available, and record the actual providers/models and final allowlisted payloads;
5. observe the map appear atomically only after Review and validation PASS, grouped by primary
   Section with no partial KP set visible beforehand;
6. inspect representative KPs and use KP → textbook navigation to return to the correct source
   positions/ranges;
7. close and reopen the Reader, restart the service, and recover the same published structure
   version and stable KP identities;
8. inject one generation, Review, or validation failure on a bounded retry path and prove that the
   Reader, Notes/Marks, Find, Outline, and Assistant remain usable;
9. retry and prove convergence to one published map with no duplicate KPs/version;
10. delete the book and verify the map/KPs cascade correctly without affecting another book;
11. inspect persistence and prove zero Learning/Mastery/Master/Teaching/ExamEvidence writes.

The golden path must contain at least one reversal/recovery: failure → retry or close/restart →
reopen. Missing authorized external credentials is reported honestly; it never becomes Review PASS
or full real-review acceptance.

### AFFECTED REGRESSION

Run suites and served smoke paths that share the changed risk surface:

- Map the Book logical identity, hierarchy, target navigation, per-node physical resolution, restart,
  and book cascade;
- progressive OCR/layout preparation and source geometry consumed by target-Chapter resolution;
- Reader open/navigation, selection/copy, Find in Book, Notes/Highlights, and Marks presentation;
- Assistant source scope and existing AI_SAVED Annotation persistence/cascade;
- existing job claim/recovery/idempotency, provider routing, structured output, final-payload
  inspection, AI-off, degradation, and secret hygiene.

Unrelated Search/Assistant E2E paths need only smoke coverage when they share no changed boundary;
record any intentional omission with a one-line risk reason under `AGENTS.md` §5.

### CLOSURE / BROAD

**A broad suite is required once before Phase closure** because this Phase crosses persistence and
migration, durable KP identity, source ranges, atomic publication, ownership/cascade, job recovery,
and Review egress. It is not required after every edit. Execute and report in this order:

```text
targeted → agent real-use golden path → affected regression → closure broad suite
```

## Autonomy

Ordinary implementation details are delegated under `AGENTS.md` §5: naming, file/component layout,
helpers, local algorithms, use of the existing job/provider/storage abstractions, exact Simplified
Chinese wording and control placement, ordinary error handling and CSS, test organization, and small
local refactors need no approval when they preserve this brief's authority and boundaries.

## Must report before proceeding

Stop and report if:

- reliable preparation would require changing Outline logical identity or preparing beyond the one
  requested Chapter;
- trustworthy KP source ranges cannot be established from the available real-book evidence;
- a Frozen rule conflicts with this brief or Acceptance requires Learning, Master, Guide, Teaching,
  whole-book Pass 2, whole-book KP preparation, or another excluded capability;
- durable identity, migration, ownership, cascade, structure protection, or publication authority
  would need semantics not already frozen;
- implementation would adopt substantive external code, a major/core dependency, new storage/job/
  workflow infrastructure, RAG, vector retrieval, or a knowledge graph;
- the real textbook or authorized provider credential required for a named real-use check is missing.

Report the concrete problem, 1–3 options, recommendation, and main tradeoff; never expand scope or
turn missing Review evidence into PASS.

## Completion

- Complete and report TARGETED, AGENT REAL-USE GOLDEN PATH, AFFECTED REGRESSION, and the required
  CLOSURE / BROAD suite in that order.
- Obtain an **independent narrow review** before closure. It must attack migration/data preservation,
  KP durable identity and ownership, source ranges, Outline logical-identity preservation,
  draft/stable identity, atomic publication, idempotency/recovery, cascade, Review allowlist and
  credential/egress isolation, failure-never-PASS, zero Learning/Mastery/Master/Teaching writes, and
  compatibility with future structure-lock authority.
- Complete user real-use acceptance, write the concise development report in
  `docs/development-reports/`, and create at least one clean implementation checkpoint commit.
- If the real 348-page path or required authorized real provider/Review call cannot be completed,
  report `IMPLEMENTATION_READY` and `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` with the exact missing
  evidence; do not claim closure or PASS.
