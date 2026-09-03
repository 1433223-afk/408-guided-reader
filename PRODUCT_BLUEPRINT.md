# 408 Guided Reader｜Product Blueprint

> **Status: PRODUCT BASELINE — APPROVED**  
> **Date: 2026-09-02**  
> **Project identity: NEW PROJECT — not “V2” of the legacy project**  
> **Authority:** canonical product-direction blueprint for the new project.  
> **Purpose:** self-contained product/architecture baseline for a fresh model or human who knows nothing about the legacy implementation.  
> **Does not replace:** `IMPLEMENTATION_BLUEPRINT.md` or `LEGACY_TRANSITION_PLAN.md`; those remain separate downstream authorities.

---

# 0. Document role and naming

The new project is provisionally named:

> **408 Guided Reader / 408 导学阅读器**

Recommended repository name:

```text
D:\codex\408-guided-reader
```

This is a **new project**. It may selectively reuse proven components from the legacy `408-ai-ebook` repository, but legacy Product V1/V4/Phase rules are not automatically authoritative here.

This document deliberately avoids the name “V2”.

## 0.1 Minimal documentation strategy

The new project should eventually keep only **two canonical large documents**:

1. `PRODUCT_BLUEPRINT.md`
   - product positioning;
   - user journeys;
   - invariants;
   - lifecycle/ownership boundaries;
   - Agent responsibilities;
   - what is frozen vs deferred.

2. `IMPLEMENTATION_BLUEPRINT.md`
   - engineering architecture;
   - module boundaries;
   - persistence contracts;
   - implementation phases;
   - test/acceptance strategy;
   - provider/tool interfaces.

The legacy repository gets one temporary transition authority:

3. `LEGACY_TRANSITION_PLAN.md`
   - why the legacy project is being retired as product authority;
   - what must be preserved / archived / discarded;
   - exact Git source checkpoint after audit;
   - new repository path and initial structure;
   - execution order for old Codex;
   - references to audit evidence.

Claude may first produce:

```text
LEGACY_REUSE_AUDIT.md
```

but that is **an audit artifact, not a fourth canonical cold-start document**. Codex should read it only when performing the transition/reuse task.

Goal: minimal cold-start surface, no repeated giant document stack.

---

# 1. Product thesis

The product does **not** generate a replacement textbook.

> **The original PDF remains the book. AI becomes the teacher attached to the book.**

The target user wants the efficiency and direction of a good teacher without having to watch hundreds of hours of video courses, while still retaining the completeness, density, diagrams, formulas and wording of the original 408 textbook.

The product therefore solves five problems:

- **navigation** — where am I in the knowledge map and why am I learning this now;
- **motivation** — what problem a concept solves and why it exists;
- **bridging** — what prior ideas the author assumes and what logical steps are implicit;
- **local explanation** — any text, formula, figure or AI explanation can be unpacked immediately;
- **learning state** — what I currently understand, what I once did not understand, and what I resolved later.

---

# 2. Primary invariant: Original PDF is the reading authority

The Reader always displays the original PDF as the primary reading surface.

The system must not require reconstructed HTML/text to preserve the textbook.

The project does not make these legacy behaviors part of the product path:

- reconstructing the book from tiny source blocks;
- replacing textbook text with OCR text;
- reflowing or rewriting textbook pages;
- bulk extracting low-quality figures as the reading source;
- making textbook completeness depend on semantic mapping;
- forcing AI content between chopped pieces of the book.

A parsing/OCR error may reduce AI assistance quality, but it must **never make textbook content disappear from the Reader**.

---

# 3. Asset layers

## 3.1 Stable Book Foundation

A prepared book may contain:

- Original PDF / immutable source revision;
- PDF page geometry;
- OCR line layer (primary detected text geometry);
- fine-grained selectable geometry derived from recognition output;
- detected figure/table regions;
- printed-page mapping when recoverable;
- Stable Outline with physical ranges;
- prepared Chapter Knowledge Maps;
- Chapter structure versions.

## 3.2 Replaceable Section Teaching Layer

Generated per Section, on demand:

- Reading Guide;
- Inline Guidance;
- Guidance anchors;
- optional Active Retrieval / Recall prompts.

These artifacts are reusable and cacheable, but replaceable.

> **Replaceable does not mean disposable.**

Leaving a Section, closing the Reader, or closing the application does not automatically delete them.

## 3.3 User Learning Layer

Long-lived user assets include:

- Reading Position;
- KP Current Status;
- Section-level learning checks;
- Master threads / learning records;
- Learning History;
- Notes;
- Highlights;
- user-saved Assistant explanations.

These must not depend on the continued existence of a particular AI Guide version.

---

# 4. Progressive Book Bootstrap

Book preparation must be **progressively usable**, not a gate before reading.

## 4.1 Immediate readiness

As soon as PDF intake succeeds:

> **Original PDF is readable immediately.**

The user must not wait for full-book OCR, KnowledgePoints or AI generation just to open the book.

## 4.2 Background preparation

OCR/layout work proceeds page-by-page or in bounded batches:

```text
PDF intake
→ PDF readable immediately
→ OCR / layout progresses in background
→ already prepared pages gain selection/search/Assistant
→ unprepared pages remain readable as original PDF
```

The system may prioritize:

- table of contents / outline pages;
- the Chapter/Section the user opens;
- nearby pages required for the current learning scope.

