# Phase / FRIENDS_PRIVATE_BETA

## Status and goal

`ACCEPTED BY USER — local personal baseline personal-v0.1; private GitHub pending`. On 2026-09-16 the user explicitly accepted
the revised brief and R-1 after revision checkpoint `0654bd9`. The selected architecture remains one
Linux server → Caddy HTTPS → individual authentication → one Core Service and one SQLite/PDF data
directory per friend. Acceptance is not implementation or deployment completion. This acceptance
record is documentation only; the personal stable baseline below must precede Beta implementation.

User revision, 2026-09-16: Beta V1 exposes only DeepSeek with each user's own API key; preserve the
Windows personal edition and establish its stable private-GitHub baseline before Beta implementation.
Review funding/routing is explicitly accepted under R-1 below. No product code or deployed route has
changed as part of drafting or recording acceptance.

**User-approved Phase scope amendment, 2026-09-16 — ACCEPTED.** The user explicitly approved
the reduced implementation-plan direction and this scope amendment. Beta V1 removes persistent
token quotas/reservation/settlement ledgers, Linux per-UID filesystem hard quotas and the 20 GiB
per-instance hard cap, and RPO <=24h / RTO <=1h acceptance targets and their automation system.
Their replacements are the simple AI concurrency/admin switch and disk-space checks in Build §3,
and stopped-service consistent backup plus a real empty-directory restore with measured elapsed
time in Build §4 and Acceptance §5. No RPO/RTO SLA is frozen. All other accepted rules, including
R-1 and the 2/5-instance mixed-load acceptance, remain unchanged. This checkpoint records the
user's decision only; product coding and deployment remain paused pending a subsequent instruction.

Deliver the smallest operable private Beta, inviting 1–2 people first and expanding to at most 5,
preserving single-user domain semantics. User-visible result: “我登录自己的地址，配置自己的 DeepSeek
Key，教材、对话和学习记录只属于我，更新后仍能继续学习。”

## Authority to read

- `AGENTS.md`; this brief. No development report for this Phase exists yet.
- Product Blueprint §§2–4, 15–16, 18–19, 23.1, 24.3, 26, 28–30, 33.2, 34.
- Implementation Blueprint §§3.2–3.7, 5–6, 12.5–12.6, 13.3–13.8, 14.2, 15.4–15.7,
  17.1, 18.3–18.6, 19.5, 21–23.
- Reports: `READING_GUIDE_STREAMING_PERFORMANCE.md` (including final user acceptance),
  `DEEPSEEK_V41_FLASH_ENABLEMENT.md` in `docs/development-reports/`.

## Prior-art check

