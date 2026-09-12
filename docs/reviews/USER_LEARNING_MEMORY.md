# User Learning Memory — independent narrow implementation review

Date: 2026-09-12. Reviewer: independent `memory_audit` agent, separate from the implementation
author and not involved in its design. Authority: accepted `USER_LEARNING_MEMORY` brief and its
specified Product/Implementation constraints, AGENTS.md, and the named Master, AI_SAVED and Inline
Teaching development baselines.

## Result

**Independent narrow code review: PASS. Outstanding P0=0 / P1=0 / P2=0.**

Two P2 findings were fixed by the implementer and independently reproduced/rechecked below. This is
an implementation review, not USER_ACCEPTANCE, independent product acceptance or Phase closure.
The reviewer did not independently run the 348-page real-book golden path or the broad closure suite;
those remain the implementer's separately recorded evidence. User retest remains pending.

## Scope and evidence

Inspected migration 16 and backup integration, `memory_schema.py`, `memory.py`, authenticated server
routes, `memory-ui.js`, app/Master/Marks return and collect integration, and relevant underlying
Annotation, Master snapshot, rendering and ownership boundaries. No provider was called by this
review. Tests used disposable fixtures and browser-local fake API responses only.

- `python -m pytest tests/test_memory.py -q -o addopts= --basetemp=test-results/memory-independent-pytest-final`:
  **4 PASS**. Covers parallel repeat collection, HTTP replay/authentication/owner isolation, completed
  source eligibility, save-first identity, exact body and live trust metadata, restart, remove/recollect,
  Annotation/Book cascade, additive migration and existing-row preservation. Initial run was
  **3 PASS / 1 FAIL** due to a test expecting 403 instead of the existing 401 authentication contract;
  the implementer corrected the assertion before the passing independent rerun.
- Independently authored browser tests `tests-js/memory-ui.test.js`: **2 PASS**. These exercise
  committed-response-loss retry and full-original access beyond the shared renderer's 50,000-character
  limit, including literal HTML text and honest FAIL metadata. The long-original test deliberately
  stubs formatted rendering to its limit so it verifies the independent exact-text fallback.
- Disposable independent SQL/service probe `test-results/memory-independent-boundaries.py`: **PASS**.
  Rejects USER Annotation collection and wrong source kinds; rejects membership identity mutation;
  deleting one AI_SAVED source removes only its membership, preserves USER Annotation and Master
  membership, and leaves every other table byte-value-equivalent with no foreign-key errors.

## Findings fixed and rechecked

1. **P2 — retry reversed explicit collection into removal.** The original collect control refreshed
   membership before deciding its action. After a POST committed but its response was lost, the
   displayed “收入学习记忆” retry discovered the existing relation and issued DELETE. An independent
   Chrome probe reproduced `[POST, DELETE]` with the membership disappearing. The implementer now
   captures the displayed intent before asynchronous work; the regression proves `[POST, POST]`
   retains one membership and a subsequent explicit displayed remove produces DELETE. **Fixed.**
2. **P2 — full eligible answer tail unavailable in Memory.** AI_SAVED accepts up to 100,000 characters,
   but the shared formatted renderer displays only 50,000. The original Memory detail offered no
   way to inspect the rest of an eligible answer. The implementer added a Memory-local expandable
   full original using `textContent`, preserving Markdown and literal HTML without an additional
   durable copy or shared-renderer redesign. The independent test proves the exact original and
   sentinel beyond 50,000 characters are accessible and HTML stays inert. **Fixed.**

## Boundary assessment

Migration adds only a five-field curation relation and scoped lifecycle triggers. The existing
database is backed up with SQLite backup, integrity checked and dump-compared before the atomic
schema/migration-marker transaction; the migration statement identifies preserved user assets.
Source identity is unique across source kind/id, insert eligibility checks actual ownership and
durable source kind/state, and relation updates are forbidden. Remove writes only that relation.
No answer body, summary, generated title, trust state or inferred learning attribute is stored there.

Resolution reads the existing Master message/question/Topic and current Review metadata, or the
existing AI_SAVED Annotation and verification/provenance. Section grouping uses real scope/KP
ownership or a uniquely containing PDF Section range; absent associations remain absent. Master
return opens its actual read-only learning snapshot and creates no precise PDF anchor. AI_SAVED
return uses its original geometry and existing Marks identity. Source and Book lifecycle hooks
remove dependent relations without introducing orphan snapshots.

The new service imports no provider or Learning/Teaching writer, and API payloads accept only source
kind/id. Source display uses existing sanitized formatting plus inert full-original text. No new
context-builder/provider integration, automatic collection, trust upgrade, Topic resolution,
KP/Section-state, Learning History, Teaching or mastery write was found. AI readiness does not gate
the new collection, removal, browse or return actions.
