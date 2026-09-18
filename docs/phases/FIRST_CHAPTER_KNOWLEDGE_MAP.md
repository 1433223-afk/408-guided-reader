# Phase / First Chapter Knowledge Map

> **Same-Phase follow-up (2026-09-18): READY_FOR_USER_RETEST.** User authorized fixing non-body KP
> entries and exercise-derived duplicate targets. Reuse auxiliary-root presentation filtering and
> existing non-minting windows; reject preparation without a primary Section before enqueue.
> Do not reclassify durable Outline nodes, rewrite published KPs or weaken Review. Evidence:
> `docs/development-reports/KP_ENTRY_AND_EXERCISE_GUARD.md`. The closure below is the historical baseline.

> **Status: CLOSED / COMPLETE (2026-09-09).** Machine acceptance PASS; agent real-use PASS; user
> acceptance PASS; independent narrow review PASS (`P0=0`, `P1=0`, `P2=0`) with
> `CLOSURE_RECOMMENDATION: CLOSE`. The user approved Phase closure on 2026-09-09. The accepted
> implementation and deferred boundaries below remain authoritative history for this completed Phase.
> Its former READY-regeneration prerequisite was superseded later on 2026-09-09 by Product decision
> 69 and [`REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md`](./REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md).

## User-approved architecture correction

This correction supersedes the earlier generation and whole-Section semantic-repair contract
wherever this brief, the current implementation or its development report still describes it.
External research remains evidence; the decisions below are authority because the user accepted them.

On 2026-09-08 the user approved a final simplification of the semantic middle. Each real existing
Outline subsection is one bounded semantic window and receives one final, group-first semantic
partition. There is no result-driven absorption, audit, cleanup, re-partition, repair or re-review
loop. Bounded technical retries may repeat only the same window input and same contract; they may not
feed a prior semantic result back into another judgment. Chapter Review remains a strict final gate,
but a valid Review FAIL ends the preparation attempt and never triggers semantic regeneration.

The tightened KP definition remains: a KP is “the smallest learning unit for which it is worth
recording whether the learner knows it,” not the smallest noun, paragraph or enumerated item. A new
durable KP requires positive reason to preserve an independent teaching, assessment, diagnosis and
remediation path. Definition, property, ordinary step and example evidence defaults to absorption
into that learning target. Distinct mechanisms, error modes or remediation paths may justify
separate targets. Summary repetition, FAQ and misconception material defaults to non-KP evidence or
absorption into an existing target rather than minting another learning identity.

**KEEP — the product and publication shell:** existing Outline/OCR/source authority; target-Chapter
physical resolution; `CHAPTER_PREPARE` jobs and durable lifecycle; persistence, ownership and
cascade; Reader state/progress and Section-grouped map; KP → source navigation; stable IDs at publish;
independent structural Review; deterministic final validation; and one Chapter-atomic publication.

**REBUILD — the semantic middle:**

```text
deterministic candidate/evidence units
→ one group-first AI partition per real Outline-subsection window
  (learning_targets with unit IDs + non_kp_units)
→ deterministic KP materialization
→ complete compact Chapter structural Review
→ existing deterministic validation and atomic publication
```

**SUPERSEDED:** LLM-first complete-KP generation; model-authored Section/page/line/geometry/source
references; packet-level `KEEP`/`MERGE`/`DROP`; deterministic character/count/numbering heuristics
that force semantic boundaries; multi-pass absorption/audit/cleanup/re-partition; Review-driven
repair/re-review; Review payloads that resend the whole Chapter OCR/layout body; and semantic repair
that regenerates a complete Section. No partial KP becomes visible during the replacement pipeline.

`IMPLEMENTATION_BLUEPRINT.md` §12.2, §12.4 and §22 carry the corresponding minimum Frozen amendment.
Two earlier research conclusions were outside this completed Phase and were later superseded by the
user-approved Product decision 69:

- same-concept durable-ID reconciliation, new-concept minting and ambiguous split/merge blocking;
- separation of published availability from replacement prepare-attempt lifecycle.

