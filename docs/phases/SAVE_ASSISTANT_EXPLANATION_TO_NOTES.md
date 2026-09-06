# Phase / Save Assistant Explanation to Notes

> **Status: CLOSED / COMPLETE (2026-09-06).** User acceptance PASS and required narrow independent
> review PASS (P0=0 / P1=0 / P2=3, all deferred). The Hard rules below remain this Phase's frozen
> record. Closure evidence:
> [development report](../development-reports/SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md).

## Goal

Create the first durable AI-asset vertical slice: an explicit user action promotes exactly one
completed Assistant explanation into a durable `AI_SAVED` Annotation, then an independent Review
records verification metadata without owning, delaying, rewriting, or deleting the user's saved
asset.

## User-visible result

> “我可以把一条已经完成的 Assistant 解释保存到笔记；它立即出现在「我的标记」中，能看出教材来源、
> 当时的解释路径和 AI 正文，重启后仍在；AI 审查随后诚实更新状态，审查失败也不会吞掉我的笔记。”

## Authority to read

**Directly relevant development reports (Tier A):**
- `docs/development-reports/ASK_DEEPER.md` — current temporary Assistant tree, rendered-answer
  selection/projection, provider isolation, lifecycle, and accepted real-use path
- `docs/development-reports/R3_MY_MARKS.md` — current durable Annotation, Marks, ownership, restart,
  delete, and book-cascade behaviour

**Product Blueprint:**
- §2, §3.3 — Original PDF authority and user-saved Assistant explanations as durable User Learning
  assets
- §7.1–§7.1.1, §8–§8.1 — foundation-version dependency and durable annotation anchoring
- §24.3 — temporary Assistant lifetime and the explicit Save-to-Notes promotion exception
- §30.1, §30.4–§30.6 — grounding, Assistant Review policy, durable Assistant content, and the rule
  that Review never owns Mastery
- §33.2 — independent Review role/context and Review-judges-not-authors boundary
- §38 decisions 7, 28, 43, 46–48, 55 — anchor, lifetime, grounding, Review, promotion, and
  no-learning-write decisions

**Implementation Blueprint:**
- §4.1–§4.3, §5.4 — Annotation/AgentRuntime boundaries, dependency direction, references, and
  transaction boundaries
- §13.1–§13.8 — agent/context/provider separation, grounding, Review invocation, and typed failure
  semantics
- §14.2–§14.11 — temporary Assistant lifecycle, Root/Child lineage, retry identity, and grounding
- §16.1, §16.3–§16.5 — Annotation anchor model, foundation-change behaviour, Assistant-to-Note
  promotion, and Teaching-layer independence
- §19.1–§19.5, §20 — versions, staleness, migration discipline, and failure isolation
- §21.2–§21.5 — credentials, egress, backup, and secret-free logging
- §23 — deterministic, persistence, provider, Review, and real-material test strategy

Nothing else from either blueprint is required reading for this Phase.

## Prior-art check

**NOT_NEEDED.** This is a bounded bridge between already-frozen and already-implemented Assistant
context and Annotation context. It needs no generic notes framework, workflow/state-machine
framework, or new storage technology. If implementation reveals a need for substantial external
code or a major/core dependency, stop and report under `AGENTS.md` §5 before adoption.

## Hard rules

- **Save first; Review second.** The authoritative order is:

  ```text
  USER SAVE INTENT
    → durable AI_SAVED Annotation committed in a non-PASS verification state
    → immediate honest save-success response
    → independent Review
    → verification metadata update on that same Annotation
  ```

  Review success is never a precondition for creating the Annotation. Reviewer credentials,
  cooling, timeout, provider/transport failure, invalid structured verdict, exhausted technical
  retry, and semantic Review failure cannot roll back, delete, hide, or convert a successful durable
  save into “保存失败”. If the durable write itself fails, report “保存失败” honestly. An interrupted
  Review or service restart leaves the saved asset present in an honest, non-PASS, retryable state;
  it never invents a verdict.
- **Verification is an independent AI judgment, not absolute truth.** Internal states may be
  `PENDING`, `REVIEWING`, `PASS`, `FAIL`, `TECHNICAL_FAILURE`, or equivalent, but user-visible meaning
  must be honest: for example, 待 AI 审查 / AI 审查中 / 已通过 AI 审查 / AI 审查未通过 / 暂时无法审查 ·
  可重试. `PASS` is not factual certainty, textbook authority, or learner-mastery evidence. The
  Original PDF remains source authority.
