# User Learning Memory — Curated V1 Development Report

## Result

**IMPLEMENTATION_READY / READY_FOR_USER_RETEST — 2026-09-12.**
User acceptance and Phase closure remain pending. Independent narrow implementation review PASS;
this is separate from independent product acceptance and the user's retest.

Completed Master answers and durable AI_SAVED notes now offer explicit collect/remove controls.
Library and Reader expose one Learning Memory collection with Book/Section/KP filters, original
question/focus, exact answer, current trust metadata, and return to the actual Master message or
saved note/PDF. Removing membership preserves its source. No automatic enrolment or learning update.

## Implemented

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
- Existing sanitized Markdown/math rendering plus expandable **complete original text** preserves
  access beyond the shared formatter's 50,000-character display bound. Trust metadata remains live;
  collection does not retry Review, change verification or imply mastery.
- SQLite backup is integrity checked and compared against the full existing database before migration.
  The startup statement explains the additive relation and preservation of existing assets.

## Important decisions / prior art

Followed the accepted brief's completed Mem0/DeepTutor prior-art adjudication: explicit promotion,
stable provenance, compact relation separate from content, metadata-led browsing. No additional
framework, dependency, copied external implementation, vector system or automatic memory pipeline.
Assistant promotion remains the existing Save-to-Notes action; collection is available on the durable
AI_SAVED Marks card, never on a temporary Assistant tree.

## Acceptance evidence

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
  **every pre-existing table's row hash matched before/after startup**. Memory is initially empty;
  no test enrolment/deletion or generated content entered the user's Library. Existing approved
  runtime routing is retained: native DeepSeek `deepseek-flash`; OpenRouter routes explicitly
  `google/gemini-3.8-flash`; Zhipu disabled. Startup made no generation or Review call.

## Deviations / limitations

No scope deviation. The Memory golden path reuses genuine already-saved source content; fresh
Save-to-Notes promotion is proven separately by the existing controlled-provider real-book save
regression. No live generation is needed for this provider-free feature. Optional real-OCR external
fixtures remain unavailable and unchanged; the required full 348-page material was available.
No user-acceptance or independent-product-acceptance PASS is claimed. Full formatted rendering keeps
its existing bound; the complete unmodified original is always available in the detail disclosure.

## Reproduction and entry points

```powershell
python -m pytest tests/test_memory.py
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
npm run test:e2e:memory
```

Manual retest: open a completed Master answer → **收入学习记忆**. In **本页标记**, collect an
**AI 保存的解释** (save an Assistant answer to Notes first if needed). Open **学习记忆** from the
Reader or Library, filter by Book/Section/KP, inspect original content/trust, return to source, close
and reopen, then remove and confirm original content remains. Restart recovery is agent-tested.

Core files: `memory.py`, `memory_schema.py`, `static/memory-ui.js`; integrations in `server.py`,
`library/database.py`, `static/app.js` and `static/master-ui.js`. No Frozen Blueprint amendment.

## Git checkpoint

Implementation checkpoint: the commit containing this report, reported by hash in the handoff.