This completed Phase itself still wrote no Learning/Mastery state and exposed no READY regeneration.

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

- `docs/development-reports/FIRST_CHAPTER_KNOWLEDGE_MAP.md` — current implementation, repeated real-
  provider/UAT failure evidence, retained shell behavior, and the semantic middle now superseded by
  this accepted correction
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

**REQUIRED — completed after repeated UAT failure (2026-09-07).** The bounded research went beyond
README-level comparison: it inspected document-structure source/architecture and relevant issues/PRs
in Docling, PageIndex, MinerU, GROBID, Unstructured and Marker, plus DeepTutor PR 707's directly
analogous reasoning-token/structured-output truncation failure. The evidence that changed this Phase
was consistent:

- mature document systems establish typed blocks, hierarchy, reading order and source provenance
  deterministically or with bounded classifiers before semantic generation;
- PageIndex Flash's layout-built tree becoming the default (PR 404) and its deterministic merge plus
  bounded bottom-up enrichment (PR 373) are especially direct evidence against one large LLM-built
  structure;
- Docling, GROBID, Unstructured and MinerU's normalized intermediate structures keep geometry and
  document identity outside generative output;
- bounded windows, strict typed contracts, deterministic validation and same-input technical retry
  avoid making one malformed or length-limited response invalidate a whole long document.

The accepted borrowing is the architecture pattern only. No external code, dependency, model,
framework, document parser or storage technology is approved for adoption. If implementation finds
one necessary, stop and report under `AGENTS.md` §5.

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
- **Granularity is absorption-first.** A candidate becomes a separate learning target only when the
  current evidence supports an independently useful teaching, assessment, diagnosis and remediation
  path. Definitions, properties, ordinary steps, examples, different terminology, and brief items in
  one classification/composition/procedure/peer enumeration default to the same target. A heading or
  example alone never becomes a KP. Summary repetition does not mint a KP; FAQ and misconception
  material defaults to `non_kp_units` or absorption into a target. Distinct mechanisms, error modes
  or remediation paths may justify separation; merely being named or separately testable does not.
- **Evidence-unit authority is deterministic.** A minimal Phase-local builder derives ordered,
  bounded evidence units from the requested Chapter's existing Outline and OCR/layout evidence. The
  server assigns every unit its existing primary Section, deterministic order, continuous source
  evidence and pipeline-local unit ID. A model may neither mint a unit nor decide or alter its
  Section, page, line, geometry, source range or source revision (Implementation §12.2, §12.4).
- **AI makes one final group-first partition per real Outline subsection.** Each real subsection is
  one bounded semantic window. A Section lead-in outside its child subsections, or a Section with no
  child subsection, may form one separate deterministic fallback window. The AI output is only
  `learning_targets = [{unit_ids, title, one_sentence_meaning}]` plus `non_kp_units`; together they
  account for every supplied unit exactly once. AI may not emit complete KP records or any Section,
  page, line, geometry, range or source-revision field (Implementation §12.2).
- **The partition contract is strict.** Every learning target uses a non-empty contiguous run of
  supplied unit IDs inside one semantic window; every other supplied ID is a `non_kp_unit`.
  Invented, duplicate, missing, multiply consumed, non-adjacent or cross-Section references and
  invalid schema fail closed. The server never coerces them into a result. Facet/property/step/example
  evidence may remain inside a target's continuous evidence span without becoming a separate durable
  attachment or KP.
- **KP materialization is deterministic.** The server creates private candidate KPs from validated
  partitions and its unit ledger. Primary Section, order, source revision and the continuous range
  come only from the underlying unit mapping; AI supplies only learning semantics. One required
  window failing fails the private Chapter attempt, but no successful unrelated window is
  semantically regenerated as a side effect (Implementation §12.2–§12.4).