## 4.3 Book Bootstrap outputs

Book-level preparation produces:

- OCR line layer + derived fine-grained selectable geometry;
- figure/table geometry;
- Stable Outline;
- page-label mapping when recoverable.

It **does not pre-generate the whole book's KnowledgePoints or teaching content**.

---

# 5. PDF page index vs printed textbook page

PDF page order and printed textbook page labels are different concepts.

The product must distinguish:

```text
pdf_page_index
printed_page_label  # optional / UNKNOWN when not recoverable
```

A simple page map may represent:

```text
PDF page 1  → printed page 76
PDF page 2  → printed page 77
...
```

Printed labels may also be absent or non-numeric. The system must not guess.

Rules:

- machine geometry uses `pdf_page_index`;
- user-facing citations prefer `printed_page_label` when confidently known;
- figures/tables also preserve visible caption identifiers when available, e.g. `图4.1`, `表3.2`.

---

# 6. OCR foundation: detected line geometry + fine-grained selectable geometry

V1 core OCR representation is:

> **detected line geometry + fine-grained selectable geometry**

Paragraph is optional and derived on demand.

*(Calibration amendment, 2026-09-03: this section previously read "word + line". It was restated
after `OCR_FOUNDATION_CALIBRATION.md` measured what OCR engines actually produce. The product
requirement is unchanged in substance — the user can still select a word or a phrase — but the
requirement is now expressed in terms of geometry the machine layer can genuinely deliver.)*

## 6.1 Line — the primary detected geometry

Line geometry is the primary geometry an OCR engine actually **detects**, and it is therefore the
anchoring authority of the machine layer.

Line-level geometry supports:

- nearby textual context;
- semantic Guidance targeting;
- locating a visible sentence/line on the original page;
- resolving AI semantic boundaries into page geometry.

## 6.2 Fine-grained selectable geometry

Below the line, the system needs geometry fine enough to support:

- precise selection;
- copying;
- highlighting;
- text-note anchoring;
- exact Assistant selection context.

This fine-grained geometry may be **derived** from recognition output — character cells, token
cells, or a mixture — rather than independently detected. It does not have to be a linguistic unit.

A Reader selection (a term, a word, a phrase) is **materialized on demand from a contiguous
fine-grained range within one line**. It is not a stored object.

Three constraints follow:

- the product does **not** require the OCR engine to natively emit linguistic word objects;
- do **not** create a permanent Product `Word` entity merely because the UI supports selecting
  words or phrases;
- product semantics must **never** infer a "word" from a provider field named `word_results` or
  anything similarly named.

> **What a provider's sub-line output actually contains is an engineering question answered by
> measurement, never by a field name.**

## 6.3 Paragraph

Paragraph is **not a stable Product object in the first version**.

When needed, the system can derive paragraph-like context from:

- selected words;
- current line;
- nearby lines;
- spacing/indentation/punctuation;
- headings;
- current KP/Section boundary.

This avoids rebuilding a SourceBlock-style domain hierarchy merely for convenience.

---

# 7. OCR is a correctable machine layer

Two truths must remain separate:

> **Original PDF = immutable reading/source truth**  
> **OCR/Layout = correctable machine interpretation**

**OCR/layout error reporting is a first-version Product capability.**

A user or operator must be able to report a machine-layer error without changing the PDF.

Example:

```text
PDF visually says: 总线
OCR says: 息线
```

A minimum report can identify conceptually:

```text
book/source revision
pdf_page_index
page geometry
quote/context when available
error type
optional user comment
```

There must also be an explicit **manual correction / override path** for the machine layer. A correction may create a corrected foundation revision or override, but it never edits the Original PDF.

The exact correction UI, moderation workflow, storage table and remap algorithm belong to `IMPLEMENTATION_BLUEPRINT.md`.

## 7.1 Foundation versioning

Once OCR/layout data has produced dependent assets such as:

- Chapter KP maps;
- Guides;
- Notes/Highlights;
- saved Assistant anchors;
- Master history anchors;

it must not be silently replaced.

OCR/layout correction or reprocessing creates a new **foundation version** or an equivalent explicit revision boundary.

Dependent artifacts are either:

- remapped with confidence;
- retained against the old foundation;
- or marked stale/degraded for explicit regeneration/review.

Exact remap algorithms belong in `IMPLEMENTATION_BLUEPRINT.md`, not here.

## 7.2 Different textbook/PDF revision

Replacing the PDF bytes with a different edition/source is **not OCR correction**.

A materially different PDF must become a new Book/source revision rather than silently invalidating old coordinates and learning assets.

---

# 8. Notes / Highlights anchoring — product rule

A durable text annotation must not rely on OCR character/token or line identifiers alone.

Recommended stable anchoring concept:

```text
book_source_revision
pdf_page_index
normalized page geometry / selection quads
selected quote
small text context before/after
foundation_version at creation
```

Interpretation:

- **page geometry** is the durable display anchor because the original PDF page does not move;
- **quote + surrounding context** is the semantic fingerprint used to recover from OCR corrections;
- OCR character/token and line IDs are convenient runtime references, not permanent authority.

For visual-region notes:

```text
pdf_page_index
normalized bbox
optional caption/context
```

If a correction cannot be remapped confidently:

> keep the original PDF geometry and mark the semantic anchor as needing review; never silently move a user's note to a guessed location.

