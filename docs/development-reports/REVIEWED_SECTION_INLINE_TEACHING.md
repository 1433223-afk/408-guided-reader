# Reviewed Section Inline Teaching Development Report

## Result

**CLOSED / COMPLETE — 2026-09-12. USER_ACCEPTANCE: PASS**, explicitly reported by the user.
Implementation, machine acceptance, real-book validation and required independent narrow review are
complete. Final closure delta review: **PASS, P0=0 / P1=0 / P2=0, recommendation CLOSE**.
The user authorized closure only and prohibited further product changes; accepted code at `58e3c3d`
is unchanged by the documentation-only closure.

The Reader can explicitly generate sparse Section Teaching, show/hide published in-page `✦`,
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
- Per the user's same-Phase UI request, `✦` now sits inside a blank PDF margin, checked against the
  actual OCR overlay and learning/Guide controls. One 316px paper-like card attaches to its source page
  in reserved space beside the PDF, scrolls with it, and switches when another marker is clicked.
  The bottom Guidance row is removed. The toolbar has one Section visibility switch and a secondary
  management menu for Section selection, generation, retry and status. Visibility remains local and
  independent of provider readiness. Direct “继续问 Assistant” supplements native text selection.
- Recall reveal/skip/reopen is local UI only. Guidance selection retains Teaching asset/item/field
  lineage and no fake PDF anchor; its Assistant explanation cannot be saved as a PDF-anchored note.
- Following the user's model restriction, new Inline generation/Review defaults use OpenRouter
  `google/gemini-3.8-flash`. The later user-authorized native DeepSeek V4.1 Flash enablement uses
  `deepseek-flash` for Assistant on port 8767; Teaching/System/Review remain Gemini and Zhipu is disabled.
  See [DeepSeek enablement](DEEPSEEK_V41_FLASH_ENABLEMENT.md) for its separate runtime evidence.

## Important decisions and prior art

