# Learn One KP with Master Development Report

## Result

`READY_FOR_USER_RETEST` / `IMPLEMENTATION_READY` (2026-09-10).

- Machine acceptance: PASS.
- Agent real-use: PASS with the real 348-page textbook, both configured live providers and controlled
  provider failure/retry.
- User acceptance: PENDING — no USER_ACCEPTANCE PASS has been declared.
- Independent narrow acceptance: PENDING / NOT_RUN. The required independent audit of identity,
  migration, mastery authority, grounding, cascade and Review egress remains a separate pre-closure
  gate. This report does not substitute implementer testing for that audit. Phase is not closed.

One real published KP can open Master, retain questions/answers and its current Topic through restart,
and become understood only on explicit confirmation. Section-end bulk confirmation updates only its
UNCONFIRMED KPs and leaves identified confusion intact.

## Implemented

- Additive migration 12 introduces MasterThread, MasterTopic, MasterMessage, KPStatus and LearningEvent
  tables. Thread identity is unique per published KP; one ACTIVE Topic per thread; each logical send
  has one durable user message and at most one answer. Learning events cannot be updated or directly
  deleted; deleting their owning Book cascades all Learning records.
- Opening an unclear KP, explicit understanding and Section bulk confirmation use transactional
  writes. Each first learning write invokes the existing irreversible Chapter-lock boundary.
- Questions commit before provider execution. Failed questions survive; explicit retry reuses the
  same message. HTTP response-loss replay and concurrent duplicate requests do not duplicate intent.
  Interrupted calls become honestly retryable after restart.
- Master uses the existing configured provider runtime, direct answers and a fresh KP/source/Topic
  allowlist. Fast omits normal independent Review; Standard and Deep use the exact configured Review
  route and their respective rubrics. Failure is not PASS; retry reviews the saved answer without
  rewriting it or changing learning state. Actual answer/reviewer provider and model are recorded.
- The existing Dock now switches between temporary Assistant and durable Master. Knowledge Map items
  and collapsed controls at KP physical ends expose the entry/history. A second-level Section's
  physical end exposes the one-click confirmation and remaining-unclear notice.

## Important implementation decisions

- No new dependency, external implementation, agent pipeline, generic state framework, Section
  state, condensation, streaming or future teaching capability was introduced. Existing Markdown/math
  rendering, provider transport, authentication, Foundation evidence and Chapter lock are reused.
- UNCONFIRMED is the absence of a KPStatus projection. Explicit events accompany every status write;
  initial unclear evidence never downgrades an already UNDERSTOOD KP.
  Sending a question alone creates no unclear projection/event; that evidence belongs to the explicit
  `这里没完全懂` action, including when the API is invoked directly.
- Explicit confirmation resolves one current Topic synchronously. A response already in flight stays
  attached to that Topic; later questions form a new ACTIVE Topic without reversing prior understanding.
- Opening history does not require credentials. Provider readiness is checked at execution, after the
  question is durable. Assistant state never enters the Master context or Learning tables.
- The minimal source context contains only the published KP range's OCR evidence, not a full Chapter,
  other KPs, saved notes, global history or Assistant state. PDF page citations outside that supplied
  evidence are rejected before saving a completed answer or invoking Review.

## Deviations from Spec

User-authorized addition recorded in the brief: `一键确认本节全部 KP` affects only owned
UNCONFIRMED KPs. It preserves NOT_FULLY_CLEAR KPs and Topics and creates no SectionLearningState.
This bounded action is distinct from the deferred full `都清楚了` Section Learning Check.

Historical tests asserting Learning tables did not exist now assert Knowledge/Assistant paths leave
those tables empty. One Assistant E2E expected a 29-page sibling absent from the current Library;
it now selects the actual second Book (412 pages) for the same AI-off isolation check.

## Acceptance evidence

- TARGETED: `tests/test_learning.py` — 13 cases PASS, including evidence gates, concurrent send/retry,
  replay, modes/allowlists, semantic/invalid Review failure, restart, HTTP authorization, explicit
  resolution during an in-flight answer, section isolation, rollback, append-only history,
  ownership/cascade and additive migration 11→12.
- Agent real-use: `npm run test:e2e:master` — PASS on an isolated consistent copy of the real Library.
  Source SHA-256: `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`;
  348 pages; KP `计算机硬件的发展与四代变化`.
- Live run (`MASTER_E2E_REAL=1`): two genuine questions answered by DeepSeek `deepseek-v4-flash`,
  independently reviewed by Zhipu `GLM-5.3-Flash`; both reviews PASS. Dialogue and ACTIVE Topic
  recovered after Dock close, navigation, Reader close and service restart with AI disabled.
- Controlled actual HTTP provider failure: one persisted failed question, explicit retry after
  restart, same user-message IDs and one answer. The same real-use run then bulk-confirmed 9 owned
  pending KPs, preserved the unclear KP/Topic and every other Section, and explicitly confirmed the
  remaining KP. Final state: 6 messages, resolved Topic, UNDERSTOOD only after the click.
