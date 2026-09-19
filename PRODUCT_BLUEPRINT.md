# 408 Guided Reader｜Product Blueprint

> **Status: FROZEN — PRODUCT AUTHORITY, GATE D CLOSED**  
> **Baseline date: 2026-09-02** · **Frozen at Gate D: 2026-09-03**  
> **Project identity: NEW PROJECT — not “V2” of the legacy project**  
> **Authority:** canonical product-direction blueprint for the new project. Frozen as of Gate D closure (independent ZCode review: `PASS_WITH_P2`, P0=0, P1=0); non-blocking P2 debt is tracked in `IMPLEMENTATION_BLUEPRINT.md` §27, not here.  
> **Purpose:** self-contained product/architecture baseline for a fresh model or human who knows nothing about the legacy implementation.  
> **Does not replace:** `IMPLEMENTATION_BLUEPRINT.md` or `LEGACY_TRANSITION_PLAN.md`; those remain separate downstream authorities.

> **Closure patch, 2026-09-03:** following `LEGACY_PRODUCT_SEMANTICS_DELTA_AUDIT.md` and independent
> ZCode Implementation Blueprint review, this revision adds explicit Assistant recursion semantics
> (§24.4–§24.7), Master Topic/mastery-authority semantics (§26.1–§26.3), Review rework/terminal-failure
> and published-version-safety semantics (§23.1, §33.2.1–§33.2.3), Section/Chapter failure-isolation
> and atomic-publication rules (§14.1, §17.2), Outline incremental-publication and correction-
> granularity rules (§9.2–§9.3), foundation-version staleness scoping (§7.1.1), optional annotation KP
> bookkeeping (§8.1), a Teaching closure quality bar (§20.4), and a User Style structural boundary
> (§35, renumbering all sections from the old §35 onward by one). Every addition carries forward a
> user-adjudicated **behavior**, never legacy architecture — no SourceBlock, Stable Semantic Anchor,
> KnowledgeDataset, old RenderTree, old EbookSession, or old Window UI is restored by this patch.

> **Outline conceptual correction, 2026-09-03 (same day, follow-up):** the closure patch above
> introduced a "publish the Outline per region" model to let Chapter KP Preparation start before the
> whole book's Outline was done. That model conflated **logical directory structure** with **physical
> range resolution**. §9 is rewritten: the logical tree (Chapter/Section identity, title, order) is
> now established early — normally from PDF bookmarks/TOC, independent of body OCR — while physical
> resolution (start/end position) improves progressively per node without ever minting a new logical
> node or gating directory visibility. The regional-publication framing is removed from Product
> authority; `IMPLEMENTATION_BLUEPRINT.md`'s `OutlineRegion` mechanism is demoted accordingly (see its
> own revision note). This also removes the book-level `outline_version` as a staleness authority —
> see the new §19.2b there.

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
- user-facing navigation, page indicators and citations use one-based **PDF page numbers**
  (user-approved correction, 2026-09-19); printed labels remain optional internal matching evidence,
  not a competing user-facing numbering system;
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

## 7.1.1 Staleness is scoped to what an artifact actually used

A single global foundation-version counter may exist for ordering, but **artifact staleness depends
only on the page/region footprint that artifact actually consumed** (§23 states this principle
generally for dependency declaration; this is its specific application to the OCR/layout foundation).
A text correction confined to one page must not make an unrelated whole-book Teaching asset stale.
Reprocessing that changes geometry is treated more conservatively than a text-only correction (the
remap-vs-retain-vs-mark-stale choice above), and a Chapter Knowledge Map that is currently `READY`
and structure-locked (§15.2) is retained against its recorded foundation version rather than silently
invalidated by an unrelated correction elsewhere in the book.

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

## 8.1 Optional KP association for structure-protection bookkeeping

An annotation's authority remains geometry + quote/context (above) — this never changes. An
annotation **may additionally record**, as bookkeeping rather than authority, which KP (if any) it is
associated with, so Chapter-structure protection (§15.2) can correctly detect "this Chapter has a
durable KP-linked asset." This association is derived/optional metadata: if it is missing, stale, or
the linked annotation is later deleted, the annotation's geometry contract remains independent of
KP identity. While the association exists it blocks READY Chapter-map regeneration; it is never
required for the annotation to remain valid or visible.

