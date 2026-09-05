# Ask About This Development Report

## Result

`CLOSED` — selecting prepared original-PDF textbook text now exposes `问 AI` in the
existing right-click actions. A temporary right-side Reader panel shows a Simplified-Chinese
DeepSeek explanation and accepts same-level follow-ups. Explicit panel close and Reader close clear
the reader-session conversations from Core Service memory; service restart also clears them. Reader,
selection, marks, search, and directory remain available with AI disabled.

`ASK_ABOUT_THIS_STATUS: CLOSED`

User real-use acceptance and the required independent ZCode narrow review both passed on 2026-09-04.
ZCode explicitly allowed the Phase to close with P0 = 0, P1 = 0, and three deferred non-blocking P2
observations recorded below.

### Real-use blocker correction (2026-09-04)

The first manual review found `问 AI` disabled despite a valid selection and an existing Windows
credential. Read-only diagnosis confirmed that the browser was receiving the newly written static
`app.js` from disk while the resident Core Service (PID 6912, started at 20:08:03) still ran the
pre-Assistant Python handler. Consequently `/api/assistant/status` returned 404; the client reduced
that failure to `configured=false`. Credential Manager itself was not the failure: the fixed target
was readable in the service user's context without exposing its value.

The minimal correction separates selection eligibility, provider readiness, cooling, and status-API
availability in the action state. The readiness response now reports secret-free configuration,
endpoint/model, credential source/reason, cooling/failure state, and `ai_off_reason` fields. Windows
credential failures distinguish not-found, empty, and read-failed conditions without returning OS
error text or credential bytes. The old service was replaced with the current code on the same port
and data directory. Its live status now reports `configured=true`,
`credential_source=WINDOWS_CREDENTIAL_MANAGER`, valid endpoint/model, no cooling, and no AI-off
reason. No provider request was needed for that readiness check.

### Real-use explanation-behaviour correction (2026-09-04)

Manual use then showed that two selections from the same endian paragraph produced near-identical
paragraph summaries. The selection was not lost: live payload inspection showed the correct selected
text, but the client fabricated `这是什么意思` as the visible/user question and the grounding bundle
began with `请只依据下面提供的教材上下文回答`. The combination made the same surrounding OCR the
effective task and incorrectly treated it as the Assistant's knowledge ceiling.

Selection-triggered asks now have no client-supplied question. The Core Service re-resolves the
selection and uses that exact `selected_text` as the visible first user turn; same-level follow-ups
continue to use exactly the typed text. Provider context labels scope/page/OCR as auxiliary textbook
grounding and places the selected focus last for salience. The system boundary distinguishes claims
about the textbook (must be supplied-context-grounded) from explanations of the concept (may use
reliable professional/general knowledge without attributing it to the book).

Teaching strategy is now loaded from the compact skill at
`src/reader_service/assistant/skills/assistant-explanation/SKILL.md` by
`src/reader_service/assistant/skill.py`; `service.py` appends its body to the fixed role/grounding
boundary when the Assistant module loads. Setuptools package data includes the same path for an
installed runtime. The skill body is 9 lines, 863 characters / 875 UTF-8 bytes (about 219 tokens).
It remains compact because five high-leverage rules cover only explanation choices; message display,
selection/context formats, egress, scope, credentials, persistence, routing, and domain answers are
deliberately absent. Future improvement follows replacement/deletion before adding rules.

The post-correction real-provider endian scenarios subsequently passed user real-use acceptance, as
recorded in the closure evidence below.

### Final user real-use acceptance and independent review (2026-09-04)

The user accepted the complete real interaction after the explanation-behaviour correction:

- selection-triggered user messages remained exactly the selected text rather than an invented
  question;
- terms including `大端序` and `小端序` received direct, concept-focused explanations;
- textbook context operated as a grounding and disambiguation anchor, not as the Assistant's
  knowledge ceiling, while supplemental knowledge was not misrepresented as textbook content;
