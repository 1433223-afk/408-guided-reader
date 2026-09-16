# Phase / Regenerate READY Chapter Knowledge Map

> **Status: CLOSED / COMPLETE (2026-09-10).** Machine acceptance PASS; agent real-use PASS; user
> acceptance PASS on a real Chapter 2 replacement; independent narrow review PASS (`P0=0`, `P1=0`,
> `P2=0`) with `CLOSURE_RECOMMENDATION: CLOSE`. The user approved Phase closure on 2026-09-10.
> The accepted implementation and deferred boundaries below remain authoritative history.

## Goal

Let the user replace an old READY Chapter Knowledge Map before any learning state or other durable
user dependency makes its KP identities authoritative.

## User-visible result

> “尚未产生学习记录的 READY 章节可以整章重新生成；新地图失败时旧地图仍然可用，一旦开始学习则永久不能重生成。”

## Authority to read

- Product Blueprint §§8.1, 14.1, 15, 38 decision 69.
- Implementation Blueprint §§5.3–5.4, 12.1–12.6, 15.1–15.4, 16.1a, 17.6, 18.4–18.5, 19.1–19.5,
  20, 22–23.
- `docs/development-reports/FIRST_CHAPTER_KNOWLEDGE_MAP.md` for the existing accepted pipeline and
  real-book path.

Nothing else from either Blueprint is required for this Phase.

## Prior-art check

**NOT_NEEDED.** This is a narrow persistence/state correction with explicit product semantics and an
existing atomic publication path; no dependency or generic capability is being selected.

## Hard rules

- Ordinary Prepare stays idempotent for READY. Regeneration is an explicit complete-Chapter action.
- Eligibility requires no persistent learning state ever and no other durable user asset referencing
  any current Chapter KP. Check before scheduling and again inside final publication.
- Successful replacement atomically publishes the complete new Map with all-fresh opaque KP IDs.
  Failed/in-progress replacement leaves the old READY Map visible and unchanged.
- The first persistent learning-state write permanently freezes the Chapter in the same transaction.
  Reset, deletion or later state change cannot unlock it, and Master may not weaken the lock.
- Preserve the accepted source, Outline, semantic generation, Review, validation, job recovery and
  atomic publication rules. No partial candidate is user-visible.

## Build

- One irreversible Chapter learning-lock marker and the minimum repository boundary future Learning
  must call transactionally on its first persistent write.
- One explicit READY-regeneration service/API/UI action with safe availability/progress/failure copy.
- Preflight and in-transaction dependency guards, plus atomic replacement using the existing pipeline.

## Not now

No migration, remap/reconciliation, compatibility scheme, manual unlock, single-KP editing,
historical-version UI, Learning/Mastery feature, or KP-generation change.

## Acceptance

1. Dependency-free READY regeneration keeps the old Map visible while running and publishes a complete
   replacement with a higher structure version and no reused KP IDs.
2. Generation, Review, validation, publication, restart or late dependency failure never damages the
   old READY Map; retry remains explicit where eligible.
3. A learning lock blocks at preflight and publication, remains after attempted reset/deletion, and
   cannot be cleared through the application repository boundary.
4. A current KP-linked durable user asset blocks regeneration.
5. Duplicate requests converge on one replacement attempt/job; ordinary READY Prepare remains a no-op.
6. The real Reader path on an isolated copy of the real textbook Library performs one successful
   replacement, shows old KPs during work, restores fresh IDs after restart and leaves the source
   Library untouched.

## Autonomy

Ordinary names, helper placement, error wording, CSS, local tests and small refactors are delegated.

## Must report before proceeding

Stop if implementation would require changing accepted KP generation/Review semantics, modifying or
migrating an existing user learning asset, adding a dependency, or weakening the permanent lock.

## Completion

Run targeted invariant tests, the isolated real-use replacement path, affected regression and a broad
closure suite. Record honest evidence in a concise Development Report and create a clean checkpoint.
Because this Phase changes durable identity and destructive replacement authority, a narrow
independent review is required before closure. Stop at `IMPLEMENTATION_READY`; user acceptance,
independent acceptance and the next Master Phase remain separate.
