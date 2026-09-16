# FOUR MASTER SCREEN IMPLEMENTATION BRIEF

## 0. Status / Scope

**Status: PLANNER HANDOFF — READY FOR IMPLEMENTER**

### User-directed Reader restoration — 2026-09-13 (controlling scope override)

The user rejected the redesigned Reader in manual UAT and confirmed selective restoration
from `92febf6`. Reader-specific composition, unified Study Pane migration, navigation and
responsive requirements below are deferred wherever they differ from that baseline.
Restore the original toolbar, Guide container, Assistant/Master Dock, Outline/Search,
Knowledge Map location, selection flow, open/close behavior and PDF layout geometry.
Apply only a minimal Editorial / Swiss + Paper / E-ink visual skin: colors, material,
border/radius and control states. No new Reader information architecture is authorized.
Home, Book Overview and Learning Memory retain their implemented redesign. Retain the
authorized Section-end backend/projection and Child retry contract; reading never writes
mastery. The restored Reader uses no new Section-end notice or pane orchestration.

The next gate is the user's seven-item Reader retest: PDF clarity; zoom/page navigation;
Guide; Assistant/Master; Inline Teaching; Outline/Search/Marks; new color treatment.
Stop at `READY_FOR_USER_RETEST`. Further interaction changes require individual user
requests and retests. This override records the user's instruction, not agent acceptance.

### User-authorized implementation scope addition

On 2026-09-12, the user explicitly selected “扩大范围，补齐节末阅读记录和投影”
after the Implementer reported that existing code did not record Section-end reading.
This authorizes the bounded reading observation and server projection needed for
`已阅读 · 待确认`, including additive storage. It does not authorize mastery writes,
historical backfill, or changes to Assistant/Master lifecycle. Blueprint authority remains higher.

On 2026-09-13, the user also explicitly authorized “补齐 Assistant Child 首次生成失败后的
retry contract”. This permits retrying the original failed temporary Child using its
existing identity and original grounding, without new durable Assistant history or a
change to the established destructive lifecycle boundaries.

Implementer status: `READY_FOR_USER_RETEST`; evidence and checklist mapping are in
`docs/development-reports/FOUR_MASTER_SCREEN_UI.md`. The reported retry handoff gap has
been resolved under that authorization. This note does not claim user acceptance.

This Brief is downstream implementation guidance for the four visually validated master screens. It
does not replace or amend `PRODUCT_BLUEPRINT.md` or `IMPLEMENTATION_BLUEPRINT.md`. If this Brief or a
visual master conflicts with either Blueprint, stop and report the concrete conflict; do not repair
it by silently changing Product behaviour or redesigning the screen.

In scope:

- Home / Learning Space;
- Book Overview;
- Reader / Study Space;
- Learning Memory;
- the semantic navigation and shared presentation rules needed for those four screens to work as one
  product;
- the local loading, preparation, failure, stale and degraded states those screens must project.

Explicitly excluded:

- any change to Product meaning, state machines, source-of-truth authority, ownership, persistence,
  migrations, deletion semantics, provider routing or AI context;
- any new learning capability, automatic learner profile, Learning Insights, assessment, RAG,
  Streaming, OCR correction, formula OCR, Vision or persistent Assistant history;
- a new visual theme, alternate full-screen direction, dark theme, custom/self-hosted font, token
  engine, component framework, Storybook platform or state-management framework;
- redesign of the validated page composition, information architecture or the three established
  spaces;
- product surfaces outside these four screens except for the smallest shared chrome or navigation
  adaptation required to make the four screens coherent.

The screens must project the current Product faithfully. Illustrative content in the masters is real
representative textbook and learning content, but it does not create new domain facts or hard-code a
particular Book, page, Section, KP count, provider or learning status.

## 1. Visual Master Index

The four images below are normative visual evidence for this implementation slice. They fix the
approved composition, hierarchy, material, typography direction, density and visual weight at the
canonical 1600-pixel state. Responsive adaptation is allowed. Unilateral redesign is not.

Each PNG was rendered directly from its final validated interactive master at the 1600-pixel design
state, with the visualization controls excluded from the product surface. No visual restyling or
content substitution was performed during preservation.

### Home / Learning Space

![Home / Learning Space](../masters/01-home-learning-space.png)

Status: **VISUALLY VALIDATED**

Intent: a quiet editorial entry that puts one meaningful “continue learning” decision before a
compact local library. It is a learning home, not a metric dashboard.

### Book Overview

![Book Overview](../masters/02-book-overview.png)

Status: **VISUALLY VALIDATED**

Intent: a book-level structural view where the complete Knowledge Map can be understood by Chapter
and Section without turning the Reader into a navigation dashboard.

### Reader / Study Space

![Reader / Study Space](../masters/03-reader-study-space.png)

Status: **VISUALLY VALIDATED**

Intent: the Original PDF is the visual subject. Source navigation and the task-selected Study Pane
appear around it only when needed; AI never becomes the page background or the dominant permanent
chrome.

### Learning Memory

![Learning Memory](../masters/04-learning-memory.png)

Status: **VISUALLY VALIDATED**

Intent: a calm, content-first review space for material the user explicitly chose to retain, with
trust, provenance and source return present but subordinate to the retained explanation itself.

The Reader image records the validated default pure-reading composition. The behaviour of Source
Navigator, Guide, Assistant, Master, Marks detail, Inline Teaching and degraded states is normative
through the rules below; those states must remain visually continuous with this master rather than
becoming separately styled applications.

## 2. Global Interaction / Visual Rules

### Hierarchy and material

- Preserve the approved Editorial Paper / Swiss + E-ink direction: warm paper surfaces, a muted
  canvas, low-saturation green for primary action/current position, restrained warm teaching accents,
  direct typography and hairline structure.
