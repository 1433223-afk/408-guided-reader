# Phase / Ask About This

## Goal

The product's first AI: select original-textbook text in the Reader, ask for an explanation, and get
a temporary answer that knows which Section of the book you are reading. No durable AI state, no
review pipeline, no teaching — the teacher appears, briefly and attached to the book.

## User-visible result

> "我在 6.2.1 总线事务 里选中一句看不懂的话，右键「问 AI」，右侧面板给出一个知道我在第 6 章哪一节的
> 中文解释；可以继续追问；关闭 Reader，对话即清空。"

## Authority to read

**Product Blueprint:**
- §1 — thesis; this slice lands the first "local explanation"
- §2 — primary invariant (the answer is attached to the original PDF surface; nothing replaces it)
- §18 — AI is optional and user-controlled; the Original-only / AI-off path must keep working
- §24 preamble, §24.1–§24.3 — Assistant works without KP/Guide/Teaching; Section scope preferred,
  honest page-scope fallback that never guesses and is never auto-merged; explainable sources;
  temporary lifetime
- §38 decisions 27, 28, 46 — fallback scope isolation; conversation clears on close; Assistant
  defaults to no independent review

**Implementation Blueprint:**
- §13.1–§13.5, §13.6, §13.8 — agent/provider/context/worker separations; context isolation;
  config-driven routing with graceful absence; conversational output exempt from schema validation;
  grounding with provenance; typed failures, bounded retry, cooling
