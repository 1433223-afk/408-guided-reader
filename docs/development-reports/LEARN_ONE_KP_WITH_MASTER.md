# Learn One KP with Master Development Report

## Result

`READY_FOR_USER_RETEST` — user-authorized same-Phase Section Learning Check addition (2026-09-10).
Previous acceptance/closure at `fbe36d5` remains the baseline; it does not automatically accept this
addition. New user acceptance and independent narrow acceptance are PENDING. No new Phase is created.

Second-level Section cards now offer `都清楚了` and `还有些地方不完全清楚`. Clear sets every owned KP
to UNDERSTOOD, including previously unclear ones, resolves current Section state/Topic and preserves
history. Unclear records only Section state/event, opens Section Master and never guesses negative KP
statuses. Third-level `确认本小节` keeps its existing UNCONFIRMED-only behavior.

### Same-Phase implementation and evidence

- Migration 13 extends the existing Master thread and append-only event tables to carry exactly one
  real KP or Section scope, preserving old IDs and rows. SQLite table rebuild runs atomically with
  cascades temporarily disabled and foreign keys checked before commit. Only the Section state
  projection is added; reading-end remains a separate nullable axis, never inferred as mastery.
- Both scopes share the existing messages/Topics, enqueue/replay/retry/recovery, grounding/Review,
  provider runtime and Dock. Section context is its resolved source range and owned KP list; KP
  context remains unchanged. No automated multi-KP attribution, summaries or new teaching pipeline.
- TARGETED: new Section suite **5 PASS**: state choices, no negative KP inference, independent KP /
  Section threads, restart/retry, context scope, clear/history/lock, old-topic replay, transactional
  rollback, populated 12→13 migration, FK-failure rollback, book cascade and sibling-book isolation.
  Existing Learning/display/grounding suite **61 PASS** before the final unchanged-risk test additions.
- AGENT REAL USE: real 348-page textbook, isolated Library copies, `test:e2e:master` PASS. At Section
  `1.3 计算机的性能指标`, two Section questions persist across service restart and AI-off reopening;
  KP history remains separate. Formal clear sets all 11 Section KPs understood and retains Section
  messages/history. Existing Subsection and KP golden paths still pass. Controlled Section reviews
  both PASS; page/Dock/source controls stay operable. Screenshot: `test-results/section-master.png`.
- LIVE SECTION RUN (`MASTER_E2E_SECTION_REAL=1`): DeepSeek `deepseek-v4-flash` answered both Section
  questions; Zhipu `GLM-5.3-Flash` reviewed them. Actual review outcomes were **PASS, FAIL**: the second
  answer was incomplete, and the UI honestly retained its failed Review and retry affordance. The
  interaction/persistence path passed; this is explicitly **not** two live content-review PASSes.
  No mastery changed until explicit clear. No provider configuration or output-limit changes made.
- AFFECTED: `test:e2e:ask` PASS. All test writes used temporary/isolated data, not the source Library.
- Final BROAD: **214 passed, 2 unchanged optional OCR skips**; frontend **30/30 PASS**. Final
  controlled real-book rerun explicitly reported Section reviews `[PASS, PASS]`.
- Source Library backed up as `state.sqlite3.pre-section-master-20260910.bak` before migration;
  refreshed port 8766 responds HTTP 200. Migration 13 integrity/FK checks pass, all original columns
  and rows of KP, Master thread/topic/message, KP status, event and annotation tables match the
  backup. New Section state is empty until the user's own check; no test Section history was inserted.
- This addition needs its own independent scope/persistence/mastery review before eventual closure;
  the previous audit is not reused as acceptance of migration 13. Stop here at user retest as requested.

## Previous accepted baseline (`fbe36d5`)

`CLOSED / COMPLETE` / `USER_ACCEPTANCE PASS` (2026-09-10).

- Machine acceptance: PASS.
- Agent real-use: PASS with the real 348-page textbook, both configured live providers and controlled
  provider failure/retry.
- User acceptance: PASS — explicitly reported by the user in the implementation conversation on
  2026-09-10, after the display-endpoint correction at `3aff163`. The user authorized remaining
  closure work only, with no further UI/business changes or unrelated optimization.
