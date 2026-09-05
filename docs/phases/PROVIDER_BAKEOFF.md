# Phase / Provider Bake-off

## Goal

Make the frozen §13.4 multi-provider seam real for exactly three named providers (DeepSeek, Zhipu
GLM, OpenRouter), and give the user a controlled, real-pipeline instrument to compare their teaching
quality on the real textbook — so the default Assistant provider becomes an informed decision
instead of an unexamined default. This is an evaluation slice, not a multi-model platform.

## User-visible result

> "我在真实教材里选中「机器周期」，点一次对比，几位老师并排给出解释、延迟和用量；我逐题判断谁讲解准、
> 谁不说绝对化的话、谁敢纠正我的错误理解——最后由我决定默认老师。"

## Authority to read

**Product Blueprint:**
- §18 — AI optional/user-controlled; the AI-off path keeps working
- §24 preamble, §24.1–§24.3 — Assistant scope/lifetime rules this Phase must not disturb
- §30.4 — Assistant defaults to no independent review (unchanged by this Phase)
- §34 — Model is not Agent: swapping or comparing providers changes no product-agent identity,
  authority, or persistence semantics

**Implementation Blueprint:**
- §13.1–§13.5, §13.8 — the four separations; context isolation; §13.4 configuration-driven routing
  that must be *able* to select a different provider and record which it used; graceful absence;
  conversational output; typed failures/retry/cooling
- §21.2, §21.3 — credentials in the OS store; the single egress boundary (as confirmed in D-5)
- §24 (Phase R5 entry) — direction only; this Phase authorizes no R5 remainder
- §26 — D-4/D-5 rows and their recorded resolutions (DeepSeek first; §21.3 boundary confirmed)

Prior-slice context: `docs/development-reports/ASK_ABOUT_THIS.md` documents the existing single
adapter, configuration surface, credential targets, inspector, and its three deferred P2
observations.

## Hard rules

- **Controlled experiment at the intent level.** Every provider in a comparison receives the same
  Explanation Skill, the same selected text, the same bounded textbook context, the same
  user-visible message, the same scope, and the same intent-level configuration (answer-length and
  reasoning-strength intent). Per-field numeric equality of API parameters is **not** required —
  providers differ in supported parameters and their semantics, so adapters may apply the minimal
  necessary mapping or omit unsupported parameters. Forbidden is provider-specific prompt, Skill,
  knowledge-context, or parameter tuning that beautifies one provider's result or gives any model an
  artificial advantage. Mapping rules are recorded in the Development Report, and the comparison
  UI/report records the actual provider/model/config behind every answer.
- **The product path stays single-provider.** Normal Reader use contacts exactly the one active
  provider, exactly as Ask About This shipped. Comparison mode is opt-in via a development/testing
  gate and off by default; it is not a product capability and gets no product-path discoverability.
- **Named set only, https off-loopback.** Exactly `deepseek`, `zhipu`, `openrouter` — each with its
  fixed credential target (`408-guided-reader-deepseek` / `408-guided-reader-zhipu` /
  `408-guided-reader-openrouter`), a fixed https default endpoint, and a default model. Plain `http`
  is permitted only for loopback endpoints; any endpoint that leaves the machine must be https.
  No dynamic provider registration, no marketplace, no user-added endpoints on the product path;
  environment endpoint override remains a development convenience exactly as today.
- **The model set is frozen — it is the experiment's independent variable.** The user-confirmed
  preflight on 2026-09-05 fixed `deepseek` → `deepseek-v4-pro`; `zhipu` → `GLM-5.3-Flash`;
  `openrouter` → `google/gemini-3.8-flash`. The implementer does not choose models. If `GLM-5.3-Flash`
  is not supported by the user's current Zhipu API/resource pack, stop and report — never substitute
  a lookalike model. Any model change after freezing goes through the user; otherwise the bake-off
  is not reproducible.
- **Egress unchanged in shape.** One user-initiated comparison action sends the same §21.3/D-5
  bounded payload to each configured **and** credentialed provider — nothing more. A provider
  without a valid credential is honestly absent from the comparison, never silently skipped in a way
  that looks like a result.
- **Failure isolation per provider.** One provider's transient/auth/cooling failure degrades only
  that provider's column; the Reader and other providers are untouched (§13.8 spirit; §20).
- **No persistence.** No benchmark database, results file, ranking, or new conversation storage.
  Comparison output lives in process memory under the existing temporary-lifetime rules; the
  development report is the only record of conclusions.
- **Secret hygiene and inspection unchanged.** Keys/Authorization headers never enter inspection,
  logs, or error surfaces; the inspector labels which provider each captured call used (§13.4
  "record which it used", §21.5).
- **Assistant semantics untouched.** Scope resolution, per-scope isolation, follow-up rules,
  memory-only lifetime, no answer-text ask affordance — all exactly as Ask About This closed them.

## Build

