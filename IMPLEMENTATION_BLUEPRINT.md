# IMPLEMENTATION_BLUEPRINT

## 0. Status / Authority

> **Status: FROZEN — ENGINEERING AUTHORITY, GATE D CLOSED.**

| | |
|---|---|
| Document | Engineering architecture for **408 Guided Reader** |
| Date | 2026-09-03 |
| Gate D review | Independent ZCode review: **`PASS_WITH_P2`**, **P0 = 0**, **P1 = 0**. `READY_FOR_GATE_D_CLOSURE = YES`. P1-5 = `CLOSED_BY_CONSTRUCTION` (§19.2b, §32.1). Gate D closed 2026-09-03. Non-blocking P2 debt recorded in §27. |
| Product authority | `PRODUCT_BLUEPRINT.md` (approved). This document **translates** it; where the two disagree, the Product Blueprint wins. |
| Method | **Clean-room first, then evidence reconciliation.** §§1–28 were written from `AGENTS.md` + `PRODUCT_BLUEPRINT.md`, objective engineering requirements and current external research **before** any archive or legacy material was opened. Empirical and reuse evidence was introduced only afterward. |
| Reconciliation | Completed 2026-09-03 (Transition Plan step 5). Evidence-driven changes are marked **`[E]`** inline; §29 records every disposition; §30 is the candidate port matrix. |
| Semantic closure | Completed 2026-09-03, following `LEGACY_PRODUCT_SEMANTICS_DELTA_AUDIT.md` and independent ZCode review. Assistant recursion (§14.3–§14.11), Master Topic/mastery authority (§15.5–§15.7), Review rework/terminal-failure (§13.7a–§13.7b), Section/Chapter isolation (§17.5–§17.6), and foundation-version staleness scoping (§19.2a) realize the corresponding `PRODUCT_BLUEPRINT.md` freezes. §32 records disposition of every P0/P1 audit finding — none remains unresolved. |
| Outline conceptual correction | Same-day follow-up, 2026-09-03. A second ZCode pass found a new blocking issue (P1-5) in the closure patch's Outline fix; a product-intent clarification then established that logical directory structure and physical range resolution had been conflated. §9 (Product) and §11, §12.2/§12.6, §18.2, §19.1–§19.2b (Implementation) are rewritten accordingly; `OutlineRegion` is removed. See §32.1. |
| Chapter Knowledge Map first UAT correction | User-approved amendment, 2026-09-07, after real-use `empty_response`/latency failure and external KP research review. It introduced Section-scoped private generation/retry, removed deterministic no-overlap, added structural duplicate/overlap Review, safe per-attempt diagnostics and minimum Section progress. Its LLM-first complete-KP generation and whole-Section semantic repair are superseded by the architecture correction below; its retained shell, overlap rule and observability remain authority. |
| Chapter Knowledge Map architecture correction | User-approved amendment, 2026-09-07, after repeated invalid/length-limited generation and oversized/rejected Review. §12.2 now requires deterministic evidence units, bounded AI `KEEP`/`MERGE`/`DROP` plus short labels, deterministic KP materialization, compact Chapter Review and unit-addressed repair; §12.4 freezes the model/source-authority boundary; §22 makes diagnostics packet/stage-scoped. Existing Outline/OCR authority, jobs, persistence, Reader UI/navigation and atomic publication remain unchanged. Its former replacement prerequisite is superseded by the 2026-09-09 amendment below. |
| READY Chapter regeneration / permanent learning lock | User-approved Frozen amendment, 2026-09-09. §12.1 and §12.4a allow explicit whole-Chapter replacement only before any persistent learning state has ever existed and while no other durable user asset references an old KP. Replacement keeps the published READY Map available, mints all-fresh KP IDs, and rechecks eligibility inside atomic publication. §12.5 makes the first learning-state write an irreversible Chapter lock; deletion/reset cannot unlock it, and no migration, remap, manual unlock or single-KP edit exists. |
| Chapter Knowledge Map Review convergence correction | User-approved amendment, 2026-09-07, after real Chapter 1/7 Review failures exposed genuine local reducer defects plus non-exhaustive discovery across untouched packets. §12.2 keeps all seven Review dimensions while reserving `BLOCKING` for high-confidence unpublishable defects, moves short-heading/reference-only closure upstream and permits only cumulative-bounded repair of newly implicated untouched packets. Repeated local blockers and budget exhaustion still fail closed; Chapter Review and atomic publication are unchanged. |
| Chapter Knowledge Map taxonomy-granularity correction | User-approved amendment, 2026-09-08, after Chapter 7.1.3 incorrectly published four overview enumeration items as four durable KPs. §12.2 now makes consecutive brief taxonomy/composition/step/peer runs one upstream Section-level `MERGE`; separate KPs require sufficient current source evidence for independently assessable mechanisms, methods or relationships. Packet-local validation/retry enforces the rule before materialization; final Chapter Review is not its primary repair layer. |
| Chapter Knowledge Map semantic-reducer simplification | User-approved amendment, 2026-09-08, after controlled Chapter 2 calibration showed multi-pass absorption/audit could oscillate between over-split and over-merge. §12.2 now requires exactly one group-first final partition per real Outline-subsection semantic window, with bounded same-input technical retry only. It supersedes packet `KEEP`/`MERGE`/`DROP`, forced enumeration/character/count heuristics, semantic cleanup/re-partition and Review-driven repair/re-review. Chapter Review remains a strict final gate whose valid FAIL ends the attempt. Existing Outline/OCR/source authority, private drafts, deterministic materialization/validation, persistence and atomic publication are unchanged. |
| Master answer/reasoning streaming | User-approved amendment, 2026-09-15. §13.7 separates the answer model and `Quick`/`Deep` provider reasoning from independent Review, makes Review `Fast` by default, streams answer/reasoning on separate SSE events, and keeps reasoning transient. Migration 19 persists only each durable message's reasoning-mode choice. Master Topic, Mastery, grounding and Review verdict authority are unchanged. |
| Reading Guide transient streaming | User-approved amendment, 2026-09-16. §17.1 permits an explicitly labelled, process-memory-only Writer stream before Review. It never enters `TeachingAsset.content`, never updates `section_guides`, cannot enter Assistant or source authority, and disappears on failure. Review `PASS` remains the only atomic publication path. Deterministic non-body evidence removal, local source binding and candidate-cited Review projection reduce latency without RAG or weaker Review. |
| Authorizes | **Gate D: CLOSED (PASS).** This document is now engineering authority for 408 Guided Reader — where it and `PRODUCT_BLUEPRINT.md` disagree, the Product Blueprint still wins. **Gate E (code porting / implementation) is a separate, still-unopened authorization** — this closure does not itself authorize writing, porting, or installing anything. |

### 0.1 Why the clean-room, and what happens next

The architecture question answered here is deliberately narrow:

> **If no legacy implementation existed, how should 408 Guided Reader be engineered?**

Answering it in isolation is the point. Available code exerts gravity: consulted early, it silently
supplies structure, and the abandoned product model returns wearing new names. So the sequence is:

```
1. clean-room IMPLEMENTATION_BLUEPRINT draft            ✅ done
2. consult OCR_FOUNDATION_CALIBRATION.md                ✅ done
3. consult LEGACY_REUSE_AUDIT.md / transition evidence  ✅ done (targeted)
4. reconcile candidates against the derived architecture ✅ done — §29, §30
5. patch only where objective evidence justifies it     ✅ done — marked [E]
6. review and freeze                                    ✅ done — Gate D CLOSED (PASS_WITH_P2), 2026-09-03
7. only then authorize code porting                     ← next; Gate E, still closed
```

`OCR_FOUNDATION_CALIBRATION.md` is **not** legacy architecture authority — it is empirical
measurement against real 王道 textbook samples and current OCR/layout tooling. It is withheld here to
protect architectural independence and introduced deliberately at step 2. Section 8 below is
therefore written to be **falsifiable by that evidence**: it states what must be measured and what
would change the design.

### 0.2 Decision status vocabulary

| Tag | Meaning |
|---|---|
| `FROZEN_FROM_PRODUCT` | Determined by `PRODUCT_BLUEPRINT.md`. Not an engineering choice. |
| `RECOMMENDED_FOR_DRAFT` | Engineering recommendation with sufficient evidence. Adopt unless review objects. |
| `USER_DECISION_REQUIRED` | Two credible options that materially change product behaviour, architecture, maintenance, cost or platform direction. |
| `DEFERRED_WITH_BOUNDARY` | Not decided now; the seam that future work will use **is** decided now. |

---

## 1. Engineering Goals and Non-Goals

**Goals.**

1. The original PDF renders and stays readable with every other subsystem dead.
2. Every machine-derived layer is optional, incremental, correctable and versioned.
3. Durable user assets (notes, highlights, progress, learning history, reading position) outlive
   every AI artifact and every machine-layer regeneration.
4. Long-running preparation survives process restart and never blocks reading.
5. AI is confined behind an explicit boundary: isolated contexts, structured outputs, declared
   dependencies, and review before anything persistent is published.
6. A single developer can run, debug and reason about the whole system on one machine.

**Non-goals for V1.**

Multi-user accounts, sync or sharing · distributed task infrastructure · horizontal scale ·
server-side rendering of book content · reconstructing or reflowing the textbook in any form ·
a document-conversion pipeline (Markdown/HTML export of the book) · realtime collaboration ·
mobile.

**The load-bearing negative requirement.** Nothing may reintroduce a *fine-grained persistent
textbook-fragment entity that becomes the reading surface*. Product Blueprint §2 and §6.3 forbid it
by name. §4.4 and §8.4 below make it structurally difficult rather than merely prohibited.

---

## 2. System Context

```
┌─────────────────────────────── one machine, one user ────────────────────────────────┐
│                                                                                       │
│   ┌──────────────────────┐        local IPC / localhost HTTP        ┌──────────────┐  │
│   │  Reader UI (webview) │ ◄──────────────────────────────────────► │   Core       │  │
│   │  • PDF canvas render │        + server-sent events for          │   Service    │  │
│   │  • geometry overlays │          preparation progress            │              │  │
│   │  • selection/highlight│                                          │  jobs, OCR,  │  │
│   │  • AI Dock           │                                          │  agents, DB  │  │
│   └──────────────────────┘                                          └───────┬──────┘  │
│                                                                             │         │
│                              ┌──────────────────────────────────────────────┤         │
│                              ▼                      ▼                       ▼         │
│                        SQLite (state)      blob store (PDFs)        model runtime      │
│                                            crop cache (evictable)   (OCR / layout)     │
└───────────────────────────────────────────────────────────────────────┬───────────────┘
                                                                        │ network, optional
                                                                        ▼
                                                            LLM provider(s) — AI only
```

**External dependencies of the system as a whole:** the user's PDF files, and (optionally) one or
more LLM providers. Nothing else. Reading, selection, notes and highlights must work with the
network cable pulled.

---

## 3. Runtime / Process Architecture

### 3.1 Application shape — `RECOMMENDED_FOR_DRAFT`

**A local-first, single-user desktop application: a web-technology UI plus a local Core Service
process.**

Reasoning from requirements rather than convention:

| Requirement | Consequence |
|---|---|
| PDF is the reading surface, with pixel-accurate overlays for selection and highlight (§2, §6, §8) | The UI layer needs a mature PDF raster + a DOM/canvas coordinate space. Web technology is the strongest option here; the overlay problem is well-solved in that ecosystem. |
| OCR and layout inference on hundreds of pages (§4.2) | Needs a real ML runtime, native threads, and hours of background work. Not a browser workload. |
| Preparation must survive restart (§4.2) | Needs durable state and a supervised worker — i.e. a persistent process, not page-lifetime JS. |
| Books are the user's local files; notes are private (§3.3) | Local storage, no upload of book content except deliberate AI context. |
| AI is optional and may fail (§18, §19) | The network boundary must sit behind the service, never in the render path. |

Two processes, not one: the render loop and a multi-hour OCR job must not contend, and the service
must outlive UI reloads.

### 3.2 Process model

| Process | Owns |
|---|---|
| **Reader UI** | PDF rasterization, viewport/virtualization, overlay geometry, selection interaction, all ephemeral view state, the AI Dock. |
| **Core Service** | SQLite, blob store, job scheduler + workers, OCR/layout execution, outline/KP/teaching pipelines, agent runtime and provider calls, **all durable state**. |

**Rule:** the UI holds no durable truth. Anything that must survive a reload is written through the
service. This keeps the "durable vs replaceable vs temporary" asset distinction (§3.1–3.3 of the
Product Blueprint) enforced by process boundary rather than by discipline.

### 3.3 Transport — `RECOMMENDED_FOR_DRAFT`

Localhost HTTP (JSON) for request/response, plus **Server-Sent Events** for one-way progress
streaming (page prepared, chapter ready, guide published, job progress). SSE over WebSockets: the
traffic is overwhelmingly server→client notification, SSE reconnects natively, and it is trivially
debuggable with `curl`. Bind to loopback only, with a per-launch token (§21).

### 3.4 Backend runtime — `RECOMMENDED_FOR_DRAFT`

**Python for the Core Service.** The decisive factor is that the OCR and document-layout ecosystem
is overwhelmingly Python-first (§8, §5 research). Choosing another runtime means either
reimplementing inference bindings or shelling out to Python anyway — the dependency arrives
regardless, so it should arrive as a first-class citizen.

Cost accepted honestly: Python packaging for desktop distribution is the weakest part of this
recommendation, and §3.5 is where that cost lands.

### 3.5 Target platform and packaging — `RESOLVED` **[E]** *(was `USER_DECISION_REQUIRED` D-1)*

**V1 target, decided 2026-09-03:**

| | |
|---|---|
| OS | **Windows 10/11** |
| UI host | **Chrome / Edge (Chromium-class browser)** — the supported host, not merely a fallback |
| Backend | **Local Python Core Service on localhost** |
| Shell | **None.** No Electron, no Tauri for V1. |
| Packaging | **Deferred behind a boundary** (see below) |

This is the localhost-app option the clean-room analysis recommended. Choosing a Chromium-class
browser as the *supported* host also removes the §3.5 rendering-consistency risk entirely: there is
one rendering engine to validate, not three.

**The packaging boundary that keeps a shell possible later.** A desktop shell must remain a
*packaging* change, never an architectural one. Three rules enforce that:

1. **The UI makes no host assumptions.** No shell APIs, no `file://` access, no native menus, no
   privileged bridge. Everything reaches the service over localhost HTTP + SSE (§3.3).
2. **The service never assumes it was launched by a shell.** It starts standalone, binds loopback,
   and its lifecycle is independent of any window.
3. **Every OS-facing capability sits behind a small port** — credential storage (§21.2), file
   selection for import, and the data directory. A shell later supplies different adapters for those
   ports and nothing else moves.

Under those rules, adopting Electron or Tauri later is: bundle the UI, spawn the service as a
sidecar, swap three adapters. That option is preserved deliberately in case commercialization or UX
warrants it, and it is not paid for now.

*Original analysis retained below, because it records why the option was chosen and what the
alternatives cost.*

| | **Option A — localhost app (recommend for V1)** | **Option B — native desktop shell** |
|---|---|---|
| Shape | Core Service runs locally; UI opens in the user's browser at `127.0.0.1` | Tauri/Electron window embedding the same UI, Python as a bundled sidecar |
| Distribution | Run a command / a small launcher | Signed installer per OS |
| PDF rendering consistency | The user's own browser — one modern engine | **Tauri uses the OS WebView** (WebView2 / WKWebView / WebKitGTK) → three rendering engines to validate for a PDF-heavy app. Electron bundles Chromium → consistent, ~120–200 MB. |
| Credentials | OS keyring via the service | Same, plus shell-native APIs |
| Effort | Lowest | Meaningful, ongoing |

Research (Sept 2026) puts Tauri v2 bundles at roughly 3–10 MB against Electron's 120–200 MB, with
faster start and lower idle memory, and the general advice is to default to Tauri unless Chromium
consistency is specifically needed. **For this product it may well be specifically needed** — a PDF
reader with pixel-aligned selection overlays is exactly the case where three WebView engines cost
more than the bundle saves.

Nothing in the design is Windows-specific. All filesystem access goes through one containment layer
(§21.1) that must stay path-portable, so a later macOS/Linux target is a porting exercise, not a
redesign. The one Windows-specific detail worth carrying is long-path/`\\?\` handling in that
containment layer (§30, storage row).

### 3.6 Offline behaviour — `FROZEN_FROM_PRODUCT` (§18, §19) **[E]**

The governing statement: **loss of internet is not loss of the book.**

| Capability | Offline | Condition |
|---|---|---|
| Open and read the original PDF, navigate, zoom | ✅ | always |
| Local PDF rendering and on-demand crops | ✅ | always |
| Selection, copy, highlight on prepared pages | ✅ | pages already prepared |
| OCR / layout / outline / printed-page preparation | ✅ | **models already installed locally** |
| Outline navigation and existing prepared structures | ✅ | already prepared |
| Notes / Highlights | ✅ | always |
| Reading Position and learning records | ✅ | always |
| Previously generated durable local assets (published Guides, Master history) | ✅ | already generated |
| Chapter KP preparation, Section teaching generation/review, Assistant, Master turns | ❌ | requires a reachable provider |

Two consequences the implementation must honour. **Local inference is offline-capable but not
offline-free:** it requires its model artifacts to be present, so first-run model acquisition needs
network and must be an explicit, resumable, user-visible step — never an implicit download during a
user's first page turn. And **already-generated durable assets stay fully readable offline**; only
*new* generation and *new* review are unavailable. AI unavailability is an ordinary expected state
rendered as such, never an error banner over the book (§20).

---

### 3.7 Friends Private Beta deployment exception — user decision, 2026-09-16

The user accepted the deployment audit and selected one Linux server, Caddy HTTPS and individual
authentication, with a separate Core Service and SQLite/PDF data directory per Beta participant
(2–5 people). This is a scoped hosted deployment of isolated single-user installations, not shared
multi-tenancy or a user_id/domain-model migration. Core binds only to loopback behind Caddy.
The Windows/local installation in §3.5 remains supported; §3.6's disconnected-client guarantee does
not extend to hosted Beta access, which requires reaching the server. AI-provider failure must still
leave reachable PDF and saved assets usable. For this hosted mode, §21.2 credentials come from
protected Linux service configuration through the environment boundary, not Windows Credential
Manager; §21.4 backup must include server-held original PDFs as well as SQLite. No learning/source
authority or Review publication invariant changes. Implementation scope and acceptance are proposed
in `docs/phases/FRIENDS_PRIVATE_BETA.md`; this user-selected architecture does not approve that new
brief's details or authorize deployment.

## 4. Bounded Contexts and Module Boundaries

### 4.1 Contexts

| # | Context | Owns | Depends on |
|---|---|---|---|
| 1 | **Library** | Book, BookSourceRevision, blob storage, intake, deletion | — |
| 2 | **Foundation** | OCR pages/lines, fine-grained cells, visual regions, printed-page map, corrections, `foundation_version` | Library |
| 3 | **Outline** | OutlineNode tree (logical identity + per-node physical resolution), per-node `identity_revision`/`physical_revision` | Foundation |
| 4 | **Knowledge** | Chapter preparation, KnowledgePoint, `chapter_structure_version` | Outline, Foundation |
| 5 | **Teaching** | Reading Guide, Inline Guidance, Recall prompts, anchors, publication state | Outline (+ Knowledge, only for KP-dependent artifacts) |
| 6 | **Learning** | Reading position, KP status, section learning state, learning history, Master threads | Outline; Knowledge for KP-scoped state |
| 7 | **Annotation** | Notes, highlights, anchors, AI-saved explanations | Library, Foundation |
| 8 | **ExamEvidence** | 命题追踪 / syllabus evidence and KP links | Foundation, Knowledge |
| 9 | **AgentRuntime** | Context assembly, provider routing, structured output, review orchestration | consumed by 4, 5, 6 |
| 10 | **Jobs** | Durable queue, workers, scheduling, recovery | consumed by 2, 3, 4, 5 |

### 4.2 Dependency rule

Dependencies point **downward only** (higher number may depend on lower). Concretely: Foundation
never imports Knowledge; Outline never imports Teaching; Annotation never imports Teaching.

This is the structural expression of the Product Blueprint's asset layering — the machine layer
cannot be made to depend on the teaching layer, so teaching can always be deleted, regenerated or
absent without touching the book.

### 4.3 Cross-context references

Contexts reference each other by **ID only**. Foreign keys are enforced *within* a context and for
exactly three cross-context anchors: `book_source_revision_id`, `outline_node_id`,
`knowledge_point_id`. Everything else is a soft reference resolved through the owning context's API.

Rationale: hard FKs across the whole graph is precisely the failure mode where deleting a book,
regenerating a chapter, or dropping the teaching layer becomes a cascade problem.

### 4.4 The anti-fragment rule — `FROZEN_FROM_PRODUCT` (§2, §6.3)

**No context may expose a persistent, individually-addressable sub-line textbook fragment as a
domain entity.** Sub-line geometry exists (§8.3) but is deliberately *not addressable*: it is stored
inside its line and has no stable ID, so nothing can take a foreign key to it, and no API can return
one as a first-class object. A selection is a *range expression*, resolved on demand.

This is enforced by storage shape (§8.4), not by review vigilance.

---

## 5. Persistence and File Storage

### 5.1 Engine — `RECOMMENDED_FOR_DRAFT`

**SQLite, WAL mode, foreign keys on, one database per installation.**

Single-user, single-host, no concurrent writers beyond one worker pool, embedded, zero
administration, transactional, and trivially inspectable during development. A client/server
database would add an operational dependency to a personal application for no benefit at this scale.

Per-book databases were considered — they make deletion and portability trivial — but complicate
cross-book queries and multiply migration surface. **Single DB, with `book_source_revision_id` as a
consistent partition key**, keeps deletion cheap enough via cascade within a context.

Scale sanity check: a 700-page book yields ~700 page rows, ~35k line rows and a handful of thousand
region/outline/KP rows. Trivial for SQLite. The one row-count risk is sub-line cells, which §8.4
removes from the row count entirely by design.

### 5.2 What lives where

| Store | Contents | Properties |
|---|---|---|
| **SQLite** | All entities, geometry, state machines, jobs, learning state, annotations | Durable, transactional, backed up |
| **Blob store** | Original PDFs, content-addressed by SHA-256 | Immutable, never rewritten, one copy per distinct byte-stream |
| **Crop cache** | Rendered page/region images at requested DPI | **Derived and evictable.** Deleting it must be harmless. |
| **Model cache** | Downloaded inference weights | Derived, re-downloadable, outside the repo and outside backups |

**Invariant:** if the crop cache and model cache are both deleted, the product must still open,
render and read every book. Anything that breaks this has misclassified derived data as durable.

### 5.3 Schema modularity — `RECOMMENDED_FOR_DRAFT`

One schema module per bounded context, each owning its own tables. No single global model file.
Migrations are per-context and additive-first; a destructive migration touching durable user assets
requires the migration discipline in §19.5.

### 5.4 Transaction boundaries

- One job step = one transaction. Page preparation commits per page, so a crash loses at most one
  page of work.
- Publication events (chapter structure, teaching asset, foundation version) are single atomic
  transactions: a partially published artifact must be unobservable.
- Provider calls and file I/O **never** run inside an open transaction.

### 5.5 ORM — `RECOMMENDED_FOR_DRAFT`

Use a mature data-mapper with explicit migrations, but keep domain logic out of persistence classes:
repositories return plain domain objects. The specific library is implementation trivia and does not
require freezing — the constraints that matter are explicit migrations, per-context modules, and no
domain behaviour on row objects.

---

## 6. Book / Source Foundation

### 6.1 Entities

```
Book                 stable user-facing identity ("my 计算机组成原理")
  └─ BookSourceRevision   one immutable PDF byte-stream
       ├─ blob_sha256, byte_size, page_count, per-page media box
       ├─ created_at, label
       └─ status: ACTIVE | SUPERSEDED | DELETING | DELETED