---

# 9. Stable Outline: logical structure and physical resolution

> **Revised, 2026-09-03 (Outline conceptual correction).** The Outline is primarily the textbook's
> **logical directory** — its Chapter/Section hierarchy, titles and order. That logical tree is
> intended to exist early, established from PDF bookmarks and/or TOC pages, largely independent of
> how much body OCR has completed. This section previously conflated logical structure with physical
> range resolution and gated the whole directory on per-Chapter body evidence; §9.1 below makes the
> distinction explicit, §9.2–§9.3 restate the bootstrap and resolution rules against it, and §9.5
> restates correction granularity against it.

The Outline is based on **explicit textbook structure**, not an AI-invented replacement hierarchy.

Typical nodes:

2026-09-18 correction authorized by the user's OCR/Outline reliability mandate: semantic
Chapter/Section kinds do not mean absolute tree depths. A textbook may have `篇/部 → 章 → 节`;
the part is an organizational container, while the chapter remains the learning/preparation owner.
Page-number-only bookmark exports are not evidence of chapters. OCR processing completion is not
a claim of complete or error-free recognition. Directory publication requires usable structural
evidence, not merely a successful OCR job (and not all-book body OCR completion).

- Chapter / 一级标题;
- Section / 二级标题;
- Subsection / 三级标题;
- recognized special content nodes such as exercises/answers when needed for navigation.

## 9.1 Two classes of information

An Outline node conceptually carries two distinct classes of information, and the product must not
conflate them:

**A. Logical identity / directory structure** — stable node identity, title, level, parent/child
relation, sibling order, Chapter/Section kind. This is *what the book's table of contents says*, and
should be established as early as reasonably possible from:

1. embedded PDF bookmarks / outline metadata;
2. textbook TOC pages;
3. other high-confidence structural evidence.

**B. Physical resolution** — start `pdf_page_index` + geometry, end `pdf_page_index` + geometry,
and a resolution state (§9.3). This is *where that structure actually sits in the scanned pages*, and
it may improve progressively, independently of and after the logical node already exists.

**The product does not require whole-book body OCR to finish before the logical directory tree is
usable.** For an ordinary textbook with a usable TOC or bookmarks, the logical tree exists essentially
at intake; only physical resolution is progressive. A book that genuinely lacks sufficient TOC/bookmark
evidence for some part of its structure falls back to progressive logical discovery for *that part
only* — heading detection during body OCR then establishes logical nodes as it goes, exactly as
before. That fallback is the exception, not the intended default path.

Physical resolution improving does **not** create a new logical node, and does not change the identity
of an existing one. Example: `4.2 主存储器` already exists with a stable identity when its end position
is still unresolved; once body OCR later confirms the `4.3` heading, `4.2`'s end position resolves —
`4.2` remains the same node throughout.

## 9.2 Early logical establishment

Intended bootstrap for an ordinary textbook:

```text
PDF intake
→ inspect embedded PDF bookmarks if available
→ prioritize TOC / directory pages
→ OCR/parse TOC
→ establish the book's logical Chapter/Section hierarchy early
→ directory becomes usable
→ body OCR/layout continues progressively
→ physical ranges for Outline nodes are resolved/refined as evidence becomes available
```

**Directory navigation is immediate once the logical tree is established** — this does not wait for
body OCR. If a node's physical range is not yet fully resolved, navigation may use the best safe
target currently available; the system must never fabricate a precise range it doesn't have.
Directory *visibility* and physical-range *readiness* are separate questions — a Chapter can appear
in the directory, and be opened, before its own body OCR is complete.

Capabilities that genuinely require an exact physical range (Section-scoped Assistant, Chapter KP
Preparation, Section Learning Check placement) wait for that specific node's resolution to be
sufficient — never for the whole book's.

## 9.3 Progressive physical resolution

Each node's physical resolution may be conceptually:

```text
UNRESOLVED
PARTIAL
RESOLVED
```

Exact state names are not frozen. Example: `4.2`'s start may be `RESOLVED` while its end is still
`PARTIAL` until the next heading is confirmed; resolving further never mints a new `4.2` node.