- Content carries hierarchy. Avoid card walls, stacked containers, decorative gradients, oversized
  pills, large soft radii, heavy shadows and ornamental animation.
- Use the validated system-font strategy. UI text uses the Windows system/UI stack; editorial
  headings may use the system-available Chinese serif fallback shown by the masters. Do not download
  or self-host a font in this slice.
- Match the masters' typographic relationships, not only isolated font sizes: restrained 14px-class
  UI copy; compact 11–13px metadata; serif editorial headings; and approximately 15px long-form
  Study/Memory copy with generous 1.9-class line height and a bounded reading measure. Dynamic text
  must not be silently truncated where the Product promises exact content.
- Use mostly square or 2px-class corners, one-pixel dividers and only the small page-elevation shadow
  visible around the PDF. A new card or border must explain a real grouping or interaction boundary.

### Interaction and feedback

- Primary actions are explicit text controls; icon-only controls are secondary and require an
  accessible name. Decorative icons beside visible text stay out of the accessibility tree.
- Hover, focus, active, selected, disabled and loading states must be distinguishable without moving
  layout bounds. Keyboard focus remains visible and is never hidden by a sticky bar or pane.
- Do not rely on hover for primary behaviour. Pointer and keyboard paths must reach every primary
  action. Small visible icons may use a larger invisible hit area.
- Use restrained feedback: background/opacity/border changes and short spatially coherent transitions
  in the approximately 130–180ms range demonstrated by the masters. Respect reduced-motion. No
  animation may delay reading or confirmation.
- Pane and Navigator open/close preserves spatial continuity; focus moves into the opened surface and
  returns to its invoking control on close. Source return gives immediate feedback and lands at the
  authoritative target.
- Saving to Learning Memory and learning confirmation acknowledge the committed result, not merely a
  click. A failed mutation remains visibly failed and retryable; it must not look successful.

### Loading, error and responsive behaviour

- Failure scope follows capability ownership. A local child capability uses local status and retry;
  it does not replace a usable parent screen with a global error page.
- Reserve stable space for asynchronous local status where practical. Avoid page jumps, full-screen
  blocking spinners and indefinite shimmer over readable content.
- `EMPTY`, `LOADING`, `PREPARING`, `READY`, `FAILED`, `STALE` and `DEGRADED` have different meanings;
  do not collapse them into one spinner or one “unavailable” message.
- The canonical visual comparison is 1600px wide. At 1280px and 1024px, preserve order, reading
  measure and the PDF's primacy; compact labels and gutters before reducing content legibility.
- The Guide Focus layout may allocate roughly 55–65% of the width to the Study Pane while the PDF
  remains present. Pane resizing is allowed within useful minimum widths. Responsive adaptation must
  not turn the PDF into a hidden background dependency.
- Avoid horizontal page overflow. Long content scrolls inside its owning space; fixed/sticky controls
  must not cover the final lines or focused controls.

### Common reusable patterns

- Home, Book Overview and Learning Memory share the quiet product header and the same active-navigation
  treatment. Reader uses the reduced reading header in the master.
- Reuse the same text-action, filled-primary, icon-button, hairline divider, status-dot, metadata and
  inline failure patterns across screens. Reuse is visual consistency, not authority to merge domain
  state.
- Guide, Assistant, Master and Marks detail share the right-side Study Pane's spacing, header, close,
  resize and scroll rules. They are not permanent equal tabs: the current task decides which surface
  is present.
- The implementation renders the actual Original PDF. The typeset page in the Reader master specifies
  scale, placement and surrounding chrome; it is not permission to reconstruct or reflow textbook
  content as HTML.

## 3. Home / Learning Space

### Responsibility

Home answers two questions quickly: “Where was I learning?” and “Which local textbook do I want?” It
owns cross-book entry and resume, not detailed Book structure or in-Reader study tools.

### Visual regions

1. Shared header: product identity, Learning Space / Learning Memory navigation, and Import.
2. Continue block: the most recent legitimate reading position, Book identity, current Chapter or
   Section context, restrained learning-state summary, and primary resume action.
3. Library: a compact editorial list of local Books with page count, preparation/readability summary,
   last activity/current position where known, Open and an unobtrusive more action.

### Data projected

- Library-owned Book and active `BookSourceRevision` identity, page count and intake/readability state.
- Learning-owned last reading position and current learning projections where they actually exist.
- Outline-owned current Chapter/Section label when resolvable.
- Knowledge/Learning-owned aggregate KP state counts only when Chapter structure exists; absence is
  shown as not yet available, never inferred from pages read.

The server/domain contexts compute these projections. The frontend may format and group them but does
not derive a new canonical “current Section,” mastery state or readiness truth.

### Important states

- **Empty library:** one quiet explanation and a clear Import action; no fake sample Books or dashboard
  skeleton remains after loading resolves.
- **Loading library projection:** stable header and reserved content region; failure is local and
  retryable.
- **Book PDF ready, learning structure absent/preparing:** Open and Continue remain available. Status
  explains that text/structure is preparing without treating the Book as unreadable.
- **No saved reading position:** Open begins at the normal Book entry; do not manufacture “continue.”
- **Import failure:** report the concrete intake reason next to the import flow. Other Books remain
  usable.

### Interactions and navigation outcomes

- Import starts the existing intake flow and adds a Book only after the Book commit boundary succeeds.
- Continue opens Reader at the persisted Book revision, PDF page and reading anchor.
- “查看全书结构” or the Book's structural entry opens Book Overview for that Book.
- Open enters Book Overview; Continue enters Reader at the saved position. Neither action waits for
  OCR, Outline, KP or Teaching preparation.