- same-level follow-ups retained their conversation context and reflected the user's actual input;
- the compact Explanation Skill produced the intended teaching behaviour.

The required independent ZCode narrow review returned **PASS**, with **P0 = 0, P1 = 0, P2 = 3**, and
explicitly found `ASK_ABOUT_THIS` eligible for closure. The three P2 observations are accepted as
deferred and non-blocking; none is fixed in this docs-only closure:

1. A future hardening pass should require HTTPS for a configured HTTP provider endpoint whenever the
   target is not loopback, while preserving loopback development/testing use.
2. Closing a reader session concurrently with an in-flight selection ask has an edge race in which
   the completing ask may recreate that session's in-memory conversation after close.
3. `_session_locks` entries are not removed, allowing slow process-memory growth across many unique
   reader session IDs.

## Implemented

- An `ASSISTANT`-only agent runtime owns the sole provider egress path. The one adapter is DeepSeek's
  OpenAI-compatible chat-completions API. It uses Python stdlib HTTP only, refuses redirects, ignores
  environment proxy routing, and can contact exactly one configured endpoint.
- Provider routing is configuration-driven for endpoint, model, temperature, output-token budget,
  and timeout. Missing/invalid configuration or key disables only Ask. Transient failures retry at
  most three total attempts with backoff; auth/quota/billing failures do not retry; exhausted or
  user-actionable failures start a 30-second cooling period.
- The normal credential path reads a Windows Generic Credential with fixed target
  `408-guided-reader-deepseek`. `GUIDED_READER_DEEPSEEK_API_KEY` and the explicit testing disable flag
  are development/testing conveniences only. No key or provider header enters database state,
  payload inspection, logs, or user-visible errors.
- A pure-read resolver walks the existing Outline topology. It returns the deepest uniquely
  supported Section/Subsection only when start-page evidence is unambiguous. Incomparable same-page
  Section starts force `PAGE:<pdf_page_index>`; a uniquely containing Chapter title may still be
  supplied without changing the isolation key. No node or resolution state is written.
- The context builder re-resolves the client selection against READY OCR, limits selected text to
  2,000 characters, includes at most three surrounding same-page lines on each side and 1,600 OCR
  context characters, and includes only safe Section/Chapter title plus a known printed label.
  Notes, highlights, learning history, and all other application state are absent from its API.
- Selection-triggered visible turns are the exact server-resolved selection, never an invented
  question. A compact loaded Explanation Skill governs teaching strategy while the fixed system
  boundary preserves the distinction between textbook claims and reliable concept knowledge.
- One conversation exists per scope per reader session. Histories never cross scope keys; follow-up
  context uses at most six prior turns and 8,000 characters. PAGE conversations are not merged into
  SECTION conversations. There is no Child/depth/tree creation and no Ask affordance on answer text;
  the panel input is the only continuation path.
- Conversation state is plain Core Service memory. No schema, migration, conversation table, cache
  file, or file-capture product path was added. A bounded 20-call process-memory inspector exposes
  the exact provider request bodies through the authenticated localhost API only.
- The Reader adds the Chinese side panel, pending/error states, honest disabled Ask action, explicit
  destructive close, unload cleanup, and automatic cooling recovery without making PDF opening wait
  on AI availability.

## Important implementation decisions

- **D-4 resolved:** DeepSeek is the first and only adapter in this Phase.
- **D-5 confirmed:** the frozen §21.3 recommended egress boundary is implemented: bounded
  user-initiated context only, no telemetry/analytics, locally inspectable provider request bodies,
  and no note/highlight/learning-history egress.
- `IMPLEMENTATION_BLUEPRINT.md` §26 still carries D-4 and D-5 as open rows. That Frozen Blueprint was
  deliberately not edited; its synchronization remains the user's action.
