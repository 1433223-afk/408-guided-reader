# Learn One KP with Master Development Report

## Result

The previously closed Phase remains historical acceptance. User-approved same-Phase amendments now
cover stable Master Topic identity (2026-09-14) and model/reasoning/Review streaming controls
(2026-09-15). The current rework is `IMPLEMENTATION_READY / READY_FOR_USER_RETEST` and does not claim
new user acceptance.
The earlier Section Learning Check and reading-position UAT correction remain `CLOSED / COMPLETE` /
`USER_ACCEPTANCE PASS` at `f4c76db`; independent narrow acceptance for that earlier closure is PASS.
No new Phase is created.

### Master answer selection to Assistant Root (2026-09-16)

Master answer text now uses the same `#selection-actions` floating toolbar as Reader text. A
right-click inside one accurately mapped rendered selection exposes only `复制` and `问 AI` in both
the normal Dock and expanded Master workspace; no second context-menu component or styling system
was added. Markdown markers are excluded through the existing rendered-to-raw mapping, and code/math
regions that cannot be mapped honestly remain blocked instead of producing a guessed source span.

`问 AI` creates a new in-memory Assistant Root whose source kind is `MASTER_ANSWER`. The server
revalidates the supplied spans against the durable completed Master answer and records provenance to
the exact Master thread, Topic, intent, user question and answer message. This provenance stays in
application state: the provider-visible payload starts with the exact selected focus, explicitly says
that it came from a Master answer rather than textbook prose, and adds only bounded Reader grounding
from the owning KP/Section. Topic/message IDs, raw spans and the `MASTER_ANSWER` enum do not enter the
provider body. The Master conversation, Topic state and mastery projection are read-only throughout;
the draft itself performs zero provider calls. Because this source has no original PDF selection
anchor, saving it as a PDF-anchored note is rejected rather than inventing one.

Verification used the real 348-page `2026计算机组成原理` Library and a retained ISA Master Topic.
In the current port 8767 site, a real mouse drag over `教材 PDF 第169页进一步列出 ISA` in normal Dock
showed only `复制 / 问 AI`; opening the action produced an Assistant draft labelled
`正在解释：Master 回答选区` with the exact visible text. The same real pointer path over bold rendered
text in expanded mode showed the identical toolbar next to the selection. The focused mock-provider
E2E additionally sent the Root, proved exact `CURRENT FOCUS`, the Master-source notice, bounded
Reader grounding, metadata exclusion, and an unchanged before/after Learning snapshot.

- TARGETED: new provenance/API test **PASS**; nearest Assistant context/save regressions **15 PASS**;
  frontend suite passed **51/51** at the completed implementation state.
- REAL USE / E2E: `npm run test:e2e:master-stream` **PASS**, including normal and expanded selection,
  zero provider calls on draft creation, one DeepSeek-only mock call on Send, transport inspection and
  unchanged Master state.
- Screenshots: `test-results/master-answer-selection-normal.png` and
  `test-results/master-answer-selection-expanded.png` (real 348-page Library material).
- A later whole-frontend run against concurrent, unrelated uncommitted Book Overview lifecycle work
  reported **50/51** with only `chapter-entry.test.js` timing out while waiting for `已理解`; its
  isolated rerun timed out identically. That failure is not relabelled PASS and is outside this
  bounded Master/Assistant interaction delta; the directly related Master E2E above remained PASS.

Status: `IMPLEMENTATION_READY / READY_FOR_USER_RETEST`; no Phase closure or user acceptance claimed.

### Master model / reasoning / Review streaming rework (2026-09-15)

**Confirmed baseline and authority.** Before implementation, the running service identified the
Master answer route as native DeepSeek `deepseek-flash` and the independent Review route as Zhipu
`GLM-5.3-Flash`. The user authorized migration 19 and the same-Phase behavior amendment. Product
§30.3, Implementation §13.7 and this Phase brief now separate answer-model/reasoning controls from
Review: Review defaults to `Fast`, while `Standard` and `Deep` Review remain selectable from the
Topic's low-frequency menu. Topic identity, persistence, Mastery, grounding and Review verdict
semantics are unchanged.

