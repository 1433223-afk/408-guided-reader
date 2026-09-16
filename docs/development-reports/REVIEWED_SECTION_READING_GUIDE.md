# Reviewed Section Reading Guide Development Report

## Result

**CLOSED / COMPLETE — 2026-09-12.** The user explicitly reported **USER_ACCEPTANCE PASS**
for the current Phase and authorized closure only. Independent narrow code acceptance is **PASS**
(P0=0 / P1=0 / P2=0; CLOSE). No finding was waived.

Accepted product baseline: `0eb18fb336710283fc4e3de9c0f634bf4ae06e52`.
This closure changes documentation and one stale E2E provider fixture only. It changes no Guide
writing prompt, input-context scheme, UI, product code, provider configuration or deferred feature.
Earlier rejected samples and intermediate READY_FOR_USER_RETEST statuses remain historical evidence,
not current status; their full record is preserved in this report at commit `0eb18fb`.

## Implemented and accepted behavior

- One resolved Section can explicitly generate a Guide. Only a complete independently reviewed
  version publishes. Failed generation/Review preserves PDF reading and the prior published Guide.
- The author receives chapter/directory/adjacent Section titles plus the current Section's published
  KP titles and one-sentence meanings. No OCR body, examples, exercises, program detail or learner
  state enters author input. Without a published KP ledger, no Chapter structure version is claimed.
- Source-aware formatting preserves the author's draft exactly. Deterministic source IDs and fresh
  independent content Review protect publication; source locations remain server-owned. Optional KP
  and consumed title dependencies, page-local source freshness and Section ownership are recorded.
- Durable Teaching versions, bounded semantic rework, stage-local technical retry, replay protection,
  startup recovery, atomic current-pointer replacement and owning-book cascade use existing storage
  and job infrastructure. Guide selection does not acquire PDF anchoring or mastery-write authority.
- PDF/Guide split reading supports drag, expand/restore/collapse and reading-position retention.
  Section-title entries open Guide; collapsed reopening is in the main toolbar. More holds generation
  actions. Markdown/math uses the existing approved renderer, and selection uses the shared Assistant
  context menu. KP learning entries sit inside page margins; batch cards remain below pages.

## Independent acceptance

Independent Codex subagent `guide_closure_audit`, uninvolved in design/implementation, audited the
accepted product commit. It is not represented as ZCode or as the product's content Review.
[Full independent report](REVIEWED_SECTION_READING_GUIDE_INDEPENDENT_REVIEW.md).

Scope: durable identity, source-ID/locator authority, actual dependency/staleness declarations,
Review-gated visibility, semantic/technical retries, atomic replacement, ownership/cascade and
AI egress/secret isolation. **35 Guide cases PASS** independently executed; **CLOSE**, no findings.

## Closure evidence

- User acceptance: explicit **PASS**, 2026-09-12; not inferred from tests.
- BROAD, unchanged product code: `python -m pytest` — **253 PASS / 2 optional real-OCR skips**.
  `npm test` — **30/30 PASS**. Syntax and `git diff --check` PASS.
- Controlled real-book Guide E2E rerun: **PASS**, 348-page textbook SHA-256
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  Explicit generation/Review, source jumps, Guide selection to Assistant, service restart recovery,
  failed regeneration preserving the old Guide, retry, atomic replacement and no-READY-KP generation
  passed. The actual wire verifier also passed author/formatter/Review allowlists and dependencies.
- This E2E's first closure run failed correctly because its obsolete mock formatter fabricated two
  short modules instead of preserving the draft. Only the mock response was synchronized to return
  one module containing `payload.draft`. The complete rerun passed; the initial failure is not PASS.
- Immediately preceding user acceptance, real 2.1 split-reader checks passed More/toolbar controls,
  two zoom levels, drag/keyboard resize, expand/restore, collapse/reopen, PDF visibility and source
  jumps retaining Guide position. Actual in-app page and page-margin controls were visually inspected.
- The accepted baseline's Master E2E passed twice on isolated real-book copies: learning controls,
  conversation/restart, retry, confirmations, scope isolation and AI-off history. No closure product
  change invalidates that evidence. Earlier live Guide generation/content Review evidence is retained
  in the historical report; it is not claimed as a new live-provider run on the final author scheme.

The closure E2E used only an isolated copy at
`C:/Users/26389/AppData/Local/Temp/guided-reader-guide-PHMhKE/data` with loopback provider responses.
The source Library was not regenerated or published by this closure. No paid model calls occurred.
Live model quality was accepted by the user, not proved by the controlled-provider tests.

## Boundaries retained

No Inline Guidance, RAG, exam-weight system, streaming, OCR correction, persistent Assistant history,
new dependency or generic layout framework. Further writing/style refinement remains deferred by the
user. Missing/unresolved/oversize evidence can still prevent generation while PDF reading continues.
The earlier standalone formula visual fixture did not finish loading; it remains unverified, not PASS.
Formula rendering continues through the unchanged shared KaTeX renderer. No deferred work was pursued.

## Reproduction and entry points

```powershell
python -m pytest tests/test_teaching.py -q
python -m pytest
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/reading-guide.mjs
```

Real Reader: `http://127.0.0.1:8766/`. Open the textbook and click Guide at a Section title;
More contains generation/retry. Source clicks retain the Guide and navigate the PDF.
Core files: `src/reader_service/teaching/{service,evidence,writing_context,contracts,schema}.py`,
`static/guide-ui.js`, `tests/test_teaching.py`, `tests-e2e/reading-guide.mjs` and `guide_verify.py`.
No user textbook, request payload or secret is committed.

## Git checkpoint

Audited product: `0eb18fb336710283fc4e3de9c0f634bf4ae06e52`.
Closure checkpoint is the commit containing this final report, independent report, Phase/index closure
and E2E fixture correction, titled `Close Reviewed Section Reading Guide after user and independent acceptance`.
Its final hash is reported to the user after committing (a commit cannot contain its own hash).
