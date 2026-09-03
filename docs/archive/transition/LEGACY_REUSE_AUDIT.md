# LEGACY_REUSE_AUDIT

**Document Type:** Audit artifact (evidence). Not a canonical cold-start document.
**Authority Tier:** NONE — subordinate to `PRODUCT_BLUEPRINT.md`.
**Date:** 2026-09-03
**Legacy repository under audit:** `D:\codex\408-ai-ebook` @ `main`, 22 commits, HEAD `7daa78e`
**Target product authority:** `D:\codex\PRODUCT_BLUEPRINT.md` (408 Guided Reader, new project)
**Planned new repository:** `D:\codex\408-guided-reader` (currently an empty directory — verified)
**Working-tree state at audit time:** 5 modified tracked files, ~25 untracked paths (test-evidence dirs, `docs/08-ui/**`, `tools/reader-harness/`, `tools/dev-review/*.ps1`). No audit action taken on them.

**Scope discipline:** this document is read-only analysis. No legacy file was modified, moved, or deleted; no checkout/reset/rebase was performed; no new repository was created.

> **AMENDED 2026-09-03** after `OCR_FOUNDATION_CALIBRATION.md`. Three corrections, all marked in place:
> **(1)** the printed-page-label finding is reversed — see the correction notice in §4.3;
> **(2)** two §12 unknowns are resolved (Docling word/line geometry → moot; the five modified files → diffed);
> **(3)** downstream statements in §5 and §12 that relied on the reversed finding are annotated.
> Everything else — the seeding verdict, the checkpoint analysis, and the reuse matrix — stands unchanged.

---

## 1. Executive Verdict

**Recommended seeding strategy: create a clean repository and selectively port, using `98dc70d` as the *source-of-truth commit for the ported foundation*, not as a fork point.**

Rationale, in one line: the legacy repository's *engineering* is genuinely good and worth reusing, but its *domain model* is fused into a single 2,503-line `persistence/models.py` with 61 tables and a linear 10-migration chain in which `books` carries a `NOT NULL UNIQUE reserved_knowledge_dataset_id` from migration `0002` onward. There is no checkpoint at which you get the good engineering without either (a) inheriting SourceBlock/KnowledgeDataset semantics, or (b) doing the same file-level extraction work you would do into a clean repo anyway.

| Question | Verdict |
|---|---|
| Fork/clone from a checkpoint? | **No.** Start clean. |
| Best *source* commit for ported code | `98dc70d` (Phase 01 complete) for foundation; `69dd323` for Book intake/storage; `c68f3a6` for the native probe and page/asset storage patterns |
| Biggest reuse opportunity | Task runtime + checkpoint/recovery + provider gateway/breaker/budget (`98dc70d`), and `ManagedBookStorage` (`69dd323`) — ~1,400 LOC of proven, product-neutral infrastructure with ~110 passing tests behind it |
| Biggest contamination risk | `persistence/models.py` as a single module; `books.reserved_knowledge_dataset_id`; the `SourceBlock` "block-is-the-content" model; `ORIGINAL_REFERENCE` render nodes; anchor-keyed `user_progress` |

**Reuse volume estimate.** Of 20,546 LOC in `src/`, roughly **2,000–2,400 LOC (≈11%)** is worth porting as code. Of 11,577 test LOC, roughly **1,600 LOC (≈14%)** is worth porting. Everything else is REFERENCE_ONLY or DISCARD_ARCHIVE.

**The single most important finding for the new project:** the legacy OCR/layout layer does **not** produce the word+line geometry that `PRODUCT_BLUEPRINT.md` §6 makes the V1 core representation. It produces Docling *item*-level blocks (paragraph/heading/figure granularity) with one bbox each. There is **no word-level and no line-level geometry anywhere in the repository** (`grep` for `word`/`word_id`/`line_id` across `src/ai_ebook/parsing/` returns zero hits). Phase 03's OCR capability is therefore **not** a head start on the new OCR foundation; it is a working *reference implementation of PDF → route-selection → bbox-provenance → resumable persistence*, whose extraction granularity must be replaced.

---

## 2. Target Product Constraints That Materially Affect Reuse

Only the constraints that change a keep/discard decision. Not a blueprint summary.

| # | Constraint (`PRODUCT_BLUEPRINT.md`) | Reuse consequence |
|---|---|---|
| C1 | §2 Original PDF is the reading authority; reconstructed text never replaces it | Kills the entire Phase 06–09 chain as a product path |
| C2 | §4 Progressive bootstrap; PDF readable immediately; OCR page-by-page in background | Kills whole-document `ParsedDocument` (`parsing/contracts.py` requires *every page exactly once, in order*); the *resumable per-page checkpoint* pattern survives |
| C3 | §6 OCR core = **word + line**; paragraph derived on demand | Kills `SourceBlock` granularity; `BBox` and page geometry survive |
| C4 | §5 `pdf_page_index` ≠ `printed_page_label`; never guess | Kills `DoclingLayoutParser` writing `page_label=str(page_index+1)` (`parsing/adapter.py`, page assembly loop) — a fabricated printed label |
| C5 | §7 OCR is a correctable machine layer with error reporting + manual override as a **V1 capability** | **NOT FOUND** in legacy — greenfield |
| C6 | §7.1 Foundation versioning with dependent-artifact remap/stale marking | Legacy has candidate/accepted ParseRun versioning (partial fit); no remap |
| C7 | §8 Notes/Highlights anchored on geometry + quote fingerprint, not OCR IDs | **NOT FOUND** in legacy — greenfield |
| C8 | §9 Outline nodes carry physical ranges (start/end page + y) | `document_sections` has level/order/title-block but **no physical range** → REFERENCE_ONLY |
| C9 | §10 Figures/tables store **geometry**; crops rendered on demand | Kills permanent PNG extraction as authority; `ManagedSourceStorage` survives as a *crop cache* |
| C10 | §11–14 KP = independent-learning-state unit; exactly one primary Section; lazy, max one Chapter | Kills `KnowledgeDataset`/`StableSemanticAnchor`/`KnowledgePointSourceMap` |
| C11 | §12/§28 Progress keyed by KP with Section ownership | Kills anchor-keyed `user_progress` |
| C12 | §17/§23 Teaching layer is Section-scoped, replaceable, records only dependencies it used | Kills `TeachingPlanRevision`/`SegmentContract`/`GenerationUnit` plan machinery |
| C13 | §24/§26 Assistant temporary + Section-isolated; Master persistent | Kills KP-set `Scope`/`EbookSession`; **NOT FOUND**: any Assistant/Master implementation |
| C14 | §30 Review strength tiered (Fast/Standard/Deep); mandatory only for System Teaching Assets | Phase 08's always-on unit review is over-built; its *reviewer adapter shape* survives |
| C15 | §33.2 Bounded finite rework, not open-ended loops | Legacy rework audit is a valid reference |
| C16 | §38 Past-exam RAG, exercise→KP mapping, formula objects all **deferred** | Phase 05 embedding/retrieval is out of V1 scope → REFERENCE_ONLY |

---

## 3. Git Checkpoint Analysis

Full history (22 commits, `git log --format='%h %ad %s' --date=short`):

```
7daa78e 2026-09-01 docs: accept dma ocr experiment
57fb678 2026-09-01 docs: accept reader interaction harness scope
af8f893 2026-08-31 feat: complete Phase 09 reader session foundation
d62fab1 2026-08-31 docs: accept Phase 09 planning package
384bc64 2026-08-31 feat: complete Phase 08 review execution
e535270 2026-08-30 chore: formalize Claude/Codex/ZCode operational role split
a5d5ff0 2026-08-30 feat: complete Phase 07 system generation
ed788d3 2026-08-30 feat: complete Phase 06 system planning
673021b 2026-08-30 feat: complete Phase 05 reference retrieval
1344707 2026-08-29 Finalize Phase 04 DMA evidence and lifecycle hardening
4de3b5d 2026-08-29 feat: complete phase 04 knowledge dataset foundation
c68f3a6 2026-08-29 feat: complete phase 03 primary parsing foundation
69dd323 2026-08-28 feat: complete phase 02 book intake and lifecycle
98dc70d 2026-08-27 fix: complete phase 01 runtime recovery and final validation
5aaf285 2026-08-27 chore: add manual relay role bindings and direct reviewer adapters
80802c9 2026-08-27 docs: record phase 01 local validation
ece049d 2026-08-27 feat: add phase 01 provider technical boundary
14e1c5e 2026-08-27 feat: add phase 01 persistence and task substrate
dd01968 2026-08-27 docs: approve phase 01 implementation baseline
a33f9f6 2026-08-26 docs: complete phase 00 implementation report
e06f7df 2026-08-26 feat: add phase 00 execution baseline
ecda64c 2026-08-26 chore: establish authoritative phase 00 baseline
```

Measured contamination curve — `persistence/models.py` size and table count per checkpoint (`git show <c>:src/ai_ebook/persistence/models.py | grep -c __tablename__`):

| Commit | Phase | models.py | tables | config.py |
|---|---|---|---|---|
| `a33f9f6` | 00 | absent | 0 | 38 L |
| `98dc70d` | 01 | 94 L | **3** | 71 L |
| `69dd323` | 02 | 145 L | 5 | 84 L |
| `c68f3a6` | 03 | 341 L | 10 | 91 L |
| `4de3b5d` | 04 | 663 L | 19 | 91 L |
| `673021b` | 05 | 1,041 L | 27 | 115 L |
| `ed788d3` | 06 | 1,616 L | 42 | 115 L |
| `a5d5ff0` | 07 | 1,940 L | 48 | 115 L |
| `384bc64` | 08 | 2,349 L | 56 | 128 L |
| `af8f893` | 09 | 2,503 L | **61** | 128 L |

### Candidate table

| Candidate | Commit | Advantages | Legacy Contamination | Estimated Reuse Value | Verdict |
|---|---|---|---|---|---|
| **A. Phase 00 baseline** | `a33f9f6` | Zero domain model. Packaging, ruff/pytest config, `config.py`, `logging_setup.py`, CLI skeleton | `health.py` already hard-codes the legacy authority chain (`SYSTEM_BLUEPRINT_V4`, `PHASE_00_BRIEF`…) and would have to be gutted | Low — ~200 LOC, all trivially re-derivable | **Reject as fork point.** Too little to inherit to justify carrying legacy history |
| **B. Phase 01 complete** | `98dc70d` | **Peak value-to-contamination ratio.** `models.py` = 94 L / 3 tables, all genuinely generic (`infrastructure_tasks`, `infrastructure_checkpoints`, `provider_circuits`). Full task runtime, checkpoint store, provider gateway + circuit breaker + budget. `health.py` at this commit imports only `persistence` (verified: no `references` import yet) | Zero product-domain tables. Only contamination is `health.py`'s legacy document list and Product-V1 phrasing (`"Product V1 database URL must use SQLite"` in `engine.py`) | **High** — ~1,050 LOC src + ~1,100 LOC tests, all product-neutral | **Best source commit.** Recommended as the commit to port *from*, not to fork |
| **C. Phase 02 complete** | `69dd323` | Adds `ManagedBookStorage` (251 L) — the strongest single file in the repository: streamed sha256 intake, `%PDF-` header + `%%EOF` trailer validation, size cap, `os.replace` atomic publish, path containment with a documented Windows extended-length-prefix edge case, two-phase orphan reconciliation with grace windows, active-path registry | `books.reserved_knowledge_dataset_id` is introduced here as `NOT NULL UNIQUE` (`migrations/versions/20260828_0002_phase02_book_intake.py`; verified present in `git show 69dd323:src/ai_ebook/persistence/models.py` line 104). Book intake also hard-binds one Book → one full-book parse task, which conflicts with C2 | **High for storage, medium for lifecycle** | **Port storage + tests; do not fork.** The dataset reservation must be dropped, which means editing the migration anyway |
| **D. Phase 03 complete** | `c68f3a6` | Adds `NativeTextProbe`, `AdaptiveParserAdapter`, `ManagedSourceStorage`, per-page checkpoint resume, candidate/accepted ParseRun | Introduces `source_blocks` with CHECK constraints that *encode* `EXACT_SOURCE_TEXT`/`DERIVED_EXTRACTION`/`ASSET` product semantics into the schema. `document_sections.title_source_block_id` FKs the outline to SourceBlock. This is the exact "seemingly generic module drags product semantics" case | **Medium** — the resumability and storage patterns are worth more than the extraction model | **Reject as fork point.** Port ~4 files and 1 test cluster |
| **E. Current HEAD** | `7daa78e` | Everything, including a working end-to-end pipeline and the executed DMA OCR experiment | 61 tables, 10 chained migrations, 20.5k LOC of which ~89% encodes the abandoned product path. One test already fails (`test_repository_safety.py::test_phase_08_plus_packages_are_not_present`) because the repo outgrew its own guard | **Very low as a base; very high as evidence** | **Reject as fork point. Retain in full as an archived evidence repository** |
| **F. Clean repository + selective port** | n/a | New migration `0001` designed for progressive OCR and word/line geometry. No `reserved_knowledge_dataset_id`. `persistence/models.py` split by bounded context from day one. Legacy history stays available in `408-ai-ebook` for archaeology | Requires deliberate, file-by-file porting discipline (see §10) | **Highest** | **RECOMMENDED** |

