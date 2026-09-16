# Phase / Learn One KP with Master

> **Status: CLOSED / COMPLETE — same-Phase Section Learning Check addition (2026-09-10).**

> **Authority amendment (2026-09-14).** The user replaced this closed Phase's continuation-Topic
> rule with stable Master Topic identity: one durable Topic per learning thread across resolution,
> ordinary continuation, reopen, revisit and restart. Explicit unresolved evidence may reactivate the
> same Topic; ordinary chat changes neither Topic state nor Mastery. This amendment supersedes any
> older wording below that permits a new unresolved/continuation Topic.

> **Authority amendment (2026-09-15).** Master answer execution now exposes a named answer model and
> `Quick` / `Deep` provider reasoning in the Composer, with true SSE answer delivery and a separate
> transient reasoning surface when the provider actually returns reasoning. Independent Review is
> decoupled into the low-frequency Topic menu and defaults to `Fast`; `Standard` and `Deep` Review
> remain explicitly selectable. Migration 19 persists only the per-message reasoning-mode choice.
> Topic identity, Mastery authority, grounding, Review verdicts and history durability are unchanged.

The user explicitly reopened this implementation conversation for the formal Section two-option
check and durable Section Master, initially stopping at READY_FOR_USER_RETEST. The user explicitly
accepted the addition and reading-position UAT fix at `f4c76db`, and authorized closure only.
Prior acceptance/closure below remains historical evidence. No new Phase is created.
Current machine/agent checks passed; the live Section run had content Review results PASS then FAIL,
honestly displayed without mastery writes. Independent Codex narrow review `section_closure_audit`
passed (P0=0 / P1=0 / P2=0; CLOSE), including migration, scope, history and mastery-write boundaries.
Closure broad rerun: 214 Python passed / 2 unchanged optional OCR skips; 30 frontend passed.
User acceptance, independent acceptance and requested closure are complete. This closure changes
documentation only. See the development report and
`docs/reviews/LEARN_ONE_KP_WITH_MASTER_SECTION_CLOSURE.md` for exact evidence.

Same-Phase user-authorized UAT fix (2026-09-10): preserve the saved reading position while
Master entries resize the initial PDF placeholders. Only a restored Reader may autosave its
position. Verify refresh, Library reopen, delayed PDF loading, restart, page/offset/zoom recovery
and unchanged Learning records. No UI, learning semantics, schema or new Phase changes.

## Same-Phase addition: formal Section check

- Only second-level Section cards change to `都清楚了` / `还有些地方不完全清楚`.
- Follow Product §28.1–28.2 / Implementation §15.3: clear confirms every owned KP, resolves current
  Section unresolved state and appends events without deleting history. Unclear records Section
  state/event and opens Section Master without any guessed negative KP attribution.
- Reuse the Master thread/topic/message storage, execution, retry, Review, Dock and explicit
  confirmation flow. Section history survives close/restart and can be reopened locally without AI.
- Section source is its resolved range and owned published KP list in a READY Chapter; it cannot
  leak other Sections, Assistant trees, notes or global history. No automatic KP attribution from
  general Section dialogue is introduced; existing explicit KP controls remain available.
- Add only the persistence changes required for real Section scopes and append-only Section events;
  preserve every existing KP thread/message/event during migration. Keep reading-end and mastery
  state separate; showing/scrolling past a card is never mastery evidence.
- Subsection bulk confirmation, KP Master, source/display positioning and all other accepted UI
  remain unchanged. No summaries, new teaching pipeline or unrelated optimization.
- Verify populated migration, both Section choices, scope isolation, unchanged KP state on unclear,
  durable send/retry/restart/Review, clear/history/lock semantics, the real-book path and affected/broad
  regression. Independent narrow review is required before eventual closure, not self-acceptance.

This explicit addition supersedes the KP-only hard rules, Section exclusions and old Section bulk
acceptance below only where necessary; Subsection and existing KP semantics remain binding.

Closure (2026-09-10): the user explicitly reported `USER_ACCEPTANCE PASS` on `3aff163`, then
authorized correction of the independent audit's P1 source-grounding bypass and completion of closure.
That bounded correction passed independent re-review (P0=0 / P1=0 / P2=0, recommendation CLOSE),
real-book golden paths and final broad regression (209 Python passed / 2 optional OCR skips;
30 frontend passed). No UI or unrelated business changes were included. See
`docs/development-reports/LEARN_ONE_KP_WITH_MASTER.md` and
`docs/reviews/LEARN_ONE_KP_WITH_MASTER_CLOSURE.md`.

## Goal

Turn one real published Knowledge Point into a durable learning interaction: the learner can say it
is not fully clear, discuss that KP with Master, return after restart, and change understanding state
only through explicit user evidence.