**Execution and UI.** The Composer exposes low-weight answer-model and `快速` / `深度` choices beside
Send. A durable question records its selected provider/model/reasoning mode before provider egress;
retry and restart reuse that identity and never fall back. Master now uses the shared SSE transport:
answer deltas and provider reasoning deltas are distinct events. Returned reasoning appears under
`正在思考` / `思考过程`; providers that return none get no synthetic reasoning. Only the grounded final
answer is stored and reviewed. Review remains non-streaming, defaults to Fast, and its selector moved
from the Composer into `…` beside `已弄懂`. Provider-specific readiness disables only the selected
provider and gives a concrete reason.

DeepSeek Deep uses a bounded per-call generation budget of `12,288` tokens because provider
reasoning and the final answer share that budget; Quick keeps the provider default of `4,096`.
The runtime-wide `16,384` hard ceiling, 120-second timeout, no-fallback rule and explicit-only
recovery after `response_length_limit` remain unchanged, so the larger budget reduces ordinary
mid-answer truncation without introducing automatic continuation or an unbounded replay loop.

**Migration 19.** `master_messages.reasoning_mode` is additive, `NOT NULL`, constrained to `Quick` /
`Deep`, and defaults historical rows to `Quick`; reasoning content has no durable column. Before the
real 348-page Library upgrade, the service created
`var/manual-browser/state.sqlite3.pre-migration-19.bak`. The backup has migration 18, 20 messages,
`integrity_check=ok` and zero FK violations. The upgraded database has migration 19; all 20 historical
messages were preserved as Quick. The six later real-use question/answer records bring the current
count to 26 (`Quick=24`, `Deep=2`), with `integrity_check=ok` and zero FK violations.

**Real provider evidence.** On the real 348-page textbook's retained ISA Topic, native DeepSeek
`deepseek-flash` answered `请深入解释为什么同一 ISA 可以有不同性能的微架构实现，并给一个简短例子。`
in Deep mode. The visible reasoning stream grew `0 → 87 → 330 → 530 → 715` characters before the
separate final answer, which correctly distinguished ISA from microarchitecture. The persisted pair
records `reasoning_mode=Deep`, `review_mode=Fast`, `review_state=NOT_REQUESTED`, and contains no
reviewer or reasoning body. The subsequent Quick question
`快速模式下，用一句话说明 ISA 的作用。` streamed visible answer characters
`0 → 0 → 47 → 105 → complete` with reasoning length always zero. The protected local request
inspector shows `stream:true` and DeepSeek `thinking:{type:"disabled"}` for that Quick call; no
credential is retained. Review calls added in both Fast cases: `0`; no provider fallback occurred.

**Verification.** Targeted Learning/Assistant Python tests PASS; frontend `npm test` is **47 PASS**;
`conversation-composer.mjs`, `master-streaming.mjs` and the broader `master-learning.mjs` all PASS.
The focused E2E covers genuine Quick and Deep incremental delivery, separate transient reasoning,
provider-specific request mapping, Fast Review isolation, readiness isolation and stale-readiness
recovery. Final integration reran the closure-level Python suite at **319 passed / 2 unchanged optional OCR
skips** and updated only the broader E2E's obsolete entry path to use the current PDF-local KP marker
and low-frequency Topic menu; no Product behavior changed.
The later DeepSeek budget adjustment passed **12 targeted Python cases** covering Quick/Deep request
options, durable retry identity, the hard per-call ceiling, bounded transient retry/cooling and
explicit recovery after a length-limited response. The focused Master streaming E2E also inspected
the final mock-provider bodies: Quick `max_tokens=4096` with thinking disabled; Deep
`max_tokens=12288` with thinking enabled; Review calls remained zero.

**Screenshots.** `test-results/master-streaming-reasoning.png` records the live served Master SSE
surface with an open reasoning stream; `test-results/master-model-reasoning-review-menu.png` records
the completed separate reasoning surface, answer model/reasoning Composer controls, and Review in the
low-frequency menu. A computer-use pass also inspected the real retained ISA Topic showing the real
Deep answer and the later Quick answer in the current served UI.