## 9.4 Section lead-in

Text between a Section heading and its first Subsection:

- remains part of the Section content envelope;
- is visible to System/Assistant;
- does not need a separate Outline node or KP merely because it exists.

## 9.5 Outline correction granularity

Not every Outline correction carries the same risk. Three tiers:

1. **Logical/cosmetic** — title text, punctuation/spacing, a non-boundary metadata fix. Applies
   directly; never disturbs dependents.
2. **Physical boundary** — a node's start/end position moves without changing what the node *is*.
   If it affects a Section or Chapter that already has a durable dependent — a published Chapter
   Knowledge Map, KP Progress, or a KP-linked annotation — it must either trigger explicit
   revalidation/re-preparation of that dependent, or be blocked under the same durable-asset
   protection rule that already governs Chapter structure (§15.2).
3. **True structural identity** — a missing Section is discovered, the hierarchy was wrong, two
   Sections were incorrectly merged, or a Section was assigned to the wrong Chapter. This changes
   *what exists*, not just where it sits, and after any durable asset depends on the affected
   identity it requires the same stronger protection/migration semantics as Chapter-structure
   identity changes (§15.2) — never a silent re-ID.

Correction is never globally frozen by the mere existence of *any* Book asset — protection is scoped
to the specific node whose boundary or identity would actually change.

**2026-09-19 user-approved directory correction:** preserve explicit TOC introductions, summaries,
exercises and back matter as well as numbered chapters/sections. Front/back matter is displayed under
“其他内容”; per-chapter extras retain their textbook parent and never become learning owners. Page-only
navigation uses confirmed PDF destinations; printed OCR labels are hints and may be contradicted by
actual body-heading evidence. A grouping-only part may expand without a page destination.

The user explicitly approved a backed-up, additive correction of the populated Insurance book:
retain every existing Outline ID, owner and all learning records; add evidenced missing entries,
correct titles/targets in place, and mark affected published learning content as requiring review.
Old content remains readable. No automatic deletion, generation, mastery change or guessed re-ID.

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

Chapter KP Preparation requires that Chapter's own logical Outline identity and sufficient physical
range resolution (§9.1, §9.3), plus body OCR evidence for that Chapter. It does **not** require
full-book OCR, other Chapters' physical ranges, or the whole book's Outline to be finished. Chapter 4
may begin preparation once Chapter 4 itself has enough resolved range and OCR evidence, while Chapter
9's body OCR remains incomplete.

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

## 14.1 Atomic Chapter Map publication

A Chapter Knowledge Map publishes **atomically as one coherent version** — `READY` means the whole
Chapter's KP structure is internally consistent and complete for that version. The system never
publishes an internally incomplete Chapter Knowledge Map merely to claim partial readiness: a
Chapter's map is either `READY` as a full, coherent version, or it is `FAILED` / remains at its
previous `READY` version if one already existed. There is no partial-Chapter `READY` state.

---

# 15. Chapter Structure review and correction

Chapter KP structure is **stable after user assets depend on it**.

## 15.1 Before user learning assets exist

An explicit READY-map regeneration is allowed only while both conditions remain true:

- no KP in the Chapter has ever produced any persistent learning state; and
- no other durable user asset currently references any KP in the Chapter.

Regeneration always rebuilds the complete Chapter Map. A successful replacement publishes
atomically and every replacement KP receives a fresh opaque ID; a failed or in-progress replacement
leaves the existing READY Map visible and unchanged. Eligibility is checked once before work starts
and again inside the final replacement transaction.

## 15.2 After user learning assets exist

Once any KP in the Chapter has produced any persistent learning state — current status, learning
event/history, Section confirmation, Master state or another learning-state projection — the entire
Chapter Map is **permanently frozen**. Resetting, deleting or changing that state never unlocks the
Chapter. Master and every later capability must preserve this rule.

Other durable user assets that reference a Chapter KP, including a KP-linked Note/Highlight, also
block regeneration while that dependency exists.

Therefore the first product version provides no single-KP edit, merge, split, deletion, in-place
replacement, migration, remap, manual/artificial unlock, or compatibility path that rewrites old
learning state onto new IDs. The Chapter structure version remains required for atomic publication
and observability, not as an authorization to mutate a frozen Map.

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