```

`Book` is the thing the user names and returns to. `BookSourceRevision` is what every machine layer,
annotation and learning asset actually points at.

### 6.2 Immutability and identity — `FROZEN_FROM_PRODUCT` (§7.2)

The PDF byte-stream is never modified. Identity is `SHA-256` of the bytes.

- **Same hash, same book** → duplicate intake is a no-op returning the existing revision.
- **Same hash, different book** → the blob is shared (content-addressed); revisions reference it.
- **Different hash** → a **new** `BookSourceRevision`. Never an in-place update, because page
  geometry — and therefore every annotation anchor — may have moved.

Replacing a book with a different edition is therefore a *new revision*, and old revisions are
retained as `SUPERSEDED` rather than deleted, so existing notes and learning state stay resolvable.
Migrating user assets between revisions is `DEFERRED_WITH_BOUNDARY`: the seam is that all durable
assets already carry `book_source_revision_id`, so a future mapper has a well-defined domain and
range.

### 6.3 Intake

Streamed write to a temporary path with running hash and size cap → structural validation (header,
trailer, page count, encryption check; reject encrypted PDFs with a clear message) → atomic move
into the content-addressed blob store → revision row committed.

**The Reader becomes usable at commit.** No preparation job is awaited (§4.1). Page-preparation jobs
are enqueued after commit, and their absence changes nothing about readability.

### 6.4 Deletion

`ACTIVE → DELETING → DELETED` as a tombstone, with cascade *within* contexts.

- Blob removed only when no revision references that hash.
- Crop cache entries for the revision dropped (harmless).
- **User assets are the hard case.** Deleting a book deletes its notes and learning state. That must
  be an explicit, clearly-worded confirmation, and `DELETE_FAILED` must be a retryable state rather
  than a terminal one — a failed cleanup must never leave a half-deleted book that the Reader will
  still try to open.

---

## 7. PDF Reader and Geometry

### 7.1 Rendering — `RECOMMENDED_FOR_DRAFT`

**Render the PDF client-side to canvas, with our own geometry overlay above it.**

The canvas + overlay architecture is the standard, well-understood approach in the web PDF ecosystem
(PDF.js established the pattern: a rasterized canvas with a positioned layer above it carrying
selectable elements). We adopt the *pattern*, not the assumption behind it.

**Critical difference from an ordinary PDF viewer:** conventional viewers build their text layer
from the PDF's own embedded text. Our target books are **scanned** — there is frequently no embedded
text at all. Our overlay is therefore sourced from **our OCR layer** (§8), which means:

- the overlay is *progressive* — it appears for a page only once that page is prepared;
- an unprepared page is still fully rendered and readable, just not selectable;
- the overlay is *correctable* and *versioned*, because the OCR layer is.

Where a PDF *does* carry a reliable embedded text layer, that is a legitimate and much cheaper
source for the same overlay (§8.2).

### 7.2 Coordinate systems — `RECOMMENDED_FOR_DRAFT`

Three spaces, converted at exactly one boundary each:

| Space | Definition | Used for |
|---|---|---|
| **PDF space** | Points, origin bottom-left, per-page media box | Never stored; conversion input only |
| **Normalized space** | `x,y ∈ [0,1]`, origin **top-left**, relative to the page's media box | **The only geometry ever persisted** |
| **Viewport space** | Device pixels at current zoom/rotation | Rendering and hit-testing only; never persisted |

**Normalized, top-left, is the storage convention.** It is resolution-independent, DPI-independent,
survives zoom and re-render, and matches the direction browsers and image models already use — which
removes a whole class of flip bugs at the overlay boundary. Every persisted rect or quad in this
architecture is in this space, and a shared conversion module is the only place the transform lives.

Rotation and non-zero-origin media boxes are handled in that conversion module and normalized away.

### 7.3 Virtualization

Only viewport pages plus a small window are rasterized and kept; the rest are placeholders at correct
aspect ratio so the scrollbar is honest. LRU eviction of rendered canvases and overlays. Overlay
construction is lazy per visible page.

### 7.4 Selection and highlight overlay

For a prepared page the overlay carries line-level boxes with fine-grained cells inside them (§8.3).
Selection maps pointer positions to the nearest cell boundary **within a line**, then expresses the
result as a range:

```
(page, line_ordinal, cell_start, cell_end)  →  union of cell rects  →  quads
```

Cross-line selections are a list of per-line ranges, not a free-form region. Highlights render from
persisted normalized quads and require **no OCR at all** to display — a highlight drawn today still
renders after the OCR layer is regenerated, because its geometry is its own (§16).

**Hit-testing precision is bounded by cell precision, not by pixels.** Snap to cell boundaries; never
attempt sub-cell selection.

### 7.5 Navigation and current-section resolution

Outline click → scroll to `(pdf_page_index, normalized y)`. Current section is derived: the deepest
`OutlineNode` whose physical range contains the current reading anchor (§10.3). It is a **derived
projection, never stored** — storing it creates a second source of truth that drifts.

### 7.6 On-demand crops — `FROZEN_FROM_PRODUCT` (§10)

`crop(book_source_revision, pdf_page_index, normalized_bbox, target_dpi)` renders from the original
PDF at request time and caches by that exact key. Used for multimodal AI context (§13.6) and for any
figure zoom UI. **No bulk figure extraction, ever** — the PDF is the visual authority and crops are
cache entries.

---

## 8. OCR / Layout Foundation

### 8.1 What the product requires — `FROZEN_FROM_PRODUCT` (§6)

> detected line geometry **+** fine-grained selectable geometry

and, explicitly: no permanent Product `Word` entity, and no product semantics inferred from a
provider's field names.

### 8.2 Page routing

Per page, cheapest sufficient source wins:

```
page → probe embedded text layer
        ├─ present and trustworthy  → EMBEDDED route (cheap, exact)
        └─ absent / unreliable      → OCR route (inference)
```

The probe must be conservative: sparse text, a high replacement-character ratio, or missing
positions all mean *unreliable*, and an unreliable page must fall through to OCR rather than
producing a bad overlay. Encrypted or malformed pages fail the page, never the book.

Route is recorded per page as evidence.

### 8.3 Entities

```
OCRPage
  book_source_revision_id, pdf_page_index
  status: NOT_PREPARED | PREPARING | READY | FAILED
  route: EMBEDDED | OCR
  foundation_version, engine_profile, prepared_at
  failure_code (nullable)

OCRLine
  page ref, line_ordinal (reading order within page)
  quad (normalized), text, confidence
  cells  ← serialized fine-grained geometry, see 8.4
```

**Reading order** is per-page and produced by deterministic geometric sorting (column detection,
then top-to-bottom, left-to-right), not by a model. Inside a detected figure region, reading order is
meaningless and is not asserted.

**Confidence** is recorded per line and per page, and is used for surfacing uncertainty and
prioritizing correction review — never for silently discarding content.

### 8.4 Fine-grained cells — the deliberate storage decision — `RECOMMENDED_FOR_DRAFT`

**Cells are stored as a compact serialized array on their `OCRLine` row. They are not rows, and they
have no IDs.** **[E] Confirmed by measurement — see 8.4a.**

Three independent reasons converge:

1. **Access pattern.** A cell is only ever needed together with its line — for overlay construction
   or range resolution. It is never queried independently, joined, or filtered.
2. **Cardinality.** Row-per-cell would multiply the largest table by roughly 20–40× (thousands of
   glyphs per page against tens of lines) for zero query benefit.
3. **It enforces §4.4 for free.** Something with no ID cannot be foreign-keyed, cannot be returned as
   a domain object, and cannot quietly become the addressable textbook fragment the Product Blueprint
   forbids. *The storage shape makes the wrong architecture inexpressible* — a stronger guarantee
   than a naming rule.

Cell payload per line: `[(x_start, x_end, char_index_range)]` in normalized space, sharing the line's
vertical extent unless the engine supplies genuine per-cell vertical geometry.

### 8.4a Measured granularity **[E]**

The clean-room draft deliberately left granularity unspecified pending measurement. Measurement is
now in, from 9 representative real 王道 pages:

| Measured | Value | Consequence |
|---|---|---|
| Sub-line units | 8,458 over 9 pages (~940/page) against ~44 lines/page | **≈21× multiplier** — inside the 20–40× the clean-room predicted. Row-per-cell rejected on the intended grounds. |
| Granularity | **99.8% single characters** (6,738 CJK + 1,703 Latin/digit); 17 multi-character units, only on lines containing no CJK at all | Per-character for anything with CJK; per-token on all-Latin lines |
| Vertical extent | Line-inherited (1,430/1,430 units on one page shared the line's y-range exactly) | **Payload shape confirmed**: cells carry x-extent only |
| Horizontal extent | Interpolated from recognition alignment, accurate to **≈ ±½ glyph** | **Snap-to-cell hit-testing confirmed as the ceiling**, not a conservative choice |

The clean-room derivation — lines detected, sub-line reconstructed from recognition alignment,
horizontally approximate, vertically line-inherited — was correct in every particular. The numbers
sharpen it rather than change it.

**Naming.** The entity stays **`OCRCell`**, not `OCRChar`. At 99.8% it is tempting to call it a
character, but the remaining 0.2% genuinely are multi-character tokens, and a name that is *usually*
true is exactly the kind of near-miss that later becomes a wrong assumption in code. `OCRCell` with
documented measured granularity is the honest choice, and it keeps the door open for an engine whose
sub-line units differ. *(This resolves the naming caveat raised in the clean-room self-review, Q7.)*

**Payload, now concrete:** per line, an array of `(x_start, x_end, char_index_start,
char_index_end)` in normalized space, sharing the line's vertical extent. Character indices point
into `OCRLine.text`, which is what makes a selection a pure range expression (§7.4).

**Not overgeneralized.** These figures describe nine pages of two 王道 PDFs. Another textbook, a
different scan quality, or a different engine version may differ. What is architecturally load-bearing
is the *shape* — derived, x-approximate, y-inherited, no stable identity — and that follows from the
two-stage engine design (§8.5), not from the sample.

### 8.5 Engine — `RESOLVED` **[E]** *(was `USER_DECISION_REQUIRED` D-2)*

**RapidOCR driving PP-OCRv6 detection + classification + recognition on onnxruntime.**

The clean-room recommendation was "the PP-OCR family through a portable inference runtime rather
than the training framework." Calibration selected exactly that and named the concrete stack:

| Measured on 9 real pages | Result |
|---|---|
| Line geometry | 393 lines; 0–1 overlapping pairs per page; the only abnormally tall lines were genuine (rotated in-figure labels, one large title) |
| Selection resolution | 34/34 target strings resolved to geometry and cropped back to the correct glyphs |
| Anchor recovery | 6/6 — text + page + geometry + containing line + context, with no model call |
| Throughput | **2.24 s/page** at 200 DPI, CPU |
| Model footprint | **31.7 MB**, bundled ONNX |
| Framework dependency | **None** — no PaddlePaddle, no torch |

The footprint is the decisive detail: OCR needs onnxruntime, not a training framework. That keeps the
`prepare` extra small and makes §8.6's adapter boundary cheap to honour.

**On text quality — stated carefully.** On 15 hand-transcribed body lines (382 characters) spanning
headings, captions and mixed CN/EN/numeric/formula-adjacent text, character agreement was complete
after normalizing whitespace and full/half-width punctuation. **This is a sample result on
representative 王道 pages. It is not a system property and must never be written as one.** Real errors
were found — in rotated in-figure labels, where confidence scores did *not* flag them (§13.6a). Other
books, other scan qualities and other engine versions will differ, which is exactly why OCR is a
correctable layer (§8.7) rather than a trusted one.

*Original reasoning retained below — it is what the measurement confirmed.*

Research basis (Sept 2026): the PP-OCR line is the leading open-source engine for Chinese document
text; PP-OCRv5 covers Simplified/Traditional Chinese, pinyin and English in one model, ships distinct
server and mobile variants, and the mobile variants are explicitly built for CPU-only deployment,
with a documented two-stage architecture — **text-line detection followed by per-line recognition**.
PP-OCRv6 continues the line at larger parameter counts.

Two architectural consequences follow directly from that two-stage design, and they are worth stating
because they *independently re-derive* the Product Blueprint's §6 position:

- **Lines are genuinely detected.** The first stage's output is line-level geometry. That is why line
  is the anchoring authority — not a modelling preference.
- **Sub-line geometry cannot be a detection output.** The second stage consumes a line crop and emits
  a character sequence. Any per-character position is therefore *reconstructed from the recognition
  alignment*, not measured. It follows that cells are inherently derived, approximate in the
  horizontal axis, and share the line's vertical extent — exactly what §8.4 assumes.

**Alternatives considered.** Tesseract — mature and permissive, but materially weaker on dense
Chinese document text. Cloud OCR APIs — rejected on privacy (the whole book would leave the machine)
and on the offline requirement (§3.6). A VLM performing OCR — rejected for V1: no reliable geometry,
far higher cost per page, and it would put a model in the path of the *machine layer* the product
requires to be deterministic and correctable.

**Fit / cost / lock-in.** Runtime cost is 2.24 s/page CPU, once per page, in the background. Lock-in
is low **provided the engine sits behind an adapter** (§8.6) — the entities in §8.3 are ours, not the
engine's. Licensing must be verified per model artifact before adoption. Adoption remains a major
external dependency and is authorized at Gate D/E, not here.

### 8.6 Engine adapter boundary — `FROZEN_FROM_PRODUCT` (§6)

```
OcrEngine (port)
  prepare_page(page_image, page_size) -> [DetectedLine{quad, text, confidence, cells[]}]
```

The adapter is the **only** place engine vocabulary exists. Field names, output shapes and library
types stop at that boundary and are translated into §8.3 entities. A second engine must be
introducible by implementing this port and nothing else.

Explicitly: no engine field name may propagate into a domain name, a table name, an API field or a
UI label — regardless of how convenient the name is.

### 8.7 Corrections and foundation versioning — `RECOMMENDED_FOR_DRAFT`

`foundation_version` is a per-`BookSourceRevision` counter. Two distinct events increment it, and
distinguishing them is what keeps degradation proportionate:

| Event | Geometry | Effect on dependents |
|---|---|---|
| **Text correction** (user/operator fixes recognized text) | **unchanged** | Anchors keep resolving — geometry is untouched. Only quote-based fingerprints need refreshing. Cheap. |
| **Reprocessing** (engine or model change, re-run) | **changes** | Anchors must be re-resolved by fingerprint; low-confidence results are flagged for review, never silently moved. Expensive. |

Corrections are stored as an **overlay**, never by mutating the recognized row:

```
OCRCorrection: page ref, line_ordinal, char_range, corrected_text,
               reason, author (USER|OPERATOR), created_at, published_in_version
```

Effective text = base ⊕ published corrections. This keeps the machine's original output inspectable
forever, which matters because a "correction" can itself be wrong.

**Error reports** (§7 of the Product Blueprint) are a separate, lighter entity: page + geometry +
optional quote + type + comment. A report is an observation; a correction is a change. Reports may
exist without ever becoming corrections.

### 8.8 Measurement outcome and residual unknowns **[E]**

The four falsifiable questions the clean-room draft posed have been answered:

| # | Question | Answer | Effect |
|---|---|---|---|
| 1 | Cell granularity and horizontal accuracy | 99.8% single characters; x accurate to ≈±½ glyph | §8.4 unchanged; snap-to-cell confirmed as the ceiling |
| 2 | Per-page cost | 2.24 s OCR + 0.79 s layout ≈ **3.0 s/page**, CPU, 200 DPI | §18.3 batch sizing now evidence-based; a 300-page book ≈ 15 CPU-minutes |
| 3 | Vertical geometry | **Line-inherited**, not per-cell | §8.4 payload confirmed: x-extent only |
| 4 | Behaviour on the pages that matter | Passed on dense CN, mixed CN/EN/numerals, formula-adjacent; **failed on rotated in-figure labels** | §13.6a adds a trust tier for in-figure text |

Nothing contradicted §8.4 or §8.5. The sequence in §0.1 worked as intended: the architecture was
derived first and survived measurement.

**Residual unknowns, carried forward honestly:**

1. **Cross-engine-version anchor robustness — the one real gap.** The highlight round-trip achieved
   6/6 at IoU > 0.999, but against the *same* engine version. It therefore proves determinism and
   quote-based re-resolution, **not** survival across an engine upgrade — which is precisely what
   §19.4's reprocessing path depends on. See §16.3a.
2. **Render DPI.** All figures are at 200 DPI; the accuracy/latency curve below that is unmeasured
   and is the obvious lever if 3 s/page proves too slow.
3. **Watermark contamination** on heading lines — §11.2a.
4. **In-figure text errors** that confidence scores did not flag — §13.6a.
5. **Sample breadth.** Nine pages, two PDFs, one textbook series. Adequate to choose an engine;
   inadequate to characterize every book a user may import.

---

## 9. Visual Layout (Figures and Tables)

### 9.1 Minimal representation — `FROZEN_FROM_PRODUCT` (§10)

```
VisualRegion
  book_source_revision_id, pdf_page_index
  bbox (normalized), kind: FIGURE | TABLE
  caption_line_ref (nullable), caption_identifier (nullable, e.g. "图7.9")
  confidence, detector_profile, foundation_version
```

**Geometry only.** No extracted image is the book's visual authority; pixels come from `crop()` on
demand (§7.6). Caption association reuses an existing OCR line rather than introducing a caption
hierarchy — a caption is a *reference*, not a new entity.

### 9.2 Detection — interface `SETTLED`; detector `USER_DECISION_REQUIRED` **(D-3)** **[E]**

Three things were bundled in the clean-room draft and must now be separated, because evidence
resolves them differently:

| | Status |
|---|---|
| **Architecture interface** — §9.1 entity + a detector adapter mirroring §8.6 | **Settled.** Unchanged by evidence. |
| **Is a dedicated detector needed at all?** | **Settled: yes.** Measured, below. |
| **Which detector, at what dependency cost?** | **Open — D-3.** |
| **When is it installed?** | **Not at bootstrap.** Preparation-time extra only. |

**A dedicated detector is needed — measured, not assumed.** At confidence ≥ 0.5 with overlap-merge, a
layout model scored **7/7 figures and 2/2 tables with 0 false positives**, with a clean separation
between real detections (≥ 0.872) and noise (≤ 0.406). The OCR-only alternative scored **0/7 figures**
and cannot label a region as TABLE at all — failing structurally for exactly the reason the clean-room
draft predicted a priori: textbook figures *contain* OCR'd text, so no gap exists to detect. That
prediction being confirmed by measurement is the strongest evidence in this section.

Two implementation details are load-bearing and must not be lost: **the 0.5 threshold and the
overlap-merge are both required.** Raw output over-detects — one flowchart fragmented into three boxes
(0.918 / 0.404 / 0.329), which threshold-plus-merge correctly resolves to one.

**The open question is the detector, and it is genuinely open** — because the measured candidate and
the best dependency profile are not the same candidate:

| Candidate | Accuracy on our pages | Dependency cost | Status |
|---|---|---|---|
| **`docling_ibm_models.LayoutPredictor`** (docling-layout-heron) | **Measured: 7/7, 2/2, 0 FP**, +0.79 s/page | 164 MB model **+ torch 527 MB + transformers 113 MB ≈ 805 MB** | Verified standalone — imports torch/transformers/PIL/numpy only, **no docling pipeline** |
| **DocLayout-YOLO via ONNX** | **Unmeasured on our pages** | Model + onnxruntime, **already required for OCR** → near-zero marginal cost | ONNX exports exist that remove the PyTorch dependency at inference and run on CPU |

Neither dominates. One has evidence on our actual textbook; the other has a dependency profile an
order of magnitude better and would make the entire `prepare` extra onnxruntime-only.

**Required pre-adoption engineering investigation** (small, well-defined): run the ONNX candidate over
the same 9 calibration pages and compare against the same ground truth — figures found, tables found,
false positives, confidence separation, per-page cost. If it holds up, adopt it and torch never enters
the project. If it does not, adopt heron and accept the 805 MB in a preparation-only extra. This is a
one-afternoon bake-off with a pre-existing fixture set and answer key, and it should happen before
Gate E.

**Explicitly rejected regardless of outcome:** the `docling` pipeline, `docling-core`, `docling-parse`,
`doclang`, and TableFormer (342 MB). None is needed for geometry. Only the standalone predictor class
was ever in scope.

**Why it stays optional.** Every capability depending on figure/table geometry degrades to "the user
can still see and select the region." Reading never depends on it. V1 may ship without it; the seam
costs nothing to leave open.

*Original reasoning retained below.*

Research basis (Sept 2026): purpose-built document layout models are mature and cheap.
DocLayout-YOLO (YOLO-v10 lineage, synthetic-pretrained) targets exactly this task, and — importantly
for dependency cost — **ONNX exports exist that remove the PyTorch dependency at inference and run on
CPU**. PP-DocLayout offers finer categories (formulas, charts) from the same family as the
recommended OCR engine, which would allow one toolkit to cover both.

**Alternative considered and rejected: deriving regions from OCR gaps.** Inferring "a figure is where
there is no text" fails structurally rather than marginally, because textbook figures *contain* text
(axis labels, box captions, flowchart nodes). There is no cheap heuristic fix.

**Why it is optional.** Every product capability that depends on figure/table geometry — figure-aware
Guidance, multimodal figure explanation — degrades gracefully to "the user can still see and select
the figure region manually." Reading never depends on it. So V1 can ship without it if the dependency
cost is judged too high, and the seam (§9.1 entity + a detector adapter mirroring §8.6) is defined
either way.

**Fit / cost / lock-in.** ONNX-runtime inference keeps the added dependency to a model file plus a
runtime already needed for OCR — a materially better profile than a training-framework dependency.
Lock-in low behind the adapter. Licence verification required per model artifact before adoption.

### 9.3 Formula — `DEFERRED_WITH_BOUNDARY` (§10.2)

No persistent formula-region entity in V1. Formula content is served by OCR line text, user selection,
or an on-demand crop to a multimodal model. If real usage later justifies it, a formula region is
just another `VisualRegion.kind` — the seam already exists and costs nothing now.

---

## 10. Printed-Page Mapping

### 10.1 Model — `FROZEN_FROM_PRODUCT` (§5)

2026-09-19 user amendment: PageLabel is internal evidence. Reader/navigation/citation UI displays
one-based PDF pages only. An absent printed label does not make a known PDF destination unknown.

```
PageLabel
  book_source_revision_id, pdf_page_index
  printed_label (nullable string — absent means UNKNOWN)
  confidence, method: INFERRED | MANUAL | NONE
  evidence_ref (nullable: page + region the label was read from)