- **Durable content preserves three recoverable authority classes; they must not be flattened into
  one irreversible string:**
  - **SOURCE** — the Root lineage's real Original-PDF durable anchor: source revision, PDF page,
    normalized geometry/quads, quote and bounded context, and foundation version. This alone is the
    textbook source anchor.
  - **PROVENANCE** — why the explanation arose and what the user was trying to understand, including
    the Root focus, optional Child focus, and necessary human-readable concept path. Provenance is
    AI-explanation context, never a PDF quote or source anchor.
  - **AI CONTENT** — exactly the one completed Assistant answer the user chose to save. Review is
    metadata beside it; Review never rewrites it. AI content remains visibly/semantically distinct
    from a USER-authored note.

  Exact storage decomposition is an implementation loose edge, but all three classes must remain
  independently recoverable, displayable, and testable.
- **Explicit completed-answer promotion only.** A save is an explicit user action on one completed,
  successful Assistant answer turn. Root and Child answers are eligible. Pending, failed, partial,
  or incomplete turns cannot be presented or accepted as successful save targets. An accepted save
  preserves the complete AI wording without silent truncation; if the durable store cannot accept
  it, the save fails honestly before claiming success.
- **Child provenance never fabricates a source.** A saved Child answer keeps the Root's actual
  Original-PDF anchor as durable SOURCE. Child focus and concept path belong only to PROVENANCE; no
  Child phrase may be fabricated into a PDF quote, geometry, or anchor.
- **Assistant remains temporary.** Saving a turn copies one promoted asset into Annotation. It does
  not persist a Root, Child, sibling, descendant, whole conversation, or tree; it does not change
  the existing close/Reader-close/service-restart lifecycle. After those events, temporary Assistant
  state clears and only explicitly promoted `AI_SAVED` Annotations remain.
- **Fresh Review allowlist.** Review context is assembled field by field for this one saved item and
  may contain only: the saved AI answer; necessary current focus/question/provenance; its originating
  Reader grounding; and necessary source quote/context. It must not receive other Roots, sibling
  Children, descendants, unrelated Assistant turns, other user notes, highlights, Mastery, Progress,
  Learning History, Teaching assets, navigation/tree metadata, or secrets. The Review boundary must
  reconstruct this projection; it must never serialize or pass through Assistant internal tree/state.
- **Review independence is role/context independence first.** A different configured provider/model
  is preferred when available. The actual reviewer provider/model is recorded when a call occurs.
  Cross-provider availability is not a save prerequisite; a same-provider clean Review context may
  be used only if that is the actual configured route and is reported honestly. No silent fallback
  may masquerade as the intended reviewer. If no reviewer is usable, the asset stays saved with an
  honest non-PASS, retryable state.
- **Review judges; it does not author or learn.** Semantic Review `FAIL` preserves SOURCE,
  PROVENANCE, and AI CONTENT and records a not-passed state. Technical Review failure also preserves
  them and permits retry. Neither path rewrites AI CONTENT or writes Mastery, Progress, Learning
  History, a Master thread/record, Knowledge, or Teaching/TeachingAsset state.
- **Idempotency, ownership, and cascade remain load-bearing.** One logical save intent creates at
  most one durable Annotation across double-click, HTTP retry, and response-loss replay. Review and
  Review retry update that same Annotation and never mint another. Any migration is additive-first
  and preserves every existing `USER` Annotation's meaning, ownership, anchor, visibility, and delete
  semantics. Existing book deletion cascade removes both `USER` and `AI_SAVED` annotations correctly;
  deleting one `AI_SAVED` annotation affects only that asset.
- **No generic workflow infrastructure.** Use the minimum mechanism within the current architecture
  that satisfies commit-first lifecycle, honest restart/failure recovery, idempotency, and retry. A
  generic job/workflow/state-machine framework is outside this Phase.

## Build

- The durable promotion path for one eligible Assistant answer, including a stable logical save
  identity, Root-origin source-anchor resolution, separately recoverable provenance, exact AI
  content, and initial non-PASS verification metadata.
- The post-commit Review path: a fresh allowlisted context, configured Review routing, deterministic
  result validation, actual reviewer provider/model metadata, typed semantic vs technical outcomes,
  bounded technical retry, and an idempotent update of the saved Annotation.
- The minimum complete user surface required by this capability:
  1. a 「保存到笔记」 entry on each completed successful Assistant answer;
  2. immediate save-success/failure feedback that does not wait for Review;
  3. `AI_SAVED` presentation in 「我的标记」;
  4. clear AI-source distinction from USER-authored notes;
  5. minimal honest verification-state presentation;
  6. a minimal retry affordance for technical Review failure;
  7. a user-comprehensible presentation of SOURCE, PROVENANCE, and AI CONTENT.