- Provider request bodies use a short fixed grounding boundary, the compact Explanation Skill, and
  explicit labelled auxiliary-source fields with the selected focus in the highest-salience final
  position. Conversational answers remain prose rather than introducing a structured-output platform.
- The inspector deliberately outlives an individual closed conversation until bounded eviction or
  service restart, because it is temporary observability evidence, not conversation state. It remains
  in process memory only.

## Deviations from Spec

None. The implementation is the accepted narrow slice only: no second provider, generic agent
platform, tool loop, review routing, Master/Guide/Teaching/KP work, saved notes, recursive Child UI,
multimodal content, VisualRegion, Pass 2, cross-page selection, or OCR regeneration.

The 348-page real book exposes an important honest outcome rather than a deviation: stored bookmark
evidence gives both `6.2.1 总线事务` and `6.2.2 总线定时` the same PDF start page (index 302). The
accepted brief explicitly forbids choosing the latest-starting sibling, so the real `6.2.1` ask is
correctly isolated as `PAGE:302`, with safe `第6章 总线` context and printed page `291`, not falsely
claimed as SECTION.

## Acceptance evidence

- `python -m compileall -q src`: **PASS**.
- `pytest -o addopts= -q -ra`: **72 passed, 2 skipped**. The two skips are the unchanged optional
  external-path OCR calibration tests; their same real books were used in browser acceptance.
  Coverage includes selection/context bounds, unique SECTION, ambiguous same-page PAGE, front matter
  PAGE, safe Chapter context, unsafe title exclusion, per-scope history isolation, fallback
  non-merge, zero-network AI-off, exact payload inspection, endpoint lock, redirect refusal,
  transient retries, auth/quota no-retry, cooling, invalid configuration degradation, memory-only
  restart/close, absence of conversation tables/files, note exclusion, secret-safe errors/logs, and
  the localhost HTTP contract.
- `npm test`: **30 passed** — geometry and selection remain green.
- `npm run test:e2e:ask`: **PASS** against the prepared real 29/348-page library with a local mock
  provider. It exercised actual PDF.js selection/right-click → mock answer → panel, two same-level
  turns, explicit no-selection disabled and valid-selection enabled states, secret-free readiness
  metadata, exact selection text in the user bubble, absence of a fabricated client question,
  selected-focus payload ordering, verbatim follow-up payload, no answer-text Ask affordance,
  exact inspected request bodies, configured-endpoint-only
  traffic, Reader close and explicit panel close cleanup, `PAGE:302`, 29-page `PAGE:0`, and AI-off
  selection/directory/search availability. The panel screenshot was visually inspected; it is an
  ignored test artifact, not persisted product content.
- `npm run test:e2e:ask:real`: **PASS** with the user's real Credential Manager key and the default
  `https://api.deepseek.com/chat/completions` endpoint. On the 348-page book, PDF index 302 / printed
  page 291, a real sentence under `6.2.1 总线事务` was asked `这是什么意思`; the final run returned a
  relevant 253-character Chinese explanation using bus-transaction context. `再简单一点` returned a
  127-character answer in the same two-turn conversation. Reader close invalidated the old
  conversation. The 29-page real excerpt exercised `PAGE:0`. Restarting with the testing disable
  flag left selection, directory, and search usable.
  This run predates the explanation-behaviour correction and remains evidence for provider/egress/
  lifetime wiring, not acceptance of the new endian explanation behaviour.
- Existing real-browser regressions: `npm run test:e2e:map` **PASS** on both books with stable trees,
  page labels and original-PDF navigation; `npm run test:e2e:r3` **PASS** on both books including
  selection/copy, marks persistence/deletion, restart and cleanup; `npm run test:e2e:find` **PASS**
  with 6/10 matches on 29/348 pages.
- Blocker-fix rerun: `npm run test:e2e:r3` **PASS** on both real books after the action-state change,
  covering selection/copy and highlight/note create, persist, delete, restart, and cleanup paths.