**Deferred by design.** Reasoning text is session-transient and therefore is not reconstructed after
reload; no persistent chain-of-thought store, telemetry, generic streaming framework, new provider,
new endpoint or egress category was introduced. This section supersedes the initial Phase baseline's
historical `Streaming` Not-now and `Standard`-default wording only for this authorized rework.

Second-level Section cards now offer `都清楚了` and `还有些地方不完全清楚`. Clear sets every owned KP
to UNDERSTOOD, including previously unclear ones, resolves current Section state/Topic and preserves
history. Unclear records only Section state/event, opens Section Master and never guesses negative KP
statuses. Third-level `确认本小节` keeps its existing UNCONFIRMED-only behavior.

### Stable Master Topic identity amendment and repair (2026-09-14)

**Root cause.** `LearningRepository._open()` looked up only `state='ACTIVE'`. Once `已弄懂`
changed a Topic to `RESOLVED`, the next explicit open or Send inserted a new ACTIVE Topic in the
same durable learning thread. The sidebar faithfully rendered both rows; this was identity
fragmentation, not a title-rendering duplicate. Plain GET history/restart was read-only, while the
old continuation path deliberately minted. Existing Product §26.1, Implementation §15.5 and two
tests encoded that obsolete continuation model.

**Authority and lifecycle.** The user explicitly amended Product §26.1/§26.2 and decision 56 plus
Implementation §15.5; Architecture Decision A-20 records one durable Topic per MasterThread. ACTIVE
and RESOLVED are evidence states on that identity. Reopen, revisit, restart and ordinary Send reuse
the same `topic_id`; ordinary chat changes neither Topic state nor KP/Section mastery. An explicit
unresolved-evidence API action may reactivate the same Topic, while its mastery effect remains gated
by the existing explicit-evidence rules. The retired UI phrase `继续提问（新话题）` is now simply
`继续提问`; no removed `仍不清楚` entry was reintroduced.

**Source and schema.** `_open(..., reactivate=False)` now selects the thread's Topic regardless of
state. Only the explicit `/open` evidence path requests reactivation; enqueue/Send does not. Migration
18 backs up the database, selects each thread's earliest Topic as canonical, redirects messages and
LearningEvent references, preserves the latest effective Topic state, deletes only the duplicate
Topic rows, restores the append-only trigger and replaces the ACTIVE-only partial index with unique
`master_topics(thread_id)`. This is a one-time bounded migration plus structural guard, not a generic
deduplication subsystem.

**Authorized real-library cleanup.** Before migration the live 348-page Library had 21 Topics in 16
threads, four duplicate threads and five extra Topics. Between dry-run and execution the user added
one real question/answer pair to duplicate Topic `72bfe6dd-94a2-4aeb-840a-678b350ffd92`, so the safe
execution baseline was 14 messages rather than the earlier observed 12. Those two messages were
merged into earliest canonical `b9e0c2f2-0558-492f-ad51-36dc38a2b7e4`; deleting them to force the
stale count would have violated conversation preservation. The other canonical mappings were:

- `6c65ad44-b578-45d4-8e31-423cea302f12` → `caf8f747-721b-4980-a8d9-a58e1a3c6f19`;
- `06ab2d91-3560-46bd-98ac-5f1573abdc26` → `542c0989-31a3-4405-9f2b-bdaad654b539`;
- `2c6b4331-d649-47a3-873b-0692a1a36739` and
  `16a3241a-44c0-47ab-b87c-614de21ff207` →
  `02f76afe-08e6-48fa-9dde-6bda3c9a7da6`.

The verified pre-migration backup is
`var/manual-browser/state.sqlite3.pre-migration-18.bak`. Actual results: Topics `21 → 16`, duplicate
threads `4 → 0`, threads `16`, messages `14`, Learning History `48`, Learning Memory `2`, KP status
rows `35`, Section state rows `1`. Message/event content and IDs, all Memory relations, KP/Section
mastery projections and thread identities match the backup; only merged Topic references and the
canonical latest Topic state differ. `PRAGMA integrity_check = ok`, foreign-key violations `0`,
`learning_events_no_update` restored, migration marker `18`, and `one_master_topic_per_thread`
present.

