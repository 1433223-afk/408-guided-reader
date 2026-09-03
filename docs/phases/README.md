# Phase briefs

One brief per implementation Phase. A Phase brief is the day-to-day authority for the task in front
of an implementer — see `AGENTS.md` §6, "Phase cold-start protocol." It exists so that neither
`PRODUCT_BLUEPRINT.md` nor `IMPLEMENTATION_BLUEPRINT.md` has to be read in full for routine work: the
brief names the exact sections of each that this Phase needs, and nothing else is required reading.

Phases are named, not numbered against any prior scheme (`IMPLEMENTATION_BLUEPRINT.md` §24).

## Format

Target: usually 1–3 pages. Prefer shorter. A Phase brief is a narrow pointer plus a small set of
task-specific rules — it is not another architecture specification, and it does not restate what the
blueprints already say.

```markdown
# Phase / <Name>

## Goal
One or two sentences: what this Phase makes true that wasn't true before.

## User-visible result
The concrete, observable thing a user can now do. Prefer a single quotable sentence
("I can read my textbook in this app.") over a feature list.

## Authority to read
Exact Product Blueprint sections and exact Implementation Blueprint sections this Phase needs —
by number. Nothing else from either blueprint is required reading for this Phase.

## Hard rules
Only the load-bearing invariants relevant to this Phase — the things that must not be violated
even though this brief doesn't re-derive why. Point at the blueprint section that freezes each one.

## Build
What is in scope for this Phase.

## Not now
What must not be pulled in, even if it looks related or convenient. Says why, briefly, when it
isn't obvious.

## Acceptance
Concrete, executable, user-visible checks. Prefer real project material (real fixtures, real
sample files) over synthetic examples where the blueprint's own acceptance criteria call for it.

## Autonomy
States plainly that ordinary implementation details are delegated (per `AGENTS.md` §5,
"hard core, loose edges") — naming, file/component layout, helpers, ordinary error handling,
ordinary CSS, ordinary tests, small local refactors, conventional library usage. No approval
needed for any of it.

## Must report before proceeding
Only the escalation conditions from `AGENTS.md` §5 that are actually plausible for this Phase —
not the full list by rote. Typically: an unresolved Product decision specific to this Phase;
a concrete way this Phase's scope could conflict with a blueprint; substantial external code/project
reuse; a major dependency or stack change; user-provided material this Phase cannot proceed without.

## Completion
Required tests/checks for this Phase, and what the closing development report
(`docs/development-reports/`) needs to cover — kept concise, per that directory's README.
```

## Index

| Phase | Brief | Status |
|---|---|---|
| R1 — Read the Book | [`R1_READ_THE_BOOK.md`](./R1_READ_THE_BOOK.md) | Ready for implementation |