- Named provider configuration: the three names, their fixed credential targets, default https
  endpoints, and the frozen model IDs from the Hard rules; per-provider environment overrides as
  today (an override is a dev convenience and must remain visible in the recorded effective config);
  one configured active default (deepseek, until the user's post-bake-off decision).
- Generalize the existing single HTTP adapter to the OpenAI-compatible protocol it already
  implements (renaming/refactoring is autonomy); per-provider credential reads against the three
  fixed targets; secret-free per-provider status (configured/credential/cooling) in the existing
  status surface.
- Comparison mode (dev-gated, default off): with a valid selection, one action asks all configured +
  credentialed providers with the identical intent-level payload (same Skill/selected text/context/
  message/scope; minimally mapped API parameters may differ per the Hard rule); the panel shows first
  answers side by side, labelled by provider/model, with measured latency, returned token usage when
  the API supplies it, and the actual config used; in-memory only; explicit close clears it. First
  answers only — no per-column follow-ups.
- Follow-up evaluation path: switch the active provider via configuration and use the existing
  normal panel conversation.
- Included as the natural adjacent fix on exactly this code surface: reject non-loopback `http://`
  provider endpoints (Ask About This P2 #1 — https for anything leaving the machine).

## Not now

- **Per-column follow-up conversations in comparison mode** — follow-up quality is evaluated by
  switching the active provider; branching N conversations doubles the conversation machinery for
  marginal evaluation gain.
- **Any default-provider change inside this Phase** — the bake-off produces a recommendation; the
  default change is the user's recorded decision, made after reading the report.
- **Auto routing, fallback chains, model voting, ensembles, provider health dashboards, benchmark
  persistence, ranking engines, generic plugin/registration systems** — none of these is needed to
  choose a default provider.
- **Reviewer-independence routing** (§13.4's different-provider requirement for review) — that
  belongs to Teaching/Review phases, not the Assistant path.
- **RAG, Vision/multimodal crops, precise teaching diagrams, generative illustration, image
  generation** — named future directions; this Phase only avoids hard-coding the provider/model
  interface against them.
- **Master, Guide/Teaching, KP, Save to Notes, recursive Child, VisualRegion, Pass 2, cross-page
  selection, OCR regeneration** — unchanged standing exclusions.
- **Skill or parameter divergence per provider** — the shared compact Skill is the experimental
  control, not a per-model tuning surface.

## Acceptance

Machine (mock adapters; no real keys needed):
- Named configuration resolves the three providers with their fixed targets/defaults and exactly
  the frozen model IDs; per-provider env overrides apply and stay visible in the recorded effective
  config; invalid values disable only that provider's availability, never the Reader.
- A missing credential for one provider removes exactly that provider from comparison while others
  proceed — honestly represented, not silently skipped.
- Payload parity at the intent level: for the same comparison ask, captured request bodies carry the
  identical Skill, selected text, textbook context, user-visible message, and scope across
  providers; provider/model identity and minimally mapped API parameters may differ, the mapping is
  deterministic and recorded, and no provider receives prompt or knowledge-context content another
  does not; the inspector labels the provider per call.
- With the comparison gate off, the product path contacts exactly the one active provider and the
  panel behaves exactly as Ask About This shipped; with the gate on, exactly the configured +
  credentialed set is contacted and nothing else.
- Per-provider failure isolation: a cooling/failing provider degrades only its own column.
- No new tables, files, or persisted benchmark state; service restart clears all comparison output.
- Secrets never appear in inspection, logs, or error surfaces (regression); non-loopback `http://`
  endpoints are rejected.

Real-use (the user's real keys, the real 348-page book, through the real Reader selection path):
- Run the agreed benchmark — selected-text asks on `大端方式`, `小端方式`, `机器周期`, `总线仲裁`,
  `MAR 和 MDR 的区别`, `Cache 相联映射`, `补码`; typed questions 「什么时候用大端，什么时候用小端？」
  and 「机器周期就等于总线周期？」; and one deliberately wrong understanding offered for correction.
- For each item: side-by-side first answers with latency; follow-up behaviour evaluated by switching
  the active provider through the normal panel.
- Reproducibility record: per provider — the exact model ID, endpoint, effective config, and the
  date the bake-off calls were made.
- The development report records a per-item human verdict (accuracy, teaching feel, focus,
  over-absoluteness, correction behaviour, follow-up quality, latency, usage) and closes with a
  recommended default provider for the user's decision.

## Autonomy

Per `AGENTS.md` §5: environment-variable names, the
comparison-mode gating mechanism, panel column layout, adapter naming/refactor, OpenRouter optional
headers, status-field shape, test structure, and small local refactors, plus the minimal necessary
per-provider API-parameter mapping where semantics differ (recorded, deterministic, no artificial
advantage). Model IDs are **not** autonomy — they are frozen by the Hard rules. All Hard rules —
especially the frozen model set, intent-level payload parity, and the dev gate — bind every such
choice.

## Must report before proceeding

- Any provider's API is not actually OpenAI-compatible/Bearer-shaped, such that a genuinely separate
  adapter (not just configuration) is required.
- The comparison gate cannot be kept cleanly out of the product path.
- Any need to send anything beyond the identical bounded payload, or to persist comparison output.
- Any requested change to the user-confirmed OpenRouter slug `google/gemini-3.8-flash`.
- `GLM-5.3-Flash` being unavailable under the user's current Zhipu API/resource pack — stop; model
  substitution is not an implementation decision.
- The bake-off recommendation itself — reported for the user's decision, never self-applied.
- `AGENTS.md` §5's conditions generally.

## Completion

- Machine acceptance above; the real-use benchmark executed with real keys on the real book.
- One development report in `docs/development-reports/` that doubles as the benchmark record:
  per-item verdicts, latencies, follow-up notes; per provider the exact model ID, endpoint,
  effective config, and call dates; the per-provider parameter-mapping rules; the recommended
  default provider; and — if the user has decided by then — the recorded default-provider decision
  (a D-4 extension; the Frozen §26 sync remains the user's action).
- One git checkpoint commit.
- **Independent (ZCode) narrow review is required** — this Phase adds two outbound provider
  endpoints and two credential targets and re-touches the egress gate (`AGENTS.md` §5 security
  boundary). Scope the review to the named endpoint set, credential handling, comparison-mode
  gating, payload parity, no-persistence, and secret hygiene — not UI polish.
