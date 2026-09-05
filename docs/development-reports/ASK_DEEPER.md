# Ask Deeper Development Report

## Result

`IMPLEMENTATION_READY`

`READY_FOR_USER_RETEST`

`REVIEW_REQUIRED: NO`

The Reader Assistant is now a memory-only explanation workspace. Every non-Assistant Reader
selection creates a retained topic at depth 1; selecting text in the current Assistant answer can
create one deeper explanation at a time, up to depth 5. Users can continue at the same level, return
to a parent, switch retained topics, see the current `n/5` depth, and close exactly one topic and all
of its descendants. Closing/reopening the Reader or restarting the service clears all Assistant
trees.

The first user retest exposed a pre-send readiness failure when the Core Service was running under a
Windows identity that could not see the user's Credential Manager entries. The draft was valid, but
Send was a silent disabled button. The Reader now evaluates readiness from the currently selected
provider's live status, refreshes status when a draft is created or its model changes, sets the real
ARIA disabled state, and shows the exact selected-provider configuration, credential, development,
or cooling reason whenever Send must remain unavailable.

This report does not claim user acceptance. No independent review was run because no review
escalation condition fired.

## Implemented

- Replaced the single-conversation memory model with `ReaderAssistantState`, `AssistantRoot`, and
  `AssistantNode`. Roots own scope, source lineage, provider/model, depth-1 turns, focus, and their
  node collection; nodes own a parent reference, structural depth 2–5, same-level turns, and one
  active-child reference.
- Added the single depth-increasing `create_child` transition. It validates the focused parent,
  latest answer turn, selected character range, depth limit, and active/pending Child before any
  provider call. A per-session lock makes the pending-child reservation atomic, so concurrent calls
  have one winner and one typed rejection.
- Added typed selection-source routing. `ORIGINAL_PDF` creates a new Root even in an existing scope;
  `ASSISTANT_ANSWER` is structurally rejected by the Root endpoint and can proceed only through
  `create_child`.
- Added a dedicated Child context assembler containing only the current answer selection and range,
  complete triggering parent turn, originating Reader lineage, current Root scope, bounded same-page
  OCR reference context, parent/child relationship, and depth. It never traverses the Root tree or
  reads other Roots, scope history, notes, highlights, or learning state.
- Kept same-level context bounded by the existing six-turn / 8,000-character budget. Provider
  transport retry reuses one interaction ID and never creates a Child or a second referenceable turn.
- Pinned provider/model on each Root and routed Child, same-level follow-up, and retry through that
  server-side binding. Only a new Reader selection can establish a newly selectable Root.
- Added focus, parent navigation, Root close, and Reader-session close endpoints. Session generation,
  state/focus versions, and post-response compare-and-set checks prevent in-flight results from
  resurrecting a closed Root, attaching to the wrong node, or stealing focus after a switch.
- Added a compact Simplified-Chinese Reader UI: retained-topic switcher, breadcrumb, parent/child
  navigation, `n/5`, per-topic close, and a floating `再问一层` action on the latest current answer.
  Merely hiding the Assistant panel does not destroy state.
- Corrected pre-send readiness to use the selected provider's own current status instead of the
  older derived readiness booleans. Draft creation and model changes trigger a fresh status read;
  the disabled Send button now has `aria-disabled="true"` and an adjacent visible reason naming the
  affected provider and credential target or configuration state. Other providers do not influence
  this decision.
- The lifecycle implementation naturally replaced the old unreclaimed `_session_locks` map with
  reclaimable per-session slots; closing a Reader removes the complete slot.

## Important implementation decisions

The server is the state authority. The browser holds a rendered copy of the complete temporary
workspace, but sends only IDs and the current answer's character range for a Child. The server
re-derives the selected text from the stored answer, rejects stale/non-current turns, and assembles
provider context from the owning Root and direct parent only.

One-active-child is a reservation followed by commit: under the session lock the parent receives a
private pending interaction ID; the provider call runs without holding the lock; commit succeeds only
if the same session generation, Root, parent, and reservation still exist. Provider failure clears
only that reservation. Root/session close can therefore win safely while the network call is in
flight, and the late answer is discarded with a typed cancellation.

Focus is deliberately independent from tree ownership. A Root remembers its focused node; switching
away and back restores that node. A response may mutate its owning tree but changes visible focus
only when the focus version and original parent still match.

Provider status is intentionally live rather than captured when the service starts. The backend
reads Credential Manager on every status/send path. The browser re-reads `/api/assistant/status`
when staging a Reader-selection draft and when changing its pre-send provider, then derives the
button state from that selected provider only. A failed provider cannot disable or select another
provider, and a successful Root still becomes the sole server-authoritative provider/model lock for
its complete tree.

## Deviations from Spec

