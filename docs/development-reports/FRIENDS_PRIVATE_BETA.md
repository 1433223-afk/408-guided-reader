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