- **Ranges are evidence, not a text partition.** A published KP still has one continuous range
  inside its primary Section, but distinct KPs may share evidence when Review confirms independent
  learning value. Gaps are normal. Overlap is inspected as a duplicate/split warning and is never by
  itself a deterministic failure (Implementation §12.4).
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
- **Structural Review judges one complete but compact Chapter ledger.** It must check independently
  trackable granularity, coverage, duplicate semantics, instructional specificity, split/merge
  quality, source/Section faithfulness and map-level balance. Its ledger contains only the Chapter's
  real Section/unit order, complete partition accounting, candidate-to-unit membership,
  title/meaning, bounded deterministic evidence excerpts/fingerprints, overlap/warning metadata and
  required provenance. It does **not** resend the raw whole-Chapter OCR line stream, geometry dump or
  generator reasoning (Implementation §12.2, §12.4).
- **Review blocks defects, not optional polish.** All seven dimensions remain mandatory. A
  `BLOCKING` finding is reserved for a high-confidence defect that makes the map unpublishable from
  the supplied ledger: duplicated learning state, non-instructional/fabricated KP, major learnable
  omission, clearly wrong Section/source ownership, or a severe split/merge that creates meaningless
  independent states. Alternative naming, optional consolidation, mild imbalance and cases that the
  bounded excerpt cannot establish confidently are `WARNING`; remaining room for improvement alone
  is not a Chapter rejection.
- **Review judges once; it never repairs.** Review may return a verdict and typed findings only; it
  never authors or rewrites candidates. A valid FAIL ends the current preparation attempt, publishes
  nothing and triggers no semantic repair, regeneration or re-review. Findings should identify the
  implicated existing Section and smallest relevant unit-ID set so the failure remains actionable.
- **Technical retry is window/stage-local and semantics-neutral.** A provider, timeout, empty/
  length-limited response or invalid structured output may retry only the same semantic-window input
  under the same contract; it may not use the prior output as repair context. A technical Review
  failure may retry only the identical compact Review stage. Successful unrelated window partitions
  are not resent or regenerated. Technical failure never becomes PASS. Existing durable-job recovery
  and disposable-draft semantics remain; this Phase adds no generic checkpoint/workflow framework
  (Implementation §12.2, §13.5, §13.8, §18.4–§18.5).
- **Review context is fresh and allowlisted.** It may contain only the compact Chapter ledger just
  defined. It must not contain raw whole-Chapter OCR/layout payloads, other Chapters, Assistant trees
  or saved explanations, notes/highlights, Learning/Mastery/Progress, Master threads, Teaching
  assets, unrelated navigation state, generator reasoning, or secrets (Implementation §13.3,
  §21.2–§21.5).
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
- **Progress and failures are diagnosable without exposing content.** The Reader shows the current
  Chapter stage and minimum completed/total Section progress. Local bounded observability retains
  secret-free per-attempt route, timing, finish/usage/length metadata and typed failure, but never
  credentials, response bodies, reasoning text or partial KP content (Implementation §22).
- **Replacement was explicitly blocked in this completed Phase.** Product decision 69 and the later
  READY-regeneration Phase supersede that historical boundary without changing this Phase's result.
- **No learning or teaching writes.** This Phase writes no `KPStatus`, `SectionLearningState`,
  `LearningEvent`, Master thread/topic/message, Reading Guide, Inline Guidance, Recall, Progress,
  Mastery, ExamEvidence, or Teaching asset. Chapter publication may make future KP-dependent
  capabilities eligible; it must not infer or write their state.
- **No generic platform expansion.** Use the existing storage, AgentRuntime, provider boundary, and
  durable job substrate. The V1 evidence-unit and semantic-window builder is local to this Chapter-map
  pipeline; they must not become a generic document framework. Do not introduce a generic workflow/
  state-machine system, RAG layer, vector store, knowledge graph, new storage technology, or second
  job framework.

## Build

- The minimum Reader affordance to request/open one Chapter's Knowledge Map and show honest
  `NOT_PREPARED`, `PREPARING`, `READY`, and `FAILED` semantics (exact internal names and Simplified
  Chinese wording are implementation loose edges).
- Target-Chapter-only physical matching/resolution sufficient to validate the Chapter and its child
  Section/Subsection source ranges, without changing their logical identities.
