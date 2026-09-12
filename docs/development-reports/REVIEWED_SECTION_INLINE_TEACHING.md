# Reviewed Section Inline Teaching Development Report

## Result

**READY_FOR_USER_RETEST — 2026-09-12.** Implementation, targeted tests, real-book UI validation,
affected regression and broad regression are complete. Independent narrow code review has no
outstanding findings. **USER_ACCEPTANCE remains PENDING; this is not Phase closure.**

The Reader can explicitly generate sparse Section Teaching, show/hide published page-side `✦`,
open Guidance and unscored Recall, explain selected Teaching in a new temporary Assistant Root,
and recover published content across navigation/restart. Failed replacement preserves the old result.

## Implemented

- Migration 15 is additive: `inline_teaching_assets` and `section_inline_teaching` preserve existing
  Guide tables, jobs and publication pointers. Existing serialized lifecycle helpers are shared;
  Inline generation does not enter the Guide author/formatter chain.
- One bounded Section/OCR packet, one direct generation call, deterministic validation, fresh
  independent Review, up to three blocking semantic cycles, stage-local technical retry, atomic
  publication/replacement and scoped owning-book cascade. A reviewed empty result is explicit success.
- Durable anchors contain server-resolved page, normalized quad, quote/fingerprint, foundation and
  Section identity. Nonunique IDs/geometries are excluded before generation; unresolvable published
  targets are suppressed. No model-authored geometry or fuzzy relocation.
- This slice uses no KP identities/boundaries and therefore sends no KP ledger or learner state and
  records no Chapter structure version. Staleness covers consumed pages, Section range/identity and
  actual Section/parent titles; unused parent physical revisions do not invalidate the asset.
- `✦` occupies a checked gutter outside the PDF media box. Insufficient room/collisions omit a marker.
  Opened content occupies a separate bottom row, preserving PDF reading and existing Guide/Dock use.
  Visibility preference is local presentation state, independent of provider readiness.
- Recall reveal/skip/reopen is local UI only. Guidance selection retains Teaching asset/item/field
  lineage and no fake PDF anchor; its Assistant explanation cannot be saved as a PDF-anchored note.
- Following the user's model restriction, new Inline generation/Review defaults use OpenRouter
  `google/gemini-3.8-flash`. The running retest service routes Assistant/System/Review to Gemini and
  disables DeepSeek/Zhipu. All subsequent **live** model calls used Gemini 3.8.

## Important decisions and prior art