- Learning Memory opens its independent review space outside Reader.
- Destructive Book actions, if exposed by the more menu, retain the existing explicit confirmation,
  ownership and retryable deletion semantics; this Brief does not redesign them.

### Explicit non-goals

- Full Chapter/Section/KP map inside Home.
- A global progress dashboard, streaks, recommendations, ranking, goals or inferred study plan.
- Learning Memory browsing inside a Home card.
- Guide, Assistant, Master or Marks detail inside Home.

### Acceptance scenarios

- With the real 348-page Book, Home resumes the exact persisted reading position in one primary
  action and opens Book Overview separately.
- A newly committed Book is immediately openable while OCR/Outline/Knowledge preparation continues.
- With no Books, the screen is calm, complete and keyboard-operable; with multiple Books, density and
  visual hierarchy continue to match the master without becoming a card grid.
- A failed import or unavailable child preparation never disables an existing readable Book.

## 4. Book Overview

### Responsibility

Book Overview owns Book-scale orientation: Chapters, Section hierarchy, the complete available
Knowledge Map, current learning state and entry back into the source. It is the place for the full
map; Reader retains only the current Section's lightweight context.

### Visual regions

1. Shared header and breadcrumb back to Learning Space.
2. Book header with title, current Chapter/position and Continue PDF action.
3. Chapter rail using the Stable Outline's logical hierarchy and physical-resolution evidence.
4. Selected-Chapter content: Chapter title, Knowledge Map summary and Section-grouped KP rows with
   status, source page/range and enter/continue actions.
5. Local preparation, failure, stale or degraded notices in the region they affect.

### Data projected

- Library Book/revision identity and PDF readiness.
- Stable Outline logical nodes, order, hierarchy, node resolution state and authoritative navigation
  target where resolved.
- Chapter Knowledge preparation state, published structure version and Section-owned KPs.
- Current KP/Section learning state and append-oriented history summaries without conflating the two.
- Reading position for Continue.

### Readiness contracts

These three readiness dimensions remain separate:

| Capability | What readiness permits | What it must not gate |
|---|---|---|
| PDF | Open and read the immutable original pages | OCR, Outline, KP, Guide, Assistant or Master |
| Outline | Show logical Chapter/Section structure; resolved nodes can navigate to source | Opening the readable PDF |
| Chapter Knowledge Map | Show published KPs, KP state, KP navigation and KP-dependent learning controls | PDF reading, OCR selection, Notes, Assistant or non-KP Guide |

- A logical Outline may be visible before every node is physically resolved. Unresolved nodes are
  honest about unavailable exact navigation; they are not hidden or guessed.
- Chapter Knowledge state is Chapter-scoped: `NOT_PREPARED → PREPARING → READY`, with `FAILED →`
  explicit retry. One Chapter's state does not block sibling Chapters or the Book.
- A published map remains visible during replacement preparation or failure. New KP content appears
  only at atomic publication; partial candidates are never projected.
- Opening readable content never depends on learning structure being `READY`.

### Important states

- **Outline not yet available/failed:** keep Continue/Open PDF. Replace only the structural rail with
  a scoped preparing/failure message and retry where authorized.
- **Chapter map not prepared:** show a bounded request/preparation affordance for that Chapter, not a
  Book-wide unavailable page.
- **Chapter map preparing:** show honest Chapter-local stage/progress without draft KP titles.
- **Chapter map failed:** show typed Chapter-local failure and retry; keep PDF/Outline navigation.
- **Chapter map ready:** show only the atomically published Section-grouped map.
- **Published map stale or regeneration failed:** keep the current published version usable and show
  an update/failure notice; never blank it.
- **Physical target unresolved:** do not manufacture page numbers or source positions.

### Interactions and navigation outcomes

- Selecting a Chapter changes the selected Overview projection without preparing unrelated Chapters.
- Section “进入教材” opens Reader at the Section's authoritative physical start when resolved.
- KP/source actions open Reader at the published KP's deterministic source range/revision.
- Continue PDF returns to the persisted reading position independently of Outline/KP readiness.
- A Chapter prepare/retry action initiates only the existing Chapter-scoped job; the UI observes
  server-owned state and converges repeated requests.

### Explicit non-goals

- Editing Outline or KP structure, exposing candidate KPs, or generating a whole-Book map.
- Guide article, Inline Teaching body, Assistant conversation or Master thread in the Overview.
- Inferring mastery from map availability, reading position or Review PASS.
- A dashboard of charts, recommendations or predictive learning analytics.

### Acceptance scenarios

- A user can open the real Book and enter readable PDF content in every Outline/KP readiness state.
- `NOT_PREPARED`, `PREPARING`, `READY`, `FAILED` and published-plus-regenerating are visually distinct
  and Chapter-local.
- A READY KP returns to its exact source range. An unresolved Outline target is labelled honestly and
  never navigates to a guessed page.
- The full map is legible at 1600px and remains ordered and usable at 1280px and 1024px without being
  duplicated into Reader.

## 5. Reader / Study Space

### Responsibility

Reader is the source-first learning workspace. It always preserves access to the Original PDF and
adds only the navigation, selectable machine layer, user annotations and current learning task that
are useful around that source.

### Validated visual regions and ownership

#### Reduced Reader header

- Shows Book, current derived Section/page context and quiet actions for Source Navigator, current
  Section Guide and Marks.
- The current Section is derived from the reading anchor and Outline range; it is not stored by the
  frontend.
- Controls that are not relevant to the current page/Section recede or are absent. The header does
  not become a second global navigation bar.

#### Source Navigator

- Projects the Stable Outline and a lightweight current-Section/KP context.
- Opens on explicit intent, closes without moving the PDF position, and uses authoritative physical
  targets for source navigation.