## 17.2 Section Teaching failure isolation

One Section's Teaching generation/review failure never blocks or destabilizes independent Sections.
Section Teaching is generated, versioned, and can fail **independently** per Section — the same
isolation principle that already governs Chapter-level failure (§14) applies one level down, between
sibling Sections within an otherwise healthy Chapter.

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

Reading Guide is a continuous Section-level article organized around the Section's core problem.
It opens with why the knowledge is needed and connects ideas through explanatory prose, like a
well-reasoned companion book, without rewriting the textbook or enumerating KPs.
Problem → limitations → new knowledge is a writing approach, not a fixed template or invented history.
Titles, paragraphs and examples follow the actual Section. Pitfalls, conceptual emphasis and thinking
prompts may appear naturally inside the Guide article, but must not dominate it. Exam claims remain
subject to §20.3. There is no exit-criteria module or per-KP checklist requirement.

User-approved amendment (2026-09-10): the Guide and original PDF use separate reading columns with a
resizable divider, expand/restore/collapse controls and an always-visible PDF. Low-distraction numbered
sources navigate the PDF while preserving the Guide reading position. No AI content is inserted into
the PDF; Inline Guidance remains separate and deferred in the current Phase.

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

## 20.4 Closure

The article should leave the learner with a coherent understanding of the Section's central problem
and the relationships between its ideas. A natural closing paragraph may consolidate that understanding;
no separately labelled exit criteria, per-KP coverage checklist or fixed closing template is required.

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

## 23.1 Published-version safety during regeneration

If a published Teaching version (e.g. `v1`, `PASS`) exists and the user requests regeneration, the new
candidate (`v2`) is a `DRAFT` until it completes Review and publication. If `v2` fails at any point —
semantic rework exhaustion (§33.2.1) or otherwise — **`v1` remains the published, user-visible asset.**
A new candidate may replace the current published version only after completing its required Review
and publication transition; regeneration must never destroy a valid published version before its
replacement is accepted. Historical versions may later be cleaned up per a retention policy, but never
as part of an unsafe pre-publication overwrite.

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

Recursive explanation is a product capability, governed by the depth, Root/Child, and context rules
in §24.4–§24.7.

## 24.3 Temporary lifetime

Assistant conversation is not a durable learning record by default.

- switching Assistant ↔ Master tabs does **not** close it;
- switching Sections during the same open Reader experience may retain each Section's temporary context separately;
- explicitly closing that Assistant workspace clears that Section's temporary conversation;
- closing the Reader/application also clears unsaved Assistant conversations.

A user may explicitly:

> **Save to Notes**

Saved content then becomes a durable user asset anchored to its source context where possible.

## 24.4 Recursive explanation: depth model

These are **logical interaction-state semantics** — they do not require the legacy multi-window UI.
Root/Child are a logical relationship; the first-version UI may render them as one AI Dock with
breadcrumb/back navigation, cards, or another compact interaction model (§24.5).

1. Recursive explanation has **maximum nesting depth = 5**.
2. Depth is **nesting depth**, not message count. Ordinary multi-turn follow-up within the same level
   never increases depth.
3. A new Child level is created only when the user selects content **from the current Assistant
   answer** and requests a new explanation of that selection.
4. At depth 5, the user may continue normal multi-turn conversation at that level; creating depth 6
   is prohibited.
5. A parent has **at most one active Child branch at a time** (§24.7).
6. Concurrent attempts to create a Child from the same parent must preserve that invariant
   atomically — at most one succeeds; the other is rejected, not silently dropped or duplicated.
7. Assistant-answer content must never be reopened as a fresh Root merely to reset depth and bypass
   the limit (§24.5 item 3 states the corresponding Root-creation rule).
8. Technical retry preserves the same logical interaction identity, does not increase depth, and does
   not create a new Child.
9. Provider failure at any depth must not alter Progress or Mastery, create Learning History, or
   create a Master record, merely because Assistant failed.

## 24.5 Multiple Root contexts, focus, and close

A user may have a recursive Assistant chain open and then select a new passage from the textbook or
another non-Assistant visible source. **The user is never forced to close an existing Assistant
context to ask about something new.**