Rechecked [Hypothesis issue 7571](https://github.com/hypothesis/client/issues/7571) and
[Readium DecorationController](https://github.com/readium/kotlin-toolkit/blob/develop/readium/navigators/common/src/main/java/org/readium/navigator/common/DecorationController.kt):
keep stable source identity separate from visual placement; fail locally rather than re-anchor a
lookalike. No annotation SDK/framework, fuzzy matching, substantial external code or dependency added.

Real Gemini Review sometimes returned fenced JSON. These responses failed strict validation and
never published. Checked the official OpenRouter SDK's
[ResponseFormat definition](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/docs/models/responseformat.mdx)
and added a small explicit per-call `json_object` option in the existing runtime. It is provider-scoped,
recorded in metadata and defaults off; deterministic validation remains mandatory. No SDK was adopted.
The direct documentation endpoint returned 403; GitHub's official SDK supplied the checked definition.

## Acceptance evidence

- **TARGETED:** 20 Inline tests PASS; 35 existing Guide tests PASS; explicit JSON-mode boundary test
  PASS; gutter placement/omission tests 2 PASS. Coverage includes replay/concurrency, no-KP evidence,
  exact anchor round-trip, ambiguous targets, stale publication prevention, semantic exhaustion,
  reviewer rewrites, technical retry, restart/dispatch, owning-book cascade, migration preservation
  and absolute no-Recall-to-learning writes.
- **AGENT REAL USE, controlled provider:** final run on an isolated copy of the real 348-page book
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd` PASS. Lead-in/bridge/warning/Recall,
  source navigation, two zoom levels, 1000px viewport, Guide expand/restore/collapse, AI Dock,
  actual pointer selection, Teaching-lineage Assistant Root, visibility toggle, Reader close/service
  restart, AI-off recovery, failed regeneration/retry/atomic replacement and no-READY-KP Section passed.
  Exact final payload allowlists and unchanged Guide/Learning/Annotation/permanent-lock state verified.
- **LIVE GEMINI + real UI:** final run at
  `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-zoBSlR/data` PASS. First publication
  `087f7e55-92e5-446a-ae88-ba8271456653` contained two sparse interventions, produced by **one live
  generation + one fresh live Review**. Actual pointer/zoom/source/selection/Dock flow and one live
  Gemini Assistant call passed. All three external calls used `google/gemini-3.8-flash`; both Teaching
  calls carried JSON mode. Subsequent controlled failure/restart/replacement/no-KP checks passed in
  the same isolated library. The live sample did not contain Recall; Recall behavior was proven by
  the separate controlled-provider real-book run, not falsely attributed to live output.
- **AFFECTED:** 184 Python regression cases PASS. Existing real-book Reading Guide E2E PASS at
  `C:/Users/26389/AppData/Local/Temp/guided-reader-guide-QqZGus/data`.
- **BROAD:** final `python -m pytest --junitxml=test-results/inline-closure.xml`:
  **274 PASS / 2 optional real-OCR skips**. `npm test`: **32 PASS**. Syntax and `git diff --check` PASS.
- **INDEPENDENT CODE REVIEW:** [report](REVIEWED_SECTION_INLINE_TEACHING_INDEPENDENT_REVIEW.md).
  Two initial P2 findings (unused parent physical dependency; ambiguous geometry reaching Review)
  were fixed and independently rechecked. Later JSON-mode/routing/UI delta was reviewed in a fresh
  Gemini 3.8 context; final PASS, no findings. This is distinct from product content Review.
- The initial OpenRouter quota failure and fenced-JSON failures were genuine failures, never PASS.
  The user restored quota; the final Gemini run above passed after the format fix. An early controlled
  UI race exposed generation before the current publication snapshot loaded; the control now waits
  for that required snapshot, and response-aware complete reruns passed.

The source library's existing Guide/Learning/Annotation hashes were verified unchanged after enabling
migration 15. Test publication and payload capture stayed in disposable copies. No textbook, secret,
provider body, screenshot or temporary Assistant history is committed.

## Boundaries / remaining acceptance

User retest and user acceptance are pending. Live pedagogical quality remains subject to that retest;
Review PASS is not user acceptance. No forced Recall or per-page/KP quota, scoring/attempt storage,
memory, Vision/formula understanding, RAG, new dependency or Guide content redesign was introduced.
An unplaceable marker is omitted; a stale/unsafe target is not moved to different text.

## Reproduction and entry points

```powershell
python -m pytest tests/test_inline_teaching.py tests/test_teaching.py
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/inline-teaching.mjs
$env:GUIDE_E2E_REAL='1' # Live initial publication + Assistant only; Gemini-only config is set by the test.
node tests-e2e/inline-teaching.mjs
```

Retest service: `http://127.0.0.1:8766/`. Open the textbook, choose **✦ 行间教学**, select a resolved
Section and generate. Toggle **显示 ✦**, open a page-side marker, inspect its source, and select its
text for Assistant. Recall appears only if the reviewed result finds it useful. Regeneration and
technical retry remain explicit. The main library has not been populated with controlled test output.

Core entry points: `teaching/inline_{contracts,evidence,service}.py`, migration 15 in `teaching/schema.py`,
`static/inline-{ui,placement}.js`, the narrow runtime JSON flag, server/Assistant integration,
`tests/test_inline_teaching.py`, `tests-e2e/inline-teaching.mjs` and `inline_verify.py`.

## Git checkpoint

The checkpoint containing this report is titled `Implement reviewed Section Inline Teaching for user retest`.
Its hash is reported after committing. The commit is implementation-ready, not user acceptance or closure.
