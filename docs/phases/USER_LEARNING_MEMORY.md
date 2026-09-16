# Phase / User Learning Memory — Curated V1

> **Status: CLOSED / COMPLETE — 2026-09-12.**
>
> User acceptance explicitly confirmed **PASS**. Final independent narrow review **PASS**
> (P0=0 / P1=0 / P2=0; recommendation **CLOSE**); targeted, real-book golden path, affected and
> broad checks complete. Accepted product code `c702316` unchanged in docs-only closure.
> Evidence: [Development Report](../development-reports/USER_LEARNING_MEMORY.md) and
> [independent review](../reviews/USER_LEARNING_MEMORY.md).

## Goal

Turn the important learning content a user explicitly chooses from Master and Assistant into one
durable, browsable Learning Memory collection, without creating an automatic learner profile or a
generic Agent-memory system.

This is one vertical slice. Explicit collection from both sources, durable membership, the unified
user surface, source/context return, removal and restart recovery belong together and must not be
split into separate Phases.

## User-visible result

> “我可以把真正有用的 Master 回答或已保存的 Assistant 解释收入学习记忆，以后按教材、Section
> 和知识点找到它，查看当时的问题与原回答，并回到对应教材或学习上下文。”

Removing an item from Learning Memory does not delete the underlying Master history or saved
Assistant note.

## Authority to read

- Product Blueprint §§2–3.3, 8–8.1, 12, 15.2, 24.1–24.7, 25–26.3, 29–30.6,
  36–38.
- Implementation Blueprint §§4.1–4.4, 7.5, 12.4a–12.5, 13.3–13.8,
  14.2–14.11, 15.1 and 15.4–15.8, 16.1–16.5, 19.2 and 19.5, 20, 21.3, and 23.
- `docs/development-reports/LEARN_ONE_KP_WITH_MASTER.md` for the current durable Master
  Topic/message, learning-state, ownership and restart baseline.
- `docs/development-reports/SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md` for the existing Assistant
  promotion, verification, source/provenance and Annotation lifecycle.
- `docs/development-reports/REVIEWED_SECTION_INLINE_TEACHING.md` for the latest accepted product,
  provider and broad-regression baseline.

Nothing else from either Blueprint is required for this Phase.

## Prior-art check

**REQUIRED — completed.** Long-term Agent memory and learner knowledge capture are mature domains,
and automatic extraction creates material provenance, conflict, privacy and identity risks.

