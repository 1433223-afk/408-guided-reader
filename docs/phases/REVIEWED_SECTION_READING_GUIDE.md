# Phase / Reviewed Section Reading Guide

> **Status: CLOSED / COMPLETE — USER_ACCEPTANCE PASS; independent narrow acceptance PASS (2026-09-12).**

The user explicitly accepted the current Reading Guide on 2026-09-12 and requested closure only.
Independent narrow acceptance: P0=0 / P1=0 / P2=0, recommendation CLOSE; broad and real-book
regression passed. Accepted product baseline is `0eb18fb`; no product behavior changes in closure.
See the [Development Report](../development-reports/REVIEWED_SECTION_READING_GUIDE.md) and
[independent audit](../development-reports/REVIEWED_SECTION_READING_GUIDE_INDEPENDENT_REVIEW.md).
Earlier UAT failures and intermediate retest states are superseded by this explicit user PASS.

## Goal

Turn one real resolved Section into a concise, source-linked Reading Guide that helps the learner
understand why the Section’s knowledge is needed and how its ideas connect. Generation, independent Review,
durable publication and safe regeneration form one vertical slice.

## User-visible result

> “我可以为正在阅读的一个真实节生成简明导读，按其中的教材来源回跳阅读；关闭并重启后导读仍在，而且只有通过独立 AI 审查的完整版本才会发布。”

## Authority to read

- Product Blueprint §§17–23, 30.1–30.2, 33.1–33.2, and 36–38.
- Implementation Blueprint §§13, 17–23, and §24 Phase R7.
- `docs/development-reports/LEARN_ONE_KP_WITH_MASTER.md` for the current real Section, published-KP,
  Reader navigation, persistent learning-state and provider/Review baseline.

Nothing else from either Blueprint is required for this Phase.

## Accepted UAT amendment — 2026-09-10

User rejected the checklist product form and accepted the continuous-article and split-reader design.
This supersedes the prior route/exit and one-page list-style acceptance. No PDF Inline Guidance.
Prior-art: Split.js README, react-resizable-panels README, and W3C APG Window Splitter guidance;
borrow min-size constraints, resize handles, restore proportions and keyboard interaction patterns only.
No copied external implementation or new dependency.

## Accepted transient-streaming amendment — 2026-09-16

The user explicitly reopened this narrow slice and approved displaying the real Writer stream before
Review as a clearly labelled temporary draft. The draft and structured candidate are process-memory
only: they are not persisted, cannot advance the published pointer, cannot enter Assistant or source
authority, and disappear on terminal failure. Review PASS remains the sole publication gate.
Deterministic non-body evidence removal, local source binding and candidate-cited Review/rework
projections are authorized latency reductions. They do not introduce RAG/vector storage, expand
context, mint sources or weaken Review. This amendment awaits user retest; it does not revise the
historical 2026-09-12 acceptance claim for the earlier baseline into acceptance of this new behavior.

## Prior-art check

**REQUIRED — completed.** Section-level teaching generation and source-grounded long-document output
are mature problem domains. The bounded research inspected source, architecture and change history in:

- [DeepTutor](https://github.com/HKUDS/DeepTutor), Apache-2.0 — especially its Section writer and
  prompt structure, Reading Extensions, [PR 1032](https://github.com/HKUDS/DeepTutor/pull/1032),
  [issue 1352](https://github.com/HKUDS/DeepTutor/issues/1352), and
  [issue 673](https://github.com/HKUDS/DeepTutor/issues/673) /
  [PR 675](https://github.com/HKUDS/DeepTutor/pull/675).
- [STORM](https://github.com/stanford-oval/storm), MIT — its
  [outline generation](https://github.com/stanford-oval/storm/blob/main/knowledge_storm/storm_wiki/modules/outline_generation.py),
  [article/Section generation](https://github.com/stanford-oval/storm/blob/main/knowledge_storm/storm_wiki/modules/article_generation.py),
  [issue 168](https://github.com/stanford-oval/storm/issues/168), and
  [PR 443](https://github.com/stanford-oval/storm/pull/443).
- [OpenStax Tutor tasked reading](https://github.com/openstax/tutor-server/blob/main/app/subsystems/tasks/models/tasked_reading.rb),
  which binds a reading task to a real source-owned unit.

Borrow the bounded patterns: one Section per generation unit, deterministic server-owned evidence
IDs and locator resolution, explicit input/output budgets, deterministic reference validation,
generation/Review separation, and no visible failure placeholder. Do not borrow DeepTutor's
BookEngine/RAG/extensions runtime, STORM's web-research or multi-agent pipeline, parallel subsection
writing for this concise asset, silent JSON coercion, or an unreviewed fallback. No external code,
framework or new dependency is adopted.

## Hard rules

- A Guide belongs to one real resolved Section. One generation request may use only that Section's
  physical source scope; it must not become a Chapter or whole-book generation job.
- Opening or navigating to the Section and reading the original PDF never waits for Guide AI,
  credentials, Review or job readiness. Generation is an explicit user action; AI-off/original-only
  use remains available.
- A Guide is concise macro reading scaffolding, not a rewritten textbook or a long Section summary.
  Write a continuous article around its core problem. Problem → limitations → new knowledge is a
  writing approach, never a fixed template. No exit criteria or per-KP checklist. Pitfalls, conceptual
  emphasis and thinking prompts may support the narrative without dominating it.
- Build the generation packet deterministically from the Section identity/title and resolved physical
  range, real PDF/OCR evidence, necessary parent positioning, and optionally the owning Chapter's
  `READY` Section KP ledger. Do not send KP status, Master history, notes/highlights, Assistant state,
  learner profile, unrelated Sections, other learning history or secrets.
- A Guide is not KP-dependent. It may be generated before Chapter KP reaches `READY`; in that case it
  must not claim or record a `chapter_structure_version`. If a `READY` KP ledger is actually supplied
  to generation, persist that exact dependency and version.
- The model may cite only deterministic source IDs supplied by the server. It must not author PDF page
  numbers, quote authority, geometry, Section ownership, physical ranges or jump targets; the server
  validates every cited ID and resolves the final source link.
- The normal path is one direct strong-model generation call for the bounded Section. Do not add a
  planner, multi-agent pipeline, RAG, map-reduce, generic workflow/state-machine framework or
  whole-Section regeneration loop.
- Do not publish unsupported exam-weight claims. Without inspectable evidence, omit claims such as
  `重点`, `高频` or `常考`; do not build ExamEvidence or past-exam retrieval in this Phase.
- Deterministic contract/source validation runs before mandatory independent Review. Review receives
  fresh allowlisted evidence and the candidate Guide, not generator reasoning or unrelated state;
  Review judges and never rewrites the asset.
- A semantic rejection may trigger only a targeted bounded rework identified by the rejected Guide
  content/evidence, for at most three completed semantic cycles. Technical generation or Review
  failure retries only the current request/stage, does not consume the semantic-rework count, and
  never becomes PASS.
- Only a complete `PUBLISHED` Guide that passed independent Review is user-visible as accepted Guide
  content. A real Writer stream may be visible beforehand only as the explicitly labelled,
  process-memory-only draft defined by the 2026-09-16 amendment. Never persist that preview, expose
  it to Assistant/source authority, or present partial output, a failed placeholder, an unreviewed
  fallback, silently coerced output, or a technical/reviewer failure as success.
- Persist the Guide's durable identity, actual dependency set and versions, lifecycle state, and
  actual generator/reviewer provider metadata. Failure is Section-local and cannot invalidate another
  Section's Guide or block ordinary reading.
- Regeneration is explicit. The prior published version remains readable throughout regeneration and
  after any failure; the replacement becomes current only through atomic publication after Review
  PASS. Staleness is determined only by dependencies the published Guide actually used.
- Guide text remains selectable and can use the existing Assistant explanation behavior without
  turning the Guide into PDF source authority or persistent Assistant history.
- New user-visible UI is Simplified Chinese. Ownership, restart recovery and book-deletion cascade
  cover every durable Guide version without affecting another book.

## Build

- The minimum Section-level affordance to generate, open, close, retry and explicitly regenerate its
  Reading Guide, with honest generation/Review/failure state outside the published Guide content.
- A minimal deterministic Section evidence packet and source-ID ledger, including optional use of an
  already-`READY` Section KP ledger without making KP readiness a gate.
- One bounded strong-model Guide generation contract, deterministic validation, mandatory independent
  Review, bounded semantic rework and stage-local technical retry.
- Durable Section Guide identity, dependency/version/provider metadata, recovery, scoped staleness,
  ownership/cascade and atomic first publication/replacement using the existing job and persistence
  architecture.
- A continuous Section article with natural headings and validated internal source identities. The
  Reader renders only a light unnumbered `查看教材位置` action, not `[1][2]…` markers.
  PDF + Guide columns have a draggable divider and expand/restore/collapse controls. PDF remains
  visible; source jumps and layout changes preserve the Guide reading position. No new dependency
  or generic layout system. Text remains available to the existing selection-to-Assistant path.

## Not now

- Inline Guidance or `✦` anchors; Recall, Active Retrieval, quiz or assessment.
- Automatic generation when a Section opens; whole-Chapter or whole-book Guides.
- Mastery personalization, KPStatus/Profile/Memory input, learner modelling or global learning state.
- ExamEvidence, past-exam RAG, frequency statistics or unsupported exam-weight language.
- Vision, figure/formula understanding, OCR/formula correction, generic RAG or a vector database.
- A Guide editor, collaborative authoring, persistent Assistant history, or overall
  Reader/Assistant visual redesign.
- Any deferred debt or UI polish unrelated to making this Guide slice complete.

## Acceptance

### Targeted

1. Generation resolves exactly one real Section and includes only its deterministic physical source
   evidence and necessary parent positioning; another Section's content cannot enter the packet.
2. A Guide can generate before Chapter KP is `READY`. No KP ledger means no claimed or persisted
   `chapter_structure_version`; when a `READY` ledger is actually used, the exact dependency is
   recorded and participates in staleness.
3. The model can cite only supplied source IDs. Unknown/foreign IDs, model-authored locators,
   unsupported quotations and unsupported exam-weight claims fail deterministic validation and are
   never published; valid links resolve server-side to the correct PDF evidence.
4. Provider and Review payload inspection proves that no unrelated Section, KPStatus, Master history,
   notes/highlights, Assistant state, profile, other learning state or secret leaves the machine.
5. Independent Review is mandatory. Review gets fresh allowlisted context, cannot rewrite the Guide,
   and semantic FAIL, invalid verdict, timeout, unavailable reviewer or exhausted technical retry is
   never PASS.
6. Semantic rework stops after at most three completed cycles. Technical failure retries only its
   current stage and does not consume that count; terminal failure remains honestly failed.
7. Partial, invalid, failed and unreviewed candidates never become visible as accepted Guide content.
   The only pre-Review exception is the labelled memory-only stream: it is absent from storage and
   Assistant/source authority, disappears on failure, and never changes the published pointer.
   Duplicate clicks, HTTP retry and response-loss replay create at most one logical job/version/publication.
8. First publication and replacement are atomic. During regeneration the old Guide remains visible;
   failed or in-progress regeneration cannot overwrite it, and only a fully reviewed replacement
   becomes current.
9. Persisted identity, actual dependencies, state and provider metadata recover after service restart.
   Staleness reacts only to a dependency that version actually declared; ownership and book-delete
   cascade remove the correct Guide records without touching another book.
10. AI-off and provider failure do not block Section/PDF reading. Section-local Guide failure does not
    affect another Section, Knowledge Map, Master, Assistant or Annotation state.
11. Selecting Guide text can open the existing Assistant explanation flow without mutating the Guide,
    fabricating a PDF quote/anchor, persisting Assistant history, or writing Mastery/Learning state.

### Agent real-use golden path

Using the real 348-page textbook:

1. Open one resolved Section whose Chapter KP is `READY`, explicitly generate a Guide, observe real
   Writer deltas followed by `生成草稿 · 审查中`, and inspect actual generation and Review payload
   boundaries plus TTFT/latency. Confirm no candidate content is persisted before Review PASS.
2. Verify the real 2.1 Guide opens with the motivating problem and connects ideas in continuous prose,
   without exit criteria, KP enumeration or a fixed template. Exercise drag, expand, restore, collapse
   and reopen; PDF remains visible and the Guide reading position is retained across source jumps.
3. Follow its source links and confirm each returns to the correct real PDF evidence; select one Guide
   phrase and open the existing Assistant explanation flow.
4. Close the Guide, navigate away, close the Reader, restart the service, return, and recover the same
   published Guide and source navigation.
5. Exercise a generation or Review failure and retry. During explicit regeneration, verify the old
   published Guide stays available and a failed candidate never replaces it; then complete one
   reviewed atomic replacement without duplication.
6. Generate a Guide for a Section whose Chapter KP is not `READY`, prove the Guide remains useful, and
   verify that no `chapter_structure_version` was sent, claimed or persisted.

The path must include at least one close/restart recovery and one failure/regeneration reversal.

### Affected regression

- Outline physical Section resolution and Section/PDF navigation.
- Foundation/OCR source packet authority and optional published-KP dependency handling.
- Existing jobs, recovery, idempotency, atomic publication and book cascade.
- Provider routing, independent Review, payload inspection, logging and secret hygiene.
- Reader selection/Assistant behavior, plus Master/Learning and Annotation isolation.

### Closure / broad

**BROAD SUITE REQUIRED before closure** because this Phase crosses persistent Teaching identity,
source-of-truth links, Review-gated publication, scoped staleness, atomic replacement, deletion cascade
and external AI egress. Run targeted → agent real-use golden path → affected regression → closure broad
suite; do not run the full suite after every edit.

## Autonomy

Ordinary naming, file/component layout, helper placement, local algorithms, conventional schema and
endpoint details, error wording, CSS, test organization and small local refactors are delegated. The
Implementer may choose the smallest mechanisms within the existing architecture that satisfy this
brief; no separate approval is needed for those loose edges.

## Must report before proceeding

Stop and report if implementation would change Section/PDF source authority, persistent Teaching
identity or ownership, dependency/staleness meaning, Review publication semantics, regeneration or
cascade authority, or AI egress boundaries; require a major dependency or substantial external code;
expand into RAG, a generic document/workflow system or a broader Teacher pipeline; conflict with the
Frozen Core; or lack the real textbook/provider input required for the accepted real-use path.

## Completion

Complete targeted tests, the real 348-page golden path, affected regression and the broad closure
suite; record honest evidence in a concise Development Report and create a clean checkpoint. An
independent narrow review is required before closure and must attack persistent Guide identity,
source-ID/locator authority, actual dependency recording and staleness, Review-gated publication,
semantic/technical retry separation, atomic replacement, ownership/cascade, and egress/secret
isolation. User acceptance, independent acceptance and Phase closure are separate gates; all were
satisfied on 2026-09-12. The earlier implementation stop at `READY_FOR_USER_RETEST` is complete.

## Accepted content direction / live activation — 2026-09-11

The user accepted the current KP-based Guide content direction and requested activation for hands-on
Reader generation; further prose/detail refinement is deferred. Fresh author input uses chapter
positioning and current published Section KP titles/one-sentence meanings, not OCR body or exercises.
Existing source-aware formatting, independent Review and atomic publication remain mandatory. The
previously generated sample is not imported as a published Guide. Overall Phase/user-flow acceptance
was subsequently explicitly reported PASS by the user on 2026-09-12. Content, context and UI are
accepted as implemented; further refinement remains deferred and is not part of closure.