**Verification.** Targeted Learning + Section tests: **30 PASS**, covering resolved continuation on
the same ID, mastery-neutral Send, explicit same-ID reactivation, restart/GET no-write behavior,
eight-way concurrent open, Section semantics, migration of unique messages/events/Memory and unique
constraint enforcement. Full Python closure suite: **289 passed / 2 unchanged optional OCR skips**.
Frontend unit suite: **43 PASS**. Master conversation workspace E2E: **PASS**, external provider calls
`0`. On the migrated real site, expanded Master showed exactly 16 unique Topic IDs; opening
`存储器的性能指标概述` displayed the two preserved messages now attached to its earliest canonical.

The broader real-book `test:e2e:master` was attempted, not reported as PASS: its old book-card entry
assumption was corrected to traverse Book Overview, after which an unrelated dynamic learning-marker
`scrollIntoViewIfNeeded` detached-DOM race stopped the script before its Master flow. This bounded
repair does not alter that Reader-marker subsystem; the directly relevant real-site Master history
path above passed without provider or mastery writes.

### Section addition closure verification (2026-09-10)

- User acceptance: **PASS**, explicitly reported after the reading-position fix at `f4c76db`.
- Independent narrow acceptance: **PASS; P0=0 / P1=0 / P2=0; CLOSE**, by independent Codex reviewer
  `section_closure_audit` (not ZCode, not the implementer). **65 focused tests PASS**, plus independently
  authored concurrent unclear/send/clear, stale-Topic/in-flight answer, append-only history, scope XOR
  and Section source/context isolation probes on disposable fixtures. No findings were waived.
  Full evidence: [`LEARN_ONE_KP_WITH_MASTER_SECTION_CLOSURE.md`](../reviews/LEARN_ONE_KP_WITH_MASTER_SECTION_CLOSURE.md).
- Closure-only BROAD rerun on unchanged product code: `python -m pytest -o addopts='' -q` —
  **214 passed / 2 unchanged optional OCR skips**; `npm test` — **30/30 PASS**.
- Real-book Master, Assistant and reading-position golden paths passed at the same accepted code
  immediately before user retest (details below). No new live calls or source-Library writes were
  needed for this documentation/audit-only closure; the recorded live Review FAIL remains FAIL.
- No UI, Master, KP state logic, schema, provider configuration or unrelated product code changed.
- All closure gates for this addition are satisfied. Phase/index now record **CLOSED / COMPLETE**;
  the closure checkpoint contains documentation only.

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
- The original implementation stopped at user retest. The user has now accepted the addition and
  its own independent scope/persistence/mastery review passed. The previous audit is not reused
  as acceptance of migration 13.

## Same-Phase reading-position UAT fix (2026-09-10)

Originally `READY_FOR_USER_RETEST`; now covered by the user's explicit PASS at `f4c76db`.

- Reproduced on an isolated copy of the real 348-page Library: navigation to PDF page 50 saved
  successfully (HTTP 200), but reload/open saved page 1 over it. Page 70 with delayed PDF loading
  reproduced the same defect. Master-entry gutter relayout captured the initial placeholder viewport
  and changed `currentPage` before the stored reading position was restored.
- Minimal frontend-only correction: pre-restoration relayout sizes placeholders without restoring a
  viewport anchor; PDF readiness is published only after reading-position restoration. Debounced
  and pagehide saves reject the unrestored placeholder state. The existing open-generation check
  also runs after the animation-frame wait. No new state, schema, UI or learning-rule changes.
- TARGETED: Library/API tests **13 PASS**. New `npm run test:e2e:position` **PASS** on a real-book
  clone: refresh, Library close/reopen, held PDF load (including pagehide with zero premature writes),
  service restart, PDF page 50 / in-page offset / zoom restoration, unchanged Learning entries.
- AFFECTED: controlled real-book Master E2E **PASS**, including Section/Subsection isolation,
  Section reviews `[PASS, PASS]`, durable history/retry and explicit confirmation. Assistant E2E
  **PASS**, including Reader/Dock close/reopen and AI-off navigation. No new live-provider calls:
  provider execution, context and Review code are unchanged.