- Three preliminary mock-browser harness invocations are explicitly not counted as PASS: one pointed
  at an empty LocalAppData library, one incorrectly expected SECTION on the deliberately ambiguous
  real page, and one contained a JavaScript response-status typo. The data path and harness
  assertions were corrected; the final bounded reruns above passed.

Overall status: `CLOSED`. Machine acceptance, user real-use acceptance, and the required independent
ZCode narrow review all passed. The three P2 observations above are deferred/non-blocking and do not
prevent closure.

## Known limitations / deferred debt

- Pass 1 cannot distinguish `6.2.1` from `6.2.2` on their shared start page. That page remains
  honestly PAGE-scoped until a separately authorized Pass 2 supplies physical evidence.
- The first request is single-response rather than streamed. The panel shows a bounded pending state.
- Provider teaching quality is not deterministically schema-validated; focused endian behaviour was
  accepted through real use rather than claimed from schema tests alone.
- A credential can be detected as present without proving validity; invalid auth/quota is classified
  on the first user-initiated call, shown honestly without retry, and cooled.
- Payload inspection is an authenticated localhost API rather than a dedicated UI. Its bounded
  contents disappear on service restart and are never written to disk.
- All exclusions in the accepted brief remain excluded, including cross-page selection and
  Assistant answer recursion.

## Reproducible entry points

```powershell
python -m compileall -q src
pytest -o addopts= -q -ra
npm test

$env:READER_DATA_DIR='D:\path\to\prepared-real-library'
npm run test:e2e:ask       # local mock provider; no real key required
npm run test:e2e:ask:real  # real DeepSeek via Windows Credential Manager
npm run test:e2e:map
npm run test:e2e:r3
npm run test:e2e:find
```

Manual replay for the current correction: select `大端序`, right-click `问 AI`, and confirm the user
bubble is exactly `大端序` and the answer directly explains that concept. Repeat with `小端序` from
the same paragraph and confirm a distinctly focused explanation. Continue the first conversation
with `为什么要这么存？` and then `还是不懂，再简单点。`; the second answer should change teaching
strategy rather than paraphrase. Confirm added professional knowledge is not attributed to the book,
and challenge one incorrect interpretation. Then close/reopen Reader, exercise PAGE/SECTION scope and
29-page PAGE fallback, and disable the credential to confirm reading, marks, search, and directory
remain functional.

## Important files / architecture entry points

- `src/reader_service/agent_runtime/credentials.py` — fixed Credential Manager target and dev/test
  override boundary.
- `src/reader_service/agent_runtime/deepseek.py` — sole HTTP adapter, typed remote failures, and
  redirect/proxy refusal.
- `src/reader_service/agent_runtime/runtime.py` — provider profile, payload inspector, bounded retry,
  cooling, and secret-free structured logging.
- `src/reader_service/assistant/context.py` — pure-read scope resolution and bounded egress context.
- `src/reader_service/assistant/skills/assistant-explanation/SKILL.md` and `skill.py` — compact
  teaching strategy and its runtime loader.
- `src/reader_service/assistant/service.py` — memory-only per-session/per-scope conversations.
- `src/reader_service/server.py` — authenticated localhost status/ask/follow-up/close/inspection API.
- `src/reader_service/static/index.html`, `app.js`, `styles.css` — right-click action, temporary panel,
  same-level follow-up, AI-off UI, and close lifecycle.
- `tests/test_ask_about_this.py`, `tests-e2e/ask-about-this.mjs`,
  `tests-e2e/ask-about-this-real.mjs` — machine, real-browser mock, and real-provider acceptance.

## Git checkpoint

Implementation checkpoint: `6093d92f37af52796d68b42e0e65dc5faa6037d5`.
Explanation-behaviour checkpoint: `69d361e1b6857fd146f66d0027556b764be386ee`.
The docs-only closure commit hash is recorded in the completion handoff.