---

# 9. Stable Outline must include physical ranges

The Outline is based on **explicit textbook structure**, not an AI-invented replacement hierarchy.

Typical nodes:

- Chapter / 一级标题;
- Section / 二级标题;
- Subsection / 三级标题;
- recognized special content nodes such as exercises/answers when needed for navigation.

Every meaningful Outline node must know its physical range in the PDF, conceptually:

```text
start: pdf_page_index + y/bbox
end:   pdf_page_index + y/bbox
```

This enables:

- directory jump;
- determining current Section;
- Section-scoped Assistant;
- System context;
- Section Learning Check placement.

## 9.1 Section lead-in

Text between a Section heading and its first Subsection:

- remains part of the Section content envelope;
- is visible to System/Assistant;
- does not need a separate Outline node or KP merely because it exists.

---

# 10. Visual regions: figures and tables

The first version permanently stores **geometry**, not bulk cropped image assets.

For a figure/table:

```text
pdf_page_index
bbox
type = FIGURE | TABLE
caption_line_reference(optional)
visible caption identifier(optional)
```

When an Agent needs to inspect it:

```text
Original PDF page + bbox
→ render/crop at suitable resolution on demand
→ send to multimodal model
```

A crop may be cached, but it is not the book's visual authority.

## 10.1 Captions

When possible, reuse an OCR line as the caption reference rather than creating a heavy Caption domain hierarchy.

## 10.2 Formula

The first version does not require every formula to become a permanent `FORMULA_REGION` object.

Use:

- OCR line/text when reliable;
- user-selected area;
- nearby PDF crop;
- KP/Section context.

Formula-specific persistent regions can be added later if real use proves necessary.

---

# 11. KnowledgePoint definition

> **A KnowledgePoint is the smallest learning unit for which keeping an independent understanding state has real learning value.**

A KP is not automatically:

- a paragraph;
- a bold list item;
- every tertiary heading;
- every 命题追踪 entry;
- every term;
- every exercise collection.

The generator asks:

1. How many genuinely different core questions does this content answer?
2. Which ideas lose meaning if separated?
3. Can the user realistically understand A while not understanding B?
4. Would separately recording A/B progress help future learning?

Default:

> **merge unless independent learning-state value justifies a split.**

---

# 12. KP ownership: exactly one primary Section

Each KP must have **exactly one primary Section** for learning progress.

A KP does not straddle two Sections as a single progress object.

Cross-Section relationships may exist as:

- prerequisite;
- bridge/context;
- related concept;
- supporting evidence.

But Section-level mastery depends on an unambiguous membership relation:

```text
Section 4.2
  ├─ KP-A
  ├─ KP-B
  └─ KP-C
```

---

# 13. KP location: continuous range first

The first version uses a continuous range by default:

```text
start_page
start_y
end_page
end_y
```

Cross-page ranges are allowed.

Do not introduce permanent multi-span business structures until real textbook evidence shows they are needed frequently enough to justify the complexity.

---

# 14. Lazy Chapter Preparation

The whole book does **not** receive all KPs at upload time.

KnowledgePoint generation is lazy and Chapter-scoped.

> **Maximum KP generation scope = one Chapter / 一级标题.**

When a user first chooses a Section in an unprepared Chapter:

```text
Chapter map NOT_PREPARED
→ generate Chapter KP draft
→ resolve ranges
→ structural review
→ deterministic validation
→ PASS
→ Chapter map READY
```

Prepared Chapters remain stable while untouched Chapters can later use improved KP generation Skills/models.

Possible states:

```text
NOT_PREPARED
PREPARING
READY
FAILED
```

If Chapter Preparation is `FAILED`:

- Original PDF reading remains available;
- OCR-ready selection/search/Assistant remain available;
- Notes/Highlights remain available;
- KP-dependent Mastery/Progress capabilities remain unavailable for that Chapter;
- the user/system may explicitly retry preparation;
- a partial or failed draft must never masquerade as a `READY` Chapter Knowledge Map.

---

# 15. Chapter Structure review and correction

Chapter KP structure is **stable after user assets depend on it**.

## 15.1 Before user learning assets exist

If a Chapter has no KP-linked user assets, its draft/map may be regenerated or corrected relatively freely before becoming relied upon.

## 15.2 After user learning assets exist

Once any of these exist:

- KP Progress;
- Master history/thread linked to KP;
- KP-linked Note/Highlight;
- other durable learning assets;

the first product version **forbids destructive Chapter structure changes** unless an explicit migration/remap mechanism exists.

No silent merge/split/re-ID.

Post-progress Structure Upgrade is deferred until formal migration support exists.

A Chapter structure version is therefore required conceptually.

---

# 16. Structural reviewer is pipeline-internal, not a fifth Product Agent

Chapter Preparation may call:

```text
KP Generator context/model
→ deterministic range resolver
→ independent KP Structural Reviewer
→ deterministic validation
```

This does not create a fifth user-facing Product Agent.

For stable Chapter structure, reviewer independence should be strong:

> **prefer a genuinely different model/provider when practical; a same-model clean-context reviewer is a fallback, not the highest-assurance mode.**

Exact provider routing remains an engineering decision.

---

# 17. Section Teaching generation

Teaching generation is smaller and more replaceable than KP generation.