- It does not reproduce the complete Book Overview map or become a permanent wide left rail.

#### Original PDF surface

- Uses the actual PDF render as the visual and source authority. Page navigation, zoom and reading
  remain local and responsive.
- The page canvas remains visible when Guide, Assistant, Master or Marks detail opens. Pure reading
  removes optional chrome while retaining discoverable entry points.
- Printed labels are shown only when known; PDF page index remains available and is never replaced by
  a guessed printed page.

#### OCR/selectable interaction layer

- Appears page by page only when that page's `OCRPage` is `READY`, using the existing geometry and
  selection authority.
- Enables selection, copy, text highlight and selection-based Assistant on prepared pages. It must
  align through zoom/rotation and must not visually replace the PDF.
- OCR IDs are runtime conveniences, never durable source anchors.

#### Annotations and Marks detail

- Highlights render from persisted normalized PDF geometry even when OCR is unavailable later.
- Notes preserve source quote/context and their current anchor status. `NEEDS_REVIEW` remains visible
  at original geometry rather than silently moving.
- Marks detail uses the shared Study Pane rules when opened; it does not cover or replace the PDF.

#### Optional Teaching

- A published Section Guide opens in the Study Pane as a long-form companion column with its own
  reading position. Its low-distraction citations return the PDF to source while preserving Guide
  position.
- Inline Teaching appears sparsely from the approved `✦` affordance at a resolved semantic anchor.
  It does not insert content into or reflow the PDF. An unresolved anchor is omitted, not guessed.
- Teaching is optional. Turning it off or encountering generation/review failure leaves the Reader
  and all independent capabilities usable.

#### Unified Study Pane / Assistant and Master Dock

- Guide, Assistant, Master and Marks detail use one right-side task space and one set of pane
  behaviours. They are not a permanent four-tab workspace and do not each introduce a visual system.
- The current user task determines the pane body. Close returns to the prior reading composition;
  resize/expand preserves useful PDF visibility and readable long-form measure.
- Assistant and Master remain semantically separate. Only one is visually active at a time, but
  switching does not equal closing.
- Assistant keeps its temporary Root/Child/focus/depth state only under its existing lifecycle and
  shows failed turns locally. Master shows durable Topic/thread/history and current legitimate scope.
- Assistant may not be visually or durably relabelled as Master. Master may not inherit Assistant
  history merely because both use the same pane.

#### Section learning confirmation

- The non-modal check appears near the physical end of the Section's main teaching content only when
  Chapter KP structure is ready.
- “都清楚了” and “还有些地方不完全清楚” keep their existing explicit meanings. Scrolling past,
  reading the page, receiving an answer or closing a pane is never confirmation.
- If the user has read the Section before KP readiness, show the honest `已阅读 · 待确认` projection
  when confirmation becomes relevant; do not backfill mastery.

### Data projected

- Library/Foundation: Book revision, immutable PDF bytes, page geometry, printed labels and per-page
  OCR/layout state.
- Outline: current derived Section, logical navigation nodes and resolved source targets.
- Knowledge: Chapter preparation state, current Section's published KPs and authoritative KP ranges.
- Teaching: current published Guide/Inline assets, version/dependency state and resolved anchors.
- Annotation: user notes/highlights and durable AI_SAVED notes.
- Learning: reading position, KP status, Section unresolved/current confirmation state, Master Topics,
  messages and history.
- Assistant: temporary in-memory Root/Child tree, current focus, depth and turn state.

### Required state combinations

#### PDF READY + OCR NOT_READY

- Render and navigate the PDF normally.
- Show page-local preparation status without dimming or blocking the Book.
- Selection/copy/new text highlight and OCR-dependent Assistant for that page are unavailable with a
  concise explanation. Existing geometry-based annotations still render.
- Retry/preparation applies only at the actual OCR boundary; unrelated Reader controls stay enabled.

#### PDF READY + OCR READY + Chapter KP PREPARING

- Selection, copy, Find, notes/highlights and Assistant remain usable.
- Show small Chapter-local progress where learning structure is referenced; never display draft KPs.
- Non-KP Guide/general Guidance may remain available. KP-boundary Teaching, KP-local Master entry and
  Section Learning Check wait for published KP structure.
- Reading position continues to persist; mastery does not change.

#### PDF READY + Chapter KP READY + Guide FAILED

- PDF, OCR-ready interactions, current-Section KP context, Notes, Assistant and legitimate Master
  entry remain usable.
- Only the Guide region shows failure and explicit retry. It does not occupy the pane as an endless
  global error or hide the PDF.
- Existing previously published Guide stays visible if a replacement failed.

#### Assistant FAILED while Reader remains usable

- Keep the failed turn in the Assistant task surface with typed, actionable retry/auth/quota feedback.
- Preserve the same logical interaction identity on retry. Do not create a new Root/Child, learning
  event, Master Topic or mastery update.
- PDF, navigation, annotations, Guide and existing Master history remain usable.

#### Section already read + mastery confirmation pending

- Project reading completion separately from understanding: `已阅读 · 待确认`.
- If Chapter KP is ready, make the explicit Section confirmation reachable without a modal
  interruption. If it is not ready, explain that learning structure is preparing/failed and retain
  reading progress only.
- Never infer KP `UNDERSTOOD` from reading position, elapsed time, scroll depth, Guide completion,
  Assistant/Master answer or Review PASS.

### Additional important states

- A stale Guide remains readable with an update option. A degraded Inline asset suppresses only
  unresolved anchors.
- Master provider failure blocks only a new Master turn; Topic/thread/history and Reader remain.
- Closing Reader clears unsaved Assistant conversations, but does not delete Master history,
  annotations, learning state, published Teaching or explicitly collected Memory.