- Initial independent narrow acceptance: BLOCK — a reproducible P1 source-attribution bypass was found.
  `PDF p. 999` can be durably accepted in Fast mode outside the supplied PDF-page allowlist although
  `PDF 第 999 页` is rejected. The initial closure-only turn therefore made no product changes.
  The user subsequently explicitly authorized fixing this P1 and independent recheck before closure.
  That bounded correction is implemented and independently rechecked; no finding was waived.
  Independent Codex reviewer `closure_audit` (not involved in implementation; not ZCode):
  **P0=0 / P1=1 / P2=0, recommendation BLOCK**. Full evidence and reproduction:
  [`LEARN_ONE_KP_WITH_MASTER_CLOSURE.md`](../reviews/LEARN_ONE_KP_WITH_MASTER_CLOSURE.md).
- Final independent narrow acceptance: **PASS, P0=0 / P1=0 / P2=0; recommendation CLOSE**.
  The same independent reviewer verified the correction without implementing it. Original and
  intermediate FAIL evidence remains in the report; the final verdict supersedes the open finding.
- Final regression: **209 Python passed / 2 unchanged optional OCR skips; 30/30 frontend PASS**.
  Real-book Master and Assistant E2Es PASS. All closure gates are satisfied under the user's explicit
  correction/closure authorization; no UI or unrelated work is included.

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
  and collapsed controls at KP physical ends expose the entry/history. Section/Subsection batch
  confirmation now uses the page-footer cards described in the latest layout refinement below.

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

- User-authorized closure-only verification on unchanged product commit `3aff163` (2026-09-10):
  `python -m pytest -o addopts='' -q` — **163 passed, 2 unchanged optional real-OCR skips**;
  `npm test` — **30/30 PASS**. No UI, business logic, provider configuration or user-library data
  changed during closure work. Existing real-book and live-provider evidence below applies to this
  already human-accepted implementation; no new live calls are made for documentation/audit work.
- Independent narrow audit: **15 focused tests PASS**; populated migration 11→12 preserved
  **13 pre-existing tables / 40 rows**, with integrity/FK checks clean. Independent injected-provider
  probes nevertheless reproduced durable acceptance of unsupported `PDF p. 999` and figure `999-9`;
  those passing tests do not override the P1 or authorize closure. All probes used temporary fixtures.
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

No open baseline narrow-review finding remains; the Section addition needs its own review.
Deterministic reference validation covers the supported
ordinary citation forms, not universal natural-language claim extraction or academic correctness;
previously saved answers are not rewritten. Section Master and the READY-Section two-option check
are now implemented above. Automatic multi-KP attribution, pre-READY reading-end offers, summaries,
global history UI and multimodal explanation remain outside this bounded addition.

## Same-Phase addition: Subsection confirmation (2026-09-10)

User-requested `一键确认本小节 KP` now appears at each resolved third-level Subsection end with
published KPs. It reuses the existing authenticated batch endpoint, transaction, append-only events
and permanent Chapter lock; there is no migration, new status or workflow.

Subsection membership is derived from the existing parent Section and full physical-range
containment. Same-page boundaries are compared as `(page, y)` pairs; multi-page KPs are supported,
crossing KPs are excluded, and no durable KP ownership is changed. Only UNCONFIRMED is updated;
NOT_FULLY_CLEAR and existing UNDERSTOOD remain intact. Both batch controls now show remaining
unclear counts. The subsequent layout correction below supersedes the initial endpoint offsets.

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

At this implementation checkpoint: `READY_FOR_USER_RETEST`; both acceptance gates were pending.

## Same-Phase UAT layout correction (2026-09-10)

The reported overlap came from controls positioned inside the PDF page; Subsection placement also
used the outline end, which can be the next heading's start. Controls now occupy a reserved right
gutter. Batch confirmation anchors to its own last contained KP's end and names the owning unit even
when collapsed. Expanding stacks controls upward without covering PDF content or pushing the batch
control into the next subsection. No learning state, scope, persistence or provider behavior changed.

- REAL USE / TARGETED: real 348-page `test:e2e:master` PASS on an isolated Library copy, including
  confirmation, unclear count, scope isolation, restart, Dock close/reopen and retry. Geometry checks
  prove controls stay outside every rendered PDF canvas at normal size, with the Dock open, zoomed,
  and at a 1100px viewport. The batch control names its owner and ends at/before its final KP end.
  Inspected `test-results/subsection-confirmation.png`: original text and the next heading are clear.
- AFFECTED: `npm run test:e2e:ask` PASS, including selection, navigation, Dock and temporary-tree
  recovery/isolation. CLOSURE/BROAD rerun: Python **162 passed, 2 unchanged optional OCR skips**;
  frontend **30/30 PASS**. Retest service at port 8766 responds HTTP 200 with the updated static UI.
