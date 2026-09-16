# Phase / FRIENDS_PRIVATE_BETA

## Status and goal

`DRAFT — implementation brief pending user acceptance`. On 2026-09-16 the user accepted the audit
and explicitly selected one Linux server → Caddy HTTPS → individual authentication → one Core
Service and one SQLite/PDF data directory per friend. This records that user decision; it does not
mark this newly written brief accepted. Current authorization is documentation only: stop after this
brief, with no product implementation, server provisioning, credential transfer or deployment.

Deliver the smallest operable private Beta for 2–5 invited people, preserving single-user domain
semantics. User-visible result: “我登录自己的地址，教材、对话和学习记录只属于我，更新后仍能继续学习。”

## Authority to read

- `AGENTS.md`; this brief. No development report for this Phase exists yet.
- Product Blueprint §§2–4, 15, 18–19, 23.1, 24.3, 26, 28–30, 33.2.
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

### 2. Final server provider/model policy

| Role | Provider | Exact model |
|---|---|---|
| Assistant / Master default answer | Native DeepSeek | `deepseek-flash` |
| Reading Guide Writer / revision | Native DeepSeek | `deepseek-flash` |
| KP generation | Native DeepSeek | `deepseek-flash` |
| Review: Guide, Inline, KP, Master, saved Assistant explanation | OpenRouter | `google/gemini-3.8-flash` |
| Inline Teaching / other existing System generation | OpenRouter | `google/gemini-3.8-flash` |
| Zhipu / bake-off | Disabled | No calls |

Existing explicit Assistant/Master model choice may select the authorized OpenRouter Gemini route;
defaults above do not remove that capability. No other provider/model or automatic fallback is allowed.
Independent Review stays a fresh context; Inline's same-model fresh-context Review is the existing
permitted fallback, not cross-provider independence. Review failure never publishes unreviewed assets.

Use explicit server values for these existing keys (not a deployable secret file):

```text
GUIDED_READER_ASSISTANT_PROVIDER=deepseek
GUIDED_READER_MASTER_PROVIDER=deepseek
GUIDED_READER_GUIDE_PROVIDER=deepseek
GUIDED_READER_GUIDE_MODEL=deepseek-flash
GUIDED_READER_KP_GENERATOR_PROVIDER=deepseek
GUIDED_READER_KP_REVIEW_PROVIDER=openrouter
GUIDED_READER_REVIEW_PROVIDER=openrouter
GUIDED_READER_SYSTEM_PROVIDER=openrouter
GUIDED_READER_INLINE_MODEL=google/gemini-3.8-flash
GUIDED_READER_DEEPSEEK_MODEL=deepseek-flash
GUIDED_READER_OPENROUTER_MODEL=google/gemini-3.8-flash
GUIDED_READER_DEEPSEEK_DISABLED=0
GUIDED_READER_OPENROUTER_DISABLED=0
GUIDED_READER_ZHIPU_DISABLED=1
GUIDED_READER_PROVIDER_BAKEOFF=0
```

Audit baseline `a248ef2`: `teaching/service.py` can default Guide to `openai/gpt-6-astra`;
`.env.example` explicitly names it and enables Zhipu; Guide/Master/KP/saved-explanation Review defaults
can select Zhipu. Runtime model validation accepts arbitrary nonempty names, not the project allowlist.
These are implementation corrections still owed: align defaults/example and validate final provider,
endpoint and model after **all** role overrides, before every real egress, including retries.
Reject conflicting server configuration; never silently substitute a model. Mock tests prove every row.

Native endpoint: `https://api.deepseek.com/chat/completions`; OpenRouter endpoint:
`https://openrouter.ai/api/v1/chat/completions`. Read keys on Linux through the existing environment
boundary, supplied by root-controlled service secret material outside repository/data/backups (0600;
never command-line values). No Windows Credential Manager, registry or developer shell dependency.
No `.env` autoload is assumed. OpenRouter currently requires `GUIDED_READER_OPENROUTER_PROXY`;
configure a verified server-reachable HTTP(S) proxy, not the developer PC's localhost proxy. Missing
proxy fails closed. Direct OpenRouter egress is not authorized by this brief; report if the required
route is unavailable. Do not transfer or read secret values during planning.

### 3. AI and storage limits

- Per-instance finite daily token allowance and simultaneous provider-call ceiling, enforced at the
  common egress boundary across Assistant, Master, KP, Guide, Inline, Review and saved-note Review.
  Proposed initial limits: **200,000 input+output tokens/day, 2 active calls/person**, date boundary
  Asia/Shanghai. These are brief defaults for review, not observed usage or a currency price promise.
- Atomically reserve a conservative input bound + requested maximum output before each transport
  attempt, reconcile against validated usage, and retain the reservation when outcome/usage is
  uncertain. All retries/revisions/recovery calls cost allowance; reasoning counts as provider usage.
  Reservations survive restart, concurrent admission and day rollover without minting free allowance.
  Do not hold SQLite write transactions during network I/O. If a safe bound cannot be established,
  reject before egress; do not label an after-the-fact counter a hard cap.