- [Mem0 Memory implementation](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py),
  Apache-2.0, plus issues on
  [conflicting extracted memories](https://github.com/mem0ai/mem0/issues/5867),
  [missing source-message provenance](https://github.com/mem0ai/mem0/issues/7047),
  [private content in logs](https://github.com/mem0ai/mem0/issues/6915), and
  [concurrent deduplication races](https://github.com/mem0ai/mem0/issues/6515).
- [DeepTutor knowledge capture](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/reading/knowledge_capture.py)
  and [memory recall](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/services/memory/recall.py),
  Apache-2.0, plus [issue 1109](https://github.com/HKUDS/DeepTutor/issues/1109) and
  [PR 1368](https://github.com/HKUDS/DeepTutor/pull/1368).

Borrow only the bounded patterns: explicit promotion, stable source/context linkage, a compact
curation/index record separate from durable content, and metadata-led browsing. Do not borrow Mem0's
extraction/vector/entity architecture or DeepTutor's account, Notebook or plugin platform. No
substantive external code or new dependency is adopted.

User-specified DeepTutor UI reference (2026-09-12): “内容是主体，导航和学习工具退到外围”.
Apply only this content-first principle within the established visual style; do not copy DeepTutor
code or UI.

## Hard rules

- Membership is always an explicit user decision. Existing histories, messages, notes and saved
  explanations are not silently enrolled, and merely viewing, asking, answering, reviewing or
  confirming understanding never creates a Learning Memory item.
- Eligible Master content is one durable, completed assistant-role `MasterMessage`. Pending or failed
  turns are not presented as collectable answers. Its originating question, Topic and legitimate KP
  or Section scope remain provenance; collection does not resolve the Topic or alter Review state.
- Eligible Assistant content must first cross the existing durable `AI_SAVED Annotation` boundary.
  The UI may make save-and-collect one coherent explicit interaction, but Learning Memory must never
  bypass Save-first semantics, verification, exact AI content, Original-PDF SOURCE authority, or the
  separation of SOURCE / PROVENANCE / AI CONTENT.
- A Learning Memory item is a lightweight durable curation relation to its existing durable source,
  not another copy or rewritten summary of the answer. V1 generates no new title, takeaway,
  condensation or replacement wording with AI.
- One source asset has at most one active Learning Memory membership. Double click, HTTP retry,
  concurrent repeat and response-loss replay converge on that one membership.
- Removing membership deletes only that curation relation. It does not delete or mutate the source
  Master message/Topic/thread, AI_SAVED Annotation, verification metadata, learning state or history.
- Deleting an AI_SAVED Annotation removes its dependent membership. Deleting the owning Book cascades
  that Book's Learning Memory alongside its other assets and cannot affect a sibling Book. Do not
  introduce independent orphan snapshots to route around source deletion.
- Grouping and navigation use only existing legitimate Book, Section, KP, PDF-anchor and Master-scope
  authority. Missing KP/Section association is shown honestly; it is never guessed from answer text.
  Master provenance must not be fabricated into an exact PDF anchor.
- Learning Memory membership is not textbook truth, Review PASS, learner preference, mastery evidence
  or an instruction to an Agent. Existing Master Review and AI_SAVED verification states remain
  visible and honest; PASS is still bounded AI review, and FAIL/unavailable content is not relabelled.
- Creating, listing, opening, removing or cascading Learning Memory writes no `KPStatus`,
  `SectionLearningState`, `LearningEvent`, Topic resolution, Progress, Teaching or ExamEvidence.
- This Phase makes no provider call and adds no egress context. It does not send Learning Memory,
  Master history, annotations or user state to Assistant, Master, System or Review.
- Master remains durable under its existing lifecycle; Assistant conversations remain temporary.
  Collecting one answer never persists an Assistant Root/tree or duplicates a Master thread.
- All new user-visible UI defaults to Simplified Chinese.
- User clarification (2026-09-12): Learning Memory UI must follow the established Library,
  Reader, Marks and Master visual style; reuse their typography, colors, control scale and
  interaction styling so the feature does not feel like a separate application.
- User information-architecture amendment (2026-09-12): Reader is the current reading/learning
  scene; Home / Learning Space is for learning management and review across chapters and Books.
  For Learning Memory, Reader offers only “收入学习记忆” and necessary status feedback.
  Library home provides a “学习记忆” entry opening an independent Learning Memory page outside
  Reader. Browsing, organization by Book → Section / KP, full-content viewing, return to the
  corresponding PDF / Master / AI_SAVED, and membership removal belong to that page.
  This Phase only places Learning Memory at that boundary; do not build a Dashboard or global
  learning center, or restructure the overall Library home or Reader.

## Build

- The smallest additive durable representation for one user's explicit membership relation to an
  eligible Master message or AI_SAVED Annotation, with idempotency, ownership, migration, restart
  recovery and the deletion/cascade semantics above.
- Minimal authenticated service/API behavior to collect, list, open and remove memberships without
  mutating their underlying durable assets.
- A discoverable Learning Memory collection that distinguishes Master from Assistant and organizes
  items by Book and legitimate Section/KP association where available.
- The minimum source/context display needed to understand each item: originating question or focus,
  exact underlying answer, current Review/verification state, and an honest return action to the PDF,
  saved note or Master learning context that actually exists.
- Minimal collect/status affordances on the relevant completed Master and durable AI_SAVED surfaces.
  Removal is available only in the independent Learning Memory page entered from Library home.
  Exact wording is implementation-autonomous; the interaction must remain explicit.

## Not now

- **Learning Insights:** automatically condensing Master/Assistant activity into weaknesses, key
  confusions, conclusions or a learner profile. This is the named future direction, not part of this
  Phase.
- Automatic memory extraction, importance classification, Topic condensation, conflict resolution,
  semantic deduplication, automatic merging/updating or silent harvesting of conversations.
- Vector storage, embeddings, semantic search, RAG, knowledge graphs or a generic knowledge-base,
  notebook, memory, workflow or state-machine framework.
- Injecting Learning Memory into Assistant, Master, Reading Guide, Inline Teaching, Review or any
  other provider context; personalization or adaptive teaching from Memory.
- User-authored Memory essays, rich editing, tags/folders, cross-book ontology, export/sync or shared
  memory.
- Persistent Assistant conversation/history, saving a Root/tree, or changing Master Topic/history
  lifecycle.
- ExamEvidence, formal assessment, wrong-question flow, spaced repetition, rewards, KP auto-diagnosis
  or new Mastery authority.
- OCR/formula correction, Vision, Streaming, provider changes, ordinary UI polish or an overall
  Reader/Assistant/Master redesign.

## Acceptance

### Targeted

1. No Learning Memory membership exists until the user explicitly collects an eligible source.
2. A completed Master answer can be collected with its exact message identity, question, Topic and
   legitimate KP/Section provenance. Pending/failed turns cannot be collected as successful answers.
3. Assistant collection resolves to the same durable AI_SAVED Annotation created by the existing
   commit-first path. It cannot bypass save/verification or persist an Assistant tree.
4. Learning Memory stores a curation relation rather than a second mutable copy of the AI/Master
   body. Displayed content and trust metadata resolve from the durable source without rewriting or
   silent truncation.
5. Double click, concurrent collect, HTTP retry and response replay create at most one membership for
   one source.
6. Removing a Master membership leaves its message, Topic, thread, Review metadata and learning
   history unchanged. The same source may be explicitly collected again without duplication.
7. Removing an Assistant membership leaves its AI_SAVED Annotation intact. Deleting that Annotation
   removes the dependent membership and cannot affect other annotations or Master content.
8. Collection groups and filters by owning Book and legitimate Section/KP metadata. Missing
   association remains visibly unassociated; no title/text inference creates a false identity.
9. Source/context return reaches the real Annotation/PDF location or Master scope. Master content
   without an exact PDF anchor never receives a fabricated one.
10. PASS, FAIL, pending/unreviewed and technical-failure metadata remain distinguishable. Collecting
    an item changes none of those states and makes no trust or mastery claim.
11. Collection/removal/reopen paths produce no Mastery, Section state, Learning History, Topic
    resolution, Teaching or ExamEvidence write and invoke no provider.
12. Migration preserves all existing Master, Learning, USER Annotation and AI_SAVED rows and their
    meaning. Restart recovers the exact memberships and source links.
13. Owning-Book deletion cascades its memberships; a sibling Book and all its assets remain intact.
14. The collection and source actions remain usable with providers disabled and do not expose
    secrets or add content to any egress payload.

### Agent real-use golden path

Using the real 348-page textbook:

1. Open one real completed Master answer and explicitly add it to Learning Memory.
2. Use one completed Assistant answer through the existing AI_SAVED path, then explicitly collect
   that durable note.
3. Leave Reader and open the independent Learning Memory page from Library home. Verify Reader has
   no collection browser or removal control, and both entries show distinct sources, the actual question/focus,
   exact content, honest Review/verification state and correct Book/Section/KP grouping where known.
4. Return from the Master entry to its real learning context and from the Assistant entry to its real
   saved note/PDF source; verify no fake Master PDF anchor or guessed KP appears.
5. Close the Dock and Reader, restart the service with AI unavailable, and recover both entries and
   their source links.
6. Remove the Master entry and verify its complete thread/history remains; collect it again and verify
   only one membership exists.
7. Remove the Assistant entry and verify its Annotation remains. Re-collect it, then delete the
   Annotation and verify only that dependent membership disappears.
8. In an isolated copy, delete the owning Book and verify its memberships cascade while a sibling
   Book remains unchanged.
9. Confirm before/after that KP/Section status, Learning History, Topic state, Teaching assets and
   provider-call count did not change.

The path must include restart recovery plus remove/re-collect or source-deletion reversal.

### Affected regression

- Master message/Topic/thread persistence, Review states, KP/Section source scope, learning-state
  authority and restart behavior.
- AI_SAVED save-first promotion, verification states, SOURCE/PROVENANCE/AI CONTENT separation,
  Annotation list/delete/restart and Marks presentation.
- Reader/PDF and Master-context return navigation, temporary Assistant cleanup and AI-off behavior.
- Migration, idempotency, owning-Book cascade, sibling-Book isolation, authentication, payload
  inspection and secret hygiene.

### Closure / broad

**BROAD SUITE REQUIRED before closure** because this Phase changes migration, durable identity,
ownership and destructive cascade across existing Master and Annotation assets. Run targeted → real
348-page golden path → affected regression → closure broad suite; do not run the full suite after
every edit.

## Autonomy

Ordinary naming, schema/endpoint detail, file/component layout, helper placement, local algorithms,
control placement within the specified page boundaries, grouping presentation, copy, CSS,
test organization and small local refactors
are delegated. Reuse the existing Master, Annotation, navigation and ownership boundaries with the
smallest solution that satisfies the hard rules; no approval is needed for those loose edges.

## Must report before proceeding

Stop and report if implementation would require an automatic extraction/summary pipeline, a vector or
generic memory framework, substantive external code or a major dependency; copy AI/Master content
into an independent durable truth store; change AI_SAVED save-first/verification or Master
Topic/history semantics; invent KP/Section/PDF authority; change the specified membership/source/book
deletion semantics; write or infer Mastery/Learning/Teaching state; or send Memory/user state to a
provider. Also report any real Frozen-Core conflict or unavailable real textbook input needed for the
golden path.

## Completion

Complete targeted tests, the real 348-page golden path, affected regression and the broad closure
suite; record honest evidence in a concise Development Report and create a clean checkpoint.

An independent narrow review is required before closure. It must attack additive migration and
preservation, membership identity/idempotency, source ownership, Annotation and Book cascades,
Master/Assistant provenance, no-copy/no-fake-anchor behavior, trust-state presentation, AI-off
operation, provider no-egress, and the absolute no-Mastery/Learning/Teaching-write boundary.

Implementation stops at `READY_FOR_USER_RETEST` until the user accepts and authorizes closure;
user acceptance, independent review and Phase closure are separate gates. Those gates are now
complete as recorded in the status and linked evidence above.
