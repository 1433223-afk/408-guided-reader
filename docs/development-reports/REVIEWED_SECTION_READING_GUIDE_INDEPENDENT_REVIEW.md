# Reviewed Section Reading Guide — independent narrow acceptance

Date: 2026-09-12. Audited product commit:
`0eb18fb336710283fc4e3de9c0f634bf4ae06e52` (verified with `git rev-parse HEAD`).

Reviewer: independent Codex subagent `guide_closure_audit`, uninvolved in this implementation or
its design; **not ZCode**. AGENTS.md makes independence a property of the work. The Phase requires
an independent narrow review, not a named model invocation. This audit does not supply user
acceptance; the coordinating task reports the user's explicit 2026-09-12 PASS separately.

**Independent acceptance: PASS. Findings: P0=0 / P1=0 / P2=0. Recommendation: CLOSE.**
No finding is waived. This recommendation covers the code acceptance gate; final closure also
depends on the separately recorded user, real-use and broad-regression evidence.

## Scope and authority

Read AGENTS.md, the accepted Phase brief and its amendments, the Guide development report and
the relevant Master baseline report. Applied Product §§17–23, 30.1–30.2, 33.1–33.2, 36–38;
Implementation §§13, 17–23 and §24 R7. Accepted KP-based author input and deferred prose/UI
refinement were treated as current user direction, not reopened as optimization work.

Inspected the actual Teaching service, schema, evidence and contract builders, author-context
adapter, job dispatch/recovery integration, authenticated Guide API, persistence connection/migration
handling and provider-runtime request/logging boundary. No product code was changed by this reviewer.

## Code acceptance evidence

References below are repository-relative, with line numbers at the audited commit.

| Boundary | Evidence and conclusion |
|---|---|
| Durable identity / replay | `teaching/service.py:22` serializes request allocation with `BEGIN IMMEDIATE`; version/intent and in-flight uniqueness in `teaching/schema.py:58` prevent duplicate logical publications. Retry scopes the asset to revision and Section and rejects superseded attempts (`service.py:44`). |
| Source authority | `teaching/evidence.py:15` constructs the half-open physical Section evidence ledger and server-owned IDs. `contracts.py:51` rejects unknown IDs and extra locator fields; `contracts.py:36` rejects supported authored locator/quote/exam-claim forms. Saved geometry is never silently reassigned (`evidence.py:93`). |
| Actual dependencies / staleness | `evidence.py:73` checks declared nodes, page-footprint events/fingerprints and optional exact KP version. Missing KP produces no invented version. `writing_context.py:56` restricts KP meanings to the declared READY publication; consumed neighboring directory titles add identity-only dependencies, not neighbor OCR/ranges (`service.py:160`). Unrelated physical updates do not globally stale Guides. |
| Review / content visibility | `service.py:160` validates before a fresh `{source,candidate}` Review call. `contracts.py:81` accepts only a verdict with scoped issues, never replacement text. `service.py:59` exposes content only through the PUBLISHED/PASS pointer. Schema constraints/triggers additionally guard publication and published immutability (`schema.py:110`). |
| Retry / terminal failure | `service.py:118` bounds contract attempts; runtime bounds transport attempts. Only validated semantic FAIL increments the counter; the third FAIL terminates. Technical failures retain stage and do not consume semantic cycles. Rework can replace only rejected module IDs/kinds (`service.py:160`); Review retry does not regenerate an accepted candidate. |
| Atomic replacement | The final `BEGIN IMMEDIATE` in `service.py:160` rechecks dependencies, owning job/cancellation and state, then commits PUBLISHED and the current pointer together. Prior publication remains intact during failure or replacement. |
| Ownership / cascade | Composite revision/Section foreign keys and revision/job cascades in `schema.py:58` and `schema.py:102` bind all versions and the pointer to their owner. Scope checks precede API operations (`server.py:349`). Guide selection has no PDF anchor or mastery-write authority (`service.py:83`). |
| Egress / secrets | `contracts.py:107` explicitly selects author fields; formatter evidence remains server-allowlisted; Review receives no author reasoning or learner history. `agent_runtime/runtime.py:351` constructs the request body separately from the credential passed to the adapter. Default logging records identifiers/failure codes, not payloads or keys. Guide metadata records actual completion configuration without credentials. |

All Teaching file references above are under `src/reader_service/`; the same prefix applies to
`server.py` and `agent_runtime/runtime.py`.

## Tests actually executed by this reviewer

`python -m pytest tests/test_teaching.py -q` — **35 cases PASS, exit 0** on the audited product code.
The suite includes concurrent request/replay, restart/retry, semantic exhaustion, invalid Review,
foreign source/locator rejection, publication rollback injection, source change during Review,
page/node-scoped staleness, cascade, populated migration preservation, author allowlist, exact
formatter preservation and provider-option isolation. These are controlled-provider tests, not
live model quality acceptance.

The coordinating task separately ran broad regression and a controlled real-348-page Guide E2E.
Its test-only formatter fixture correction in `tests-e2e/reading-guide.mjs` does not change audited
product code. Those results belong to the main closure report and are not represented as runs by
this reviewer. No live provider call, user-library write or browser acceptance was performed here.

This is a bounded code audit, not proof of universal natural-language grounding or cross-Section
writing quality. Mandatory live content Review remains part of publication; the user's accepted
content direction and deferred refinements remain intact.
