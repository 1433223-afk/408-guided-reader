# Section Learning Check — Independent Closure Review

## Verdict

2026-09-10 — **PASS; P0=0 / P1=0 / P2=0; recommendation CLOSE.**

Reviewer: independent Codex reviewer `section_closure_audit`, not ZCode. The reviewer did not
design or implement the audited change and made no product/test-suite edits or commits. This is
independent narrow engineering acceptance, not a substitute for the user's explicit acceptance.

Audited implementation: `015b57a` (formal Section check and shared durable Master) plus
`f4c76db` (reading-position UAT correction), against accepted baseline `fbe36d5`.
Review is limited to this same-Phase addition and its load-bearing shared boundaries; it does not
reopen baseline UI, KP semantics or broader future Master capabilities.

## Authority and method

Read `AGENTS.md`, the complete current Phase brief and relevant Development Reports, and the exact
Product/Implementation authority sections named by the brief. In particular, Product §§28.1–28.3
and Implementation §§15.2–15.6 govern positive-all-owned versus Section-only-negative evidence,
reading/mastery separation and retained history. The same-Phase addition expressly supersedes the
old KP-only exclusions where needed; Subsection behavior remains unchanged.

Inspected the complete relevant diff in Learning schema/repository/service, Database migration,
authenticated server routing, Master scope wiring and the reading-restoration guard. Ran focused
tests and independently authored adversarial probes. Every executable probe used newly created
temporary synthetic fixture data; no writes or tests targeted `var/manual-browser`, no live provider
calls were made, and no user material was copied into git.

## Evidence

`D:/python/python.exe -m pytest -o addopts='' tests/test_section_learning.py tests/test_learning.py tests/test_learning_grounding.py -q`

**65 passed in 24.60s.** This includes populated migration 12→13 with old-column/row preservation,
integrity/FK checks, migration validation failure rollback including the version marker, transactional
Section-clear rollback, authenticated API ownership, restart/retry, permanent lock, source boundaries,
grounding modes and sibling-book deletion isolation. Migration 13 disables FKs outside the rebuild
transaction, checks all FKs before commit, and restores enforcement; exceptions roll back and close
the connection. The existing event append-only triggers are reinstated by the same transaction.

Independent probe command: `D:/python/python.exe test-results/audit-section-probe.py` — **exit 0**.
The probe script is an ignored local audit artifact; its checks are recorded here for reproducibility:

- Twelve concurrent Section-unclear opens converge on one thread, one ACTIVE Topic and one Section
  event, leave every KP status unchanged, and immediately block Chapter regeneration.
- Eight duplicate sends produce one durable question. The same intent ID in a KP creates a separate
  KP message/thread, not a replay of the Section intent; its private question canary never enters
  the Section provider payload.
- Eight concurrent Section-clear actions produce one Section-clear event, set exactly the owned KPs
  UNDERSTOOD, preserve other Sections and retain the pending question. Reopening unclear creates a
  new ACTIVE Topic. The released in-flight answer stays on its old Topic, does not resolve the new
  Topic or change Section status, and replaying the old explicit confirmation is a no-op.
- Direct event UPDATE and a Topic-deletion cascade that would remove event history are rejected.
  Neither-zero-nor-two scope identity is enforced by the thread XOR constraint; final FK check is
  clean. These direct-SQL attacks run only on the disposable audit fixture.
- An independently substituted overlay includes in-range evidence and an out-of-range canary.
  Section source reads exactly its page range, excludes the canary and emits only the declared
  source keys and the owned published KP set. Runtime history selection remains Topic-local;
  independent Review receives source/question/candidate, not Assistant or global history.

Reading-position correction was inspected for risk relevance: it only prevents placeholder-layout
autosaves until the saved reading anchor is restored, and repeats the existing generation check
after the animation frame. It changes no schema, mastery write path or Section/KP ownership.

## Limits and closure disposition

No actionable finding was reproduced within this bounded delta. Passing tests do not imply universal
source-claim extraction or guarantee live model answer quality. The implementation report's live
Section Review outcomes remain **PASS then FAIL**, not two content-review passes; an honest Review
FAIL does not acquire mastery authority. This review does not repeat live calls or the browser golden
paths; those were recorded on the accepted implementation and are separate evidence. Main-agent
closure broad results are recorded in the Development Report, not represented here as independently
executed tests.

The user's explicit `人工验收：PASS` supplies the human gate. This independent narrow gate is
satisfied; the requested docs-only closure may proceed without product changes or waived findings.
