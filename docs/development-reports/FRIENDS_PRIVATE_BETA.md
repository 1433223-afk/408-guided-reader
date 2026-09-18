# FRIENDS_PRIVATE_BETA Development Report

## Result

2026-09-16 — `IMPLEMENTATION_READY` for server deployment preparation;
`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` for target Linux/HTTPS, paid provider quality, mixed load
and encrypted off-host restore. No public deployment, invitations or live provider calls occurred.

The accepted brief and scope amendment are implemented on `friends-private-beta`, from authority
checkpoint `f71f5bb04dd80d899d26740a9a5886b014982c3f`. Initial branch/ancestry/clean-tree checks passed.
The user's explicit implementation instruction controls over the brief's historical pause language.
The two other named working repositories were not modified. A historical personal database snapshot
and PDF blobs were read only to create disposable test fixtures.

## Implemented

- Explicit personal/beta profiles, disjoint absolute data/credential roots, loopback-only Beta,
  process-held data-directory lock and writer-draining normal shutdown. Personal remains the default.
- Beta Host/Origin/proxy-protocol checks, Secure/HttpOnly/SameSite cookie, bounded HTTP workers,
  no launch-token header bypass, inspection/debug/bake-off denial and redacted operational logs.
- Native DeepSeek only, fixed HTTPS endpoint and `deepseek-flash`, checked after role/per-call
  overrides and at each final transport attempt. No inherited key, proxy, alternate model or fallback.
  Guide, Inline, KP, Master and saved-note Review retain their existing publication/authority rules.
- User BYOK validation/status/replace/disconnect, atomic private 0600 credential file outside product
  storage and backups, no key response or browser persistence, authentication-failure invalidation
  that cannot invalidate a concurrently replaced key. UI explains Review/retry costs and operator trust.
- One instance-wide two-call guard, immediate retryable busy response, root-controlled AI-off marker,
  bounded pending jobs/background reviews and stale Assistant session cleanup/heartbeat.
- 512 MiB upload ceiling, simultaneous-upload reservations and 2 GiB free-space margin. New content
  commits recheck disk; bounded failure/recovery bookkeeping may use the reserve. Low-space worker
  pause/recovery and current-schema restart preserve read access. No automatic asset deletion.
- Minimal Chinese Beta Key dialog and DeepSeek-only controls, with existing Reader/Master/Guide/KP/
  Memory views retained. No schema migration, user_id, token ledger, hard quota or SLA system.
- Stock Caddy, systemd and nftables templates, per-user inventory, Python/static/OCR release checks,
  installation/update runbook and stopped-service backup/empty-directory restore tools.

## Important implementation decisions

Local UID/port isolation is a **required** part of the accepted architecture. Core's launch-cookie
bootstrap trusts the local proxy path: Host/Origin alone cannot authenticate a hostile local UID.
The nftables template permits only root and Caddy to reach Core ports and only root to reach Caddy
admin; every Core UID is denied direct backend access. Effective target-host rules must be verified
before use. No extra Caddy-to-Core secret was introduced.

Beta keeps the existing adapter interface. Its direct HTTPS transport has a total deadline (15 seconds
for Key validation; at most 120 seconds for a normal attempt), bounded DNS wait with at most two
abandoned resolvers, interruptible connect/TLS/header/body processing, and JSON/SSE byte limits.
The watchdog retains the transport socket even when `Connection: close` detaches it from the HTTP
connection. Network and validation failures never imply Review PASS. Personal OpenRouter retains
its forced-proxy policy; its real transport rejects models outside the existing AGENTS authorization.

Backups contain SQLite, hash-addressed PDF blobs and a checksummed schema/release/nonsecret-config
manifest. Keys/logs/temp/migration backups are excluded. The operator script verifies the release
stamp, requires successful systemd stop, checks process exit, snapshots under the data lock and
restarts. Restore refuses populated destinations. A hash manifest detects corruption, not a malicious
trusted host operator. Off-host encryption/transfer is a documented operator step, not automation.

