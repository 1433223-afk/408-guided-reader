# Reading Guide streaming and performance report

## Result

`IMPLEMENTATION_READY` / `READY_FOR_USER_RETEST`. Reading Guide now exposes the provider's real
incremental draft while generation is in progress, labels it `生成草稿 · 审查中`, and publishes
only after the unchanged independent Review contract passes. A draft exists only in process memory:
it is not persisted, cannot update the `PUBLISHED` pointer, and is unavailable to Assistant and
source-authority consumers. Failure removes the draft and exposes the existing in-place retry.
Human acceptance is pending; this report does not claim `USER_ACCEPTANCE PASS`.

## Implemented

- Added a Guide event stream that carries real provider deltas and lifecycle stages: preparation,
  generation, Review, revision and completion. The Reader shell remains usable throughout.
- Deferred all candidate-body persistence until the PASS transaction. A service restart cannot
  recover or expose an unreviewed draft; regeneration failure leaves an older published Guide intact.
- Deterministically removes repeated headers, exercises, answers and exam sidebars before provider
  egress. Initial source binding is local and deterministic rather than a second model rewrite.
- Sends Review only the evidence actually cited by the candidate. A semantic revision receives the
  Review findings and affected-module evidence rather than the complete source bundle.
- Removed visible numeric markers such as `[1] [2] [3]`. Internal source identity remains attached;
  each article module offers one lightweight `查看教材位置` action.
- Added a Guide-specific provider setting. The authorized native DeepSeek `deepseek-flash` writes
  the Guide; the authorized OpenRouter `google/gemini-3.8-flash` performs Review. Inline Teaching and
  other system-provider behavior are unchanged.

## Important implementation decisions

The user-approved visibility amendment is recorded in the Product Blueprint, Implementation
Blueprint and current Phase brief. `PUBLISHED` remains the sole formal Teaching state and the only
Guide content usable by downstream consumers. Streaming is a transport/presentation projection of
temporary memory state, not a new durable version or publication state.

Source binding now preserves Writer prose exactly and attaches existing source identities with a
deterministic local pass. Review requirements, PASS criteria and atomic publication are unchanged.
No RAG, vector database, new retrieval authority or new dependency was introduced.

## Deviations from Spec

None. The earlier Phase rule that Review preceded all visibility was amended by explicit user
approval for a clearly marked, memory-only streaming draft. The formal publication boundary did not
move.

## Acceptance evidence

Real material: an isolated copy of the existing 348-page textbook, Section `2.1 数制与编码`.
The original source had 748 lines / 15,460 characters. Deterministic filtering removed 348 lines;
397 lines / 8,088 characters entered Writer source grounding. Final Review evidence was 13 lines /
290 characters. The published Section contains 16 existing KPs.

| Run / stage | Prompt tokens | Completion tokens | TTFT | Latency |
|---|---:|---:|---:|---:|
| Baseline Writer | 1,137 | — | — | 21.803 s |
| Baseline model source binding | 16,494 | — | — | 20.174 s |
| Baseline Review | 37,345 | — | — | 14.770 s |
| Baseline Review contract retry | 37,366 | — | — | 14.766 s |
| Final Writer | 1,137 | 3,226 | 14.290 s | 19.830 s |
| Final local source binding | 0 | 0 | 0 | 0.006 s |
| Final Review 1 | 2,566 | 696 | 16.065 s | 16.884 s |
| Final targeted semantic revision | 1,911 | 4,011 | 14.050 s | 17.652 s |
| Final Review 2 | 2,644 | 327 | 15.276 s | 15.358 s |

The baseline spent about 73.5 seconds and ended `REJECTED`. The final real run received a normal
semantic FAIL from Review 1, revised only the affected material, passed Review 2 and atomically
reached `PUBLISHED` in about 70.1 seconds. The first visible Guide prose arrived at the real Writer
TTFT of 14.290 seconds. The main gain is input size and useful progressive visibility: model source
binding fell from 16,494 prompt tokens to zero, and the initial Review input fell from 37,345 to
2,566 prompt tokens. No percentage or synthetic typing animation is shown.

- `python -m pytest -q`: 411 passed, 2 existing optional skips (413 collected).
- `npm test`: 50/50 passed.
- `node tests-e2e/reading-guide.mjs`: passed on the isolated real textbook. It covers streamed
  draft visibility, Review, atomic publication, failure cleanup/retry, old-publication retention,
  no-KP generation, source return and restart behavior.
- `node tests-e2e/guide-split-reader.mjs`: passed against the served Reader. PDF visibility,
  resize, close/recenter, canvas identity and source position remain stable.
- `git diff --check`: passed; Windows line-ending warnings only.

No original textbook or generated Guide body is committed. Test metric files remain local under
`test-results/`. Full unrelated E2E is `INTENTIONALLY_NOT_RUN`: the change is confined to the Guide
generation/publication path, and its broad Python/JavaScript suites plus both real Guide paths cover
the shared risk surface.

## Known limitations / deferred debt

Real model TTFT remains roughly 14–16 seconds for the tested providers. Streaming makes the Writer
output visible as soon as the provider emits it but cannot reduce provider queue/inference delay.
The tested Guide required one legitimate semantic revision, so total wall time did not fall as much
as prompt size. User visual and interaction retest remains pending.

## Reproducible entry points

- Reader: `http://127.0.0.1:8767/`.
- Broad tests: `python -m pytest -q` and `npm test`.
- Real Guide path: `node tests-e2e/reading-guide.mjs`.
- Split Reader regression: `node tests-e2e/guide-split-reader.mjs`.
- Local measurements: `test-results/guide-real-baseline.json` and
  `test-results/guide-real-after.json` when retained by the test workspace.

Manual retest: open an unpublished Section, start Guide generation, observe the explicit streaming
draft, observe Review without a READY claim, confirm publication and source return, regenerate,
then exercise a failure and in-place retry. The PDF must remain readable during every stage.

## Important files / architecture entry points

- `src/reader_service/teaching/service.py`: in-memory draft lifecycle, streaming Writer, Review and
  atomic publication.
- `src/reader_service/teaching/writing_context.py`: deterministic filtering and bounded evidence.
- `src/reader_service/server.py`: Guide SSE endpoint.
- `src/reader_service/static/guide-ui.js`: streaming presentation and reconnect behavior.
- `tests/test_teaching.py` and `tests-e2e/reading-guide.mjs`: persistence, visibility and real-flow
  acceptance contracts.

## Git checkpoint

The commit containing this report (`Stream reviewed Reading Guide drafts`).
