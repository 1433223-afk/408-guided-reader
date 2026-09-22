# KP Section-First Semantic Windowing Development Report

## Result

`CLOSED / PASS` — user final acceptance PASS (2026-09-22). KnowledgePoint granularity, Section-first
windowing and Review reliability for the Chapter Knowledge Map are formally closed for this round.

The real 408 textbook now generates framework-level Knowledge Points instead of
enumeration-mirrored fragments (4.2 寻址方式 15→5-6 framework KPs; 1.3 性能指标 11→4; 3.5 Cache
16→5), whole-Section semantic judgments replace per-subsection windows (semantic calls per Chapter
-74%), deterministic non-cast windows cost zero provider calls, and the structural Review carries a
structured finding-type contract with server-enforced severity including a mandatory explicit
duplicate-mastery audit.

## Implemented

Chain of corrections, each approved by the user in sequence:

1. **Fragmentation root cause (investigation, 2026-09-20).** Over-fine KPs were a three-layer
   failure: unit-first generation shape + reasoning-disabled flash-tier models mirroring textbook
   numbering; a reviewer that never received the Product §11 KP definition and could only see 60-char
   excerpts with a lenient severity calibration (observed: Chapter 4 review passed "偏移寻址" and
   "leave 指令" single-unit KPs as "独立考点"); and test fixtures whose default generator double
   minted 1 unit = 1 KP. Deterministic validation itself was neutral.
2. **Theme-first correction.** `GENERATOR_SYSTEM_MESSAGE` restructured: decide learnable themes
   before assigning units; numbering/headings/enumeration members are evidence organization, not KP
   boundaries; 408-style positive examples (寻址方式家族、性能评价框架、整机结构); soft scale
   1–3/2–5/4–8 explicitly "不是 quota". Reviewer received the KP definition, 200-char excerpts, and
   deterministic fragmentation signals (`EXTENDED_SMALL_TARGET_RUN`,
   `MAJORITY_SINGLE_UNIT_TARGETS`, `HIGH_TARGET_UNIT_DENSITY`, chapter-wide share) mirroring
   overlap warnings — advisory only, never deterministic failures (Implementation §12.4).
3. **Section-first semantic window amendment (Implementation §12.2, user-approved 2026-09-21).**
   `build_semantic_windows` now defaults each real Section to one window when it fits both existing
   bounds (`MAX_SEMANTIC_WINDOW_CHARACTERS`=48k chars; `MAX_WHOLE_SECTION_UNITS`=240 from the
   structured-output budget formula), falling back along real subsection boundaries only —
   operational splitting, never mastery boundaries, never character cuts, never cross-Section.
   Rationale: per-subsection windows made each judgment blind to sibling subsections (1.2's
   duplicated 软/硬件等价 mastery states across w003/w005) while paying one invocation per window.
4. **Non-cast provider short-circuit.** 小结/常见问题/FAQ/易混淆/试题精选 windows synthesize
   `learning_targets=[]` + all units in `non_kp_units` server-side, through the identical
   `validate_semantic_output`, downstream accounting and Review ledger — zero generator provider
   calls, no publication bypass; an all-non-cast Chapter fails honestly with
   `chapter_has_no_castable_window`.
5. **Bare-heading unit fix.** A section heading immediately followed by a subsection heading formed
   a standalone heading-only unit (3.2 主存储器 `u0001`), which deepseek-flash refused to account
   for across 6/6 observed attempts (in both whole-Section and subsection windows — a pre-existing
   defect, not a Section-first regression). Flush points now carry a single bare short heading into
   the next unit (evidence preserved inside the window). After the fix 3.2 passed first attempt.