1. **Multiple temporary Assistant Root contexts may coexist** during the current Reader/app
   interaction lifetime. Example:

   ```text
   Root A: textbook selection about DMA → Child A2 → Child A3
   Root B: later textbook selection about interrupt response
   ```

   Both remain temporarily available.

2. Only **one** Root/Child chain has current UI focus at a time. **Existing temporary context** and
   **currently focused context** are distinct concepts.

3. Starting a request from a **non-Assistant** source (Original PDF, Reading Guide, Inline Guidance,
   Master answer, or other visible/selectable non-Assistant content) always creates a **new Root at
   depth 1** — never a Child of whatever chain currently has focus. Example: while focused on
   `Root A → Child A2 → Child A3`, selecting new textbook text creates **Root B** at depth 1, not
   `Child A4`. Root A's tree remains preserved unless explicitly closed.

4. Starting a request from **Assistant answer content** never creates a new Root — it creates a Child
   of the relevant Assistant level, under §24.4's normal depth rules.

5. Switching focus does **not** destroy the previous context. Opening a new Root, navigating back to
   a parent level, switching Assistant ↔ Master tabs, returning to the Reader, or selecting another
   existing Root from recent contexts all preserve what was left behind.

6. **Explicit Close is destructive**: closing a Root destroys that Root and its descendant Child
   tree. Close never means "permission to open another Root" — a new Root may always be created
   without closing anything.

7. The Reader/app close lifecycle remains the outer cleanup boundary (§24.3); unsaved Assistant
   contexts clear there. Switching focus alone is never equivalent to close.

8. The Product must provide a discoverable way to: see which context is currently focused; navigate
   to a Child's parent; identify current recursion depth, especially near the limit (e.g. `3 / 5`);
   switch among retained Root contexts; and explicitly close a retained Root. **No specific visual
   design is frozen** — breadcrumb, back-navigation, a recent-context list, context cards, a focused
   header, or another pattern are all acceptable.

9. The user never needs to see or understand internal terms like "Root," "Child," or "Window." The
   visible UI presents meaningful labels derived from the selected topic/text, e.g.:

   ```text
   DMA 工作方式
     > 周期窃取
       > 总线控制权
   ```

   not `Window 1` / `Window 2` / `Window 3`.

10. A Root and its Child chain retain enough temporary state that the user can switch away and later
    return to the same point in the chain. **Current UI focus is never the authority for whether
    temporary state persists** — losing focus must not lose state; only explicit close (item 6) or
    Reader/app close (item 7) does.

## 24.6 Child context construction

When the user selects text from an Assistant answer and creates a Child, the Child receives:

1. the selected text/range;
2. the **complete parent Assistant answer turn** containing that selection;
3. the parent's source lineage sufficient to understand where the discussion originated;
4. current relevant Reader scope where needed;
5. minimal necessary reference context;
6. the parent/child relationship;
7. new depth = parent.depth + 1.

It must **not** automatically receive: the entire Root conversation; every previous turn at the
parent level; the entire ancestor conversation tree; or the full Section text merely because the Root
originated there.

Context must be sufficient for semantic continuity without recursively accumulating all history. If
answering correctly genuinely requires more ancestor context, it may be included **selectively and
explicitly** by the Context Builder — never by a blind "dump all ancestor history" default.

## 24.7 One-active-child scope

"One active child per parent" constrains branching **from the same parent node only** — it does not
mean only one Assistant context may exist globally. These are all valid simultaneously:

```text
Root A → Child A2
Root B → Child B2
Root C
```

If the user selects a different phrase from a parent that already has an active Child, the
implementation must handle this explicitly (e.g. return-and-replace, mark the old branch historical,
or prompt the user to switch) rather than silently creating two simultaneous active Children from one
parent. The exact UX is an implementation decision; the invariant — never silently fork multiple
active children from one parent — is not.

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

## 26.1 Master Topic lifecycle

A **Master Topic** is the durable learning focus and turn cluster for one Master learning thread. It is distinct
from a Master *answer* (one reply), a *Mastery update* (a KP status change), and *long-term
attribution/summary* (where a resolved Topic gets recorded).

