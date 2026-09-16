# Provider Bake-off Development Report

## Result

`COMPLETE` — user retest passed and ZCode narrow independent review passed. The accepted
implementation preserves the reviewed security boundary and the normal Reader's compact
single-model Assistant interaction: the user selects one model before the first request, exactly one
provider is called per turn, and that provider/model remains pinned for follow-up within the
memory-only conversation. The former comparison input/button and three-column panel do not exist in
the Reader UI; the gated comparison endpoint remains available only to the development benchmark
harness.

`PHASE_STATUS: CLOSED`

`USER_ACCEPTANCE: PASS`

`NARROW_INDEPENDENT_REVIEW: PASS (P0=0 / P1=0 / P2=3)`

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING: OPENROUTER_MODEL_REGION_ACCESS`

`DEFAULT_ASSISTANT_PROVIDER_DECISION: OPEN`

The final 348-page run produced 10/10 answers from DeepSeek and 10/10 from Zhipu. OpenRouter returned
HTTP 403 `model_region` for the frozen `google/gemini-3.8-flash` model on every direct attempt outside
its cooling window. System-proxy routing is forbidden and remained disabled; the model and endpoint
were not substituted. Consequently this is not a completed three-provider real-material acceptance,
and no winner/default-provider decision is recorded.

## Implemented

- The named set is closed to `deepseek`, `zhipu`, and `openrouter`, with fixed credential targets and
  the user-confirmed model IDs. `GUIDED_READER_ASSISTANT_PROVIDER` still supplies the initial model;
  its default remains `deepseek` and was not changed.
- One OpenAI-compatible/Bearer adapter serves the three fixed profiles. Redirects remain refused,
  environment/system proxies remain ignored, remote response bodies remain off logs/UI/inspection,
  and only bounded usage fields are returned.
- The Assistant header contains one compact selector for the three exact models. A small `AI` toolbar
  button opens the panel directly; ordinary selection → right-click → `问 AI` stages the selected
  text without egress, then the user chooses a model and explicitly sends it.
- The browser sends one selected provider name on the first ask. Core Service validates it against
  the closed named set, stores provider/model on the memory-only conversation, and routes follow-ups
  from that server-side binding. The selector is locked only after a successful first turn and shows
  `当前会话已锁定`; an explicit `新对话` action clears the temporary roots and unlocks it. Selecting a
  different model after closing starts fresh; a defensive same-scope request with a changed model
  replaces that scope's temporary root instead of mixing provider histories.
- The selected model is retained for new roots and new Reader conversations within the current page
  lifetime. It is intentionally not persisted: a full reload/service restart returns to the
  configured initial provider. This is the simplest inheritance rule consistent with temporary
  Assistant memory.
- `GUIDED_READER_PROVIDER_BAKEOFF=1` now enables only the comparison endpoint/debug harness. No
  comparison input, button, cards, or wide comparison panel is emitted into the normal Reader UI.
  With the gate off, the endpoint still refuses calls before egress.
- A comparison builds context once, creates one shared system/user message list, and gives a deep copy
  of those messages to each eligible provider concurrently. Provider/model and the deterministic
  parameter mapping may differ; Skill, selected text, bounded OCR context, user-visible question, and
  PAGE/SECTION scope do not.
- Missing credentials, invalid config, cooling, transient failures, and user-actionable failures are
  reported only in that provider's debug result. No fallback, retry across providers, voting, ranking,
  ensemble, or automatic winner exists.
- Comparison results keep only the latest result per Reader session in Core Service memory; explicit
  Assistant close/Reader close clears them. No schema, table, cache file, results file, or benchmark
  database was added.
- Plain HTTP endpoint overrides validate only for `localhost` or an IP address classified as
  loopback. Any non-loopback HTTP endpoint disables only that provider. HTTPS overrides retain the
  existing development convenience.

## User acceptance delta (2026-09-05)

The first implementation checkpoint `3c5327bb79bad0459ad6d2f1b91cc7982c42eebb` remains in history.
During manual acceptance, enabling bake-off put an optional question field and comparison action in
the selection toolbar, then expanded the fixed Assistant panel to `min(1120px, 96vw)`. At z-index 7
that real panel covered almost the full Reader and intercepted pointer/context-menu interaction over
the original PDF. The result was unsuitable as a normal product interaction even though comparison
calls themselves were controlled.

The correction removes that collision at its source. There is no benchmark affordance in the
selection toolbar and no wide/three-column Assistant state. The selection action remains compact,
the native selected range survives right-click, and the normal 410px Assistant panel contains only a
small model selector plus the existing single-conversation surface. Bake-off evidence collection was
moved to direct use of the dev-gated endpoint by `provider-bakeoff-real.mjs`; it no longer requires or
creates user-visible comparison UI.

### Second user retest: selector interaction bug

The next user retest found that the compact selector looked correct but could not be changed through
the natural selection flow. This was not a stacking, `pointer-events`, missing-handler, or stale-
asset bug. The right-click `问 AI` action still called `askSelectedText()` immediately. That function
set `assistantPending=true` before displaying the panel, which disabled the selector during the
network request; a successful response then populated `assistantConversation`, keeping it disabled.
Consequently the user never saw an interactive pre-request state unless they had discovered and used
the separate toolbar `AI` button before selecting text.

The corrected state machine has three explicit states. `DRAFT` holds only the selected text and
bounded selection coordinates in browser memory, keeps the selector enabled, and performs zero
provider calls. `PENDING` begins only when the user clicks the draft card's `发送` button and
temporarily disables controls while exactly one selected provider is called. `CONVERSATION` begins
only after that first call succeeds; only then is provider/model pinned and the visible lock message
shown. A failed first call, including OpenRouter `model_region`, leaves the draft and re-enables model
selection without fallback. `新对话` explicitly clears the old memory-only session before allowing a
new choice; it never switches provider inside an existing conversation.

The service already sent `Cache-Control: no-store` for `index.html`, `/app.js`, and the other static
assets. Browser acceptance additionally fetched the live `/app.js` with `cache: reload`, asserted the
`no-store` header, and confirmed the served source contains the new draft-state function. The retest
service is therefore running the new asset rather than a cached script or stale process.

### Third user retest: selection Ask readiness bug

The next retest reached the Reader-native selection menu, but its `问 AI` action was disabled. The
root cause was a stale immediate-dispatch predicate in `syncAskEligibility()`: even though the action
now creates only a local draft, it still required at least one provider with
`configured && !cooling`. In the observed service launch context all three fixed profiles were valid
and selectable, but credential lookup reported `CREDENTIAL_NOT_FOUND`, so that predicate disabled
the entry action globally. The same mistake would also have allowed credential/cooling state to
couple Reader entry to provider call readiness. It was not caused by an overlay, pointer handling,
the selector handler, conversation locking, or stale assets.

Readiness is now split at the actual egress boundary. `问 AI` requires a valid Reader selection,
available Assistant status, and at least one valid named provider that is not explicitly
`DEVELOPMENT_DISABLED`; it does not require credentials, a ready default provider, an existing
conversation, or a provider that is outside cooling. Clicking it still performs zero provider
calls. The draft card's explicit `发送` button separately requires the selected provider to be
configured and outside cooling. Therefore an unavailable OpenRouter profile cannot block entry for
DeepSeek/Zhipu, while all-provider development AI-off and invalid configurations still disable the
AI action.

The browser regression uses the prepared real 348-page library and intercepts only the status read
to reproduce three valid profiles with unavailable credentials. It verifies selection/right-click,
an enabled `问 AI`, zero egress on click, a visible local draft, and a disabled Send button for the
currently unavailable selected provider. The existing all-`DEVELOPMENT_DISABLED` case continues to
verify genuine AI-off, and Copy/Highlight/Add note remain on their unchanged selection path.

## Important implementation decisions

### Frozen profiles and effective mapping

| Provider | Credential target | Exact model | Default endpoint | Actual request mapping |
|---|---|---|---|---|
| `deepseek` | `408-guided-reader-deepseek` | `deepseek-v4-pro` | `https://api.deepseek.com/chat/completions` | `temperature=0.2`, `max_tokens=4096`, `stream=false`, timeout 120s |
| `zhipu` | `408-guided-reader-zhipu` | `GLM-5.3-Flash` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `temperature=0.2`, `max_tokens=4096`, `stream=false`, timeout 120s |
| `openrouter` | `408-guided-reader-openrouter` | `google/gemini-3.8-flash` | `https://openrouter.ai/api/v1/chat/completions` | `temperature=0.2`, `max_tokens=900`, `stream=false`, timeout 45s |

