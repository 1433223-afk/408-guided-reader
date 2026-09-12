# Reviewed Section Inline Teaching — Independent Narrow Code Review

Date: 2026-09-12. Reviewer: independent Codex subagent `inline_independent_audit`, uninvolved in the design or implementation. This reviewer is not ZCode.

## Result

**Narrow code audit PASS after fixes; outstanding P0=0 / P1=0 / P2=0.** Reviewed the current uncommitted implementation against the accepted brief, its listed Frozen authority and the latest Reading Guide report. No finding was waived. This is a code/security/contract audit, not the product's independent model content Review, user acceptance or Phase closure. Those gates remain separate.

## Findings resolved and rechecked

- **P2 — consumed dependency scope**, `src/reader_service/teaching/inline_evidence.py:14`. The initial packet inherited the parent's physical revision despite consuming only its logical positioning/title. A parent range change could spuriously stale or interrupt this Section's work; consumed cosmetic title changes also needed explicit freshness. The implementation now excludes the parent's physical revision and compares the exact consumed Section/parent titles. Independent attack confirmed parent-only range revision does not stale the published asset and a changed parent title does.
- **P2 — ambiguous geometry before Review**, `src/reader_service/teaching/inline_evidence.py:21`. Different OCR text rows sharing one quad initially received distinct valid source IDs and could reach paid Review; only publication rejected the ambiguity. Independently reproduced the pre-fix failure. The packet builder now excludes nonunique page geometry before generation/Review. Independent retest confirmed ambiguous anchors are absent while remaining valid interventions can publish.

## Scope and evidence

- Additive migration 15 introduces separate Inline assets/pointers. Existing Guide schema and meaning are preserved; migration test compares populated Guide rows, jobs and pointers. Composite ownership foreign keys, publication checks and immutable published rows prevent cross-Section pointer adoption and mutation.
- Inline publication and pointer replacement share one immediate transaction and recheck current evidence, anchors and running job authority. Failed/in-progress replacement keeps the old pointer. Request serialization, unique intent/version/inflight constraints and stage-local retry preserve logical attempt identity.
- Candidate contracts accept supplied semantic IDs only. Durable page/quad/quote fingerprint/foundation/Section authority is server-derived; exact geometry uniqueness and quote checks suppress unresolved targets without fuzzy reattachment. Pure placement uses an outside-PDF gutter and omits collisions or insufficient room.
- Mandatory fresh Review sees candidate plus allowlisted current-Section evidence, never generator reasoning or learner state; reviewer rewrite is invalid. Three blocking semantic verdicts terminate a candidate. Technical failure remains failure and retry retains its stage.
- Inline does not consume Guide prose, KP ledger or learner history and records no fabricated KP version. Selection-to-Assistant creates Teaching lineage and an empty PDF anchor. Recall reveal/skip/close is local presentation; no scoring, attempts, Master, Learning, annotation or permanent-lock write path was found.
- Independently executed Guide + Inline targeted tests: **52 PASS**. Re-executed with two temporary adversarial tests after fixes: **54 PASS**. Separately ran three final adversarial cases: **3 PASS** (ambiguous geometry filtering; interrupted-job recovery and owning-book cascade with sibling-book survival; parent range/title freshness). Independent gutter tests: **2 PASS**.
- One initial cascade experiment used a nonexistent fixture helper and failed before exercising product code; correcting the experiment allowed the real cascade/recovery assertions to pass. The initial ambiguous-geometry failure is the genuine resolved finding above, not counted as PASS.

Temporary attack tests were removed after review; durable implementation regression tests are maintained by the implementer. Audit changed no product code. Broad regression and the actual 348-page UI golden path belong to the implementer's evidence; this reviewer did not independently operate that UI or verify live model pedagogical quality. Any live-provider quota failure remains a failure, not content Review PASS.

## Reproduction

```powershell
python -m pytest tests/test_inline_teaching.py tests/test_teaching.py -q
node --test tests-js/inline-placement.test.js
```

This report applies to the working-tree implementation after the two findings' fixes; the enclosing checkpoint records the exact reviewed revision. Material subsequent changes require a corresponding review delta.