Each durable Master learning thread owns exactly one durable Topic identity. For a KP or Section in a
Book, reopen, revisit, restart and ordinary continuation all reuse that Topic; resolution never causes
a replacement or continuation Topic to be minted.

Topic state, conceptually:

```text
ACTIVE ⇄ RESOLVED
```

A Topic becomes `RESOLVED` only through **explicit user evidence** that the issue is now clear, or a
future formally-defined assessment mechanism. Closing the Master panel, the Reader, the application,
or switching tabs **does not** resolve a Topic — resolution is independent of any UI/session
lifecycle event.

Ordinary continued questions append to the same Topic without changing its state or Mastery. If a
future explicit user-evidence path establishes that the same learning focus is unresolved again, it
may reactivate that Topic while preserving its identity and history; any KP/Section Mastery change
still follows the separately authorized explicit-evidence rules. Work already being finalized uses
its frozen turn basis, while later turns remain on the same Topic outside that frozen basis rather
than silently changing the finalized result.

## 26.2 Evidence-gated mastery authority

Master may identify, from a real user question, one or more related KPs as `NOT_FULLY_CLEAR` when
evidence supports that association.

Master must **not** autonomously set a KP to `UNDERSTOOD` merely because it provided an explanation,
the conversation appears to have gone well, the model believes the user now understands, or the Topic
was summarized. `UNDERSTOOD` requires either **explicit user confirmation** or a future
formally-authorized assessment rule — answering a question is never, by itself, sufficient evidence.

Once a KP reaches `UNDERSTOOD` through Master's evidence-gated path, it is **never automatically
downgraded** because a later question is appended or the same Topic is revisited. Explicit unresolved
evidence may reactivate the stable Topic, but any future explicit Mastery downgrade mechanism remains
a separate, deliberately designed product rule — Master does not invent one on its own.

When a Topic is later resolved, current unclear/mastery state may change according to these rules, but
historical questions and prior unclear evidence remain in Learning History regardless (§29).

A structured Topic summary/condensation may additionally be created for retrieval, weakness analysis,
or later context-building. **Condensation is never permission to delete the user's meaningful
historical learning thread** — summarizing augments Learning History, it does not replace it.

## 26.3 Answer policy is separate from attribution

Whether Master **should answer** a question is a different question from **where** it gets attributed
in long-term learning structure, and the first must never be gated on the second.

Master answers course-relevant questions normally regardless of perceived question quality — simple
terms, "what does this mean," recall, comparison, synthesis, and reasonably-clarifiable vague
questions are all answered, not filtered.

A question may end up attributed to the current KP, another KP, multiple KPs, the Section generally,
course-related-but-currently-unmapped, or outside the course entirely — and that attribution outcome
never determines whether Master was allowed to answer it in the first place. Only genuinely
non-learning content (a safety/capability limit, not course relevance) may justify a refusal to
answer.

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
- state uncertainty when the available source is uncertain rather than inventing missing evidence;
- never present material drawn from outside the primary textbook — background knowledge, supplementary references, or a future Reference Corpus — as if the textbook itself said it; such material must remain distinguishable as external explanation.

`Review = OFF/Fast` therefore means:

> **no normal independent reviewer call**, not “no factual discipline”.

## 30.2 System Teaching assets: mandatory independent Review

Persistent System assets such as:

- Reading Guide;
- Inline Guidance / ✦;
- other publishable reusable teaching content;

must pass independent Review before being treated as accepted Teaching Assets.

The user may switch AI Teaching off, but may not publish a formal System Teaching Layer by bypassing its required Review.

**Reading Guide transient-draft amendment — user-approved 2026-09-16.** While a user-requested
Reading Guide is being generated, its real provider stream may be shown immediately as an explicitly
labelled `生成草稿 · 尚未审查/审查中` preview. This preview exists only in current process memory: it
is not persisted, does not update the published pointer, cannot be selected into Assistant, and has
no PDF/source authority. Independent Review remains mandatory. Only Review `PASS` atomically
publishes the formal Guide; any terminal generation or Review failure removes the preview and leaves
the original PDF and any previously published Guide intact with an in-place retry.

## 30.3 Master: user-selectable Review strength

Master prioritizes trustworthy learning decisions but should not force maximum latency on every interaction.

