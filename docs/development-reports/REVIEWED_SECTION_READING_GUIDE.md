# Reviewed Section Reading Guide Development Report

Latest content status (2026-09-11): the single-example essay was rejected by the user. The
Gemini framework manuscript below is ready for human retest only; no publication or user PASS.

## Result

`IMPLEMENTATION_READY / READY_FOR_USER_RETEST` — 2026-09-10.

One resolved Section can explicitly generate a concise Reading Guide. Only a complete candidate
that passes independent AI Review publishes. Source buttons return to the actual PDF evidence;
Guide selection opens the existing temporary Assistant. Closing/restarting restores the published
Guide. Failed or pending regeneration keeps the previous published version readable.

**USER_ACCEPTANCE FAIL for the former checklist Guide; article/split-reader rework READY_FOR_USER_RETEST. Independent narrow code acceptance PENDING. Phase closure PENDING.**
The live AI content Review described below is not independent code acceptance. The accepted brief
requires that separate narrow audit before closure; no audit invocation or independent PASS is claimed.

## Implemented

- Migration 14 adds Section-owned Teaching versions, a current-publication pointer and page-scoped
  FoundationEvents. Existing jobs gain `TEACHING_GENERATE` / `TEACHING_REVIEW`; the same durable job
  changes stage. Single-winner claims, startup requeue, request replay and Section-local concurrency
  reuse the existing SQLite worker architecture. Published content is immutable; pointer replacement
  and publication commit together. All versions cascade with their owning book.
- Deterministic evidence construction reads only the resolved real Section's half-open physical
  range, its parent positioning, and optionally its own READY KP ledger. No Learning, Master,
  Annotation, Assistant or profile state enters generation or Review. The actual KP version is
  recorded only when the ledger was supplied.
- Server-owned source IDs resolve to persisted revision/page/geometry/quote provenance. Strict JSON,
  exact fields, bounded text and reference validation precede Review. The original route/exit
  requirement was removed by the user-approved article amendment.
  Foreign IDs, model-authored locators, unsupported quoted wording and exam-weight language fail.
  Review receives newly assembled allowlisted evidence, returns only a verdict and scoped issues,
  and cannot rewrite content. Rework replaces only rejected modules; three semantic FAILs terminate
  the candidate. Technical retry resumes the failed stage without consuming that counter.
- Source freshness uses declared node revisions, actual optional KP version and page-footprint
  events, with source fingerprints as a defensive check. Changed existing OCR publications append
  a page-local event and advance Foundation ordering; initial OCR preparation does not. Identical
  evidence keeps its source IDs across ordering-version changes. Unsafe source links are visibly
  unavailable; the saved Guide itself remains available with an update offer.
- The directory's Section row offers `导读`, with generate/open/close/retry/regenerate controls.
  Clicking a source revalidates it and closes the Guide so the original PDF is visible. Polling does
  not replace the old published DOM during regeneration. Directory refresh preserves expansion so
  background preparation cannot collapse the entry while it is being clicked.
- Guide selections are checked against the current published module on the server. They create a
  `READING_GUIDE` Assistant Root with no PDF quote/anchor and no durable Assistant history. Saving
  these unanchored explanations as PDF notes is unavailable; existing PDF-selected note saving is
  unchanged. User-facing controls and messages are Simplified Chinese.

## Important implementation decisions

- One direct System call per bounded generation stage; no planner, RAG, streaming, Inline Guidance,
  assessment, exam-evidence subsystem, new dependency or imported external code.
- Input bounds: at most 31 physical pages, 40,000 OCR characters and 1,600 evidence lines. Oversize or
  incomplete input fails honestly rather than truncating the Section. Output: 2–6 content-selected
  modules, mandatory route/exit, at most 2,200 body characters and 1–8 sources per module.
- Routing uses `GUIDED_READER_SYSTEM_PROVIDER` (default DeepSeek) and the existing
  `GUIDED_READER_REVIEW_PROVIDER` (default Zhipu). Guide-specific completion budgets are 16,384 / 8,192
  tokens including provider reasoning; they do not change other capabilities' provider settings.
  A `finish_reason=length` response is rejected even if it happens to parse. Structured-output retry
  is bounded to two calls per stage, in addition to the runtime's bounded transport retry.