- The corrected one-Chapter pipeline: deterministic source projection/evidence-unit construction →
  one bounded group-first semantic partition per real Outline subsection → deterministic private KP
  materialization → complete compact Chapter ledger → deterministic prechecks → one independent
  Chapter structural Review gate → final deterministic validation → existing atomic publication.
- The smallest real-book evidence-unit builder needed by this Chapter: deterministic unit IDs,
  Section ownership/order, source evidence mapping and bounded semantic windows, without a new generic
  parser, document model or framework.
- Durable Chapter preparation state, published structure version, stable KnowledgePoint identity,
  source-revision ownership, ranges, semantic/reviewer provenance, and correct book-delete cascade.
- A user-visible `READY` map grouped by primary Section, with the minimum useful KP presentation and
  a KP → textbook navigation action that returns to the real source range.
- Honest failure presentation, explicit retry, duplicate-request convergence, worker/service restart
  recovery, and preservation/reopen of the published map.
- Minimum Section progress UI plus retained, bounded, secret-safe semantic/Review attempt observability
  needed to diagnose latency/`empty_response` and prove scope, Review routing, failure semantics and
  secret hygiene. Progress never includes draft KP content.

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
  new UI design system; adoption of Docling, PageIndex, MinerU, GROBID, Unstructured, Marker or any
  other external document framework/dependency.
- LLM-authored document hierarchy, Section/page/line/geometry/source ranges, whole-Chapter OCR Review
  payloads, complete-Section semantic regeneration, or persistent partial candidate publication.
- READY-map regeneration, durable-ID reconciliation/migration, split/merge migration, immutable
  replacement-version publication, and availability/attempt lifecycle separation. These are not
  optional debt: they are `REQUIRED_BEFORE_MASTERY_OR_FIRST_REGENERATION`, deliberately outside this
  first-publication UAT rework.
- OpenRouter proxy/region work or the default Assistant-provider decision.
- This list is not a future construction order. After closure, the next slice is re-adjudicated from
  the actual product state under `AGENTS.md` §7.

## Acceptance

### TARGETED

With deterministic semantic/Review doubles, fault injection, and a real database where persistence
is under test:

1. One requested Chapter transitions honestly through not-prepared/preparing to one atomic `READY`
   publication; no sibling Chapter is prepared or physically changed.
2. Target-Chapter physical matching preserves every logical Outline node's identity, title, order,
   hierarchy and ownership while advancing only necessary physical evidence.
3. The deterministic builder produces a complete ordered evidence-unit ledger for the in-scope
   Sections. Every unit ID resolves server-side to exactly one existing primary Section, source
   revision, continuous source span and deterministic order; repeated construction from unchanged
   authority is equivalent.
4. The semantic transport contains only one real Outline-subsection window (or one explicitly
   defined Section fallback window) and declared context. Its accepted output is only
   `learning_targets = [{unit_ids, title, one_sentence_meaning}]` and `non_kp_units`; it contains no
   model-authored Section/page/line/geometry/range or source-revision fields.
5. Contract validation rejects invented, duplicate, missing or multiply-consumed unit IDs,
   non-contiguous targets, cross-window/Section references and invalid schema. It never silently
   repairs, truncates or partially accepts a length-limited/invalid semantic response.
6. Deterministic materialization derives each candidate's primary Section, order, source revision
   and continuous range from its validated contiguous target units. AI title/meaning cannot change
   source authority. Every published KP satisfies the corresponding Chapter/Section boundaries.
7. Draft unit/candidate IDs are never durable or user-visible. Stable KP IDs and one structure
   version appear only inside the existing atomic publication transaction.
8. The Review transport is one complete compact Chapter ledger with candidate-to-unit membership,
   full partition accounting, bounded deterministic evidence excerpts/fingerprints and warnings. It
   excludes the raw whole-Chapter OCR line stream, geometry dump, generator context/reasoning and all
   undeclared state; canaries prove both semantic and Review allowlists and secret hygiene.
9. Adversarial ledgers prove structural Review rejects high-confidence semantic duplicates, generic reasoning/test-
   taking labels, unjustified splitting/merging, major learning-coverage omissions and materially
   unbalanced Section granularity. Borderline optimization remains a warning. Review judges the
   complete Chapter but cannot rewrite content.