- AI-off preserves original reading, prepared OCR interactions, notes, learning records and all
  previously published durable assets.

### Interactions and navigation outcomes

- Page, zoom, Find and Outline navigation operate directly on the source surface.
- Selection opens the existing context action set; saving/highlighting and Assistant requests
  validate only at their true side-effect boundaries.
- Guide source references, KP entries, Marks and Learning Memory source-return actions land on their
  authoritative source location and expose the target without changing its meaning.
- Opening a Guide/Assistant/Master/Marks task changes the pane, not the source authority. Closing it
  restores the same PDF position and zoom.
- Explicit Assistant close remains destructive only for the scoped temporary tree. Pane switching is
  not Assistant close and never resolves a Master Topic.

### Explicit non-goals

- Persistent Assistant conversation/history, automatic conversion of Assistant activity into Memory,
  or merging Assistant and Master lifecycles.
- Hiding/replacing/reflowing the PDF with generated text.
- A permanent Guide/Assistant/Master/Marks tab bar, simultaneous competing AI panes, or a dashboard
  rail.
- New mastery inference, Guide/Teaching generation policy, OCR behaviour or source anchoring.
- Whole-Book Knowledge Map inside Reader.

### Acceptance scenarios

- The real 348-page PDF remains the largest and highest-authority surface in pure, Navigator, Guide,
  Assistant/Master and Marks-detail flows.
- Opening and closing Navigator and each Study Pane task preserves page, zoom and the task's legitimate
  lifecycle state; source return lands correctly.
- Each required state combination above is exercised in the served app and shows local degradation,
  no global blocking and no inferred mastery.
- OCR selection, context menu, annotation rendering and source navigation align at 110% and after at
  least one zoom/page change.
- Keyboard users can open/close panes, reach source actions and recover focus; no overlay hides focus
  or the end of long Guide/Master content.

## 6. Learning Memory

### Responsibility

Learning Memory is an independent review space for learning content the user explicitly curated. It
does not harvest activity, create a profile or replace Notes, Master history or Learning History as
their owning sources.

### Visual regions

1. Shared header and return-to-reading action.
2. Editorial title with the explicit-curation promise, plus restrained search/filter controls.
3. Book/time-organized item list with source type, Section/KP context, current trust state and selected
   row.
4. Content-first detail: item identity/question, source action, exact underlying answer, then
   disclosed provenance and review/verification metadata.

### Data projected and semantic separation

- **Membership:** the durable curation relation is the reason an item appears. It is not a duplicate
  body or a new truth record.
- **Current state:** current `KPStatus`, current Section unresolved state and current Master Topic
  state may be shown when the underlying source legitimately owns that association. They remain
  mutable and are labelled as current.
- **Historical evidence:** append-oriented Learning History and durable Master messages remain past
  evidence even after current KP/Section state changes. Do not rewrite history to match the latest
  badge.
- **Master history:** a collected completed Master answer resolves to its actual durable message,
  question, Topic and legitimate KP/Section scope. Closing or removing Memory membership does not
  resolve or delete it.
- **Notes / saved AI explanation:** only an eligible durable `AI_SAVED Annotation` may back an
  Assistant-origin Memory item. Preserve SOURCE, PROVENANCE and exact AI CONTENT as separate
  semantics, plus current honest verification metadata. A USER note/highlight or unsaved temporary
  Assistant answer is not enrolled automatically.
- **Source return:** an AI_SAVED item returns to its real Annotation/PDF anchor. A Master item returns
  to its legitimate Master learning context; it receives an exact PDF target only if one truly exists.

### Important states

- **Empty:** explain explicit collection and point back to learning; never fabricate recommendations.
- **Loading:** retain page frame/list width and avoid pushing detail after data arrives.
- **Source current state changed:** show current state and the historical item simultaneously; do not
  mutate the saved answer or historical event.
- **Verification pending/failed/technical failure:** keep the curated item and exact AI content with
  honest status. PASS is “passed AI review,” not textbook authority or mastery.
- **Underlying source deletion:** the dependent membership follows existing cascade rules. Do not
  render an orphan copy as if still authoritative.
- **Provider unavailable:** browsing, filtering, source return and removal continue; this screen makes
  no provider call.

### Interactions and navigation outcomes

- Filter/browse by existing Book and legitimate Section/KP association; missing association remains
  visibly unassociated.
- Selecting an item opens exact source-backed content, not a generated summary.
- Return to source opens the corresponding PDF/Annotation or Master context. Returning to the list
  preserves the user's filter, selection context and practical scroll position.
- Removing membership removes only the curation relation after the existing mutation succeeds. It
  never deletes the underlying Master message/thread, Annotation, trust state or learning history.
- Search/filter is a projection over Memory membership metadata and source content; it creates no
  semantic tags or new authority.

### Explicit non-goals

- Automatic Learning Insights, weak-point extraction, learner profile, auto-enrolment or importance
  classification.
- Editing, rewriting, summarizing or merging the underlying Master/Assistant content.
- Generic notebook folders/tags, vector search, RAG, cross-book ontology or a second progress tree.
- Showing every Note, highlight, Master turn or learning event merely because it exists.

### Acceptance scenarios

- The page distinguishes a collected Master answer from a collected AI_SAVED explanation and shows
  the exact source-backed content for both.
- Current KP/Section state can change without erasing prior unresolved/history evidence or rewriting
  the Memory item.
- AI verification states remain honest; no Memory badge asserts textbook truth or learner mastery.
- Source return reaches the real Annotation/PDF or Master context, then Back restores the Memory list
  and filter context.
- Remove/reopen proves membership is gone while the underlying durable source remains. With AI
  disabled and after service restart, remaining Memory items are still readable.