- No new provider run is needed for this layout-only change; the prior live-provider evidence applies.

At this implementation checkpoint: `READY_FOR_USER_RETEST`, not acceptance or closure.

## Same-Phase lightweight footer refinement (2026-09-10)

The user approved placing batch cards below the PDF page where the unit's last contained KP ends,
rather than splitting PDF rendering to insert an operation between paragraphs. This supersedes the
previous right-gutter batch placement. Each non-floating, reading-column-width card names its owner,
shows total / understood / unclear counts, uses `确认本小节` or `确认本节`, and displays the requested
muted explanation beneath the compact button. Single-KP learning remains in the side gutter.

The existing button helper, batch endpoint and entries refresh are reused. No backend, business rule,
status, dependency or PDF/source geometry changed. Footer height is reserved in page spacing and
included in viewport retention; PDF page dimensions remain unchanged for selection and navigation.

- REAL USE: `npm run test:e2e:master` PASS on the isolated real 348-page Library copy. Verified
  refreshed counts (7 total / 6 understood / 1 unclear), no-op repeat confirmation, unchanged other
  scopes, restart recovery and the existing Master failure/retry path. Cards align below their own
  ending page and do not intersect rendered PDF canvases with Dock, zoom or 1100px viewport changes.
  Final screenshot inspected: `test-results/subsection-confirmation.png` (ignored personal material).
- AFFECTED: `npm run test:e2e:ask` PASS. Frontend tests **30/30 PASS**. No live-provider rerun for
  this presentation-only change; prior live-provider evidence remains applicable.
- CLOSURE/BROAD rerun: **162 passed, 2 unchanged optional OCR skips**.
- The initial UI test attempted to scroll a card while entries refresh replaced its DOM. It failed
  honestly; after awaiting the refresh settling, the complete real path passed twice.
- Port 8766 remains available (HTTP 200). Test writes stayed in cloned Library data, not user records.

At this implementation checkpoint: `READY_FOR_USER_RETEST`; no Phase closure was claimed.

## Same-Phase KP tag styling (2026-09-10)

CSS-only product change: collapsed KP entries now share a 124px width, compact padding/line height,
subtle neutral background/border and 2px corners. Hover and keyboard focus strengthen the affordance;
expanded entries retain reading space without a floating shadow. Existing source positions, collision
spacing, DOM structure, business logic and footer-card styles are unchanged. No guide line was added.

- REAL USE / TARGETED: `test:e2e:master` PASS on the isolated real 348-page book, now also opening and
  closing the actual KP tag before the existing confirmation/restart/retry path. No PDF overlap in
  the existing Dock/zoom/narrow-viewport checks. Inspected `test-results/kp-learning-tags.png` and
  retained the footer screenshot; both are ignored real-material artifacts, not synthetic mockups.
- AFFECTED: separate Assistant E2E `INTENTIONALLY_NOT_RUN` for this delta: only `.learning-marker`
  styles changed, with no Assistant selectors, layout algorithm or runtime changes. Master E2E still
  exercises the shared Dock. Prior Assistant regression passed in the immediately preceding change.
- CLOSURE/BROAD: Python **162 passed, 2 unchanged optional OCR skips**; frontend **30/30 PASS**.

At this implementation checkpoint: `READY_FOR_USER_RETEST`; no acceptance or closure was claimed.

## Same-Phase display endpoint correction (2026-09-10)

The reported KP `十进制数转换为任意进制数` has a published end at zero-based page 39, y=0.078125,
exactly the following page's running header. Using that endpoint put both its tag and the containing
Subsection footer on the next page. The user approved correcting display placement without changing
the published span or Learning records.

Learning entries now derive `display_end_page/y` from READY OCR lines inside the original range.
Known page-label text in margins and repeated margin text are excluded; unique near-top text and
genuine body continuations remain eligible. Missing usable evidence retains the original endpoint.
No generic document parser, new dependency, source migration or regeneration was introduced.
Source ranges, scope membership, Master payloads, identity and mastery-write paths are unchanged.
Existing narrow-margin handling in Knowledge semantic processing and Foundation page-label records
were inspected; the display projection reuses stored OCR/labels, without changing those pipelines.

- TARGETED: **15 PASS** across Learning and the new display test: header-only continuation rolls
  back to prior body; real cross-page body stays on the next page; repeated body is retained; unique
  near-top body, other-Book isolation, empty evidence fallback and no writes are covered.