```

Per-page rows, not a formula. **No global offset is ever stored as the mapping**, because a book may
contain front matter, plate inserts, or restarted numbering — any of which breaks a single constant.

### 10.2 Inference — `RECOMMENDED_FOR_DRAFT`

Per book revision, as a low-cost job:

1. **Candidate extraction.** OCR the header and footer bands only (a small fraction of each page) and
   collect short numeric or roman tokens with their positions.
2. **Hypothesis fitting.** Look for a locally consistent monotonic relation across runs of pages.
   Multiple runs are expected and allowed — front matter and body commonly differ.
3. **Consistency checks.** Monotonicity within a run; recto/verso positional parity (odd labels
   consistently on one side); density of agreement across the run.
4. **Assignment.** Pages within a validated run get `INFERRED` labels with confidence. Pages outside
   any validated run stay **UNKNOWN**. Interpolating across a gap is permitted only inside a run that
   is otherwise consistent, and is marked with lower confidence.
5. **Manual override** always wins and is recorded as `MANUAL`.

**The rule that matters: absent evidence yields UNKNOWN, never a guess** (§5). A confidently wrong
page citation is worse for a learner than an honest absence.

### 10.3 Measured evidence **[E]**

Header-band OCR over two complete sample PDFs:

| Sample | Labels recovered | Consistency | Parity |
|---|---|---|---|
| A | **28 / 29 pages** | all 28 fit one relation | holds |
| B | **16 / 29 pages** | all 16 fit one relation — **a different one** | holds |

Every element of the clean-room design is confirmed: header-band extraction works, sequence
consistency validates, recto/verso parity is a real signal, and the 13 unrecovered pages in sample B
are front matter with no arabic label — correctly **UNKNOWN**, not interpolated.

**The two samples produced different relations, and that is the finding.** It is direct proof that no
global offset exists. Any constant observed while testing one book is evidence about *that book* and
nothing more, and must never appear in code, configuration or a default. §10.1's per-page rows with a
per-source-revision derivation are the correct model.

One historical note worth keeping, because it is a design lesson rather than trivia: an earlier
pipeline concluded these labels were unrecoverable. They were not — that pipeline classified running
headers as page furniture and discarded them before anyone looked. **Header and footer bands are
evidence and must never be discarded during preparation.** They carry the printed page label and, in
these samples, the running chapter title.

---

## 11. Stable Outline

> **Revised, 2026-09-03 (Outline conceptual correction).** The prior draft's §11.4a introduced
> `OutlineRegion` — a per-Chapter publication gate conflating "this Chapter's logical structure is
> known" with "this Chapter's body has enough OCR evidence to trust its physical ranges." Independent
> review, and a direct product-intent clarification, established that these are different questions
> with different timelines: for an ordinary textbook the logical tree is knowable almost immediately
> from bookmarks/TOC, while physical resolution is genuinely progressive and per-node. `OutlineNode`
> is restructured below to carry both as separate fields with separate revision counters;
> `OutlineRegion` is **removed** (§11.5). `PRODUCT_BLUEPRINT.md` §9 states the corresponding product
> model.

### 11.1 Entity

```
OutlineNode
  book_source_revision_id
  outline_node_id                          ← stable identity, minted once
  identity_revision                        ← bumps only on a structural-identity correction (§11.4)
  parent_id (nullable), depth, order_index
  kind: CHAPTER | SECTION | SUBSECTION | EXERCISES | ANSWERS | FRONT_MATTER | OTHER
  title, printed_label_hint (nullable)
  start_page, start_y, end_page, end_y     ← normalized, nullable until resolved
  resolution_state: UNRESOLVED | PARTIAL | RESOLVED
  physical_revision                        ← bumps only when THIS node's own range changes (§11.4)
  confidence, evidence (source: BOOKMARK | TOC | HEADING_DETECTION | MANUAL)
```

Two independent revision counters per node, each scoped to that node alone, are what make artifact
staleness node-scoped rather than book-scoped (§19.2b) — an artifact that used node `4.2` depends on
`(outline_node_id=4.2, identity_revision, physical_revision)`, and nothing about Chapter 8 or Chapter
9 can appear in that tuple.

### 11.2 Construction — `RECOMMENDED_FOR_DRAFT`

**2026-09-18 reliability clarification (user-authorized correction):** `kind` and `depth` are
independent. Explicit 篇/部 containers use `OTHER`; nested `CHAPTER` nodes remain Chapter owners
for navigation, source ranges and Knowledge preparation. A dense sequential page-label bookmark
export is rejected as structural evidence and falls back to TOC evidence. TOC bootstrap must not
publish a later block while earlier pages remain unseen, and known numbered hierarchy gaps must
not silently assign sections to the wrong chapter. Existing committed identity remains guarded:
parser upgrades never automatically remint an existing tree. A dependency-free source revision may
be explicitly repaired offline using fingerprint checks, staged validation, a recoverable database
backup and incremented identity revision; any durable dependent refuses this bounded repair path.
OCR replacements use Foundation's existing change/version/event publication, never direct line edits.
TOC navigation excludes the TOC/front prefix from body-label candidates (independent page-number
sequences may restart). A chapter opener without a printed number can gain a page-only target from
one unambiguous adjacent measured label **and** a matching actual body heading. This confirms only
physical placement of an existing node, never a new identity or extrapolated PageLabel row. A
confirmed chapter label can locate sections sharing that same printed page at page granularity.

**Two staged evidence passes, not one undifferentiated list.**

**Pass 1 — logical bootstrap.** Runs once, early, over the whole book, and is cheap (it does not wait
on body OCR):

1. **PDF outline/bookmarks** where present — authoritative for titles, hierarchy and start positions,
   though usually only to page granularity.
2. **Table-of-contents pages** — OCR'd first (§4.2's own TOC-prioritization) and parsed for
   title/label/level triples.

Either source alone is normally sufficient to mint the full logical `OutlineNode` tree — identity,
title, level, parent/child, order — for the whole book, each node starting at `resolution_state =
UNRESOLVED` or `PARTIAL` (a bookmark's page-only start is enough for `PARTIAL`).

**Pass 2 — progressive physical resolution.** Runs continuously as body OCR/layout proceeds
(§18.2's `PAGE_PREPARE`), refining each node's `start_y`/`end_page`/`end_y` and advancing its
`resolution_state` toward `RESOLVED` as headings are confirmed in place. This pass never creates a
node — only Pass 1 (or its fallback below) does that — and updating one node's resolution never
touches another node's fields.

3. **Heading detection from the OCR/layout layer** (line geometry, relative type size, indentation,
   numbering patterns like `7.3.3`, `一、`, `1.`) serves Pass 2 always, and serves Pass 1 **only as a
   fallback** — for the part of the book where bookmarks and TOC parsing genuinely found nothing.
   That fallback is scoped to the unresolved part of the tree; it does not delay or gate the parts
   Pass 1 already established from other evidence.

**11.2a Watermark contamination [E].** Measurement found overprinted watermark text merged into a
*section heading line* — the OCR line for `7.3.3 DMA 方式` also contained a distributor watermark
string. Harmless for anchoring (the geometry is still right), but it will corrupt heading detection,
outline titles and any semantic index built on line text. Required: a normalization step that strips
recognized watermark/overprint patterns from line text **for classification and indexing purposes
only**, never mutating the stored recognized text (§8.7 keeps the machine's original output
inspectable). Frequency across a wider corpus is unmeasured — sample was 9 pages.

**AI may classify and disambiguate; AI may not order.** A model can answer "is this line a section
heading, and at what level" — a genuinely hard classification problem on scanned text. It may not
decide what comes after what: order and ranges are resolved **deterministically** from page index and
vertical position (§5 of the Product Blueprint's structural intent, and Product §9). This is what
keeps the Outline the *textbook's* structure rather than a pedagogical reorganization.

### 11.3 Range resolution and validation — `FROZEN_FROM_PRODUCT` (§9.1, §9.3)

**Logical construction (Pass 1, §11.2) and physical validation are separate steps against separate
readiness questions.** The logical tree — every node's identity, title, level and order — commits as
soon as Pass 1 produces it, with no range-validation gate at all: an `UNRESOLVED` node is a completely
normal, immediately-navigable member of the tree (§11.5).

Physical validation applies **per node, at the point that node's `resolution_state` is claimed to
advance** — it is what makes a `PARTIAL → RESOLVED` (or `UNRESOLVED → PARTIAL`) transition valid, not
a precondition for the node existing:

- the node's range does not overlap a sibling's already-`RESOLVED` range;
- a child's range, once resolved, is contained in its parent's;
- ranges are monotonic in `(page, y)` against whatever of the node's own range is already resolved.

A node's range runs from its heading to the start of the next heading at the same or shallower depth,
per Pass 2's heading-confirmation evidence (§11.2). Validation failure for one node's resolution
attempt blocks *that node's* transition — it never blocks reading, never blocks the logical tree's
visibility, and never blocks any other node's resolution.

**Section lead-in** (Product §9.4) needs no representation: text between a section heading and its
first subsection is inside the section's range by construction, and is therefore already visible to
System and Assistant without a node of its own.

**Exercises/answers** are recognized node kinds for navigation (Product §31) and are explicitly *not*
knowledge-bearing — §12.2 excludes them from KP generation by default.

### 11.4 Correction granularity — `FROZEN_FROM_PRODUCT` (§9.5) **[revised, closes ZCode P1-2, sharpened by the Outline conceptual correction]**

2026-09-19 explicitly authorized populated-book repair: a separate offline `--preserve-assets`
operation stages against a verified database backup, preserves every existing node ID/owner/kind,
and refuses missing nodes or reparenting. Additive auxiliary rows may shift sibling order slots
without changing existing identity. Existing ranges are recomputed only where previously resolved;
changed ranges advance their own physical revision. No dependent rows are deleted or rewritten.
Affected published chapter maps carry an `asset_review` evidence marker for their current structure
version; APIs/UI expose `needs_review` while retaining READY content. A later explicitly authorized
new structure version supersedes that marker. Existing Teaching dependency checks remain node/page
scoped. Ordinary bootstrap still refuses structural-digest conflicts; this is not silent migration.
The earlier unowned replacement mode keeps its original refusal rules.

Three tiers, each scoped to the node(s) actually affected — never to the book as a whole:

```
correction.kind == COSMETIC     → apply directly, no revision bump that matters to any dependent
                                   (title text, a node-kind relabel that moves no boundary
                                   and changes no identity)