10. A valid Review FAIL is terminal for the preparation attempt, publishes nothing and invokes no
    semantic repair, regeneration or re-review. Actionable findings name the implicated valid Section
    and smallest relevant unit-ID set but grant no authoring authority.
11. Every real Outline-subsection window receives one logical semantic partition. A bounded technical
    retry uses the exact same evidence and contract, receives no prior semantic result or Review
    finding as input, and cannot become absorption, cleanup, audit, repair or re-partition.
12. A transient provider error, timeout, `empty_response`, `finish_reason=length` or invalid structured
    output retries only the same current semantic window; a technical Review failure retries only the
    identical compact Review stage. Already-successful unrelated windows are not resent, and
    technical failure never becomes PASS.
13. Generation, materialization, semantic Review, technical Review, deterministic validation and
    publication failures each remain non-READY and expose no partial KP set. A failed candidate cannot
    overwrite an existing published version.
14. The actual semantic/reviewer provider/model route, window/stage and typed failure are recorded
    honestly, together with bounded actionable Review finding detail; silent fallback and
    invocation-failure-as-PASS are impossible.
15. Duplicate click, HTTP retry, response-loss replay, concurrent prepare calls, worker interruption,
    service restart and explicit retry converge without duplicate preparations, versions or KPs.
16. `FAILED`/`PREPARING` preparation leaves reading, OCR selection/copy, Find, Outline, Marks,
    Notes/Highlights and Assistant usable.
17. The Section-grouped map and KP → textbook action resolve through the published KP's deterministic
    source range and source revision, not through AI wording.
18. Migration/upgrade preserves existing Book, BookSourceRevision, Outline, USER Annotation and
    AI_SAVED Annotation identity, ownership, anchors, content, restart recovery and deletion
    semantics.
19. Book deletion removes the owning Chapter preparation/map/KPs without cross-book effects, and
    retrying or deleting a book cannot leave user-visible orphan maps.
20. Preparation, publication, Review, failure, retry and navigation perform zero writes to Learning,
    Mastery, Progress, Master, Teaching and ExamEvidence state.
21. AI-off and missing generator/reviewer credentials keep the Reader usable and never fabricate
    `READY`.
22. Two distinct KPs may pass with overlapping source evidence after Review, while a paraphrase
    duplicate using that overlap fails Review. Unmapped source gaps pass deterministic validation.
23. During a delayed multi-Section run, the served Reader shows the existing honest stage and
    completed/total Section count without titles/meanings/ranges. Every semantic/Review attempt
    records bounded provider/model, Section/window or stage, attempt, timing, finish reason where
    supplied, usage, content/reasoning presence and lengths, and typed outcome; credentials and
    response/reasoning bodies are absent.
24. A `READY` prepare request remains a no-op: no first regeneration or Learning/Mastery write is
    enabled by this correction.

### AGENT REAL-USE GOLDEN PATH

Use the real 348-page textbook through the actually served UI with real pointer/keyboard interaction.
Prefer an unprepared Chapter 6 and:

1. open/select a Section in that Chapter and observe the existing honest not-prepared state;
2. request its Knowledge Map and observe preparing state without losing Reader interaction;
3. inspect the deterministic evidence-unit ledger and prove that only Chapter 6 and its necessary
   child ranges are processed, with Section ownership/ranges coming from Outline/OCR rather than AI;
4. complete one real bounded semantic + reviewer path through the same production-default route a
   normal user action selects when that authorized configured route is available; a test-only
   provider override does not substitute. Record actual providers/models, window count/size,
   timing/token evidence, Section progress and final allowlisted payload shapes;
5. inspect model results and prove they contain only the final group-first learning-target/non-KP
   partition plus short title/meaning; inspect the compact Review ledger and prove it does not resend
   the raw whole-Chapter OCR/geometry body;
6. exercise one bounded `empty_response`, `finish_reason=length` or invalid-output failure on one
   semantic window; verify only the identical window input/contract retries, successful unrelated
   windows are not resent, per-attempt safe diagnostics remain, no prior semantic output becomes
   repair context, no draft content appears, and the Reader remains usable;