Prior art consulted: official Caddy basic_auth/reverse_proxy documentation, SQLite backup guidance,
and systemd.exec documentation. Caddy is the already-selected Apache-2.0 distributed binary; no
external application source, custom plugin, database or queue dependency was adopted. Target
distribution manuals, directive validation and wheel builds still require actual Linux preflight.

## Deviations from Spec

No accepted product/architecture rule was changed. The user-selected branch name is used. Real server,
domain, user keys, authorized live spend and off-host destination were not supplied, so their named
acceptance remains pending. Current `origin` is configured as
`https://github.com/1433223-afk/408-guided-reader.git`; its private visibility and baseline/tag push were
not verified in this run (`gh` is unavailable). Nothing was pushed. The historical baseline report's
"no remote" statement must not be treated as current remote evidence.

Two inherited UI test fixtures were updated to the already-accepted personal UI: the Chapter test
now includes the real Reader container; Memory E2E follows book/section/item navigation instead of
removed card/filter selectors. These are test corrections, not a product UI redesign.

## Acceptance evidence

- TARGETED: profile, lock, Host/Origin, cookie, debug denial, Key canaries, whitelist/final override,
  shared complete/stream saturation/release, rotation/auth failure, DNS/response deadlines, upload
  reservations and disk/worker recovery. Final Beta boundary suite: **24 PASS**.
- TARGETED: backup corruption/traversal/extra-member rejection, identity and Key exclusion:
  **3 PASS**. Same-key Guide generation/clean-context Review and known-rejected regeneration retain
  the old published Guide. Saved-note saturation retains the note with retryable technical failure.
- CLOSURE: complete Python suite **349 PASS, 2 SKIPPED** (351 collected at that run). Skips are the
  two inherited real-OCR corpus cases because `READER_REAL_DMA` and `READER_REAL_PRIMARY` were not
  supplied. After adding three regression cases from review, Beta + saved-note targeted suite
  **37 PASS**; current collection is 354 cases. No production changes followed the Python closure.
- CLOSURE: complete `npm test`: **51 PASS**. Initial run exposed the inherited missing Reader test
  container; targeted repair and full JS rerun passed.
- AGENT REAL USE, local HTTPS fixture: actual Beta application plus a local TLS/Basic-Auth proxy
  fixture and fake provider transport. Invalid Key → connect → replace → close/reopen → disconnect;
  input cleared, storage/log canaries absent, Secure cookie flags, no alternate provider options;
  restored real 348-page textbook opens without a Key, page navigation → Library → reopen. No browser
  errors. Final fixture shutdown exits normally. This is **not** Caddy/Linux/live-provider acceptance.
  Initial test used obsolete Overview text; corrected to the actual control. A first 10-second fixture
  shutdown wait expired during work; final bounded 60-second drain check passed, without claiming that
  every production shutdown completes in 10 seconds.
- PERSONAL AFFECTED REGRESSION: real-book Guide E2E **PASS**, with local deterministic provider
  fixtures, review/replacement/retry and no live billing. Master E2E **PASS**, including independent
  sections, explicit confirmation, retry without duplicate messages and restart/AI-off history.
  Memory E2E **PASS** after obsolete fixture navigation was updated: collect, source return, restart,
  removal/recollection/cascade and protected source state unchanged, zero new provider calls.
- OFFLINE OCR: pinned weight hashes verified; socket connect disabled; engine construction and real
  textbook page 39 OCR **PASS**, 71 normalized lines. This checks the new offline path on Windows;
  it does not substitute for Linux installation or the absent nine-page inherited corpus.