> **Maximum AI Teaching scope = one Section / 二级标题.**

A Section Teaching Layer may contain:

- Reading Guide;
- Inline Guidance;
- Active Retrieval / Recall prompts;
- their resolved anchors.

It never needs to generate adjacent Sections merely because they exist.

## 17.1 Teaching artifacts only depend on structure that actually exists

> **An artifact may only depend on structure that actually exists.**

The **Reading Guide itself is not KP-dependent**. It may be generated from:

- the Section's original PDF/OCR content;
- Stable Outline and Section physical range;
- textbook exam evidence such as 命题追踪;
- necessary nearby context.

Likewise, general line/figure/table Guidance may be generated without a READY Chapter Knowledge Map when it does not claim KP semantics.

Only teaching artifacts that explicitly rely on KP structure must wait for the Chapter Knowledge Map to be `READY`, for example:

- KP-transition bridges;
- KP-end teaching interventions;
- Guidance whose meaning depends on a specific KP identity/boundary.

The implementation must not invent KP semantics while Chapter Preparation is still pending.

---

# 18. AI teaching is optional and user-controlled

AI teaching is an enhancement, not the entrance ticket to the textbook.

The product must support an **Original-only / AI-off path**.

The user also owns the desired level of AI teaching intrusion. The exact number/names of intensity levels are not frozen here, but the invariant is:

> **System cannot unilaterally decide how much AI is allowed to intrude into the page.**

At minimum the user can disable Inline Guidance entirely.

Reading Guide may remain explicitly openable even when Inline Guidance is off; exact UI control belongs to the UI/implementation design.

If Guide generation is:

- not requested;
- pending;
- unavailable;
- failed;

Section reading must still work.

---

# 19. Opening a Section never waits for AI

Directory navigation is immediate.

When the user clicks `4.2`:

```text
jump to original PDF Section immediately
↓
if Chapter KP missing: prepare in background / priority queue
↓
when KP READY: Progress + Master features become available
↓
if AI Teaching requested: generate Section Guide in background
↓
when Guide READY: Reading Guide / ✦ appear dynamically
```

Failure matrix:

```text
PDF available                    → reading works
OCR current page available       → selection/search/Assistant works
Chapter KP READY                 → Master/KP progress works
Section Guide READY + enabled    → Reading Guide/✦ works
```

No AI failure should blank or lock the original page.

## 19.1 Reading readiness and Mastery readiness are separate

A user may reach the end of a Section before its Chapter Knowledge Map is `READY`.

The Section Learning Check is therefore a **KP-dependent capability**.

If the user reaches the Section end while Chapter Preparation is still pending:

```text
本节学习结构仍在准备
✓ 阅读位置已记录
```

The Reader must not block or interrupt continued navigation.

When the Chapter Knowledge Map becomes `READY`, the Section becomes eligible for its normal Learning Check:

```text
[ 都清楚了 ]
[ 还有些地方不完全清楚 ]
```

If the learner has already left the Section, the product may surface that state as conceptually:

```text
已阅读 · 待确认
```

Reading Position may exist before Mastery readiness; bulk KP state changes may not.

---

# 20. Reading Guide

Reading Guide is Section-level macro scaffolding, not a rewritten mini-textbook and not 1:1 with KP.

Useful modules may include:

- **定位** — where this sits in the larger map;
- **动机** — what problem the concept solves;
- **桥接/前置知识** — what earlier concepts the section assumes;
- **阅读路线** — what questions organize the section;
- **防坑** — ambiguity, common misconceptions, typical exam traps;
- **权重证据** — what deserves more attention and why;
- **图表阅读方法** — how to read an important figure/table;
- **退出标准** — what the learner should be able to explain afterwards;
- **Active Retrieval** when it genuinely improves learning.

Modules are chosen because they help, not because a template requires all of them.

## 20.1 Factual vs pedagogical freedom

> **Professional conservatism + pedagogical boldness**

Hard-truth claims include:

- professional definitions/causality;
- textbook statements;
- syllabus claims;
- exam-year evidence;
- numeric facts.

These require evidence/correctness.

Pedagogical freedom includes:

- analogies;
- mental models;
- teaching viewpoints;
- “what problem is this really solving?”;
- reading strategy.

These may be creative as long as they do not introduce technical falsehoods.

## 20.2 Prerequisite rule

System may say:

> “Before reading this, make sure you can explain X.”

It must **not infer and state that the user personally has a prerequisite deficit merely from Progress data**.

## 20.3 Exam-weight claims must be user-traceable

When a Reading Guide labels something as:

- 重点;
- 高频;
- 常考;
- especially worth prioritizing for the exam;

the user must be able to inspect the basis for that claim.

First-version evidence should primarily come from textbook 命题追踪 and applicable official syllabus evidence.

Conceptually:

```text
★★★ 重点
依据：教材命题追踪（2017 / 2021 / 2024）
```

Future teacher opinions must remain attributed to their source rather than being presented as objective exam-frequency facts.

---

# 21. ExamTopic first-version rule

For the first version:

> **ExamTopic is lightweight exam-evidence metadata associated with one or more KPs, and initially represents textbook 命题追踪 evidence.**

It is not a second progress tree.

V1 does not require independent ExamTopic mastery/progress.

Future work may introduce:

- a dedicated exam-topic record table;
- real past-exam RAG;
- frequency/type evidence;
- independent ExamTopic progress;
- attributed teacher viewpoints.

