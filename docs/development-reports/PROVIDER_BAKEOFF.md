# Provider Bake-off Development Report

## Result

`IMPLEMENTATION_READY` — the Reader now has exactly three named provider profiles and a development-
gated, default-off comparison action. A real selection can produce three isolated first-answer
columns with provider/model, latency, returned token usage, endpoint, and effective configuration.
Normal Ask About This still contacts only the configured active provider and retains its existing
scope, same-level follow-up, AI-off, and memory-only lifecycle.

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING: OPENROUTER_MODEL_REGION_ACCESS`

`READY_FOR_USER_MODEL_EVALUATION`

`READY_FOR_NARROW_ZCODE_REVIEW`

The final 348-page run produced 10/10 answers from DeepSeek and 10/10 from Zhipu. OpenRouter returned
HTTP 403 `model_region` for the frozen `google/gemini-3.8-flash` model on every direct attempt outside
its cooling window. System-proxy routing is forbidden and remained disabled; the model and endpoint
were not substituted. Consequently this is not a completed three-provider real-material acceptance,
and no winner/default-provider decision is recorded.

## Implemented

- The named set is closed to `deepseek`, `zhipu`, and `openrouter`, with fixed credential targets and
  the user-confirmed model IDs. `GUIDED_READER_ASSISTANT_PROVIDER` selects one normal-path provider;
  its default remains `deepseek`.
- One OpenAI-compatible/Bearer adapter serves the three fixed profiles. Redirects remain refused,
  environment/system proxies remain ignored, remote response bodies remain off logs/UI/inspection,
  and only bounded usage fields are returned.
- `GUIDED_READER_PROVIDER_BAKEOFF=1` enables the comparison endpoint and UI. With the gate off, the
  comparison control and optional same-question field are hidden and the comparison endpoint refuses
  calls before egress.
- A comparison builds context once, creates one shared system/user message list, and gives a deep copy
  of those messages to each eligible provider concurrently. Provider/model and the deterministic
  parameter mapping may differ; Skill, selected text, bounded OCR context, user-visible question, and
  PAGE/SECTION scope do not.
- Missing credentials, invalid config, cooling, transient failures, and user-actionable failures are
  rendered in only that provider's column. No fallback, retry across providers, voting, ranking,
  ensemble, or automatic winner exists.
- Comparison results keep only the latest result per Reader session in Core Service memory; explicit
  Assistant close/Reader close clears them. No schema, table, cache file, results file, or benchmark
  database was added.
- Plain HTTP endpoint overrides validate only for `localhost` or an IP address classified as
  loopback. Any non-loopback HTTP endpoint disables only that provider. HTTPS overrides retain the
  existing development convenience.

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
- `pytest -o addopts= -q -ra`: **84 passed, 2 skipped**. The skips are the unchanged optional external-
  path OCR calibration tests. Coverage includes the exact profiles/targets/models, environment
  overrides, active-provider-only routing, disabled gate zero comparison egress, identical messages,
  deterministic mapping, missing credential/failure isolation, usage, inspection labels, secret
  hygiene, loopback HTTP allowance, non-loopback HTTP rejection, memory-only comparison cleanup,
  normal Ask scope/history/lifecycle, AI-off, and no persistence/schema additions.
- `npm test`: **30 passed**.
- `npm run test:e2e:ask`: **PASS** on the real prepared 29/348-page library with one loopback mock
  endpoint. It exercised normal Ask/follow-up, exactly three comparison calls and columns, frozen
  models, optional same-question parity, usage rendering, effective config, inspector labels,
  explicit close, PAGE fallback, gate-off hidden UI, and zero AI-off egress. The comparison screenshot
  was visually inspected; it is an ignored test artifact.
- `npm run test:e2e:ask:real`: **PASS** with `deepseek-v4-pro` on the 348-page book and 29-page excerpt:
  real answer, same-level follow-up, honest PAGE scope, Reader-close invalidation, fallback, and AI-off.
- `npm run test:e2e:bakeoff:real`: **PARTIAL / intentionally non-zero**. DeepSeek and Zhipu each
  returned all 10 first answers and passed normal-path follow-ups; OpenRouter returned no answer due
  to the region boundary. This is the outstanding full-real-material criterion, not a PASS.
- Existing real-browser regressions after the change: `npm run test:e2e:map` **PASS**,
  `npm run test:e2e:r3` **PASS**, `npm run test:e2e:find` **PASS**.

Overall: `IMPLEMENTATION_READY`; `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` solely for a callable
OpenRouter `google/gemini-3.8-flash` path that still obeys the no-system-proxy rule. Independent
ZCode review has not been run, as explicitly requested.

## Known limitations / deferred debt

- OpenRouter model-region access blocks full three-provider real acceptance and any complete default-
  provider recommendation.
- The two callable reasoning models are noticeably slower and more verbose than the shared `concise`
  intent suggests. Per-provider prompt/Skill tuning remains forbidden; future changes require a new
  controlled experiment or explicit product decision.
- Comparison supports first answers only. Follow-up quality remains intentionally evaluated by
  switching the active provider and using the normal single-provider conversation.
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

Manual comparison: start the Reader with `GUIDED_READER_PROVIDER_BAKEOFF=1`, select prepared original-
PDF text, optionally type one shared question in the dev-only comparison field, and click
`三模型对比`. Leave the gate unset/`0` for normal product use. To evaluate follow-ups, set
`GUIDED_READER_ASSISTANT_PROVIDER` to one of the three names, restart, and use ordinary `问 AI`.

## Important files / architecture entry points

- `src/reader_service/agent_runtime/runtime.py` — named profiles, active routing, gate, parity fan-out,
  effective config, typed isolation, HTTPS validation, retry/cooling, and inspector.
- `src/reader_service/agent_runtime/credentials.py` — fixed provider-to-credential-target binding.
- `src/reader_service/agent_runtime/deepseek.py` — shared OpenAI-compatible/Bearer transport, usage
  parsing, redirect/proxy refusal, and secret-safe error classification.
- `src/reader_service/assistant/service.py` and `context.py` — one-build comparison input and
  memory-only result lifetime.
- `src/reader_service/server.py`, `static/index.html`, `static/app.js`, `static/styles.css` — dev-only
  HTTP/UI surface and side-by-side display.
- `tests/test_ask_about_this.py`, `tests-e2e/ask-about-this.mjs`, and
  `tests-e2e/provider-bakeoff-real.mjs` — machine, browser-mock, and real-material acceptance.

## Git checkpoint

Implementation checkpoint: `3c5327bb79bad0459ad6d2f1b91cc7982c42eebb`.
This report is committed by the docs checkpoint recorded in the completion handoff.
