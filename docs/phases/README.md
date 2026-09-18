# Phase briefs

One brief per implementation increment (called a "Spec" in general engineering-workflow terms; this
repo calls it a **Phase brief**). It is the day-to-day authority for the task in front of an
implementer — see `AGENTS.md` §6, "Three-tier cold-start protocol." It exists so that neither
`PRODUCT_BLUEPRINT.md` nor `IMPLEMENTATION_BLUEPRINT.md` has to be read in full for routine work: the
brief names the exact sections of each that this increment needs, and nothing else is required reading.

Phases are named, not numbered against any prior scheme (`IMPLEMENTATION_BLUEPRINT.md` §24 states
*direction* for later phases — it is not a queue of ready-made briefs).

**This README is a template/reference for whoever prepares the next brief (the Codex Pro Planner,
`AGENTS.md` §4) — it is not itself required Implementer cold-start reading.** The brief it produces
*is* required reading (`AGENTS.md` §6, Tier A). See `AGENTS.md` §7 for how the next brief actually
gets scoped: from current product/code state,
the previous development report, and real usage feedback — never by mechanically expanding the
roadmap ahead of need. Write only the next minimal useful slice, not several phases in advance.

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

## Prior-art check
REQUIRED / NOT_NEEDED — one-line reason. If REQUIRED, name 0–3 candidate repos or problem-domain
classes (`AGENTS.md` §5, external reuse). No OPTIONAL state; no research report owed.

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
Required tests/checks for this Phase, and a reminder that closure needs a development report
(`docs/development-reports/`, format in that directory's README) plus a git checkpoint (`AGENTS.md`
§5). State the acceptance label explicitly if real-use material is short of what the blueprint
criterion names — `IMPLEMENTATION_READY` vs `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` (`AGENTS.md` §5).
```

## Index

| Phase | Brief | Status |
|---|---|---|
| Friends Private Beta | [`FRIENDS_PRIVATE_BETA.md`](./FRIENDS_PRIVATE_BETA.md) | `ACCEPTED BY USER` (2026-09-16), including R-1 DeepSeek same-key independent-context Review; local personal baseline `personal-v0.1`; private GitHub pending (no remote); no implementation/deployment started |
| R1 — Read the Book | [`R1_READ_THE_BOOK.md`](./R1_READ_THE_BOOK.md) | `IMPLEMENTATION_READY` (see `docs/development-reports/R1_READ_THE_BOOK.md`) |
| R2 — Selectable Book | [`R2_SELECTABLE_BOOK.md`](./R2_SELECTABLE_BOOK.md) | `IMPLEMENTATION_READY` (see `docs/development-reports/R2_SELECTABLE_BOOK.md`) |
| R3 — My Marks (core) | [`R3_MY_MARKS.md`](./R3_MY_MARKS.md) | `IMPLEMENTATION_READY`, closed after user acceptance (see `docs/development-reports/R3_MY_MARKS.md`) |
| Find in Book | [`FIND_IN_BOOK.md`](./FIND_IN_BOOK.md) | `IMPLEMENTATION_READY`, closed after user acceptance (see `docs/development-reports/FIND_IN_BOOK.md`) |
| Map the Book | [`MAP_THE_BOOK.md`](./MAP_THE_BOOK.md) | `CLOSED` — accepted after user real-use + independent narrow review (2026-09-04) |
| Ask About This | [`ASK_ABOUT_THIS.md`](./ASK_ABOUT_THIS.md) | `CLOSED` — accepted after user real-use + independent narrow review (2026-09-04) |
| Provider Bake-off | [`PROVIDER_BAKEOFF.md`](./PROVIDER_BAKEOFF.md) | `CLOSED / COMPLETE` — user acceptance PASS + narrow independent review PASS; OpenRouter `google/gemini-3.8-flash` region access remains separately pending and the default Assistant provider decision remains open |
| Ask Deeper | [`ASK_DEEPER.md`](./ASK_DEEPER.md) | `CLOSED / COMPLETE` — machine acceptance PASS; agent real-use PASS; user acceptance `PASS_WITH_UI_POLISH_DEFERRED`; narrow independent review PASS (P0=0 / P1=0 / P2=4 deferred); UI polish deferred separately (see [report](../development-reports/ASK_DEEPER.md)) |
| Save Assistant Explanation to Notes | [`SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md`](./SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md) | `CLOSED / COMPLETE` — user acceptance PASS + narrow independent review PASS (P0=0 / P1=0 / P2=3, all deferred; see [report](../development-reports/SAVE_ASSISTANT_EXPLANATION_TO_NOTES.md)) |
| First Chapter Knowledge Map | [`FIRST_CHAPTER_KNOWLEDGE_MAP.md`](./FIRST_CHAPTER_KNOWLEDGE_MAP.md) | Baseline `CLOSED / COMPLETE`; 2026-09-18 bounded KP entry / exercise-window follow-up `READY_FOR_USER_RETEST`; see [report](../development-reports/KP_ENTRY_AND_EXERCISE_GUARD.md) |
| Regenerate READY Chapter Knowledge Map | [`REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md`](./REGENERATE_READY_CHAPTER_KNOWLEDGE_MAP.md) | `CLOSED / COMPLETE` — machine acceptance PASS; agent real-use PASS; user acceptance PASS; narrow independent review PASS (P0=0 / P1=0 / P2=0; closure recommendation CLOSE) |
| Learn One KP with Master | [`LEARN_ONE_KP_WITH_MASTER.md`](./LEARN_ONE_KP_WITH_MASTER.md) | `CLOSED / COMPLETE` — Section check + durable Section Master and reading-position UAT fix accepted at `f4c76db`; independent narrow PASS (P0/P1/P2=0); docs-only closure, baseline `fbe36d5` retained; see [report](../development-reports/LEARN_ONE_KP_WITH_MASTER.md) |
| Reviewed Section Reading Guide | [`REVIEWED_SECTION_READING_GUIDE.md`](./REVIEWED_SECTION_READING_GUIDE.md) | `CLOSED / COMPLETE` — user acceptance PASS (2026-09-12); independent narrow PASS (P0/P1/P2=0, CLOSE); broad and real-book regression PASS; accepted product `0eb18fb` unchanged (see [report](../development-reports/REVIEWED_SECTION_READING_GUIDE.md)) |
| Reviewed Section Inline Teaching | [`REVIEWED_SECTION_INLINE_TEACHING.md`](./REVIEWED_SECTION_INLINE_TEACHING.md) | `CLOSED / COMPLETE` — user acceptance PASS (2026-09-12); independent narrow PASS (P0/P1/P2=0, CLOSE); machine and real-book flows PASS; docs-only closure, accepted code `58e3c3d` unchanged (see [report](../development-reports/REVIEWED_SECTION_INLINE_TEACHING.md)) |
| User Learning Memory — Curated V1 | [`USER_LEARNING_MEMORY.md`](./USER_LEARNING_MEMORY.md) | `CLOSED / COMPLETE` — user acceptance PASS (2026-09-12); final independent narrow PASS (P0/P1/P2=0, CLOSE); broad and real-book regression PASS; docs-only closure, accepted code `c702316` unchanged (see [report](../development-reports/USER_LEARNING_MEMORY.md)) |