Teacher opinions must remain attributed rather than being transformed into objective exam facts.

A single ExamTopic / 命题追踪 evidence item may relate to **one or multiple KPs**.

Multi-KP association does not create a second progress tree and does not require duplicating the evidence into conflicting independent “topics”.

ExamTopic/命题追踪 evidence does **not** determine how KP is split.

---

# 22. Inline Guidance and ✦ anchors

Inline Guidance is a sparse teaching intervention layer.

Possible roles:

- lead-in;
- bridge;
- warning;
- figure/table reading hint;
- implicit logical connection;
- occasional recall prompt.

A KP may have zero, one or many Guidance interventions.

No rule requires N interventions per KP.

## 22.1 Semantic target vs visual placement

System chooses a semantic target and teaching intent.

It does not output final screen pixels.

Example:

```text
target = current OCR line / heading / figure / table
placement_intent = AFTER | BESIDE | ...
```

Reader resolves the target to the page geometry and chooses the final margin position.

> **AI decides teaching location; deterministic UI decides visual placement.**

## 22.2 Text target

Text Guidance may reference an OCR line/heading at generation time.

Persistent anchor authority should include the resolved:

- `pdf_page_index`;
- geometry;
- quote/fingerprint;
- foundation version.

A runtime `line_id` alone is not durable authority.

## 22.3 Figure/table target

Prefer caption location when available.

Fallback to the visual-region bbox.

If confident placement cannot be resolved, omit the Guidance rather than guessing.

---

# 23. Generated Teaching version dependencies

A saved Section Teaching Layer should know conceptually what it was generated against.

Dependencies are **artifact-specific**: an artifact records only the structure it actually used.

Possible dependencies include:

```text
book_source_revision
ocr/layout foundation version
chapter_structure_version       # only when that artifact actually used KP structure
system_skill_version
model/provider metadata as needed
```

A Reading Guide generated before Chapter KP is READY must not pretend to depend on a nonexistent `chapter_structure_version`. Conversely, a KP-transition Guidance must record the Chapter structure it used.

When an important dependency changes, an old Guide may become:

> **STALE / update available**

It must not be silently rewritten or silently remapped with low confidence.

The user may continue using an older saved Guide until explicitly regenerating it, unless it is no longer safely anchorable.

---

# 24. Assistant: Reader-native, temporary, Section-isolated

Assistant works independently of Generated Teaching.

Where the current page has sufficient OCR/visual context, Assistant can work even when:

- Chapter KP is not ready;
- Section Guide does not exist;
- AI Teaching is switched off.

## 24.1 Scope

Section scope is preferred whenever Stable Outline ownership is resolvable.

```text
4.2 Assistant context ≠ 4.3 Assistant context
```

No cross-Section conversation contamination.

If the current OCR-ready page/selection is usable **before a stable Section can be resolved**, Assistant may still operate in a temporary **page/local scope**.

Such fallback context:

- must not guess a Section;
- remains isolated from Section-scoped Assistant contexts;
- must not be automatically merged into a later-resolved Section conversation;
- remains temporary under the same close/Reader-lifetime rules.

This preserves progressive PDF/OCR usability without inventing textbook structure.

## 24.2 Explain any visible/selectable content

Assistant may explain:

- original textbook text;
- figures/tables/formulas;
- Reading Guide text;
- Inline Guidance text;
- Master answers;
- Assistant's own previous answer text;
- other visible/selectable textual content.

Recursive explanation is a product capability.

Exact depth limits belong to implementation safeguards, not this product invariant.

## 24.3 Temporary lifetime

Assistant conversation is not a durable learning record by default.

- switching Assistant ↔ Master tabs does **not** close it;
- switching Sections during the same open Reader experience may retain each Section's temporary context separately;
- explicitly closing that Assistant workspace clears that Section's temporary conversation;
- closing the Reader/application also clears unsaved Assistant conversations.

A user may explicitly:

> **Save to Notes**

Saved content then becomes a durable user asset anchored to its source context where possible.

---

# 25. Shared right-side AI Dock

Assistant and Master share one right-side workspace rather than competing sidebars.

Conceptually:

```text
[解释 Assistant] [学习 Master]
```

Only one is visually active at a time.

Tab switching does not equal closing.

- Assistant temporary state may remain until explicit close / Reader close;
- Master state/thread remains durable according to Master rules.

Future wide-screen dual-open layouts are optional, not required in the first version.

---

# 26. Master: persistent learning workspace

Master exists to manage understanding, not merely answer arbitrary selected text.

Its durable relationship is with:

- KP;
- Section;
- current understanding state;
- past learning questions/resolutions.

Unlike Assistant, Master threads/history are **persistent across Reader/app sessions**.

The system may additionally maintain structured summaries/status alongside the visible thread so future reasoning does not need to replay every raw token.

---

# 27. Master entry model: local exception + Section confirmation

The product does not interrupt the learner after every KP with a mandatory quiz.

There are two Master entry paths.

## 27.1 KP-local low-intrusion entry

At the physical end of a KP, a small page-margin entry may appear:

> `? 这里没完全懂`

It is optional and non-blocking.

Clicking opens:

```text
Master scope = current KP
```

## 27.2 Section Learning Check

At the end of the **main teaching content** of a Section:

> **这一节整体感觉怎么样？**

```text
[ 都清楚了 ]
[ 还有些地方不完全清楚 ]
```

It is anchored near the Section's physical end of teaching content, not shown as a modal interruption.

---

# 28. Section Learning Check state rules

## 28.1 Positive bulk confirmation

If the user explicitly selects:

> `都清楚了`

all KPs whose primary owner is this Section become currently:

```text
UNDERSTOOD
```

If this Section currently has a `HAS_UNCLEAR / unresolved` learning-check state, explicit `都清楚了` resolves/clears that **current** Section-level unresolved state.

Its historical unresolved event remains retained in Learning History.

Previous KP-level confusion/history likewise remains preserved.

## 28.2 Negative response is not bulk negative

If the user selects:

> `还有些地方不完全清楚`

the system must **not guess which KP is unclear** and must not mark every KP `NOT_FULLY_CLEAR`.

Instead:

1. record a Section-level `HAS_UNCLEAR / unresolved learning check` event/state;
2. open Section-scoped Master;
3. wait for actual user questions/indications;
4. relate genuine issues to one or more KPs when evidence exists.

Only identified related KPs become `NOT_FULLY_CLEAR`.

If the user opens Master and leaves without explaining the issue:

- KPs remain `UNCONFIRMED` unless already otherwise set;
- the Section-level unresolved check may remain visible.

## 28.3 No response

Scrolling past the Section is not mastery.

If the user does not answer the Learning Check:

- Reading Position may advance;
- KP mastery remains `UNCONFIRMED`.

> **Reading progress ≠ mastery progress.**

---

# 29. Master history

Current understanding state is mutable.

Learning history is append-oriented.

Example:

```text
KP: 扩展操作码
current_status = UNDERSTOOD

history:
- user previously marked/expressed unclear
- question: 为什么扩展操作码不会冲突？
- Master discussion / explanation
- user later confirmed understanding
```

A learner may become unclear again later without erasing the previous resolution.

Master may also keep Section-level threads/questions when a question genuinely spans multiple KPs.

---

# 30. Interactive AI trust and review policy

System, Master and Assistant do not carry the same latency, persistence or authority, so they do not use the same Review policy.

## 30.1 Grounding rules can never be switched off

User-controlled Review settings govern **independent model verification**, not basic truthfulness constraints.

Even in the fastest mode, Master/Assistant must:

- ground textbook claims in the available PDF/OCR/figure/Section/KP context;
- distinguish textbook content from AI explanation and external extension;
- never fabricate textbook quotes, printed pages, figure/table identifiers, syllabus claims, past-exam evidence or citations;
- state uncertainty when the available source is uncertain rather than inventing missing evidence.

`Review = OFF/Fast` therefore means:

> **no normal independent reviewer call**, not “no factual discipline”.

## 30.2 System Teaching assets: mandatory independent Review

Persistent System assets such as:

- Reading Guide;
- Inline Guidance / ✦;
- other publishable reusable teaching content;

must pass independent Review before being treated as accepted Teaching Assets.

The user may switch AI Teaching off, but may not publish a formal System Teaching Layer by bypassing its required Review.

## 30.3 Master: user-selectable Review strength

Master prioritizes trustworthy learning decisions but should not force maximum latency on every interaction.

The first version supports conceptually:

### Fast

- normally no independent reviewer call;
- fastest response;
- grounding/trust rules still apply;
- risk triggers may escalate verification.

### Standard — default

- independent verification focused on **academic/objective correctness**;
- checks technical facts, logic, formulas when relevant, source attribution and fabricated textbook/exam claims;
- does not require a heavy pedagogical rewrite review for every answer.

### Deep

- independent verification additionally checks reasoning completeness, whether the answer actually resolves the question, and teaching quality when useful.

Purely conversational/UI turns such as clarification requests or status prompts need not invoke a reviewer.

A user preference sets the normal path; risk-based routing may **raise** verification strength when needed but must not silently lower it.

## 30.4 Assistant: fast by default, verification optional

Assistant is an immediate local explanation tool.

Default:

> **no independent reviewer call.**

The user may enable a Verified mode when desired.

Assistant should automatically escalate to independent verification in bounded higher-risk cases, including when practical:

- the user explicitly asks whether an interpretation/fact is correct;
- complex formulas, derivations or numerical relationships are being adjudicated;
- the answer materially extends beyond the current textbook context;
- OCR/visual/source interpretation is uncertain;
- the answer asserts specific textbook/syllabus/past-exam attribution;
- the user chooses to persist an AI explanation as a durable note.

Exact routing thresholds and verifier models belong to `IMPLEMENTATION_BLUEPRINT.md`.

## 30.5 Durable Assistant content

Normal Assistant conversation remains temporary.

When the user chooses **Save to Notes**, the selected AI explanation is crossing from temporary draft-like interaction into a durable learning asset.

The first version should verify that saved explanation before treating the AI-authored content as a trusted durable note. The source selection/anchor itself remains the user's asset regardless of whether the AI wording passes verification.

## 30.6 Review never owns Mastery

A Reviewer may decide that an AI answer is acceptable.

It may **never** conclude from that alone that the learner is `UNDERSTOOD`.

Mastery changes remain controlled by:

- explicit user confirmation;
- or a future formally designed assessment capability.

---

# 31. Exercises and answers: first-version boundary

