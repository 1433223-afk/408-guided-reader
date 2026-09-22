# Phase / KP Section-First Semantic Windowing

> **Status: CLOSED / COMPLETE — user final acceptance PASS (2026-09-22).** The windowing amendment,
> non-cast short-circuit and (in the same round) the Review structured finding-type +
> duplicate-mastery-audit reliability patch were accepted together; see
> [`docs/development-reports/KP_SECTION_FIRST_WINDOWING.md`](../development-reports/KP_SECTION_FIRST_WINDOWING.md)
> for evidence and the two accepted NON-BLOCKING residuals. No further KP semantic tuning this round.

## Goal

One real Section forms one semantic window (one model judgment) whenever it fits the existing bounded
operational limits, so theme-first absorption and deduplication can operate across a whole Section
instead of one Outline subsection at a time, with fewer generator invocations.

## User-visible result

> “同一节里前后呼应的主题不再被拆成重复的知识点，整节学习地图一次成型，生成更快。”

## Authority to read

- `IMPLEMENTATION_BLUEPRINT.md` §12.2 (as amended by this Phase), §12.4, §13.5, §13.7–§13.8.
- `PRODUCT_BLUEPRINT.md` §11–§13 (unchanged KP semantics this Phase exists to serve).

## Prior-art check

NOT_NEEDED — an internal windowing-boundary correction; no new dependency or generic capability.

## Hard rules

- Product / KP definition, granularity prompts, reviewer prompts, thinking mode, provider routes,
  KP identity, publication, persistence, regeneration and Learning/Memory semantics are **unchanged**
  this Phase (user instruction 2026-09-21; the 2026-09-20 granularity corrective implementation
  stands).
- A semantic window **never crosses a Section boundary** (Implementation §12.2 as amended).
- A whole Section becomes one window **only when** it satisfies the existing bounded operational
  limits: the existing `MAX_SEMANTIC_WINDOW_CHARACTERS` invocation-safety bound **and** the existing
  structured-output accounting budget formula without saturation (`1024 + 64 × units ≤ 16384`, i.e.
  ≤ 240 units). No KP-count quota of any kind is introduced.
- Fallback splitting is **operational only**: along the Section's real existing Outline subsection
  boundaries, Section lead-in joined to the first fallback window, never mid-subsection, never at
  character positions, and never presented as a mastery boundary.
- No previous semantic result or Review finding is injected into any later window; no second-pass
  merge/consolidation stage; no new LLM planning/merge call.
- Non-cast windows (本章小结 / 本节小结 / 章节小结 / 常见问题 / 易混淆 / FAQ / 试题精选 and other
  deterministic non-cast types) make **zero** generator provider calls. The server synthesizes
  `learning_targets = []` plus `non_kp_units = all supplied units`, passes that result through the
  same semantic output schema → same deterministic validator → same downstream accounting. No
  publication bypass.

## Build

- `build_semantic_windows`: Section-first grouping with the bounded-limit predicate above and
  subsection-boundary fallback.
- Zero-call short-circuit for non-cast windows inside the classification stage.
- Targeted tests and an isolated disposable-copy calibration (real providers, authorized routes only).

## Not now

- Any further generator/reviewer granularity prompt tuning (deferred by user instruction).
- Cross-Section windows, character-position splitting, theme-context injection, consolidation passes.
- Any migration, locked-Chapter regeneration, or KP remap. Real library stays read-only.

## Acceptance

1. A multi-subsection Section within limits (第1章 1.2 shape, 第4章 4.2 shape) produces exactly one
   Section semantic window.
2. An oversized Section falls back to real subsection windows; one-pass complete partition,
   continuous source span and atomic publication contracts hold unchanged after fallback.
3. No window ever crosses a Section boundary.
4. Non-cast windows: generator provider invocation count = 0; every supplied unit appears exactly
   once in `non_kp_units`; the same validator accepts the synthesized result.
5. Isolated calibration (disposable copy, no writes to the real library): Section 1.2 no longer
   mints `计算机系统的组成与软/硬件逻辑等价` and `软/硬件逻辑功能等价性` as two independent mastery
   boundaries; 冯·诺依曼/存储程序 duplication is materially reduced; Section 1.3 granularity does
   not regress; Section 4.2 stays at ~6 framework KPs; large Sections (3.2 / 3.5) either window
   whole without structured-output overflow or fall back deterministically **before** invocation
   rather than relying on provider-failure retries.

## Autonomy

Naming, constants wiring, helper placement, test organization and ordinary refactors are delegated
under `AGENTS.md` §5.

## Must report before proceeding

Any case where the bounded-limit predicate cannot be expressed with the existing constants, or where
calibration shows structured-output overflow under a whole-Section window that the predicate judged
safe.

## Completion

Targeted Python suite green; isolated calibration evidence recorded with before/after call counts,
latency, tokens, window boundaries, KP titles, Review verdicts and retry counts. Development report
and git checkpoint happen only after user acceptance of this correction.