### Cost comparison — the deciding argument

**Cost of forking `98dc70d`** (the only credible fork candidate): inherit 22 commits whose messages, reports and `CODEX_MASTER_INSTRUCTION.md` authority chain all describe a product that no longer exists; inherit alembic revision `20260827_0001` as the permanent chain root, so the new project's schema history begins with a Product-V1-named revision; inherit `health.py`'s legacy document validator; and still write every domain table yourself. Saving: roughly one afternoon of file copying.

**Cost of a clean repository**: copy ~20 source files and ~6 test files, adjust ~10 import lines and 2 docstrings, author one new migration `0001`. Gain: a migration chain, a package layout, and a Git history that describe *this* product.

The fork saves less than it costs. **Recommend F.**

**Credible alternative worth stating:** if the priority is provably-unchanged infrastructure over a clean history, fork `98dc70d` and immediately (i) delete `health.py`'s `AUTHORITATIVE_DOCUMENTS`, (ii) squash `20260827_0001` into a new project-named root revision, (iii) rename the package. This is defensible; it is not recommended, because step (ii) already discards the only durable benefit of forking.

---

## 4. Capability Reuse Matrix

Classifications: `REUSE_AS_IS` · `ADAPT` · `SELECTIVE_PORT` · `REFERENCE_ONLY` · `DISCARD_ARCHIVE`

### 4.1 Foundation and runtime

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Structured JSON logging + secret redaction | `src/ai_ebook/logging_setup.py` (60 L) | 00 | **REUSE_AS_IS** | Zero domain knowledge. `JsonFormatter` + `redact_mapping` on `secret/password/token/credential/api_key` | none | `tests/test_logging_setup.py` (3 tests, 43 L) |
| Settings boundary | `src/ai_ebook/config.py` (128 L) | 00–08 | **ADAPT** | Pattern is right (single `pydantic-settings` boundary, `AI_EBOOK_` prefix, `model_validator` numeric bounds, cross-field checks such as `chunk_bytes <= max_bytes` and `orphan_final_grace > busy_timeout + 1s`). Field *set* is phase-specific: `reference_embedding_*`, `review_*`, `parser_native_*` do not survive | pydantic-settings | `tests/test_config.py` (8 tests) |
| Packaging / lint / test config | `pyproject.toml`, `alembic.ini` | 00 | **ADAPT** | Pinned deps, ruff `E,F,I,UP,B` @ line-length 100, py311 target, `src/` layout, console script. Rename package; re-evaluate the `docling`/`rapidocr`/`torch` extras against the new OCR decision | — | — |
| SQLite engine policy | `src/ai_ebook/persistence/engine.py` (97 L) | 01 | **REUSE_AS_IS** | Per-connection `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout`; `Database.transaction()` translating lock `OperationalError` → typed `DatabaseBusyError`; parent-dir creation. One line to edit: `"Product V1 database URL must use SQLite"` | SQLAlchemy 2.0 | `tests/test_persistence.py::test_short_sqlite_contention_waits_then_succeeds`, `::test_sqlite_lock_timeout_is_bounded_and_typed`, `::test_transaction_exception_rolls_back` |
| Declarative base / IDs / errors / user scope | `persistence/base.py`, `ids.py`, `errors.py`, `user_scope.py` (41 L total) | 01 | **REUSE_AS_IS** | `new_stable_id()` = uuid4, display-name-independent. `UserScope` is the single-user-first convention with no account model — exactly what §3.3 needs | none | `tests/test_persistence.py::test_stable_ids_and_injectable_user_scope` |
| Alembic programmatic boundary | `persistence/migrations.py` (45 L), `migrations/env.py` | 01 | **REUSE_AS_IS** | `upgrade_database` / `current_revision` / `head_revision`, with a hard single-head assertion. The `database_url.replace("%","%%")` escaping is a real bug-avoidance detail | alembic | `tests/test_persistence.py::test_empty_database_upgrade_is_repeatable_and_at_head`; `tests/test_health.py::test_database_health_rejects_schema_behind_head` |
| **Generic task substrate** | `tasks/contracts.py`, `tasks/repository.py` (457 L), `tasks/service.py`, `tasks/runner.py` | 01 | **REUSE_AS_IS** | The highest-value reusable asset. 8-state lifecycle (`QUEUED/RUNNING/SUCCEEDED/TECHNICAL_FAILED/RECOVERABLE_TECHNICAL_STOP/USER_ACTION_REQUIRED/BUDGET_EXHAUSTED/CANCELLED`), single-winner `claim()` under concurrency, `idempotency_key` uniqueness, startup reconciliation of interrupted work, owner-scoped cancellation, per-task usage accounting. Payload is opaque JSON — genuinely product-neutral. Maps directly onto §4.2 background OCR batches and §14 Chapter Preparation | `persistence.*` only | `tests/test_tasks.py` (12 tests, 201 L), notably `::test_single_winner_claim_under_concurrency`, `::test_queued_crash_before_submit_is_rediscovered_and_executed_once`, `::test_task_schema_has_no_generation_semantics` |
| **Checkpoint / recovery** | `tasks/checkpoints.py` (133 L) | 01 | **REUSE_AS_IS** | Monotonic sequence, sha256 payload checksum, schema-version gating, atomic publish inside the same transaction as the caller's `before_commit` hook, and validated recovery that *rejects a corrupt newest checkpoint and falls back*. This is the mechanism that makes §4.2 progressive per-page OCR crash-safe | `persistence.*`, `tasks.contracts` | `tests/test_tasks.py::test_checkpoint_recovery_rejects_corrupt_newest_and_falls_back`, `::test_checkpoint_publish_is_atomic_and_round_trips_opaque_payload`, `::test_unsupported_checkpoint_version_is_not_recovery_truth` |
| Bounded local executor | `tasks/runner.py` (31 L) | 01 | **REUSE_AS_IS** | `ThreadPoolExecutor` behind the service; `reconcile_and_submit` on startup | `tasks.service` | `tests/test_tasks.py::test_default_runner_concurrency_is_one`, `::test_configured_workers_claim_distinct_tasks_with_separate_sessions` |
| **Provider abstraction + error normalization** | `llm/contracts.py`, `llm/errors.py`, `llm/provider.py` | 01 | **REUSE_AS_IS** | `LLMProvider` Protocol + `generate_structured(schema)`; error taxonomy carrying `retryable` / `breaker_qualifying` / `code` as class attributes, separating retryable transport failures from `USER_ACTION_REQUIRED` (auth/permission/billing). Serves §34 "model is not Agent" directly | pydantic | `tests/test_llm_boundary.py::test_provider_is_replaceable_and_structured_output_is_validated`, `::test_user_action_failures_bypass_retry_and_breaker_count` |
| **Retry / circuit breaker / budget gateway** | `llm/gateway.py` (122 L), `llm/breaker.py` (196 L), `llm/budget.py` (34 L) | 01 | **REUSE_AS_IS** | Finite retry (`max_retries+1` attempts, no unbounded loop — satisfies §33.2); **persisted cross-task** breaker with an optimistic-version single-probe half-open lease and `release_probe()` for non-evidentiary exits; conservative reserve-then-reconcile token budget that charges failed attempts. Provider waits happen outside DB transactions | `persistence`, `tasks` | `tests/test_llm_boundary.py` (17 tests, 465 L), notably `::test_breaker_opens_fails_fast_and_recovers_with_one_probe`, `::test_abandoned_half_open_lease_is_reclaimed_after_restart`, `::test_provider_wait_occurs_outside_database_transaction` |
| Concrete real provider adapter | — | — | **NOT FOUND** | Repository contains only `LLMProvider` + `FakeProvider`. Confirmed by `grep -rn "openai\|anthropic\|httpx\|requests"` over `src/` → zero hits, and independently stated in `docs/08-ui/interaction-harness/DMA_OCR_EXPERIMENT.md` §9 ("no concrete real provider adapter"; "AI genuinely wraps ORIGINAL is `NOT RUN`") | — | `tools/reader-harness/var/dma-ocr-experiment-run.json`: `"ai_genuinely_wraps_original": "NOT RUN"` |
| Project/document health validator | `src/ai_ebook/health.py` (260 L) | 00–05 | **DISCARD_ARCHIVE** (DB-health portion: **SELECTIVE_PORT**) | ~90% is a hard-coded `AUTHORITATIVE_DOCUMENTS` tuple listing `SYSTEM_BLUEPRINT_V4`, `V4_DECISION_REGISTER_REV3`, four Agent Skills, and every `PHASE_XX_BRIEF/PLAN/TEST_PLAN` — an authority chain the new project explicitly replaces (`PRODUCT_BLUEPRINT.md` §0.1: two canonical documents). It also imports `references.index`, an odd Phase-05 coupling. The `sqlite_health` + migration-head check is worth keeping | `persistence`, `references` | `tests/test_health.py` (8 tests) — mostly DISCARD |
| CLI entrypoint | `src/ai_ebook/__main__.py` (271 L) | 00–04 | **ADAPT** (skeleton only) | argparse subcommand shape + service-wiring helpers are a fine template. Every actual subcommand (`book-sources`, `dataset-initialize`, `dataset-rebuild`, `dataset-status`) is legacy-domain | all | `tests/test_health.py::test_cli_health_is_the_executable_baseline`, `tests/test_books.py::test_book_cli_exercises_intake_status_and_delete` |

