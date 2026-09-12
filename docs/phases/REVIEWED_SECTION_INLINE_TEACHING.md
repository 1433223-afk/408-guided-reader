# Phase / Reviewed Section Inline Teaching

> **Status: CLOSED / COMPLETE — 2026-09-12.**
> User acceptance PASS explicitly reported by the user; independent narrow review PASS (P0/P1/P2=0), recommendation CLOSE.

## Goal

Complete the first Section Teacher loop inside the real PDF: add sparse, source-anchored `✦`
Guidance and occasional lightweight Recall exactly where they materially help, while keeping all
generation optional, independently reviewed and safely replaceable.

This is one vertical slice. Generation, deterministic anchoring, Review, durable publication,
Reader presentation, Recall interaction and regeneration must not be split into later Phases.

## User-visible result

> “我可以为当前一节开启行间教学，在少数真正需要老师补充的位置看到 `✦`；点开能读到简短引导或做一次不计分的回忆，自由关闭后仍可只读原 PDF，重启后已发布内容仍在。”

## Authority to read

- Product Blueprint §§2–3, 6.1–6.2, 7.1–7.1.1, 9.1–9.3, 17–20, 22–24.5,
  30.1–30.2, 30.6, 32–34, and 36–38.
- Implementation Blueprint §§4.1–4.4, 5.3–5.4, 7.2–7.5, 8.1–8.4, 8.7,
  13, 14.11, 17–23, and §24 Phase R7.
- `docs/development-reports/REVIEWED_SECTION_READING_GUIDE.md` for the current Teaching lifecycle,
  Section evidence, provider/Review, atomic publication, split Reader and real-book baseline.

Nothing else from either Blueprint is required for this Phase.

## Prior-art check

**REQUIRED — completed.** PDF anchoring, document decorations and source-grounded learning prompts
are mature problem domains. The bounded check inspected source plus relevant issues/PRs in:

- [DeepTutor Reading Extensions](https://github.com/HKUDS/DeepTutor/blob/main/READING_EXTENSIONS.md),
  Apache-2.0 — especially
  [study guidance](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/reading/study_guidance.py),
  [quiz](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/reading/quiz.py),
  [issue 1105](https://github.com/HKUDS/DeepTutor/issues/1105) /
  [PR 1106](https://github.com/HKUDS/DeepTutor/pull/1106), and
  [issue 1114](https://github.com/HKUDS/DeepTutor/issues/1114) /
  [PR 1115](https://github.com/HKUDS/DeepTutor/pull/1115).
- [Hypothesis PDF anchoring](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/pdf.ts),
  BSD-2-Clause — especially [issue 3720](https://github.com/hypothesis/client/issues/3720),
  [issue 7571](https://github.com/hypothesis/client/issues/7571),
  [PR 6964](https://github.com/hypothesis/client/pull/6964),
  [PR 6968](https://github.com/hypothesis/client/pull/6968), and
  [PR 7018](https://github.com/hypothesis/client/pull/7018).
- [Readium Kotlin Toolkit DecorationController](https://github.com/readium/kotlin-toolkit/blob/develop/readium/navigators/common/src/main/java/org/readium/navigator/common/DecorationController.kt),
  BSD-3-Clause — plus [PDF Decoration issue 823](https://github.com/readium/kotlin-toolkit/issues/823)
  and [PR 721](https://github.com/readium/kotlin-toolkit/pull/721).

Borrow the bounded patterns: server-resolved source context, strict small output, evidence validation,
stable decoration identity separate from visual style, normalized page-relative placement and local
failure isolation. Hypothesis issue 7571 confirms that fuzzy quote matching may silently re-anchor to
the wrong repeated text, so geometry/source identity remains authoritative and unresolved anchors
fail closed. Do not borrow a plugin SDK, annotation/decoration framework, quiz platform, fuzzy
re-anchoring implementation or substantive external code. No new dependency is adopted.

## Hard rules

- One request covers at most one real `RESOLVED` Section. Section/PDF navigation and original reading
  never wait for Inline Teaching, provider readiness, Review or Chapter KP readiness.
- Generation is explicit and the visible layer has a direct user-controlled On/Off path. Turning it
  off hides AI intervention without deleting the published asset, changing learning state or hiding
  the PDF.
- Guidance is sparse. There is no quota per page, KP, paragraph or Section; any KP may have zero, one
  or several interventions, and a Section may honestly produce none. Never fill space to satisfy a
  template.
- V1 targets only reliably resolved OCR text lines and headings. Figure/table/formula interpretation
  is not pulled in merely because Product §22 permits it later.
- Build a fresh bounded packet from current Section identity/range and server-owned OCR evidence IDs,
  plus only necessary parent positioning. A published KP ledger may be included only when it is
  actually useful; without it, generation proceeds and records no `chapter_structure_version`.
- Do not send Reading Guide prose, KPStatus, Section learning state, Master threads/history,
  Assistant state, notes/highlights, learner profile, User Learning Memory, unrelated Sections or
  secrets. Guide existence is not a prerequisite or hidden generation authority.
- In the normal path, one direct strong-model generation call returns a small set of Guidance items.
  The model may choose a supplied source ID, pedagogical intent, short text, and optionally a Recall
  prompt/reference thought. Do not add a planner, formatter/writer chain, per-KP calls, map-reduce,
  RAG, multi-agent generation or a generic workflow/state-machine framework.
- The model must not author PDF pages, quote authority, geometry, physical ranges, Section ownership,
  final screen coordinates or jump targets. The server validates cited IDs and resolves the durable
  page geometry, quote/fingerprint and foundation version. Invalid, foreign, stale or ambiguous
  targets are omitted/rejected rather than guessed.
- System chooses the semantic target and intent; deterministic Reader code chooses final visual
  placement. `✦` and opened Guidance must not cover PDF text or collide with existing KP/Section
  learning controls. Zoom, resize, virtualization and Guide/Dock state cannot change source authority.
- Recall is an occasional Inline Guidance role within this same reviewed Section result, not a new
  quiz/assessment system. It is grounded only in material at or before its display point and offers a
  lightweight think-then-reveal interaction. Answering, revealing, skipping or closing writes no
  score, attempt, KPStatus, Section state, Mastery or Learning History.
- Deterministic contract/source checks run before mandatory independent Review. Review receives the
  candidate plus fresh allowlisted evidence, never generator reasoning or user learning state; it
  judges and never rewrites.
- Semantic rework is bounded to three completed cycles for a candidate. Technical failure retries
  only its current stage, consumes no semantic cycle and never becomes PASS.
- Only a complete independently reviewed `PUBLISHED` Section result may display Guidance/Recall.
  Partial, failed, invalid and unreviewed candidates never leak through `✦`, APIs or fallback UI.
- Publication and replacement are Section-atomic. Explicit regeneration leaves the old published
  result visible until a reviewed replacement commits; in-progress or failed work never erases it.
  Staleness follows only dependencies the asset actually used.
- Guidance text remains selectable. Explaining it creates a new Assistant Root with its Teaching
  source lineage; it does not fabricate a PDF selection, persist Assistant history or write Mastery.
- Extend Teaching persistence additively and preserve all existing Reading Guides, jobs, ownership,
  versions and current publication pointers. Book deletion cascades only through the owning book.
- All new user-visible UI is Simplified Chinese.

## Build

- The minimum Section-level controls to explicitly generate/regenerate Inline Teaching and to show or
  hide its published `✦` layer without affecting Guide or PDF availability.
- A bounded deterministic text/heading evidence packet and server-side target resolver using the
  existing Section/OCR source authority and optional actual KP dependency.
- One direct structured generation contract for sparse lead-in, bridge, warning, implicit-connection
  and occasional Recall interventions; deterministic validation, mandatory independent Review,
  bounded semantic rework and stage-local technical retry.
- The smallest additive Teaching persistence change for the new reviewed Section asset, including
  durable anchors, lifecycle/provider/dependency metadata, idempotency, restart recovery, scoped
  staleness, ownership/cascade and atomic replacement.
- Reader `✦` placement tied to real page geometry, a compact operable Guidance/Recall surface,
  think-then-reveal behavior, source navigation, collision-safe layout, and selection-to-Assistant.

## Not now

- User Learning Memory, automatic extraction from Master/Assistant, cross-session memory retrieval,
  vector search or a generic user knowledge-base framework. This remains a priority candidate for a
  later Planner adjudication after its capture, provenance, correction, deletion and Agent-access
  semantics are explicitly decided.
- Full quiz, grading, saved attempts, assessment, rewards, wrong-question flow, spaced repetition or
  any Recall-to-Mastery inference.
- Personalizing System Teaching from KPStatus, Progress, Master history, Assistant history, notes,
  profile or future Memory.
- Figure/table Guidance, Vision, formula understanding, persistent formula objects or layout-detector
  adoption.
- Automatic generation on Section open; Chapter/whole-book batch Teaching.
- Reading Guide content/regeneration changes, Guide/Reader/Assistant redesign, persistent Assistant
  history or a new UI design system.
- ExamEvidence/past-exam RAG, generic RAG/vector DB, Streaming, OCR/formula correction and unrelated
  debt or polish.

## Acceptance

### Targeted

1. Only one real resolved Section can generate a candidate. Unresolved/foreign Section input fails
   before provider invocation while PDF reading remains available.
2. Final generator and Review payloads contain only declared current-Section evidence, necessary
   positioning and any actually used READY KP ledger; no Guide prose, user learning/annotation state,
   unrelated Section or secret crosses the boundary.
3. Generation works without READY KP and records no false `chapter_structure_version`. When KP data
   is actually used, its exact version is persisted and participates in staleness.
4. The normal successful path uses one generation call plus mandatory independent Review. Output is
   bounded and sparse; there is no forced item per page/KP and a valid no-intervention result is
   distinguishable from failure.
5. Every displayed item cites supplied current-Section source IDs. Server-derived page, normalized
   geometry, quote/fingerprint and foundation version round-trip exactly; model-authored/foreign/
   ambiguous/stale targets never publish or silently move.
6. A Recall item can use only evidence at or before its deterministic display target. Think/reveal,
   skip, close and repeat produce no score, attempt, Master/Topic, KPStatus, Section state, Learning
   event or permanent Chapter lock.
7. Deterministic invalid output fails before Review. Review uses fresh context and cannot rewrite;
   semantic FAIL, invalid verdict, timeout, unavailable reviewer or exhausted retry is never PASS.
8. Semantic rework stops after at most three completed cycles. Technical retry remains stage-local,
   does not consume that count and cannot duplicate the logical candidate or publication.
9. Only a fully reviewed Section result becomes visible. APIs and UI expose no partial/unreviewed
   content; sibling-Section failure is isolated.
10. First publication and replacement are atomic and idempotent. Double click, HTTP retry and
    response-loss replay create at most one logical attempt/version; failed/in-progress regeneration
    leaves the old published result visible.
11. On/Off changes presentation only. Hidden content survives navigation/restart, PDF remains fully
    operable, and enabling does not depend on current provider/credential readiness.
12. `✦` placement remains associated with the correct source under virtualization, zoom, narrow
    viewport, Guide split-pane changes and Dock changes; it neither covers PDF text nor collides with
    existing learning controls. Unplaceable items are omitted rather than overlaid incorrectly.
13. Guidance selection creates an independent Assistant Root with correct Teaching lineage and no
    fake PDF anchor, Guide mutation, persistent Assistant history or learning-state write.
14. Migration preserves existing published Guides/jobs/pointers byte-for-byte in meaning. Restart,
    staleness, owning-book cascade and sibling-book isolation remain correct for both Teaching kinds.

### Agent real-use golden path

Using the real 348-page textbook and one resolved Section:

1. Open the original PDF, explicitly request Inline Teaching, and verify reading remains usable while
   generation/Review runs.
2. Inspect actual generator and reviewer payloads, then obtain one independently reviewed published
   result with genuinely sparse `✦` placement—not one item per paragraph/page/KP.
3. Open representative lead-in/bridge/warning Guidance, follow its source location, and confirm the
   exact PDF line/heading and stable placement at two zoom levels, a narrower viewport, with Guide
   expanded/collapsed and with the AI Dock open.
4. Exercise one Recall: think, reveal the reference thought, skip/reopen it, and verify no learning,
   mastery, attempt or permanent-lock write occurred.
5. Select Guidance text and ask Assistant; verify a new Root with Teaching lineage, then close it and
   return to the same Guidance/PDF position.
6. Toggle Inline Teaching off and on, navigate away, close the Reader, restart the service and recover
   the same published items without requiring provider readiness.
7. Trigger one controlled generation/Review failure during explicit regeneration. Verify the old
   `✦` result stays usable, then retry to one atomic replacement without duplication.
8. Exercise a no-READY-KP Section and confirm no fabricated KP dependency, plus one unresolvable
   target that is omitted rather than guessed.

The path must include close/restart recovery and failure/regeneration reversal.

### Affected regression

- Reading Guide lifecycle, publication pointers, selection, split Reader and source navigation.
- Outline Section resolution, OCR line/heading geometry, virtualization, zoom and page-margin controls.
- Optional Knowledge dependency, permanent Chapter lock isolation and Master/Learning no-write rules.
- Jobs, migrations, idempotency, restart recovery, scoped staleness and book cascade.
- Provider routing, Review/rework/failure handling, payload inspection, logging and secret hygiene.
- Assistant Root/Child/source-lineage behavior and Annotation isolation.

### Closure / broad

**BROAD SUITE REQUIRED before closure** because this Phase changes persistent Teaching identity and
migration, durable PDF anchors, Review-gated publication, atomic replacement, deletion cascade and AI
egress. Run targeted → agent real-use golden path → affected regression → closure broad suite; do not
run the full suite after every edit.

## Autonomy

Ordinary naming, file/component layout, helper placement, local algorithms, conventional schema and
endpoint details, compact Guidance presentation, precise collision-layout method, wording, CSS, test
organization and small local refactors are delegated. Use the smallest existing-architecture solution
that satisfies the hard rules; no approval is needed for these loose edges.

## Must report before proceeding

Stop and report if implementation would change PDF/OCR/Section source authority, permit fuzzy or
model-authored durable anchors, alter Mastery/Learning evidence semantics, weaken mandatory Review or
atomic publication, make Teaching depend on user learning state, damage existing Guide identity or
migration/cascade meaning, require a layout detector/major dependency/substantial external code, or
expand into a quiz, memory, RAG, Vision or generic framework. Also report if the real textbook or
provider inputs required for the accepted golden path are unavailable.

## Completion

Complete targeted tests, the real 348-page golden path, affected regression and the broad closure
suite; record honest evidence in a concise Development Report and create a clean checkpoint. An
independent narrow review is required before closure and must attack additive migration, existing
Guide preservation, Inline Teaching identity/ownership, PDF anchor authority, placement degradation,
Review/rework transitions, atomic replacement, idempotency, cascade, AI egress and the absolute
no-Recall-to-Mastery boundary. Stop at `READY_FOR_USER_RETEST`; user acceptance, independent
acceptance and Phase closure remain separate approval gates.


## Closure record — 2026-09-12

The user explicitly reported **REVIEWED_SECTION_INLINE_TEACHING human acceptance: PASS**, requested
closure, and prohibited further changes to Inline Teaching UI, anchors, generated content or interactions.
Machine/real-material evidence and prior independent core review are recorded in the
[Development Report](../development-reports/REVIEWED_SECTION_INLINE_TEACHING.md). A fresh Gemini 3.8
independent closure delta review of accepted code at `58e3c3d` returned **PASS**, no findings,
recommendation **CLOSE**; see the [review report](../development-reports/REVIEWED_SECTION_INLINE_TEACHING_INDEPENDENT_REVIEW.md).

All required gates are satisfied. This closure changes documentation only; accepted product code,
content, source authority and interactions are unchanged. Deferred work remains outside this Phase.