6. **Structured Review finding types.** `REVIEW_FINDING_TYPES`: DUPLICATE_MASTERY_BOUNDARY /
   SYSTEMATIC_OVER_FRAGMENTATION / FACET_OR_EXAMPLE_PROMOTED_TO_KP → BLOCKING;
   MINOR_NAMING_OVERLAP / MINOR_GRANULARITY_IMBALANCE → WARNING. The reviewer chooses the type;
   the server enforces severity and derives the verdict (a claimed PASS with a BLOCKING-typed
   finding cannot publish). No natural-language string matching anywhere.
7. **Mandatory duplicate mastery audit.** Review output gained a fourth field
   `duplicate_mastery_groups` (explicit `[]` when clean). Before findings/verdict the reviewer must
   ask, per candidate pair-group: "given real understanding of A, does B still deserve an
   independent mastery/diagnosis/remediation path?" — with span differences, brief-then-full
   exposition, differing titles, separate examinability and different textbook headings explicitly
   barred as retention reasons. Server validates groups (≥2 distinct existing candidate IDs),
   normalizes each valid group into exactly one BLOCKING DUPLICATE_MASTERY_BOUNDARY finding
   (deduped against an existing finding covering the same candidates via structured unit-ID
   intersection), and derives FAIL.
8. **Same-Section duplicate absorption + facet/derived-metric generator rules** (final semantic
   round): one mint at the fullest location, other occurrences to `non_kp_units`, continuous-span
   prohibition preserved; worked examples / derived metrics default inside their framework target
   (主频/CPI/IPS/CPU执行时间/MIPS/FLOPS organized under the execution-time model).

## Important implementation decisions

- The whole-Section predicate reuses only existing engineering constants (48k chars; 240 units from
  `1024 + 64×units ≤ 16384`); it is an operational capacity bound, never a KP quota (§12.4).
- The historical "complete-Section generation exceeded structured-output budget" failure (3.2/3.5)
  did not recur: absorbed partitions use 12–18% of the reserved budget (523–709 completion tokens).
  The actual 3.2 failure mode was the bare-heading unit, fixed deterministically at projection level.
- Review severity ownership moved entirely server-side (type → severity → verdict). The reviewer's
  semantic authority is choosing the type and the group membership; nothing is parsed from prose.
- Reviewer route during isolated calibration was zhipu/GLM-5.3-Flash (the established production
  reviewer for most published chapters) because the OpenRouter proxy was down; production reviewer
  configuration was never changed. Cross-route end-to-end latency comparisons were therefore not
  claimed.

## Deviations from Spec

- The bare-heading unit fix extended beyond the strictly approved windowing scope into
  `build_evidence_units`; taken under the FIRST_CHAPTER brief's delegated "local deterministic
  unit/window-building algorithm" autonomy after calibration proved a deterministic blocking defect,
  and disclosed in the interim report.
- 1.3's review-calibration candidate set was reconstructed content-anchored (recorded titles/sizes
  placed at topic anchors) because the prior variance run had not persisted non_kp unit positions;
  66 vs recorded 63 non_kp units, disclosed in the patch report.

## Acceptance evidence

- TARGETED: `python -m pytest tests/test_knowledge_map.py tests/test_map_the_book.py -o addopts="" -q`
  — **58 PASS** (49 + 9), including theme-first/408-example prompt freeze assertions, absorption-shaped
  default fixture, enumeration-split BLOCKING through review, fragmentation signals advisory-only,
  Section-first single windows, both fallback triggers, no cross-Section windows, non-cast zero-call
  short-circuit, duplicate-group normalization/dedup/malformed-retry, MINOR types never blocking.
