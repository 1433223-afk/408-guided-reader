# Friends private Beta operator runbook

Implementation materials only. No public deployment has been performed. The target is a dedicated
Linux host with stock Caddy, systemd and nftables. Validate their installed versions and manuals on
that host before enabling a listener. Do not invite users until the acceptance checklist below passes.

## Release and installation

1. Verify the accepted personal baseline/private GitHub remote separately. Build from the intended
   clean implementation commit, not a mutable working tree. Record `git rev-parse HEAD` in
   `RELEASE_COMMIT`. Keep each release at `/opt/guided-reader/releases/<commit>`; do not put data or
   credentials there. Preserve the complete `src` tree (including skills/static files) and the
   repository-relative `node_modules` browser assets.
2. On the target Linux/Python architecture, create `.venv`; download wheels with
   `python -m pip wheel -r deploy/beta/requirements.lock --wheel-dir wheelhouse`.
   Record Python patch version, architecture, OS and `sha256sum wheelhouse/*` in the deployment
   record. Keep the wheelhouse and its checksum list with the release. Install with
   `.venv/bin/python -m pip install --no-index --find-links wheelhouse -r deploy/beta/requirements.lock`.
   Run `npm ci` using the committed package lock. The pinned versions match the tested development
   environment; Linux wheel availability/installability is a required target-host preflight, not a
   claim made by this repository. Do not silently substitute versions on failure.
3. Pre-acquire the three RapidOCR ONNX files in the installed `rapidocr/models` directory. Exact
   names and SHA-256 values are in `src/reader_service/release.py:OCR_WEIGHTS`. Use the upstream
   RapidOCR distribution/model source in an operator build step; verify the hashes. Runtime passes
   explicit local paths and refuses absent/mismatched weights. No first-user download is allowed.
   Run `PYTHONPATH=src .venv/bin/python -c 'from reader_service.foundation.rapidocr_adapter import RapidOcrEngine; RapidOcrEngine(offline=True)'`
   with network denied, then perform a real scanned-page OCR smoke.
4. Run `PYTHONPATH=src .venv/bin/python -m reader_service.release seal --root "$PWD"`.
   `verify` recomputes source/static/lock/release-stamp hashes, installed dependency versions and OCR
   hashes. This is integrity checking, not a signature against a hostile root administrator. Make the
   release and venv root-owned and read-only to all instance users. Keep wheel hashes and deployment
   metadata outside writable instance directories.
5. Fill `instances.example.json`: unique name, numeric UID, loopback port, hostname, data directory
   and credential directory. Run `python -m reader_service.release inventory --inventory <file>`
   on Linux. Create `gr-alice`, `gr-bob`, etc. as distinct system users with no login shell. Create
   `/var/lib/guided-reader/alice` and `/var/lib/guided-reader-credentials/alice` owned by `gr-alice`,
   mode 0700; repeat for each user. Parent directories and `/etc/guided-reader` are root-owned.
   Never seed a new friend with the owner's database; each new instance starts empty.
6. Create root-owned `/opt/guided-reader/instances/alice/current` pointing to the immutable release.
   Install `.env.example` as `/etc/guided-reader/alice.env` (root-owned, group-readable by its service
   only) with nonsecret port/origin. Install `guided-reader@.service`, run `systemd-analyze verify`,
   then `systemctl daemon-reload`. Check systemd directives against the installed manuals. The
   service has one OCR worker, 2 GiB memory, 150% CPU, 96 tasks, 1024 FDs, no core dumps and bounded
   journal rate. Apply `journald.conf.example` as a drop-in after reviewing host-wide impact.

## Authentication and local isolation

Use distinct Basic Auth usernames/passwords and bcrypt hashes per hostname. Generate hashes via
interactive `caddy hash-password --algorithm bcrypt`; never put plaintext passwords or API keys
in command arguments. Adapt `Caddyfile.example`, run `caddy validate --config <file>`, and inspect
the adapted JSON. HTTPS, auth, exact upstream Host, no forwarded Authorization, no access log,
no shared cache, no inspection/debug routes and immediate SSE flushing apply to every route.
The cookie is a separate per-process Secure/HttpOnly/SameSite launch credential, not Basic Auth.

The request-body deadline is **10 minutes total**, with the same 512 MiB size limit. It is not an
idle timeout and does not guarantee that the maximum file size can upload over every connection.
The earlier 120-second template cut off a valid 12 MiB PDF at 80 KiB/s: Caddy returned 502 while
Core logged 422 for an incomplete intake. Keep the deadline bounded; verify a representative slow
upload, cancellation cleanup and normal reading before changing it for another deployment.