- Restart/reopen/delete integration with existing Marks and Annotation behaviour, including correct
  page restoration from the Root's durable anchor.
- The smallest additive migration and local lifecycle mechanism, if needed, that satisfies the Hard
  rules without introducing persistent Assistant history or generic infrastructure.

## Not now

- Persistent Assistant conversation/history; saving a whole Root/tree; or changing the temporary
  Assistant lifecycle.
- Streaming or any partial-turn protocol.
- OCR correction/reprocessing, formula OCR, Vision, figure/formula understanding, or cross-page
  selection.
- RAG, authoritative RAG, Reading Guide, Chapter KP preparation, Master, Teaching, TeachingAsset,
  Mastery, Progress, or Learning History work.
- Editing/regenerating saved AI wording, automatic rewriting after Review, or a semantic-failure
  rework loop.
- General temporary-answer Verified mode.
- OpenRouter proxy/region work or the default-provider decision.
- Assistant workspace header redesign; breadcrumb, Root selector, expanded-mode, or conversation
  hierarchy redesign; GPT/WeChat-style visual rework; a new UI design system; or unrelated Assistant
  polish. This Phase completes only the UI needed for Save-to-Notes.
- This list is not a future construction order. After this Phase closes, the next slice is
  re-adjudicated from actual product state under `AGENTS.md` §7.

## Acceptance

### TARGETED

With deterministic providers/fault injection and a real database where persistence is under test:

1. A completed successful Root answer saves exactly once and appears as `AI_SAVED`.
2. A completed successful Child answer saves exactly once and appears as `AI_SAVED`.
3. Durable SOURCE is the exact originating Root PDF anchor: source revision, PDF page, normalized
   geometry/quads, quote/context, and foundation version round-trip correctly.
4. Child focus/concept path round-trips as PROVENANCE and never appears as a fabricated PDF quote or
   anchor.
5. AI CONTENT round-trips exactly; no Review path rewrites it and no oversized answer is silently
   truncated and reported as saved.
6. SAVE FIRST is proven at the real persistence boundary: durable commit and immediate save success
   do not wait for Review completion or availability.
7. A valid Review `PASS` updates verification metadata on the existing Annotation and does not claim
   textbook authority or mastery.
8. Semantic Review `FAIL` preserves the Annotation, SOURCE, PROVENANCE, and AI CONTENT and remains
   non-PASS.
9. Reviewer timeout/auth/cooling/provider failure, invalid structured verdict, and exhausted bounded
   technical retry each preserve the asset and produce an honest technical non-PASS state.
10. Retrying a technical Review failure updates the same Annotation and never creates another.
11. Double-click, HTTP retry, and response-loss replay create at most one Annotation for one logical
    save intent.
12. Final Review transport contains exactly the declared allowlist for the current saved item.
13. Transport canaries prove absence of other Roots, sibling Children, descendants, unrelated turns,
    and Assistant navigation/tree metadata.
14. Transport canaries prove absence of other notes, highlights, Mastery, Progress, Learning History,
    Master/Teaching assets, and unrelated user material.
15. Credential and secret canaries prove no secret reaches payload inspection, logs, errors, or
    persisted review metadata.
16. The migration preserves existing USER Annotation content, source kind, ownership, anchor,
    visibility, restart recovery, and deletion semantics.
17. Book deletion cascades over both USER and AI_SAVED annotations without cross-book effects.
18. Closing a Child, Root, or Reader and restarting the service clears the Assistant tree while the
    promoted AI_SAVED Annotation remains recoverable on the correct page. An interrupted Review never
    turns into PASS after restart.
19. Save, Review, semantic failure, technical failure, and Review retry perform zero writes to
    Mastery, Progress, Learning History, Master records/threads, Knowledge, and Teaching/TeachingAsset.
20. Pending, failed, partial, and incomplete Assistant turns cannot be saved as successful answers.

### AGENT REAL-USE GOLDEN PATH

Use the real 348-page textbook through the actually served UI with real pointer/keyboard interaction.
Create the Root `时钟脉冲信号`, then the Child `像乐队里的节拍器`, and:

1. click 「保存到笔记」 on the actual completed Child answer;
2. observe immediate “已保存” feedback before the reviewer completes;
3. open 「我的标记」 and find the new AI_SAVED item, visibly distinct from a USER note;
4. inspect SOURCE and confirm the original PDF anchor is the Root selection on the correct page;
5. inspect PROVENANCE and find the Child focus and necessary concept path, without either being
   presented as textbook quotation;
6. inspect AI CONTENT and compare it with the exact answer that was saved;
7. execute one bounded real reviewer call when a configured reviewer is available, record the actual
   provider/model, and observe an honest verification UI update;