- REAL DATA RECOVERY: a read-only immutable historical snapshot
  `D:\codex\408-guided-reader\var\manual-browser\state.sqlite3.pre-canonical-36f8842-20260915-230807.bak`
  and its blobs were copied into ignored `test-results/beta-real/source`. Pending jobs were cancelled
  only in that disposable fixture. The isolated source was stopped for the new backup operation;
  empty restore contained **373,117,416 bytes**, measured **1.746 seconds**, schema 19. SQLite
  integrity/FKs/blob SHA checks and all table counts matched. Contents included two textbooks
  (348/412 pages), 46,098 OCR lines, 232 KPs, 7 annotations, 31 Master messages, 2 Memory memberships
  and 9 section progress records. Identity preservation was checked, and restored PDF was opened
  through the actual Beta UI. This is neither a backup of the live personal directory nor an off-host
  restore claim. The fixture manifest records authority commit `f71f5bb` as its supplied code stamp;
  a deployment backup must use the verified actual release stamp.

Representative textbook SHA-256:
`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
Personal materials, fixture databases, certificates, screenshots and keys remain outside Git.

## Independent boundary review

The separate reviewer task `beta_boundary_review` performed read-only adversarial review of
auth/isolation, egress, denial/recovery and backup integrity. It did not implement the changes.
It independently ran 27 then-current boundary/backup/jobs tests and reproduced low-disk worker death,
low-space restart failure, DNS/connect deadline gaps, `Connection: close` drip behavior, and BYOK
busy/error classification. It also found raw malformed-request logging, the saved-note saturation
argument error and stale session cleanup omission. Findings were fixed; independent retests included
0.08-second body-drip deadline returning at about 0.103 seconds and low-space restart preserving a
live paused worker. Final review reported **no confirmed blocking finding remaining** in reviewed
implementation/fixture scope. It explicitly did **not** claim Linux, live provider, mixed-load or
off-host acceptance, and did not independently rerun the real historical-data restore.

## Known limitations / pending server acceptance

Before public deployment/invitations: verify private GitHub baseline; target Linux dependencies and
OCR with network denied; validate systemd/Caddy/nftables against installed versions; demonstrate
two-host credentials/known-object-ID/cross-UID filesystem and backend isolation, public backend/admin
denial, HTTPS/cookies/log canaries, and actual Caddy SSE flushing. Run authorized live BYOK and
real-book KP/Guide/Inline/saved-note Review calibration, including known-defect rejection. Complete
the accepted **2 and 5 instances, at least 15 minutes each**, resource/restart/update checks and
non-AI navigation p95 measurement. Encrypt/copy off-host and restore into an empty isolated server
directory; validate PDF/notes/Memory/Master/progress and re-enter Key. None is marked PASS here.

No promise of hard disk quota, token/currency cap or RPO/RTO is made. Free-space checks depend on the
shared filesystem's actual free capacity. The administrator remains trusted with access to credentials.

## Reproducible entry points

- Deployment/install/update/restore: `deploy/beta/README.md` and adjacent templates.
- Always set `PYTHONPATH=src` for this checkout; the machine's editable Python installation can point
  at another checkout. `python -m pytest`; `npm ci`; `npm test`.
- `python -m pytest tests/test_beta_boundaries.py tests/test_beta_backup.py tests/test_jobs.py tests/test_saved_explanations.py`.
- Local HTTPS UI: set `READER_BETA_FIXTURE` to an **isolated restored** real Library;
  `node tests-e2e/friends-private-beta.mjs`. Requires Edge/Chrome, free loopback port 443, and the
  test-only installed `cryptography` package for an ephemeral certificate. No certificate is committed.
- Personal E2Es: `READER_DATA_DIR` points to an isolated real Library copy, never live user data.
  Run `learning-memory.mjs`, `master-learning.mjs` (live flags off), and `reading-guide.mjs`
  (`GUIDE_E2E_REAL=0`, Guide provider/model set to `deepseek`/`deepseek-flash`; transport is local fixture).
- Core boundaries: `instance.py`, `agent_runtime/beta.py`, `agent_runtime/deepseek.py`, `server.py`,
  `disk.py`, `jobs/worker.py`, `backup.py`, `release.py`, `static/beta-ui.js`.

## Git checkpoint

Implementation checkpoint: the commit containing this report on `friends-private-beta`, descending
from `f71f5bb`. Resolve with `git log --oneline -- docs/development-reports/FRIENDS_PRIVATE_BETA.md`.
No push or deployment is part of this checkpoint.

## Owner server operations recovery — 2026-09-17

This section records a subsequent user-authorized server session; it does not retroactively turn
the implementation fixtures above into live acceptance. Cold start re-read AGENTS, the Phase and
its named blueprint sections, related reports, deployment templates and actual intake/security code.
Local and GitHub `friends-private-beta` both began at
`48165746d1347fc858d8774452353c08ee2ca9fa`, with a clean tree. The server's sealed release verified
at that same commit. `main` remained `15bb7cd9a9d131479e76656e2350bfc63fc0b870`.

**SSH:** TCP/KEX/known-host checks succeeded, but the interactive password attempt was rejected.
Console logs showed failed password authentication and successful existing admin public-key sessions;
they do not establish whether the password was mistyped or incorrect. The user appended the prepared
dedicated operator public key through the cloud console. Repeated independent BatchMode key sessions
and sudo succeeded. Existing authorized keys and sshd policy were preserved.

**Root cause:** Caddy's `read_body 120s` is a total request-body deadline. Both reported failures
matched Caddy 502 `i/o timeout` at 120 seconds and Core 422 from incomplete PDF intake. The exact
12,582,672-byte, 29-page scanned PDF passed existing strict validation in 0.090 seconds, with SHA-256
`327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`.
Disk had 31 GiB available. Upload through authenticated local HTTPS succeeded in 0.933 seconds.
A controlled 80 KiB/s upload reproduced 502 after 120.819 seconds, with only 9,895,936 bytes sent.
The client received an empty 502 response, not a usable 422 JSON body; Core's 422 was visible in the
redacted service log. No claim is made to have captured the original browser response body.

**Fix:** privately backed up `/etc/caddy/Caddyfile`, validated a bounded `read_body 10m`, and reloaded
Caddy as root. Effective `read_timeout` was 600 seconds. The stock `systemctl reload caddy` first
failed because it runs as the Caddy UID, which the required firewall denies access to port 2019;
the old configuration remained running, and its file was restored before the root reload. The
firewall was not relaxed. Repository changes only synchronize the deployment template/runbook and
this report. No Python/JS product source, DB schema, sealed release, or release symlink changed;
therefore no new product release was deployed. Let in-flight uploads finish before maintenance.

**Live targeted evidence:**

- Same 80 KiB/s upload after the fix: **200**, 153.631 seconds, all 12,582,672 bytes, duplicate=true
  with the same Book identity. Windows-to-public-HTTPS upload also passed: **200**, 25.470 seconds.
- Intentional upload cancellation after 3 seconds: temporary upload removed, Library remained 200;
  existing PDF Range returned 206. Hostile Origin returned 403, inspection 404, explicit oversized
  HTTP/1.1 body declaration 413 without sending a large body. A bodyless HTTP/2 probe returned 422;
  the valid oversized-declaration probe is the 413 evidence.
- Root and Caddy UID could connect to Core; gr-owner could not. Caddy UID could not connect to 2019.
  Core remained `127.0.0.1:18761`, admin `127.0.0.1:2019`; HTTPS/Basic Auth/512 MiB cap preserved.
  Credential directory/file remained gr-owner-owned 0700/0600. Original release seal still VERIFIED.
  Anonymous static/API/PDF/Assistant requests returned 401. An authenticated mismatched HTTP Host
  under the valid site's TLS SNI returned an empty Caddy 200 (zero bytes, no application content),
  not an explicit 4xx. No application route/data was exposed; strict unknown-host rejection remains
  a separate pre-invitation acceptance item rather than being reported PASS here.
- One live Assistant request used an OCR selection on PDF page index 12 through HTTPS/Caddy.
  Immediately beforehand, the service reported native DeepSeek, exact `deepseek-flash`, exact
  `https://api.deepseek.com/chat/completions`, READY with the private credential loader. The actual
  SSE emitted 244 answer deltas and one complete event: first answer at 1.113 seconds, complete at
  2.630 seconds (2.641 seconds total). No provider body/key was logged by the test. Its temporary
  Assistant session was closed afterwards. No second paid test or other provider was invoked.