Master answer execution and independent Review are separate controls. The Composer exposes the named
answer model and `Quick` / `Deep` answer reasoning; Review strength is a lower-frequency action and
defaults to `Fast`. Quick/Deep asks the selected answer provider for its real reasoning capability and
never fabricates reasoning when the provider does not return it. Answer text streams as it is produced;
provider-returned reasoning may stream in a separate, clearly labelled transient surface, but only the
final answer is durable and eligible for Review. Provider reasoning is not independent verification and
never substitutes for Review.

The first version supports conceptually:

### Fast — default

- normally no independent reviewer call;
- fastest response;
- grounding/trust rules still apply;
- risk triggers may escalate verification.

### Standard

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

A Recall prompt should carry enough evidence reference to verify it only draws on content already
shown to the learner at that point, and should appear where it carries real teaching value rather than
mechanically at every content boundary. It never blocks reading and never scores the learner by
default.

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

### 33.2.1 Semantic rework limit and terminal failure

For a candidate generation attempt/version of a formal System Teaching asset, semantic/content rework
is bounded: **maximum 3 completed semantic rework cycles**. If blocking semantic defects remain after
the third cycle, that candidate/version reaches a terminal `FAILED` state.

`FAILED` Teaching:

- is never published;
- cannot silently become `PASS`;
- cannot fall back to unreviewed AI text as a "degraded" delivery;
- cannot replace the currently published `PASS` version (§23.1);
- does not block Original PDF reading, unrelated Sections, Notes, Highlights, or Learning History.

### 33.2.2 Technical failure is not semantic rework

Technical failures — timeout, network failure, rate limiting, authentication/provider unavailability,
5xx errors, reviewer invocation failure — are **never** counted as semantic rework. Technical retries
do not consume the rework count in §33.2.1, and exhausting technical retries does not itself become a
content rejection.

### 33.2.3 Review judges; it does not author

Review must not rewrite a candidate and then pass its own rewrite. System produces and fixes Teaching;
Review judges it. This separation is what keeps the rework count in §33.2.1 meaningful.

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

# 35. User Style boundary

User-configurable presentation/expression preferences (language, tone, brevity, example style) may
affect **how** Master and Assistant phrase their responses. They must never change:

- Assistant recursion depth or one-active-child rules (§24.4, §24.7);
- context-inheritance rules (§24.6);
- source identity/trust rules (§30);
- persistence boundaries (§24.3, §26);
- Mastery authority (§26.2, §28);
- System Teaching logic (§17, §20);
- Review acceptance rules (§33.2);
- Agent authority boundaries (§33).

System and Review never accept user-style input at all — style is exclusively a Master/Assistant
expression-layer concept.

---

# 36. User navigation and returning to old content

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

# 37. High-confidence first-version product flow

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