- The brief's completed DeepTutor/STORM/OpenStax prior-art remains the basis: bounded Section unit,
  deterministic evidence IDs, generation/Review separation and reviewed atomic publication. During
  real-provider diagnosis, inspected [DeepSeek Thinking Mode documentation](https://api-docs.deepseek.com/guides/thinking_mode)
  and the existing Knowledge runtime call sites. Used the existing per-call budget facility; did not
  import pipelines, source code, new parsers or provider frameworks.

## Deviations from Spec

No product-scope deviation. Narrow code acceptance remains a separate pending pre-closure gate.
Legacy tests that asserted Teaching tables were absent now assert the tested paths leave them empty.
Historical migration tests target their stated migration or enumerate the old database's tables.
The Master E2E now waits for the actual confirm HTTP response: its old status-text predicate was
already true after Section bulk confirmation and could race the Topic write.

## Acceptance evidence

- TARGETED: **18 Guide tests PASS**, covering strict contracts, independent Review shape, retry and
  semantic limit, concurrent duplicate requests, atomic rollback, source changes during Review,
  optional KP dependency, scoped staleness, immutable evidence IDs, source degradation, HTTP auth,
  recovery, cascade and populated migration 13→14 preservation. Foundation/Annotation affected
  subset also passed (**36 tests** before the final added source-ID test).
- AGENT REAL USE, controlled HTTP providers: final `test:e2e:guide` **PASS** using a consistent
  disposable copy of the user's real **348-page** textbook. Source SHA-256:
  `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  Real pointer selection, existing Assistant send, every rendered source button, Reader close,
  service restart, generation failure, stage retry and atomic replacement passed. Section 6.1
  generated without READY KP and without a claimed/sent/persisted Chapter structure version.
- LIVE: `GUIDE_E2E_REAL=1` **PASS**. DeepSeek `deepseek-v4-flash` generated the Guides for
  `*1.1 计算机发展历程①` and `6.1 总线概述`; Zhipu `GLM-5.3-Flash` independently returned **PASS**
  for both, with **0 semantic rework cycles**. Inspected actual content: Section-specific reading
  actions and exit criteria, selected modules, no padded fixed template. The failure/replacement
  part deliberately used controlled HTTP providers; it is not claimed as a live replacement call.
- Actual wire inspection verified **7** successful Guide generation/Review bodies from the live
  run and **6** from the controlled run against the exact Section allowlist and durable source-ID
  ledgers. No unrelated Section or user-state fields, credentials, headers or streaming were sent.
  Test-only `guide_runner.py` captures requests/responses in the disposable Library; normal service
  startup does not persist those bodies. Generator reasoning is never passed to Review.
- Final source-ID refinement was followed by the final controlled real-book run and full regression.
  Also reopened the actual live-published 6.1 Guide on final code and followed its source successfully.
  Inspected `test-results/reading-guide-live.png` (ignored personal-material artifact).
- AFFECTED real-use: Assistant E2E **PASS** (temporary roots/children, Back, close, payload isolation,
  AI-off selection/search/navigation); Master E2E **PASS** (KP/Section history, `[PASS, PASS]` controlled
  Section reviews, confirmation, restart, retry, source/UI isolation).
- Final CLOSURE/BROAD check, without claiming closure: **232 Python PASS / 2 unchanged optional
  real-OCR skips**; **30/30 frontend PASS**. `git diff --check` passed.
- Earlier failures remain failures: missing static-module allowlist entry; directory refresh/entry
  layout; E2E source-page and POST-completion synchronization; live output exceeding reference count,
  token truncation and unsupported quotation/style output. Each was diagnosed and corrected. No
  failed candidate was published, and none was reclassified as a Review PASS.

## Known limitations / deferred debt

The bounded Guide is not a universal document generator: unresolved/missing/oversize Section evidence
or provider failure can prevent generation while PDF reading continues. Deterministic wording checks
cover the supported reference/quotation forms; semantic academic correctness still requires the
mandatory Review and user retest. No OCR correction UI, figure/formula understanding, RAG, exam
weighting, Inline Guidance or persistent Assistant workspace was added.

## Reproducible entry points

```powershell
python -m pytest tests/test_teaching.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
$env:READER_CHROMIUM='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e:guide
$env:GUIDE_E2E_REAL='1'
npm run test:e2e:guide
Remove-Item Env:GUIDE_E2E_REAL
npm run test:e2e:ask
npm run test:e2e:master
python -m pytest -o addopts='' -q
npm test
```

Retest service: **http://127.0.0.1:8766/**. Refresh, open the 348-page book, expand a Chapter in the
directory, and click a Section's `导读`. Generate, follow a source, reopen, select a phrase for
Assistant, close/reopen the Reader, and explicitly regenerate. Section 6.1 exercises the non-READY
KP path. Live generation can take several minutes including independent Review.

Before refreshing the service, verified backup
`var/manual-browser/state.sqlite3.pre-reading-guide-20260910.bak`; no pending Master calls or running
jobs existed. Migration 14 integrity/FK checks pass. **All 19 original tables' original columns/rows
match their pre-migration hashes.** New Teaching tables are empty in the source Library; test Guides
and test Learning state stayed in disposable copies. Port 8000 was not touched.

## Important files / architecture entry points

- `src/reader_service/teaching/{schema,evidence,contracts,service}.py`
- `src/reader_service/jobs/worker.py`, `foundation/repository.py`, `library/database.py`
- `src/reader_service/server.py`, `__main__.py`, `assistant/service.py`
- `src/reader_service/static/guide-ui.js`, `app.js`, `styles.css`
- `tests/test_teaching.py`, `tests-e2e/{reading-guide.mjs,guide_runner.py,guide_verify.py}`

## Same-Phase style retest — 2026-09-10

- User requested a one-page prereading guide instead of dense lecture notes. Changed only the
  generator's pedagogical prompt: 3–5 route stages, 4–6 driving questions, short prerequisites,
  3–5 pitfalls and 4–6 grouped exit goals, with distinct module responsibilities. No runtime,
  schema, reviewer, validator or skill-version changes.
- Submitted exactly one real UI regeneration for `2.1 数制与编码` in the 348-page textbook on
  port 8766. Version 2 published after real independent content Review **PASS**, with zero
  semantic reworks. Actual body: 989 characters; 5 route stages, 6 questions, 2 prerequisite
  sentences, 5 pitfalls and 6 exit goals. The former version remained available during generation.
- Real pointer-path regeneration, source jump and close/reopen **PASS**. Exact published text and
  screenshot are local ignored artifacts `.tmp/guide-2.1-preview.md` and `.tmp/guide-2.1-style.png`.
  Backed up the Library before restarting the prompt-bearing service; port 8000 was untouched.
- TARGETED: 18 Guide tests PASS. BROAD: 232 Python PASS / 2 unchanged optional OCR skips;
  30 frontend PASS. Prompt style still requires user retest; content Review does not constitute
  user acceptance or independent code acceptance. Status remains **READY_FOR_USER_RETEST**.

## Accepted article / split-reader rework — 2026-09-10

- Synced Product §20/§20.4, its Implementation audit cross-reference and this Phase brief before
  code: continuous problem-led articles, no exit module/per-KP checklist; flexible narrative rather
  than a compulsory problem/limitation template. No PDF Inline Guidance, dependencies or layout framework.
- Generator and Review now share that rubric. Existing JSON envelopes, stable block IDs, selection
  offsets and source ledgers remain; `article` supports 1–6 content-chosen parts, 1400 characters per
  part / 4500 total as technical bounds. Legacy kinds remain readable and retry-compatible; no
  migration, blanket staleness or published-content rewrite. Prompt targets are not fixed templates.
- PDF left / Guide right; native pointer and keyboard divider, bounded width, expand/restore and
  collapse/reopen. A section/version-keyed in-memory paragraph position restores reading across
  reflow, source jumps and reopening; it is a UI position, not a new durable learner-state record.
  Numbered references retain fresh server validation and locate PDF without closing Guide. The
  existing Assistant/Master dock and Guide use the space alternately, retaining their own state.
- Prior-art inspected during accepted proposal: [Split.js](https://github.com/nathancahill/split/tree/master/packages/splitjs),
  [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels), and
  [W3C APG Window Splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/).
  Borrowed min/max bounds, divider keyboard semantics and restore-width patterns; no copied code.
- Real 2.1: three explicit live article generations (versions 3–5). Versions 3/4 received model
  Review PASS but agent reading found operand confusion, excessive textbook restatement and
  overgeneralized C rules; they were not accepted as deliverables. Corrected prompts on both sides
  to check these concrete issues. Version 5 published with real Review PASS, zero semantic reworks,
  2275 characters / six naturally titled parts. Review transport made two attempts; this is not two
  semantic cycles. All intermediate immutable versions remain recorded; version 5 is current.
- Verified all three final wire attempts against freshly built exact Section evidence and allowed
  payload shapes, including no streaming. Actual metadata remains persisted. Checked the final
  article, screenshot, and exact source geometry. Service restart recovered the same version 5 ID.
  Pre/post backups are ignored Library files; SQLite integrity and FK checks PASS; port 8000 untouched.
- TARGETED: 19 Guide tests PASS, including an article with no route/exit and bounded text failure.
  Real 348-page split-reader test PASS: pointer/keyboard resize, expand/restore, collapse/reopen,
  source retention and exact PDF target, responsive resize, PDF visibility, no browser errors.
- AFFECTED: controlled real-book Guide E2E PASS (failure preserves old publication, retry, restart,
  non-READY KP, source scope, selection-to-Assistant); Assistant and Master real-book E2Es PASS.
  BROAD: 233 Python PASS / 2 unchanged optional OCR skips; 30 frontend PASS. Final Guide targeted
  tests rerun after prompt calibration. `git diff --check` PASS.
- Earlier failures were real: old test assumed removing exit made any one-part article invalid;
  narrow-window grid intrinsic sizing caused overlap; a disposable test copy resumed an unrelated
  in-flight user job against the test provider. Updated the obsolete test contract, constrained the
  Guide grid column and cancelled inherited jobs only inside the disposable copy, then reran successfully.
- Final ignored artifacts: `.tmp/guide-2.1-article.md`, `.tmp/guide-2.1-article.json`,
  `.tmp/guide-2.1-dual.png`, `.tmp/guide-article-inspection.json`. The page is served at port 8766.
  Reproduce layout verification with `node tests-e2e/guide-split-reader.mjs` against that prepared
  Library (`READER_URL` may override). No additional live generation occurs in that layout test.

Status: **READY_FOR_USER_RETEST** for the accepted rework. Earlier USER_ACCEPTANCE FAIL remains
recorded; no user acceptance, independent code acceptance or Phase closure is claimed.

## Git checkpoint

The commit containing this report is the implementation/retest checkpoint. Its exact hash is supplied
in the handoff. It does not close the Phase or declare user/independent acceptance.


## Editorial content rework — 2026-09-11

**READY_FOR_USER_RETEST for the unpublished 2.1 content sample only.** The implementer considers
this sample suitable for human review. Earlier USER_ACCEPTANCE FAIL remains; no new user acceptance,
independent AI/code acceptance, publication, or Phase closure is claimed.

- Replaced coverage-oriented generation instructions with one interpretive essay, one motivating
  puzzle, deliberate omission, an original unrelated style example, and integrated learning methods.
  A single title / roughly 1000–1300 characters is an editorial target, not a schema change or a
  mandatory pedagogical template. Technical 1–6-part/1400-per-part limits remain intact.
- `generation_messages` puts a static writing task after the full evidence packet. Generation and
  targeted editorial rework reuse this builder; Review still gets its original two-message context.
  No source filtering, KP dependency change, extra production model stage, or regeneration loop.
- Guide's default generator is now the existing Zhipu route (`GLM-5.3-Flash` in the configured
  baseline). `GUIDED_READER_SYSTEM_PROVIDER` overrides are still honored. Other agent defaults and
  the configured Review route are untouched; both defaults consequently use Zhipu in separate fresh
  contexts. Routing can still explicitly select a different reviewer. No silent model fallback.
- Same real 2.1 input: 748 evidence items, 15,460 OCR characters and the existing optional 16-item KP
  ledger. No other Section or learner state added. DeepSeek Flash, listed DeepSeek V4 Pro and GLM were
  compared during development; model identity alone did not establish quality. Pro was not adopted.
- Final sample uses the textbook's -4321 / 61215 example as one continuous argument, with seven
  paragraphs and 1250 body characters. It omits conversion procedures, range tables and per-encoding
  lessons. It was generated by GLM, then revised through **three explicit, implementer-authored
  editorial feedback calls**. No AI Review was invoked and no answer was manually rewritten after
  generation. This is not evidence that every first generation or another Section will be acceptable.
- The final call applied exactly the four requested local corrections and preserved all other text,
  title and source IDs. Saved message system/task strings match current code. AST comparison confirms
  the reviewer, validators and skill version still match the implementation checkpoint.
- Every sample run opened the real Library read-only and compared Teaching assets before/after;
  published assets remained unchanged. The service was not restarted and the live Reader was not
  changed to display an unreviewed sample. The new default/prompt load on the next service start.

Prior art: read chapters 5 and 7 of the official
[Anthropic prompt tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial/blob/master/Anthropic%201P/07_Using_Examples_Few-Shot_Prompting.ipynb).
Borrowed demonstration of desired writing behavior rather than only abstract prohibitions. No
external code, assistant prefill, XML output, or dependency adopted. Reused the earlier recorded
advance-organizer / learning-method research. Claude platform documentation returned 403 and was
not treated as read; trailing-task placement was a local experiment, not attributed to that page.

Failures remain recorded: Flash samples still summarized content; one failed quotation validation.
Pro did not sufficiently fix the structure. One GLM request had two network failures before its third
transport attempt succeeded (about 339 seconds total). A request to disable GLM thinking was rejected;
that setting was **not** adopted. Other successful GLM writing calls were about 101–106 seconds; the
last narrow revision took about 26 seconds. Earlier drafts contained inaccurate generalizations and
were not accepted as deliverables. More than one development attempt was needed; no reliability or
latency improvement is claimed.

Validation: **22 targeted Guide tests PASS**; after routing changes, **236 Python PASS / 2 unchanged
optional OCR skips**; **30 frontend PASS**. Tests include unchanged source payload, separated Review
messages, preserved explicit generator configuration and untouched reviewer selection. `git diff
--check` PASS. Mocked Review calls in tests are not live AI Review. UI E2E is `INTENTIONALLY_NOT_RUN`
for this content-only rework: no UI code changed and the user requested an unpublished manuscript,
not a Review/publication flow. Real-material acceptance here is the actual provider generation path,
format/source validation and implementer reading, not application publication or user acceptance.

Ignored personal-material artifacts: `.tmp/guide-editorial-ready-20260911/` contains the full Markdown,
raw response, candidate, exact messages/input, provider metadata and verification. Body SHA-256:
`c23cce2296777c599db04cb1c343b4209ae6bc2d99ed37f30b24f37a22e15cf9`.
Earlier experiment artifacts and bounded research notes remain under `.tmp/guide-editorial-*`.
The narrow reproduction script is `.tmp/generate-editorial-ready.py`; it makes a paid generation-only
rework call, never Review/publication. The Markdown is the human-review deliverable.


## Whole-Section framework correction / Gemini — 2026-09-11

The user rejected the 1250-character single-example approach: it omitted the overall learning
framework. Removed the one-title/one-example/short-essay restrictions. The Guide now explains the
whole Section's problem, why its main ideas are needed, how they connect, how to study them and what
they support later. Short teaching-style examples calibrate tone and explanatory depth; they are not
fixed headings or a per-KP coverage template. Target length is editorial (1800–2600), with unchanged
1–6-part / 1400-per-part / 4500-total technical bounds.

Per the user's Gemini 3.8 preference, Guide generation defaults to the existing OpenRouter route
(`google/gemini-3.8-flash`) and requests `reasoning_effort=high`. Explicit provider/model configuration
still wins. Assistant, Master and Review parameters/defaults are unchanged. Added bounded OpenRouter
reasoning-effort support to the existing runtime; request metadata records it and default calls do
not inherit it. The public models API listed this exact model and the supported parameter. Official
OpenRouter documentation requests returned 403 and were not treated as read evidence. No dependency,
new pipeline, proxy bypass, streaming, extra source context, UI or persistence change.

Real runs revealed two local defects, fixed at their existing boundaries:
- `http.client.IncompleteRead` now becomes the existing transient network failure, so transport retries
  remain bounded and never accept partial content. Tests cover recovery, exhaustion and no partial
  text leakage. The first high-reasoning request failed this way; a later separate request succeeded.
- Locator detection mistook `代表255` for an authored table reference. Exclude only the `代表` verb
  from the table-number pattern. Genuine `表1`, `教材表1` and `图1` still fail. No source-ID or locator
  authority was relaxed.

**Unpublished final manuscript READY_FOR_USER_RETEST; prior USER_ACCEPTANCE FAIL remains.** Five parts,
2509 body characters, same real 2.1 source (748 items and existing optional KP ledger). It connects
physical representation, symbol/position conventions, encoding purposes, type interpretation and
later arithmetic, with learning methods in context. Gemini produced the framework, followed by two
explicit implementer-authored editorial rework calls. This is not a claim of first-call consistency.
No AI Review, user acceptance, application publication or Phase closure occurred. Earlier candidates
were rejected for excessive technical restatement, unsupported quotations, operand mistakes and
unqualified C claims. The final response is saved unchanged, with its input/messages/metadata; no
manual rewrite after generation. Final request latency was about 41 seconds.

Validation: source/format validation PASS; source Library opened read-only and Teaching assets unchanged.
Saved system and trailing task match current prompts. Guide/Assistant runtime affected tests PASS;
final broad suite **241 Python PASS / 2 unchanged optional OCR skips**, **30 frontend PASS**.
Coverage includes per-call reasoning isolation, unchanged Review parameters, explicit route overrides,
partial-response recovery and legitimate numeric prose versus actual table/figure references.
The E2E wire verifier now expects the additional parameter only on OpenRouter generation calls.
UI/Review-publication E2E is `INTENTIONALLY_NOT_RUN` for this unpublished content task: no UI change,
no requested live Review/publication; those Phase acceptance gates remain open. Service not restarted.

Final ignored artifacts: `.tmp/guide-framework-gemini-ready-20260911/`; generation-only reproduction
script `.tmp/generate-framework-gemini-ready.py` (paid request, no Review/publication). Full body SHA-256:
`fe6251d50b7f47c10aca1a79d862f42c90359f1adaadb8d186b08e661a540da4`.
The checkpoint containing this amendment is an implementation/human-retest checkpoint, not acceptance.


## Simpler reading assistance / low reasoning — 2026-09-11

User rejected the previous Gemini framework sample and explicitly requested low reasoning and fewer
writing rules. Simplified GENERATOR and the trailing task to plain teaching prose: chapter purpose,
connections, small examples and practical reading help. Removed the long editorial prescription and
length target. Existing JSON/source constraints remain for Reader compatibility. OpenRouter Guide
calls now request `reasoning_effort=low`; Review and other agents remain unchanged.

Real 2.1 generation uses Gemini 3.8 Flash with low reasoning and the same 748 evidence items. First
response used a JSON fence and failed parsing. Second passed format validation but still had excessive
procedures and overgeneralizations. Two implementer-authored editing calls simplified/corrected it;
no live AI Review, publication or manual rewriting of model output. This is not first-call quality
acceptance. The source Library was opened read-only; Teaching assets remained unchanged. Prior user
FAIL stands. The deliverable is an unpublished manuscript for user retest, not Phase closure.

Validation: 241 Python PASS, 2 unchanged optional OCR skips; git diff --check PASS. Existing test and
E2E wire expectation updated for low effort. Frontend/UI E2E INTENTIONALLY_NOT_RUN: no UI change and
no authorized Review/publication flow in this content task. Prior prompting-example research is
reused; no new framework, dependency or external code. Service not restarted.

Artifacts: `.tmp/guide-simple-gemini-low-final-20260911/` (exact messages, input, raw model response,
metadata, candidate and full Markdown); reproduction `.tmp/generate-simple-gemini-low-final.py`.