## User-visible result

> “我可以从一个真实知识点点‘这里没完全懂’，持续向 Master 追问；关闭并重启后对话还在，只有我明确确认时理解状态才会改变。”

## Authority to read

- Product Blueprint §§3.3, 11–16, 19.1, 24.3, 25–30.1, 30.3, 30.6, 33.3–35, 36–38
  (especially decisions 30–36, 45, 48, 56–58 and 69).
- Implementation Blueprint §§4.1–5.4, 7.5, 12.3–12.6, 13.1–13.8, 14.1–14.2,
  14.10–14.11, 15.1–15.8, 18.6, 19.1–23, and §24 Phase R6.
- `docs/development-reports/REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md` for the current published-KP
  identity, permanent Chapter lock, source-navigation and real-book baseline.

Nothing else from either Blueprint is required for this Phase.

## Prior-art check

**REQUIRED — completed.** Persistent AI tutoring and learning-state models are mature problem domains.
The bounded check inspected implementation and change history in:

- [DeepTutor mastery pipeline](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/capabilities/mastery/pipeline.py),
  plus [PR 1217](https://github.com/HKUDS/DeepTutor/pull/1217) and
  [PR 1226](https://github.com/HKUDS/DeepTutor/pull/1226): a separate Master context can reuse an
  existing execution runtime, while planning sessions, route drafts, global memory, journals and
  version coordination quickly expand into a learning platform that this slice must not build.
- [OpenStax Tutor tasked reading](https://github.com/openstax/tutor-server/blob/main/app/subsystems/tasks/models/tasked_reading.rb):
  keep learning interaction bound to a real source-owned reading unit rather than inventing a parallel
  document scope.

No external code, framework or dependency is adopted.

## Hard rules

- Master opens only from a real KP in a `READY` Chapter. Its durable scope is that stable opaque KP ID,
  its owning Section and its exact published source range; no placeholder KP or guessed scope exists.
- The KP-local `这里没完全懂` action is optional and non-blocking. Opening existing Master history is
  local and must not depend on provider, reviewer or credential readiness; those checks occur only at
  the Send/Review side-effect boundary.
- Master owns durable learning dialogue. A KP-scoped thread, its messages and Topic survive Dock close,
  navigation, Reader close and service restart. Assistant remains temporary and never leaks its tree
  into Master.
- The current question is persisted before provider execution. Technical failure retains the durable
  question and ACTIVE Topic; bounded retry reuses the same logical intent and cannot duplicate a
  message, Topic or answer after double submission, HTTP retry or response-loss replay.
- One current `ACTIVE` Topic holds same-topic follow-ups. It becomes `RESOLVED` only through explicit
  user evidence such as `已经弄懂`; UI close, navigation, restart, a Master answer, Review PASS or
  apparent conversation quality never resolves it.
- Clicking `这里没完全懂` is explicit KP-specific evidence. It may move an `UNCONFIRMED` KP to
  `NOT_FULLY_CLEAR` and append the corresponding `LearningEvent`, but it never automatically
  downgrades a previously `UNDERSTOOD` KP. A new unresolved Topic may coexist with that prior state and
  retained history.
- Only explicit user confirmation may resolve the current Topic, set the relevant KP to `UNDERSTOOD`
  and append the learning event. `LearningEvent` remains append-only; current projections and history
  update transactionally.
- The first persistent learning-state write sets the Chapter's irreversible learning lock in the same
  transaction. No reset, deletion or later status change may unlock READY-map regeneration.
- Master receives a fresh allowlisted context: current KP identity/title, its exact source range,
  owning Section, the user's current Topic/messages needed for the follow-up, and only necessary nearby
  textbook context. No unrelated KP/Section, Assistant state, notes, Guide, global learning history,
  profile, Teaching assets or secrets may leave the machine.
- A strong configured model answers directly. Do not add a planner, tool loop, RAG, multi-agent
  teaching pipeline or generic workflow/state-machine framework.
- Answer provider/model and answer reasoning are explicit Composer choices. `Quick` requests the
  provider's low/no-thinking path; `Deep` requests the provider's real thinking capability. Answer and
  provider-returned reasoning stream separately; reasoning is never fabricated, persisted or sent to
  Review. Retry preserves the durable question's provider/model/reasoning identity and never falls back.
- Review strength is user-selectable in low-frequency Topic actions: `Fast` is the default and normally
  makes no independent reviewer call; `Standard` checks academic/objective correctness; `Deep` checks reasoning
  completeness and teaching usefulness. Grounding is mandatory in every mode. Risk routing may raise
  but never silently lower the selected strength.
- Review uses an independent role and fresh allowlisted context. Review failure or invocation failure
  is never PASS, never changes Mastery, and is shown honestly with a bounded retry path; do not build
  automatic semantic repair. Record the actual reviewer provider/model and never pretend a fallback
  was the configured reviewer.
- All new UI is Simplified Chinese. Book ownership and deletion cascade cover every new durable
  Learning record without touching another book.

## Build

- User-approved display-only endpoint correction (2026-09-10): KP tags and batch ending-page
  placement use the final usable OCR body line inside each published range, excluding recognized
  page labels and repeated text in narrow page margins. Unique near-top body text is retained.
  `display_end_page/y` is a read-only presentation projection; persisted KP ranges, batch membership,
  navigation authority, Master source context and learning records remain unchanged. With no usable
  OCR body line, retain the published endpoint rather than invent a location. This corrects the
  real PDF 39–40 case where an old KP span ends at the following page's running header.
- User-authorized placement refinement (2026-09-11): individual KP learning entries are compact
  controls inside the PDF page margin, using the existing display endpoint; expanded operations
  appear in a dismissible card. This supersedes the former side-gutter placement and reserved gutter.
  Section/Subsection batch controls remain non-floating light cards below the PDF
  page containing their last contained KP's end, aligned with the reading column. The user accepted
  this page-footer placement instead of splitting the PDF to insert controls between paragraphs.
  Each card names its owner, shows total / UNDERSTOOD / NOT_FULLY_CLEAR counts, offers the compact
  `确认本小节` or `确认本节` button and the muted note `仅确认未标记为“没完全懂”的知识点`.
  Reserve space below the page so cards never cover this or the next page. Business rules, scopes,
  states and the existing batch endpoint are unchanged; this supersedes the previous gutter batch UI.
- User-authorized same-Phase addition (2026-09-10): each third-level Subsection end also offers
  `一键确认本小节 KP`, reusing the existing batch transaction. Membership is derived from the
  published KP's owning parent Section and complete containment in the Subsection's resolved
  physical range; crossing ranges are excluded, never reassigned. Only UNCONFIRMED becomes
  UNDERSTOOD. Preserve NOT_FULLY_CLEAR and all other scopes; show the remaining unclear count.
  No new state, schema, ownership field or workflow is introduced.
- User-authorized addition (2026-09-10): at each second-level Section's physical end,
  offer `一键确认本节全部 KP`. In one transaction, change only its owned `UNCONFIRMED`
  KPs to `UNDERSTOOD` with explicit-user events and the permanent Chapter lock.
  Preserve `NOT_FULLY_CLEAR`, existing `UNDERSTOOD`, Topics and all other Sections;
  show `本节仍有未完全清楚的知识点` whenever such KPs remain. Repeated clicks are no-ops.
  This bounded action is not the full `都清楚了` Section Learning Check of Product §28.1 /
  Implementation §15.3; it introduces no Section state or negative Section workflow.
- The minimum KP-local `这里没完全懂` affordance at the real KP/source position and the minimum
  Master tab surface in the existing shared right-side Dock.
- Durable KP-scoped `MasterThread`, `MasterMessage`, `MasterTopic`, the necessary `KPStatus`, and
  append-only `LearningEvent` state, including ownership, migration, restart recovery and cascade.
- One ACTIVE Topic conversation with durable user questions, completed Master answers and same-topic
  follow-ups; explicit retry for failed Send/Review and explicit user resolution.
- Low-weight Composer answer-model and `快速` / `深度` controls; genuine SSE answer/reasoning events,
  separate transient reasoning display, and migration 19 for the durable reasoning-mode choice only.
- A narrowly assembled Master context grounded in the KP's real source evidence, plus existing
  provider routing for Fast/Standard/Deep Review behavior and the minimum honest status UI.
- The transactional permanent-Chapter-lock call required by the first learning-state write.

## Not now

- Section Learning Check, `SectionLearningState`, Section-scoped Master, multi-KP attribution,
  automatic topic clustering, structured summary/condensation or a learning journal.
- Learner profile/global memory, assessment, quiz, scoring, spaced repetition or a wrong-question
  system.
- Reading Guide, Inline Guidance, Recall, TeachingAsset, RAG or an external knowledge corpus.
- Persistent Assistant history, Knowledge Map generation/regeneration changes, OCR or
  formula correction, general UI polish, or a generic chat/workflow/state-machine framework.

## Acceptance

### Targeted

1. Only a real KP from a `READY` Chapter can create/reopen Master scope; KP, Section and exact source
   range resolve to the published records and source navigation remains exact.
2. The final provider payload contains only the declared Master allowlist and no unrelated KP,
   Section, Root/sibling/Assistant tree, notes, highlights, Guide, global learning state or secret.
3. A user question and ACTIVE Topic are durable before provider execution. Provider failure preserves
   both, and double submission, HTTP retry and response-loss replay create at most one logical
   message/Topic/answer.
4. The selected answer provider/model and Quick/Deep execution identity survive retry/restart; answer
   and real provider reasoning stream separately, reasoning is not persisted, and there is no fallback.
   Fast, Standard and Deep Review route independently; grounding is always active, selected Review
   strength is never silently lowered, and actual answer/reviewer metadata is honest.
5. Review PASS updates only its review result. Semantic or technical Review failure is not PASS,
   preserves the conversation, is retryable, and cannot write Mastery.
6. `这里没完全懂` may change only `UNCONFIRMED → NOT_FULLY_CLEAR` with an appended event. It never
   auto-downgrades `UNDERSTOOD`; an unresolved Topic may coexist with the prior understood history.
7. Only explicit `已经弄懂`-equivalent evidence resolves the Topic and may set that KP to
   `UNDERSTOOD`, with an append-only event. Answer completion, Review, close, navigation and restart
   change neither Topic resolution nor Mastery.
8. The first persistent learning write sets the permanent Chapter lock transactionally. Migration is
   additive and lossless; ownership, restart recovery and book-delete cascade are correct.
9. No path writes `SectionLearningState`, Teaching/Guide state, or any unrelated KP/Section/Book
   state. AI-off still permits normal Reader use and opening/reviewing durable Master history.
10. Section bulk confirmation changes only owned UNCONFIRMED KPs, preserves unclear KP/Topic
    history, reports remaining unclear KPs, is idempotent, and survives restart with its events/lock.
11. Subsection confirmation obeys the same rules within its contained KP set, including same-page
    boundaries and multi-page KPs; adjacent Subsections, other Sections/Books and crossing KPs remain
    untouched. The UI reports the remaining NOT_FULLY_CLEAR count.
12. Learning controls do not intersect PDF content at normal size, with the Dock open, after zooming
    or in a narrower viewport. Batch cards remain below their ending page, name the owning unit and
    show accurate refreshed counts. Individual KP entries and batch controls are visually separated.

### Agent real-use golden path

Using the real 348-page textbook and one published KP from a `READY` Chapter:

1. Navigate from the Section-grouped Knowledge Map to the KP and choose `这里没完全懂`.
2. Ask one genuine understanding question and one same-topic follow-up through the served Reader.
3. Close the Dock, navigate away, close the Reader, restart the service, return, and verify the same
   KP thread, messages and ACTIVE Topic recover without provider readiness gating history.
4. Exercise one real or controlled provider/Review failure, verify the durable question remains, then
   retry successfully without duplication or silent Review downgrade.
5. Explicitly confirm understanding and verify the Topic, `KPStatus` and `LearningEvent` update while
   no unrelated KP/Section/Book state changes.

The path must include the close/restart/retry reversal and inspect final provider payload boundaries.

### Affected regression

- Knowledge Map stable identity, permanent lock, source navigation and regeneration compatibility.
- Reader/Dock behavior and Assistant temporary-state isolation.
- Provider routing, Review modes/failure handling, egress payload inspection and secret hygiene.
- Learning persistence/migration/restart/ownership/cascade, plus existing USER and `AI_SAVED`
  annotations.

### Closure / broad

**BROAD SUITE REQUIRED before closure** because this Phase crosses durable identity, migration,
Mastery authority, source grounding, deletion cascade and Review egress. Run in order: targeted →
agent real-use golden path → affected regression → closure broad suite; a full suite is not required
after every edit.

## Autonomy

Ordinary naming, file/component layout, helper placement, local algorithms, conventional schema and
endpoint details, error wording, CSS, test organization and small local refactors are delegated.

## Must report before proceeding

Stop and report if implementation would change KP/source authority, Mastery evidence semantics,
durable ownership/migration/cascade, the permanent Chapter lock, or Review/egress isolation; require a
major dependency or substantial external implementation; expand into a Section/global learning
system; or lack the real textbook/provider input required for the accepted real-use path.

## Completion

Complete targeted tests, the real 348-page golden path, affected regression and the broad closure
suite; record honest evidence in a concise Development Report and create a clean checkpoint. Because
this Phase changes durable identity, migration, Mastery-write authority, source grounding, cascade and
Review egress, an independent narrow review is required before closure and must attack those exact
boundaries. Stop at `IMPLEMENTATION_READY`; user acceptance, independent acceptance and Phase closure
remain separate approval gates. Implementation handoff requested by the user is
`READY_FOR_USER_RETEST`; never declare `USER_ACCEPTANCE PASS` or Phase closure autonomously.
