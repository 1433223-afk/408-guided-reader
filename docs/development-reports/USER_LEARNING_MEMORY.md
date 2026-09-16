# User Learning Memory — Curated V1 Development Report

## Result

**CLOSED / COMPLETE — 2026-09-12. Latest browser IA pass READY_FOR_USER_RETEST — 2026-09-15.**
User acceptance explicitly confirmed **PASS** by the user. Final independent narrow review **PASS**
(P0=0 / P1=0 / P2=0, recommendation **CLOSE**); machine and real-use acceptance PASS.
The accepted durable product boundary remains unchanged; the latest presentation-only deletion pass
awaits user retest and does not supersede the earlier acceptance claim.

Completed Master answers and durable AI_SAVED notes offer explicit collection and collected status.
Library home opens an independent Learning Memory page outside Reader with Book/Section/KP filters,
content-first details, quiet source context, and one return action to the actual Master message or
saved note/PDF. Normal PASS and engineering provenance remain out of the learning view; only pending
or failed Review states appear in compact form. Removing membership preserves its source. No automatic
enrolment or learning update.
Reader contains no Learning Memory browser or removal action; management belongs to the independent page.

## Implemented

### Book → Section → KP browser IA (2026-09-15)

Replaced the database-style Book/Section/KP dropdown strip with a browse hierarchy. The Memory home
now contains only Books that own memberships and their counts. A Book opens a dedicated view with
an Outline-backed Chapter/Section rail containing only nodes that own Memory, KP content groups,
compact item rows and the existing content-first detail. Search is hidden until requested and is
strictly scoped to the current Book. There is no manual refresh control; opening the collection and
membership mutations use the existing API refresh path.

Durable identity and provenance are still resolved by the existing service. The UI derives Chapter
placement only by following the authoritative Outline parent chain; missing Section/KP associations
remain in an honest **其他** group. Source return and membership removal reuse their existing routes.

- TARGETED FRONTEND: `node --test tests-js/memory-ui.test.js` **4 PASS**, including current-Book
  search isolation, removal race protection, Section-only grouping, low-frequency technical Review
  presentation and the absence of the old filter/refresh controls.
- SHORTEST REAL PATH: `tests-e2e/memory-navigation.mjs` PASS on an isolated copy of the real Library:
  Learning Memory → Book → Section/KP → item → source → Book list. All providers were disabled.
  The requested full 348-page collect/restart/cascade flow and broad suites were intentionally not
  rerun because this pass changes only the local Memory browser IA.
- Visual checks: `memory-ia-home.png`, `memory-ia-book.png` and `memory-ia-detail.png` at 1600×1000.
  No new dependency, API, persistence behavior or cross-Book search was introduced.

The accepted IA cleanup keeps the left rail strictly Chapter → Section and the content column grouped
by authoritative KP. A record with Section but no KP appears only in that Section's subdued
**未归属知识点** area. Missing structural authority uses the explicit labels **未关联章节** and
**未关联 Section**, never a parallel “other memory” taxonomy. Technical Review failure is absent
from list and content surfaces and is available only inside the item's existing `···` menu; PASS
remains hidden and content FAIL remains the only prominent failure state.

### UI deletion pass (2026-09-15)

Removed the standing explanatory copy, second-level collection timestamps, duplicate original-answer
and raw-Markdown disclosures, provider/model/reviewer provenance, missing-anchor engineering copy and
normal PASS labels. List rows now contain a title, two-line rendered-text excerpt, one compact source
line and only an actionable exceptional state. Master and Assistant use quiet source markers. Details
lead with the rendered content; one **返回来源** action preserves the existing type-specific return
route, while **移出学习记忆** moved into `···` without changing its DELETE boundary.

- TARGETED: `tests/test_memory.py` **4 PASS**; `npm test` **47 PASS**; JS syntax checks PASS.
- AGENT REAL USE: `tests-e2e/learning-memory.mjs` PASS on an isolated copy of the real 348-page
  textbook, SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  It exercised Master and Assistant collection, compact list/detail rendering, a real
  `TECHNICAL_FAILURE`, both source-return routes, restart, remove/recollect and source deletion.
  Providers stayed disabled; protected learning/publication table hashes and Assistant inspection
  remained unchanged.
- BROAD: full `python -m pytest -q` PASS with the repository's two unchanged optional skips.
  Screenshots `memory-list.png`, `memory-master.png` and `memory-review-failure.png` were visually
  inspected at 1600×1000; the collection also passed its 1000×800 overflow check.

### Content-first detail follow-through (2026-09-12)

Checked the amended Accepted brief against current code: independent home entry, Reader collect-only
behavior, Book/Section/KP browsing and source/removal boundaries already existed. The remaining
presentation gap was that collection navigation and provenance pushed the answer below the first
screen. Details now prioritize question, visible trust status and original answer; collection intro
and filters return when leaving details. Source and review metadata remain available in an explicit
disclosure after the answer, along with complete original text and source/removal actions.