- **User real-use PASS:** user confirmed successful browser PDF opening (provided page-13 screenshot),
  selecting OCR text, returning to Library and reopening. The screenshot showed 22/29 selectable
  pages while preparation progressed. These are user observations, not agent pointer automation.
  Agent in-app browser access failed with connection closed; no agent-browser PASS is claimed.
- Performance sample from Windows: Library GET 0.105 seconds; a 256 KiB PDF Range took 11.489 seconds
  (~22.3 KiB/s). Initial server OCR pages took roughly 12–32 seconds each. These separate transport
  and preparation costs; they do not prove a particular cloud bandwidth cap or compare controlled
  local/server benchmarks. The timeout fix does not make a slow link faster.
- At the final service check Core was active/running, MainPID 96970, zero restarts and about 368 MiB
  cgroup memory; Caddy and nftables were active. Swap remained unused at the sampled instant.
- Temporary website credentials, cookie jar and test payload files were removed from the operator
  workspace; the Windows DPAPI credential file and downloaded test-PDF copy were also removed.
  The user's original PDF, imported book/data, permanent BYOK and dedicated SSH key were preserved.

**Independent review:** `ops_timeout_review` independently inspected the template, intake and server
resource boundaries. No blocking issue was found for the bounded deployment adjustment; it did not
perform server tests. The 32-worker ceiling, 30-second socket idle timeout, disk reservations and
size limit remain. Authenticated slow uploads can still occupy all workers, and 10 minutes is not
a guarantee that 512 MiB uploads over every network. Mixed-load acceptance remains pending.