## 7. Cross-Screen Navigation Contract

Navigation freezes semantic outcomes, not URL syntax, route names or frontend component ownership.

```text
Home / Learning Space
├─ Open Book / 查看全书结构 → Book Overview (same Book revision)
├─ Continue → Reader (persisted PDF page + reading anchor)
└─ Learning Memory → Learning Memory

Book Overview
├─ Continue PDF → Reader (persisted reading anchor)
├─ Section → Reader (resolved Section start)
└─ KP / source range → Reader (published KP source range)

Reader
├─ Back to Book → Book Overview (same Book and practical Chapter context)
├─ Marks / Guide / Assistant / Master → current task in Study Pane
└─ explicit collect → durable Learning Memory membership, without leaving source by default

Learning Memory
├─ Return to reading → Reader (last legitimate reading position)
├─ AI_SAVED source → Reader/Marks at exact durable PDF anchor
└─ Master source → durable Master Topic/message context, with PDF target only when legitimate
```

Rules:

- A source-return request carries stable domain identity plus the authoritative source locator. The
  frontend does not reconstruct a location from displayed title text or current focus.
- PDF targets use the relevant `BookSourceRevision`, `pdf_page_index` and normalized source geometry/
  range as defined by the owning context. Outline and KP navigation use their resolved/published
  authority.
- Guide citation return preserves Guide reading position; closing/reopening the pane restores the
  same PDF position unless the user intentionally followed a source target.
- Back returns to the semantically previous space and should preserve useful local selection/filter/
  scroll context. It is not permission to persist temporary Assistant state beyond the Reader
  lifecycle.
- Unresolved or deleted targets fail honestly with a scoped explanation and recovery route. Never
  fall back to a guessed page that looks successful.

## 8. UI Data / Action Matrix

The frontend is never the Product source of truth. It renders projections returned by owning
contexts, keeps reversible view state, and sends explicit actions to the real mutation boundary.

| UI element | Screen | Product source of truth | Read data | Allowed mutation/action | Readiness dependency | Failure behaviour |
|---|---|---|---|---|---|---|
| Import textbook | Home | Library | intake limits/status | Start existing intake | valid PDF commit | Inline concrete error; existing library works |
| Continue learning | Home / Overview | Learning + Library | reading anchor, Book revision | Navigate only | PDF READY | Missing anchor falls back to normal Book entry, not guessed Section |
| Book row / Open | Home | Library | Book, revision, page count | Navigate; existing delete via explicit flow | PDF READY for Reader | Child prep status never blocks Open |
| Chapter rail | Overview | Outline | logical nodes, order, resolution | Select Chapter / navigate resolved node | logical Outline for listing; physical target for jump | Scoped preparing/failure; PDF remains openable |
| Chapter map request/retry | Overview | Knowledge + Jobs | Chapter preparation state/progress | Request/retry same Chapter job | target Chapter evidence | Local failure; repeated actions converge |
| Section/KP row | Overview / Navigator | Knowledge + Learning + Outline | published KP, status, source range | Navigate to source | Chapter map READY for KP; resolved Outline for Section jump | No draft/guessed target; other navigation works |
| Source Navigator | Reader | Outline + Knowledge | Outline, current Section, current-Section KP projection | Open/close; navigate | PDF alone for open; target readiness for exact jump | Unavailable part is local; PDF remains usable |
| PDF page/zoom tools | Reader | Library/Foundation | PDF page, media box, labels | Page/zoom/view action | PDF READY only | Machine/AI failure does not disable |
| OCR selection/context menu | Reader | Foundation | READY page lines/cells | Select/copy; initiate annotation or Assistant | current OCRPage READY | Page-local explanation/retry; PDF readable |
| Highlight / USER note | Reader / Marks | Annotation | normalized anchor, quote/context, status | Create/open/delete existing asset | valid source anchor at persist boundary | Mutation failure is honest; no phantom success |
| AI_SAVED note detail | Reader / Memory | Annotation | SOURCE, PROVENANCE, AI CONTENT, verification | Open/delete; explicit collect | durable annotation exists | Review failure retained and labelled; delete follows ownership |
| Reading Guide | Reader Study Pane | Teaching | published Guide, sources, version/state | Open/close/resize; source return; request update | Section source; not inherently KP READY | Local failure/retry; current published version retained |
| Inline Teaching `✦` | Reader | Teaching + Foundation | published guidance, resolved anchor | Open/close intervention | published asset + resolvable anchor | Omit unsafe anchor; PDF unchanged |
| Assistant task | Reader Study Pane | Assistant temporary state + AgentRuntime | current scoped Root/Child/turns | Ask/follow up/switch/close/save | usable source context + provider only at Send | Failed turn local/retryable; Reader and other state unchanged |
| Master task/history | Reader Study Pane / Memory source | Learning + AgentRuntime | durable Topic/messages/history/scope | Ask/follow up/explicit resolve or status action | legitimate scope; provider only for new turn | Existing history remains; new turn failure local |
| Section learning confirmation | Reader | Learning + Knowledge | Section current state, owned KPs | Explicit positive or unresolved action | Chapter KP READY | Before readiness record reading only; never infer mastery |
| Marks detail | Reader Study Pane | Annotation | notes/highlights/AI_SAVED and anchors | Open, source return, existing edit/delete | durable annotation | Item-local error; PDF and other marks remain |
| Collect to Learning Memory | Reader/Master/Annotation surface | Learning Memory + durable source owner | eligibility, membership state | Explicit idempotent collect | completed Master answer or durable AI_SAVED | No membership on failure; source untouched |
| Memory browse/filter/detail | Learning Memory | Learning Memory + resolved source contexts | membership, grouping, exact source content/current metadata | View/filter/select | durable membership and source | Source-specific degradation; other items remain |
| Remove from Memory | Learning Memory | Learning Memory | membership identity | Remove membership only | membership exists | Honest retry; underlying source never deleted |
| Return to source | Overview / Reader Pane / Memory | Owning source context | stable identity + authoritative locator | Semantic navigation | target resolvable | Scoped “source unavailable”; never guessed success |