The textbook may contain tertiary headings such as:

- 本节习题精选;
- 答案与解析.

**Recommendation for the first version:** keep these as recognized/special Outline content, but do **not** automatically make the exercise collection or answer collection a KnowledgePoint merely because it is a tertiary heading.

Reason:

> KP identity is based on independent understanding-state value, not heading level.

Making `答案与解析` a KP would blur “understanding the concept” with “visiting an answer section”.

For the first version:

- exercises/answers remain fully readable in the original PDF;
- Assistant/Notes/Highlights work there;
- main Section mastery confirmation occurs at the end of teaching content, **before practice/answer material when the textbook places it afterward**;
- individual exercise → KP mapping is deferred;
- adaptive exercise selection, auto-scoring, wrong-question flow and Practice Progress are deferred unless separately approved.

Individual exercise-to-KP mapping is intentionally deferred because it is a nontrivial semantic engineering problem and is not required for the first learning loop.

---

# 32. Recall / Active Retrieval does not control mastery

In the first version, System-generated Recall / Active Retrieval is a teaching intervention, not a scoring engine.

Whether the user:

- answers;
- skips;
- answers correctly;
- answers incorrectly;

must not automatically set KP `UNDERSTOOD` or `NOT_FULLY_CLEAR`.

Mastery remains controlled by explicit learning-state interactions until a future assessment model is deliberately designed.

---

# 33. Four Product Agents

The product retains four logical Agents.

## 33.1 System

Produces/controls:

- Reading Guide;
- Inline Guidance;
- teaching sequence/bridges;
- sparse Active Retrieval;
- pedagogical context.

## 33.2 Review

Review is the independent verification capability.

For formal System Teaching Assets it performs mandatory acceptance review for:

- technical correctness;
- unsupported factual claims;
- evidence for exam-weight claims;
- pedagogical usefulness;
- unnecessary intrusion;
- misleading textbook/AI attribution;
- need for rework.

For interactive Master/Assistant answers it may also perform the lighter or risk-triggered verification defined in §30; those interactive checks do not automatically turn the answer into a formal System Teaching Asset.

Generation and Review contexts remain independent. A stronger/different reviewer model is preferred where justified.

Normal-path rework is bounded; the first implementation should use a finite retry principle rather than open-ended loops.

## 33.3 Master

Owns:

- understanding-state interaction;
- persistent KP/Section learning threads;
- Current Status;
- Learning History;
- identification of unresolved learning issues.

## 33.4 Assistant

Owns:

- local explanation of any visible/selectable content;
- temporary recursive clarification;
- local figure/table/formula explanation.

---

# 34. Model is not Agent

Different capabilities may use:

- different model providers;
- or the same model in isolated clean contexts.

Example:

```text
KP Generator Context
KP Structural Review Context
System Teaching Context
Teaching Review Context
Master Context
Assistant Context
```

These contexts must not silently share irrelevant conversation history.

Product role count is not determined by model-call count.

---

# 35. User navigation and returning to old content

The directory is always navigable.

The user may leave the currently studied Section and jump backward/forward at any time.

If an older Section has a saved Teaching Layer:

- restore it when enabled;
- restore saved Guidance anchors where still valid;
- preserve Notes/Highlights/Master state.

If it has never generated Teaching:

- original PDF still works;
- Assistant still works where OCR is ready;
- Notes/Highlights still work;
- user may explicitly generate AI Teaching later.

If the Guide is stale:

> show the saved version plus an explicit regeneration/update option when safe; do not silently overwrite.

---

# 36. High-confidence first-version product flow

```text
Upload PDF
↓
Original PDF immediately readable
↓
Background OCR/Layout + Outline
↓
User clicks a Section in directory
↓
Original PDF jumps there immediately
↓
Chapter KP missing?
├─ yes → prepare/review Chapter in background
└─ no
↓
AI Teaching enabled/requested?
├─ yes → Reading Guide/general Guidance may generate without waiting for KP
│         KP-dependent Guidance waits for Chapter KP READY
└─ no → original-only learning
↓
During reading
├─ ✦ optional System Guidance
├─ select anything → Assistant
├─ KP-local unclear → Master only when KP structure is READY
├─ Notes / Highlights
└─ original PDF remains primary
↓
End of teaching content for Section
├─ Chapter KP READY
│   ├─ 都清楚了 → Section KPs UNDERSTOOD
│   └─ 还有些不清楚 → Section unresolved + Master, no guessed bulk-negative KP state
└─ Chapter KP still PREPARING/FAILED
    └─ record Reading Position; Mastery Check waits for READY/retry
```

---

# 37. Decisions now treated as agreed

Unless explicitly reopened, the following are current product baseline decisions:

1. New project identity is separate from the legacy project; stop calling it V2.
2. Original PDF is the Reader authority.
3. PDF opening does not wait for OCR/AI completion.
4. OCR core is detected line geometry plus fine-grained selectable geometry derived from recognition output; paragraph is derived/optional; no permanent Product `Word` entity, and no product semantics inferred from a provider field name.
5. OCR/Layout is correctable and versioned; PDF source revision is separate.
6. OCR/layout error reporting and a manual machine-layer correction path are first-version capabilities.
7. Notes/Highlights use PDF geometry + quote/context, not OCR IDs alone.
8. PDF index and printed textbook page label are distinct.
9. Outline nodes have physical ranges.
10. Section lead-in belongs to Section context without needing its own learning node.
11. Figure/table regions store geometry; high-resolution crops are generated on demand.
12. Formula is not a mandatory persistent region in the first version.
13. KP is defined by independent learning-state value.
14. Every KP has exactly one primary Section.
15. KP location uses continuous range first.
16. KP generation is lazy, max one Chapter.
17. Chapter Preparation failure never blocks PDF/Assistant/Notes; partial drafts never masquerade as READY.
18. Chapter structure becomes protected once durable user learning assets depend on it.
19. KP Structural Review is pipeline-internal, not a fifth Product Agent.
20. AI Teaching generation is max one Section.
21. Reading Guide is not KP-dependent; only artifacts that use KP semantics must wait for KP READY.
22. AI Teaching is optional and intrusion is user-controlled, including OFF.
23. Opening a Section never waits for Guide generation.
24. Guide is cacheable/persistent and explicitly regenerable, not auto-deleted.
25. Generated Teaching records only the dependency versions it actually used and can become STALE.
26. Section Learning Check is KP-dependent; reading can finish before Mastery readiness.
27. Assistant prefers Section-isolated temporary scope; before Section ownership is resolvable it may use an isolated temporary page/local fallback scope that is never auto-merged.
28. Assistant conversation clears on explicit close / Reader close unless content is explicitly saved.
29. Assistant and Master share one right-side AI Dock.
30. Master learning threads/history persist.
31. KP-local Master entry is optional and low-intrusion.
32. Primary mastery confirmation happens at Section end when Chapter KP is READY.
33. “都清楚了” can bulk-positive the Section's KPs and resolves any current Section-level HAS_UNCLEAR/unresolved state while preserving history.
34. “还有些不清楚” never bulk-negatives KPs; it creates a Section-level unresolved state and opens Master.
35. Reading Position does not imply Mastery.
36. Current Status can change; Learning History is retained.
37. ExamTopic is lightweight exam-evidence metadata associated with one or more KPs, initially representing textbook 命题追踪; no independent progress yet.
38. One ExamTopic evidence item may associate with one or multiple KPs without creating duplicate progress.
39. Exam-weight claims shown to the user must expose their evidence.
40. Exercises/answers are special Outline content, not automatically KP; per-question KP mapping is deferred.
41. Recall/Active Retrieval does not automatically change mastery.
42. Four Product Agents remain System / Review / Master / Assistant.
43. Basic grounding/source-truth rules apply to interactive AI even when independent Review is disabled.
44. Formal System Teaching Assets always require independent Review.
45. Master Review strength is user-selectable: Fast / Standard(default academic-objectivity verification) / Deep, with bounded risk-based escalation.
46. Assistant defaults to no independent Review; user can enable verification and bounded high-risk cases may escalate automatically.
47. Persisting AI-authored Assistant content as a durable note triggers verification.
48. Reviewer acceptance never changes user Mastery by itself.

---

# 38. Deferred, not forgotten

These are intentionally deferred rather than unresolved blockers for the product skeleton:

- independent ExamTopic table/progress;
- full past-exam RAG and statistical exam-frequency layer;
- attributed teacher-video knowledge layer;
- individual exercise → KP mapping;
- adaptive practice / scoring / wrong-question system;
- formal post-progress Chapter KP remap/migration;
- formula-specific persistent object model;
- exact AI intrusion-level enum;
- exact UI wording and routing thresholds for Master/Assistant Review modes;
- exact OCR/remap algorithms;
- exact persistence schema;
- concrete Reader/OCR/frontend/provider technology choices;
- final commercial product brand.

---

# 39. What this document intentionally does not decide

Do not infer implementation choices from product semantics.

Not frozen here:

- database tables;
- ORM;
- UUID formats;
- JSON vs relational OCR storage;
- PDF.js vs MuPDF vs other Reader engine;
- OCR engine;
- frontend framework;
- provider/model assignment;
- exact bbox normalization;
- exact retry counts/schedules where not already a product invariant;
- exact legacy Git checkpoint;
- exact set of legacy files to copy.

Those belong to engineering/audit work after this Product Blueprint is approved.

---

# 40. Next document sequence

This Product Blueprint has passed closure at the product-authority level.

Next:

1. ask Claude to perform a **legacy reuse audit** against the actual legacy repository and produce `LEGACY_REUSE_AUDIT.md`;
2. use that audit to write/freeze `LEGACY_TRANSITION_PLAN.md`, including exact Git checkpoint, keep/discard matrix, new folder structure and transition steps;
3. execute the legacy transition with Codex only after those decisions are explicit;
4. build `IMPLEMENTATION_BLUEPRINT.md` for the new repository using this approved Product Blueprint + reuse audit results;
5. only then start implementation phases.

The audit artifact is evidence. `PRODUCT_BLUEPRINT.md` and `IMPLEMENTATION_BLUEPRINT.md` are the lasting new-project authorities; `LEGACY_TRANSITION_PLAN.md` is the temporary transition authority for legacy cleanup/migration.

---

# 41. One-sentence architecture

> **408 Guided Reader keeps the original textbook as the permanent reading surface, progressively builds a machine-readable layer around it, creates stable learning structure only when needed, and adds optional AI teaching exactly where the learner needs a teacher—without replacing the book.**