The common intent is `answer_length=concise`, `reasoning_strength=balanced`. There is no portable
OpenAI-compatible reasoning-strength field, so it is omitted for all three. Real calibration showed
that the DeepSeek and Zhipu models can spend the 900-token generation ceiling on provider reasoning,
yielding an empty/truncated visible answer; Zhipu also exposes a separate `reasoning_content` field.
Their 4096 ceiling therefore covers provider reasoning plus the answer, while the unchanged shared
Explanation Skill controls visible answer length. Raising their per-attempt timeout from 45s to 120s
prevented slow reasoning responses from causing duplicate retries. The final run had no missing
DeepSeek/Zhipu answers. OpenRouter attribution headers were tested and did not change its region 403,
so they were not added to the product request.

### Egress and inspection

Every inspected call records only provider, configured endpoint, interaction ID, attempt, and exact
secret-free JSON request body. Credential values and Authorization headers never enter status,
comparison results, inspection, errors, logs, or the database. The existing 20-call in-memory bound
remains; the real benchmark harness returned its results directly and used only a git-ignored,
temporary acceptance artifact while this report was prepared.

## Real benchmark record

The final comparison ran on 2026-09-05 from 09:07:07Z through 09:13:00Z against the prepared real
348-page scan (SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`).
All rows used the same compact Explanation Skill and same per-item selected text/context/scope/question.
Metrics are `latency / total tokens`; OpenRouter usage is honestly unavailable.

| Item | DeepSeek | Zhipu | OpenRouter | Human verdict |
|---|---:|---:|---:|---|
| 数据的“大端方式” | 15.2s / 1437 | 13.0s / 1361 | `model_region` | Both accurate and teachable. DeepSeek is more compact; Zhipu adds exam/background detail without losing focus. |
| “小端方式” | 29.0s / 2295 | 55.1s / 2936 | cooling after region 403 | Both accurate. DeepSeek stays on the byte-order rule; Zhipu uses the real disassembly context and more supplemental detail. |
| 什么时候用大端，什么时候用小端？ | 40.0s / 2706 | 52.4s / 2228 | `model_region` | Both give useful protocol/architecture guidance. Zhipu is richer but says a machine uniformly chooses one order and gives a “small-endian is easier for the machine” rationale too absolutely; DeepSeek is safer and more focused. |
| 机器周期 | 17.6s / 1497 | 15.9s / 1704 | `model_region` | Both correctly place it between instruction cycle and clock/beat. Zhipu is more structured; DeepSeek is shorter. |
| 机器周期就等于总线周期？ | 41.4s / 2736 | 98.5s / 3877 | cooling after region 403 | Both correctly reject equality and explain architecture-dependent overlap. Zhipu gives more nuance but at the highest latency/usage in the set; DeepSeek reaches the distinction sooner. |
| 总线仲裁 | 13.7s / 1108 | 13.0s / 1375 | `model_region` | Both accurate and focused. Zhipu's microphone analogy and centralized/distributed classification improve teaching feel with moderate extra length. |
| MAR 和 MDR 的区别 | 9.1s / 983 | 18.8s / 2074 | cooling after region 403 | Both correctly distinguish address/“where” from data/“what.” Zhipu adds a useful table, but its capacity example assumes the addressable-unit width without stating that assumption. |
| Cache 为什么不能全部做成全相联 | 24.0s / 1712 | 17.4s / 1699 | `model_region` | Both identify parallel tag comparison, area, latency, power, and group-associative compromise. Zhipu teaches the tradeoff especially well, though “comparison delay grows linearly” is more absolute than warranted. |
| 补码为什么能把减法变成加法 | 19.6s / 1606 | 58.8s / 2564 | cooling after region 403 | Both are mathematically correct, use the clock/modulus analogy, and connect overflow discard to fixed-width hardware. DeepSeek is substantially more concise. |
| 故意错误：大端就是低位字节放低地址 | 7.8s / 1029 | 10.0s / 1236 | `model_region` | Both immediately and unambiguously correct the misconception, contrast big/little endian, and avoid deference to the user's false premise. DeepSeek is the tighter correction. |

Across the 10 successful pairs:

- DeepSeek: 10/10; mean 21.7s, 450 visible characters, 1711 total tokens.
- Zhipu: 10/10; mean 35.3s, 746 visible characters, 2105 total tokens.
- OpenRouter: 0/10; six direct `model_region` results and four honest cooling results; no token usage.

Professional accuracy was strong for both callable models, with no blocking factual error found in
the sampled answers. DeepSeek was generally more focused, shorter, and faster. Zhipu more often used
tables, analogies, and edge cases, improving teaching richness while increasing latency, length, and
the tendency to make supplemental claims too categorically. Neither model falsely accepted the
deliberately wrong endian premise.

### Follow-up quality through the normal product path

From 09:13:00Z through 09:15:08Z, the service was restarted once per active provider with bake-off
disabled. Each callable model received `机器周期`, then the same two same-level follow-ups:
`机器周期就等于总线周期？` and `一个机器周期就是 CPU 完成一整条指令的时间，对吗？`.

- DeepSeek retained the SECTION conversation, directly separated machine/bus cycles, and correctly
  corrected machine cycle vs instruction cycle in compact prose (three inspected calls).
- Zhipu retained the same context and corrected both misconceptions with richer comparisons and a
  timeline/table. It was more pedagogically expansive, but added architecture examples and absolute
  language that a concise local explanation did not require (three inspected calls).
- OpenRouter's first normal-path call returned `AI_USER_ACTIONABLE/model_region`; no follow-up answer
  exists and no substitute provider was contacted.

## Default-provider decision

No winner was selected and no default was changed. The evidence supports a user-facing tradeoff
between DeepSeek's focus/latency and Zhipu's depth/structure, but it is not a valid three-way decision
while the frozen OpenRouter model is inaccessible under the approved no-proxy boundary. The process
recommendation is to keep the existing `deepseek` default unchanged until the user evaluates these
two result sets and decides whether OpenRouter region access should be resolved or explicitly waived.

## Deviations from Spec

The implementation scope did not expand. Real-use acceptance deviates only in outcome: OpenRouter's
preflight-confirmed model could not be called through the shipped security boundary during the final
run. Direct no-proxy HTTPS returned a model/region 403; adding optional OpenRouter attribution headers
did not help. Enabling the system proxy, choosing another model, changing endpoint, or adding fallback
would violate this Phase, so none was done.

The brief's stale preflight model text was synchronized to the user's controlling 2026-09-05 values
before implementation: DeepSeek `deepseek-v4-pro` and OpenRouter `google/gemini-3.8-flash`.

## Acceptance evidence

- `python -m compileall -q src`: **PASS**.
- `pytest -o addopts= -q -ra`: **86 passed, 2 skipped** after the acceptance correction. The skips are the unchanged optional external-
  path OCR calibration tests. Coverage includes the exact profiles/targets/models, environment
  overrides, selected-provider-only routing, server-pinned follow-up routing, unknown-provider zero
  egress, disabled gate zero comparison egress, identical benchmark messages, deterministic mapping,
  missing credential/failure isolation, secret hygiene, HTTPS hardening, memory-only cleanup, normal
  Ask scope/history/lifecycle, AI-off, and no persistence/schema additions.
- `npm test`: **30 passed**.
- `npm run test:e2e:ask`: **PASS** on the real prepared 29/348-page library with one loopback mock
  endpoint. With the dev gate deliberately on, it verified absent comparison UI, a sub-390px selection
  menu, preserved native text selection after right-click, zero calls on opening Ask, free switching
  among all three models in the draft state, Zhipu-only dispatch after explicit send, same-provider
  follow-up, visible post-success lock state, explicit new-root unlocking with zero egress, in-page
  inheritance, PAGE fallback, all-provider AI-off, and live no-store asset identity. A separate page
  against the same real 348-page library reproduced all three named profiles as configuration-valid
  but credential-unavailable, then verified that right-click `问 AI` remained enabled, opening it
  made zero provider calls, and only explicit Send remained gated. Draft and locked-conversation
  screenshots were visually inspected; they are ignored test artifacts.
- `npm run test:e2e:ask:real`: **PASS** with `deepseek-v4-pro` on the 348-page book and 29-page excerpt:
  real answer, same-level follow-up, honest PAGE scope, Reader-close invalidation, fallback, and AI-off.
- `npm run test:e2e:bakeoff:real`: **PARTIAL / intentionally non-zero**. DeepSeek and Zhipu each
  returned all 10 first answers and passed normal-path follow-ups; OpenRouter returned no answer due
  to the region boundary. This is the original real-provider evidence and was not needlessly repeated
  for the UI-only acceptance correction. Its harness now uses the same dev-gated endpoint directly
  and passes static syntax validation; this remains an outstanding criterion, not a PASS.
- Existing real-browser regressions after the correction: `npm run test:e2e:map` **PASS**,
  `npm run test:e2e:r3` **PASS** (including selection completion, context menu, copy, persistence and
  cleanup; rerun for this delta on the real 29/348-page library), `npm run test:e2e:find` **PASS**.

Overall implementation acceptance is **PASS**. User retest passed the normal Reader selection,
local-draft, model-selection, selected-provider-only send, pinned follow-up, new-conversation,
AI-off, and Reader interaction flows. ZCode narrow independent review also passed with P0 = 0,
P1 = 0, and P2 = 3; the secondary review accepted that conclusion and its closure recommendation.
The implementation, reviewed security boundary, and normal single-model Reader interaction are
therefore accepted and this Phase is closed.

This closure does not convert incomplete environment evidence into a pass.
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING: OPENROUTER_MODEL_REGION_ACCESS` still applies solely to a
callable OpenRouter `google/gemini-3.8-flash` path that obeys the no-system-proxy rule. The current
result remains direct `model_region` HTTP 403, with no fallback and no model substitution. This is a
separate product/environment matter, not a Provider Bake-off implementation blocker.

No winner was selected and the default Assistant provider was not changed.
`DEFAULT_ASSISTANT_PROVIDER_DECISION: OPEN`; the retained DeepSeek and Zhipu real-material results
remain evidence for that later user decision.

## Known limitations / deferred debt

- ZCode P2: clicking `新对话` or closing the Assistant while a request is in flight can leave a
  bounded frontend stale-display window when that request completes.
- ZCode P2: development environment variables can still override the Phase's frozen model IDs.
- ZCode P2: the existing in-memory `_session_locks` collection is not reclaimed, leaving a pure
  memory-growth debt over sufficiently many Reader sessions.
- OpenRouter model-region access still blocks full three-provider real-material evidence, but does
  not block this implementation closure.
- The two callable reasoning models are noticeably slower and more verbose than the shared `concise`
  intent suggests. Per-provider prompt/Skill tuning remains forbidden; future changes require a new
  controlled experiment or explicit product decision.
- The retained debug comparison endpoint supports first answers only. Normal follow-up evaluation
  uses the selected, server-pinned single-provider conversation.
- The three Ask About This P2 items not included here remain deferred except P2 #1, which this Phase
  closes with the non-loopback HTTPS rule.

## Reproducible entry points

```powershell
python -m compileall -q src
pytest -o addopts= -q -ra
npm test

$env:READER_DATA_DIR='D:\path\to\prepared-real-library'
npm run test:e2e:ask
npm run test:e2e:ask:real
$env:GUIDED_READER_PROVIDER_BAKEOFF='1'
npm run test:e2e:bakeoff:real
```

Manual user retest: start the Reader normally, select prepared original-PDF text, use the right-click
`问 AI` action, switch freely among the three exact models in the staged card, then click `发送`.
Verify the selector locks only after the answer succeeds and follow-ups remain on that model; use
`新对话` to unlock it for another Root. The dev benchmark harness calls the
gated comparison endpoint directly; setting `GUIDED_READER_PROVIDER_BAKEOFF=1` does not add comparison
controls to the Reader.

## Important files / architecture entry points

- `src/reader_service/agent_runtime/runtime.py` — named profiles, active routing, gate, parity fan-out,
  effective config, typed isolation, HTTPS validation, retry/cooling, and inspector.
- `src/reader_service/agent_runtime/credentials.py` — fixed provider-to-credential-target binding.
- `src/reader_service/agent_runtime/deepseek.py` — shared OpenAI-compatible/Bearer transport, usage
  parsing, redirect/proxy refusal, and secret-safe error classification.
- `src/reader_service/assistant/service.py` and `context.py` — conversation-pinned provider/model,
  one-build comparison input, and memory-only result lifetime.
- `src/reader_service/server.py`, `static/index.html`, `static/app.js`, `static/styles.css` — selected-
  provider HTTP contract and compact normal Assistant UI; no Reader comparison surface.
- `tests/test_ask_about_this.py`, `tests-e2e/ask-about-this.mjs`, and
  `tests-e2e/provider-bakeoff-real.mjs` — machine, browser-mock, and real-material acceptance.

## Git checkpoint

Implementation checkpoint: `3c5327bb79bad0459ad6d2f1b91cc7982c42eebb`.
Original evidence/report checkpoint: `bb57f24`.
First user-acceptance correction checkpoint: `47084ac`.
Selector-interaction correction checkpoint: `2fe487a`.
Selection Ask-readiness correction checkpoint: `070dc20`.
The docs-only Phase closure checkpoint is the commit containing this final report.