## 9. State / Degradation Matrix

The labels below are UI concepts. Preserve each owning context's exact domain-state names and legal
transitions; do not invent a global state machine.

| Capability | EMPTY / NOT READY | LOADING / PREPARING | READY | FAILED | STALE / DEGRADED |
|---|---|---|---|---|---|
| Library / intake | Empty library invites Import | Intake reports bounded local progress | Committed Book opens immediately | Concrete intake error; no half-Book success | Superseded revision remains distinct; deletion failure is retryable |
| PDF | No committed Book means no Reader | Page render may reserve its own surface | Original page readable/navigable | Page/intake error scoped to target; other Books/pages survive | Original revision remains authority; never replaced by OCR text |
| OCR page | Page is readable but not selectable | Page-local preparation; no global overlay | Selection/copy/OCR-dependent actions enabled | That page loses only OCR-dependent actions | Low-confidence/correctable machine text is indicated; PDF still rules |
| Outline | PDF page navigation remains | Logical/physical preparation shown locally | Logical tree visible; resolved nodes navigate | Structural navigation unavailable; PDF/page fallback remains | Partial resolution exposes only trustworthy targets; no guessed page |
| Chapter Knowledge Map | `NOT_PREPARED`; request applies to one Chapter | Chapter stage/progress, no draft KPs | One atomic published version shown | That Chapter only; explicit retry | Published version stays visible during update/failure; protected state is honest |
| Reading Guide | No published Guide; reading continues | Section-local generation/review | Published reviewed article opens | Guide-only error/retry | `STALE` version remains usable with update; unsafe content becomes unavailable locally |
| Inline Teaching | No intervention is normal | Section/anchor-local preparation | Published resolved `✦` is optional | Intervention omitted/local retry | Unresolvable anchors suppressed and flagged; never moved by guess |
| Assistant | No temporary conversation is normal | Current turn shows local progress | Completed answer/Root/Child usable | Failed turn remains retryable; no Product writes | No durable stale state; closing Reader clears unsaved conversation |
| Master | No Topic is normal until explicit learning need | New turn/review local to Topic | Durable message/history/current state visible | New turn fails; history intact | Current state and historical evidence may differ and are both shown |
| Annotations / Marks | No marks is a valid empty state | Mutation feedback stays item-local | Durable geometry/content renders | Save/delete error does not fabricate result | `NEEDS_REVIEW` retains original geometry; SOURCE/PROVENANCE/content remain distinct |
| Section/KP learning | Unconfirmed is a real state, not failure | Confirmation mutation has immediate bounded feedback | Current status shown from Learning | Mutation failure leaves prior state | `已阅读 · 待确认` is degraded readiness, never inferred mastery; history remains |
| Learning Memory | Empty means no explicit memberships | List/detail load reserves structure | Source-backed curated items browsable offline | Collect/remove failure is local and honest | Trust/current learning metadata may change; exact source/history is not rewritten |

Cross-cutting rules:

- `EMPTY` is a valid absence; do not style it as a system failure.
- `LOADING` is a transient read/projection state. `PREPARING` is an owned asynchronous capability
  state and may survive navigation/restart; the UI must not fake completion.
- `READY` means the owning context says the projection is usable. Review invocation failure never
  becomes READY/PASS.
- `FAILED` preserves every independent capability and durable asset.
- `STALE` remains shown and usable with an explicit update path unless it cannot be rendered safely.
- `DEGRADED` exposes the safe subset and explains the missing part. It does not silently suppress the
  entire parent surface.

## 10. Implementer Freedom

### MUST MATCH

- the four validated page compositions and three-space information architecture;
- Original PDF primacy and all Product/Frozen-Core semantics;
- visible hierarchy, typography relationships, density, restrained material and control weight;
- Book Overview ownership of the full Knowledge Map and Reader ownership of only current lightweight
  structure;
- the unified task-selected Study Pane, always-visible PDF in split study, and Assistant/Master
  semantic separation;
- semantic navigation outcomes and exact-source authority;
- the important state combinations and scoped degradation behaviour in this Brief;
- explicit user authority for learning confirmation, durable saves and Learning Memory membership.

### IMPLEMENTER MAY DECIDE

- internal component decomposition, module boundaries within the UI and local function naming;
- CSS implementation technique, ordinary layout primitives and breakpoint mechanics;
- exact reversible pane-resize mechanics and practical minimum widths that preserve the master;
- reusable primitive implementation and ordinary state-projection adapters;
- small accessibility improvements, accessible labels, focus restoration and keyboard bindings;
- ordinary error wording in Simplified Chinese, skeleton/progress details and local retry placement;
- test structure, screenshot tooling and small local refactors that do not change authority or visual
  direction.

Implementer freedom does not include using implementation convenience to merge domain owners, infer
learning state, persist Assistant conversations, hide the PDF, introduce a different visual theme or
replace one of the four screen responsibilities. Any proposed major visual redesign returns to
Planner/User approval.

## 11. Acceptance Checklist

### Visual fidelity

- [ ] At 1600px, captured Home composition, spacing, type hierarchy, colors, hairlines, controls and
      density compare faithfully with `01-home-learning-space.png`.
- [ ] At 1600px, captured Book Overview composition and Section-grouped map compare faithfully with
      `02-book-overview.png`.