`REQUIRED` — authentication, service supervision and backup are mature capabilities. Use Caddy's
[basic_auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth) and
[reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), native systemd
service/resource controls, and [SQLite backup guidance](https://www.sqlite.org/backup.html).
Caddy (Apache-2.0) is explicitly selected by the user; use its distributed binary, not copied source
or custom plugins. It adds the TLS/auth reverse-proxy process and certificate maintenance, not a new
application framework. The systemd online manual fetch failed during planning: verify directives
against the target distribution's installed manuals. No external application code is adopted here.

## Build and hard rules

### 0. Preserve the personal edition and establish its baseline first

- Windows local personal use remains supported, including its existing launch flow, local data,
  credential handling and model choices. Beta-only model visibility, key onboarding, AI limits and
  server restrictions must not silently change the local profile or require a server/cloud login.
- Reader / Master / Guide / KP / Memory and their domain semantics remain shared product code.
  Keep differences in deployment/configuration/security and the smallest profile-aware UI surface
  needed for Beta key setup and a DeepSeek-only experience. No duplicated product fork or generic
  provider platform. Local regression is required alongside Linux acceptance.
- **Before any Beta implementation:** finish and accept the current UI work in its owning workstream;
  run relevant real-use/regression checks; commit the personal stable checkpoint; verify the working
  tree is clean. Do not discard or sweep unrelated in-progress edits into this checkpoint.
- Push the stable checkpoint to a verified **private GitHub** repository; recommend the annotated
  tag `personal-v0.1` at that exact commit and push/verify the tag. Record commit/tag/remote identity
  as handover evidence. If that tag already exists, do not move it; report the collision. Never push
  keys, personal PDFs, local data or backups, even to a private repository.
- Continue Beta work from that exact baseline on a separate `codex/friends-private-beta` branch.
  Retain a verified personal-data backup and reproducible local dependencies: restoring the personal
  edition requires compatible code **and** data, not merely a Git checkout. No destructive reset.
  UI closure is user-accepted; the local personal baseline is recorded by `personal-v0.1` and
  `docs/development-reports/PERSONAL_STABLE_BASELINE.md`. No Git remote is configured, so the
  private-GitHub push prerequisite remains pending. No Beta implementation, remote creation or
  deployment is authorized by the baseline checkpoint.

### 1. Instance, authentication and server boundary

- One hostname, Unix service user, loopback port, process and private absolute `--data-dir` per person.
  A nonsecret instance inventory maps these 1:1; credentials never select a shared application DB.
  Reject duplicate ports/data roots. Enforce one running Core per data root, including manual starts.
- Caddy HTTPS + per-host Basic Auth with unique credentials and password hashes. A's credentials
  must not work on B's hostname. Cover `/`, static files, PDF ranges, API and SSE; unknown hosts deny.
  Include bounded authentication attempts/connections using stock facilities or a bounded local
  measure; no plugin/framework adoption without reporting. Credential rotation/revocation is manual.
- Core stays on `127.0.0.1`; no public backend ports, no LAN bind. Caddy admin interface stays private.
  Keep launch credentials distinct from Beta login. Secure cookies, expected Host/Origin checks at
  relevant boundaries, and denial of hostile cross-origin mutations must be verified, not assumed
  from Basic Auth. No shared proxy cache for private responses; SSE must flush without buffering.
- Instance users cannot read/write another instance's data or secrets. Code may be shared read-only;
  do not share writable DBs, blobs, temp files or Assistant memory. New users start empty: never clone
  the owner's populated learning database. Same PDF imported separately remains independently owned.
- Server/Beta mode disables all inspection/debug payload endpoints and capture by default, including
  Assistant and Chapter inspection; proxy denial is defense in depth. No public opt-in debug flag.
  Keep only redacted operational metadata: instance/action/job ID, route class, status, timing, model,
  usage, error code. Never log auth headers, cookies, secrets, source text or conversation bodies.

### 2. Beta V1 DeepSeek-only policy and user-supplied key

| Role | Provider | Exact model |
|---|---|---|
| Assistant / Master only answer model | Native DeepSeek | `deepseek-flash` |
| Reading Guide Writer / revision | Native DeepSeek | `deepseek-flash` |
| KP generation | Native DeepSeek | `deepseek-flash` |
| Inline Teaching / other existing System generation | Native DeepSeek | `deepseek-flash` |
| Review: Guide, Inline, KP, Master, saved Assistant explanation | Native DeepSeek, same user's key (R-1 accepted) | `deepseek-flash` |
| OpenRouter / Gemini / Zhipu / bake-off | Disabled in Beta | No calls |

Beta defaults to DeepSeek and presents no provider/model selector, including Zhipu, OpenRouter or
Gemini options. Reject crafted requests for another route on the server as well. This is a Beta
profile rule, not removal of local personal-edition capabilities. Quick/Deep reasoning and existing
Review-strength controls are separate from model selection and retain their semantics. Add other
supported models only in later explicitly scoped work; reuse the existing adapter boundary now.

- Users submit their own DeepSeek API key through an authenticated HTTPS, write-only setup/replace
  action in their own instance; allow deletion/revocation of the stored key. Persist only in that
  instance's private server configuration, outside Git, product SQLite, PDFs and ordinary backups,
  with restrictive ownership/permissions (0600 file, private directory). No operator-funded fallback.
- The browser necessarily holds newly typed input while submitting it; clear it afterwards and never
  persist it in local/session storage. No API or HTML may return the stored full key; expose only
  configured/validation status. No key in URLs, command arguments, logs, traces, inspection or error
  bodies. Credential responses use no-store. Validate/update without reflecting provider payloads.
- A key supplied to A cannot be retrieved or used through B. Rotation affects subsequent calls and
  must not silently reissue an in-flight call. Missing/invalid keys disable new AI only; PDF, saved
  learning assets and configuration remain operable. Explain that generation **and Review/retries**
  use the user's provider balance; users bear their own DeepSeek API costs. The concurrency limit
  is a resource safeguard, not a token or currency spending cap.
- The service must access the credential to call DeepSeek, so the trusted server administrator can
  technically access it. Do not claim encryption from the host operator. After restoring ordinary
  data backups, users re-enter keys; no hidden centrally funded key is restored.

**Review assessment / R-1 — accepted by user, 2026-09-16.** All Beta Review calls use native
`deepseek-flash` and the same user's key. Product §§16 and 34 explicitly allow the same model in
isolated clean contexts; §§30.2/33.2 require independent Review, not a different billable account.
There is no inherent contract conflict if generator/reviewer prompts, context and authority stay
separate: reviewer sees candidate + evidence, not generator reasoning/history, cannot rewrite/pass
its own rewrite, cannot grant mastery, and failure never becomes publication PASS. This is weaker
model diversity, especially for durable KP structure, and quality equivalence to Gemini is unproven.

The user accepted that correlated-error tradeoff for this Beta, subject to real-book KP/Guide/Inline
review calibration and known-defect rejection tests. Approval is not evidence that these tests passed.
If quality fails, retain original reading and existing published assets; pause affected new generation
and report. Do not bypass Review or silently enable owner-funded Gemini. Alternatives are to defer
affected generation or separately authorize a stronger reviewer and explicit funding in a later slice.
R-1 is resolved; its routing may be implemented after the personal stable baseline prerequisite.
Existing Fast/Standard/Deep and saved-note verification semantics remain.

Target Beta configuration below includes the accepted R-1 Review rows; it is not a secret file or
evidence of deployment. Values must be validated after profile and per-role overrides:

```text
GUIDED_READER_ASSISTANT_PROVIDER=deepseek
GUIDED_READER_MASTER_PROVIDER=deepseek
GUIDED_READER_GUIDE_PROVIDER=deepseek
GUIDED_READER_GUIDE_MODEL=deepseek-flash
GUIDED_READER_KP_GENERATOR_PROVIDER=deepseek
GUIDED_READER_KP_REVIEW_PROVIDER=deepseek
GUIDED_READER_REVIEW_PROVIDER=deepseek
GUIDED_READER_SYSTEM_PROVIDER=deepseek
GUIDED_READER_INLINE_MODEL=deepseek-flash
GUIDED_READER_DEEPSEEK_MODEL=deepseek-flash
GUIDED_READER_DEEPSEEK_DISABLED=0
GUIDED_READER_OPENROUTER_DISABLED=1
GUIDED_READER_ZHIPU_DISABLED=1
GUIDED_READER_PROVIDER_BAKEOFF=0
```

Audit baseline `a248ef2`: `teaching/service.py` can default Guide to `openai/gpt-6-astra`;
`.env.example` explicitly names it and enables Zhipu; Guide/Master/KP/saved-explanation Review defaults
can select Zhipu. Runtime model validation accepts arbitrary nonempty names, not the project allowlist.
These remain implementation corrections: make the Beta profile/examples explicit and validate final
provider, endpoint and model after **all** overrides before every egress, including retries. Do not
blindly change global personal-edition defaults; preserve its authorized configuration and reject
unapproved models there under existing AGENTS rules. Mock tests prove profile separation and routing.

Beta uses only `https://api.deepseek.com/chat/completions` and an instance-scoped credential loader
for the user's private configuration. Do not let inherited environment keys override the user's key
or enable another provider. No Windows Credential Manager, registry, developer shell or implicit
`.env` autoload dependency in Beta. OpenRouter's existing forced-proxy rule remains unchanged for
personal use; Beta requires neither OpenRouter credentials nor its proxy. No real keys are read or
transferred during this documentation revision.

### 3. AI and storage limits

- **At most 2 active AI provider calls per instance**, enforced at the common egress boundary across
  Assistant, Master, KP, Guide, Inline, Review and saved-note Review, including each retry/revision/
  recovery transport attempt. The administrator can disable new AI calls. Use a simple shared
  in-process concurrency limit; no persistent token quota, token reservation or settlement ledger,
  daily token allowance, rollover accounting or corresponding schema migration in Beta V1.
  Users pay their own DeepSeek API costs, including generation, reasoning, Review and retries.
- Bound waiting requests and pending generation work; excess gets a clear retryable Chinese response.
  Existing logical idempotency remains. KP internal thread pools consume the same call ceiling.
  With five instances the starting aggregate ceiling is ten calls; lower per-instance ceilings if the
  user's provider account limit requires it. Separate keys may still share a provider account; do not
  assume account-level independence. No distributed limiter. Administrator can disable new AI.
  Concurrency refusal or administrator-disabled AI never changes mastery, discards questions/notes
  or bypasses Review.
- **512 MiB per upload**, with disk free-space checks and a default **2 GiB safety margin**.
  Check upload length and available space before intake; recheck during growth as needed, accounting
  for simultaneous uploads, temp files, SQLite/WAL and generated state. Reject new data growth when
  space is insufficient and retain room to complete transactions. No Linux per-UID filesystem hard
  quota or 20 GiB per-instance hard cap in Beta V1; free-space checks are application safeguards,
  not an OS-enforced storage guarantee. No automatic deletion of user assets. PDF/read access remains
  available when new AI/upload writes are refused.

### 4. systemd, backup and reproducible release

- One supervised systemd service per instance, `--no-open`, explicit port/data root/working directory,
  non-root UID, restricted writable paths, restart policy, bounded CPU/memory/tasks and log retention.
  Begin with one OCR/preparation worker per instance; do not add processes sharing a DB to scale.
  Bounded transient-session cleanup and worker-stall diagnostics belong only to operating this Beta.
- Pin a reproducible Linux release including Python dependencies, npm locked static resources and OCR
  weights; verify no first-user implicit model acquisition. Data and secrets outlive release folders.
  A Python package alone currently lacks the required repository-relative `node_modules` resources.
- Provide a manually runnable stopped-service consistent backup per instance: deny/drain writes,
  stop Core and confirm exit, snapshot the complete SQLite state and blobs together, then restart.
  Include nonsecret configuration, schema/release IDs and checksums. Encrypt and copy off-host;
  keys are managed separately and excluded from ordinary backups. Run a real restore into an empty
  isolated directory and record the dataset size and actual elapsed restore time. Beta V1 freezes
  no RPO/RTO SLA and requires no automatic backup scheduling, retention rotation, alerting system
  or RPO/RTO compliance machinery. Backup/restore failure must still be reported as failure.
- Take a verified pre-update backup; update one instance at a time. No running-DB main-file-only copy,
  no reliance solely on same-disk migration backups. Restore into an empty isolated directory and
  validate SQLite integrity/FKs, blob hashes and real user flows. Code rollback must match DB schema.
  Preserve original data until restore verification; no destructive restore to live data in tests.

## Acceptance

0. **Personal baseline/regression:** record the accepted clean personal commit, verified private
   remote and proposed tag (or user-selected equivalent) before Beta implementation. Windows local
   Reader/Master/Guide/KP/Memory still pass real-use and affected regression without Beta login,
   BYOK onboarding or server AI-limit requirements; demonstrate recovery against compatible personal data.
1. **Identity/security:** two real credentials and separate instances; anonymous/wrong-host access
   fails for HTML, APIs, PDF Range and SSE. A cannot read/change/delete B's PDF, OCR/KP, Guide,
   Master, Memory, marks or progress, even with known B object/session IDs. Cross-instance filesystem
   access fails. Public backend/admin/debug access fails; secret/body canaries never enter logs.
   Key submission/replacement/removal/status never returns a stored full key; verify browser storage,
   errors, logs and backups contain none. Missing/invalid key preserves reading and saved assets.
2. **Limits:** mock provider tests cover all routes/overrides and the shared 2-active-call ceiling
   across simultaneous mixed-role calls, multi-call Guide/KP, Review/retry, interrupted calls and
   restart. Verify slot release after failure and that administrator-disabled AI permits no new
   calls. No unapproved model request leaves. Upload concurrency, oversize, insufficient free space
   and disk exhaustion leave durable assets valid. Concurrency refusal, disabled AI and low-space
   refusal preserve original-only reading and saved assets. No token-ledger, daily allowance,
   settlement, rollover or per-instance filesystem-quota acceptance is required.
   Beta UI has no provider/model menu; crafted non-DeepSeek requests fail before egress. Verify R-1's
   same-key clean-context Review, rejection of known bad candidates, and unchanged
   publication/mastery authority on representative real KP, Guide, Inline and saved-note material.
3. **Linux real path:** real representative scanned textbook; upload → PDF → OCR selection →
   Assistant SSE → Master → reviewed Guide → save/collect → progress → close/reopen. Actual controls,
   at least one retry/reversal, and service restart. Bound and record any real-model calls/costs.
4. **Mixed load:** repeat at 2 and 5 authenticated browser sessions/instances for >=15 minutes each,
   overlapping Reader/PDF Range, OCR/upload, Assistant SSE, Master and Guide work. Use deterministic
   delayed provider fixtures for repeatable concurrency, plus bounded authorized live-provider smoke
   through target HTTPS. Report fixture vs live separately. No cross-user events, SQLite lock errors,
   data loss, dead workers or unbounded memory/queue growth. Under this load, non-AI navigation/API
   p95 <=2s on the recorded test network; real SSE deltas flush through Caddy without whole-answer
   buffering. Provider TTFT/completion and queue time are reported separately, not guaranteed <=2s.
5. **Recovery:** restart/update during work, old published Guide retained, Master retryable, completed
   OCR not lost; Assistant/Guide drafts remain intentionally temporary. A stopped-service consistent
   backup restored from off-host into an empty isolated directory passes SQLite integrity/FK and
   blob-hash checks, and reopens real PDF, notes, Memory, Master and progress with unchanged identity.
   Record dataset size and actual elapsed restore time; no RPO <=24h / RTO <=1h pass threshold or
   other frozen RPO/RTO SLA applies.

Targeted tests → agent real-use path → affected regression → full Python/JS closure suites. Independent
review is **required** for auth/isolation, final egress policy, any durable-state migration, resource denial
and restore integrity; the implementer/planner cannot provide their own independent acceptance.
Invocation failure is not PASS. Human Beta acceptance is separate from load scripts and agent checks.

## Development and rollout order

**UI closure → personal stable checkpoint + clean tree → verified private GitHub push (recommended
`personal-v0.1`) → Beta hardening from that baseline → owner completes full server self-test → invite
1–2 friends → expand only after stable use, at most 5.**

Owner server self-test covers authenticated onboarding with the owner's own DeepSeek key, all core
flows, restart, limits and restore on isolated server data; agent tests do not substitute for it.
The 2/5-instance load tests may use controlled test identities before invitations and do not require
inviting five people at once. Record failures and resolve blockers before each expansion; the owner
confirms readiness after the 1–2-person stage. No automatic invitation or rollout from a passing test.

## Not now / autonomy / must report

No shared instance, user_id/domain migration, cross-user deduplication, PostgreSQL, Redis, Docker/K8s,
microservices, distributed queue, complete account system, self-registration, generic provider/key
platform, additional Beta models, RAG/vector DB, new
learning features or zero-downtime releases. Ordinary helpers, test structure and local implementation
choices are delegated; use existing SQLite/runtime boundaries, not a generic budget/workflow framework.
The 2026-09-16 scope amendment also excludes persistent token quota/reservation/settlement ledgers,
Linux per-UID filesystem hard quotas, the 20 GiB instance hard cap, and RPO/RTO compliance automation
from Beta V1. These are removed requirements, not pending acceptance blockers.

Report before expanding architecture, changing ownership/learning/publication rules, degrading the
Windows personal edition, weakening personal OpenRouter proxy
policy, calling other models, adopting another major dependency, or accepting weaker isolation/hard
limits. R-1 is resolved; if same-model Review fails its acceptance tests, report the evidence rather
than adding another provider. Server/domain/DNS, each user's DeepSeek key, participants, verified
private GitHub destination, off-host backup destination and approved live-test
spend are rollout inputs, not reasons to invent values or block fixture-based implementation. Their
absence prevents deployment/live acceptance, not drafting. This document does not authorize purchasing
infrastructure, transferring data or opening public access.

## Completion and handover

This brief and R-1 are accepted. After completion of the personal stable baseline, a fresh Implementer
conversation may implement the accepted scope. Finish with
`docs/development-reports/FRIENDS_PRIVATE_BETA.md`, runnable deployment/restore
instructions and a scoped checkpoint. Use `IMPLEMENTATION_READY` for built/tested artifacts;
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` if target Linux/HTTPS, real materials or 2–5-user acceptance
is missing. Do not call it deployed or Beta-ready until the named security, restore and load checks
actually pass. Planning checkpoint is docs-only; existing unrelated worktree changes are excluded.