## Gemini-only final runtime delta

After the user restricted all further live model use to Gemini 3.8, a fresh
`google/gemini-3.8-flash` code-review context checked the later per-call JSON mode,
Inline generation/Review routing and narrow-layout/async UI delta. It received source code and
constraints, not implementer reasoning. Final verdict **PASS; findings empty**. Exact source hashes
and raw verdict are retained locally in `test-results/inline-gemini-delta-audit-final.json`.

The first invocation returned invalid JSON and was not a PASS. A subsequent verdict alleged a P1
default-provider problem while the base class source was missing from its packet. Supplying the
actual `TeachingService` base class led the independent reviewer to explicitly refute that finding:
the generator inherits `GUIDED_READER_SYSTEM_PROVIDER` with default `openrouter`, not the Assistant's
active provider. No finding was waived and no unnecessary code change was made. This delta review
did not execute tests and does not replace the prior independently executed invariant tests.

## Final delta check

Rechecked the final implementation delta after the initial audit: provider/model/stage metadata is recorded before invocation without credential or payload persistence; the normal completion metadata replaces it only after success. UI uses existing control styling, chooses its initial Section by the physical half-open reading anchor, waits for the publication snapshot before choosing generate/replacement, and retains request failure text. These changes introduce no new source, publication or learning authority.

Independently reran the final **20 permanent Inline cases: PASS**, including consumed title/parent freshness, ambiguous-target omission and worker dispatch/recovery/cascade. JavaScript syntax check PASS. No additional findings; narrow code audit remains **PASS (P0=0 / P1=0 / P2=0)**. Implementer-reported final Inline and Guide controlled real-book E2E results are separate evidence, not independently rerun by this reviewer.


## Same-Phase margin-card UI rework — Gemini 3.8 review

The subsequent user-requested UI rework replaces the original outside-page gutter and bottom-row
presentation described above. A fresh `google/gemini-3.8-flash` context independently reviewed the
actual `inline-ui.js`, placement, CSS, app integration, JS/E2E tests and diff, with the user's layout
constraints and source/no-learning-write invariants. It received no implementer reasoning. Final
verdict **PASS; findings empty**. Exact source hashes and raw verdict are retained locally in
`test-results/inline-ui-gemini-audit.json`.

The first invocation failed with `empty_response`; it was not a PASS. One bounded retry using the
same authorized model returned valid PASS JSON. This reviewer did not run tests or operate the UI;
real-material and machine evidence in the Development Report belongs to the implementer. No other
live model was used during that review. User acceptance and closure were pending at that checkpoint;
the final closure disposition follows.


## Final closure disposition — 2026-09-12

**PASS; outstanding P0=0 / P1=0 / P2=0; recommendation CLOSE.** The user explicitly reported human
acceptance PASS and requested documentation-only closure without changing accepted product behavior.

A fresh independent `google/gemini-3.8-flash` context inspected the code and material deltas from
reviewed margin-card commit `1e24717` to accepted baseline `58e3c3d`, alongside the accepted brief and
prior independent evidence. It found no new defect. Natural type labels, action hierarchy and shared
selection color do not change contracts or source authority. The user-authorized native DeepSeek
alias change preserves provider routing/validation; Inline generation and Review remain on Gemini.

The earlier independently executed core tests/audit continue to cover additive migration, Guide
preservation, identity/ownership, source anchors, Review/rework, atomic replacement, idempotency,
cascade, AI egress and the absolute no-Recall-to-Mastery boundary: those core modules have no diff
since their audited implementation checkpoint. The reviewed margin-card placement remains unchanged
by subsequent refinements. No finding was waived and no product fix was made for closure.

This final reviewer performed static source/diff inspection only, not tests or live UI acceptance.
Its fresh invocation returned valid PASS JSON with an empty findings array and CLOSE recommendation.
Exact accepted HEAD, inspected file hashes and raw verdict are retained locally in
`test-results/inline-closure-independent.json`; source hashes were checked before this docs-only update.
Machine and agent real-material acceptance are separately documented in the Development Report;
user acceptance comes from the user's explicit statement. All required closure gates are now satisfied.