- §14.1, §14.2, §14.7 — scope resolution incl. PAGE fallback; in-memory-only lifetime keyed by
  reader session; Root-creation source gating (as narrowed by this brief's Not-now list)
- §21.2, §21.3 — provider credentials in the OS credential store; the single egress boundary
- §24 (Phase R5 entry) — direction this slice is a narrow subset of; it does not authorize the rest
  of R5
- §26 D-4 / D-5 — the two user decisions this Phase resolves (recorded below)

**User decisions recorded (2026-09-04):**
- **D-4 resolved:** first and only adapter in this Phase is **DeepSeek** (its OpenAI-compatible HTTP
  API). The §26 table row is not edited here — Frozen Blueprint sync is the user's action, recorded
  in this brief and in the Phase's development report.
- **D-5 confirmed:** the §21.3 recommended boundary as written — bounded user-initiated context only;
  no telemetry/analytics; exact payloads inspectable locally; notes/highlights/learning history never
  sent. No extra per-request confirmation UI.

## Hard rules

- **One egress boundary.** Only the agent runtime makes network calls, and only with context
  assembled by the context builder: selected text + bounded surrounding OCR context + safely resolved
  Section/Chapter title (per the scope rule below) + printed label when known. Nothing else leaves
  the machine; no telemetry; the exact payload of every provider call is inspectable locally (§21.3,
  confirmed D-5).
- **AI-off is a first-class state.** Missing or invalid provider configuration/key disables the ask
  capability honestly — Reader, search, marks, and directory remain fully functional and no network
  call is attempted (§13.4, Product §18, §20).
- **Temporary by structure.** All conversation state lives in Core Service memory keyed by reader
  session, never in the database; closing the Reader clears it; a service restart clearing it is
  correct behaviour, not data loss (A-11, §14.2, decision 28).
- **Inspection is local, temporary, and secret-free.** Exact-payload inspection covers the provider
  request body/context only, through a bounded local surface (process-memory buffer or localhost-only
  endpoint) — never a persistent content copy on disk. The normal runtime path persists nothing about
  a conversation: no selected text, OCR context, user question, or answer is written to disk; any
  file capture is an explicit development/testing opt-in outside the product path. Authorization
  headers, the API key, Credential Manager secrets, cookies, and any secret header never enter the
  inspection surface or logs (§21.3, §21.5, confirmed D-5).
- **Scope isolation, never a guess.** Section scope is claimed only when existing physical evidence
  **uniquely determines** the containing Section/Subsection. Start-page evidence alone decides it:
  if several Section candidates start on the same PDF page (e.g. `6.2.1` and `6.2.2` both beginning
  on one page) and no safe evidence distinguishes them, the scope is honestly
  `PAGE:<pdf_page_index>` — never the latest-starting guess. When the Section is ambiguous but the
  containing Chapter is itself uniquely resolved, the isolation scope remains PAGE and the Chapter
  title may still enter the bounded context — the scope key never becomes a Chapter. A fallback
  context is never merged into a later-resolved Section conversation (§14.1, decisions 27). Scope
  resolution is a pure read over Outline; it never mints nodes or changes any resolution state, and
  it never attempts to resolve same-page ambiguity — that is Pass 2's job, not this slice's.
- **Follow-ups yes; answer-text-triggered asks no.** Same-level multi-turn follow-ups typed in the
  panel input (「为什么？」「再简单点」) are fully supported — they append turns to the current
  conversation and never change depth or tree shape (§14.4). What this slice excludes is the
  *selection-triggered* path: selecting a range inside an Assistant answer and asking a new question
  of that selection (Child creation, §14.5), or opening any new Root from answer text (§14.7). The
  structural anti-bypass rule is satisfied by there being no ask affordance on Assistant answer text
  at all — the panel input is the only continuation path, and it stays at the same level.
- **Grounding.** Every factual claim about the textbook must trace to the supplied context; no
  fabricated quotes or page labels (§13.6). Conversational output is not schema-validated (§13.5
  exempts it), but failures are typed and honest (§13.8).
- **No persistence, no review, no mastery.** No Save-to-Notes (its verification path, §30.5, is
  deferred); no review calls in either direction (§30.4 default); nothing writes learning state.

## Build

- Minimal agent runtime: the `ASSISTANT` role only; one DeepSeek adapter behind §13.4-style
  configuration-driven routing (base URL, model, params, token budget); the provider key is read at
  runtime from Windows Credential Manager under the fixed target name
  `408-guided-reader-deepseek` (already created by the user); an environment-variable override
  exists only as a development/testing convenience and is never the normal product path (§21.2);
  typed failures per §13.8 — transient (bounded retry with backoff), user-actionable
  (auth/quota/billing: stop and surface clearly, no retry), with a cooling period for a repeatedly
  failing provider.
- Deterministic scope resolver: current page + selection → SECTION scope only when existing safe
  targets uniquely determine the Section; same-page ambiguity → honest PAGE fallback, with the
  uniquely resolved Chapter title still entering the context where the Chapter is safe; exact
  boundary mechanics are autonomy.
- Context builder per the egress rule: selected text, bounded before/after lines from the same
  page's READY OCR rows (same spirit as annotation quote/context), safely resolved Section or
  Chapter title, printed label when known, bounded token budget. Notes, highlights, and learning
  state are never inputs.
- Conversation: one temporary conversation per scope per reader session, with same-level multi-turn
  follow-ups appending turns; switching scope starts/switches to that scope's own conversation
  without mixing histories; explicit close and Reader close clear all of it.
- Reader UI: with an active text selection, the existing right-click interaction gains a
  「问 AI」entry; a side panel shows the question/answer stream in Simplified Chinese, surfaces typed
  failures honestly (e.g. key missing / quota / network), offers explicit close, and shows an honest
  disabled state when AI is unconfigured.
- Local observability: exact provider request bodies/contexts are inspectable through a local,
  temporary, bounded surface (process-memory buffer or localhost-only endpoint); the normal runtime
  path writes no conversation content to disk, and any file capture is an explicit development/
  testing opt-in outside the product path; secrets never enter the inspection surface; structured
  logs record identifiers and versions, not content bodies (§21.5, §22).

## Not now

- **Recursive explanation (Child creation, depth ≤ 5, one-active-child) and multi-Root focus UI** —
  the full §14.3–§14.7 state machine; this slice has exactly one conversation per scope and no ask
  affordance on answers.
- **Save to Notes and its verification requirement** (§30.5) — the only durable promotion path, and
  it drags verification policy with it.
- **Figure/table/formula explanation and multimodal crops** — requires VisualRegion/on-demand crops
  (D-3 territory) and a multimodal provider; the in-figure OCR trust tier (§13.6a) also depends on
  regions that do not exist yet.
- **Master, Reading Guide, Inline Guidance, KP, Chapter Preparation, any Teaching asset, any review
  routing** — later phases; nothing here builds their scaffolding.
- **A second provider adapter** — D-4 was decided as one adapter; the routing seam (§13.4) is the
  only thing kept open for it.
- **Pass 2 physical resolution, outline correction UI, structure-scoped search, cross-page continuous
  selection, OCR regeneration round-trip, `geometry.js` authority, lazy/idle OCR policy, and the
  three Map-the-Book P2 observations** — all standing debt, none pulled in by this Phase.
- **No generic agent platform** — no plugin system, no tool-calling loop, no provider abstraction
  beyond the one interface this slice needs.

## Acceptance

Machine (mock provider adapter; no real key needed):
- A selection ask produces a context assembled exactly from the bounded declared inputs; the mock
  answer round-trips into the panel; same-level follow-ups stay in one conversation.
- Typed failures behave per §13.8: transient → bounded retries then an honest failure surface;
  auth/quota → immediate clear Chinese message, no retry; a repeatedly failing provider cools down
  instead of stalling anything else.
- With no provider configured, the ask entry is honestly disabled and zero network calls occur;
  reading, selection, marks, search, and directory all still work.
- Scope resolver: a page with exactly one safe Section candidate resolves to that Section's scope; a
  page where several Section candidates share a start page (fixture with two same-page siblings)
  yields honest PAGE scope; a front-matter or otherwise unresolvable page yields PAGE scope; when
  the Section is ambiguous but the Chapter is unique, the Chapter title still enters the context
  while the scope stays PAGE; two different scopes never share conversation history; a fallback
  conversation is never merged into a Section conversation.
- Payload honesty: the inspectable payload of a PAGE-scope ask contains no Section title that was
  not safely resolved.
- Memory-only: after a service restart, no trace of any conversation exists in the database or
  process state; Reader close clears per-scope conversations.
- Egress: the payload inspector shows the exact provider request body/context for each call; an
  assertion verifies only the configured provider endpoint is contacted; logs contain no answer or
  context bodies; the default configuration writes no conversation content (selected text, OCR
  context, question, answer) to disk anywhere — file capture, if implemented at all, is opt-in and
  absent from the normal product path.
- Secret hygiene: the API key, Authorization header, Credential Manager secret, and any secret
  header never appear in payload-inspection output, structured logs, or any error surface — asserted
  across code paths including the failure paths (auth/quota/network/timeout).

Real-use (348-page book with the user's real DeepSeek key):
- Select a real sentence in `6.2.1 总线事务`, ask 「这是什么意思」, and receive a relevant Simplified-
  Chinese explanation whose context use reflects the Section; ask a follow-up (e.g. 「为什么？」) and
  stay in the same conversation; close the Reader, reopen, and the conversation is gone.
- Remove/disable the key: the Reader remains fully usable and the ask entry is honestly disabled.
- On the 29-page excerpt, one page-scope ask on an excerpt page exercises the PAGE fallback path.

## Autonomy

Per `AGENTS.md` §5: HTTP client choice (stdlib or one ordinary library), streaming vs single-response
rendering, prompt wording, retry/cooling bounds, config file shape, credential-helper library choice,
payload-inspector form (bounded in-memory buffer or localhost-only surface; any file capture is
dev/test opt-in, never a product path), panel layout and interaction details, test structure, and
small local refactors. Prompt wording is not frozen — but the egress, inspection, and grounding Hard
rules bind every prompt this slice ships.

## Must report before proceeding

- The DeepSeek API's actual shape departs from OpenAI-compatible enough that more than one thin
  adapter is needed, or any additional substantial dependency (beyond an ordinary HTTP client /
  credential helper) becomes necessary.
- Grounding or local payload inspection cannot be satisfied with the chosen API surface.
- Any need to persist conversation state, contact a second endpoint, or send anything beyond the
  bounded context list — these would breach §21.3 / A-11 and are not implementation details.
- `AGENTS.md` §5's conditions generally.

## Completion

- Machine acceptance with the mock adapter; real-use acceptance with the user's real key as above.
  If the key is not yet available at completion time, label the result `IMPLEMENTATION_READY` and
  name the real-use pass as pending — do not simulate it.
- One development report in `docs/development-reports/` recording, among the important decisions,
  the D-4 (DeepSeek) and D-5 (§21.3 recommended boundary, confirmed) resolutions; note explicitly
  that `IMPLEMENTATION_BLUEPRINT.md` §26 still carries them as open rows pending the user's Frozen
  Core sync.
- One git checkpoint commit.
- **Independent (ZCode) review is required for this Phase** — it installs the product's first
  network egress boundary, its first credential handling, and the scope-isolation contract
  (`AGENTS.md` §5 risk-triggered categories: security boundary). Scope the review to the egress
  boundary, credential handling, context bounds, scope isolation, and memory-only lifetime — not UI
  polish.