8. close the Child, close the Root/Reader, and restart the service;
9. confirm the Assistant tree is gone while the AI_SAVED Annotation reopens on the correct page;
10. inject or exercise one reviewer technical failure, confirm the asset remains, and use the retry
    affordance without creating a duplicate;
11. delete that AI_SAVED item and reopen/restart to confirm it remains deleted.

This supplies both reversal/recovery paths: technical Review failure → retry, and durable delete →
reopen confirmation. Missing cross-provider availability is reported honestly and does not invalidate
the save/restart path; it can never be converted into a Review PASS.

### AFFECTED REGRESSION

Run only suites and smoke paths that share the changed risk surface:

- R3 Annotation create/list/delete/restart/ownership/book-cascade and anchor rendering;
- Ask Deeper completed-turn identity, Root/Child source/provenance, close, and Reader/service-restart
  interaction;
- Reader selection/context menu and Marks presentation;
- provider routing, final-payload inspection, typed failure/cooling, AI-off, and secret hygiene;
- Find in Book and Map the Book need only smoke coverage when their only shared surface is Reader/UI
  integration; do not mechanically rerun unrelated full E2E suites.

### CLOSURE / BROAD

**A broad suite is required once before Phase closure** because this Phase crosses persistence and
migration, durable identity, source anchoring, destructive cascade, and Review egress boundaries. It
is not required after every edit. The execution order is:

```text
targeted → agent real-use golden path → affected regression → closure broad suite
```

No current golden-path check, high-risk invariant, or closure suite may be recorded as
`INTENTIONALLY_NOT_RUN`.

## Autonomy

Per `AGENTS.md` §5, the Implementer owns exact schema/field decomposition, verification enum names,
local transaction/helper/component layout, ordinary endpoint/event naming, minimum post-commit Review
scheduling within the existing architecture, retry/cooling bounds, exact Simplified-Chinese wording,
small Save/Marks styling, test organization, and small local refactors. No approval is needed for
those reversible choices while every Hard rule and Acceptance item above remains true.

This autonomy does not include changing source-of-truth semantics, persisting Assistant history,
weakening save-first or allowlist boundaries, introducing a generic workflow system, or writing any
learning/Teaching state.

## Must report before proceeding

Stop and report under `AGENTS.md` §5 if implementation reveals:

- any conflict between SAVE FIRST / REVIEW SECOND or the SOURCE / PROVENANCE / AI CONTENT separation
  and Frozen Product or Implementation authority;
- a migration that cannot preserve existing USER Annotation meaning, ownership, anchor, visibility,
  or delete/cascade behaviour, or any destructive migration/repair requirement;
- inability to guarantee one-Annotation-per-save-intent at the durable write boundary;
- a need to expand Review context beyond the allowlist, change the existing egress/credential
  boundary, add proxy behaviour or a provider endpoint/category, or persist secrets/content in logs;
- a need to persist Assistant Roots/Children/history, or to write Mastery, Progress, Learning History,
  Master, Knowledge, or Teaching state;
- a need for substantial external code reuse, a major/core dependency, new storage technology, or a
  generic job/workflow/state-machine framework;
- absence of the real 348-page textbook or another user-controlled input needed for the required
  acceptance path.

Reviewer unavailability by itself is an expected product failure mode, not permission to block or
undo a save and not a reason to widen scope. Report the actual state and prove the retryable non-PASS
path.

## Completion

- TARGETED, AGENT REAL-USE GOLDEN PATH, AFFECTED REGRESSION, and the required CLOSURE / BROAD suite
  complete in that order, with actual PASS/FAIL/NOT-RUN facts recorded honestly.
- **Independent narrow implementation review is required before closure** (`REVIEW_REQUIRED = YES`).
  It must be independent of the implementation author and adversarially cover: USER migration
  preservation; AI_SAVED durable identity and ownership; delete and book cascade; save and Review
  idempotency; exact Root PDF anchor; Child provenance/source separation; SAVE FIRST / REVIEW SECOND
  transaction boundary; verification transitions and failure semantics; Review allowlist; secret,
  credential, and egress isolation; and proof that Save/Review cannot write Mastery, Learning History,
  Master, Knowledge, or Teaching state. Review failure or invocation failure never becomes PASS.
- One concise development report in `docs/development-reports/`, including migrations, provider/model
  actually used for Review, unavailable/fallback facts, test tiers, real-use evidence, independent
  review result/findings, deferred items, and no-learning-write evidence.
- At least one clean implementation checkpoint commit after acceptance and review. Do not mark the
  Phase `CLOSED / COMPLETE` until all required evidence exists and the user accepts closure.