Validation is deployed Caddy validation/effective-config checks plus the live targeted checks above
and `git diff --check`. Python/JS suites are INTENTIONALLY_NOT_RUN for this operations-only change:
no executable product source or dependency changed, and this does not close the broader Phase.
Still pending: two-instance isolation, 2/5-instance mixed load, remaining Master/Guide/KP/Inline and
Review quality paths, restart/update recovery, encrypted off-host backup/empty restore, and final
owner rollout approval. No invitations or expansion were performed.

## Owner Core backlog correction — 2026-09-17

User-authorized narrow product fix, deployed as immutable release
`7ba3f6cbb796b515dae0982a2a970a9191b1d298`. Only Beta `ReaderServer` now sets
`request_queue_size = 64` before `TCPServer.__init__` activates its socket. Personal retains the
inherited default. The 32-active-handler bound, thread model, HTTP version, socket timeout,
dependencies, schema, Caddy and nftables are unchanged. Backlog is pending connections, not permission
to execute 64 handlers. No live provider call was made.

**Root cause/evidence:** the deployed Python 3.12 server inherited listen backlog 5. Browser-like
parallel frontend h2 requests cause separate HTTP/1.0 upstream connections; admission bursts overflowed
the small accept queue. Before the fix, three batches each of 8 and 16 authenticated local HTTPS
health requests (72 total) raised host ListenOverflows/ListenDrops from 16 to 32. A prior Caddy error
recorded a 3.002-second Core dial timeout; that individual event was not packet-traced, so it is not
claimed conclusively caused by this queue. No universal per-request fixed delay was established.

**Tests:** Beta targeted suite 26 PASS, including both profile variants and real socket activation
with the backlog observed before listen. Full Python 354 PASS / 2 SKIPPED in 246.21 seconds; the
inherited real-OCR corpus cases remain unavailable. Full JS 51 PASS. `git diff --check` passed.
The new test and existing security boundary regression passed; no new independent audit is claimed.