correction.kind == BOUNDARY     → node.physical_revision += 1, then:
                                   does the affected node's Chapter have a durable dependent?
                                   (§12.5's predicate, evaluated for that Chapter only)
                                     ├─ no  → apply directly
                                     └─ yes → (a) trigger explicit revalidation/re-preparation
                                              of that dependent, or (b) refuse per §12.5 —
                                              never silently apply and leave the dependent
                                              pointing at a stale range

correction.kind == IDENTITY     → node.identity_revision += 1 (a missing Section discovered,
                                   wrong hierarchy, an incorrect merge/split, wrong parent
                                   Chapter). If any durable asset already depends on the
                                   affected identity, this requires the same
                                   migration-grade protection as a Chapter-structure identity
                                   change (§12.5) — never a silent re-ID, even in the
                                   unlocked case, because identity (unlike a range) is what
                                   downstream KP/Teaching/Annotation records actually key on.
```

A `BOUNDARY` or `IDENTITY` correction to a Chapter-9 node bumps only that node's own revision and
checks only Chapter 9's dependents — it has no code path that touches Chapter 3's nodes, revisions, or
dependent state.

### 11.5 Logical establishment and progressive resolution — `FROZEN_FROM_PRODUCT` (§9.1, §9.2) **[replaces the removed `OutlineRegion`, closes ZCode P1-1]**

> **Revision note.** The prior draft's `OutlineRegion.status == BUILDING | PUBLISHED` gate is
> **removed**. It existed to let Chapter Preparation start before the whole book's Outline was
> finished — a real requirement — but it expressed that requirement as "this Chapter's Outline region
> is published," which silently made body-OCR-driven range confirmation a precondition for a Chapter
> merely *appearing* in the directory. The logical/physical split in §11.1–§11.3 satisfies the same
> requirement without that side effect: the directory is complete once Pass 1 finishes (normally at
> or shortly after intake), and Chapter Preparation's actual dependency — sufficient physical
> resolution for one Chapter — is expressed directly against that Chapter's own nodes.

Chapter Preparation (§12) depends on:

```
chapter_ready_for_kp_prep(chapter_node) :=
    chapter_node.resolution_state != UNRESOLVED
    AND all child SECTION/SUBSECTION nodes of chapter_node have resolution_state != UNRESOLVED
    AND sufficient body OCR evidence exists for chapter_node's resolved page range
```

This checks **only** the Chapter being prepared and its own children. Chapter 4 may satisfy this
while Chapter 9 is still `UNRESOLVED` throughout — there is no dependency, direct or transitive, on
any other Chapter's resolution state, and no dependency on a book-wide "Outline is done" signal,
because no such signal exists in this model.

`PARTIAL` is sufficient where the specific range boundary a consumer needs is already trustworthy
(e.g., a Section's start is `RESOLVED` even though its end awaits the next heading); §12's range
resolution step (which converts KP draft boundaries to concrete geometry) is itself expected to
supply the final confirming evidence for a Chapter's own end boundaries in the ordinary case — Chapter
Preparation and physical resolution advancing are not required to be two fully sequential phases for
a Chapter the user has just opened and prioritized.

---

## 12. Chapter Knowledge Map

### 12.1 State machine — `FROZEN_FROM_PRODUCT` (§14)

```
NOT_PREPARED ──request──► PREPARING ──publish──► READY
                             │
                             └──fail──► FAILED ──retry──► PREPARING
```

Per `(book_source_revision, chapter OutlineNode)`. **Chapter-scoped and lazy: never book-wide, never
eager.** A FAILED chapter is isolated — reading, selection, notes, highlights and Assistant remain
fully available for it (§14, §20).

A published Map's availability is independent from a replacement attempt:

```
READY(vN) + IDLE/FAILED ──explicit regenerate──► READY(vN) + RUNNING
READY(vN) + RUNNING ──atomic publish──► READY(vN+1) + IDLE
READY(vN) + RUNNING ──fail/block──► READY(vN) + FAILED
```

No replacement state hides or mutates `READY(vN)`. The replacement attempt stores only operational
progress/failure until the publish transaction succeeds.

### 12.2 Pipeline

```
Chapter source projection              (existing Outline + OCR/layout authority)
   → deterministic evidence-unit construction and Outline-subsection semantic windows
   → one group-first final partition per window
       learning_targets[{unit_ids, title, one_sentence_meaning}] + non_kp_units[]
                                         [AgentRuntime, internal pipeline role]
   → deterministic private-KP materialization
   → assemble one complete compact Chapter ledger
   → deterministic pre-review contract validation
   → independent Chapter-level structural review of the compact ledger
                                         [AgentRuntime, different context; different provider preferred]
   → deterministic final validation     (see 12.4)
   → atomic Chapter publish              (stable IDs assigned here)
```

> **User-approved architecture correction, 2026-09-07; simplified 2026-09-08.** Repeated real use
> showed that LLM-first complete-KP generation retained the wrong source-authority boundary, while
> later multi-pass absorption/audit and Review-driven repair oscillated between over-split and over-
> merge. The accepted path is deterministic evidence units → one group-first final semantic partition
> per real Outline subsection → deterministic KP materialization → one compact Chapter Review gate.
> It supersedes packet `KEEP`/`MERGE`/`DROP`, forced enumeration/character/count heuristics, semantic
> cleanup/re-partition, and Review-driven repair/re-review. The product/publication shell is unchanged.

The evidence-unit builder is deliberately local and minimal. From the requested Chapter's existing
Outline and OCR/layout records, it deterministically assigns each bounded unit a pipeline-local ID,
one existing primary Section, source revision, order and continuous source evidence. It does not
infer or replace document hierarchy and is not a generic document framework. Unit IDs are model-
visible references; their Section/page/line/geometry/range mapping remains server authority.

Each real existing Outline subsection is exactly one semantic window and receives one logical AI
judgment. A Section lead-in outside its child subsections, or a Section with no child subsection, may
form one separate deterministic fallback window. A size check may fail closed before invocation, but
must not split one real subsection across multiple semantic judgments. The invocation receives only
that window's ordered deterministic evidence units and declared context.

The result is one group-first final partition:

```json
{
  "learning_targets": [
    {"unit_ids": ["..."], "title": "...", "one_sentence_meaning": "..."}
  ],
  "non_kp_units": ["..."]
}
```

Together the two collections account for every supplied unit exactly once. Each learning target has
a non-empty contiguous run of supplied unit IDs in this window. The model cannot mint IDs or emit
Section, page, line, geometry, source range or source-revision fields. Invented, duplicate, missing,
multiply consumed, non-adjacent, cross-window/cross-Section references, partial output and invalid
schema fail closed under §13.5; the server never coerces them into a result.

The semantic presumption is absorption. A separate durable KP needs positive support for an
independently useful teaching, assessment, diagnosis and remediation path. A heading or example alone
never becomes a KP. Definition, property, ordinary step, example and alternate terminology for one
learning target default to the same target. Brief taxonomy/composition/procedure/peer items default
to the containing framework target unless the current evidence teaches distinct mechanisms, error
modes or remediation paths. Summary repetition does not mint a new target; FAQ and misconception
material defaults to `non_kp_units` or absorption into an existing target. These are generic semantic
instructions, not deterministic character/count/numbering thresholds. Facet/property/step/example
evidence may remain inside a target's continuous evidence span without a new durable attachment type.

Materialization is **deterministic and not a model output**. The server inherits primary ownership,
order, source revision and continuous range from each validated contiguous learning-target unit run;
only title/meaning come from AI. Window results remain private and disposable. If any required window
fails, the Chapter attempt fails and **no** candidate becomes a published or user-visible partial map.

After every window has one valid final partition, the structural reviewer receives the **whole Chapter
map collectively as one complete compact ledger**, grouped by the real Section structure. The ledger
contains Section/unit order, complete partition accounting, candidate-to-unit membership,
title/meaning, bounded deterministic evidence excerpts/fingerprints, overlap/warning metadata and
required generation provenance. It does not resend the raw whole-Chapter OCR line stream, geometry
dump, generator prompt or reasoning. Review checks at least:

- independently trackable granularity and split/merge quality;
- coverage of the Chapter's major learnable content;
- semantic duplicates and unjustified near-duplicates;
- subject-specific instructional value rather than generic reasoning/test-taking labels;
- source faithfulness, range sufficiency and correct primary Section ownership;
- map-level balance across Sections.

All seven dimensions remain publication checks, but severity is calibrated. `BLOCKING` means the
ledger establishes a high-confidence defect that would make the Knowledge Map unpublishable:
duplicated learning state, non-instructional/fabricated KP, major learnable omission, clearly wrong
Section/source ownership, or a severe split/merge that creates meaningless independent states.
Alternative wording, optional consolidation, mild imbalance and judgments that bounded excerpts
cannot support confidently are warnings. The reviewer must scan the complete ledger before its
verdict; “could be improved” is not equivalent to “cannot be published.”

Every blocking semantic finding should identify an existing Section and the smallest relevant unit-
ID set so the failure is actionable. Review judges; it never rewrites. A valid Review FAIL is terminal
for this preparation attempt: publish nothing, discard the private candidate set, and invoke no
semantic repair, regeneration or re-review.

Bounded technical retry is semantics-neutral. A transient/empty/length-limited/invalid semantic
response may retry only the exact same window evidence and contract; no previous semantic result or
Review finding becomes input to a later judgment. A technical Review failure may retry only the exact
same compact ledger and Review contract. Successful unrelated windows are not replayed. Technical
failure never becomes PASS. Existing durable-job recovery and disposable-draft semantics remain;
this correction adds no generic checkpoint/workflow framework.

Overlap is supplied as a deterministic review/warning signal where present; it is not itself a
publication failure. Chapter-level Review, final deterministic validation and atomic publication
remain mandatory. The UI may expose only stage/progress metadata before publication — never titles,
meanings, ranges or any other partial candidate content.

The KP generator and structural reviewer are **internal pipeline roles, not user-facing Product
Agents** (§13.2) — an important boundary the Product Blueprint draws explicitly (§16).

### 12.3 Draft vs stable identity — `RECOMMENDED_FOR_DRAFT`

Draft KPs carry pipeline-local keys only. **Stable `knowledge_point_id`s are minted at publish, in one
transaction.** Nothing outside the pipeline can reference a draft. This makes a failed or abandoned
preparation garbage rather than debris, and makes "partial draft masquerading as READY" (§14)
structurally impossible.

For the first publication, every published KP is a new concept and receives a new opaque ID. An
eligible explicit replacement under §12.4a also mints a fresh opaque ID for every replacement KP;
old identities are never reconciled, reused, remapped or exposed as editable records.

### 12.4 Entity and deterministic validation

```
KnowledgePoint
  chapter_structure_version, book_source_revision_id
  primary_section_id      ← OutlineNode, NOT NULL, exactly one   (§12)
  title, one_sentence_definition, order_index
  start_page, start_y, end_page, end_y   ← continuous range      (§13)
```

Validation gates publication:

- every semantic window references only deterministic unit IDs supplied to it; its final
  `learning_targets` plus `non_kp_units` partition accounts for each supplied unit exactly once and
  contains no model-authored source/ownership fields;
- every learning target is backed by a non-empty contiguous unit run inside one semantic window and
  one existing primary Section; invented, duplicate, missing, multiply consumed, non-adjacent,
  cross-window or cross-Section unit references are invalid;
- `non_kp_units` do not materialize as KPs, while facet/property/step/example evidence included in a
  learning target may remain inside that target's continuous source span;
- every candidate's primary Section, source revision, order and continuous range are materialized
  from the server-side unit ledger rather than accepted from model output;
- every KP has exactly one primary section, and its range lies within that section;
- each range is continuous and monotonic;
- the complete Chapter result contains at least one materialized learning target; KP count and
  semantic granularity are not deterministic correctness quotas;
- excluded node kinds (exercises, answers) produced no KPs.

> **User-approved correction, 2026-09-07.** KP source ranges are evidence mappings, not a partition
> of Chapter text. Two independently trackable KPs may legitimately share source evidence, while
> connective prose may legitimately belong to no KP. Deterministic validation therefore requires
> neither zero overlap nor zero gaps. It emits overlap metadata for the Chapter-level structural
> reviewer, which judges whether the overlap signals a semantic duplicate, an unjustified split, or
> legitimate shared evidence. Exact duplicate candidate identity/semantic keys remain invalid;
> semantic near-duplicates remain a Review concern.

The compact Review ledger is also deterministic output. It must completely represent the final
window partitions and candidate membership while bounding evidence excerpts/fingerprints; it is not
a second generated document structure and cannot acquire source authority. Review findings should
resolve to the ledger's real Section/unit IDs for actionable diagnostics, but never authorize a
repair call or another semantic partition.

**Cross-section relations** (prerequisite, bridge, related) are a separate association table. They
never affect primary ownership, which is what mastery depends on (§12).

### 12.4a READY replacement boundary — `FROZEN_FROM_PRODUCT` (§15, decision 69)

Regeneration is an explicit whole-Chapter action and is allowed only when:

1. the Chapter has a current complete `READY` Map;
2. its irreversible `learning_state_ever` lock is absent; and
3. no other durable user asset references any current Chapter `knowledge_point_id`.

The same predicate is evaluated under a write transaction before the attempt starts and again in
the final publication transaction. The second check closes the race with the first learning-state or
other asset write. Failure of either check refuses replacement; a late failure records an attempt
failure while keeping the old Map current.

The normal §12.2 pipeline builds a complete private candidate. On success §17.6 inserts all new KPs
with fresh IDs, removes the dependency-free old set and switches the Chapter structure version in
one transaction. There is no same-concept reconciliation, ID reuse, migration, remap, compatibility
layer, history UI, single-KP edit or manual unlock.

### 12.5 Structural protection — `FROZEN_FROM_PRODUCT` (§15)

```
chapter_structure_permanently_locked := learning_state_ever_at IS NOT NULL
chapter_structure_temporarily_blocked := EXISTS(other durable user asset referencing a current KP)
```

The first persistent learning-state write must set `learning_state_ever_at` in the same transaction
as the learning write. The marker is monotonic and cannot be cleared or rewritten; resetting,
deleting or changing current state/history never unlocks the Chapter. `Annotation.knowledge_point_id`
(§16.1a) remains the direct bookkeeping reference for KP-linked annotations, and every future
KP-linked user-asset write must either participate in the permanent learning lock or remain visible
to the §12.4a dependency check.

- **Eligible** → only an explicit complete READY replacement may run; private candidates remain
  disposable and all published replacement IDs are new.
- **Permanently locked** or **currently dependency-blocked** → replacement is refused. No migration,
  remap, compatibility path, single-KP edit or manual unlock is available.

### 12.6 Concurrency and idempotency

Idempotency key: `(book_source_revision_id, foundation_version, chapter_node_id,
chapter_node.identity_revision, chapter_node.physical_revision)` — the Chapter node's own two
revision counters (§11.1), not a book-wide Outline version. A correction to a *different* Chapter
never changes this key, so it never invalidates or duplicates an in-flight or completed preparation
for this one. A second request for a chapter already `PREPARING` joins the existing job rather than
starting a second. An explicit replacement request likewise joins the current replacement attempt;
ordinary Prepare remains a READY no-op. Publication is a single transaction guarded by the current
attempt and §12.4a eligibility checks, so two racing workers cannot both publish.

---

## 13. Agent Runtime / Provider / Review

### 13.1 The four separations — `FROZEN_FROM_PRODUCT` (§34)

Four things are routinely conflated and must not be:

| Concept | Definition |
|---|---|
| **Product Agent** | A user-facing responsibility: System, Review, Master, Assistant |
| **Provider/model** | A vendor endpoint. Many-to-many with agents. |
| **Context** | An isolated assembled input. Never shared between roles. |
| **Worker** | The execution unit that performs the call |

One model may serve several agents; one agent may route to several models. Agent count and model
count are unrelated.

### 13.2 Roles

**User-facing Product Agents:** `SYSTEM` (teaching generation), `REVIEW` (independent verification),
`MASTER` (durable learning dialogue), `ASSISTANT` (temporary local explanation).

**Internal pipeline roles — not Product Agents:** `KP_GENERATOR`, `KP_STRUCTURAL_REVIEWER`,
`OUTLINE_CLASSIFIER`. They have no user-facing identity, no conversation, and no learning authority
(§16 of the Product Blueprint).

### 13.3 Context isolation

Each invocation builds a fresh context from declared inputs. **No conversation history crosses a role
boundary.** Concretely: the KP structural reviewer never sees the generator's reasoning; Master
context never leaks into Assistant; a review context never contains the generation context that
produced the candidate. Isolation is enforced by the context builder API — a role can only request
input kinds its profile declares.

### 13.4 Provider routing

```
route(role, mode, risk_signals) -> ProviderProfile{provider, model, params, token_budget}
```

Configuration-driven, not hard-coded. Requirements: independence — where the Product Blueprint prefers
a genuinely different reviewer (§16, §33.2), routing must be *able* to select a different provider,
and must record which it used; and graceful absence — a missing provider config disables the
capability, it does not crash the Reader.

### 13.5 Structured output

All non-conversational agent output is schema-validated. Invalid output is a **typed failure**, retried
a bounded number of times with the validation error fed back, then surfaced as a failure. It is never
coerced, never partially accepted, and never silently defaulted.

### 13.6 Grounding and multimodal — `FROZEN_FROM_PRODUCT` (§30.1)

Grounding rules cannot be switched off by any review setting. Every context carries its source
material with provenance, and every factual claim about the textbook must trace to supplied context.
Figures are supplied as an on-demand crop (§7.6) plus geometry, never as a bulk-extracted asset.

Fabrication of textbook quotes, printed page labels, figure identifiers, syllabus claims or exam
evidence is a **validation failure**, not a quality issue: claims are checked against supplied context
where deterministically checkable (page labels, figure identifiers, exam years all are).

**13.6a In-figure text is a lower trust tier [E].** The only recognition errors measurement found were
in **rotated in-figure labels** (`中断请求` → `中断清求`), and critically **the confidence scores did not
flag them** — 0.930–0.968, indistinguishable from correct body text. Two consequences:

- OCR lines whose geometry falls inside a detected `VisualRegion` are marked as such and carry a
  **lower trust tier**. They remain fully selectable and anchorable — geometry was not the problem —
  but they must not be treated as reliable text for grounding claims or semantic indexing.
- When an Agent needs to understand a figure, the correct input is the **on-demand crop** (§7.6) sent
  to a multimodal model, not the in-figure OCR text. This is what Product §10 already prescribes;
  measurement now supplies the reason.

Confidence score is therefore **not** a sufficient trust signal on its own. Region membership is the
additional signal.

### 13.7 Review invocation — `FROZEN_FROM_PRODUCT` (§30)

| Target | Policy |
|---|---|
| **System teaching assets** | Independent review **mandatory** before publication. No bypass. |
| **Master** | User-selectable Fast (default) / Standard / Deep. Risk signals may **raise**, never lower. |
| **Assistant** | Off by default; user-enablable ("Verified"); bounded automatic escalation on the risk conditions in §30.4 |
| **Saving AI wording as a durable note** | Verification required (§30.5) |

**Deterministic gates first.** Cheap mechanical checks (schema validity, references resolve, cited
page labels and figure identifiers exist, required coverage present) run *before* any reviewer model
call. A candidate failing them is rejected without spending a call.

**Review never touches mastery** (§30.6). A reviewer may accept an answer; only the user can change
learning state. These write to different contexts and there is no code path from review outcome to
learning state.

**Master answer execution is not Review.** The Composer selects a named answer provider/model and
`Quick` or `Deep` reasoning independently of Review strength. The durable user message records that
provider/model and reasoning-mode selection before egress, so retry/restart reuses the same execution
identity; migration 19 adds only `MasterMessage.reasoning_mode`, defaulting historical rows to
`Quick`. Review remains `Fast` by default and lives with the Topic's low-frequency actions; the
answer's reasoning mode never changes reviewer routing or Review semantics.

Master answer delivery uses SSE. The runtime exposes separate answer-delta and provider-reasoning-
delta callbacks. The UI renders returned reasoning in a distinct `正在思考` / `思考过程` surface and
never synthesizes it for a provider that emits none. Only the final grounded answer is persisted and
passed to Review; reasoning text is transient, is not a `MasterMessage` field, and is not replayed as
Topic history. A visible answer or reasoning delta makes automatic provider replay unsafe, while a
failure before any visible output may use the runtime's existing bounded retry policy. There is no
cross-provider fallback.

### 13.7a Semantic rework counter and terminal failure — `FROZEN_FROM_PRODUCT` (§33.2.1–§33.2.3)

Applies to `TeachingAsset` (§17.1), which carries the counter and the two blocking-outcome states this
section defines:

```
TeachingAsset.semantic_rework_count: int      # 0..3, increments on BLOCKING semantic FAIL only
```

incremented **only** when a semantic review pass returns a blocking finding — never by a technical
failure (§13.8) and never by exhausting a technical retry. Below the limit, a blocking result routes
back to `DRAFT` for another System attempt (§17.1's `REJECTED → DRAFT` edge). At
`semantic_rework_count == 3` with blocking issues still open, the asset transitions instead to
terminal `FAILED`, and no fourth attempt is scheduled — `FAILED` has no outgoing edge back to
`DRAFT`/`IN_REVIEW` in the state machine, so "just retry once more" is not a call the code can make
even if invoked incorrectly. `FAILED` never becomes `PUBLISHED`, is never served to the Reader as a
substitute for a real published version, and never replaces one (§13.7b).

Enforcing "Review judges, it does not author" (§33.2.3) is a process boundary: the semantic reviewer
receives the asset's current content and returns a verdict plus typed issues; it has no write path to
that content. A rewrite, if one happens, is a new System generation pass consuming the same counter.

### 13.7b Published-version safety — `FROZEN_FROM_PRODUCT` (§23.1)

```
Section.published_teaching[kind] -> TeachingAsset | None    # the one PUBLISHED version currently live
```

Regeneration creates a new `DRAFT` `TeachingAsset`; it never touches `published_teaching` until that
asset itself reaches `PUBLISHED`. If the new asset instead reaches `FAILED` (§13.7a) or the request is
abandoned mid-flight, `published_teaching[kind]` is untouched — the old published version was never
unset, so there is no window in which the Section has no published Guide because a regeneration
attempt happened to fail. The transition `published_teaching[kind] = asset` occurs in the same
transaction as `asset.state = PUBLISHED`, so a crash between "reviewed" and "published" cannot leave
neither version live.

### 13.8 Failures and retries

Provider errors are normalized into a small typed set separating **transient** (timeout, rate limit,
server error → bounded retry with backoff) from **user-actionable** (auth, quota, billing → stop, surface
clearly, no retry) from **content** (invalid structured output → bounded retry with feedback).

Retries are finite (§33.2). A repeatedly failing provider is short-circuited for a cooling period so a
dead provider degrades one capability instead of stalling every queued job. Exhausted retries produce
an explicit failure state — **never a PASS, never "no findings"** (AGENTS.md §5).

---

## 14. Assistant

> **Revised in the 2026-09-03 closure patch.** The prior draft modeled recursion as flat turns in one
> continuing context with a context-budget safeguard and no depth bound. `PRODUCT_BLUEPRINT.md`
> §24.4–§24.7 now froze an explicit Root/Child model with depth = 5, one-active-child, multi-Root
> coexistence, and an anti-bypass rule. This section is rewritten to realize that model. The
> **engineering shape stays deliberately light** — Root/Child is a logical relationship recorded on a
> small in-memory record, not a persisted tree, and the old flat-context design's genuinely good
> ideas (no persisted state, context-budget-aware summarization, cycle-guarded provenance) survive
> inside the new structure rather than being discarded.

### 14.1 Scope resolution — `FROZEN_FROM_PRODUCT` (§24.1)

```
current reading anchor → deepest containing SECTION node?
   ├─ yes → scope = SECTION:<outline_node_id>
   └─ no  → scope = PAGE:<pdf_page_index>        (temporary fallback)
```

Fallback scope never guesses a section, is isolated from section-scoped contexts, and is **never
auto-merged** into a section conversation later resolved — a rule that has to be enforced in code,
because merging is the "helpful" thing to do and would silently mix contexts. Scope is a property of
a **Root** (§14.3) — every Root within one Reader session resolves its own scope independently, which
is what makes multiple simultaneous Roots (§24.5) safe: a Root opened from Section 4.2 and a Root
opened from Section 4.3 never share context merely because both are open.

### 14.2 Lifetime — `RECOMMENDED_FOR_DRAFT`

**All Assistant state — every Root and its Child tree — lives in Core Service memory, keyed by
`reader_session_id`, and is never written to the database.**

Persisting temporary state and remembering to delete it is strictly worse than not persisting it: the
guarantee "closing the Reader clears unsaved Assistant conversation" (§24.3) becomes structural
rather than a cleanup job that can fail. Process restart clearing all Assistant state is *correct
behaviour* here, not data loss — nothing in §24 promises survival across a service restart, only
within one Reader/app lifetime (§24.5 item 10).

| Event | Effect |
|---|---|
| Assistant ↔ Master tab switch | **Nothing.** Every Root/Child context survives (§25). |
| Switching focus to a different Root, or to a Child's parent | **Nothing is destroyed.** Only focus moves (§24.5 items 2, 5). |
| Opening a new Root from a non-Assistant source | Adds a new Root; existing Roots are untouched (§24.5 item 3). |
| Explicit Close of a Root | Destroys that Root and its whole descendant Child tree (§24.5 item 6). Nothing else is affected. |
| Reader/app close | All Root/Child contexts clear (§24.3, §24.5 item 7). |
| **Save to Notes** | The only durable promotion path (§16.4) — copies content out; the source Root/Child context itself is untouched and still temporary. |

The UI holds only what it is currently rendering; the service holds every retained Root/Child context
regardless of which one has focus. On reload, the UI re-fetches the full set — so a UI crash does not
lose any Root, but closing the Reader does.

### 14.3 Root/Child structure — `FROZEN_FROM_PRODUCT` (§24.4, §24.5)

```
AssistantRoot
  root_id, reader_session_id, scope (§14.1)
  created_from: SelectionSource         (§14.5 — never ASSISTANT_ANSWER)
  children: AssistantNode[]             (depth 1 turns live directly on the Root)

AssistantNode                            (a Child — depth ≥ 2)
  node_id, parent_ref: (root_id, node_id?)   — parent is a Root or another Node
  depth: int                             (2..5)
  active: bool                           (§14.6 one-active-child)
  turns: AssistantTurn[]                 (same-level multi-turn, §14.4)
```

A **Root is depth 1**; its own same-level multi-turn conversation lives directly on it, with no
separate depth-1 "node." A **Child is depth = parent.depth + 1**, created only per §14.5's source
rule. The tree is small by construction — max depth 5, one active child per parent (§14.6) — so it is
kept as plain in-memory objects, not a database-backed graph; nothing in §24 requires it to survive a
process restart.

**Depth-6 is structurally unreachable, not merely checked.** Child creation is the only depth-increasing
operation, and it is exposed as one function that takes a depth-5 node and returns a typed
`ChildDepthLimitReached` result instead of a new node — there is no code path that constructs a
depth-6 `AssistantNode` at all. The user may keep multi-turning at depth 5 (§14.4) indefinitely.

### 14.4 Same-level multi-turn — `FROZEN_FROM_PRODUCT` (§24.4 item 2)

An ordinary follow-up ("为什么？", "还是没懂", "再简单点") appends an `AssistantTurn` to the *current*
Root or Node's `turns` array. **This never changes depth and never touches the tree shape** — it is
plain conversational state, and it is exactly what the prior draft's flat-context design already got
right. Same-level turns share the level's own accumulated history plus its inherited context
(§14.5); they do not re-fetch or re-derive anything from the parent.

### 14.5 Child creation and context construction — `FROZEN_FROM_PRODUCT` (§24.4, §24.6)

A Child is created **only** when the user selects a range inside the *current* Assistant answer at a
Root or Node and asks a new question of that selection:

```
create_child(parent: Root | Node, selection: TextRange, question) -> Node | ChildDepthLimitReached
```

Deterministic validation, before any generation call: parent is at depth < 5; the selection range is
valid within the parent's most recent answer turn; the parent currently has no other active child
(§14.6). Any failure returns a typed result — never a silent no-op and never a partial Child.

**Child context — exactly what §24.6 lists, nothing more:**

```
ChildContext = {
  selected_range: TextRange,
  triggering_turn: AssistantTurn,        # the COMPLETE parent turn containing selected_range
  source_lineage: SourceLineageRef,      # enough to know where the discussion originated
  reader_scope: ScopeRef | None,
  reference_context: ReferenceContext,   # minimal, explicitly assembled — never a history dump
  parent_ref, depth,
}
```

`triggering_turn` is the full answer turn, not just the selected substring — this is what lets a
three-character selection still carry enough surrounding meaning to answer correctly without pulling
in anything from earlier turns. The context builder does **not** walk the ancestor chain by default;
if a specific answer genuinely needs more ancestor material, the builder fetches it **explicitly and
selectively** from the named ancestor node, never as a blanket default.

### 14.6 One-active-child atomicity — `FROZEN_FROM_PRODUCT` (§24.4 items 5–6, §24.7)

"One active child per parent" is scoped to one parent node, not global (§24.7) — `Root A → Child A2`,
`Root B → Child B2`, and a childless `Root C` coexist without conflict.

Because all Assistant state is single-process in-memory (§14.2), the concurrency requirement reduces
to an ordinary compare-and-set on the parent's `active_child_ref` field under the process's existing
per-session lock — no database transaction or partial unique index is needed for this specifically
(contrast §12.6's chapter-publish CAS, which *does* need one because chapters are durable). Two
concurrent `create_child` calls on the same parent: exactly one wins and returns the new Node; the
other receives `ActiveChildAlreadyExists`, never a silently-dropped request and never two active
children.

If the user selects a *different* phrase from a parent that already has an active Child, the UI layer
decides the UX (return-and-replace, mark historical, or prompt) per §24.7 — the service only enforces
that at most one child is ever `active: true` at a time; it does not itself decide which UX applies.

### 14.7 Root creation and the anti-bypass rule — `FROZEN_FROM_PRODUCT` (§24.5 items 3–4, item 6)

```
SelectionSource.kind ∈ { ORIGINAL_PDF, READING_GUIDE, INLINE_GUIDANCE,
                         MASTER_ANSWER, ASSISTANT_ANSWER, READER_VISIBLE }
```

**Root creation and Child creation are separate operations gated on source kind, not on UI state:**

```
request_explanation(source: SelectionSource, ...) ->
    source.kind == ASSISTANT_ANSWER  → route to create_child() on the owning node (§14.5)
    otherwise                        → create_root() — always depth 1, always a NEW Root
```

This is what makes the anti-bypass rule (§24.5 item 6) structural rather than a UI convention: there
is no function that takes `ASSISTANT_ANSWER` content and produces a Root, at any depth, under any
circumstance — including at depth 5, where the temptation to "just open a fresh Root" is highest.
Selecting from a depth-5 answer can only reach `create_child`, which then correctly returns
`ChildDepthLimitReached` (§14.3).

`READER_VISIBLE` is the catch-all for other selectable Reader content (headings, recall-prompt text,
selectable control labels) so no enum gap ever blocks explaining something the UI already lets the
user select.

### 14.8 Multi-Root focus and retention — `FROZEN_FROM_PRODUCT` (§24.5)

```
ReaderAssistantState
  roots: AssistantRoot[]           # every retained Root this Reader session has created
  focused_ref: RootRef | NodeRef   # exactly one currently-focused location
```

Opening a new Root, switching to an existing Root, or navigating to a Node's parent all just reassign
`focused_ref` — **no context is created, copied, or destroyed by a focus change.** Only three operations
destroy state: explicit Close of a Root (removes that Root and its subtree from `roots`, and reassigns
focus elsewhere if it was focused); explicit Close of a Child subtree (removes that Child node and its
descendants only — never its parent, siblings or Root — returns focus to its parent and re-enables
Child creation there, aborting any pending request inside the subtree and discarding late completions
as typed cancellations); and Reader/app close (clears `roots` entirely). This is the mechanical reason
focus can never substitute for close (§24.5 item 10): they are different fields, touched by disjoint
operations.

> **Amended 2026-09-06 (user decision D1, Ask Deeper UAT rework).** The Child-subtree close was added
> as the third destructive operation, realizing Product §24.7's return-and-replace / mark-historical
> handling for a parent that already has a Child. No other lifetime rule changed; Product Blueprint
> §24.5 item 6 (Root close) is untouched.

The UI is handed the full `roots` list (for a Root/context switcher) plus `focused_ref` plus each
node's `depth` — enough to build a breadcrumb, a recent-context list, and a `3 / 5` depth indicator
without the service prescribing any specific layout (§24.5 item 8). Labels shown to the user are
derived from each Root/Node's originating selected text, never from internal identifiers — the
service exposes `root.created_from.selected_text_preview`, not "Root A" (§24.5 item 9).

### 14.9 Retry idempotency — `FROZEN_FROM_PRODUCT` (§24.4 item 8)

A technical retry (§13.8's transient class) on an in-flight Assistant turn reuses the same logical
turn identity — the same idempotency key used for the original attempt — rather than minting a new
turn. If the original attempt never committed a visible answer, retry overwrites that same pending
turn; it never produces two referenceable answer turns for one user question, and it never creates a
Child or changes depth as a side effect of retrying.

### 14.10 Provider failure — `FROZEN_FROM_PRODUCT` (§24.4 item 9)

A provider failure at any Root or Node is handled exactly per §13.8/§20 (typed failure, user-facing
message, no durable side effect) **plus one Assistant-specific guarantee**: it never writes
`KPStatus`, never appends a `LearningEvent`, never creates or touches a `MasterThread`, and never
changes `depth` — regardless of how many times it has failed or been retried at that level.

### 14.11 Explanation sources and grounding — `FROZEN_FROM_PRODUCT` (§24.2, §30.1)

Any selectable content may be explained, including content the Assistant itself just produced — this
is what makes recursion (§14.5) meaningful rather than merely permitted. Grounding carries through the
chain: an explanation of an explanation must still trace to original source material via
`source_lineage` (§14.5), and where a chain has drifted far enough that it no longer grounds in the
book, the answer says so — the §30.4 condition that escalates Assistant to verification.

Recursive context can grow across many Child levels even though depth is capped at 5; the context
builder still applies a budget and summarizes rather than silently truncating mid-thought when a
single level's own accumulated multi-turn history (§14.4) is long — the flat-context draft's original
safeguard, now scoped to one level's history instead of an entire unbounded chain.

**The trap this avoids:** recursive explanation produces conversation-shaped data that looks like
learning history. It is not, and it never enters the Learning context (§15) — not through same-level
multi-turn (§14.4), not through Child creation (§14.5), and not through a provider failure (§14.10).
Only an explicit Save-to-Notes crosses that boundary, and it creates a **Note** (§16.4), not a
learning event.

---

## 15. Master / Learning State

> **Extended in the 2026-09-03 closure patch** with `MasterTopic` (§15.5) and the evidence gate that
> authorizes Master-driven `KPStatus` writes (§15.6) — `PRODUCT_BLUEPRINT.md` §26.1–§26.3. These are
> additive to the existing entities and rules below; nothing here is superseded.

### 15.1 Entities

```
ReadingPosition      book_source_revision_id, pdf_page_index, y, updated_at
KPStatus             knowledge_point_id, status, evidence_source, first_understood_at, updated_at
SectionLearningState outline_node_id (SECTION), reading_reached_end_at, mastery_check_state
LearningEvent        APPEND-ONLY history
MasterThread         scope: KP | SECTION, durable
MasterMessage        thread ref, role, content, created_at
MasterTopic          thread ref, state, evidence — see §15.5
```

**`ReadingPosition` references only the book revision and page geometry** — no AI artifact, no KP, no
teaching asset (§35). This is why reading survives every regeneration and every failure.

### 15.2 Reading readiness vs mastery readiness — `FROZEN_FROM_PRODUCT` (§19.1)

The race — a user finishing a section before its chapter map is READY — is represented with **two
independent axes on `SectionLearningState`**, not one enum:

```
reading_reached_end_at : timestamp | null     ← set by the Reader. Never depends on KP structure.
mastery_check_state    : NOT_APPLICABLE_YET       (chapter not READY)
                       | AVAILABLE                (chapter READY; check offerable)
                       | ANSWERED_CLEAR
                       | ANSWERED_HAS_UNCLEAR
```

Two axes rather than one because the alternative forces a single state to encode both "how far the
user read" and "what the system can offer" — which is precisely the conflation the Product Blueprint
forbids.

**While the chapter is not READY:**

- the PDF reads normally; reading position persists;
- Assistant is available per its own readiness (§14), Notes and Highlights per theirs (§16);
- the user finishes the section freely — no block, no modal, no interruption;
- the UI surfaces `本节学习结构仍在准备 / ✓ 阅读位置已记录`;
- **no temporary or placeholder KPs are fabricated;**
- **no mastery is inferred against a KP set that does not exist;**
- **scrolling past, or reaching the end, is not understanding** (§28.3).

Section state is therefore conceptually *read, mastery-confirmation pending* — expressed as
`reading_reached_end_at != null ∧ mastery_check_state = NOT_APPLICABLE_YET`, surfaced as
`已阅读 · 待确认`. The enum name is not frozen; the two-axis separation is.

**When the chapter becomes READY**, publication (§12.2) transitions affected sections from
`NOT_APPLICABLE_YET` to `AVAILABLE`. It is a **pure transition — it writes no mastery**. The user may
return and confirm later, including for sections already left. Nothing is inferred retroactively; an
unanswered check simply stays unanswered.

### 15.3 Learning-check semantics — `FROZEN_FROM_PRODUCT` (§28)

**「都清楚了」** →
- every KP whose `primary_section_id` is this section becomes `UNDERSTOOD`;
- any current section-level unresolved state is resolved;
- a `SECTION_CHECK_CLEAR` event is appended;
- **prior unresolved events remain in history** (§29). Current status is mutable; history is not.

**「还有些地方不完全清楚」** →
- a section-level unresolved state and event are recorded;
- section-scoped Master opens;
- **no KP is set negative.** Bulk-negative inference is explicitly forbidden;
- a KP becomes `NOT_FULLY_CLEAR` **only** when actual evidence — a user statement, a Master exchange
  identifying it — links the difficulty to that KP;
- if the user opens Master and leaves without explaining, KPs remain `UNCONFIRMED` and the section
  unresolved state remains visible.

**No answer** → reading position advances; mastery stays `UNCONFIRMED`.

### 15.4 History as the source of truth — `RECOMMENDED_FOR_DRAFT`

`LearningEvent` is append-only and is the authoritative record. `KPStatus` and
`SectionLearningState.mastery_check_state` are **current-state projections** maintained transactionally
alongside event insertion.

Both are stored rather than derived on read: the projection is queried on every page turn, and event
replay for a long history would be wasteful. But the event log remains the arbiter — a projection
inconsistency is repairable by replay. The first such write also permanently freezes its Chapter
structure under §12.5; replay, reset or deletion never authorizes replacement.

This is also what lets a learner become unclear again later without erasing the earlier resolution
(§29): status changes; history accretes.

### 15.5 Master Topic lifecycle — `FROZEN_FROM_PRODUCT` (§26.1)

```
MasterTopic
  topic_id, thread_ref UNIQUE
  state: ACTIVE | RESOLVED
  frozen_basis_ref: TurnRange | None    # set when finalization begins; immutable once set
  resolved_by: EXPLICIT_USER_EVIDENCE | FUTURE_ASSESSMENT_RULE | None
```

A Topic is the durable learning focus and `MasterMessage` cluster for one MasterThread — distinct
from a single answer, a `KPStatus` write, and whatever long-term summary eventually gets attached to
it. One `MasterThread` owns exactly one durable Topic: lookup/open/send includes both ACTIVE and
RESOLVED state, and a unique `thread_ref` constraint makes a second Topic structurally unavailable.
Reopen, revisit, restart and ordinary continued questions reuse the same `topic_id`. Ordinary Send
appends a message but changes neither Topic state nor Mastery.

`ACTIVE → RESOLVED` fires **only** on explicit understood evidence or a future formally-authorized
assessment rule. A separately authorized explicit unresolved-evidence action may perform
`RESOLVED → ACTIVE` on the same identity; the associated KP/Section projection changes only if its
own evidence rule authorizes that write. Closing the Master panel, Reader, app, switching tabs or
ordinary continuation touches neither state nor identity.

**Finalization race.** When a Topic begins finalizing (condensation/summarization),
`frozen_basis_ref` is set once and never mutated, so that work reasons only about the turns present at
that instant. Later messages still append to the same Topic outside that frozen basis; they do not
rewrite the in-flight result, mint a continuation identity or independently change Mastery.

### 15.6 Evidence-gated mastery authority — `FROZEN_FROM_PRODUCT` (§26.2)

```
master_may_mark_understood(topic: MasterTopic, kp_id) -> bool
```

returns `true` only when **all** hold: `topic.resolved_by == EXPLICIT_USER_EVIDENCE` (or the future
assessment rule); the topic's evidence names `kp_id` specifically, not merely "the section"; and no
currently-open sibling issue on the same topic contradicts "fully resolved" for that KP. Answering a
question is never by itself in this set — there is no path from "Master replied" to `true`.

A KP that reaches `UNDERSTOOD` through this gate is **never automatically downgraded** by a later
unrelated Topic — `KPStatus` writes triggered by this gate are one-directional (may set `UNDERSTOOD`,
may set `NOT_FULLY_CLEAR` on a *different*, evidenced KP) and no code path lowers an already-
`UNDERSTOOD` KP without a separately designed, explicit downgrade feature that does not exist in V1.

This gate is independent of, and additive to, the Section-level bulk mechanism in §15.3 — `都清楚了` /
`还有些不清楚` operate on the Section's owned KPs directly; this gate operates per-KP from genuine Master
evidence. Both write the same `KPStatus`/`LearningEvent` entities; neither bypasses the other's
constraints.

### 15.7 Structured summary is additive, never destructive — `FROZEN_FROM_PRODUCT` (§26.2)

A Topic's structured summary/condensation is stored **alongside** its full message history, never in
place of it. Deleting or compacting raw turns to save space is not performed in V1 — condensation is a
derived, regenerable convenience for retrieval and future context-building; `LearningEvent` and the
underlying `MasterMessage` history remain the durable record (§15.4).

### 15.8 Master threads

Durable, scoped to a KP or a Section, surviving app restart (§26) — the deliberate opposite of
Assistant. Master may keep structured summaries alongside the visible thread so later reasoning need
not replay every raw token (§26). Summaries are derived and regenerable; the thread is durable.

**Recall / Active Retrieval never changes mastery** (§32). Whether the user answers, skips, or answers
wrongly, no automatic state change occurs. There is deliberately no code path from a recall response
to `KPStatus`.

---

## 16. Notes / Highlights

### 16.1 Anchor model — `FROZEN_FROM_PRODUCT` (§8)

```
Annotation
  book_source_revision_id, pdf_page_index
  kind: TEXT | REGION
  quads (normalized)                    ← durable display anchor
  quote (text), context_before, context_after   ← semantic fingerprint
  foundation_version_at_creation
  body (user note text, nullable), highlight_style
  source_kind: USER | AI_SAVED
  verification_state (AI_SAVED only)
  anchor_state: OK | NEEDS_REVIEW
  knowledge_point_id: nullable      # bookkeeping only — see 16.1a
```

Two anchors with different jobs: **geometry is the display authority** — the PDF page does not move,
so a highlight always renders; **quote + context is the semantic fingerprint** — used to re-locate the
annotation's *meaning* after the machine layer changes.

**No OCR identifier is durable authority.** Line ordinals and cell indices are runtime conveniences
resolved at render time. This is what lets the whole OCR layer be regenerated without touching a
single user annotation.

### 16.1a Optional KP association is bookkeeping, never authority — `FROZEN_FROM_PRODUCT` (§8.1)

`knowledge_point_id` is set, when applicable, purely so Chapter-structure protection (§12.5) can
answer "does this Chapter have a durable KP-linked asset" without scanning annotation *content*.
Nothing reads it to render, re-anchor, or validate an annotation — `quads` + `quote` +
`context_before`/`context_after` remain fully sufficient on their own (§16.3). While populated, the
field blocks READY Chapter replacement. If absent, the annotation renders exactly as it would with
the field populated; no migration or remap is inferred from this bookkeeping field.

### 16.2 Region notes

`kind = REGION` with a normalized bbox, optional caption reference and context. Same durability
properties, no text fingerprint.

### 16.3 Behaviour across foundation change — `FROZEN_FROM_PRODUCT` (§8, §7.1)

| Event | Behaviour |
|---|---|
| Text correction (geometry unchanged) | Highlights render unchanged. Fingerprints refreshed opportunistically. |
| Reprocessing (geometry moves) | Re-resolve by fingerprint. **High confidence** → update the line reference, keep quads. **Low confidence** → keep original geometry, set `NEEDS_REVIEW`, tell the user. |
| Cannot re-resolve at all | Keep geometry, mark `NEEDS_REVIEW`. **Never silently move a user's note to a guessed location.** |

A `NEEDS_REVIEW` annotation still renders. Degraded semantics never means an invisible note.

### 16.3a Round-trip evidence, and the one thing it does not prove **[E]**

The anchor model was exercised end-to-end: six selections persisted as **`pdf_page_index` + normalized
box + quote + 12-character prefix/suffix, with no OCR identifiers of any kind**, then re-resolved
against a fresh OCR pass. **6/6 recovered, IoU 0.9993–0.9997, correct containing line in all six.**
Redrawn purely from persisted data, highlights landed exactly on mid-paragraph targets including
`9600b/s` and `0.0005%`.

That validates §16.1's central claim — geometry plus fingerprint is sufficient, OCR identifiers are
not needed — and it validates it *against the actual selection machinery*, not in theory.

**What it does not prove.** The re-run used the **same engine version**, so it demonstrates determinism
and quote-based re-resolution, not survival across an engine or model upgrade. §19.4's reprocessing
path — the expensive branch where geometry genuinely moves — remains **unvalidated**.

This is the single largest residual risk in the architecture, because it sits under a durable-user-asset
guarantee. Three responses, all cheap:

1. **Make the §23 round-trip test cross-version**, not same-version. Two engine versions or two model
   variants; assert re-resolution or an explicit `NEEDS_REVIEW`, never a silent move.
2. **Treat reprocessing as a gated operation.** Re-OCR of a book with existing annotations reports how
   many anchors resolved confidently *before* committing, and is user-confirmed.
3. **Failure mode is already safe by construction** (§16.3): unresolvable means keep original geometry
   and flag, never guess. The risk is annotation *semantics* drifting, never annotation *loss*.

### 16.4 Assistant → Note promotion — `FROZEN_FROM_PRODUCT` (§30.5)

Save-to-Notes creates a durable `Annotation` with `source_kind = AI_SAVED`. AI-authored wording is
verified before being treated as trusted durable content. **The user's selection and anchor are their
own asset regardless of verification outcome** — a failed verification annotates the wording, it never
discards the user's note.

### 16.5 Teaching-layer independence

Annotations reference the book revision and geometry, never a Guide version. A Guide may be
regenerated, superseded or deleted with no effect on any annotation (§3.3). Guidance anchors are a
separate concern (§17.3) and are *not* annotations.

---

## 17. Section Teaching

### 17.1 Entity and lifecycle

```
TeachingAsset
  section_node_id, kind: READING_GUIDE | INLINE_GUIDANCE | RECALL_PROMPT
  version, state, content (structured)
  dependency_set (see 19.2), skill_version, provider_metadata
  semantic_rework_count: int         # 0..3 — see §13.7a
  created_at, published_at
```

```
DRAFT → IN_REVIEW ─┬→ PUBLISHED
                    ├→ REJECTED  (blocking, rework_count < 3) → back to DRAFT
                    └→ FAILED    (blocking, rework_count == 3) — terminal, see §13.7a

PUBLISHED → STALE (dependency changed) → user may regenerate
```

**Only `PUBLISHED` is ever shown** as accepted teaching (§30.2). `FAILED` is never shown as a
substitute — see §13.7a/§13.7b for what the Section sees instead. Generation scope is one section,
maximum (§17) — never adjacent sections merely because they exist.

For Reading Guide only, a user-approved transient preview may show the actual Writer SSE stream
before publication. The UI labels it `生成草稿 · 尚未发布` and, during Review, `生成草稿 · 审查中`.
The preview and its structured candidate live only in the Core Service process; `content_json`
remains `NULL` until the Review-PASS publication transaction writes content and advances the
`section_guides` pointer together. The preview is excluded from Assistant selection and source
authority. Failure clears it. If the process restarts before publication, generation restarts from
the durable job/dependency state rather than recovering or exposing candidate prose. Provider
streaming reports real deltas and real TTFT; it must never simulate typing.

Guide evidence egress removes deterministically recognized page furniture, exercises, answers and
exam sidebars before source binding. Initial source binding is local and deterministic over the
unchanged Writer draft and existing server-owned source IDs. Review receives the candidate plus the
fresh evidence actually cited by it; targeted semantic rework receives only Review/current-module
source IDs. These projections do not mint or remap source identity, weaken the Review rubric, or add
RAG/vector retrieval.

### 17.2 KP dependence — `FROZEN_FROM_PRODUCT` (§17.1)

A crucial asymmetry that must not be flattened:

| Artifact | Needs chapter READY? |
|---|---|
| Reading Guide | **No.** Generated from section content, outline range, exam evidence. |
| General line/figure/table Guidance | **No**, provided it claims no KP semantics. |
| KP-transition bridges, KP-boundary interventions | **Yes.** |

An artifact declares only the dependencies it actually used (§19.2). A Reading Guide produced before
the chapter map exists **must not record a `chapter_structure_version`** — recording a dependency it
never used would make it spuriously stale later.

The implementation must not invent KP semantics while chapter preparation is pending.

### 17.3 Guidance anchoring — `FROZEN_FROM_PRODUCT` (§22.1)

> **AI decides teaching location; deterministic UI decides visual placement.**

The model emits a *semantic target* (a line reference, heading, or region) plus a placement intent
(`AFTER`, `BESIDE`, …). It never emits coordinates. The resolver converts the target to durable
anchor authority — `pdf_page_index`, normalized geometry, quote fingerprint, foundation version — and
the Reader chooses the final margin position from the live viewport.

If a target cannot be resolved confidently, **the guidance is omitted rather than placed by guess**
(§22.3).

### 17.4 Regeneration — `FROZEN_FROM_PRODUCT` (§23, §35)

Regeneration creates a **new version**; the previous published version remains until the new one
passes review. No silent overwrite, no silent remap. A stale Guide stays usable and offers an update,
unless it is no longer safely anchorable.

### 17.5 Section failure isolation — `FROZEN_FROM_PRODUCT` (§17.2)

One Section's `TeachingAsset` reaching `FAILED` (§13.7a) has no effect on any other Section's assets —
each Section's generation/review/publish cycle is its own state machine instance with no shared
mutable state across Sections. This is the same isolation principle §12.1 already applies at the
Chapter level (one Chapter's `FAILED` state doesn't touch its siblings), one level down. A Section
whose Teaching is `FAILED` simply has no `published_teaching[kind]` for that kind — the original PDF,
notes, highlights, and any other already-published teaching for that Section are untouched (§20).

### 17.6 Chapter Knowledge Map publishes atomically — `FROZEN_FROM_PRODUCT` (§14.1)

A Chapter's KP set, ranges, and structure version are written in **one transaction** at publish time
(§12.2's "atomic publish" step, §12.3's stable-IDs-at-publish rule). There is no intermediate state in
which some of a Chapter's KPs are visible as `READY` while others are not — `chapter.status` reads
`READY` only after every KP row for that `chapter_structure_version` has committed, and `PREPARING`
otherwise. A Chapter that fails validation (§12.4) never transitions to `READY`; it either stays at its
previous `READY` version (if one existed) or moves to `FAILED` (§12.1) — never a partial `READY`.

---

## 18. Background Jobs

### 18.1 Is a durable queue justified? — `RECOMMENDED_FOR_DRAFT`: **yes, minimally**

Preparing a full book is hours of work that must survive restart, be prioritizable by what the user is
reading, and fail per page rather than per book (§4.2). In-memory scheduling cannot do that. But a
single-user local application needs **a table and a worker pool, not distributed infrastructure** — no
broker, no external queue service, no multi-host coordination.

### 18.2 Job types

| Type | Granularity | Idempotency key |
|---|---|---|
| `PAGE_PREPARE` | bounded page batch | revision + page range + foundation_version |
| `OUTLINE_BUILD` | book revision — logical bootstrap only (§11.2 Pass 1) | revision + foundation_version |
| `PAGE_LABEL_INFER` | book revision | revision + foundation_version |
| `CHAPTER_PREPARE` | one chapter | revision + foundation + chapter node's own `identity_revision`/`physical_revision` (§12.6) |
| `TEACHING_GENERATE` | one section, one kind | section + kind + dependency set |
| `TEACHING_REVIEW` | one teaching asset version | asset version |
| `REPROCESS` | book revision or page range | revision + target engine profile |

**`OUTLINE_BUILD` is deliberately narrow.** It runs once, early, and performs only §11.2's Pass 1 —
parsing bookmarks/TOC into the logical tree. It is not the job that resolves physical ranges and does
not gate on body OCR. Pass 2 (progressive resolution) is a side effect of `PAGE_PREPARE`: whenever a
prepared page's OCR/layout output confirms a heading in place, that page's job step updates the
relevant `OutlineNode`'s range fields and `resolution_state` directly — no separate job type or queue
entry is needed for it, since it rides on work that is already happening per page.

### 18.3 Scheduling and progress

**Priority, not FIFO.** The page the user is looking at outranks page 400 of a book they opened last
week: `visible pages > pages near the reading position > TOC/outline pages > everything else`.
Re-prioritization on navigation is what makes progressive preparation feel responsive rather than
merely eventual (§4.2).

Batch size for `PAGE_PREPARE` trades checkpoint overhead against progress granularity and is a tuning
parameter, not an architectural constant — it is set from the measured per-page cost (§8.8 item 2).

**Progress is derived from `OCRPage.status`, never duplicated into a counter.** One source of truth;
a crashed job cannot leave a lying progress bar.

### 18.4 Concurrency, recovery, cancellation

Claim by conditional update (`QUEUED → RUNNING` guarded by current status), which is exactly what
SQLite's single-writer model handles well. Worker pool size is small and configurable; default
conservative, since OCR is CPU-hungry and must not make the machine unpleasant to use.

On startup, `RUNNING` jobs are requeued — safe because every job is idempotent at its granularity and
already-completed pages are skipped. Cancellation is cooperative: a flag checked between units, so a
cancelled book-preparation stops within one batch.

**Failure isolation is the point:** a page that fails OCR marks *that page* `FAILED` and the job
continues. A book is never failed by one bad page.

### 18.5 Why there is no separate checkpoint store **[E]**

Reconciliation examined a mature legacy task substrate offering durable lifecycle, single-winner
claim, idempotency keys, startup reconciliation, owner-scoped cancellation, and an opaque
**checkpoint store** with sha256 payload integrity, schema-version gating and corrupt-newest
fallback. That checkpoint machinery is genuinely well-built.

**This architecture does not need it, and that is an architectural result rather than a rejection.**

Every job type here resumes from **durable domain state**, not from an opaque payload:

| Job | Resume mechanism |
|---|---|
| `PAGE_PREPARE` | Skip pages already `READY` — `OCRPage.status` *is* the checkpoint (§5.4) |
| `CHAPTER_PREPARE` | Restart. Drafts are pipeline-local with no stable IDs (§12.3), so an interrupted run is garbage, not debris. |
| `TEACHING_GENERATE` / `_REVIEW` | Restart. Scope is one section; cost is one generation. |
| `OUTLINE_BUILD`, `PAGE_LABEL_INFER` | Restart. Whole-book but cheap, and idempotent. |

Two independent decisions caused this: **per-page commit** (§5.4) and **stable IDs minted only at
publish** (§12.3). Together they mean no job carries valuable intermediate state that is expensive to
recompute and not already durable.

The legacy design needed checkpoints because its parsing tasks were *not* idempotent — which also
explains its two-step recovery (`RUNNING → RECOVERABLE_TECHNICAL_STOP → requeue`, gated on a valid
checkpoint). This architecture recovers in one step (`RUNNING → QUEUED`) precisely because its jobs
are idempotent at their granularity.

**Consequence for reuse:** the highest-rated capability in the legacy audit is largely inapplicable
here — not because it is poor, but because the architecture removed the problem it solved. What
remains valuable is its **tests** (§30), which encode concurrency properties this design still must
satisfy.

If a future job type genuinely needs opaque resumable state, the corrupt-newest-fallback validation
pattern is worth revisiting then. Nothing in V1 needs it.

### 18.6 What must not be built

No cross-process message bus, no external broker, no distributed locks, no cron-like scheduler, no
generic workflow engine. If a future need genuinely demands them, the job table is a clean seam to
replace — but building them now would be infrastructure for a load that does not exist.

---

## 19. Versioning / Staleness

### 19.1 The version vector

| Version | Scope | Increments when |
|---|---|---|
| `book_source_revision_id` | Book | PDF bytes differ (§6.2) |
| `foundation_version` | Book revision, **ordering only** — see §19.2a | OCR/layout corrected or reprocessed (§8.7) |
| `identity_revision` | **Per Outline node**, not book-wide — see §19.2b | That node's structural identity corrected (§11.4) |
| `physical_revision` | **Per Outline node**, not book-wide — see §19.2b | That node's own range changes (§11.4) |
| `chapter_structure_version` | Chapter | Chapter map republished (§12) |
| `skill_version` | Global | A generation/review skill definition changes |
| `provider_metadata` | Per artifact | Recorded, **not** a staleness trigger by default |

### 19.2 Artifact-specific dependency declaration — `FROZEN_FROM_PRODUCT` (§23)

Every generated artifact stores **the dependency set it actually used**, and nothing more:

```
dependency_set = { book_source_revision_id, foundation_version,
                   outline_nodes_used: [(outline_node_id, identity_revision, physical_revision)]?,
                   chapter_structure_version?, skill_version }
```

`outline_nodes_used` names the **specific nodes** an artifact consumed — a Reading Guide for Section
4.2 declares node `4.2`'s two revisions, not a book-wide value (§19.2b).

**An artifact becomes stale only if a dependency it declared changed.** Global invalidation is
forbidden — it would make every correction anywhere destroy teaching content everywhere, which is
exactly the behaviour that makes a system feel hostile to improve.

Provider metadata is recorded for debugging and attribution but does not trigger staleness: a model
version bump must not invalidate a library of perfectly good guides.

### 19.2a Foundation staleness is footprint-scoped, not counter-scoped — `FROZEN_FROM_PRODUCT` (§7.1.1) **[closes ZCode P1-3]**

> **Revision note.** Declaring `foundation_version` as a dependency (§19.2) is necessary but not
> sufficient if the version itself is one whole-book counter: every artifact using *any* page would
> then go stale on *every* correction anywhere in the book, regardless of declaration. §19.1's
> `foundation_version` is retained only as a **monotonic ordering value** (which correction happened
> after which); it is never compared directly for staleness.

Staleness comparison instead runs against a **per-page/region correction log**:

```
FoundationEvent
  book_source_revision_id, event_type: TEXT_CORRECTION | REPROCESS
  affected_pages: PageRange           # the actual footprint touched
  foundation_version                  # ordering only
```

```
is_stale(artifact) :=
    EXISTS FoundationEvent e WHERE
      e.foundation_version > artifact.foundation_version_used
      AND e.affected_pages ∩ artifact.page_footprint_used ≠ ∅
```

An artifact's `page_footprint_used` is derived from what it actually consumed (a Section's physical
range for Teaching, a KP's continuous range for Knowledge, a single page for an annotation). A
`TEXT_CORRECTION` on page 40 marks stale only artifacts whose footprint includes page 40 — a
whole-book Teaching summary that happens to declare `foundation_version` as a dependency but never
touched page 40 is **not** affected. `REPROCESS` events are recorded the same way but, per §19.4, are
treated more conservatively downstream (geometry may have moved, so dependents in the affected range
need re-resolution, not just a staleness flag).

A Chapter Knowledge Map that is currently `READY` and structure-locked (§12.5) is evaluated by this
same rule: a correction outside its Chapter's page range never touches its `READY` state; a correction
inside it is recorded but does not retroactively unpublish the Chapter — it surfaces as `STALE`
(§19.3) alongside the existing structure-lock protection, never as a silent revert to `NOT_PREPARED`.

### 19.2b Outline staleness is node-scoped, not book-scoped — `FROZEN_FROM_PRODUCT` (§9.5, decision 68) **[closes ZCode P1-5]**

> **Revision note.** The prior draft's book-level `outline_version` (§19.1, now removed from that
> table) was exactly the counter-scoped mistake §19.2a already diagnosed for the OCR foundation, just
> for the Outline instead: if every artifact that used *any* Outline node declared one book-wide
> `outline_version`, then Chapter 8's range resolving — an ordinary, expected, harmless event — would
> stale Chapter 1's Reading Guide. That was flagged as ZCode P1-5. §11.1's two **per-node** revision
> counters (`identity_revision`, `physical_revision`) remove the shared counter that made it possible.

```
is_outline_stale(artifact) :=
    EXISTS (node_id, id_rev, phys_rev) IN artifact.outline_nodes_used WHERE
      current(node_id).identity_revision > id_rev
      OR current(node_id).physical_revision > phys_rev
```

This is evaluated per declared node, not per book. A Reading Guide for Section 4.2 that declares only
`(4.2, id_rev=1, phys_rev=3)` is checked **only** against node `4.2`'s current revisions:

- Chapter 8's physical ranges resolving → does not appear in the check at all → **not stale**.
- Chapter 9's body OCR finishing → same → **not stale**.
- An unrelated TOC node's title being corrected (a `COSMETIC` correction, §11.4, no revision bump) →
  **not stale**, and would not have mattered even if declared.
- Node 4.2's own `physical_revision` advancing past 3 (its range materially changed) → **stale**,
  correctly.
- Node 4.2's own `identity_revision` advancing (a structural-identity correction touched it) →
  **stale**, correctly, and per §11.4 this case already carries stronger protection if a durable
  asset depends on it.

**P1-5 is closed by construction, not by a special-case rule.** There is no code path by which one
node's revision counter can affect the staleness evaluation of an artifact that never declared that
node — the per-node scoping in §11.1 makes the failure mode structurally unreachable, exactly as
§14.7 makes the Assistant depth-bypass unreachable rather than merely checked.

### 19.3 Asset states

| State | Meaning | Behaviour |
|---|---|---|
| `VALID` | Dependencies current | Normal |
| `STALE` | A declared dependency moved | **Still shown and usable.** Update offered. Never auto-rewritten. |
| `DEGRADED` | Some anchors unresolvable | Shown; unresolved parts suppressed and flagged |
| `UNAVAILABLE` | Cannot be rendered safely | Hidden with an explanation and a regenerate path |

Progression is monotonic per event and never skips silently to `UNAVAILABLE` — the user is told before
content disappears.

### 19.4 Text correction vs reprocessing, again

Worth restating because it determines the blast radius: **text corrections leave geometry intact**, so
annotations and guidance anchors survive; **reprocessing moves geometry**, so anchors must be
re-resolved (§16.3). Treating these as one event would make every typo fix as expensive as an engine
change, and the product would stop being correctable in practice.

### 19.5 Migration discipline

Additive-first. A migration touching durable user assets requires: a forward migration, a verified
backup, and an explicit user-visible statement of what changes. Destructive changes to published
chapter structure remain blocked by §12.5 regardless of migration capability.

---

## 20. Failure / Degradation Matrix

**Governing rule (§2, §13):** original PDF availability dominates. No AI or machine-layer failure
removes textbook content from the Reader.

| Failure | Still works | Unavailable | Retry | User data at risk |
|---|---|---|---|---|
| **PDF intake fails** | Everything else; other books | This book | Re-import; clear reason (encrypted, corrupt, too large) | No — nothing was committed |
| **Page OCR fails** | PDF renders; navigation; all other pages | Selection/copy/highlight/Assistant **on that page** | Per-page retry; other pages unaffected | No |
| **Layout detection fails** | Everything incl. OCR text | Figure/table geometry → figure-aware guidance, region crops from detection | Retry; optional capability | No |
| **Printed-page inference fails** | Everything | Printed labels → citations use `pdf_page_index` | Retry; manual override | No |
| **Outline build fails** | PDF, OCR, selection, notes, page navigation | Structural navigation; section scope → Assistant uses page fallback (§14.1); chapter prep blocked | Retry; manual outline correction | No |
| **Chapter KP prep fails** | PDF, OCR, notes, Assistant, reading position, non-KP guides | KP progress, Master KP scope, Section Learning Check → `NOT_APPLICABLE_YET` (§15.2) | Explicit retry; **isolated to that chapter** | No |
| **Guide generation fails** | Everything incl. reading and Assistant | That guide only | Retry; section reads fine without it | No |
| **Review fails / unavailable** | Everything; existing published assets | **Publication of new teaching assets** (§30.2) | Retry. **Never auto-PASS** (AGENTS.md §5) | No |
| **Assistant provider fails** | PDF, selection, notes, Master, everything local | Assistant answers | Retry; typed message distinguishing transient from auth/quota | No — temporary state only |
| **Master provider fails** | Reading, notes, existing threads and history | New Master turns | Retry; **thread and history intact** | No |
| **Note remap uncertain** | Note renders at original geometry | Confident semantic re-anchoring | `NEEDS_REVIEW`; user confirms or repositions | **No — never moved on a guess** (§16.3) |
| **Job worker crash** | Reading; committed pages | In-flight batch | Requeued at startup; idempotent | No — commit is per page |
| **Database corruption** | — | Everything | Restore from backup | **Yes** — the one genuine risk; §21.4 |
| **Crop/model cache lost** | Everything | Nothing | Regenerated on demand | No — derived by design |

---

## 21. Security / Privacy

Personal local product. Proportionate measures, no enterprise theatre.

### 21.1 Filesystem

All managed paths resolve through **one containment helper** that rejects traversal and absolute
escapes; no other code joins paths into managed storage. Blob writes are atomic (temp + fsync +
rename) so a crash cannot leave a half-written PDF that hashes wrong. Import reads user paths; the
app never writes outside its own data directory and explicit user-chosen export targets.

### 21.2 Credentials — `RECOMMENDED_FOR_DRAFT`

Provider API keys go in the **OS credential store** (Windows Credential Manager / macOS Keychain /
libsecret), not in a config file, not in the database, never in the repository. Environment-variable
override is supported for development with a non-secret `.env.example` as the only committed
reference (AGENTS.md §5).

### 21.3 What leaves the machine — `RECOMMENDED_FOR_DRAFT`

**One explicit egress boundary.** Only the agent runtime may make network calls, and only with context
assembled by a context builder. Requirements:

- textbook content leaves **only** as the bounded context of a user-initiated or user-enabled action;
- no telemetry, no analytics, no crash reporting to third parties by default;
- notes, highlights, learning history and Master threads are **never** sent as provider context unless
  the specific feature requires it and the user invoked it;
- the exact payload of any provider call is inspectable locally for debugging (§22).

### 21.4 Backup

The database is the only irreplaceable state (blobs are the user's own files; caches are derived).
Periodic local snapshots with a documented restore path. This is the one place where a personal
product still deserves real rigour, because §20's only "user data at risk" row lives here.

### 21.5 Logs

Structured, local, redacted: no API keys, no full provider payloads by default, no full note or
conversation bodies. Log identifiers and versions, not content (§22).

---

## 22. Observability

Minimum useful for debugging a system whose failures are mostly asynchronous.

**Job/queue visibility:** state, attempts, last failure code, timing per job; per-page preparation
status queryable per book. A developer must be able to answer "why is page 212 not selectable?"
without reading code.

**Provider invocation records:** role, provider, model, latency, token usage, outcome, retry count,
failure classification — **metadata only, not payloads**. Retained with a bounded window.

For Chapter Knowledge preparation, the retained record is per bounded semantic-window attempt or
compact Review-stage attempt and must also include: Chapter/Section IDs, a non-content window/stage
identifier, logical attempt number, start/end time, `finish_reason` when supplied, response-content
presence/length, reasoning-content presence/length when supplied, and typed failure code. Unit text,
partition decisions, title/meaning, Review ledger, reasoning/content bodies and source geometry are not
observability metadata and must not be retained through this path. A terminal `empty_response` must
remain diagnosable after the call completes; it cannot collapse to only one Chapter-level failure
code with no per-attempt facts.

The protected local inspection may additionally retain each Review finding's dimension, severity,
Section/unit IDs and a bounded actionable detail string. It never retains the compact ledger,
provider request/response bodies, reasoning, source text/geometry or credentials.

**Minimum Chapter progress:** while deterministic construction, private semantic classification or
compact Review is running, the Reader may show the current stage and completed/total Section count
(and retry attempt where useful). Internal semantic-window granularity need not become a new user-facing
progress model. Progress contains no evidence-unit or candidate KP content and confers no readiness.
Restart may honestly restart disposable private work, but must not leave a dead process looking like
live, indefinitely unchanging preparation.

**Version stamping:** every generated artifact and every log line about one carries the relevant
version IDs (§19.1). Without this, staleness bugs are undebuggable.

**Structured logs** with stable event names, secret redaction, and a correlation ID per job and per
user-initiated agent action.

**Not persisted by default:** full Assistant conversations (§14.2 — persisting them would violate the
temporary-state guarantee), full provider request/response bodies, note and thread contents in logs. A
developer-only verbose mode may capture payloads locally, off by default, never in a shipped build.

**Development reports** per phase, per AGENTS.md §5.

---

## 23. Test Strategy

Model output is not a correctness oracle. Test the deterministic machinery hard; test model
integration by contract.

| Layer | Covers | Notes |
|---|---|---|
| **Unit (deterministic)** | Geometry conversion, normalization, range resolution, reading-order sort, page-label hypothesis fitting, dependency/staleness rules | Pure functions, no I/O. Fast and exhaustive. |
| **Persistence / state machine** | Every transition in §12.1, §17.1, §15.2, §18; illegal transitions rejected | Includes: chapter FAILED leaves reading intact; publish is atomic |
| **Concurrency / idempotency** | Single-winner job claim, duplicate preparation requests joining, restart recovery, racing publication | Real threads, real DB |
| **PDF geometry** | Rotation, non-zero-origin media boxes, mixed page sizes; normalized round-trip stability | Synthetic PDFs where the expected answer is exactly computable |
| **Selection / highlight round-trip** | Select → persist quads + fingerprint → **regenerate the OCR layer** → reload → highlight still renders at the right place | **The single most important test in the system.** It proves §16's durability claim. |
| **Real-textbook acceptance** | A small fixture set of representative real pages: dense Chinese body text, mixed CN/EN/numerals, formula-adjacent text, a large figure with caption, a table, a dense figure/text page, a hard page | Assert *structural* properties (line count in range, reading order sane, region detected, selection resolves) — **not exact recognized strings**, which would make the suite brittle and engine-locked |
| **Agent contract** | Schema conformance, refusal of invalid structured output, context isolation (a role cannot receive input it did not declare), grounding-rule enforcement | Stub providers; deterministic |
| **Provider failure** | Each typed failure → correct classification, bounded retry, correct degradation per §20 | Fault injection |
| **Review acceptance** | Deterministic gates reject before any model call; **review failure never yields PASS** | |
| **End-to-end Reader** | Import → read immediately → background preparation → select → highlight → note → navigate → reload and everything is where it was | Runs with **AI entirely disabled** — proving §13 of the architecture principles |

Two standing rules: **fixtures are real pages** wherever machine behaviour is under test, since
synthetic clean text tests nothing about OCR; and **no test asserts exact model output strings** as its
primary correctness signal.

### 23.1 Inherited empirical fixtures **[E]**

A calibration fixture set already exists and is directly reusable as the acceptance baseline. It is
**empirical evidence, not legacy code** — nine real pages from two textbook PDFs, chosen for coverage
and each with a recorded expected outcome:

| Fixture property | Recorded baseline |
|---|---|
| Page coverage | dense CN body · multi-level headings · CN/EN/numeral mixing · formula-adjacent (`0.2μs`, `9600b/s`, `0.0005%`, `4KB`) · large figure + caption · table · flowchart · shaded callout block · watermark overprint · rotated in-figure labels · a no-figure false-positive control · a no-printed-label control |
| Line geometry | 393 lines / 9 pages; 0–1 overlapping pairs per page |
| Selection | 34 target strings, each with a known correct glyph target |
| Anchors | 6 persisted anchors with recorded IoU |
| Figures / tables | 7 figures, 2 tables, with per-detection confidences and the 0.5 threshold + merge behaviour |
| Printed labels | 28/29 and 16/29 recovery, two *different* relations |

**Disposition: `RETAIN_AS_EMPIRICAL_FIXTURE`.** These become the R2/R3/R4 acceptance baseline
(§24). The source PDFs stay outside the repository — no textbook content is committed — with fixtures
referencing them by path and content hash.

**One test must be strengthened beyond what calibration ran.** The highlight round-trip there used the
*same* engine version. The §23 round-trip row above specifies a **cross-version** regeneration, which
is strictly stronger and closes the residual risk named in §16.3a. That upgrade is required, not
optional.

Assertions stay **structural** — line count within a range, reading order monotonic in the body,
region detected with confidence above threshold, selection resolves to the right glyph, anchor
re-resolves or flags. Exact recognized strings are not asserted: they would lock the suite to one
engine version and would convert a nine-page sample into a false system-wide guarantee.

---

## 24. Implementation Phase Plan

Vertical slices, each independently reviewable with a real user-visible milestone. Phases are named,
not numbered against any prior scheme.

### Phase R1 — Read the Book
**Goal:** import a PDF and read it. No AI, no OCR.
**Includes:** Library context, blob store, intake/validation/dedup/delete, Core Service skeleton,
Reader UI with rendering, virtualization, zoom, page navigation, reading position persistence,
coordinate-conversion module.
**Excludes:** OCR, selection, outline, all AI.
**Schema:** Library, ReadingPosition.
**Acceptance:** open a real 700-page scanned textbook, navigate fluidly, close and reopen at the same
place; geometry unit tests pass; duplicate import is a no-op.
**Milestone:** *"I can read my textbook in this app."*
**Research checkpoint:** PDF render/viewer stack.

### Phase R2 — Selectable Book
**Goal:** progressive OCR makes pages selectable without ever blocking reading.
**Includes:** Jobs context, `PAGE_PREPARE` with priority scheduling, OCR engine adapter + one engine,
`OCRPage`/`OCRLine`/cells, overlay rendering, selection and copy, per-page status streaming to the UI.
**Excludes:** highlights/notes, layout detection, outline, AI.
**Schema:** Foundation (pages/lines), Jobs.
**Acceptance:** reading stays fluid during background preparation; killing the service mid-preparation
loses at most one batch; a deliberately failed page leaves the rest of the book working; selection
resolves on the real fixture pages.
**Milestone:** *"I can select and copy text from my scanned textbook."*
**Research checkpoint:** OCR engine (**D-2**) — this is where §8.8 evidence is applied.

### Phase R3 — My Marks
**Goal:** durable annotations that survive machine-layer regeneration.
**Includes:** Annotation context, text highlights, region notes, note bodies, anchor persistence,
fingerprint re-resolution, `NEEDS_REVIEW` handling.
**Excludes:** AI-authored notes.
**Schema:** Annotation.
**Acceptance:** **the round-trip test of §23** — annotate, force a full OCR regeneration, reload, and
every highlight is correctly placed or explicitly flagged; none is silently moved.
**Milestone:** *"My highlights and notes are safe."*

### Phase R4 — Structure
**Goal:** navigate the book by its own structure, and know what page you are on.
**Includes:** Outline context (TOC/bookmark/heading evidence, deterministic ranges + validation),
printed-page inference with UNKNOWN and manual override, layout detection for figure/table geometry
(optional — **D-3**), on-demand crops.
**Excludes:** KP, teaching, AI dialogue.
**Schema:** Outline, PageLabel, VisualRegion.
**Acceptance:** outline of a real textbook validates and navigates correctly; a book with no
recoverable labels yields UNKNOWN everywhere and never a guess; range validation rejects a
deliberately corrupted outline.
**Milestone:** *"I can jump to 7.3.3 and cite printed page 313."*
**Research checkpoint:** layout detection (**D-3**).

### Phase R5 — Ask About This
**Goal:** first AI — Assistant only.
**Includes:** AgentRuntime (contexts, routing, structured output, typed failures, bounded retry),
Assistant with section/page scope resolution, temporary in-memory contexts, recursive explanation,
Save-to-Notes with verification, multimodal crops.
**Excludes:** KP, Master, teaching generation.
**Schema:** none durable except AI-saved annotation fields.
**Acceptance:** Assistant works on prepared pages; provider failure degrades cleanly with the Reader
untouched; contexts stay isolated across sections; Reader close clears conversations; **the whole app
still works with AI disabled**.
**Milestone:** *"I can select anything and ask what it means."*
**Research checkpoint:** provider abstraction, structured output.

### Phase R6 — Learning Structure
**Goal:** lazy chapter knowledge maps and durable learning state.
**Includes:** Knowledge context and full pipeline (deterministic evidence units → bounded AI semantic
selection/labeling → deterministic KP materialization → compact independent structural review →
validation → atomic publish), Learning context (KP status, section learning state with the §15.2 two-
axis model, append-only history, Master threads).
**Excludes:** teaching generation.
**Schema:** Knowledge, Learning.
**Acceptance:** chapter preparation is lazy and isolated — a FAILED chapter leaves reading, notes and
Assistant intact; the §15.2 race is exercised explicitly (finish a section before READY, confirm
later, verify nothing was inferred retroactively); `都清楚了` / `还有些不清楚` semantics match §15.3
exactly, including no bulk-negative; the structure lock blocks destructive republication.
**Milestone:** *"The app tracks what I understand — and never guesses."*

### Phase R7 — The Teacher
**Goal:** Section teaching with mandatory independent review.
**Includes:** Teaching context, Reading Guide, Inline Guidance, recall prompts, semantic-target
anchoring, publication gated on review PASS, staleness and explicit regeneration, review routing tiers
for Master and Assistant.
**Schema:** Teaching.
**Acceptance:** no teaching asset publishes without review PASS; review failure never becomes PASS; a
Reading Guide generated before chapter READY records no `chapter_structure_version`; regeneration never
overwrites silently; unresolvable guidance is omitted rather than guessed.
**Milestone:** *"The app teaches the section — reviewed before I see it."*

### Phase R8 — Evidence and Polish
**Goal:** inspectable exam-weight claims; correction workflow; hardening.
**Includes:** ExamEvidence context, evidence provenance UI, OCR error reporting and manual correction
end-to-end with foundation versioning, backup/restore, observability surfaces.
**Schema:** ExamEvidence, OCRCorrection/ErrorReport.
**Acceptance:** every `重点/高频/常考` claim resolves to inspectable evidence; a correction produces a new
foundation version without breaking annotations; restore from backup verified.
**Milestone:** *"I can see why it says this is important, and fix it when it's wrong."*

**Prerequisites:** strictly sequential R1→R8, except R4's layout detection and R8's exam evidence,
which are independently deferrable.

Every phase ends with a development report (AGENTS.md §5).

---

## 25. Architecture Decision Register

| ID | Decision | Status | Reason | Alternatives | Revisit trigger |
|---|---|---|---|---|---|
| **A-01** | Local-first desktop app: web UI + local Core Service, two processes | RECOMMENDED_FOR_DRAFT | Render loop and multi-hour OCR must not contend; service must outlive UI reloads; book content stays local | Single process; browser-only; cloud backend | Multi-device sync becomes a product goal |
| **A-02** | Python for Core Service | RECOMMENDED_FOR_DRAFT | OCR/layout ecosystem is Python-first; other runtimes shell out to it anyway | Node, Rust, Go | OCR moves to a portable runtime with first-class non-Python bindings |
| **A-03** | Windows 10/11, Chromium-class browser host, Python service on localhost, **no shell**; packaging deferred behind a 3-rule boundary (§3.5) | **RESOLVED [E]** (was D-1) | Decided 2026-09-03. A supported Chromium-class host removes the multi-WebView rendering risk entirely | Electron; Tauri | Commercialization or UX warrants a packaged shell |
| **A-04** | SQLite, WAL, single DB per install | RECOMMENDED_FOR_DRAFT | Single-user, embedded, transactional, zero-admin; scale is trivially within range | Per-book SQLite; Postgres; document store | Multi-user or sync |
| **A-05** | Normalized top-left `[0,1]` geometry as the only persisted convention | RECOMMENDED_FOR_DRAFT | Resolution/zoom independent; matches browser and image-model axes; removes flip bugs | PDF points bottom-left; device pixels | Never — this is foundational |
| **A-06** | Client-side canvas render + our own overlay from the OCR layer | RECOMMENDED_FOR_DRAFT | Scanned books have no embedded text layer; overlay must be progressive, correctable, versioned | Server-side rendering; a viewer's built-in text layer | Books become predominantly digital-native |
| **A-07** | Line = detected authority; cells = derived, serialized on the line, **no IDs**; entity named `OCRCell` | **SHARPENED [E]** | Measured: ~21× row multiplier avoided, 99.8% single-char, y line-inherited, x ±½ glyph. Clean-room derivation confirmed in every particular | Row-per-cell; naming it `OCRChar` (rejected — 0.2% are multi-char) | Engine emits genuinely detected sub-line geometry |
| **A-08** | **RapidOCR / PP-OCRv6 on onnxruntime**, behind the §8.6 adapter | **RESOLVED [E]** (was D-2) | Measured: 2.24 s/page, 31.7 MB ONNX models, **no torch, no Paddle framework**; 34/34 selections resolved; 6/6 anchors recovered | Tesseract; cloud OCR; VLM OCR | Adapter keeps replacement cheap; revisit on a different book corpus |
| **A-09** | Layout detection **needed** (interface settled); **which detector is open (D-3)** | **SHARPENED [E]** | Measured 7/7 figures, 2/2 tables, 0 FP at conf ≥0.5 + merge; OCR-only scored **0/7**, confirming the a-priori prediction that figures contain text | heron (measured, +805 MB incl. torch) vs DocLayout-YOLO ONNX (unmeasured, ~free given onnxruntime) | Pre-adoption bake-off on the 9 calibration pages |
| **A-10** | Durable SQLite job queue + in-process worker pool; priority by viewport; **no separate checkpoint store** | **SHARPENED [E]** | 3.0 s/page × hundreds of pages justifies durability; per-page commit + publish-time IDs make opaque checkpoints unnecessary (§18.5) | In-memory; external broker; opaque checkpoint store | A job type appears with expensive non-durable intermediate state |
| **A-11** | Assistant state in service memory, never persisted | RECOMMENDED_FOR_DRAFT | Makes "closing clears it" structural rather than a deletable-cleanup-job promise | Persist with TTL; persist and delete on close | Assistant history becomes a product requirement |
| **A-12** | Append-only learning history + maintained current-state projection | RECOMMENDED_FOR_DRAFT | History must accrete while status mutates (§29); projection needed for read performance; replay enables future migration | Status only; pure event sourcing | — |
| **A-13** | Annotations anchor on geometry + quote/context; no OCR IDs durable | FROZEN_FROM_PRODUCT (§8) | Machine layer must be fully regenerable without touching user assets | OCR-ID anchoring; Guide-version anchoring | Never |
| **A-14** | Artifact-specific dependency declaration; staleness only on declared deps | FROZEN_FROM_PRODUCT (§23) | Global invalidation would make improving the machine layer destroy the teaching layer | Global version; no versioning | Never |
| **A-15** | Content-addressed immutable blob store; new bytes = new revision | RECOMMENDED_FOR_DRAFT | Geometry may move between editions, so annotations must not silently follow | Mutable file per book; in-DB blobs | — |
| **A-16** | Localhost HTTP + SSE | RECOMMENDED_FOR_DRAFT | Traffic is mostly server→client progress; SSE reconnects natively and debugs trivially | WebSocket; polling; native IPC | Bidirectional realtime need |
| **A-17** | Deterministic gates before any reviewer model call | RECOMMENDED_FOR_DRAFT | Cheap mechanical checks catch most failures; model calls are the expensive scarce resource | Model review only | — |
| **A-18** | Provider credentials in the OS credential store | RECOMMENDED_FOR_DRAFT | Keeps secrets out of config, DB and repo | Config file; env only | Deployment model changes |
| **A-19** | Assistant answer rendering: LLM Markdown via **marked + DOMPurify + KaTeX** (`trust=false`, no raw HTML, no cross-message macro state), with a verbatim raw↔rendered selection mapping for Child creation offsets | **RESOLVED [E]** (user decision D2, 2026-09-06 — Ask Deeper UAT rework) | Hand-written Markdown/LaTeX parsing is an unnecessary risk surface; the mapping requirement protects the frozen Child CURRENT FOCUS from rendering-induced offset drift | Hand-rolled parser subset; MathJax; React-specific stacks (remark/rehype — the Reader frontend is not React) | A rendering need outside the Markdown+math set, or a sanitizer/KaTeX security advisory |
| **A-20** | One durable Master Topic per learning thread; ACTIVE/RESOLVED are mutable evidence states on that stable identity, not conversation identities | **RESOLVED [E]** (user amendment, 2026-09-14) | Resolution followed by revisit previously minted duplicate sidebar Topics and fragmented one learning focus; stable identity preserves conversation, History and Memory while ordinary continuation remains mastery-neutral | Linked continuation Topics; title-based UI deduplication | A future product need for multiple independently named learning focuses inside one KP/Section thread |

---

## 26. User Decisions Required

**Reissued after reconciliation.** Two of the original five are resolved by evidence and one is
narrowed to a phase decision. Three remain.

### Resolved — no longer open

| Was | Resolved by | Outcome |
|---|---|---|
| **D-1** Target platform | User working decision, 2026-09-03 | Windows 10/11 · Chromium-class browser host · Python service on localhost · no shell · packaging deferred behind §3.5's boundary |
| **D-2** OCR engine | Measurement (§8.5, §8.8) | RapidOCR / PP-OCRv6 on onnxruntime. 2.24 s/page, 31.7 MB models, no torch, no Paddle framework. Dependency *adoption* is authorized at Gate D/E like any other — it is no longer an open design question. |

### Still open

| ID | Decision | Why it needs you | Recommendation |
|---|---|---|---|
| **D-3** | **Which layout detector — and whether V1 ships one at all** (§9.2) | The measured candidate (heron) costs **~805 MB, dominated by torch**; the cheap candidate (DocLayout-YOLO ONNX) is **unmeasured on our pages** but would keep the entire prepare extra onnxruntime-only. That is a real dependency-burden fork, and the capability is genuinely optional. | **Run the bake-off first** (§9.2) — the fixtures and answer key already exist. Adopt the ONNX candidate if it holds; otherwise heron in a preparation-only extra. Deferring past V1 remains acceptable. |
| **D-4** | **First provider adapter(s)** (§13.4) | Cost, privacy posture and latency are yours to weigh. | **Narrowed from the clean-room version.** The architecture must support *N* adapters behind one interface — but "two providers installed on day one" is **not** an architectural requirement, and requiring it for symmetry would be over-building. Reviewer independence uses a genuinely different provider/model *where configured and practical*, and isolated same-model contexts as the Product-sanctioned fallback (Product §16). **Choose concrete adapters in Phase R5**, not now. |
| **D-5** | **Book content egress boundary** (§21.3) | The product sends textbook excerpts to a third party to function at all. That deserves an explicit decision, not an implicit one. | Bounded, user-initiated context only; no telemetry; locally inspectable payloads. Confirm before Phase R5. |

Everything else is an engineering recommendation needing review, not approval.

---

## 27. Deferred Engineering

Each carries the seam that future work will use — deferral is not abandonment.

| Deferred | Seam already in place |
|---|---|
| Cross-revision user-asset migration (§6.2) | All durable assets carry `book_source_revision_id`; old revisions retained as SUPERSEDED |
| Persistent formula regions (§9.3) | Another `VisualRegion.kind` |
| Independent ExamTopic progress (§17 of Product) | Evidence entity + KP links exist; no progress tree attached |
| Past-exam RAG / attributed teacher layer | ExamEvidence has a `kind` discriminator and provenance |
| Exercise → KP mapping | Exercise/answer outline node kinds already recognized and excluded from KP |
| Multi-device sync | All durable state in one SQLite DB with clean context boundaries |
| Full-text search across the book | OCR line text is already stored per page |
| Paragraph as an entity | Explicitly rejected (§6.3); derivable from lines on demand |
| Exact fallback-target selection when navigating to a node with an unresolved/partial physical range (§7.5) | §9.2 states the invariant (use the best safe resolved target, never fabricate a range); the precise selection algorithm is unspecified — non-blocking, Gate D P2 |
| Whether/how `foundation_version` should factor into the Chapter Preparation idempotency key alongside the Chapter node's own `identity_revision`/`physical_revision` (§12.6) | Key is frozen on the node's own two revisions; `foundation_version`'s exact role, if any, in that same key is unresolved — non-blocking, Gate D P2 |
| Exact `physical_revision` bump granularity during routine progressive resolution (§11.4, §11.2 Pass 2) | The counter and its staleness semantics are frozen (§19.2b); whether every incremental Pass-2 refinement bumps it or only a resolution-state transition does is an unspecified threshold — non-blocking, Gate D P2 |

---

## 28. Clean-Room Self-Review

**1. Does any retired fragment/reconstructed-reader concept reappear under another name?**
No — and it is prevented structurally, not by naming discipline. Sub-line cells have no IDs and are
serialized inside their line (§8.4), so nothing can reference one; the Reader renders the PDF and
never assembles content from stored fragments (§7.1); no entity holds "the authoritative text of the
book." The closest risk is `OCRLine.text`, which is explicitly a *machine interpretation* (§8.7), is
correctable, is never the reading surface, and is never required for a page to display.

**2. Is any infrastructure heavier than a single-user first version needs?**
The one genuine candidate is the durable job queue. It is justified by hours-long restart-surviving
work with per-page failure isolation (§18.1), and deliberately bounded: a table plus an in-process
worker pool, with brokers and distributed coordination explicitly ruled out (§18.5). SQLite over a
database server, SSE over a bidirectional protocol, and in-memory Assistant state over persisted state
all pull the same direction. **Assessed acceptable.**

**3. Is the original PDF usable when every AI/OCR subsystem fails?**
Yes. Phase R1 delivers reading with no OCR and no AI at all, and the §23 end-to-end suite runs with AI
disabled. Every row of §20 keeps PDF rendering intact. The only "user data at risk" row is database
corruption, mitigated by §21.4 backups.

**4. Are reading state and mastery state still separate?**
Yes, and this got stronger under scrutiny. `ReadingPosition` references only book revision and page
geometry — no KP, no AI artifact (§15.1). `SectionLearningState` carries two independent axes so
"finished reading" and "mastery confirmable" cannot collapse into one value (§15.2). No code path
converts scrolling, section completion, recall answers, or review PASS into mastery (§15.3, §15.6,
§15.8, §13.7).

**5. Are replaceable AI assets clearly separated from durable user assets?**
Yes — by context (§4.1), by dependency direction (§4.2: Annotation and Learning never depend on
Teaching), and by anchoring model (§16.5: annotations reference geometry, never a Guide version). The
subtlest case is Assistant→Note promotion, handled explicitly: the *user's anchor* is durable
regardless of whether the AI *wording* verifies (§16.4).

**6. Are version dependencies minimal rather than global?**
Yes. Artifacts declare only dependencies they actually used, and staleness triggers only on those
(§19.2). Provider metadata is recorded but does not invalidate. Text corrections are separated from
reprocessing so a typo fix does not carry an engine change's blast radius (§19.4). A Reading Guide
built before chapter READY is explicitly forbidden from recording a `chapter_structure_version` it
never used (§17.2).

**7. Did OCR engine vocabulary become product vocabulary?**
No. Domain names are `OCRPage`, `OCRLine`, "cells", `VisualRegion` — chosen from the product's needs.
§8.6 confines engine vocabulary to the adapter, and §6 of the Product Blueprint's rule about inferring
meaning from a field name is honoured: §8.4 deliberately declines to fix cell granularity, and §8.8
makes it a measurement question. *Caveat:* "cells" is my coinage and is provisional — if the measured
reality is cleanly characters, `OCRCharCell` would be more honest.

**8. Did anything assume a retired module or migration shape?**
Not that I can identify. The bounded contexts were derived from the Product Blueprint's asset layers
(§3.1–3.3) and its lifecycle boundaries; persistence starts from an empty migration history; the phase
plan is derived in §24 from vertical user-visible milestones. **This is the answer I hold with least
certainty**, since I have prior exposure to the retired system in this conversation — it is exactly
what independent review should attack hardest.

**9. Are phases derived from this architecture rather than prior phase history?**
Yes. They are vertical slices ordered by user-visible capability (read → select → annotate → navigate
→ ask → learn → teach → evidence), each independently acceptance-testable. The ordering falls out of
dependency: annotations need selection, which needs OCR, which needs rendering.

**10. Are external dependencies recommended without fit/cost justification?**
No. Each of the three carries problem, alternatives, fit, runtime cost, lock-in, licence note and
approval requirement (§8.5, §9.2, §3.5), and each is either behind an adapter or optional. The largest
honest risk is **A-02 (Python)** — a runtime-level commitment justified by ecosystem gravity, and the
hardest of the three to reverse later. Review should test that reasoning specifically.

**Patched during this review:** §8.4 gained the explicit statement that storage shape enforces §4.4
(the point was implicit and is too important to leave implied); §15.2 gained the explanation of *why*
two axes beat one enum; §19.4 was added to separate correction from reprocessing after §16.3 revealed
they have different blast radii.

---

## 29. Evidence / Reuse Reconciliation

Completed 2026-09-03. Purpose: demonstrate that **architecture preceded reuse**, and record what
evidence actually changed.

Dispositions: `KEEP_CLEAN_ROOM` · `PATCH_FROM_EMPIRICAL_EVIDENCE` · `ACCEPT_REUSE_CANDIDATE` ·
`RESHAPE_REUSE_CANDIDATE` · `REIMPLEMENT_FROM_PATTERN` · `REJECT_REUSE_CANDIDATE`

### 29.1 Decision attack — the nine major clean-room recommendations

| # | Clean-room decision | Verdict | Why |
|---|---|---|---|
| 1 | Python Core Service | **UNCHANGED / sharpened** | The selected OCR stack is Python + onnxruntime and needs **no torch and no Paddle framework** — 31.7 MB of models. Ecosystem gravity confirmed; the footprint is smaller than feared. |
| 2 | SQLite | **UNCHANGED** | Nothing in evidence challenges it. Legacy ran the same engine at comparable scale without incident. |
| 3 | Durable DB-backed job queue | **UNCHANGED / sharpened** | 3.0 s/page × hundreds of pages ⇒ durability genuinely required. Sharpened: **no separate checkpoint store** (§18.5) — per-page commit and publish-time IDs make opaque checkpoints unnecessary. |
| 4 | SSE for progress | **UNCHANGED** | No evidence bears on it either way. Stated plainly: this stands on its own reasoning, not on evidence. |
| 5 | Cells serialized on `OCRLine`, no IDs | **UNCHANGED / strongly sharpened** | Predicted 20–40× row multiplier; measured ≈21×. Predicted y line-inherited; measured 1,430/1,430. Predicted x approximate; measured ±½ glyph. The derivation held in every particular. |
| 6 | Normalized top-left `[0,1]` geometry | **UNCHANGED / sharpened** | Round-trip 6/6 at IoU > 0.999 validates normalized persistence directly. |
| 7 | Bounded-context decomposition | **UNCHANGED** | The legacy 61-table single model module is the counter-example, not a counter-argument. |
| 8 | Client-side PDF render | **UNCHANGED / sharpened** | Split clarified: **client** rasterizes for reading; **server** rasterizes for OCR input and on-demand crops (~0.07 s/page), sharing one render path. The draft under-specified this. |
| 9 | Local browser + localhost process boundary | **CHANGED — resolved** | By user working decision, not by evidence: Windows 10/11, Chromium-class host, no shell, packaging deferred behind §3.5's boundary. Removes the multi-WebView risk the draft flagged. |

**Zero of the nine were reversed by evidence.** One was resolved by a product decision. Six were
sharpened with numbers. That is the outcome a clean-room draft should produce if the method works.

### 29.2 Reconciliation table

| Clean-room decision | Empirical evidence | Legacy evidence | Disposition | Reason |
|---|---|---|---|---|
| Line = detected authority; sub-line derived | Two-stage det→rec confirmed; 99.8% single-char; x interpolated, y inherited | — | `PATCH_FROM_EMPIRICAL_EVIDENCE` | Derivation confirmed; numbers added; entity named `OCRCell` (§8.4a) |
| No permanent `Word` entity | `word_results` measured as a mixed-granularity character grid, **not** words | — | `KEEP_CLEAN_ROOM` | Product §6's warning about provider field names is vindicated literally |
| Snap-to-cell hit-testing | ±½ glyph x accuracy | — | `KEEP_CLEAN_ROOM` | Confirmed as the precision ceiling, not a conservative choice |
| OCR engine: PP-OCR family via portable runtime | RapidOCR / PP-OCRv6 / onnxruntime: 2.24 s/page, 31.7 MB, no framework | Legacy used a heavier document pipeline at 4.04 s/page producing no character geometry and no page labels | `PATCH_FROM_EMPIRICAL_EVIDENCE` | Concrete stack named; D-2 closed |
| Layout detector optional, ONNX preferred | 7/7 figures, 2/2 tables, 0 FP at ≥0.5 + merge; OCR-only **0/7** | Standalone predictor verified importable without the document pipeline | `PATCH_FROM_EMPIRICAL_EVIDENCE` | Need proven; detector choice still open (D-3) |
| Reject OCR-gap heuristic for regions | Measured 0/7, plus 9 spurious regions | — | `KEEP_CLEAN_ROOM` | A-priori prediction ("figures contain text") confirmed by measurement |
| Printed-page: per-book inference, UNKNOWN fallback | 28/29 and 16/29 recovery at **two different relations**; parity holds | Legacy discarded header bands as furniture and wrongly concluded labels were absent | `PATCH_FROM_EMPIRICAL_EVIDENCE` | Design confirmed; "never discard header/footer bands" added as a rule (§10.3) |
| Anchors = geometry + quote/context, no OCR IDs | 6/6 recovered, IoU 0.9993–0.9997, correct line 6/6 | — | `KEEP_CLEAN_ROOM` | Validated against the real selection machinery |
| Foundation versioning: correction ≠ reprocessing | Cross-version robustness **unmeasured** | — | `KEEP_CLEAN_ROOM` + risk | §16.3a names the gap and upgrades the test to cross-version |
| Job substrate: durable queue, viewport priority | 3.0 s/page justifies durability | Mature substrate with claim, idempotency, recovery, **checkpoints** | `REIMPLEMENT_FROM_PATTERN` | Mechanisms are ~10-line conditional UPDATEs; the surrounding state model carries LLM-budget columns and lacks priority. **Its tests are worth more than its code.** |
| Opaque checkpoint store | Per-page commit is the natural resume point | Well-built checkpoint store with integrity checking | `REJECT_REUSE_CANDIDATE` | This architecture removed the problem it solves (§18.5) |
| Provider gateway: typed errors, bounded retry, breaker | — | Error taxonomy, finite retry, **persisted** cross-process breaker, per-task token budget | `RESHAPE_REUSE_CANDIDATE` (taxonomy/retry) + `REIMPLEMENT_FROM_PATTERN` (breaker, budget) | Taxonomy is an excellent fit. A *persisted* breaker is over-built for one process — in-memory suffices. Budget belongs to AgentRuntime per-invocation, not to a task row. |
| Blob store: content-addressed, atomic, contained | — | Streamed hash + validation + atomic publish + containment incl. a Windows `\\?\` edge case | `RESHAPE_REUSE_CANDIDATE` | Mechanics fit exactly; **addressing differs** — legacy is book-keyed, this is content-addressed, so dedup and reconcile logic change |
| SQLite policy: WAL, FK on, busy timeout | — | Exactly this, with typed busy error | `ACCEPT_REUSE_CANDIDATE` | The cleanest fit in the entire candidate set |
| Structured logs with redaction | — | JSON formatter + field-name-based redaction | `ACCEPT_REUSE_CANDIDATE` | Directly serves §21.5/§22 |
| Native-text page routing | All 29 sample pages were scan-only ⇒ **zero measured value on this corpus** | ~57-line probe, no domain coupling | `RESHAPE_REUSE_CANDIDATE` | Still correct to keep — future books may carry text layers, and the probe is nearly free. Honest note: it earned nothing on the tested books. |
| Phase 04–09 domain mechanisms | — | Audit identifies generic patterns inside obsolete domain code | `REJECT_REUSE_CANDIDATE` | No clean-room destination exists for any of them. See §30. |

### 29.3 Where evidence made the architecture *smaller*

Worth recording, because reconciliation is usually assumed to add:

- **Checkpoint store removed** — the architecture made it unnecessary (§18.5).
- **Persisted circuit breaker → in-memory** — one process does not need cross-process lease arbitration.
- **Task state model reduced** — `BUDGET_EXHAUSTED` and usage-accounting columns do not belong in a
  queue that mostly runs OCR.
- **Two-step recovery → one step** — idempotent jobs do not need an intermediate stopped state.
- **The document pipeline dropped entirely** — only a standalone predictor class was ever in scope.

---

## 30. Candidate Port Disposition

`PORT_CANDIDATE` · `RESHAPE_AND_PORT_CANDIDATE` · `REIMPLEMENT_FROM_PATTERN` · `REFERENCE_ONLY` · `REJECT`

> **`PORT_CANDIDATE` does not authorize porting. Gate E remains closed.** Every row is a proposal
> to be confirmed at Gate D against the frozen architecture.

| Candidate | Clean-room destination | Disposition | Reason |
|---|---|---|---|
| **Task/checkpoint/recovery substrate** | §18 Jobs | **REIMPLEMENT_FROM_PATTERN** | Claim is a ~10-line conditional UPDATE this design already specifies independently; the surrounding 8-state model carries LLM-budget concepts and has no priority column. Checkpoints unnecessary (§18.5). |
| ↳ *its concurrency tests* | §23 concurrency layer | **ADAPT_TO_NEW_CONTRACT** | Single-winner claim, crash-before-submit rediscovery and restart recovery are properties this design must still satisfy. **The most valuable artifact in the candidate set.** |
| **Provider abstraction + error taxonomy** | §13.8 | **RESHAPE_AND_PORT_CANDIDATE** | `retryable` / `breaker_qualifying` / `code` and the transient-vs-user-actionable split map directly onto §13.8. Strip old agent-contract coupling. |
| **Circuit breaker** | §13.8 cooling period | **REIMPLEMENT_FROM_PATTERN** | Persisted cross-process lease is over-built for a single service process. In-memory, same semantics. Lease algorithm `REFERENCE_ONLY` if multi-process ever arrives. |
| **Token budget** | §13.4 `ProviderProfile.token_budget` | **REIMPLEMENT_FROM_PATTERN** | Reserve-then-reconcile is a good idea in the wrong place: budget is per-invocation-profile here, not per task row. |
| **SQLite policy / engine helpers** | §5.1 | **PORT_CANDIDATE** | WAL, FK enforcement, busy timeout, typed busy error, transaction helper. Product-neutral; exactly what §5.1 specifies. |
| **Migration head-count helper** | §5.3 | **PORT_CANDIDATE** | Single-head assertion is good discipline. **The migration *chain* is not inherited — the new root stays clean.** |
| **Structured logging + redaction** | §21.5, §22 | **PORT_CANDIDATE** | Direct fit, no domain knowledge. |
| **ID / error / base helpers** | §5 | **PORT_CANDIDATE** | ~40 lines, trivial, product-neutral. |
| **Settings boundary** | §3, §5 | **REIMPLEMENT_FROM_PATTERN** | Pattern right (single validated boundary); every field differs. |
| **`ManagedBookStorage`** | §6.3 intake, §5.2 blob store | **RESHAPE_AND_PORT_CANDIDATE** | Streamed hash, structural validation, atomic publish, path containment, in-flight registry all fit. **Addressing changes** book-keyed → content-addressed, so dedup and reconcile differ. The Windows `\\?\` containment detail is hard-won and worth taking verbatim — V1 targets Windows. |
| **Book lifecycle / tombstone semantics** | §6.4 | **RESHAPE_AND_PORT_CANDIDATE** | `ACTIVE/DELETING/DELETE_FAILED/DELETED` with retryable failure matches §6.4. Drop the obsolete reserved-identity field and the one-parse-task-per-book handoff. |
| **`NativeTextProbe`** | §8.2 page routing | **RESHAPE_AND_PORT_CANDIDATE** | Logic is right and nearly free; types and call site change. Zero measured value on the tested corpus (all scan-only) — kept for future text-layer PDFs, not on demonstrated benefit. |
| **`BBox` / coordinate-origin discipline** | §7.2 | **REFERENCE_ONLY** | The instinct is right; this design normalizes coordinates instead, so ~15 lines get rewritten. |
| **Probe-before-backend invariant** | §8.2 | **REFERENCE_ONLY** | Two lines of logic, already stated in §8.2. |
| **Per-page resumable persistence loop** | §18.4 | **REFERENCE_ONLY** | Correct shape; welded to obsolete entities. Reimplement against §8.3. |
| **`ManagedSourceStorage`** | §5.2 crop cache | **REFERENCE_ONLY** | Containment/atomic-publish pattern arrives via the blob store; the crop cache has a different lifecycle (derived, evictable). |
| **Document/layout pipeline adapter** | — | **REJECT** | Item-level output, whole-document conversion, fabricated page labels, permanent image extraction. Superseded on every axis. |
| **Standalone layout predictor class** | §9.2 | **PORT_CANDIDATE (as dependency, pending D-3)** | Not source code — a third-party class, verified importable without its document pipeline. Subject to the D-3 bake-off. |
| **Parser contracts / repository / block model** | — | **REJECT** | The fragment-entity model §4.4 forbids structurally. |
| **Reader render-tree code** | — | **REJECT** | Assumes a reconstructed reading surface. Contradicts Product §2 outright. |
| **Knowledge / Generation / Planning code** | — | **REJECT** | Legacy dataset, anchor and generated-node identity semantics. §12 mints its own KP identity with different ownership rules. No destination exists. |
| **Legacy `models.py` / migration chain** | — | **REJECT** | §5.3 and §7 require a clean migration root and per-context modules. Non-negotiable. |
| **Generic tests** (persistence, storage, logging, config, repo hygiene) | §23 | **ADAPT_TO_NEW_CONTRACT** | Contention/timeout, FK enforcement, rollback, concurrent reconcilers, in-flight publication protection, path-escape rejection, secret-redaction, env hygiene. |
| **Domain-semantic tests** (knowledge, planning, generation, review, reader, parser adapter) | — | **LEGACY_ONLY** | They assert an obsolete domain model. Passing tests are not an argument for the model they test. |
| **Calibration fixture set + recorded outcomes** | §23.1 | **RETAIN_AS_EMPIRICAL_FIXTURE** | Nine real pages with an answer key covering geometry, selection, anchors, regions and page labels. Becomes the R2–R4 acceptance baseline. |
| **Real textbook sample PDFs** | §23.1 | **RETAIN (external)** | Referenced by path and hash. **No textbook content is committed.** |

**Provenance for any row that proceeds** (from the approved transition plan, provenance only): Phase-01
foundation `98dc70d`; Phase-02 book intake/storage `69dd323`; Phase-03 probe `c68f3a6`; archive HEAD
`0ed2d85`. Each port commit carries `Legacy-Source` and `Legacy-Commit` trailers. **Legacy acceptance
proves those commits satisfied their old contract; it is not evidence of fitness here.**

---

## 31. Reconciliation Self-Review

**1. Did evidence improve the architecture, or merely make it look more like legacy?**
Improved, and it moved *away* from legacy on the two largest questions: the checkpoint store was
rejected and the document pipeline dropped. Net effect on the candidate set was **subtractive**
(§29.3). Nothing was adopted because it existed.

**2. Was any clean-room module renamed to match reusable code?**
No. Every context and entity name in §4 and §8.3 predates opening the archive. The one naming change
— `OCRCell` — came from measurement and deliberately **declined** the calibration document's own
suggestion of `Char`, because 0.2% of units are multi-character.

**3. Did passing legacy tests become an argument for an obsolete domain model?**
No, and this was tested directly: the most-praised legacy asset was reclassified
`REIMPLEMENT_FROM_PATTERN` with its **tests rated above its code**. Domain-semantic tests are
`LEGACY_ONLY` regardless of pass rate.

**4. Was OCR calibration overgeneralized?**
Guarded in three places. §8.5 states the text-agreement result as a sample outcome and says explicitly
it must never be written as a system property. §8.4a bounds the granularity figures to nine pages.
§8.8 item 5 names sample breadth as a residual unknown. No accuracy percentage appears as a system
guarantee anywhere.

**5. Did the heavy layout stack become mandatory without proving net value?**
No. Need is proven (7/7 vs 0/7); the **~805 MB candidate is not adopted**. §9.2 splits interface from
detector and requires a bake-off against an ONNX candidate that would keep the prepare extra
torch-free. Layout remains optional and deferrable.

**6. Did any durable user asset gain a dependency on replaceable teaching?**
No. §4.2's downward-only rule is unchanged; Annotation and Learning still never depend on Teaching.
Nothing in reconciliation touched those edges.

**7. Did fragment/reconstructed-book semantics reappear?**
No. Cells remain ID-less and serialized (§8.4), now with measurement showing why row-per-cell would
have been the wrong call anyway. Every candidate carrying the old fragment model is `REJECT` (§30).

**8. Is the migration root still clean?**
Yes. The legacy chain is `REJECT`; only the head-count *helper* is a port candidate.

**9. Does the original PDF remain usable if jobs, AI, layout and OCR all fail?**
Yes — unchanged, and now cheaper to demonstrate: rendering is ~0.07 s/page and needs neither OCR nor
network. §20 is unaltered. Phase R1 still ships reading with no OCR and no AI.

**10. Are Gate D and Gate E still closed?**
Yes. This document remains `DRAFT`, uncommitted. No code ported, no dependency installed, no
migration created.

**Residual risk carried forward, stated plainly:** cross-engine-version anchor robustness (§16.3a) is
unmeasured and sits beneath a durable-user-asset guarantee. The failure mode is safe by construction —
flag, never silently move — but the guarantee is unproven until the §23 round-trip is made
cross-version.

---

## 32. Semantic Audit Closure Disposition

Completed 2026-09-03, following `LEGACY_PRODUCT_SEMANTICS_DELTA_AUDIT.md` and the consolidated
blueprint closure patch. Every `P0_SEMANTIC` and `P1_SEMANTIC` contract from the audit's domain
ledgers (§6–§15 of that document) is disposed below into exactly one of:

- **A** — covered by a consolidated decision in this closure patch;
- **B** — already equivalent in `PRODUCT_BLUEPRINT.md` without needing a new rule;
- **C** — implementation-only safeguard, no Product decision required;
- **D** — obsolete with legacy architecture;
- **E** — genuinely unresolved.

**Zero rows are disposed E.** All 24 P0/P1 contracts close under A or B.

| ID | Priority | Disposition | Product ref | Implementation ref |
|---|---|---|---|---|
| LEGACY-ASST-WINDOW-001 | P0 | A | §24.4 | §14.3 |
| LEGACY-ASST-MAXDEPTH-001 | P0 | A | §24.4 item 1 | §14.3 |
| LEGACY-ASST-ROOTBYPASS-001 | P0 | A | §24.4 item 7, §24.5 item 3 | §14.7 |
| LEGACY-MASTER-ENDING-001 | P0 | A | §26.1 | §15.5 |
| LEGACY-MASTER-EVIDENCE-001 | P0 | A | §26.2 | §15.6 |
| LEGACY-ASST-ONECHILD-001 | P1 | A | §24.4 item 5, §24.7 | §14.6 |
| LEGACY-ASST-CONCURRENCY-001 | P1 | A | §24.4 item 6 | §14.6 |
| LEGACY-ASST-DEPTHGATE-001 | P1 | A (rule) + C (gate mechanism) | §24.4 items 4, 7 | §14.3 (structural unreachability), §14.5 (validation) |
| LEGACY-ASST-ANCESTOR-001 | P1 | A | §24.6 | §14.5 |
| LEGACY-ASST-RETRYID-001 | P1 | A | §24.4 item 8 | §14.9 |
| LEGACY-ASST-PROVFAIL-001 | P1 | A | §24.4 item 9 | §14.10 |
| LEGACY-MASTER-MUSTANSWER-001 | P1 | A | §26.3 | — (Product-level policy; no engineering mechanism needed) |
| LEGACY-MASTER-ATTRIBUTION-001 | P1 | A | §26.3 | — |
| LEGACY-MASTER-TOPIC-001 | P1 | A | §26.1 | §15.5 |
| LEGACY-MASTER-CONDENSATION-RACE-001 | P1 | A (amended) | §26.1 (finalization race on one stable Topic) | §15.5 (`frozen_basis_ref`; later turns stay outside the frozen basis without minting identity) |
| LEGACY-MASTER-NODOWNGRADE-001 | P1 | A | §26.2 | §15.6 |
| LEGACY-SYS-CLOSURE-001 | P1 | **B** | §20 / §20.4 (superseded by user-approved continuous-article amendment, 2026-09-10) | — |
| LEGACY-SYS-RECALL-001 | P1 | A | §32 (added paragraph) | — (Recall generation itself is Phase R7, not yet designed) |
| LEGACY-REVIEW-REWORKCOUNT-001 | P1 | A *(adapted — see note)* | §33.2.1 | §13.7a |
| LEGACY-REVIEW-EXHAUST-001 | P1 | A | §33.2.1 | §13.7a |
| LEGACY-REVIEW-PASSFREEZE-001 | P1 | A | §23.1 | §13.7b |
| LEGACY-FAIL-TECHVSCONTENT-001 | P1 | **B** | already stated (§33.2) | already stated (§13.8), reinforced by §13.7a's explicit technical-vs-semantic counter separation |
| LEGACY-FAIL-LATERUNITS-001 | P1 | A | §17.2 | §17.5 |
| LEGACY-STYLE-BOUNDARY-001 | P1 | A | §35 | — (no personalization feature exists yet to engineer against) |

**Adaptation note (REWORKCOUNT-001).** The legacy rule specified *one counter shared across two
repair layers* (Planning-fix and Generation-fix). The new Teaching pipeline has only one repair layer
(§17.1's `DRAFT → IN_REVIEW → REJECTED → DRAFT` cycle), so the "shared across two layers" mechanism
has no direct target — `LEGACY_REUSE_AUDIT.md`'s own `OBS` table independently reached the same
conclusion for `LEGACY-REVIEW-NOMIXEDBLAME-001`. The rule's *substance* (one bounded counter, not two
independent ones that could each look bounded while jointly being infinite) is fully preserved by
`TeachingAsset.semantic_rework_count` in §13.7a, since there is exactly one counter and exactly one
layer for it to count.

**Bonus disposition (P2, not required by this closure but resolved anyway).**
`LEGACY-ASST-SOURCETYPES-001`'s catch-all guarantee is closed at Product §24.4/§24.5 (the
`SelectionSource.kind` enum) and Implementation §14.7's `READER_VISIBLE` case, matching legacy's
"no enum gap may block explanation of selectable content" rule exactly, though this was not required
before freeze.

**No `BLUEPRINT_CLOSURE_CONFLICT` was found.** The original four ZCode P1 findings (Outline
publication vs lazy Chapter Preparation; Outline correction granularity; foundation-version vs
artifact-scoped staleness; KP-linked annotation protection — closed at §11.4/§11.5, §19.2a, §16.1a)
were checked against every user-adjudicated decision above during drafting; none conflicts —
Outline/foundation-version/annotation-bookkeeping semantics are orthogonal to Assistant/Master/Review
semantics and compose without contradiction.

### 32.1 P1-5 — Outline conceptual correction (2026-09-03, same-day follow-up)

A subsequent ZCode closure review of the four P1 fixes above found a **new** blocking issue in the
regional-publication mechanism that closed the first Outline finding: `OutlineRegion` made a
Chapter's presence in the directory depend on that Chapter's body-OCR-derived range being "published,"
and used a book-level `outline_version` that could stale an unrelated Chapter's Teaching. A
product-intent clarification then established the root cause: the Outline is primarily the textbook's
**logical directory**, which should exist early from bookmarks/TOC independent of body OCR — the
prior fix had conflated that logical question with physical range resolution.

**Resolution:** §9 of `PRODUCT_BLUEPRINT.md` was rewritten to state the logical/physical split as a
Product invariant (§9.1–§9.3), and this document's §11 was rewritten to match: `OutlineNode` now
carries separate `identity_revision`/`physical_revision` counters per node (§11.1), construction is
staged into a fast whole-book logical pass and a progressive per-node physical pass (§11.2),
correction is a three-tier per-node model (§11.4), `OutlineRegion` is removed (§11.5), Chapter
Preparation depends only on its own Chapter's resolution state (§11.5), and staleness is evaluated
per declared node (§19.2b) rather than against any book-wide counter.

**P1-5 is closed by construction** (§19.2b) — there is no remaining code path by which one node's
resolution advancing can affect another node's declared dependents, so the failure ZCode identified
cannot recur regardless of which Chapters resolve in which order. This also **strictly reduced**
complexity relative to the mechanism it replaced: `OutlineRegion` (a second entity, a `BUILDING |
PUBLISHED` state machine, and a book-level counter) is gone; what remains is two integer fields
already living on the node that needed them.

No conflict was found against the four original P1 closures, the semantic-audit closure (§32 above),
or any Assistant/Master/Review/Teaching decision — the Outline model change is confined to §9–§11,
§12.2/§12.6, §18.2, and §19.1/§19.2b/§19.2, all listed above.

---

**End of IMPLEMENTATION_BLUEPRINT — FROZEN, engineering authority as of Gate D closure (2026-09-03).**