- `python -m compileall -q src`, `git diff --check` — PASS.
- Isolated calibration (disposable copies of the real 412/348-page books, authorized routes only,
  production library read-only throughout; SHA256 `4a62f424…` verified unchanged after every run):
  - Case A 1.2: 5 subsection windows → 1 Section window; duplicates reduced (ISA merged; vN/存储程序
    reframed); the 软/硬件等价 pair persisted in generation across rolls and is now caught by the
    audit (below).
  - Case B 1.3: 11 → 4 KPs stable across 3 independent attempts (worked example and MIPS/FLOPS
    absorbed into the execution-time model; 63 units demoted non_kp).
  - Case C 4.2: 15 → 5 KPs stable across 3 attempts; family structure intact, no re-fragmentation.
  - Safety 3.2/3.5: whole-Section windows, single-attempt success post bare-heading fix, 12–18%
    budget utilization, no structured-output overflow, no provider-retry dependence.
  - Same-generator semantic call reduction: Chapter 1 11→3, Chapter 4 16→4 (-74% combined).
  - Review-only reliability (fixed candidate sets, zero generator calls): 1.2 ×10 — 10/10
    `duplicate_mastery_groups` contain the 等价 pair, 10/10 derived FAIL/BLOCKING; 1.3 ×5 and 4.2 ×5 —
    5/5 clean groups, 5/5 PASS, zero false duplicates. Patch delta: prompt +166 tokens (+2.4%),
    latency within reviewer variance.
- Real-provider golden paths and full Reader/UI E2E were exercised in earlier accepted Phases and
  unchanged surfaces are covered by the existing suites; this round's changed risk surface is fully
  covered by the targeted suites above. JavaScript suites `INTENTIONALLY_NOT_RUN` — no JS/UI contract
  changed.
- USER ACCEPTANCE: interactive — fragment investigation confirmed (2026-09-20), ISOLATED_KP_REVIEW
  UI inspection on port 8791 (18/26-KP maps), Section-first architecture PASS (2026-09-21), final
  Review-reliability PASS (2026-09-22).

## Known limitations / deferred debt

Two accepted NON-BLOCKING residuals (user decision, beta):

- **A.** One schema retry occurred in 10 review-calibration calls (1/10) after the
  `duplicate_mastery_groups` schema change; it recovered under the existing bounded identical-contract
  retry. Watch the `invalid_review_output` rate as the reviewer route or model changes.
- **B.** In one calibration round the reviewer additionally grouped 冯·诺依曼思想 / 存储程序执行过程
  as duplicates — a conservatively fail-closed judgment that can reject one generation attempt and
  require a user retry, but can never publish a wrong durable KP. Accepted for beta; no further
  semantic prompt tuning for it.

Also noted, not acted on: 1.2's generator still mints the 等价 pair (4/4 observed rolls) — the audit
reliably blocks publication (10/10), so the product behavior is honest FAIL + explicit retry.
Eliminating it at generation time would need prompt re-tuning or a stronger generator model, both
outside this round's frozen scope.

## Reproducible entry points

```powershell
python -m pytest tests/test_knowledge_map.py tests/test_map_the_book.py -o addopts="" -q
python -m compileall -q src
```

Calibration pattern (disposable copy, never the live Library as a write fixture): copy
`var/manual-browser/state.sqlite3` + hardlink `blobs/` into a temp dir, build services with
`ManagedPaths(copy)`, project a Chapter, `build_evidence_units` / `build_semantic_windows`, invoke
`runtime.complete_for_with_metadata` on the authorized routes, validate with
`validate_semantic_output` / `KnowledgeService._validate_review`. Reviewer latency baselines are
route-dependent (zhipu during this round; OpenRouter requires the local proxy).

## Important files / architecture entry points

- `src/reader_service/knowledge/semantic.py` — evidence units, bare-heading carry, Section-first
  windows with bounded fallback, fragmentation warnings, review ledger.
- `src/reader_service/knowledge/service.py` — GENERATOR/REVIEW prompts, `REVIEW_FINDING_TYPES`,
  `_validate_review` (type→severity→verdict normalization, duplicate-group synthesis/dedup),
  non-cast short-circuit, window output budget.
- `tests/test_knowledge_map.py` — the frozen contracts above.
- `docs/phases/KP_SECTION_FIRST_WINDOWING.md` — the accepted brief for the windowing amendment.

## Git checkpoint

The commit containing this report; exact hash recorded in the closure handoff.