After validating a changed Caddyfile, reload as the root operator:
`sudo caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
The stock service's `systemctl reload caddy` runs as the Caddy UID and cannot reach the root-only
admin port under the required firewall below. Do not relax that rule to make reload work. Back up
the configuration privately before editing, and verify the effective configuration after reload.
Before stopping Core for maintenance, let uploads finish; its shutdown deadline is separate from
the proxy upload deadline.

**The UID firewall is required, not optional hardening.** A local process allowed to connect to Core
can spoof proxy headers and bootstrap a launch cookie. Render `isolation.nft.example` with the real
Caddy UID and every allocated Core port. Only root and Caddy may connect to these loopback ports;
even the instance UID cannot connect directly to its own or another Core. Admin port 2019 is
root-only. Do not reuse the Caddy UID for a Core. Do not load an example UID unchanged. Validate
with `nft --check --file <file>`; merge into the host rules without flushing unrelated rules, make
it persistent, and test after reboot. Core units require nftables.service, but this does not prove
the intended rules were loaded: the operator must check the effective rules before starting users.
No Caddy-to-Core secret is introduced.

The nftables template bounds new TCP/auth connections and packet rates, including retained HTTP/2
connections, with finite expiring source meters; QUIC is disabled. Tune only after the mixed-load
test. This is a simple local resource bound, not distributed brute-force protection. Keep the host
dedicated to these instances. Do not add an unauthenticated proxy route or public backend bind.

Each user's HTTPS UI provides Key validation, connected status, replacement and disconnection.
Validation makes one small DeepSeek request, shares the two-call ceiling, and has a 15-second total
deadline. All ordinary attempts are bounded by 120 seconds and JSON/stream byte caps. DNS has at
most two outstanding resolver threads. Keys are private 0600 files outside data; root can access
them. No browser storage, product DB, ordinary backup or operator-funded fallback is used.
Generation, Review and retries cost the user's provider balance; concurrency is not a spending cap.
Touch `/etc/guided-reader/alice.ai-disabled` as root to stop new AI, remove it to resume. Existing
calls finish; reading remains available. Disconnecting a key does not cancel an in-flight request.

The upload limit is exactly 536870912 bytes. New growth is refused below a default 2 GiB reserve;
simultaneous uploads reserve their declared sizes. Terminal failure/recovery bookkeeping can use
the reserve. Existing current-schema libraries can start/read at low space; workers pause and resume
after space is restored. New databases/migrations require free-space preflight. No asset is
automatically deleted. Inspect authenticated `/api/instance` for worker-alive count and disk pause.

## Backup, empty restore, update

Create a root-owned nonsecret JSON file for each instance containing only `profile`, `public_origin`,
`port`, `disk_margin_mib`, `prepare_workers`. Match the actual service configuration. For example:

```json
{"profile":"beta","public_origin":"https://alice.example.invalid","port":18761,"disk_margin_mib":2048,"prepare_workers":1}
```

Run as the operator:

```sh
sh deploy/beta/backup-instance.sh alice /secure-staging/alice-YYYYMMDD FULL_COMMIT /etc/guided-reader/alice.backup.json
```

The script verifies the release and its commit stamp, stops Core, confirms MainPID=0, takes the
data-dir lock, snapshots SQLite via its backup API plus all content-addressed PDF blobs, writes
schema/config/release/checksum manifest, verifies integrity/FKs/blob hashes and restarts. A timeout
or forced systemd kill must be inspected as a shutdown failure, not silently called a clean drain.
The lock is held until HTTP, preparation, Master and saved-note writers have finished on a normal
stop. Never copy only a running SQLite main file. Backups do not include keys, `.env`, temp/log files,
or migration backups. Failed backups remain failures; investigate and use a fresh destination.

Encrypt the verified directory using the operator's existing encryption tool (for example interactive
`gpg --symmetric` over a tar archive), without a password CLI argument, then copy it to the separately
provided off-host destination. Record its ciphertext checksum and verify after transfer. Keep the
encryption secret separately. No backup schedule, retention promise or RPO/RTO SLA is provided.

On an isolated restore host, decrypt into staging, verify the manifest, then:

```sh
PYTHONPATH=src .venv/bin/python -m reader_service.backup verify --source /restore-staging/alice
PYTHONPATH=src .venv/bin/python -m reader_service.backup restore --source /restore-staging/alice --destination /var/lib/guided-reader/alice-restore
```

Destination must be empty; nothing overwrites live data. Record reported bytes and elapsed seconds.
Use the matching release/schema, give the restored data its dedicated UID/0700 ownership, create a
new empty 0700 credential directory, and configure a separate test hostname/port/firewall inventory
entry. Validate PDF, OCR selection, Guide, saved notes, Master/Memory/progress and close/reopen.
Users re-enter keys. Preserve the original data until user verification; do not start two processes
against either directory. Hash checks detect corruption, not a malicious operator who rewrites both
data and manifest. Do not restore untrusted snapshots as root.

For updates: verify a stopped pre-update backup and restore first; build/seal a new release; stop one
instance, switch its `current` symlink, verify/start and run golden path before updating the next.
Do not point older code at a newer schema. Roll back with a compatible release **and** an isolated
verified pre-update restore; preserve the failed data for diagnosis.

## Required server acceptance before invitations

- Linux wheel/OCR offline preflight, systemd stop/restart/crash recovery, effective nftables rules
  after reboot, and real HTTPS certificate/DNS. Confirm no public Core/admin/debug listener.
- Two hosts with distinct credentials: anonymous/wrong-host/wrong-password denial across HTML,
  static assets, API, PDF Range and SSE. A credentials fail at B; known B IDs fail at A. Test hostile
  Origin/Host, all service UIDs' direct-port access, cross-UID file access and log canaries.
- Real BYOK via UI only: missing/invalid/replace/disconnect, no secret in storage/errors/logs/backup;
  offline assets remain usable. Bounded paid tests only after explicit key/budget provision.
- Representative scanned book: OCR selection → Assistant SSE → Master → reviewed Guide/KP/Inline
  → save/collect → progress → close/reopen. Same-key clean-context Review must reject known defects;
  no failure becomes publication PASS or mastery. If quality fails, pause affected generation.
- Accepted 2-instance and 5-instance mixed-load runs (15 minutes each), two active calls per
  instance/third immediate retry, retries/disconnects/admin-off, 512 MiB/oversize/low-disk/concurrent
  uploads, no asset loss; measure resources and worker status. No hard quota is implied.
- Encrypted off-host backup, real empty restore, record dataset bytes/elapsed time, user-flow
  validation, re-enter Key. No local fixture result substitutes for this host acceptance.

Prior art: stock Caddy basic_auth/reverse_proxy docs, systemd.exec/resource-control manuals and
SQLite online backup guidance. Official pages were fetched during implementation; installed target
manuals and real behavior still require verification. No external application source was copied.