7. exercise one valid blocking Review finding addressed to a real Section/unit-ID set; verify the
   attempt ends as failed, publishes nothing and performs no semantic regeneration or re-review;
8. observe the map appear atomically only after Review and validation PASS, grouped by primary
   Section with no partial KP set visible beforehand;
9. inspect representative materialized KPs and absorbed facet/example evidence, then use KP →
   textbook navigation to return to the exact deterministic source positions/ranges;
10. close and reopen the Reader, restart the service, and recover the same published structure
    version and stable KP identities;
11. retry/replay one user action and prove convergence to one map with no duplicate KPs/version;
12. delete the book and verify the map/KPs cascade correctly without affecting another book;
13. inspect persistence and prove zero Learning/Mastery/Master/Teaching/ExamEvidence writes.

The golden path must contain at least one reversal/recovery: failure → retry or close/restart →
reopen. Missing authorized external credentials is reported honestly; it never becomes Review PASS
or full real-review acceptance.

### AFFECTED REGRESSION

Run suites and served smoke paths that share the changed risk surface:

- Map the Book logical identity, hierarchy, target navigation, per-node physical resolution, restart,
  and book cascade;
- progressive OCR/layout preparation and source geometry consumed by target-Chapter resolution;
- deterministic evidence-unit construction, one-pass semantic-window contracts, deterministic KP
  materialization, compact Chapter Review, terminal Review failure and atomic publication;
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
helpers, the local deterministic unit/window-building algorithm, use of the existing job/
provider/storage abstractions, exact Simplified Chinese wording and control placement, ordinary error
handling and CSS, test organization, and small local refactors need no approval when they preserve
this brief's authority and boundaries.

## Must report before proceeding

Stop and report if:

- reliable preparation would require changing Outline logical identity or preparing beyond the one
  requested Chapter;
- trustworthy deterministic evidence units or KP source ranges cannot be established from the
  available real-book evidence without giving source authority back to AI;
- a bounded semantic window cannot retain enough learning meaning without a generic document
  framework, a new parser/runtime or whole-Chapter generative context;
- a Frozen rule conflicts with this brief or Acceptance requires Learning, Master, Guide, Teaching,
  whole-book Pass 2, whole-book KP preparation, or another excluded capability;
- durable identity, migration, ownership, cascade, structure protection, or publication authority
  would need semantics beyond the first-publication rules and the explicit
  `REQUIRED_BEFORE_MASTERY_OR_FIRST_REGENERATION` boundary now frozen;
- implementation would adopt substantive external code, a major/core dependency, new storage/job/
  workflow infrastructure, RAG, vector retrieval, or a knowledge graph;
- the real textbook or authorized provider credential required for a named real-use check is missing.

Report the concrete problem, 1–3 options, recommendation, and main tradeoff; never expand scope or
turn missing Review evidence into PASS.

## Completion

- Complete and report TARGETED, AGENT REAL-USE GOLDEN PATH, AFFECTED REGRESSION, and the required
  CLOSURE / BROAD suite in that order.
- Obtain an **independent narrow review** before closure. It must attack migration/data preservation,
  KP durable identity and ownership, evidence-unit/source-range authority, Outline logical-identity
  preservation, the group-first AI output allowlist, same-window/contiguous target enforcement,
  deterministic materialization, compact Review-ledger allowlist, terminal Review-failure behavior,
  same-input window/stage-local technical retry, draft/stable identity, atomic publication,
  idempotency/recovery, cascade,
  credential/egress isolation, failure-never-PASS, zero Learning/Mastery/Master/Teaching writes, and
  compatibility with future structure-lock authority.
- Complete user real-use acceptance, write the concise development report in
  `docs/development-reports/`, and create at least one clean implementation checkpoint commit.
- If the real 348-page path or required authorized real provider/Review call cannot be completed,
  report `IMPLEMENTATION_READY` and `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` with the exact missing
  evidence; do not claim closure or PASS.