- Final transport payload keys/real KP range and secret exclusion checked on the controlled HTTP
  path. Live requests use that same tested builder/runtime; live payloads were not retained across
  restart. Screenshot inspected: `test-results/master-learning.png` (ignored, contains real material).
- AFFECTED: Learning, Knowledge, Jobs, API, Annotation, Library and saved-explanation suites PASS.
  Existing `npm run test:e2e:ask` PASS, including depth 3, multiple roots, Back, subtree/root close,
  retained history, payload isolation, Reader-close cleanup and AI-off selection/outline/search.
- CLOSURE/BROAD verification (not Phase closure): `python -m pytest -o addopts='' -q` —
  **161 passed, 2 skipped**. The two existing optional real-OCR fixtures lack their environment paths;
  this Phase does not change OCR. `npm test` — **30/30 PASS**.
- Initial Chrome launch exited before automation; Edge completed all browser checks. The first
  Master UI run exposed an overlapping Knowledge/Dock panel, fixed by reusing the normal Dock opening
  path; the full real-use test passed afterward. Initial failing checks were not counted as PASS.

## Known limitations / deferred debt

Independent narrow acceptance and user retest remain pending. Section-scoped Master, the full Section
Learning Check, summaries, global history UI and multimodal explanation remain outside this slice.

## Same-Phase addition: Subsection confirmation (2026-09-10)

User-requested `一键确认本小节 KP` now appears at each resolved third-level Subsection end with
published KPs. It reuses the existing authenticated batch endpoint, transaction, append-only events
and permanent Chapter lock; there is no migration, new status or workflow.

Subsection membership is derived from the existing parent Section and full physical-range
containment. Same-page boundaries are compared as `(page, y)` pairs; multi-page KPs are supported,
crossing KPs are excluded, and no durable KP ownership is changed. Only UNCONFIRMED is updated;
NOT_FULLY_CLEAR and existing UNDERSTOOD remain intact. Both batch controls now show remaining
unclear counts. Section and Subsection controls are offset when their endpoints coincide.

- TARGETED: Learning suite **14/14 PASS**, including same-page adjacent ranges, a multi-page KP
  ending exactly at the boundary, crossing-KP exclusion, other-Section isolation, events/Topics,
  repeat confirmation, HTTP scope checks and restart recovery.
- REAL USE: extended `npm run test:e2e:master` **PASS** on an isolated copy of the same 348-page
  textbook, at `*1.1.1 计算机硬件的发展`. Its unclear KP remained unclear with count **1**; only
  its pending KPs changed, other Subsections/Sections stayed unchanged, a repeat click changed **0**,
  and restart recovered the exact status map. Existing Section confirmation and Master golden path
  also passed. Inspected screenshot: `test-results/subsection-confirmation.png`.
- AFFECTED / BROAD: **162 passed, 2 unchanged optional OCR skips**; frontend **30/30 PASS**.
  No new live-provider run: this addition makes no provider call and changes no provider/context code;
  the existing live-provider evidence above remains applicable.
- Retest service refreshed at **http://127.0.0.1:8766/**. Existing source-library Master threads,
  messages, events and statuses were preserved; golden-path writes stayed in the isolated copy.

Status remains `READY_FOR_USER_RETEST`; user and independent acceptance remain pending.

## Reproducible entry points

```powershell
python -m pytest tests/test_learning.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
$env:READER_CHROMIUM='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e:master
$env:MASTER_E2E_REAL='1'
npm run test:e2e:master
Remove-Item Env:MASTER_E2E_REAL
npm run test:e2e:ask
python -m pytest -o addopts='' -q
npm test
```

User retest service: `http://127.0.0.1:8766/`, using the existing
`D:\codex\408-guided-reader\var\manual-browser` Library. The pre-existing port 8000 service was not
stopped. Use 8766 for this implementation. Before startup, SQLite backup was verified at
`var/manual-browser/state.sqlite3.pre-master-20260910-ready.bak`. Migration preserves the original
2 Books, 220 KPs and 6 annotations; foreign-key check is clean. No test Learning history was inserted
into this source Library; golden paths used isolated copies.

Manual retest: open a READY Chapter's 学习地图, choose a KP's `这里没完全懂`, ask and follow up,
close/reopen Master, then restart the service and reopen via `继续 Master 对话`. Verify understanding
stays unchanged until `已经弄懂`. At a Section end, expand `本节确认` and use the batch action;
existing unclear KPs must remain unclear and display the notice.

## Important files / architecture entry points

- `src/reader_service/learning/{schema,repository,service}.py` — durable state, transactions, context,
  direct provider execution and independent Review.
- `src/reader_service/static/master-ui.js` — Dock and physical KP/Section controls.
- `src/reader_service/server.py`, `__main__.py` — authenticated API and startup recovery.
- `tests/test_learning.py`, `tests-e2e/master-learning.mjs` — invariant and real-use evidence.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its hash is recorded in the
handoff. It is a ready-for-user-retest checkpoint, not an acceptance or Phase-closure commit.