**Deployment/recovery:** new release built from the pushed commit with fresh venv and pinned wheels;
unchanged lockfiles and copied previously sealed browser assets/models verified. New release is
root-owned, non-writable by instance UID, sealed and verified (190 manifest files). Original release
was preserved. Stopped-service backup verified schema 19, SQLite/FKs/blob integrity; restore into a
fresh directory verified 15,367,952 bytes in 0.382 seconds, excluding credentials. This is local
pre-update recovery evidence, not encrypted off-host backup acceptance. Artifacts:
`/var/backups/guided-reader/owner-backlog-20260917T152635Z/{backup,restore}`.
Service was stopped cleanly and its `current` symlink switched to the new release. Caddyfile and
persistent nftables file checksums matched before/after. No existing data was deleted.

**Same-probe after:** live `ss` reports loopback listener backlog 64. All 72 requests returned 200
over h2. ListenOverflows/ListenDrops stayed 32 (zero increment), versus +16 before.

| Local Caddy HTTPS burst | Before max TTFB / total | After max TTFB / total |
|---|---:|---:|
| 8 concurrent, 3 batches | 1.045 / 1.087 s | .078 / .084 s |
| 16 concurrent, 3 batches | 1.245 / 1.284 s | .071 / .114 s |

TTFB and total maxima are independent maxima across each group. No new Caddy error was found in
the checked post-deployment window starting 15:27 UTC. This bounded check is not a never-again
timeout guarantee. Reader running, NRestarts=0; Caddy/nftables active; release re-verification passed.
Windows normal authenticated HTTPS homepage/Library returned 200 and existing PDF Range 206.

**Browser Timing acceptance pending:** before screenshots supplied by the user showed homepage
Waiting 247.87 ms / download 361.49 ms / total 611.50 ms; styles.css Waiting 3.76 s / download
5.17 s / total 8.94 s. They had no displayed DNS/TCP/TLS phase and minimal queue/stall. After
Chrome Timing has been requested but not received at this checkpoint. Windows computer-use had
repeatedly stopped on inability to identify the browser URL; no automated Chrome PASS is claimed.

**Independent remaining transport issue:** after the fix, local Caddy h2 warm CSS TTFB was
5.29–5.44 ms, total 5.42–5.68 ms for all 50,087 bytes. Windows HTTP/1.1 curl (not Chrome) warm
CSS via current proxy had TTFB .221 s / total 2.055 s (about 1.834 s after first byte); DIRECT
.082 s / 1.114 s (about 1.032 s after first byte). Cold CSS totals were 1.575 s proxy and .558 s
DIRECT. This is a small diagnostic sample, not sustained bandwidth or a controlled browser
before/after comparison. It reproduces slow body reception without frontend code, while the
local server completes promptly. Exact loss/congestion/proxy/firewall contribution remains
unresolved; no proxy/security setting or compression/cache policy was changed. Do not claim this
backlog fix resolves all perceived slowness. No server upgrade is indicated by these findings.

Raw nonsecret before/after metrics remain in the operator GuidedReaderOps directory and on the
server operator cache. Earlier performance-session temporary Basic Auth/cookie files were reused
for this authorized check; their previously policy-blocked cleanup remains pending, not claimed done.

## PDF opening/reopening optimization — 2026-09-18

The user authorized continued optimization and selected opening/reopening PDF as the priority.
Deployed product commit: `c6aa2f8b00467b742570e788bb0d75ca0c8a1ab0`.

**Reproduced:** in an isolated copy of the existing real-book fixture, three open/close cycles left
1, then 2, then 3 PDF workers alive. `closeReader` discarded its reference without destroying the
PDF.js loading task. Default PDF.js streaming also received the full 152,550,990-byte source plus
overlapping Range data while only reading a small part of the book. This is evidence of resource
leak/unnecessary transfer, not proof that it explains all public-network slowness.