- [ ] At 1600px, Reader pure-reading composition, PDF scale/centering, reduced chrome and quiet
      Teaching affordance compare faithfully with `03-reader-study-space.png`.
- [ ] At 1600px, Learning Memory list/detail proportions, content measure and trust/provenance
      hierarchy compare faithfully with `04-learning-memory.png`.
- [ ] Real dynamic content can grow without silent body truncation, unintended card stacking,
      arbitrary radii/shadows or a second visual language.
- [ ] System-font rendering is checked on the target Windows environment; hierarchy and line measure
      remain valid without downloading a custom font.

### Primary flows

- [ ] Home → Book Overview → Section/KP source → Reader works with the real 348-page Book.
- [ ] Home Continue returns to the persisted Book revision, page and reading anchor.
- [ ] Reader opens/closes Source Navigator, Guide, Assistant, Master and Marks detail without losing
      PDF position; the current task determines the one Study Pane body.
- [ ] Guide and Inline Teaching source actions return to the correct PDF target; Guide reading
      position is preserved.
- [ ] A completed eligible answer can be explicitly collected; Learning Memory shows its exact
      source-backed content and returns to the actual Annotation/PDF or Master context.
- [ ] Removing Memory membership leaves the underlying Master history or AI_SAVED Annotation intact.
- [ ] Back/close/reopen paths preserve the local state they are authorized to preserve and clear only
      temporary Assistant state at the existing destructive boundary.

### Readiness and degradation

- [ ] PDF READY + OCR NOT_READY keeps reading/navigation available and disables only page-local
      OCR-dependent actions.
- [ ] PDF READY + OCR READY + Chapter KP PREPARING keeps selection, annotation, Assistant and non-KP
      Guide usable and shows no draft KPs.
- [ ] PDF READY + Chapter KP READY + Guide FAILED keeps PDF/KP/Assistant/Master available and scopes
      retry to the Guide.
- [ ] Assistant FAILED keeps Reader usable and retry preserves the logical Root/Child identity.
- [ ] Section already read + mastery confirmation pending shows `已阅读 · 待确认`; no mastery is
      inferred.
- [ ] Chapter and Teaching replacement failure leaves the previous published version visible.
- [ ] AI-off retains Original PDF, prepared local layers, Notes, learning state, Memory and previously
      published assets.
- [ ] No child failure produces a global loading/error screen or turns Review failure into PASS.

### Authority and state integrity

- [ ] Actual PDF canvas remains the reading/source authority; OCR text is only the aligned selectable
      machine layer.
- [ ] Outline current Section is derived from the reading anchor; unresolved targets and printed
      pages are never guessed.
- [ ] KP navigation uses the published deterministic source range and revision.
- [ ] Annotation anchors use durable PDF geometry/quote context, not OCR IDs.
- [ ] Assistant and Master share visual space but not context, persistence, history or mastery
      authority.
- [ ] Reading position, answer completion, Guide completion, Review PASS and pane close never infer
      `UNDERSTOOD`.
- [ ] Temporary Assistant conversations do not enter Learning Memory automatically.
- [ ] Learning Memory current state and historical evidence remain distinguishable; removing
      membership mutates neither source nor history.

### Interaction, accessibility and runtime quality

- [ ] Every primary action is usable by pointer and keyboard; focus order follows visual order and
      focus is visible/not obscured.
- [ ] Icon-only controls have accessible names; pressed/expanded/selected state is exposed; color is
      not the only state signal.
- [ ] Open/close, save, source return and confirmation provide prompt restrained feedback without
      layout shift; reduced-motion removes nonessential transitions.
- [ ] Async controls prevent accidental duplicate visible actions while relying on backend
      idempotency for actual side-effect safety.
- [ ] Long Guide, Assistant/Master and Memory content scrolls without fixed controls covering the end;
      no primary target requires precision clicking.
- [ ] No uncaught runtime error, unhandled promise rejection, broken asset request or unexpected
      console error occurs in the four primary flows and required degraded states.
- [ ] At 1600px, 1280px and 1024px widths there is no application-level horizontal overflow; PDF,
      pane reading measure and primary controls remain usable.
- [ ] At common target heights (approximately 900–1000px), sticky/fixed regions do not obscure source
      content, errors or keyboard focus.

### Verification order

- [ ] Targeted state/projection and interaction checks pass first.
- [ ] A served real-use golden path with the real 348-page textbook exercises the four-screen flow and
      at least one failure/retry or close/reopen recovery.
- [ ] Affected Reader, Outline/Knowledge, Teaching, Assistant/Master, Annotation and Memory regression
      paths pass.
- [ ] A broad closure suite runs once before acceptance because the shared application shell and four
      primary user surfaces have a wide visual/interaction blast radius; it is not required after
      every edit.

## 12. Implementer Start Packet

The Implementer reads exactly this packet; Planner chat history is neither required nor authority:

1. `AGENTS.md`.
2. `PRODUCT_BLUEPRINT.md`.
3. Relevant `IMPLEMENTATION_BLUEPRINT.md` sections: §§3.5–3.6, 4.1–4.4, 6.1–6.4, 7.1–7.5,
   8.1–8.3, 10.1, 11.1–11.5, 12.1 and 12.4–12.6, 13.3–13.8, 14.1–14.11, 15.1–15.8,
   16.1–16.5, 17.1–17.6, 18.3–18.4, 19.1–20, and 22–23.
4. `docs/ui/briefs/FOUR_MASTER_SCREEN_IMPLEMENTATION_BRIEF.md`.
5. The four visual masters in `docs/ui/masters/`: `01-home-learning-space.png`,
   `02-book-overview.png`, `03-reader-study-space.png`, and `04-learning-memory.png`.