- BROAD: Python **214 passed / 2 unchanged optional OCR skips**; frontend **30/30 PASS**.
- Port 8766 serves the updated script with `Cache-Control: no-store`; no service restart or source
  Library write was required. Refresh the existing page before retest. Already overwritten historical
  positions are not reconstructed or guessed by this fix.
- Reproduce with `READER_DATA_DIR` pointing to the prepared Library and
  `npm run test:e2e:position`; it backs up SQLite and copies blobs into a temporary test Library.
  This local restoration-order correction does not add an independent-review trigger; the Section
  addition's separate narrow review is now complete, as recorded above.

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

No open baseline or Section-addition narrow-review finding remains.
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

## Same-Phase chapter-local Master conversation history (2026-09-15)

The expanded Master sidebar is a read-only conversation-history projection for the Reader's current
Chapter. It no longer treats KP/Section state, `open`, preparation, or an empty durable Topic as a
navigation item. A Topic appears only after one `COMPLETE` user message has a matching `COMPLETE`
Master answer for the same intent. ACTIVE and RESOLVED Topics use the same rule, so `已弄懂` remains
a lightweight state on an existing conversation rather than sidebar identity.

The authenticated Learning GET accepts a validated `chapter_id`; KP Topics are scoped through the
published KP's Chapter and Section Topics through their owning Chapter. Missing Chapter identity
returns no Topic list, and a Chapter outside the revision is rejected. The Reader updates this
identity from its actual viewport; the expanded sidebar refreshes on Chapter changes and ignores a
late response for a Chapter that is no longer current. The UI says `本章对话`, has an explicit empty
state, and contains history-open buttons only—there is no create input or new-conversation action.
Clicking an item reads its complete durable history without a Learning write.

No Topic, message, Learning History, Memory, KP/Section state, mastery value, provider payload, or
durable identity was changed or deleted. Empty/state-only legacy Topics remain intact in storage and
are hidden only by the authoritative server projection; this is not title deduplication.

- TARGETED: the Learning tests cover open-only, state-only and incomplete-message exclusion;
  complete-exchange inclusion; RESOLVED retention; same-Topic follow-up; Chapter isolation;
  missing/invalid Chapter identity; and read-only Topic navigation.
- REAL USE: `test:e2e:master-history` PASS on an isolated copy of the real 348-page Library. It proves
  current-Chapter-only entries, complete-conversation-only inclusion, zero Learning writes when
  reopening history, zero entries in an empty Chapter, and restoration after returning. Result:
  `navigationWrites=0`, `emptyChapterItems=0`.
- UI hygiene: semantic buttons, current-item state, the descriptive `当前章节 Master 对话` label and
  a visible empty state are retained. No visual redesign or additional navigation is introduced.

## Reproducible entry points

```powershell
python -m pytest tests/test_learning.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
$env:READER_CHROMIUM='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:e2e:master
npm run test:e2e:master-history
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

Manual path for the accepted Section addition: at a READY Section's footer, choose
`还有些地方不完全清楚`, ask/follow up in Section Master, then close/restart/reopen its history.
KP statuses remain unchanged. Explicit `都清楚了` confirms all owned KPs (including unclear ones),
resolves the current Section check and retains its history. Subsection `确认本小节` still changes only
UNCONFIRMED KPs and preserves its unclear count. KP-local Master remains independent. Verify reading
page/offset/zoom after refresh, Library reopen and service restart.

## Important files / architecture entry points

- `src/reader_service/learning/{schema,repository,service}.py` — durable state, transactions, context,
  direct provider execution and independent Review.
- `src/reader_service/static/master-ui.js` — Dock and physical KP/Section controls.
- `src/reader_service/server.py`, `__main__.py` — authenticated API and startup recovery.
- `tests/test_learning.py`, `tests-e2e/master-learning.mjs` — invariant and real-use evidence.

## Git checkpoint

Human-accepted baseline implementation: `3aff1639c4679c728ee924a6468e8bd15836df8d`.
Initial blocked-audit checkpoint: `aa2711f`; baseline grounding correction and closure: `fbe36d5`.
Section addition: `015b57a`; reading-position UAT correction and user-accepted code: `f4c76db`.
The documentation-only closure checkpoint is the commit containing the final closure evidence;
its exact hash is recorded in the handoff.