- REAL USE: extended `test:e2e:master` PASS on an isolated copy of the user's 348-page book. The
  reported KP now displays at page 38, y=0.9097782373428345 (PDF 39); the card precedes PDF 40 and
  `2.1.2`. Open/close the actual tag, scroll across the boundary and verify unchanged entry/source/
  status data. Existing confirmation, restart, retry, payload and no-overlap checks also PASS.
  Inspected real screenshot: `test-results/learning-boundary-39-40.png` (ignored personal material).
- AFFECTED: Assistant real-use E2E PASS. CLOSURE/BROAD: **163 passed, 2 unchanged optional OCR
  skips**; frontend **30/30 PASS**. No live-provider rerun for the display-only projection; existing
  context/egress invariants and controlled-provider golden path were rerun.
- Restarted the 8766 retest service after a SQLite backup and a no-pending-Master-message check.
  HTTP 200; hashes of all 220 KP rows and every Master thread/topic/message, KP status and learning
  event match before/after restart. Port 8000 was not touched.

At this implementation checkpoint: `READY_FOR_USER_RETEST`; both acceptance gates were pending.

## Authorized P1 grounding correction (2026-09-10)

After the blocked audit checkpoint `aa2711f`, the user explicitly authorized correcting only the
source-reference bypass, independent recheck and closure. Changes are confined to the existing
Master grounding gate and tests: common Chinese/English PDF page forms, numeric lists/ranges and
typographic variants are checked against supplied PDF pages; figure identifiers are checked against
the supplied KP-local OCR. Both checks still run before answer persistence and before reviewer egress.
No UI, source scope, provider payload, status, schema, mastery rule or dependency changed.

- Reproduced both original failures before editing. Initial correction passed its tests but the
  independent reviewer found a CJK-adjacent form (`见PDF第999页`) missed by Unicode word boundaries.
  Fixed that same-P1 boundary and added invalid and valid Chinese-adjacent cases. The intermediate
  failure is retained in the independent report, not relabelled PASS.
- TARGETED final: **61 PASS**. Includes invalid/valid notation, absent figure IDs, page-range interior
  and reversed ranges, all three Review modes, retained FAILED intent, duplicate-free retry, unchanged
  mastery/Topic and rejection before reviewer calls when retrying a legacy unsupported answer.
- REAL USE: final `test:e2e:master` PASS on an isolated real 348-page Library copy. The HTTP provider
  returned `PDF p. 999`, then `教材图 999-9` during successive retries; both showed honest failures,
  kept the same five-message history/ACTIVE Topic/unclear status, and a valid retry added one answer.
  Existing explicit confirmation, restart, scope isolation and display checks also PASS.
- AFFECTED: `test:e2e:ask` PASS. No live-provider calls were needed for the deterministic gate change;
  prior live-provider evidence remains applicable. No real-user Library writes occurred in tests.
- Final CLOSURE/BROAD: **209 passed, 2 unchanged optional OCR skips**; **30/30 frontend PASS**.
- Independent re-review PASS on service SHA-256
  `0E05158E086F969DDA9D43FB5FA42F71238E667BEB3338573FE647DE30BE94D7`: final 61 focused tests plus
  separately authored notation/durable retry experiments; P0=0 / P1=0 / P2=0, CLOSE recommended.
- Refreshed port 8766 after a consistent backup and no-pending-message check; HTTP 200. All source
  KP, Master thread/topic/message, KP status and event rows equal their pre-restart snapshots.

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
stays unchanged until `已经弄懂`. Below a unit's ending PDF page, check its named footer card and
click `确认本节` / `确认本小节`; existing unclear KPs must remain unclear and retain their count.

## Important files / architecture entry points

- `src/reader_service/learning/{schema,repository,service}.py` — durable state, transactions, context,
  direct provider execution and independent Review.
- `src/reader_service/static/master-ui.js` — Dock and physical KP/Section controls.
- `src/reader_service/server.py`, `__main__.py` — authenticated API and startup recovery.
- `tests/test_learning.py`, `tests-e2e/master-learning.mjs` — invariant and real-use evidence.

## Git checkpoint

Human-accepted baseline implementation: `3aff1639c4679c728ee924a6468e8bd15836df8d`.
Initial blocked-audit checkpoint: `aa2711f`; baseline grounding correction and closure: `fbe36d5`.
The commit containing the current Section addition is a **READY_FOR_USER_RETEST checkpoint**, not
new user acceptance or Phase closure. Its hash is recorded in the handoff.