**Change:** retain the PDFDocumentLoadingTask and destroy it on close, replacement or current-load
failure. Stale load/render completion must neither display an error for the new book nor remove
its render-task entry. Beta uses native `disableStream:true` plus `disableAutoFetch:true`, leaving
Range loading enabled. Personal retains its default fetching strategy and gains task cleanup.
No PDF rewriting, cache/persistence change, dependency, provider call, Caddy/firewall change, or
thread/architecture change. Prior art/API contract checked in the installed PDF.js 6.3.289 types:
`destroy()` aborts network/worker; disabling prefetch requires disabling streaming too.

**Validation:**

- Four new targeted JS cases: personal/Beta options and cleanup, pending-load replacement,
  current-load failure and retry. Full JS **55 PASS**. Full Python **354 PASS, 2 SKIPPED** in
  252.79 seconds (same missing real-OCR corpus cases). `git diff --check` passed.
- Personal local real-book cycles: each close returned worker count to zero instead of accumulating.
- Actual local HTTPS Beta fixture, same isolated real book: three cycles; far jump to PDF page 200;
  rendered canvas, OCR overlay and actual pointer-selected text; return/reopen; close during a delayed
  PDF response without stale failure notification. Zero page errors, zero workers after each close.
  First attempts incorrectly expected the old selection toolbar behavior; the test was corrected
  to assert actual selection quads and native selected text. No selection product code changed.
- Same-book strategy A/B, three runs each: native default stream/prefetch received
  176,520,348–176,913,564 PDF bytes by two seconds after first rendered canvas; Beta demand mode
  received 27,901,518 bytes (about **84% less**). Measured using CDP Network.dataReceived on the
  isolated test browser, including full-stream bytes, not just Range response headers. The test-only
  baseline removes the two loading options from the served local script; cleanup remains enabled
  in both sides so the comparison isolates fetching strategy. No interception on the public service.
- LAN first-render timing did **not** demonstrate a consistent speedup: default 1.383–1.949 seconds,
  demand 1.377–4.500 seconds. The confirmed benefits are transfer reduction and resource release;
  do not claim 84% faster opening. Sparse PDF access still required 410 requests / ~28 MB for this
  source and viewport. Public-network perceived opening speed remains a user retest item.
- Reproducible real-use runner: `READER_BETA_FIXTURE=<isolated restored real book with at least 200
  prepared pages> node tests-e2e/pdf-loading.mjs`. It requires local port 443 and the existing
  cryptography fixture dependency; it never uses live AI. `PDF_PREFETCH_BASELINE=1` selects the local
  A/B baseline. Results land in ignored test-results. Raw textbook/credentials are not committed.

**Deployment:** built a fresh venv from pinned wheels and unchanged locked browser assets/models;
sealed/verified 190 files, root-owned release. Verified stopped-service backup of prior `7ba3f6c`,
empty restore (15,367,952 bytes, 0.648 seconds, schema 19, keys excluded), then switched `current`.
Artifacts: `/var/backups/guided-reader/owner-pdf-20260918T052555Z/{backup,restore}`. This is local
recovery validation, not encrypted off-host acceptance. Prior data/releases preserved.

Live authenticated HTTPS checks: homepage/app.js/Library 200; app.js contains the new loading options
and cleanup; existing PDF Range 206; anonymous static remains 401. Caddyfile/nftables configuration
checksums unchanged. 8/16 concurrent h2 health requests, three batches each, all 200 and zero added
listen overflow (32 stayed 32). Reader/Caddy/nftables active; Reader NRestarts=0. The prior backlog
fix remains in the release. No public UI automation or user performance PASS is claimed.

The user's earlier post-backlog screenshots showed two requests around 190 ms (Waiting ~170 ms,
download ~4 ms), but omitted request names; they cannot be mapped conclusively to homepage/CSS.
User reported some improvement but still slower than local. This new PDF release requires a page
refresh and open/close/reopen retest. Remaining network/body-transfer variability is separate.
