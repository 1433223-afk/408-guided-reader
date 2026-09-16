# Development reports

One concise report per completed Phase brief. Engineering memory, not a chronological diary — it
states what's true now and never claims a result that wasn't achieved.

Only the **latest** report directly relevant to the current Phase brief is required Codex cold-start
reading (`AGENTS.md` §6, Tier A). Older or unrelated reports are Tier C — query only, when genuinely
needed.

## Format

```markdown
# <Phase> Development Report

## Result
The user-visible outcome that now exists.

## Implemented
The core implementation delivered.

## Important implementation decisions
Only decisions with future engineering significance — not routine choices already covered by
"Autonomy" in the Phase brief.

## Deviations from Spec
What changed from the brief, and why.

## Acceptance evidence
- automated tests run, and their result;
- real fixtures/material actually used;
- the user-visible/manual flow actually exercised;
- what was **not** genuinely tested — say so plainly. Suites skipped because they share no risk
  surface with the change are labelled `INTENTIONALLY_NOT_RUN` with a one-line risk-based reason
  (`AGENTS.md` §5, test execution).

Label the overall result `IMPLEMENTATION_READY`, or, if a larger-scale/material acceptance named by
the brief is still outstanding, `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` and name what's missing
(`AGENTS.md` §5).

## Known limitations / deferred debt
Only real remaining issues: what, why deferred, when it becomes relevant. Not a debt essay.

## Reproducible entry points
How to run it; how to test it; which fixtures/samples it depends on; the manual acceptance path a
future session should replay rather than reverse-engineer.

## Important files / architecture entry points
What the next developer or Codex session actually needs to orient itself.

## Git checkpoint
Commit hash.
```

It never claims a result that was not achieved.