### 4.2 PDF intake, storage, and safety

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| **Managed PDF storage + cleanup safety** | `books/storage.py` (251 L) | 02 | **REUSE_AS_IS** | Streamed chunked read with running sha256 and byte cap; `%PDF-` prefix and `%%EOF` trailer evidence; `open("xb")` + `os.fsync` + `os.replace` atomic publish; `_contained()` path-escape guard with an explicit, commented Windows `\\?\`-prefix normalization; in-flight `_active_paths` registry under a lock; `reconcile()` with separate temp and orphan-final grace windows. Directly serves §2 (PDF is authority) and §4.1 (immediate readability) | `books.contracts` errors only | `tests/test_books.py`: `::test_cleanup_grace_protects_fresh_temp_and_unreferenced_final`, `::test_concurrent_reconcilers_delete_each_orphan_at_most_once`, `::test_reconciler_does_not_remove_in_flight_publication`, `::test_two_books_intake_concurrently_are_path_and_identity_isolated`, `::test_managed_path_escape_is_rejected`, `::test_interrupted_stream_cleans_partial_temp` |
| Book identity + lifecycle contracts | `books/contracts.py` (79 L) | 02 | **ADAPT** | `BookStatus` `ACTIVE/DELETING/DELETE_FAILED/DELETED` tombstone model and the typed error taxonomy are good. **Must remove `BookSnapshot.reserved_knowledge_dataset_id`** and revisit `parse_task_id` singularity | none | — |
| Book repository | `books/repository.py` (200 L) | 02 | **ADAPT** | Optimistic-version updates, `referenced_managed_paths()` feeding storage reconciliation, `list_active_without_handoff()`. Carries the dataset reservation | `persistence.models` | `tests/test_books.py` |
| Book intake / handoff / delete orchestration | `books/service.py` (184 L) | 02 | **SELECTIVE_PORT** | Keep: publish-inside-context-manager with rollback-on-DB-failure, delete convergence (`DELETE_FAILED` is retryable, not terminal), file deletion outside DB transactions. **Discard**: `reserved_knowledge_dataset_id` minting; `from ai_ebook.knowledge.contracts import KNOWLEDGE_TASK_TYPES` (line 18); the "exactly one `primary_book.parse` task per Book" handoff, which contradicts §4.2 bounded page batches | `knowledge.contracts` (severable), `tasks` | `tests/test_books.py::test_delete_cancels_handoff_and_restart_cannot_revive_it`, `::test_ensure_parse_handoff_and_delete_race_converges_to_cancelled`, `::test_delete_failure_is_ineligible_and_retryable` |
| PDF serving to a Reader | — | — | **NOT FOUND** | The repository stores and parses the PDF but never serves it for display. `tools/reader-harness/devapi.py` serves the *reconstructed render tree*, not `primary.pdf` (its single `pdf` hit is the `"pdf_page_index"` metadata key). §2 requires PDF display as the primary surface — greenfield | — | — |

### 4.3 Parser / OCR / geometry

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Native text-layer probe | `parsing/native.py` (57 L) | 03 | **REUSE_AS_IS** | Cheap pre-OCR triage via `pypdf`: per-page extract, compacted-length threshold, U+FFFD/NUL replacement ratio, encrypted-PDF rejection, page-cap enforcement. Returns a typed reason per page. Directly usable to decide which pages need OCR under §4.2 | pypdf | `tests/test_parser_adapter.py::test_adaptive_adapter_probes_before_layout_backend` |
| Probe-before-backend routing discipline | `parsing/adapter.py` → `AdaptiveParserAdapter` (~50 L of 327) | 03 | **SELECTIVE_PORT** | The invariant "an unreliable native page may not remain on the NATIVE route", plus page-count/page-order cross-checks against the probe. Sound and cheap to re-express per page | `parsing.contracts` | `tests/test_parser_adapter.py::test_unreliable_native_probe_cannot_stay_on_native_route` |
| Page geometry primitive | `parsing/contracts.py` → `BBox` (~25 L) | 03 | **SELECTIVE_PORT** | Validating dataclass with an explicit `coordinate_origin` (`BOTTOM_LEFT` default) — the coordinate-origin discipline is exactly the trap §8/§10 geometry anchoring must avoid. Note `PRODUCT_BLUEPRINT.md` §39 leaves normalization unfrozen; legacy stores raw PDF units | none | `parsing/contracts.py` `__post_init__` invariants |
| Docling/RapidOCR layout backend | `parsing/adapter.py` → `DoclingLayoutParser` (~250 L) | 03 | **REFERENCE_ONLY** | **Granularity mismatch is disqualifying.** Emits one block per Docling item (title/section_header/text/picture/table) with one bbox — no word and no line geometry, which §6 makes the V1 core. Also: converts the *whole document* in one or two passes (conflicts with §4.2 progressive preparation); fabricates `page_label=str(page_index+1)` (violates §5/C4); permanently extracts figure PNGs as assets (violates §10/C9). Its lazy-import isolation and `parser_version` provenance-string assembly are the parts worth imitating | docling 2.123.0, rapidocr 3.9.2, onnxruntime 1.23.2 | `tests/test_parser_adapter.py` (4 tests) — all encode SourceBlock classification semantics |
| Real-corpus OCR performance evidence | `docs/05-development-reports/PHASE_03_IMPLEMENTATION_REPORT.md` | 03 | **REFERENCE_ONLY (high value)** | Measured on the real 408 textbook: 29/29 pages scan-only, **all** routed to OCR; 639 blocks (619 REGION, 18 IMAGE, 2 TABLE); 639/639 retained page+bbox; warm full run **117.1 s / ~1,149 MiB RSS**; 11-page subset 51.35 s / ~1,090 MiB. Declared debt: page-level (not region-level) route selection; one page needed a whole-page `UNRELIABLE_FAILED` fallback; CPU/memory-heavy on Windows + Python 3.13. This is the empirical basis for judging whether Docling survives into the new OCR decision | — | Same report, runtime-evidence and remaining-limitations sections |
| Resumable per-page persistence | `parsing/service.py` (267 L) | 03 | **SELECTIVE_PORT** | The `_persist_document` loop is the reusable pattern: skip already-persisted pages, re-verify ownership eligibility before each page, publish assets then persist then checkpoint, roll back assets on failure, and stop *recoverably* when a valid checkpoint exists. This is the shape §4.2 background preparation needs. Its `SourceBlock` payload and whole-book `ParsedDocument` input are not | `books`, `tasks`, `parsing.repository` | `tests/test_parsing.py::test_checkpoint_resume_skips_persisted_page_and_preserves_candidate_ids`, `::test_parser_failure_before_first_page_is_resumable_from_initial_checkpoint`, `::test_parser_wait_holds_no_database_transaction` |
| Candidate → accepted parse-run versioning | `parsing/repository.py` (516 L), `parse_runs` table | 03 | **SELECTIVE_PORT** | Partial-index `uq_parse_runs_one_accepted_per_book WHERE status='ACCEPTED'`, atomic activation, explicit auditable rebuild that cannot silently replace canonical authority. A genuine precursor to §7.1 foundation versioning — but §7.1 additionally requires **dependent-artifact remap / stale marking**, which does not exist here | `persistence.models` | `tests/test_parsing.py::test_explicit_rebuild_is_auditable_and_cannot_replace_canonical`, `::test_blocking_diagnostic_prevents_partial_canonical_activation`, `::test_rebuild_crash_resume_reuses_one_identity_checked_candidate` |
| Contained parser-asset storage | `parsing/storage.py` (149 L) | 03 | **SELECTIVE_PORT** (repurposed) | Same containment/atomic-publish/orphan-reconcile discipline as `books/storage.py`, scoped per `book/parses/<run>/assets`. Under §10 its *role changes*: it becomes an on-demand **crop cache**, not the book's visual authority. Port the mechanism, not the "extracted asset is the figure" semantics | `parsing.contracts` | `tests/test_parsing.py::test_source_asset_reconciliation_respects_grace_and_references` |
| Visual region detection | `parsing/adapter.py` (`picture`/`table` labels → bbox) | 03 | **SELECTIVE_PORT** | Docling *does* yield figure/table regions with bboxes, which §10 wants. Verified real-corpus yield: 13 IMAGE + 2 TABLE over 29 DMA pages. The blueprint keeps the geometry and drops the permanent PNG | docling | `DMA_OCR_EXPERIMENT.md` §4; run record `experimental_figure_blocks_created: 5` |
| Caption association | `docs/08-ui/interaction-harness/DMA_OCR_EXPERIMENT.md` §10 | post-09 | **REFERENCE_ONLY (high value)** | A deterministic rule — caption = immediately following block matching a source-visible `图`/`表` numbering pattern — **verified 15/15** against the retained parse (11/11 correct in the teaching region; correctly yielding no label for the 4 assets with no printed caption). Directly serves §10.1. The rule was validated in the experiment layer and never promoted into `src/` | — | `DMA_OCR_EXPERIMENT.md` §10 |
| Printed-page label recovery | — | 03 / post-09 | **CORRECTED 2026-09-03 — recoverable; not a legacy asset** *(was: NOT FOUND)* | See the correction notice below this table. The legacy `printed_page_label = UNKNOWN` finding is an artifact of the Docling pipeline discarding page furniture, **not** a property of the book. `OCR_FOUNDATION_CALIBRATION.md` §3.G recovers labels on **28/29** DMA pages and **16/29** primary-PDF pages by OCR-ing the header band. No legacy code implements this, so the reuse classification is unchanged (**NOT FOUND in legacy → build fresh**); what changes is that the capability is now known to be *achievable*, cheaply | — | `OCR_FOUNDATION_CALIBRATION.md` §3.G; `scratchpad/ocrcal/printed_page_results.json` |
| **Word-level OCR geometry** | — | — | **NOT FOUND** | Required by §6.1 for selection/copy/highlight/note anchoring. Zero occurrences of word-level geometry in `src/ai_ebook/parsing/`. Greenfield | — | — |
| **Line-level OCR geometry** | — | — | **NOT FOUND** | Required by §6.2 and by §22.2 Guidance anchoring. Docling items are not lines. Greenfield | — | — |
| OCR error reporting / manual correction | — | — | **NOT FOUND** | §7 makes this a **first-version** capability. Nothing in `src/` reports or corrects the machine layer (`grep` for `correction`/`error_report`/`override` returns only unrelated generation-retry and render-tree hits). Greenfield | — | — |
| Multimodal / on-demand crop | — | — | **NOT FOUND** | §10 requires render/crop-at-suitable-resolution-on-demand. No PDF rendering library is present at all (`grep` for `fitz`/`pymupdf`/`render`/`crop` over `src/` returns only unrelated `render_tree_ref` hits). Greenfield — and an engine choice (§39 leaves it open) | — | — |

> ### ⚠ Correction — printed-page labels (issued 2026-09-03, supersedes the original row)
>
> This audit originally recorded printed-page labels as **NOT FOUND / UNKNOWN**, treating the legacy
> DMA experiment's `"printed_page_label": "UNKNOWN"` as a finding about the textbook. That reading
> was **wrong**. `OCR_FOUNDATION_CALIBRATION.md` §3.G established, by OCR-ing the top ~7.5% header
> band of every page of both retained sample PDFs:
>
> - **DMA sample: 28 of 29 pages** yield exactly one unambiguous numeric label;
> - all 28 are consistent with a **single observed offset of +308** between PDF-local index and
>   printed label **for this specific retained sample**;
> - even-label-on-left / odd-label-on-right parity holds on every recovered page;
> - **primary sample: 16 of 29 pages**, at a different observed offset (**−11**), also fully
>   consistent, parity holding. The 13 misses are front matter with no arabic label — correctly
>   `UNKNOWN`, exactly the case §5 anticipates.
>
> **Cause of the original error:** Docling classifies running headers/footers as page furniture and
> excludes them from the document body. The legacy accepted parse therefore contained zero
> page-number blocks, and the DMA experiment reasonably — but incorrectly — inferred from that
> absence that the labels were not in the book. They were; the pipeline dropped them.
>
> **+308 is evidence, not a rule.** It describes one retained sample. It must never become a
> hard-coded cross-book page-number rule, and the two samples having *different* offsets (+308 and
> −11) is itself the proof that no global constant exists.
>
> **Resulting product requirement** (consistent with, and already expressed by, `PRODUCT_BLUEPRINT.md` §5):
> printed-page mapping is **inferred/recovered per Book / per source revision when confidently
> available, and `UNKNOWN` otherwise**. Never guessed, never extrapolated across books.
>
> **What does *not* change:** no legacy code implements header-band label recovery, so nothing
> becomes newly portable. The classification stays *build fresh*. Two downstream statements in this
> audit that leaned on the false premise are corrected in place: the Phase 03 finding in §5 and the
> confidence row in §12.

### 4.4 Knowledge structure (Phase 04)

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| KnowledgeDataset / build lifecycle | `knowledge/repository.py` (683 L), `knowledge/service.py`, tables `knowledge_datasets`, `knowledge_dataset_builds` | 04 | **DISCARD_ARCHIVE** | Book-wide, eagerly built, one dataset per Book. §14 replaces this with **lazy, Chapter-scoped** preparation (`NOT_PREPARED/PREPARING/READY/FAILED`). The candidate/accepted build-versioning *idea* survives at Chapter granularity; the code does not | `books`, `parsing`, `tasks` | `tests/test_knowledge.py` (872 L) |
| `StableSemanticAnchor` | `persistence/models.py` (`stable_semantic_anchors`), `knowledge/contracts.py::AnchorDraft` | 04 | **DISCARD_ARCHIVE** | A sub-KP progress identity. §11–12 make the **KP itself** the smallest independent-learning-state unit, owned by exactly one Section. Anchors are a second progress axis the new product does not have. **This is the single most contagious Phase 04 concept** — it reaches into `user_progress`, `session_anchor_evidence`, `segment_contract_revisions`, `reference_associations` and every generated node | — | — |
| KP ↔ SourceBlock mapping + coverage roles | `knowledge_point_source_maps`, `knowledge_source_dispositions`, `CoverageRole` | 04 | **DISCARD_ARCHIVE** | `EXPECTED / ALLOWED_SUPPORT / NON_TEACHING_EXCLUDED` exists to prove the generated ebook *covered every SourceBlock*. Under §2 there is nothing to cover — the book is already there. §13 locates a KP by continuous page/y range instead | `parsing` | `tests/test_knowledge.py` |
| KP location model | `knowledge_point_source_maps` (block-set) | 04 | **DISCARD_ARCHIVE** | §13 requires `start_page/start_y/end_page/end_y`. A block-ID set is not a range and cannot be resolved against a PDF page without SourceBlocks | — | — |
| Prerequisite DAG + cycle detection | `knowledge/validation.py::_validate_prerequisite_graph` | 04 | **SELECTIVE_PORT** | Generic graph validation. §20 "桥接/前置知识" still needs prerequisite relations between KPs, and §12 allows cross-Section prerequisite edges | none | `tests/test_knowledge.py` |
| Deterministic draft fingerprinting | `knowledge/validation.py::draft_sha256`, `::source_fingerprint` | 04 | **SELECTIVE_PORT** | Canonical-JSON sha256 for idempotent rebuild detection and staleness. §23 needs exactly this to decide when a saved Guide becomes STALE | none | `tests/test_knowledge.py` |
| Strict structured-output builder pattern | `knowledge/builder.py` (256 L): `extra="forbid"` pydantic models → `gateway.generate_structured` | 04 | **SELECTIVE_PORT** (pattern) | Reusable shape for the §14 Chapter KP generator: a strict schema the model must satisfy, a `Static…Builder` for deterministic tests, a `Provider…Builder` for real calls. The *fields* are all anchor/coverage semantics and must be redesigned | `llm` | `tests/test_knowledge.py` |
| Human calibration-ledger gate | `knowledge/calibration.py` (121 L) | 04 | **REFERENCE_ONLY** | A required-field ledger (`sample_sha256`, `knowledge_point_decisions`, `rejected_alternatives`, `granularity_profile`, `reviewer_disposition`…) plus `PASS` / `SKIP/UNAVAILABLE` with typed unavailability reasons. Good methodology for judging §11 KP granularity on real material; the specific fields are SourceBlock-shaped | — | `tests/test_knowledge.py` |
| Real DMA KP granularity decisions | `docs/05-development-reports/PHASE_04_DMA_CALIBRATION_LEDGER.md` | 04 | **REFERENCE_ONLY (high value)** | Human-made KP/anchor granularity decisions over real 408 DMA material (2 KPs, 7 anchors, 77 EXPECTED / 16 ALLOWED_SUPPORT over 83 blocks). The *anchor* half is obsolete; the KP-boundary reasoning is direct evidence for §11 | — | `DMA_OCR_EXPERIMENT.md` §5, §7 |

### 4.5 Reference corpus / retrieval (Phase 05)

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Pinned embedding profile discipline | `references/bge.py` (152 L) | 05 | **REFERENCE_ONLY** | Model id **and revision** pinned, weight sha256 verified after download, documented query-instruction vs passage policy, CPU-only lazy runtime, dimensions/pooling recorded in an `EmbeddingProfile`. Excellent supply-chain discipline worth imitating whenever the new project pins any model. The capability itself is deferred by §38 | torch, transformers, huggingface-hub | `tests/test_bge_embedding.py` (2 tests, both **SKIPPED** without `AI_EBOOK_RUN_BGE_INTEGRATION=1`) |
| Exact vector index over SQLite | `references/index.py` (117 L) | 05 | **REFERENCE_ONLY** | Brute-force scan with per-row sha256 corruption detection and a capacity bound. Fine for a local single-user product, but §38 defers past-exam RAG entirely | `persistence` | `tests/test_references.py` |
| Reference document lifecycle + revisions | `references/service.py`, `references/repository.py` (742 L), `references/storage.py` (145 L) | 05 | **REFERENCE_ONLY** (storage: **SELECTIVE_PORT**) | `ManagedReferenceStorage` repeats the same containment pattern and is a third witness that the pattern is right. The document/revision/chunk/embedding/association model is out of V1 scope | `persistence` | `tests/test_references.py` (1,026 L) |
| PastExam item model | `past_exam_items`, `references/contracts.py::PastExamDraft` | 05 | **DISCARD_ARCHIVE** | §21 makes ExamTopic *lightweight 命题追踪 metadata attached to one or more KPs*, explicitly not an independent record table or progress tree in V1; §38 defers the real past-exam layer. Its provenance discipline (separating `source_answer` / `derived_answer` / `answer_verified`) is a fair reference for §20.3 evidence traceability | — | `tests/test_references.py` |
| Reference → Anchor associations | `reference_associations` (`AssociationTargetKind.ANCHOR`) | 05 | **DISCARD_ARCHIVE** | Anchor-keyed; see §4.4 | — | — |

### 4.6 Planning / Generation / Review (Phases 06–08)

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Teaching plan revisions + unit decomposition | `planning/*` (2,253 L), tables `teaching_plan_revisions`, `generation_units`, `plan_unit_*`, `segment_contract*` | 06 | **DISCARD_ARCHIVE** | Plans the *construction of a replacement book*: which SourceBlocks each Unit must consume, closure assignment per KP, source-responsibility SHAs. §17 replaces this with a Section-scoped, replaceable teaching layer that consumes the PDF/OCR directly | `knowledge`, `references` | `tests/test_planning.py` (1,532 L) |
| Unit dependency graph + scheduling | `plan_unit_dependencies` (`CONTENT_REQUIRED`, `KP_CLOSURE`), `planning/repository.py` | 06 | **REFERENCE_ONLY** | The generic mechanism (blocked-by-dependency status, deterministic runnable-set selection) is sound and would be a fair model if Chapter Preparation ever needs staged sub-tasks. §17 says teaching generation "never needs to generate adjacent Sections", so V1 likely does not need it | — | `tests/test_planning.py` |
| Plan-revision remap of existing evidence | planning fix path + `reader/repository.py::remap_evidence` | 06/09 | **REFERENCE_ONLY (conceptually important)** | The *only* place in the repository that attempts §7.1/§15.2-style "structure changed, remap dependent user assets". It remaps anchor-keyed session evidence across an accepted planning fix. Wrong keys, right problem — study before designing the new remap | — | `tests/test_reader_closure.py::test_real_planning_fix_remaps_*`, `::test_plan_revision_remap_keeps_*` |
| Generated node model | `generation/contracts.py::NodeType` = `HEADING / AI_TEXT / ORIGINAL_REFERENCE / IMAGE_REFERENCE / TABLE_REFERENCE / RECALL_QUESTION` | 07 | **DISCARD_ARCHIVE** | `ORIGINAL_REFERENCE` **is** the abandoned product: a generated node that *carries* the textbook's `exact_text`, so the reading surface is the generated tree rather than the PDF. Contradicts §2 head-on. Everything downstream that consumes `generation_candidate_nodes` inherits this | `planning`, `knowledge`, `parsing` | `tests/test_generation.py` (1,985 L) |
| Attempt lifecycle + bounded structural retry | `generation/service.py` (691 L), `generation_attempts` | 07 | **REFERENCE_ONLY** | Attempt dispositions (`ACTIVE/CANDIDATE_READY/STRUCTURAL_FAILED/CONTRACT_INEXECUTABLE/STALE/SUPERSEDED`), invalid-model-reference retry with diagnostics fed back into the next attempt, context-budget enforcement. The bounded-retry principle maps to §33.2; the code is contract-shaped | — | `tests/test_generation.py` |
| Provider-call context assembly + budget | `generation/context.py` (384 L) | 07 | **REFERENCE_ONLY** | Deterministic context envelope with a character budget and a documented drop-order for optional context. A real problem the new Assistant/Master/System contexts will also have (§34 isolated contexts). Its inputs are SourceBlocks/anchors/contracts | — | `tests/test_generation.py` (context-budget cases) |
| Deterministic gates before semantic review | `review/gates.py` (323 L) | 08 | **REFERENCE_ONLY** | Strong principle — re-derive every hard conclusion deterministically, treat the generator's own validation as merely corroborating, and only then spend a model call. Directly applicable to §30.2 mandatory Teaching-Asset review. All ~15 gate predicates are about node/contract/coverage/anchor validity | `planning`, `generation` | `tests/test_review.py` (1,416 L) |
| Independent reviewer adapter | `review/provider.py` (59 L) | 08 | **SELECTIVE_PORT** | A clean, small, provider-neutral reviewer over the shared gateway with an explicit `reviewer_profile` and a `response_schema` option — the natural implementation point for §16's "prefer a genuinely different model/provider" and §30.3's Fast/Standard/Deep routing. Its prompt body is Phase-08-specific | `llm` | `tests/test_review.py` |
| Review issue DTO + evidence requirement | `review/contracts.py::ProposedReviewIssue` | 08 | **SELECTIVE_PORT** | `severity/category/failure_layer/summary/evidence/required_outcome` with a validator forcing **every BLOCKING issue to carry checkable evidence**, and provider judgement kept strictly separate from application-assigned identity. Reusable almost verbatim for §33.2 Review; drop `anchor_id` and `target_contract_id` | pydantic | `tests/test_review.py` |
| Issue disposition lifecycle | `review_issue_dispositions`, `CycleDisposition` = `STILL_OPEN/RESOLVED/SUPERSEDED_BY_PLANNING_FIX/NEW` | 08 | **REFERENCE_ONLY** | Forces every prior issue to receive exactly one disposition per cycle — a good anti-drift rule for iterative review | — | `tests/test_review.py` |
| Provider output audit trail | `review_provider_output_attempts` (migration `0009`) | 08 | **SELECTIVE_PORT** (concept) | Persisting raw provider attempts separately from adjudicated results is worth keeping under §30, where review strength is user-selectable and must be auditable | — | `tests/test_review.py` |
| Bounded rework accounting | `unit_rework_audits`, `content_rework_count` | 08 | **REFERENCE_ONLY** | Concrete precedent for §33.2 "finite retry principle rather than open-ended loops" | — | `tests/test_review.py` |
| Task-aggregate projection | `review/scheduler.py::project_task_aggregate` | 08 | **REFERENCE_ONLY** | Pure function folding per-unit statuses into one aggregate with a defensible precedence order (`USER_ACTION_REQUIRED` > technical stop > budget > all-ready > partial > failed). Useful shape for a §14 Chapter Preparation aggregate | — | `tests/test_review.py` |

### 4.7 Reader / session / progress (Phase 09)

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Render-tree projection | `reader/projection.py` (164 L) | 09 | **DISCARD_ARCHIVE** | Assembles the reading surface from PASS `generation_candidate_nodes`, resolving `ORIGINAL_REFERENCE` nodes by loading `SourceBlockRow.exact_text` and raising `ReferenceResolutionError` when absent. Under §2 this whole layer disappears — the PDF *is* the surface | `generation`, `planning`, `parsing`, `review` | `tests/test_reader.py` (projection round-trip and PASS-content cases) |
| Session scope model | `reader/scope.py` (28 L), `session_scopes`, `session_scope_knowledge_points` | 09 | **DISCARD_ARCHIVE** | Scope = a *set of KnowledgePoint IDs* + one generation lineage, with SAME/OVERLAPPING/DIFFERENT classification and an explicit close-then-generate confirmation. §24.1 scopes Assistant by **Section** (with a temporary page/local fallback), and §19 forbids blocking navigation on generation. The overlap-confirmation machinery solves a problem the new product does not create | — | `tests/test_reader.py` (scope identity/overlap cases) |
| Session lifecycle + reading position | `reader/repository.py` (495 L), `ebook_sessions` | 09 | **DISCARD_ARCHIVE** (optimistic-versioning pattern: REFERENCE_ONLY) | `ebook_sessions.generation_lineage` is a **NOT NULL FK to `generation_tasks`** — a Session cannot exist without a generation task. `reading_position` is a *generated node id*, so reading position dies with the generation. §35/§28.3 require Reading Position to survive independently of any AI artifact | `generation` | `tests/test_reader_closure.py` (1,462 L) |
| Session learning evidence | `session_anchor_evidence` | 09 | **DISCARD_ARCHIVE** | FKs to `teaching_plan_revisions`, `segment_contracts`, `stable_semantic_anchors`, `segment_contract_revisions` — four legacy tables for one user interaction. §28's Section Learning Check needs a Section plus a check outcome | — | `tests/test_reader_closure.py` (PASS-controls / evidence-rollup cases) |
| User progress | `user_progress` (`UNIQUE(user_scope, knowledge_point_id, anchor_id)`) | 09 | **DISCARD_ARCHIVE** (`user_scope` convention: REUSE) | Keyed by `(KP, anchor)`; states `NOT_STARTED/IN_PROGRESS/UNDERSTOOD`. §28 needs KP-keyed status with a distinct Section-level `HAS_UNCLEAR/unresolved` state and `UNCONFIRMED` semantics, plus §29 append-oriented Learning History — **no history table exists** | `knowledge` | `tests/test_reader_closure.py` |
| Reading-progress ≠ mastery separation | `reader/service.py::interact` | 09 | **REFERENCE_ONLY** | The legacy code already refuses to promote learning state without a genuine PASS-eligible contract interaction — the same instinct as §28.3 and §32. Worth restating in the new design; not portable | — | `tests/test_reader_closure.py` |
| Learning history | — | 09 | **NOT FOUND** | §29 requires append-oriented history alongside mutable current status. Legacy `user_progress` is mutable-only with a single `first_understood_at`. Greenfield | — | — |
| Notes / Highlights | — | — | **NOT FOUND** | §3.3 and §8 make these first-class durable user assets with geometry + quote anchoring. Nothing exists. Greenfield | — | — |
| Assistant / Master | — | — | **NOT FOUND** | Four Agents are specified in `docs/03-skills/*.md` but only System (generation) and Review are implemented. `tools/reader-harness/README.md` states Master and Assistant are "visibly labeled, client-only simulations" with no adapter endpoints. Greenfield | — | `tools/reader-harness/README.md` (Boundary section) |

### 4.8 Tooling, fixtures, governance

| Capability | Legacy Paths | Phase | Classification | Why | Dependencies | Tests / Evidence |
|---|---|---|---|---|---|---|
| Real 408 textbook sample PDFs | `D:\codex\408-ai-ebook-samples\phase03\primary\2026计算机组成原理_第1-29页.pdf` (12.6 MB, sha256 `327DA74E…0AA1`), `…\phase04\dma\2026计算机组成原理_第320-348页.pdf` (13.5 MB), `…\phase03\notes\runtime-validation-11-pages.pdf` (5.9 MB) | 03–04 | **REUSE_AS_IS (external)** | Real scanned 408 material, already proven to exercise the scan-only OCR path, figures, tables and formula-heavy regions. The legacy project deliberately kept them **outside** the repository and copied no textbook text in — keep that discipline | — | `PHASE_03_IMPLEMENTATION_REPORT.md`; `DMA_OCR_EXPERIMENT.md` §4 |
| Parser runtime environment + model cache | `…\phase03\parser-runtime-venv` (1,376 MiB), `…\phase03\model-cache` (505 MiB) | 03 | **REUSE_AS_IS (external, conditional)** | Saves a large download **iff** Docling/RapidOCR survives the new OCR-engine decision. Otherwise archive | — | `PHASE_03_IMPLEMENTATION_REPORT.md` (isolated evaluation environment) |
| Retained real parse + canonical DB | `var/ai_ebook.db` (1.88 MB), `var/storage/books/6aeee9f8-…/` | 03–09 | **DISCARD_ARCHIVE (retain read-only)** | Contains the accepted DMA ParseRun `85b59562-…` — 29 pages, 720 SourceBlocks, 15 asset PNGs. Not importable into the new schema, but the *only* corpus of real OCR output available for judging OCR quality and for A/B-ing a new word/line pipeline. Archive; never migrate | — | `DMA_OCR_EXPERIMENT.md` §4; run record `canonical_parse_run_id` |
| Executed DMA OCR experiment | `docs/08-ui/interaction-harness/DMA_OCR_EXPERIMENT.md`, `tools/reader-harness/seed_dma_ocr_experiment.py` (1,198 L), `tools/reader-harness/var/dma-ocr-experiment-run.json` | post-09 | **REFERENCE_ONLY (high value)** | The experiment ran: 78 byte-equal OCR transcriptions projected, 0 byte mismatches, 5 figure blocks, canonical DB sha256 identical before and after, and `"human_acceptance_criteria": "PENDING HUMAN RECORD"`. Its §12 criteria 1–8 are a ready-made human protocol for the *still-open* question "is retained OCR quality good enough to carry a real reading product" — which the new project must answer before freezing §6/§7 | — | run record JSON |
| Reader interaction harness | `tools/reader-harness/` (3,824 L incl. static) | post-09 | **REFERENCE_ONLY** | Useful precedent for a zero-dependency validation UI: stdlib `ThreadingHTTPServer` bound to `127.0.0.1`, real service calls, no npm/framework/build step. Its content model is the render tree, and it never serves the PDF | `reader`, `generation` | `tools/reader-harness/README.md` |
| External reviewer scripts | `tools/dev-review/*.ps1` (untracked) | — | **ADAPT** | Dev-time reviewer dispatch to separate `codex exec` processes with strict-JSON output and an explicit rule that the main agent must not substitute its own analysis. Process tooling, product-neutral | — | `tools/dev-review/tests/direct-review.tests.ps1` |
| Phase 03 sample validation runner | `tools/phase03-validate-sample.py` | 03 | **REFERENCE_ONLY** | Runs the real pipeline over an external PDF without copying textbook content into the repo. Good template for the new OCR benchmark harness | `books`, `parsing` | — |
| Agent role bindings + collaboration map | `.agents/role-bindings/*.md`, `.agents/COWORK.md` | — | **ADAPT** | The MANUAL_RELAY operating model (Claude plans, Codex implements, ZCode reviews, user is the relay/gate; "drafting is not authorization"; `reviewer_invocation_failure ≠ PASS`) is process infrastructure worth carrying. Every authority-chain reference must be rewritten | — | — |
| Project master instruction | `CODEX_MASTER_INSTRUCTION.md` (16 KB) | — | **ADAPT** | Its authority chain (`Decision Register → System Blueprint → Development Spec → Agent Skills → Governance → Phase Brief → Plan`) is superseded by `PRODUCT_BLUEPRINT.md` §0.1's two-document strategy. Keep §3 Repository Truth Rule, §6 engineering autonomy, §7 request protocols, §9 frozen-conflict handling; discard the chain | — | — |
| Legacy product authority documents | `docs/01-product/SYSTEM_BLUEPRINT_V4.md`, `docs/07-review/V4_DECISION_REGISTER_REV3.md`, `docs/00-master/CODEX_GOVERNANCE_V1_FROZEN.md`, `docs/02-engineering/DEVELOPMENT_SPEC_V1.md` | — | **DISCARD_ARCHIVE** | Superseded product authority. Must **not** be copied into the new repository — §0.1 explicitly targets a minimal cold-start surface, and their presence would immediately re-create a competing authority chain | — | — |
| Agent skill documents | `docs/03-skills/{SYSTEM,REVIEW,MASTER,ASSISTANT}_AGENT_SKILL.md` | — | **REFERENCE_ONLY** | §33 keeps the same four Agents, so the *boundary* thinking transfers; the content assumes generated-ebook semantics | — | — |
| Phase implementation reports | `docs/05-development-reports/PHASE_0X_IMPLEMENTATION_REPORT.md` (17 files) | 00–09 | **REFERENCE_ONLY** | The best record of *what was actually measured* (runtime, memory, block counts, dependency licenses, declared debt). The Phase 01/02/03 reports are the ones that stay relevant | — | — |
| UI design context | `docs/08-ui/**` (2,357 L + a 60 KB design-canvas prototype), untracked | post-09 | **DISCARD_ARCHIVE** (visual language: REFERENCE_ONLY) | Explicitly derived from `SYSTEM_BLUEPRINT_V4` and stamped "DERIVED DESIGN CONTEXT — NON-AUTHORITATIVE". `DESIGN_HARD_BOUNDARIES.md` instructs designers *not* to invent state beyond "the Render Tree projection, `EbookSession`, `session_anchor_evidence`, `UserProgress`", and `READER_STRUCTURE.md` builds navigation on `KP → Segment → Render Nodes` — both are actively wrong for a PDF-first product. Carrying these into the new repo would silently re-import the abandoned model through the design surface. Typography/palette from `ui-v1/Reader Prototype.dc.html` may be reused as visual reference only | — | — |

---

## 5. Phase 00–03 Findings

### Phase 00–01 — the foundation is the prize

Phase 00 (`e06f7df`, `a33f9f6`) delivers packaging, config, logging and a CLI health baseline. Only `logging_setup.py` survives unmodified; `config.py` survives as a pattern; `health.py` is the first contaminated file in the repository — it validates the legacy document chain by construction.

Phase 01 (`14e1c5e`, `ece049d`, `98dc70d`) is where the reusable value concentrates. At `98dc70d` the schema is exactly three tables and they are honestly generic — `tests/test_tasks.py::test_task_schema_has_no_generation_semantics` was written specifically to assert that, and it passes. What the new project gets, essentially free:

- a task substrate whose payload is opaque JSON and whose states already model *technical failure vs recoverable stop vs user-action-required vs budget-exhausted* — the exact distinctions §14/§19 need to keep a failed Chapter Preparation from blocking reading;
- a checkpoint store that survives a corrupted newest checkpoint;
- a provider gateway with finite retry, a **persisted** cross-task circuit breaker (single half-open probe with an optimistic-version lease and an explicit `release_probe` for non-evidentiary exits), and a reserve-then-reconcile budget that charges failed attempts.

The breaker's abandoned-lease reclamation (`test_abandoned_half_open_lease_is_reclaimed_after_restart`) is the kind of detail that is expensive to rediscover. Port it.

**Caveat.** `Settings.max_task_model_calls=100` / `max_task_tokens_or_equivalent=100_000` and `review_token_reservation` are Product-V1 budget shapes. Under §30.3–30.4, budgets become *per-interaction-mode* (Fast/Standard/Deep; Assistant defaults to no review) rather than per-task. Port the mechanism, redesign the numbers.

### Phase 02 — best single file, one poisoned field

`books/storage.py` is the strongest file in the repository and should be ported essentially verbatim. Its test suite is a genuine concurrency/crash-safety suite, not a smoke test.

The contamination is precise and easy to state: `books.reserved_knowledge_dataset_id String(36) NOT NULL UNIQUE`, created in `migrations/versions/20260828_0002_phase02_book_intake.py` and present in `git show 69dd323:src/ai_ebook/persistence/models.py` at line 104. A Book cannot be created without minting a KnowledgeDataset identity. `tests/test_books.py::test_reserved_dataset_identity_is_unique` promotes that coupling to a *tested invariant*. Both the column and that test must be dropped.

Second, subtler mismatch: Phase 02 binds one Book to exactly one full-book parse task (`books.parse_task_id` UNIQUE; `_parse_task_key(book_id) = f"book-parse:{book_id}"`). §4.2 requires **bounded page batches with prioritization** (TOC pages, the opened Chapter/Section, nearby pages). The handoff *pattern* — durable task, idempotency key, reconcile-on-startup, cancel-on-delete — survives; the one-task-per-Book cardinality does not.

### Phase 03 — the crucial split

This is where the audit's central distinction bites hardest, so state it plainly.

**Reusable technical capability (port):**
- `NativeTextProbe` — cheap per-page triage with typed reasons and an encoding-reliability ratio.
- Probe-before-backend routing, with the invariant that an unreliable page cannot stay native.
- `BBox` with an explicit `coordinate_origin`.
- Per-page resumable persistence: skip-persisted → re-verify eligibility → publish assets → persist → checkpoint, with asset rollback on failure and recoverable-stop when a checkpoint exists.
- Candidate/accepted run versioning with a partial unique index and atomic activation.
- `ManagedSourceStorage` containment / atomic publish / orphan reconcile — repurposed as a crop cache.

**Obsolete product semantics (do not port):**
- `SourceBlock` as the addressable unit of the book. Its CHECK constraints (`ck_source_block_exact_payload`, `ck_source_block_derived_payload`, `ck_source_block_asset_payload`, `ck_source_block_no_exact_derived_dual`) encode `EXACT_SOURCE_TEXT` / `DERIVED_EXTRACTION` / `ASSET` **in the schema**. Any port of migration `0003` imports that product model into the database itself.
- `ParsedDocument.__post_init__` requiring every page exactly once, in order — structurally incompatible with §4.2.
- `page_label = str(page_index + 1)` — a fabricated printed-page label, contradicting §5. *(Correction 2026-09-03: this row originally added "and contradicted by the project's own later finding (`printed_page_label: UNKNOWN`)". That supporting clause is withdrawn — see the §4.3 correction notice. The fabrication is still wrong, and it is now demonstrably wrong in a sharper way: the real labels were recoverable all along, so `str(page_index+1)` was overwriting recoverable truth with a guess. On the DMA sample the fabricated label is off by 308 on every page.)*
- Permanent figure/table PNG extraction as the visual asset — §10 stores geometry and renders on demand.
- `document_sections.title_source_block_id` — the physical outline is anchored to a SourceBlock and carries **no physical range**, so it cannot satisfy §9 without redesign.

**The decisive gap.** Phase 03's OCR yields Docling-item text with one bbox per item. §6 needs word geometry (selection, copy, highlight, note anchoring, exact Assistant selection context) and line geometry (semantic Guidance targeting, resolving AI boundaries to page geometry). Neither exists. The new project must choose an OCR path that emits word+line boxes; whether that is RapidOCR driven directly (rather than through Docling's document model), a different engine, or PDF text-layer extraction for native pages, is an open engineering question (§39 leaves the OCR engine unfrozen). Phase 03's real-corpus measurements — all 29 pages scan-only, 117 s and ~1.1 GiB for a full 29-page Docling+RapidOCR pass — should inform that choice, especially against §4.1's "PDF readable immediately".

---

## 6. Phase 04–09 Findings

The mandate is to separate reusable technical mechanisms from obsolete product semantics. For these phases the ratio is heavily weighted toward the latter, but the mechanisms below are real.

### Reusable technical mechanisms

| Mechanism | Where | Fit with new product |
|---|---|---|
| Strict structured-output builder (`extra="forbid"` schema + Static/Provider builder pair) | `knowledge/builder.py`, `planning/builder.py`, `generation/provider.py`, `review/provider.py` | Four consistent witnesses of the same pattern. Directly reusable for §14 Chapter KP generation, §16 structural review, §17 Section teaching, §30 verification |
| Deterministic gates before spending a model call | `review/gates.py` | Directly reusable for §30.2 mandatory Teaching-Asset review — cheap deterministic checks first, semantic review only on `DET_PASS` |
| Review issue DTO with mandatory evidence for BLOCKING | `review/contracts.py::ProposedReviewIssue` | Near-verbatim reusable for §33.2; supports §20.3's requirement that exam-weight claims expose their basis |
| Provider-output audit trail separate from adjudicated result | migration `0009`, `review_provider_output_attempts` | Supports §30's user-selectable review strength being auditable |
| Bounded rework accounting | `unit_rework_audits` | Concrete precedent for §33.2 finite retry |
| Candidate → accepted with a partial unique index | Phases 03/04/05/06 all use `sqlite_where="status='ACCEPTED'"` | Reusable for §14 Chapter map READY and §7.1 foundation versions |
| Aggregate status projection as a pure function | `review/scheduler.py::project_task_aggregate` | Reusable shape for a Chapter Preparation aggregate |
| Canonical-JSON sha256 fingerprints for staleness | `knowledge/validation.py` | Directly serves §23 STALE detection |
| Prerequisite DAG cycle validation | `knowledge/validation.py` | Serves §20 桥接/前置知识 |
| Structure-change → dependent-evidence remap | `reader/repository.py::remap_evidence` + planning fix | The only existing attempt at the §7.1/§15.2 problem. Study, then redesign |
| Pinned-model supply-chain discipline (revision + weight sha256) | `references/bge.py` | Reusable policy for any model the new project pins |

### Obsolete product semantics (the abandoned path)

1. **`StableSemanticAnchor`** — a sub-KP progress identity. §11–12 make the KP the smallest unit. Anchors leak into `user_progress`, `session_anchor_evidence`, `segment_contract_revisions`, `reference_associations` and every generated node. Removing anchors removes roughly a third of the domain schema.
2. **Coverage responsibility over SourceBlocks** (`EXPECTED/ALLOWED_SUPPORT/NON_TEACHING_EXCLUDED`, `PlanningSourceResponsibility`, `PlanUnitSourceAssignment`, `EXPECTED_SOURCE_NOT_COVERED`) — machinery to prove the *generated ebook covered the whole textbook*. Under §2 nothing needs covering.
3. **`ORIGINAL_REFERENCE` render nodes** — generated nodes containing the textbook's own text, making the render tree the reading surface. The single clearest contradiction of §2.
4. **`SegmentContract` / `TeachingPlanRevision` / `GenerationUnit`** — a plan for constructing a replacement book. §17 needs a Section-scoped, replaceable, individually regenerable teaching layer.
5. **KP-set `Scope` + overlap confirmation** — solves "two generations fighting over the same KPs". §19 makes navigation immediate and generation background; the conflict does not arise.
6. **`ebook_sessions.generation_lineage NOT NULL FK → generation_tasks`** — a reading session cannot exist without an AI generation. §18's Original-only / AI-off path makes this impossible to keep.
7. **`reading_position` = generated node id** — reading position dies when generation is replaced. §35 requires it to survive.
8. **Eager, book-wide KnowledgeDataset build** — §14 requires lazy, max-one-Chapter preparation.
9. **PastExam corpus + RAG** — §21 reduces V1 ExamTopic to lightweight 命题追踪 metadata; §38 defers the rest.
10. **Always-on independent review of every unit** — §30 makes review strength tiered and mandatory only for formal System Teaching Assets.

---

## 7. Persistence / Migration Findings

Not a schema design. Only what should and should not cross.

### Technically generic — safe to inherit

| Table | Why it is safe |
|---|---|
| `infrastructure_tasks` | Opaque `payload_json`, generic lifecycle, `idempotency_key` uniqueness, usage counters. Asserted product-neutral by `test_task_schema_has_no_generation_semantics` |
| `infrastructure_checkpoints` | `(task_id, sequence)` unique, `payload_type` + `schema_version` + `checksum`. Opaque payload |
| `provider_circuits` | Provider-key-scoped breaker state with an optimistic `version`. No domain knowledge |

These three, plus the SQLite pragma policy and the Alembic single-head rule, are the entire safe inheritance.

### Semantically obsolete — must not cross

`knowledge_datasets`, `knowledge_dataset_builds`, `knowledge_points`, `stable_semantic_anchors`, `knowledge_point_source_maps`, `knowledge_source_dispositions`, `knowledge_point_prerequisites`, `knowledge_point_definition_sources`, `anchor_source_supports`, `reference_documents`, `reference_revisions`, `reference_assets`, `reference_items`, `past_exam_items`, `reference_chunks`, `reference_embeddings`, `reference_associations`, `generation_tasks`, `generation_task_knowledge_points`, `teaching_plan_revisions`, `generation_units`, `plan_unit_assignments`, `plan_unit_knowledge_points`, `planning_source_responsibilities`, `plan_unit_source_assignments`, `plan_unit_anchor_scopes`, `plan_kp_closure_assignments`, `segment_contracts`, `segment_contract_revisions`, `segment_contract_source_refs`, `plan_unit_dependencies`, `planning_reference_evidence`, `generation_attempts`, `generation_candidates`, `generation_candidate_nodes`, `generation_recall_evidence`, `generation_candidate_reference_evidence`, `generation_validation_issues`, `review_runs`, `review_provider_output_attempts`, `review_results`, `review_issues`, `review_issue_dispositions`, `unit_pass_records`, `unit_used_pass_sources`, `unit_rework_audits`, `session_scopes`, `session_scope_knowledge_points`, `ebook_sessions`, `session_anchor_evidence`, `user_progress`.

That is **50 of 61 tables**.

### Dangerous to carry forward — the specific traps

| # | Trap | Evidence | Consequence if carried |
|---|---|---|---|
| T1 | `books.reserved_knowledge_dataset_id NOT NULL UNIQUE` | migration `0002`; `models.py` `BookRow` | Book intake — an otherwise clean capability — cannot be created without minting an obsolete domain identity |
| T2 | `source_blocks` CHECK constraints encoding extraction classification | `models.py` `SourceBlockRow.__table_args__` | Product semantics enforced by the database. The DMA experiment (§6 of that document) had to build an entire parallel projection *because these constraints could not be worked around* — proof they are load-bearing product rules, not integrity rules |
| T3 | `document_sections.title_source_block_id FK → source_blocks` | `models.py` `DocumentSectionRow` | The outline — which §9 keeps — is unusable without SourceBlocks, and carries no physical range |
| T4 | `ebook_sessions.generation_lineage NOT NULL FK → generation_tasks` | `models.py` `EbookSessionRow` | Makes AI generation a precondition for reading; contradicts §18's AI-off path |
| T5 | `user_progress UNIQUE(user_scope, knowledge_point_id, anchor_id)` | `models.py` `UserProgressRow` | Anchors become permanent in the user's durable learning data — the hardest thing to remove later |
| T6 | `session_anchor_evidence` FKs to four legacy tables | `models.py` `SessionAnchorEvidenceRow` | One user learning interaction structurally requires plan revisions, contracts and anchors to exist |
| T7 | Monolithic `persistence/models.py` | one file, 2,503 L, 61 tables | Copying "the models file" to get three infrastructure tables imports the entire abandoned domain. **The most likely accidental-contamination vector in the whole transition.** Split by bounded context in the new repo |
| T8 | Linear 10-migration chain rooted at `20260827_0001` | `migrations/versions/` | Any migration reuse drags its ancestors. The new repo needs a fresh root revision, not a rebased legacy chain |
| T9 | `BookStatus` imported by `parsing/repository.py`, `knowledge/repository.py`, `knowledge/service.py` | import map | Cheap to sever, but shows how a small shared enum quietly wires modules together |
| T10 | `books/service.py` line 18 imports `knowledge.contracts.KNOWLEDGE_TASK_TYPES` | that line | A Phase-02 service reaching forward into Phase 04 to cancel downstream work on delete. Sever at port time |
| T11 | `health.py` imports `references.index` | that import | A "project health" module depending on the embedding index. Do not reproduce |

---

## 8. Test & Fixture Reuse

Baseline: the most recent full run (`.pytest-phase09-all.out`, 2026-08-31) records **1 failed, 320 passed, 2 skipped in 78.14 s**. The single failure is `tests/test_repository_safety.py::test_phase_08_plus_packages_are_not_present`, a Phase-boundary guard asserting that a `reader` package does not exist — it broke when Phase 09 legitimately created one. It is a governance guard that outlived its phase, and a clean illustration of the "tests encoding obsolete product boundaries as if they were infrastructure invariants" category.

### Worth porting — validates generic capability

| Test file | LOC | Classification | What it actually proves |
|---|---|---|---|
| `tests/test_tasks.py` | 201 | **REUSE_AS_IS** | Single-winner claim under concurrency; crash-before-submit rediscovery; durable dispositions; checkpoint atomicity; corrupt-newest fallback; unsupported schema version rejected; worker isolation |
| `tests/test_llm_boundary.py` | 465 | **REUSE_AS_IS** | Provider substitutability; structured-output validation; finite retry and its exhaustion bound; user-action bypass of retry/breaker; breaker open → fail-fast → single-probe recovery; failed-probe reopen; probe release on four distinct non-evidentiary exits; abandoned-lease reclamation after restart; budget blocking before the provider call; unknown usage stays reserved; **provider wait holds no DB transaction** |
| `tests/test_persistence.py` (subset) | ~150 of 411 | **SELECTIVE_PORT** | Repeatable empty upgrade at head; FK enforcement; transaction rollback; stable IDs + injectable user scope; bounded SQLite contention and typed timeout. **Exclude** the four cross-phase upgrade tests (`test_phase_02_database_upgrades_to_phase_07…`, `test_phase_04_upgrade_to_phase_08…`, `test_phase_03_database_upgrades…`, `test_migration_has_phase07_generation_tables_and_no_phase08_plus_tables`) — they assert legacy schema evolution |
| `tests/test_books.py` | 551 | **SELECTIVE_PORT (most of it)** | Streamed intake with partial-temp cleanup; rejected input creates nothing; cleanup grace windows; concurrent reconcilers deleting each orphan at most once; reconciler never removing in-flight publication; two concurrent intakes path/identity isolated; delete/handoff race convergence; delete failure retryable; concurrent delete converging on one tombstone; **file I/O outside DB transactions**; managed-path escape rejected. **Exclude** `::test_reserved_dataset_identity_is_unique` |
| `tests/test_logging_setup.py` | 43 | **REUSE_AS_IS** | Event field surfacing and secret redaction by value and by field-name semantics |
| `tests/test_config.py` | 106 | **ADAPT** | Safe defaults; single env boundary; clear failure on invalid optional settings; numeric bounds. Phase-specific field assertions drop out |
| `tests/test_repository_safety.py` | 76 | **SELECTIVE_PORT** | Keep `::test_local_env_files_are_ignored_but_example_is_preserved` and `::test_env_example_contains_no_secret_assignment` (real repo-hygiene guards). **Discard** `::test_phase_08_plus_packages_are_not_present` (the failing obsolete guard) and `::test_unapproved_major_retrieval_and_planning_dependencies_are_not_declared` (legacy governance) |
| `tests/test_parsing.py` (subset) | ~200 of 637 | **SELECTIVE_PORT** | Checkpoint resume skipping persisted pages; resumability before the first page; rebuild cannot replace canonical; rebuild crash-resume reuses one identity-checked candidate; delete racing a running parser cancels and cannot publish; delete cancellation beats a late failure disposition; asset reconciliation respects grace and references; parser wait holds no DB transaction. **Exclude** `::test_ocr_payload_cannot_be_promoted_to_exact_original`, `::test_database_rejects_contradictory_exact_and_derived_payload`, `::test_phase03_schema_contains_no_phase04_tables` |
| `tests/conftest.py` | 20 | **REUSE_AS_IS** | `migrated_database` fixture over a tmp-path SQLite URL with a real Alembic upgrade — the right default for a migration-first project |

**Portable test volume: roughly 1,600 LOC of 11,577 (≈14%).**

### Not worth porting — encodes Product V1 behavior

`tests/test_knowledge.py` (872), `tests/test_references.py` (1,026), `tests/test_bge_embedding.py` (140, both skipped by default), `tests/test_planning.py` (1,532), `tests/test_generation.py` (1,985), `tests/test_review.py` (1,416), `tests/test_reader.py` (297), `tests/test_reader_closure.py` (1,462), `tests/test_parser_adapter.py` (227), most of `tests/test_health.py` (110). Total ≈ 9,000 LOC. **REFERENCE_ONLY** — several encode reasoning worth re-reading when designing the analogous new mechanism (notably the planning-fix remap tests and the review disposition-completeness tests), but none should be ported.

### Fixtures and real assets

| Asset | Verdict |
|---|---|
| `408-ai-ebook-samples/phase03/primary/…第1-29页.pdf`, `phase04/dma/…第320-348页.pdf`, `phase03/notes/runtime-validation-11-pages.pdf` | **REUSE_AS_IS**, kept external. Real scanned 408 material with known characteristics (all-scan, figures, tables, formula-heavy regions) — immediately useful for benchmarking a word/line OCR pipeline |
| `phase03/parser-runtime-venv` (1.4 GiB), `phase03/model-cache` (505 MiB) | **REUSE_AS_IS (conditional)** on the OCR-engine decision; otherwise archive |
| `var/ai_ebook.db` + `var/storage/books/6aeee9f8-…/` (accepted ParseRun `85b59562-…`, 720 SourceBlocks, 15 PNGs) | **DISCARD_ARCHIVE, retain read-only.** The only real OCR-output corpus available for quality comparison |
| `tools/reader-harness/var/dma-ocr-experiment.db` + `dma-ocr-experiment-run.json` | **REFERENCE_ONLY.** 78 byte-equal transcriptions, 0 mismatches, human acceptance still `PENDING` |
| Synthetic fixture lineage (`tools/reader-harness/seed_fixture_lineage.py`) | **DISCARD_ARCHIVE.** Hand-typed textbook-like prose traceable to no PDF — the experiment document says so itself |
| `var/pytest-*`, `.pytest-*` directories | **DISCARD.** Local run artifacts, untracked |

---

## 9. Legacy Contamination Risks

Ranked by likelihood × damage.

**R1 — Copying `persistence/models.py` to obtain the three infrastructure tables.** *(Highest.)* One file, 61 tables. The three you want are the first ~100 lines; everything after is the abandoned domain. Mitigation: hand-transcribe only `InfrastructureTaskRow`, `InfrastructureCheckpointRow`, `ProviderCircuitRow` and `utc_now` into a new per-context module layout; never copy the file.

**R2 — Porting Phase 02 Book intake without deleting `reserved_knowledge_dataset_id`.** The column is `NOT NULL UNIQUE` and its uniqueness is a *tested invariant*. It looks like harmless bookkeeping and would survive review. Mitigation: delete the column, the `BookSnapshot` field, the mint in `BookService.intake`, and `test_reserved_dataset_identity_is_unique`.

**R3 — Porting migration `0003` "for the page geometry".** `source_pages` is genuinely useful; it sits in the same migration as `source_blocks` with its four classification CHECK constraints and `document_sections.title_source_block_id`. Mitigation: author a new migration containing only page geometry; do not copy any legacy migration file.

**R4 — Keeping `SourceBlock` as an internal "OCR chunk" under a new name.** The strongest failure mode, because it is *reasonable*: OCR does produce chunks. But §6 makes word+line the core and paragraph *derived on demand*; a persistent intermediate block object re-creates the SourceBlock hierarchy under a different label and, once §8 anchors or KP ranges reference it, becomes permanent. Mitigation: persist word and line geometry; derive anything paragraph-like at query time.

**R5 — Carrying `docs/08-ui/**` into the new repository as "the UI design we already did".** These files are stamped non-authoritative and derived from `SYSTEM_BLUEPRINT_V4`; `DESIGN_HARD_BOUNDARIES.md` enumerates the legacy persistence model as a boundary designers must not exceed, and `READER_STRUCTURE.md` builds navigation on `KP → Segment → Render Nodes`. Importing them re-imports the abandoned model through the design surface. Mitigation: archive; extract typography/palette only.

**R6 — Reusing `StableSemanticAnchor` because "progress needs a sub-KP handle".** §11 already answers this: if two things need independent understanding state, they are two KPs. Anchors would immediately appear in durable user data (`user_progress`), which is the hardest place to remove them from later.

**R7 — Copying `health.py` for its SQLite/migration health check.** Its `AUTHORITATIVE_DOCUMENTS` tuple would re-establish the legacy authority chain as an executable, test-enforced contract, directly against §0.1's two-document strategy. Mitigation: extract `sqlite_health` + migration-head comparison only.

**R8 — Porting `tests/test_persistence.py` wholesale.** Four of its tests assert legacy cross-phase schema evolution and would either fail or, worse, be "fixed" by re-creating legacy tables.

**R9 — Reusing `ReaderSessionService` scope/overlap logic for Section navigation.** It looks like navigation but is generation-conflict arbitration keyed on KP sets, and it requires a `generation_lineage`. §19 forbids navigation waiting on generation at all.

**R10 — Treating the DMA experiment's `EXPERIMENTAL_OCR_ORIGINAL_OVERRIDE` projection as a precedent for OCR-as-ORIGINAL.** The experiment document explicitly forbids promotion (§2: its evidence label "≠ formal ORIGINAL-integrity PASS"; §15 non-goals include "global promotion of OCR to `EXACT_SOURCE_TEXT`"). In the new product §2 makes the PDF the reading authority and §7 makes OCR a correctable machine layer — the question does not arise, provided nobody re-imports the projection mechanism as a feature.

**R11 — Reviving Phase 05 retrieval because "we already have embeddings".** §38 defers past-exam RAG; §21 makes V1 ExamTopic lightweight 命题追踪 metadata. Porting the corpus/chunk/embedding/association model would build a deferred subsystem and add `torch`/`transformers` to a project that may not need them.

**R12 — Carrying `CODEX_MASTER_INSTRUCTION.md` unmodified.** It declares a seven-tier authority chain rooted in documents the new project archives. Its process rules are worth keeping; its chain must be replaced.

---

## 10. Recommended New-Project Seed

Conceptual only. **Not executed.** Execution belongs to `LEGACY_TRANSITION_PLAN.md` after approval.

**Create a clean repository at `D:\codex\408-guided-reader` with an independent Git history, and port the following from the commits named — file by file, never by directory copy.**

### Tier 1 — port essentially as-is (source commit `98dc70d`)

```
persistence/engine.py          # edit 1 line: the "Product V1" wording
persistence/base.py  ids.py  errors.py  user_scope.py
persistence/migrations.py
migrations/env.py  migrations/script.py.mako
tasks/contracts.py  repository.py  service.py  runner.py  checkpoints.py
llm/contracts.py  errors.py  provider.py  gateway.py  breaker.py  budget.py
logging_setup.py
tests/conftest.py  tests/test_tasks.py  tests/test_llm_boundary.py  tests/test_logging_setup.py
```

### Tier 2 — port with named edits (source commit `69dd323`)

```
books/storage.py               # as-is
books/contracts.py             # remove reserved_knowledge_dataset_id; revisit parse_task_id cardinality
books/repository.py            # remove the dataset reservation
books/service.py               # remove the dataset mint; remove the knowledge.contracts import;
                               # replace one-parse-task-per-Book with bounded page-batch preparation work
tests/test_books.py            # minus test_reserved_dataset_identity_is_unique
```

### Tier 3 — port selected units (source commit `c68f3a6`)

```
parsing/native.py                        # as-is
parsing/contracts.py    → BBox only
parsing/adapter.py      → probe-before-backend routing invariant only
parsing/storage.py                       # as-is mechanism, repurposed as on-demand crop cache
parsing/service.py      → per-page resumable persistence loop pattern only
tests/test_parsing.py   → lifecycle / resume / delete-race / asset-reconciliation subset
```

### Tier 4 — adapt

```
pyproject.toml  alembic.ini                     # rename package; re-decide parser/embedding extras
config.py                                       # keep the pattern; redesign the field set
__main__.py                                     # keep the CLI skeleton; drop every legacy subcommand
health.py → sqlite_health + migration-head check only
.agents/role-bindings/*  .agents/COWORK.md      # rewrite authority-chain references
CODEX_MASTER_INSTRUCTION.md                     # keep §3/§6/§7/§9; replace the authority chain with
                                                # PRODUCT_BLUEPRINT.md → IMPLEMENTATION_BLUEPRINT.md
tools/dev-review/*.ps1                          # process tooling, product-neutral
```

### Tier 5 — author fresh (no legacy source exists)

Migration `0001` for the new project; word/line OCR geometry; Stable Outline with physical ranges (§9); figure/table geometry without permanent crops (§10); on-demand PDF render/crop (§10); OCR error reporting and manual correction (§7); foundation versioning with dependent-artifact remap (§7.1); Notes/Highlights geometry+quote anchoring (§8); the KP model with one primary Section and a continuous range (§12–13); lazy Chapter Preparation (§14); the Section teaching layer (§17); Reading Position independent of AI artifacts (§35); Learning History (§29); Assistant and Master (§24, §26); PDF serving to the Reader (§2).

### Explicitly leave behind

All of `knowledge/`, `references/`, `planning/`, `generation/`, `review/`, `reader/`; migrations `0004`–`0010`; the `source_blocks` / `document_sections` half of `0003`; `docs/01-product/`, `docs/07-review/`, `docs/00-master/`, `docs/08-ui/`; `tools/reader-harness/`; `var/`.

### Archive (keep readable, never import)

The entire `408-ai-ebook` repository as a read-only historical record; `var/ai_ebook.db` + `var/storage/` as the real-OCR evidence corpus; `PHASE_0X_IMPLEMENTATION_REPORT.md`; `PHASE_04_DMA_CALIBRATION_LEDGER.md`; `DMA_OCR_EXPERIMENT.md` and its run record.

### Keep external and unchanged

`D:\codex\408-ai-ebook-samples\**` — real textbook PDFs, model cache, parser venv. Preserve the legacy project's discipline: **no textbook content inside any repository.**

---

## 11. Inputs for LEGACY_TRANSITION_PLAN

Factual decisions and evidence a later transition plan will need.

**Recommended source commits**
- Foundation: `98dc70d` — *fix: complete phase 01 runtime recovery and final validation* (2026-08-27)
- Book intake/storage: `69dd323` — *feat: complete phase 02 book intake and lifecycle* (2026-08-28)
- Parser probe / storage / resume patterns: `c68f3a6` — *feat: complete phase 03 primary parsing foundation* (2026-08-29)
- Archive reference: `7daa78e` (HEAD)

**Files/modules to port** — see §10 Tiers 1–3 (≈20 source files, ≈6 test files, ≈2,000–2,400 src LOC + ≈1,600 test LOC).

**Files/modules to leave behind** — see §10 "Explicitly leave behind" (≈18,000 src LOC, ≈9,000 test LOC, 50 of 61 tables, 7 of 10 migrations).

**Mandatory edits at port time** (each a discrete, verifiable transition step)
1. Remove `books.reserved_knowledge_dataset_id` (column, contract field, repository writes, service mint, test).
2. Remove `books/service.py` line 18 `from ai_ebook.knowledge.contracts import KNOWLEDGE_TASK_TYPES`.
3. Replace one-parse-task-per-Book with bounded page-batch preparation work (§4.2).
4. Split `persistence/models.py` by bounded context; transcribe only the three infrastructure tables.
5. Author a fresh migration root; do not rebase the legacy chain.
6. Strip `AUTHORITATIVE_DOCUMENTS` from `health.py`; drop its `references.index` import.
7. Remove the `"Product V1 database URL must use SQLite"` wording from `persistence/engine.py`.
8. Drop `tests/test_repository_safety.py::test_phase_08_plus_packages_are_not_present` (currently failing) and `::test_unapproved_major_retrieval_and_planning_dependencies_are_not_declared`.
9. Rewrite the authority chain in `CODEX_MASTER_INSTRUCTION.md` and `.agents/**` to `PRODUCT_BLUEPRINT.md → IMPLEMENTATION_BLUEPRINT.md`.
10. Rename the Python package (`ai_ebook` → the new project package) across every ported file.

**Historical documents worth retaining as archive/reference only**
`PHASE_01/02/03_IMPLEMENTATION_REPORT.md` (real runtime/memory/dependency-license evidence); `PHASE_04_DMA_CALIBRATION_LEDGER.md` (real KP-granularity decisions); `DMA_OCR_EXPERIMENT.md` + `dma-ocr-experiment-run.json` (OCR quality protocol, caption rule, "no real provider adapter"; retain its printed-page section **only** alongside the §4.3 correction notice, since its `UNKNOWN` conclusion is superseded); `INTERACTION_HARNESS_SCOPE.md` / `INTERACTION_HARNESS_ACCEPTANCE.md` (zero-dependency validation-harness precedent); `docs/03-skills/*.md` (four-Agent boundary thinking); `SYSTEM_BLUEPRINT_V4.md` + `V4_DECISION_REGISTER_REV3.md` (superseded — archive so past decisions remain traceable, never as authority).

**Unresolved technical questions genuinely requiring a later decision** *(each blocks `IMPLEMENTATION_BLUEPRINT.md`; none blocks the transition plan)*
1. **OCR engine and granularity.** How to obtain word+line boxes (§6). Options: RapidOCR driven directly rather than through Docling's document model; a different OCR engine; PDF text-layer word extraction for native pages with OCR only for scanned ones. Legacy evidence: all 29 sample pages were scan-only; a full Docling+RapidOCR pass costs ~117 s / ~1.1 GiB.
2. **PDF render/crop engine** (§10; §39 unfrozen). Nothing exists in the legacy repo. The choice interacts with (1) and with the Reader front-end.
3. **Is Docling retained at all?** If not, `parser-runtime-venv` and `model-cache` (1.9 GiB external) become archive, and the `parser` extra disappears.
4. **Progressive-preparation unit of work.** Per page, or bounded batch? Determines the task payload shape and checkpoint granularity (§4.2 permits either).
5. **Geometry normalization** (§39 explicitly unfrozen). Legacy stores raw PDF units with a `coordinate_origin`; §8 speaks of *normalized* page geometry.
6. **Foundation-version remap algorithm** (§7.1; §39 explicitly unfrozen). The legacy planning-fix remap is the only precedent and uses the wrong keys.
7. **Is the OCR quality good enough to carry the product?** `DMA_OCR_EXPERIMENT.md` §12 criterion 8 is the open human judgement, and the run record still says `"human_acceptance_criteria": "PENDING HUMAN RECORD"`. Recommend answering this on the retained DMA data *before* freezing §6/§7 implementation — it is cheap and directly informs (1).
8. **First real provider adapter.** None exists. Which provider(s), and how §16's "genuinely different model/provider" reviewer independence is satisfied in practice.
9. **Reader front-end technology** (§39 unfrozen). The legacy harness is a deliberately disposable stdlib server; the new product needs a real PDF reading surface.
10. **Repository/package naming**, and whether `408-guided-reader` starts as `git init` or as an orphan branch in a shared repository.

---

## 12. Audit Confidence / Unknowns

| Claim | Confidence |
|---|---|
| History is 22 commits on `main`; HEAD `7daa78e`; phase checkpoints as listed in §3 | **CONFIRMED_BY_GIT** (`git log`, `git ls-tree`, `git show`) |
| `models.py` table growth 3 → 5 → 10 → 19 → 27 → 42 → 48 → 56 → 61 across phases | **CONFIRMED_BY_GIT** (`git show <c>:… | grep -c __tablename__`) |
| At `98dc70d` the schema is exactly `infrastructure_tasks`, `infrastructure_checkpoints`, `provider_circuits` | **CONFIRMED_BY_GIT** |
| At `98dc70d`, `health.py` imports only `persistence.*` (no `references`) | **CONFIRMED_BY_GIT** |
| `books.reserved_knowledge_dataset_id` is `NOT NULL UNIQUE` from migration `0002` | **CONFIRMED_BY_CODE** (migration file + `git show 69dd323:src/ai_ebook/persistence/models.py`) |
| `source_blocks` CHECK constraints encode extraction classification in the schema | **CONFIRMED_BY_CODE** (`models.py` `__table_args__`) |
| `DoclingLayoutParser` emits item-level blocks; no word or line geometry anywhere | **CONFIRMED_BY_CODE** (`parsing/adapter.py`; `grep` for word/line geometry in `src/ai_ebook/parsing/` → 0 hits) |
| `page_label` is fabricated as `str(page_index + 1)` | **CONFIRMED_BY_CODE** (`parsing/adapter.py`, page assembly loop) |
| `ORIGINAL_REFERENCE` nodes carry `SourceBlockRow.exact_text` as the Reader body | **CONFIRMED_BY_CODE** (`reader/projection.py::_payload`) |
| `ebook_sessions.generation_lineage` is a NOT NULL FK to `generation_tasks`; `reading_position` is a generated node id | **CONFIRMED_BY_CODE** (`models.py` `EbookSessionRow`; `reader/service.py::navigate`) |
| `user_progress` is uniquely keyed by `(user_scope, knowledge_point_id, anchor_id)` | **CONFIRMED_BY_CODE** (`models.py` `UserProgressRow`) |
| No concrete real LLM provider adapter exists | **CONFIRMED_BY_CODE** (`grep` for openai/anthropic/httpx/requests over `src/` → 0 hits) + **CONFIRMED_BY_TEST** (`DMA_OCR_EXPERIMENT.md` §9; run record `"ai_genuinely_wraps_original": "NOT RUN"`) |
| No word/line geometry, notes/highlights, OCR correction path, PDF render/crop, Assistant, Master, or Learning History exists | **CONFIRMED_BY_CODE** (targeted greps over `src/`) |
| Latest full test run: 1 failed / 320 passed / 2 skipped in 78.14 s; the failure is the obsolete phase-boundary guard | **CONFIRMED_BY_TEST** (`.pytest-phase09-all.out`, run 2026-08-31) |
| Task/checkpoint/breaker/budget behaviors listed in §4.1 | **CONFIRMED_BY_TEST** (`tests/test_tasks.py`, `tests/test_llm_boundary.py` — named tests cited inline) |
| Storage safety behaviors listed in §4.2 | **CONFIRMED_BY_TEST** (`tests/test_books.py` — named tests cited inline) |
| Phase 03 real-corpus figures (29/29 OCR route; 639 blocks; 117.1 s; ~1,149 MiB RSS) | **CONFIRMED_BY_CODE** (`PHASE_03_IMPLEMENTATION_REPORT.md`, a repository artifact) — *not independently re-measured in this audit* |
| DMA experiment results (78 byte-equal transcriptions, 0 mismatches, canonical DB hash unchanged, caption rule 15/15) | **CONFIRMED_BY_CODE** (`tools/reader-harness/var/dma-ocr-experiment-run.json`, `DMA_OCR_EXPERIMENT.md`) — *not re-executed* |
| Printed-page labels are recoverable (DMA 28/29 at a sample-specific +308; primary 16/29 at −11; parity verified) | **CONFIRMED_BY_TEST** (`OCR_FOUNDATION_CALIBRATION.md` §3.G, executed 2026-09-03 over both full sample PDFs). **This row supersedes the audit's original `printed_page_label: UNKNOWN` claim**, which was CONFIRMED_BY_CODE against a legacy artifact that had itself lost the data. A correct citation of a pipeline whose input was already filtered is not evidence about the book — recorded here as a methodological lesson for future audits |
| Reuse volume ≈11% of src / ≈14% of tests | **INFERRED** — a per-file judgement roll-up, not a measurement |
| "A clean repo costs less than forking `98dc70d`" | **INFERRED** — reasoned from the file/edit counts in §10, not empirically timed |
| ~~Docling *cannot* be coaxed into emitting word/line geometry through some other API~~ | **RESOLVED / MOOT (2026-09-03)** — `OCR_FOUNDATION_CALIBRATION.md` selected RapidOCR direct as the OCR core, so Docling is no longer the OCR engine and the question no longer gates anything. Docling survives only as an optional preparation-time FIGURE/TABLE layout detector |
| ~~Whether the 5 modified tracked files contain unreviewed work worth porting~~ | **RESOLVED (2026-09-03)** — all five diffed read-only; see `LEGACY_TRANSITION_PLAN.md` §3. Two carry a standing external-reviewer disclosure authorization (generic, worth carrying forward as a principle); three record formal user acceptance of Phases 01–03 pinned to commits `98dc70d` / `69dd323` / `c68f3a6` — the same three commits this audit named as port sources |
| Whether every one of the 320 passing tests still passes today | **UNKNOWN** — the recorded run is from 2026-08-31 and the working tree has changed since. No test run was performed during this audit (read-only mandate) |
| Real behavior of the `generation/`, `planning/` and `review/` repositories beyond their contracts and services | **INFERRED** — ~4,000 LOC of repository code in those packages was surveyed by structure and imports rather than read line by line. All are classified DISCARD/REFERENCE_ONLY, so deeper reading would not change a port decision |

---

**End of LEGACY_REUSE_AUDIT — evidence artifact, authority tier NONE.**