None. No persistence, migration, new provider endpoint, fallback, proxy/redirect change, telemetry,
source/scope authority change, or expanded Child context was introduced. Frozen Blueprints were not
modified.

## Acceptance evidence

- `python -m compileall -q src`: **PASS**.
- `pytest -o addopts= -q -ra --basetemp=test-results/pytest-final-ask-deeper-20260906-a`:
  **95 passed, 2 skipped**. The two skips are the unchanged optional external-path OCR calibration
  cases (`READER_REAL_DMA`, `READER_REAL_PRIMARY`). Coverage includes depth 1→5, typed depth-6
  rejection, same-level follow-up at depth 5, retry identity, source anti-bypass, multi-Root state,
  focus retention, subtree close, per-parent concurrent Child creation, provider/model pinning,
  provider failure rollback, exact Child-context isolation, close/in-flight races, restart cleanup,
  secret hygiene, AI-off, and absence of Assistant persistence/schema additions.
- `npm test`: **30 passed**. `node --check` passed for the Assistant client and all directly affected
  Ask/provider real-use harnesses.
- `npm run test:e2e:ask` with `READER_DATA_DIR=var/manual-browser`: **PASS** on the prepared real
  29/348-page library with the loopback mock provider. It exercised a three-level tree, same-level
  depth stability, two retained Roots, Root switching, parent/back, selective Root close,
  one-provider tree pinning, source anti-bypass, minimal Child payload, in-flight close cancellation,
  Reader-close cleanup, Reader reopen with zero stale Root options, AI-off Reader regressions, and
  a Zhipu-selected credential-unavailable draft that makes zero provider calls, has a genuinely
  disabled/`aria-disabled` Send control, and visibly names the Zhipu credential problem. Switching
  that same draft to an available DeepSeek profile immediately re-enables Send without egress.
  The depth-3 UI screenshot was visually inspected at `test-results/ask-deeper-depth-3.png`.
- Existing 348-page browser regressions after the final lifecycle correction:
  `npm run test:e2e:r3` **PASS**, `npm run test:e2e:find` **PASS**, and
  `npm run test:e2e:map` **PASS**. These cover Reader selection/copy/annotation behavior, R3, Find,
  Map, persistence cleanup of their own data, and original-PDF navigation.

### User-acceptance readiness delta

The failed screenshot flow was reproduced against the already running service and the real 348-page
textbook: PDF page 263, selection `识别异常和中断`, model Zhipu `GLM-5.3-Flash`. Before the fix the
actual DOM was `button.disabled=true`, no `aria-disabled`, empty CSS class, an enabled Zhipu selector,
zero Roots, and no Root-lock indicator. The exact old disabled expression was
`!assistantDraft || !assistantConfigured || assistantCooling || assistantPending`; the sole true term
was `!assistantConfigured`.

The listener was owned by `CYM\CodexSandboxOnline`, while the credentials had been saved for
`CYM\26389`. Its real status contract reported all three providers with
`configuration_valid=true`, correct provider/model identity, `configured=false`,
`credential_available=false`, `credential_reason=CREDENTIAL_NOT_FOUND`, `cooling=false`, and no
`DEVELOPMENT_DISABLED`. There was no frontend/backend shape disagreement, no startup-only credential
cache, no OpenRouter-wide readiness gate, and no mistaken pre-Root provider lock. Restarting the
same code under `CYM\26389` changed the live status for all three providers to `configured=true`,
`credential_available=true`, `credential_source=WINDOWS_CREDENTIAL_MANAGER`, and `cooling=false`.
The backend still rereads those credentials rather than preserving this result as startup state.

After the minimal UI correction, the same page-263 draft made zero calls before Send, selecting
Zhipu left Send at `disabled=false` and `aria-disabled=false`, and the first answer succeeded. The
Root locked Zhipu and a same-level follow-up also succeeded through Zhipu. A separate page-74
`大端方式` Root succeeded and locked DeepSeek `deepseek-v4-pro`. A new `小端方式` draft reopened
model selection; its OpenRouter `google/gemini-3.8-flash` request returned the existing typed
`model_region` failure and visibly stated that no provider/proxy switch occurred. No failed Root was
created. Switching back restored the complete DeepSeek Root at depth `1/5`, and a DeepSeek follow-up
succeeded. The separate Zhipu browser session still retained both Zhipu turns and its Zhipu lock.

This retest issued five provider requests total: Zhipu twice, DeepSeek twice, and OpenRouter once.
The local secret-free inspector captured the Zhipu calls as provider `zhipu`, model
`GLM-5.3-Flash`, direct endpoint `https://open.bigmodel.cn/api/paas/v4/chat/completions`, attempt 1,
with message counts 2 then 4. The remaining direct-provider identities were corroborated by their
server-authoritative Root locks and the OpenRouter-specific typed failure; machine payload tests
continue to inspect every request body and prove provider pinning, no fallback, and no cross-Root or
cross-scope context. No credential, Authorization header, note, highlight, learning state, or
unrelated Root content was exposed by the inspector.