- TARGETED: both Memory browser regressions PASS. Real 348-page golden path PASS with AI disabled,
  including answer position, opening/closing provenance, return-to-list filter preservation, both
  source returns, restart and removal/cascades. Screenshots visually checked. No persistence or
  provider changes; existing narrow review boundaries are unchanged.
- The first real-use run failed because its fixture assumed the user's Memory was empty. The harness
  now resets memberships only in its isolated SQLite backup before testing; original user content
  and memberships are untouched. The complete rerun passed.
- BROAD: `test-results/memory-content-closure.xml` **278 PASS / 2 unchanged optional OCR skips**;
  `npm test` **35 PASS**. JS syntax and diff whitespace checks PASS.
  This is a local application of the user's content-first principle, with no external code/UI reuse,
  new dependency, homepage/Reader restructuring or new product capability.

### Same-Phase independent learning space and visual consistency (2026-09-12)

User requested strict visual continuity and then explicitly moved browsing/management outside Reader.
The Library toolbar entry opens a sibling full-page view with the existing brand header, paper
background, warm borders, gold-brown controls, compact metadata and serif heading hierarchy.
Reader offers only collection and a disabled collected indication; removal remains in Memory details.
Source return reuses existing book/Master/Marks navigation. Review colors retain existing trust classes.

- Changes are local presentation/classes/entry placement. A real close/reopen check also exposed a
  local stale-list race; opening now clears old interactive cards until its fresh list is rendered.
  No schema, source content, provider, membership or learning-state boundary changed.
- TARGETED: the existing two Memory browser regressions PASS, retaining explicit retry intent and
  complete original access. AGENT REAL USE / affected path: `test:e2e:memory` PASS on an isolated
  real 348-page copy, including 1600px and 1000px independent views, home/Reader isolation,
  collect-only Reader controls, close/reopen, both source returns,
  restart and removal/cascade checks. No horizontal overflow in the narrow collection. Visually
  inspected Library, list, narrow list and both source-detail screenshots under `test-results/memory-*`.
- BROAD: `test-results/memory-space-closure.xml`, **278 PASS / 2 unchanged optional OCR skips**;
  `npm test`, **35 PASS**. The original narrow review still covers unchanged durable/security behavior;
  this local visual change adds no independent-review trigger. No live provider calls or user-data
  test writes. This refinement checkpoint was **READY_FOR_USER_RETEST**; final user acceptance
  is recorded above.

### Original implementation

- Additive migration 16: one five-field relation (ID, owning source revision, source kind/ID,
  collection time). Unique source identity, transactional eligibility/ownership checks and replay,
  immutable relationship identity, source-deletion hooks and owning-revision cascade. Cross-context
  source IDs remain soft references; no extra body, summary, title or trust-state copy is stored.
- Authenticated collect/list/open/remove API accepts source kind/ID only. Reads resolve existing
  messages, originating user turn, Topic and Annotation metadata. Removing only deletes membership.
  No provider/runtime, Mastery, KP/Section state, Learning History or Teaching writer is invoked.
- Master provenance follows its real thread scope. Assistant uses its existing durable Annotation;
  Section is derived only when its entire original PDF geometry lies in one resolved Section, or
  from existing legitimate KP ownership. Absent/ambiguous associations stay unassociated; no title
  matching, answer-text inference or synthetic Master PDF anchor.
- Existing sanitized Markdown/math rendering remains bounded at 50,000 characters in this normal
  learning view. The durable source remains unchanged, but raw Markdown is no longer duplicated in
  the UI. Trust state remains live; collection does not retry Review, change verification or imply mastery.
- SQLite backup is integrity checked and compared against the full existing database before migration.
  The startup statement explains the additive relation and preservation of existing assets.

## Important decisions / prior art

Followed the accepted brief's completed Mem0/DeepTutor prior-art adjudication: explicit promotion,
stable provenance, compact relation separate from content, metadata-led browsing. No additional
framework, dependency, copied external implementation, vector system or automatic memory pipeline.
Assistant promotion remains the existing Save-to-Notes action; collection is available on the durable
AI_SAVED Marks card, never on a temporary Assistant tree.

## Acceptance evidence

- **FINAL CLOSURE:** on accepted `c702316`, reran Memory targeted tests **4 PASS**
  (`test-results/memory-final-targeted.xml`), real 348-page `test:e2e:memory` **PASS**, full Python
  suite **278 PASS / 2 unchanged optional OCR skips** (`test-results/memory-final-closure.xml`),
  and `npm test` **35 PASS**. The real-use run used an isolated backup of the now-populated user
  Library, with providers disabled, source returns/restart/removal/recollection/cascades verified
  and protected state unchanged. No new external calls or test writes to the user's Library.
  Final independent reviewer separately ran **42 Python tests**, **2 browser regressions** and a
  disposable page/trust/recovery probe, all PASS; details and scope are in the review report.
  No new findings or deferred closure defects. Prior affected Master/save/Assistant regression
  evidence below remains applicable; closure introduced no code change. Diff whitespace check PASS.