- Bound waiting requests and pending generation work; excess gets a clear retryable Chinese response.
  Existing logical idempotency remains. KP internal thread pools consume the same call ceiling.
  With five instances the starting aggregate ceiling is ten calls; lower per-instance ceilings if the
  real provider account limit requires it. No distributed limiter. Administrator can disable new AI.
  Quota/concurrency failures never change mastery, discard questions/notes or bypass Review.
- Proposed storage defaults: **512 MiB/upload, 20 GiB total per instance, 2 GiB host free-space reserve**.
  Check upload length and reserved space before intake; account for simultaneous uploads, temp files,
  SQLite/WAL and generated state. Combine application admission with an OS/filesystem hard limit;
  retain room to complete transactions and reject new growth cleanly. No automatic deletion of
  user assets. PDF/read access remains available when new AI/upload writes are refused.

### 4. systemd, backup and reproducible release

- One supervised systemd service per instance, `--no-open`, explicit port/data root/working directory,
  non-root UID, restricted writable paths, restart policy, bounded CPU/memory/tasks and log retention.
  Begin with one OCR/preparation worker per instance; do not add processes sharing a DB to scale.
  Bounded transient-session cleanup and worker-stall diagnostics belong only to operating this Beta.
- Pin a reproducible Linux release including Python dependencies, npm locked static resources and OCR
  weights; verify no first-user implicit model acquisition. Data and secrets outlive release folders.
  A Python package alone currently lacks the required repository-relative `node_modules` resources.
- Daily low-traffic stop-and-backup per instance: deny/drain writes, stop Core, snapshot the complete
  SQLite state and blobs together, then restart. Include nonsecret configuration, schema/release IDs
  and checksums. Encrypt and copy off-host; proposed retention 7 daily + 4 weekly, RPO <=24h, restore
  target <=1h for the validated Beta dataset. Alert on failed backup. Keys are managed separately.
- Take a verified pre-update backup; update one instance at a time. No running-DB main-file-only copy,
  no reliance solely on same-disk migration backups. Restore into an empty isolated directory and
  validate SQLite integrity/FKs, blob hashes and real user flows. Code rollback must match DB schema.
  Preserve original data until restore verification; no destructive restore to live data in tests.

## Acceptance

1. **Identity/security:** two real credentials and separate instances; anonymous/wrong-host access
   fails for HTML, APIs, PDF Range and SSE. A cannot read/change/delete B's PDF, OCR/KP, Guide,
   Master, Memory, marks or progress, even with known B object/session IDs. Cross-instance filesystem
   access fails. Public backend/admin/debug access fails; secret/body canaries never enter logs.
2. **Limits:** mock provider tests cover all routes/overrides, simultaneous budget reservation,
   multi-call Guide/KP, Review/retry, missing usage, interrupted calls, restart and rollover. No
   unapproved model request leaves. Upload concurrency, oversize, disk exhaustion and quota failure
   leave durable assets valid. AI exhaustion preserves original-only reading and saved assets.
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
   OCR not lost; Assistant/Guide drafts remain intentionally temporary. Off-host restore meets the
   measured RPO/RTO and reopens real PDF, notes, Memory, Master and progress with unchanged identity.

Targeted tests → agent real-use path → affected regression → full Python/JS closure suites. Independent
review is **required** for auth/isolation, final egress policy, durable quota/migration, resource denial
and restore integrity; the implementer/planner cannot provide their own independent acceptance.
Invocation failure is not PASS. Human Beta acceptance is separate from load scripts and agent checks.

## Not now / autonomy / must report

No shared instance, user_id/domain migration, cross-user deduplication, PostgreSQL, Redis, Docker/K8s,
microservices, distributed queue, complete account system, self-registration, RAG/vector DB, new
learning features or zero-downtime releases. Ordinary helpers, test structure and local implementation
choices are delegated; use existing SQLite/runtime boundaries, not a generic budget/workflow framework.

Report before expanding architecture, changing ownership/learning/publication rules, weakening proxy
policy, calling other models, adopting another major dependency, or accepting weaker isolation/hard
limits. Server/domain/DNS, proxy, keys, participants, off-host backup destination and approved live-test
spend are rollout inputs, not reasons to invent values or block fixture-based implementation. Their
absence prevents deployment/live acceptance, not drafting. This document does not authorize purchasing
infrastructure, transferring data or opening public access.

## Completion and handover

After user acceptance of this brief, a fresh Implementer conversation may implement the accepted
scope. Finish with `docs/development-reports/FRIENDS_PRIVATE_BETA.md`, runnable deployment/restore
instructions and a scoped checkpoint. Use `IMPLEMENTATION_READY` for built/tested artifacts;
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` if target Linux/HTTPS, real materials or 2–5-user acceptance
is missing. Do not call it deployed or Beta-ready until the named security, restore and load checks
actually pass. Planning checkpoint is docs-only; existing unrelated worktree changes are excluded.