Rechecked [Hypothesis issue 7571](https://github.com/hypothesis/client/issues/7571) and
[Readium DecorationController](https://github.com/readium/kotlin-toolkit/blob/develop/readium/navigators/common/src/main/java/org/readium/navigator/common/DecorationController.kt):
keep stable source identity separate from visual placement; fail locally rather than re-anchor a
lookalike. No annotation SDK/framework, fuzzy matching, substantial external code or dependency added.
For the UI rework, checked Floating UI's [autoUpdate documentation](https://github.com/floating-ui/floating-ui/blob/master/website/pages/docs/autoUpdate.mdx).
Borrowed scroll/resize/lifecycle anchoring principles only; page-relative DOM and existing relayout
handle positioning without a floating-element library, generic layout framework or animation loop.

Real Gemini Review sometimes returned fenced JSON. These responses failed strict validation and
never published. Checked the official OpenRouter SDK's
[ResponseFormat definition](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/docs/models/responseformat.mdx)
and added a small explicit per-call `json_object` option in the existing runtime. It is provider-scoped,
recorded in metadata and defaults off; deterministic validation remains mandatory. No SDK was adopted.
The direct documentation endpoint returned 403; GitHub's official SDK supplied the checked definition.

## Acceptance evidence

**Final closure, 2026-09-12:**
- **USER ACCEPTANCE: PASS**, from the user's explicit acceptance of this Phase; not inferred from tests.
- **INDEPENDENT NARROW: PASS / CLOSE**. Prior core and margin-card audits plus a fresh Gemini 3.8
  closure delta review cover the final accepted code at `58e3c3d`. No outstanding findings or waivers.
  The final reviewer inspected code/diffs only; it did not rerun tests or claim independent UI use.
- Latest broad run on that code: `deepseek41-closure.xml`, **274 PASS / 2 optional real-OCR skips**;
  `npm test`, **33 PASS**. The real-book Inline, selection, Guide and Assistant evidence below remains
  applicable. No repeated broad suite or content regeneration for this documentation-only closure.
- Closure diff is restricted to this report, its independent review report, the Phase brief/status
  and Phase index. No product code, tests, runtime, user data or deferred item is changed.

**Selection visual consistency refinement, 2026-09-12:**
- PDF selection quads and Guidance native selection now share the same translucent blue CSS token;
  Guidance retains its normal text color instead of browser-default white-on-blue. CSS-only change,
  without selection handlers, source lineage, menu actions or persistence changes; no live model calls.
- Actual pointer selection across PDF and Guidance text on real pages 13–14 PASS; computed selection
  backgrounds match, the shared right-click menu opens, and close/reopen works. Visually inspected
  `test-results/inline-selection-{1,2}.png` using the existing live-Gemini publication.
- **BROAD:** `npm test`: **33 PASS**; `inline-selection-closure.xml`: **274 PASS / 2 optional real-OCR skips**.
  Diff check PASS. No new independent review required for this CSS-only delta.

**Guidance wording/action hierarchy refinement, 2026-09-12:**
- Natural type labels: lead-in “为什么这里重要”, bridge “接着这样看”, warning “这里注意”,
  connection “和前面连起来看”, Recall “先想一想”. Assistant is the first, lightly filled primary
  action; source navigation is a quieter text action. Card/menu close glyphs are smaller and muted,
  retaining 24px targets. No source, lifecycle, provider, selection or learning-state logic changed.
- Targeted placement checks **3 PASS**; actual 348-page UI flow **PASS** at
  `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-9oDxoq/data`, including both card actions,
  close/reopen, Recall, narrow/Dock, restart and replacement. Updated real-Gemini-publication screenshots
  `test-results/inline-real-guidance-{1,2}.png` were visually inspected. No live model calls.
- **BROAD:** `npm test`: **33 PASS**; `inline-labels-closure.xml`: **274 PASS / 2 optional real-OCR skips**.
  JS syntax and diff checks PASS.
- No new independent review: this delta is local copy/CSS/action order, without a high-risk boundary
  change. The prior independent audit applies to the unchanged underlying behavior.

**Final same-Phase UI rework, 2026-09-12:**
- **TARGETED:** 55 Inline/Guide Python cases and 3 margin-placement JS cases PASS.
- **AGENT REAL USE:** controlled-provider flow on an isolated copy of the real 348-page textbook
  PASS at `C:/Users/26389/AppData/Local/Temp/guided-reader-inline-uDUgLK/data`. Verified markers inside
  the page with no OCR/control overlap, one 316px card, switching, scroll-relative position, close/reopen,
  Recall reveal/skip, source jump, direct Assistant draft and actual selection-to-Assistant Root,
  zoom, 1000px viewport, Guide/Dock, visibility, restart and failed regeneration/retry/replacement.
  Existing published Inline rows and Guide/Learning/Annotation/lock hashes remained unchanged.
- **AFFECTED:** Reading Guide real-book E2E PASS at `C:/Users/26389/AppData/Local/Temp/guided-reader-guide-8QWV2n/data`.
- **BROAD:** `inline-ui-closure.xml`: **274 PASS / 2 optional real-OCR skips**; `npm test`: **33 PASS**.
  JS syntax and diff checks PASS. Independent Gemini 3.8 UI delta review PASS; details in the review report.
- **SCREENSHOTS:** `test-results/inline-real-guidance-1.png` and `inline-real-guidance-2.png` show the
  actual served textbook pages 13–14 with prior live-Gemini publication
  `348dfc52-6761-493f-a1e3-c3fa985177d0`. Visually inspected; no regenerated/mock screenshot content.
  Recall/narrow/Dock screenshots come from the separately identified controlled-provider run.
  This UI rework made no live generation/Assistant calls; only the independent review called Gemini 3.8.
- Initial UI checks exposed reset recursion and loss of the open card when a shrunken page could no
  longer fit its marker; both were fixed before the complete passing rerun. A verifier assumed an empty
  Inline baseline; it now preserves and checks existing published rows before counting new publications.

**Original implementation baseline (before the UI rework):**

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

## Boundaries / deferred scope

User acceptance was explicitly granted for the current Phase. Content Review and independent code
review remain distinct from that user decision. No acceptance gate is pending for this closure. No forced Recall or per-page/KP quota, scoring/attempt storage,
memory, Vision/formula understanding, RAG, new dependency or Guide content redesign was introduced.
An unplaceable marker is omitted; a stale/unsafe target is not moved to different text. An already
opened card can remain safely beside the source when a smaller page cannot fit its marker. At high
zoom or with a narrow Reader plus Dock, horizontal scrolling exposes the reserved card space; cards
never overlay PDF text. Layout does not change durable source geometry or publication semantics.

## Reproduction and entry points

```powershell
python -m pytest tests/test_inline_teaching.py tests/test_teaching.py
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/inline-teaching.mjs
$env:GUIDE_E2E_REAL='1' # Live initial publication + Assistant only; Gemini-only config is set by the test.
node tests-e2e/inline-teaching.mjs
```

Current enabled retest service: `http://127.0.0.1:8767/` (see [DeepSeek enablement](DEEPSEEK_V41_FLASH_ENABLEMENT.md));
the old `8766` process retains its prior disabled-DeepSeek environment. Open the textbook,
use **行间教学** to show/hide this Section's markers; use its **⋯** menu to select a resolved Section
and generate/regenerate. Open an in-page marker, inspect its source, and use **继续问 Assistant** or
select its text for Assistant. Recall appears only if the reviewed result finds it useful. Regeneration and
technical retry remain explicit. The main library has not been populated with controlled test output.

Core entry points: `teaching/inline_{contracts,evidence,service}.py`, migration 15 in `teaching/schema.py`,
`static/inline-{ui,placement}.js`, the narrow runtime JSON flag, server/Assistant integration,
`tests/test_inline_teaching.py`, `tests-e2e/inline-teaching.mjs` and `inline_verify.py`.

## Git checkpoint

- Original implementation: `1a3e38a`; margin-card UI: `1e24717`.
- Wording/action hierarchy: `0ba13e7`; selection consistency: `969e5af`.
- Accepted closure baseline, including user-authorized DeepSeek configuration: `58e3c3d`.
- Documentation-only closure: `Close reviewed Section Inline Teaching after user acceptance`;
  its final commit hash is reported to the user after committing.