- **TARGETED:** `tests/test_memory.py`, **4 PASS**. Real-thread concurrent repeats, replay, exact
  content/source identity, current Review states, failed/pending/user-role exclusion, owner/auth
  checks, restart, remove/recollect, Annotation/Book cascade and populated migration preservation.
- **AGENT REAL USE:** `npm run test:e2e:memory`, **PASS** on isolated copies of the real 348-page book,
  SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
  Used the user's already completed durable Master answer and already promoted AI_SAVED note;
  generated no replacement test answer. All providers disabled throughout the Memory golden path.
  Actual controls exercised collect, filters, full details, Master message focus, Marks/PDF return,
  Reader close, service restart, AI-off recovery, remove/recollect, Annotation deletion and isolated
  Book deletion with sibling revision preservation. Protected Master/KP/Section/history/Knowledge/
  Teaching/publication table hashes and provider inspection stayed unchanged before source deletion.
  Screenshots `test-results/memory-master.png` and `memory-assistant.png` visually inspected.
- **AFFECTED:** **107 Python tests PASS** across Memory, Master/Section/grounding/display,
  AI_SAVED/Annotations, API, Library and storage. Existing real-book `test:e2e:master`,
  `test:e2e:save` and `test:e2e:ask` **PASS**. These independently exercise current commit-first
  Assistant promotion/verification, recursive temporary cleanup, Master persistence, source return,
  restart/recovery and AI-off behavior. Provider responses in these regressions are loopback fixtures;
  **zero external provider calls**. No historical live-model review is claimed as a new result.
- **BROAD:** `python -m pytest -o addopts='' -q --junitxml=test-results/memory-closure.xml` —
  **278 PASS / 2 unchanged optional real-OCR skips**. `npm test` — **35 PASS**, including two
  independently authored browser regression tests. Compile, JS syntax and diff whitespace checks PASS.
- **INDEPENDENT NARROW:** [review](../reviews/USER_LEARNING_MEMORY.md), **PASS, outstanding
  P0=0 / P1=0 / P2=0**. Two real P2 findings were fixed and independently rechecked: response-loss
  retry reversing collect into remove, and inaccessible long-answer tails. They were not waived.
- Initial fixture mistakes and UI focus/test-selector failures were corrected before complete passing
  reruns. One old Assistant harness run failed while recursively copying a disappearing SQLite SHM
  file; a serial rerun passed. These failed invocations were not treated as PASS.
- Retest service **http://127.0.0.1:8767/** uses the existing `var/manual-browser` Library. Before
  startup, no pending jobs/messages/reviews existed. Migration 16 backup and FK checks passed;
  **every pre-existing table's row hash matched before/after startup**. Memory was empty at that startup;
  no test enrolment/deletion or generated content entered the user's Library. Existing approved
  runtime routing is retained: native DeepSeek `deepseek-flash`; OpenRouter routes explicitly
  `google/gemini-3.8-flash`; Zhipu disabled. Startup made no generation or Review call.

## Deviations / limitations

No scope deviation. The Memory golden path reuses genuine already-saved source content; fresh
Save-to-Notes promotion is proven separately by the existing controlled-provider real-book save
regression. No live generation is needed for this provider-free feature. Optional real-OCR external
fixtures remain unavailable and unchanged; the required full 348-page material was available.
User acceptance is the user's explicit PASS, distinct from the independent implementation review.
Full formatted rendering keeps its existing bound; the durable source remains unmodified even though
the normal detail view no longer duplicates the raw Markdown.

## Reproduction and entry points

```powershell
python -m pytest tests/test_memory.py
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:memory
```

Manual retest: open a completed Master answer → **收入学习记忆**. In **本页标记**, collect an
**AI 保存的解释** (save an Assistant answer to Notes first if needed). Open **学习记忆** from the
Library home after leaving Reader, filter by Book/Section/KP, inspect original content/trust, return to source, close
and reopen, then remove and confirm original content remains. Restart recovery is agent-tested.

Core files: `memory.py`, `memory_schema.py`, `static/memory-ui.js`; integrations in `server.py`,
`library/database.py`, `static/app.js` and `static/master-ui.js`. No Frozen Blueprint amendment.

## Git checkpoint

Accepted implementation: `c702316` (original implementation `5f03c06`; independent-page amendment
`9d5d7b1`; final brief clarification `14b2172`). Closure commit is the commit containing the final
report/status/review update, reported by hash in the handoff. The 2026-09-15 UI deletion pass
and browser IA checkpoints are likewise reported in their user-retest handoffs.