The final regression set after this correction was: `python -m compileall -q src` **PASS**;
`pytest -o addopts= -q -ra --basetemp=test-results/pytest-ask-deeper-user-retest-fix`
**95 passed, 2 skipped** (the unchanged optional external-path OCR cases); `npm test`
**30 passed**; all directly relevant `node --check` invocations **PASS**; and, with the real prepared
library data directory, `npm run test:e2e:ask`, `test:e2e:r3`, `test:e2e:find`, and
`test:e2e:map` all **PASS**. One earlier Ask E2E launch without `READER_DATA_DIR` correctly failed
because that default library did not contain the 348-page book; rerunning with the required real
library path passed.

### Authorized five-call DeepSeek acceptance

On 2026-09-06 the real harness used the prepared 348-page textbook (SHA-256
`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`) and the user's strict
five-call authorization for DeepSeek `deepseek-v4-pro`:

1. created an “大端方式” Root;
2. selected a term in that real answer and created depth 2;
3. selected a term in the depth-2 answer and created depth 3;
4. returned to the textbook and created a second “小端方式” Root;
5. switched back to the first Root and made a same-level follow-up at depth 3.

All five calls returned HTTP 200 before the harness advanced. Both Root answers passed Chinese,
minimum-length, and endian/address/byte relevance assertions; both Child answers and the same-level
answer passed Chinese/minimum-length assertions. The first tree was still focused at depth 3 after
switching back, and the same-level turn left depth unchanged.

The in-memory inspector reported exactly five calls, all to provider `deepseek`, model
`deepseek-v4-pro`, and the unchanged direct endpoint
`https://api.deepseek.com/chat/completions`. The inspected Child request had exactly `system,user`
messages, included the selected term and complete triggering parent answer, and no unrelated Root
answer. The fifth request after switching back contained no second-Root answer. Inspection contained
neither an `Authorization` field nor an API-key pattern. Machine payload tests additionally prove
that later Child creation does not walk the ancestor tree or include another scope, notes,
highlights, or learning state.

After these five successful calls, the command exited non-zero only at its final client lifecycle
assertion: the old backend session was already gone (the stale follow-up returned 404), but the
reopened panel still contained one hidden stale `<option>`. The fix now clears navigation DOM during
Assistant reset, and the identical close/reopen assertion passes in the full 348-page mock E2E. The
real provider harness was deliberately not rerun because all five authorized calls had been used.
Thus the real-provider egress portion and all pre-failure real-book assertions passed; the final
client-only correction is supported by post-fix same-material mock evidence rather than an
unauthorized sixth DeepSeek call.

## Known limitations / deferred debt

No Ask Deeper-specific completion debt remains. Streaming, persistence, saved AI notes,
multimodal/figure explanation, cross-page selection, and later teaching/mastery features remain
outside this Phase. Existing provider-region/default-provider decisions are unchanged. The previous
`_session_locks` memory-growth P2 was retired naturally by the scoped lifecycle implementation.

## Reproducible entry points

```powershell
python -m compileall -q src
pytest -o addopts= -q -ra --basetemp=test-results/pytest-ask-deeper
npm test

$env:READER_DATA_DIR='D:\path\to\prepared-real-library'
npm run test:e2e:ask
npm run test:e2e:r3
npm run test:e2e:find
npm run test:e2e:map
```

`npm run test:e2e:ask:real` requires a configured DeepSeek credential and makes exactly five real
calls; run it only with fresh user authorization. Manual retest: select “大端方式”, send the Root,
select a term in the latest answer and use `再问一层` two times, make a same-level follow-up, create
“小端方式” as a second topic, switch back, navigate to a parent, close one topic, then close/reopen
the Reader and verify the workspace is empty.

## Important files / architecture entry points

- `src/reader_service/assistant/service.py` — in-memory Root/Node state machine, atomic reservations,
  provider pinning, focus, close, and lifecycle CAS.
- `src/reader_service/assistant/context.py` — Root context and exact minimal Child payload assembly.
- `src/reader_service/server.py` — typed HTTP transitions and failure mapping.
- `src/reader_service/static/app.js`, `index.html`, `styles.css` — compact Reader-native workspace,
  answer selection, navigation, and lifecycle rendering.
- `tests/test_ask_about_this.py`, `tests-e2e/ask-about-this.mjs`, and
  `tests-e2e/ask-about-this-real.mjs` — state-machine, browser/mock, and authorized real-provider
  acceptance.

## Git checkpoint

Implementation checkpoint: `491a6eb`.

The report checkpoint is the commit containing this report.