# 38. Decisions now treated as agreed

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
49. Assistant recursion has maximum nesting depth 5, counted by nesting level not message count; ordinary same-level multi-turn never increases depth.
50. Only selecting content from the current Assistant answer creates a Child; Assistant answers can never be reopened as a fresh Root to bypass the depth limit.
51. A parent has at most one active Child branch at a time, enforced atomically under concurrent requests.
52. Multiple temporary Assistant Root contexts may coexist; only one has current UI focus; switching focus never destroys other contexts; explicit Close is the only destructive action, and it never grants permission to open another Root.
53. A new request from a non-Assistant source (Original, Guide, Guidance, Master answer, other visible content) always creates a new Root at depth 1, never a Child of the currently focused chain.
54. A Child receives the selected range, the complete triggering parent answer turn, source lineage, relevant scope, and minimal reference context — never the full ancestor conversation tree by default.
55. Technical retry preserves the same logical interaction identity and never increases depth or creates a Child; provider failure never alters Progress, Mastery, Learning History, or creates a Master record.
56. Each durable Master learning thread has one stable Topic identity across resolution, continuation, reopen, revisit and restart. A Topic is RESOLVED only by explicit user evidence or a future formal assessment rule; ordinary continuation never changes Topic/Mastery state, explicit unresolved evidence may reactivate that same Topic, and closing any panel/app/tab is never itself resolution.
57. Master may attribute NOT_FULLY_CLEAR to evidenced KPs but may never autonomously mark UNDERSTOOD merely because it answered; UNDERSTOOD requires explicit user confirmation or a future formal assessment rule, and is never auto-downgraded later.
58. Whether Master answers a question is independent of where that question is attributed in long-term learning structure; course-relevant questions are answered regardless of attribution outcome.
59. Formal System Teaching semantic rework is bounded at 3 cycles per candidate; exhaustion is terminal FAILED, never a silent PASS or unreviewed fallback; technical failure never consumes rework count.
60. A published Teaching version is never destroyed by a failed or in-progress regeneration candidate; replacement occurs only after the candidate completes Review and publication.
61. Section Teaching failure isolation extends the existing Chapter-failure isolation one level down: one Section's Teaching failure never affects sibling Sections.
62. A Chapter Knowledge Map publishes atomically as one coherent version; there is no partial-Chapter READY state.
63. The Outline's logical directory structure (identity, title, order, hierarchy) is distinct from its physical range resolution; the logical tree is established early, normally from bookmarks/TOC, independent of body OCR completion, and physical resolution improves progressively per node without ever creating a new logical node.
64. OCR/layout artifact staleness depends only on the page/region footprint an artifact actually used, never on a single global version counter changing elsewhere in the book.
65. An annotation may optionally record a KP association as structure-protection bookkeeping; this association is never required for the annotation to remain valid, and geometry + quote/context remain its sole durable authority.
66. User Style affects only Master/Assistant expression; it can never change recursion/authority/persistence/trust/Review structural rules, and System/Review never accept style input at all.
67. Outline correction has three risk tiers — logical/cosmetic, physical boundary, and true structural identity — with protection scoped to the specific node whose boundary or identity would change, never globally triggered by the existence of any Book asset.
68. An artifact that used a specific Outline node's physical range depends on that node's own identity and resolution state, never on a book-wide Outline version; another Chapter's range resolving, or unrelated node metadata correcting, never makes such an artifact stale.
69. A READY Chapter Map may be regenerated only when no Chapter KP has ever produced persistent learning state and no other durable user asset references an old KP. Regeneration is whole-Chapter, mints all-fresh KP IDs, keeps the old READY Map on failure/in progress, and rechecks eligibility inside atomic replacement. The first learning-state write permanently freezes the Chapter even if that state is later reset, deleted or changed; there is no migration, remap, manual unlock or single-KP edit, and Master may not weaken this rule.

---

# 39. Deferred, not forgotten

These are intentionally deferred rather than unresolved blockers for the product skeleton:

- independent ExamTopic table/progress;
- full past-exam RAG and statistical exam-frequency layer;
- attributed teacher-video knowledge layer;
- individual exercise → KP mapping;
- adaptive practice / scoring / wrong-question system;
- formula-specific persistent object model;
- exact AI intrusion-level enum;
- exact UI wording and routing thresholds for Master/Assistant Review modes;
- exact OCR/remap algorithms;
- exact persistence schema;
- concrete Reader/OCR/frontend/provider technology choices;
- final commercial product brand.

---

# 40. What this document intentionally does not decide

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

# 41. Next document sequence

This Product Blueprint has passed closure at the product-authority level.

Next:

1. ask Claude to perform a **legacy reuse audit** against the actual legacy repository and produce `LEGACY_REUSE_AUDIT.md`;
2. use that audit to write/freeze `LEGACY_TRANSITION_PLAN.md`, including exact Git checkpoint, keep/discard matrix, new folder structure and transition steps;
3. execute the legacy transition with Codex only after those decisions are explicit;
4. build `IMPLEMENTATION_BLUEPRINT.md` for the new repository using this approved Product Blueprint + reuse audit results;
5. only then start implementation phases.

The audit artifact is evidence. `PRODUCT_BLUEPRINT.md` and `IMPLEMENTATION_BLUEPRINT.md` are the lasting new-project authorities; `LEGACY_TRANSITION_PLAN.md` is the temporary transition authority for legacy cleanup/migration.

---

# 42. One-sentence architecture

> **408 Guided Reader keeps the original textbook as the permanent reading surface, progressively builds a machine-readable layer around it, creates stable learning structure only when needed, and adds optional AI teaching exactly where the learner needs a teacher—without replacing the book.**
