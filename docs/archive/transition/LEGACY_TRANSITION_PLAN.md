# LEGACY_TRANSITION_PLAN

## 1. Status / Authority

**Status: DRAFT FOR USER REVIEW — NOT EXECUTION AUTHORITY.**
Nothing in this document authorizes creating a repository, copying a file, deleting anything, or touching Git.

| | |
|---|---|
| Document type | Temporary transition authority for legacy retirement + new-project seeding |
| Authority tier | Below `PRODUCT_BLUEPRINT.md`. Above nothing until the user accepts it. |
| Date | 2026-09-03 |
| Primary inputs | `PRODUCT_BLUEPRINT.md` (product authority) · `LEGACY_REUSE_AUDIT.md` (as amended 2026-09-03) · `OCR_FOUNDATION_CALIBRATION.md` (accepted) |
| Legacy repo | `D:\codex\408-ai-ebook` @ `main`, HEAD `7daa78e`, 22 commits, 5 modified tracked files, ~25 untracked paths |
| New repo | `D:\codex\408-guided-reader` — **does not exist yet; still empty** |
| Lifespan | Delete or archive this document once the transition is executed and `IMPLEMENTATION_BLUEPRINT.md` is frozen. It must never become cold-start reading. |

**Transition principle.** Legacy is an evidence library, not an asset package. Sunk cost, code volume, completed-Phase status and prior effort carry **zero** architectural authority. Every candidate is judged by: *if the legacy repository did not exist, what would we build?* — then: *does the legacy implementation objectively improve that?* Reusing very little is an acceptable and expected outcome.

> ### Ordering invariant (governs this entire document)
>
> **Legacy reuse candidates must not determine the new engineering architecture.**
>
> `LEGACY_REUSE_AUDIT.md` and `OCR_FOUNDATION_CALIBRATION.md` identify **candidate** reusable
> capabilities and supply evidence about them. They do **not** authorize source-code porting.
>
> The question *"if the legacy repository did not exist, what engineering architecture would we
> choose?"* must be answered — and frozen in `IMPLEMENTATION_BLUEPRINT.md` — **before** any legacy
> code enters the new repository.
>
> `IMPLEMENTATION_BLUEPRINT.md` is explicitly entitled to **reject, reshape, split, merge or
> re-scope any candidate** in §5, including the highest-confidence ones. A candidate that survives
> does so because the frozen architecture asked for something that shape — never because it already
> exists and passes tests.
>
> Every "PORT" classification in this document therefore reads **PORT CANDIDATE** until gate **D**
> (§14) is cleared.

---

## 2. Transition Verdict

**Clean `git init` at `D:\codex\408-guided-reader` + selective port. Do not fork, clone, or orphan-branch any legacy checkpoint.**

Legacy commit SHAs are **provenance citations**, not ancestry. The new project's history starts at its own root commit.

Candidate scale, measured in the audit and calibration. These are **upper bounds on what may be proposed**, not commitments — the frozen `IMPLEMENTATION_BLUEPRINT.md` decides the actual figures:

| | Legacy | Port candidate (max) | Share |
|---|---|---|---|
| `src/` LOC | 20,546 | ≤ ~2,000–2,400 | ≤ ~11% |
| Test LOC | 11,577 | ≤ ~1,600 | ≤ ~14% |
| Persistence tables | 61 | ≤ 3 (transcribed, never file-copied) | ≤ 5% |
| Migrations | 10 | **0** — new root revision regardless | 0% |
| Parser/OCR files | 7 | ≤ **1** (`parsing/native.py`) | ≤ 14% |

Only the migrations row is already final: no legacy migration crosses under any architecture.

The calibration *reduced* the expected Phase 03 candidate set from "several files plus patterns" to one file. That is the correct direction of travel and needs no defence. A frozen blueprint that reduces the other rows further is likewise a good outcome, not a loss.

---

## 3. Legacy Repository Final State

**Recommendation: preserve `D:\codex\408-ai-ebook` intact, in place, read-only, as the provenance and evidence archive. Delete nothing.**

Rationale: it is the only record of what was measured (Phase 01–03 runtime/memory/licence evidence, the DMA calibration ledger, the OCR experiment run record) and the only resolvable target for the port-provenance citations in §6. Destructively cleaning obsolete Product V1 code would cost real evidence and buy only cosmetics. Its cost is disk space.

**What changes is status, not content:** from *active product authority* to *frozen historical reference*. After the transition, no legacy document is authority for the new project — not `SYSTEM_BLUEPRINT_V4.md`, not `V4_DECISION_REGISTER_REV3.md`, not `CODEX_GOVERNANCE_V1_FROZEN.md`, not any `PHASE_XX_BRIEF`.

### 3.1 The five pre-existing modified tracked files — inspected read-only

All five were diffed without modification, staging, restore, or commit. **None is accidental or stale.** They fall into two coherent groups.

**Group A — standing external-reviewer disclosure authorization** (a deliberate user policy decision):

| Path | Change | Class | Preserve before archiving? |
|---|---|---|---|
| `.agents/role-bindings/MAIN_FINAL.md` | +21 lines. Adds *"Standing disclosure authorization for configured required reviewers"*: the user permanently authorizes repository-defined review workflows to disclose minimum-necessary active-review context to `CONTRACT_REVIEWER` / `EXECUTION_REVIEWER` without case-by-case approval. Carefully bounded — applies only after the workflow has selected that reviewer class; permits only authority excerpts, Phase artifacts, implementation delta, tests, validation evidence; **never** credentials, keys, tokens, `.env`, private or unrelated content; grants no write/Product/Phase authority; explicitly excludes `EXPERT_REVIEWER`/Grok; and is *disclosure consent, not automatic dispatch*. | **Useful generic principle for the new project** | **Yes** — and carry the *principle* forward (§10 row G7) |
| `.agents/role-bindings/ZCODE_REVIEW_ORCHESTRATOR_FINAL.md` | +14 lines. The reviewer-side mirror of the same authorization, scoped to post-§9 frozen reviewer sets, plus an explicit prohibition list and a **blocker-over-leak rule**: if minimum-necessary context cannot be separated from prohibited content, do not transmit and report the blocker. | **Useful generic principle for the new project** | **Yes** — same principle |

**Group B — formal Phase acceptance records** (legacy governance history, and materially relevant to §6):

| Path | Change | Class | Preserve before archiving? |
|---|---|---|---|
| `docs/05-development-reports/PHASE_01_IMPLEMENTATION_REPORT.md` | Status `PZF-001 CLOSED / USER FINAL ACCEPTANCE PENDING` → `ACCEPTED / COMPLETE`. Records `P0=0, P1=0, blocking=NO`, final accepted P2 count `3` retained as non-blocking debt, and **user acceptance at commit `98dc70dd7fa07c76fce50cf15567d682141e772d`**. | **Important legacy governance/history** | **Yes — highest priority of the five** |
| `docs/05-development-reports/PHASE_02_IMPLEMENTATION_REPORT.md` | Status → `ACCEPTED / COMPLETE`; `P0=0, P1=0, blocking=NO`; **user acceptance at commit `69dd3237962aebcf44a71ae2ed7c6e8c8cb2ee79`**. | **Important legacy governance/history** | **Yes** |
| `docs/05-development-reports/PHASE_03_IMPLEMENTATION_REPORT.md` | Status `READY FOR REVIEW — NOT FINAL ACCEPTED` → `USER ACCEPTED — COMPLETE`; adds **Final Checkpoint `c68f3a6dd1b57585d604cee5b1eb49ed53551b0c`**; replaces "implementation commit created: no" with the checkpoint; records formal acceptance on 2026-08-29. | **Important legacy governance/history** | **Yes** |

**The finding that matters.** The three commits Group B pins acceptance to — `98dc70d`, `69dd323`, `c68f3a6` — are **exactly** the three commits the audit independently selected as port sources. Those commits are therefore not merely "the ones that look cleanest": they are the ones with recorded, review-closed, user-accepted status. This materially strengthens §6, and it was invisible until these diffs were read.

**Risk if not resolved.** This acceptance evidence exists **only in the working tree**. Archive the repository as-is and the Phase 01–03 reports still read "ACCEPTANCE PENDING" / "NOT FINAL ACCEPTED" while the port provenance in §6 asserts they were accepted — a permanent, self-inflicted contradiction in the archive.

**Recommended resolution (requires approval — see §14 gate A):** one bounded documentation/governance closure commit on legacy `main`, e.g. `docs: record user acceptance of Phases 01-03 and standing reviewer disclosure authorization`.

**Exact and exhaustive file list for that commit — five paths, nothing else:**

```
.agents/role-bindings/MAIN_FINAL.md
.agents/role-bindings/ZCODE_REVIEW_ORCHESTRATOR_FINAL.md
docs/05-development-reports/PHASE_01_IMPLEMENTATION_REPORT.md
docs/05-development-reports/PHASE_02_IMPLEMENTATION_REPORT.md
docs/05-development-reports/PHASE_03_IMPLEMENTATION_REPORT.md
```

Staged individually by path — **never** `git add -A`, `git add .`, or `git commit -a`.

**Scope prohibitions (binding):**

- **No untracked content is included merely because it is present.** A file qualifies only if its exact diff has been read and classified as intentional in the table above. All five have been; nothing else has.
- **`.agents/skills/` is explicitly EXCLUDED from this commit.** It is untracked, and only its directory listing was observed (`contract-review`, `execution-review`, `expert-review`, `phase-review`, each with `SKILL.md` + `scripts/run.ps1`) — the file contents were never inspected. Including it would violate the rule above. If it is later judged worth committing, it requires **its own read-only inspection and its own separate approval**, as a separate commit. §3.2 recommends preserving it as filesystem state, which needs no commit at all.
- **No "clean up the working tree" commit.** The ~25 untracked paths (`.pytest-*`, `.tmp/`, `docs/08-ui/**`, `tools/**`) stay untracked and undisturbed.
- **No deletion of obsolete Product V1 code, documents, or data.** The closure commit adds history; it removes nothing.
- **No source, schema, migration, test, or dependency file is touched.** All five paths are Markdown.

**Fallback if the user prefers not to write to legacy at all:** copy the five diffs into the new repo's provenance archive (§11). Inferior, because the acceptance record then lives outside the repository whose commits it certifies — but it is a legitimate choice and blocks nothing.

### 3.2 Untracked paths — disposition

| Path | Disposition |
|---|---|
| `.agents/skills/{contract,execution,expert,phase}-review/` | **Preserve as filesystem state; do NOT commit.** Reviewer skill definitions + `run.ps1`; the executable counterpart of the Group A policy. **Directory listing only was observed — contents never inspected**, so it is barred from the §3.1 closure commit. Committing it would require its own read-only inspection and its own approval. Preservation needs no commit. |
| `tools/dev-review/*.ps1`, `tools/dev-review/tests/` | **Preserve.** Product-neutral process tooling; ADAPT candidate (§10 G7). |
| `tools/reader-harness/` | **Preserve as evidence.** Contains the executed DMA OCR experiment seed + `dma-ocr-experiment-run.json`. REFERENCE_ONLY. |
| `docs/08-ui/**` | **Preserve as evidence, never as authority.** Derived from `SYSTEM_BLUEPRINT_V4`; actively wrong for a PDF-first product (audit R5). |
| `.pytest-*/` (14 dirs), `.pytest-phase09-all.{out,err}`, `.tmp/`, `var/pytest-*/` | **Leave as-is.** Local run artifacts. `.pytest-phase09-all.out` is the only one worth citing (the 1-failed/320-passed baseline); no action needed since nothing is deleted. |
| `var/ai_ebook.db`, `var/storage/books/6aeee9f8-…/` | **Preserve read-only.** The only real-OCR corpus (accepted ParseRun `85b59562-…`, 29 pages, 720 SourceBlocks, 15 PNGs). Never migrated. `var/` is gitignored, so it survives only as filesystem state — do not delete the directory. |

### 3.3 External sample assets — unchanged

`D:\codex\408-ai-ebook-samples\**` stays exactly where it is, outside every repository. Both new and legacy repos reference it by path. **Preserve the legacy discipline: no textbook content inside any repository.** `phase03/parser-runtime-venv` (1.4 GiB) and `phase03/model-cache` (505 MB) are retained pending §14 gate D.2.

---

## 4. New Repository Seed Strategy

```
cd D:\codex\408-guided-reader
git init                      # new root commit; no legacy ancestry
```

No orphan branch, no `git remote add` of the legacy repo, no grafted history. Artificial continuity would imply the new project descends from an abandoned product model — the exact contamination §13 exists to prevent.

Baseline established in **two commits**. No code — legacy-derived or otherwise — is written until `IMPLEMENTATION_BLUEPRINT.md` is frozen (§12).

1. **`chore: project baseline`** — `.gitignore`, `.env.example` (non-secret defaults only), a minimal `pyproject.toml` (packaging metadata + dev tooling only; **no OCR/layout/ML dependency declarations yet** — see §8), `README.md`, empty `src/` + `tests/` roots.
2. **`docs: install project authority`** — `AGENTS.md`, `PRODUCT_BLUEPRINT.md`, and the non-authoritative `docs/archive/` provenance drop.

### 4.1 `PRODUCT_BLUEPRINT.md` transfer — copy, verify, commit, then remove

The intended **final state** is unchanged: exactly one filesystem execution authority, inside `D:\codex\408-guided-reader`. The *mechanics* are deliberately not a literal `mv`, so that no window exists in which the only copy is untracked or in flight:

```
T1. copy    D:\codex\PRODUCT_BLUEPRINT.md  ->  D:\codex\408-guided-reader\PRODUCT_BLUEPRINT.md
T2. verify  sha256 of source == sha256 of destination   (byte-identical; abort on mismatch)
T3. commit  the destination into the new repository
T4. verify  the committed blob matches that same sha256, and the working tree is clean
T5. remove  the temporary D:\codex\PRODUCT_BLUEPRINT.md only after T3 and T4 both succeed
```

*(T-numbers are local to this transfer and unrelated to the §12 execution steps.)*

If any of T1–T4 fails, stop and report: the source copy still exists, so nothing is lost. **T5 is the only file removal anywhere in this plan**, and it removes a temporary staging copy, never content.

The same copy→verify→commit sequence applies to `LEGACY_REUSE_AUDIT.md`, `OCR_FOUNDATION_CALIBRATION.md` and this document as they move into `docs/archive/`.

**Authority-source note.** The Notion mirror of the Product Blueprint remains **long-term project memory and is explicitly non-execution authority**. It is not a competing repository authority and does not violate the one-filesystem-authority rule. Execution authority is the committed file in `408-guided-reader`; where the two ever diverge, the committed file governs execution and the mirror is updated to match.

---

## 5. Selective Port **Candidate** Matrix

> **Every row below is a CANDIDATE, not an authorization.** These classifications record what the
> audit and calibration found and what edits *would* be required. They become actionable only after
> `IMPLEMENTATION_BLUEPRINT.md` is frozen (gate **D**) and each candidate is re-evaluated against it
> (§12 step 5). The blueprint may reject, reshape, split, merge or re-scope any of them — including
> §5.1. Nothing here is architecture.

Classifications: **PORT CANDIDATE** (copy, minimal edits) · **ADAPT CANDIDATE** (rewrite, keep the shape) · **REFERENCE_ONLY** (read while writing fresh; never copy) · **LEAVE_IN_LEGACY** (never crosses under any architecture).

### 5.1 HIGH-CONFIDENCE PORT CANDIDATES — copy with named edits, *if the frozen blueprint asks for them*

| Legacy path | Source commit | Edits required at port time |
|---|---|---|
| `persistence/engine.py` | `98dc70d` | Delete the `"Product V1 database URL must use SQLite"` wording. Keep FK=ON / WAL / busy_timeout pragmas and `DatabaseBusyError` translation. |
| `persistence/base.py`, `ids.py`, `errors.py`, `user_scope.py` | `98dc70d` | None (41 LOC total). |
| `persistence/migrations.py` | `98dc70d` | None. Keep the single-head assertion and `%`→`%%` URL escaping. |
| `migrations/env.py`, `migrations/script.py.mako` | `98dc70d` | Repoint to the new metadata. **`versions/` starts empty.** |
| `tasks/contracts.py`, `repository.py`, `service.py`, `runner.py`, `checkpoints.py` | `98dc70d` | Package rename only. The 8-state lifecycle, single-winner `claim()`, idempotency keys, startup reconciliation, opaque JSON payload, and checksum-validated checkpoint recovery are all product-neutral. |
| `llm/contracts.py`, `errors.py`, `provider.py`, `gateway.py`, `breaker.py`, `budget.py` | `98dc70d` | Package rename. Re-tune budget *numbers* later for §30 Fast/Standard/Deep; the mechanism is unchanged. |
| `logging_setup.py` | `98dc70d` | None. |
| `books/storage.py` (`ManagedBookStorage`) | `69dd323` | None. Keep the commented Windows `\\?\` containment edge case verbatim — it encodes a real bug. |
| `parsing/native.py` (`NativeTextProbe`) | `c68f3a6` | Rehome under the new OCR module. **The only Phase 03 file that crosses.** |
| `tests/conftest.py`, `test_tasks.py`, `test_llm_boundary.py`, `test_logging_setup.py` | `98dc70d` | Package rename. |

**Why "high confidence" and not "approved":** each of these is product-neutral, test-backed, and drawn from a user-accepted commit — which makes them strong candidates, not settled architecture. Concrete open questions the frozen blueprint must answer first: does the new project need a *persistent DB-backed* task substrate at all, or would in-process background work suffice for a local single-user reader? Does the provider gateway's per-task budget model survive §30's per-interaction-mode Fast/Standard/Deep routing? Does `ManagedBookStorage`'s single-immutable-primary-file assumption fit a design with foundation versions and a crop cache? Plausible answers exist in both directions; none is settled here.

### 5.2 ADAPT CANDIDATES — rewrite, keep the shape

| Legacy path | Source | What changes |
|---|---|---|
| `books/contracts.py`, `repository.py`, `service.py` | `69dd323` | **Delete `reserved_knowledge_dataset_id`** (column, snapshot field, mint). **Delete `from ai_ebook.knowledge.contracts import KNOWLEDGE_TASK_TYPES`.** Replace one-parse-task-per-Book with **bounded page-batch preparation work** (§4.2). Keep the ACTIVE/DELETING/DELETE_FAILED/DELETED tombstone and delete-convergence semantics. |
| `config.py` | `98dc70d`+ | Keep the single `pydantic-settings` boundary, `model_validator` bounds, cross-field checks. Drop `reference_embedding_*`, `review_*`; add OCR/render/layout settings. |
| `pyproject.toml`, `alembic.ini` | `98dc70d` | Rename package. **Re-specify extras per §8:** drop `docling`/`docling-parse`/`docling-core`; keep `rapidocr`+`onnxruntime`+`pypdfium2`+`pypdf`; isolate `torch`/`transformers`/`docling-ibm-models` in a `prepare` extra. |
| `__main__.py` | `98dc70d` | Keep the argparse + service-wiring skeleton. Drop every legacy subcommand (`book-sources`, `dataset-*`). |
| `health.py` | `98dc70d` | **Keep only** `sqlite_health` + migration-head comparison. Delete `AUTHORITATIVE_DOCUMENTS` entirely and the `references.index` import. |
| `tests/test_books.py` | `69dd323` | Port minus `test_reserved_dataset_identity_is_unique`. |
| `tests/test_persistence.py` | `98dc70d` | Port ~150 of 411 LOC; **exclude all four cross-phase upgrade tests**. |
| `tests/test_repository_safety.py` | `98dc70d` | Keep the two env-hygiene tests. **Drop `test_phase_08_plus_packages_are_not_present`** (the currently-failing obsolete phase guard) and the legacy dependency-governance test. |
| `tests/test_config.py` | `98dc70d` | Keep the shape; assertions follow the new field set. |
| `.agents/` role bindings, `CODEX_MASTER_INSTRUCTION.md` | `7daa78e`+dirty | Do **not** copy. Extract principles per §10 into one lightweight entrypoint. |

### 5.3 REFERENCE_ONLY — read, then write fresh

`parsing/contracts.py::BBox` (coordinate-origin discipline, ~15 LOC to rewrite) · `parsing/adapter.py` probe-before-backend invariant (2 lines of logic) · `parsing/service.py` per-page resumable loop (skip-persisted → re-verify eligibility → publish → persist → checkpoint → rollback) · `parsing/storage.py` containment/atomic-publish/orphan-reconcile (role changes to a crop cache; the pattern already arrives via `books/storage.py`) · `parsing/repository.py` candidate→accepted partial-unique-index versioning · `knowledge/validation.py` prerequisite-DAG cycle check + canonical-JSON `draft_sha256` · `knowledge/builder.py` strict `extra="forbid"` Static/Provider builder pair · `review/gates.py` deterministic-gates-before-model-call · `review/provider.py` reviewer adapter shape · `review/contracts.py::ProposedReviewIssue` BLOCKING-requires-evidence validator · `review/scheduler.py::project_task_aggregate` · `reader/repository.py::remap_evidence` (wrong keys, right problem — the only §7.1-shaped precedent) · `references/bge.py` pinned-model supply-chain discipline · `knowledge/calibration.py` human calibration-ledger method · `tools/reader-harness/` zero-dependency validation-UI precedent · `tools/phase03-validate-sample.py` external-PDF benchmark template.

### 5.4 LEAVE_IN_LEGACY — never crosses

All of `knowledge/`, `references/`, `planning/`, `generation/`, `review/`, `reader/` · `persistence/models.py` as a file · every migration `0001`–`0010` · `source_blocks`, `document_sections`, and the other 47 obsolete tables · `parsing/adapter.py::DoclingLayoutParser` · `parsing/contracts.py` `ParsedDocument`/`ParsedPage`/`ParsedBlock`/`SourceBlockType`/`ExtractionClassification` · `parsing/repository.py` · `tests/{test_knowledge,test_references,test_bge_embedding,test_planning,test_generation,test_review,test_reader,test_reader_closure,test_parser_adapter}.py` and most of `test_health.py` (~9,000 LOC) · `docs/00-master/`, `docs/01-product/`, `docs/02-engineering/`, `docs/03-skills/`, `docs/04-phases/`, `docs/07-review/`, `docs/08-ui/` · `var/`.

---

## 6. Source Commit Provenance

Provenance is recorded **in commit messages**, never in Git ancestry.

| Commit | Role (candidate source) | Acceptance status (from §3.1 Group B) |
|---|---|---|
| `98dc70dd7fa07c76fce50cf15567d682141e772d` | Primary Phase 01 generic foundation — persistence, task/checkpoint substrate, provider gateway/breaker/budget | `ACCEPTED / COMPLETE`, P0=0 P1=0, 3 P2 retained as debt |
| `69dd3237962aebcf44a71ae2ed7c6e8c8cb2ee79` | Phase 02 Book intake / `ManagedBookStorage` | `ACCEPTED / COMPLETE`, P0=0 P1=0 |
| `c68f3a6dd1b57585d604cee5b1eb49ed53551b0c` | Phase 03 — `NativeTextProbe` + REFERENCE_ONLY patterns | `USER ACCEPTED — COMPLETE`, final checkpoint |
| `7daa78e` | Retained legacy HEAD; calibration-era evidence baseline | n/a (archive reference) |

These commits are **evidence of quality and provenance**, not a reuse mandate. Legacy acceptance certifies the code against *Product V1's* contract; it says nothing about fitness for the new architecture. The audit evidence stays fully intact — it simply does not confer authority.

Every port that the frozen blueprint ultimately approves carries a trailer identifying legacy path + commit:

```
feat: add generic task and checkpoint substrate

Ported from legacy 408-ai-ebook src/ai_ebook/tasks/ @ 98dc70d
(Phase 01, user-accepted, P0=0 P1=0). Package renamed; no
behavioural change. Legacy domain model not carried forward.

Legacy-Source: src/ai_ebook/tasks/{contracts,repository,service,runner,checkpoints}.py
Legacy-Commit: 98dc70dd7fa07c76fce50cf15567d682141e772d
```

Legacy file names are **not** binding. Where a cleaner new-project boundary exists (notably the OCR module, which no longer maps onto `parsing/`), rename freely and let the trailer carry the provenance.

---

## 7. Persistence / Migration Transition

**The new repository starts with an empty `migrations/versions/` and authors its own root revision.** No legacy migration is copied, rebased, or squashed. Legacy revision IDs (`20260827_0001` …) never appear.

**Only three tables cross, and by transcription, not by file copy:** `infrastructure_tasks`, `infrastructure_checkpoints`, `provider_circuits`. Hand-transcribe those three classes into a **per-bounded-context module layout** — `persistence/models.py` as a single 2,503-line, 61-table file is audit risk **R1**, the most likely accidental-contamination vector in the whole transition. There is no ported "models.py".

The new domain (page geometry, OCR lines, fine-grained selection cells, figure/table regions, printed-page mapping, Outline with physical ranges, KP with one primary Section, Section teaching layer, Notes/Highlights, Reading Position, Learning History) is designed in `IMPLEMENTATION_BLUEPRINT.md`. **This plan deliberately does not design it.**

Structural rules carried forward as *design guidance only*: candidate→accepted with a partial unique index (`sqlite_where="status='ACCEPTED'"`); optimistic `version` columns; opaque-JSON task payloads; checksummed checkpoints.

Traps that must not cross (audit T1–T11), each becoming a gate in §13: `reserved_knowledge_dataset_id` · `source_blocks` classification CHECK constraints · `document_sections.title_source_block_id` · `ebook_sessions.generation_lineage NOT NULL FK` · `user_progress UNIQUE(user_scope, kp_id, anchor_id)` · `session_anchor_evidence`'s four-way legacy FK.

---

## 8. OCR / Layout Transition

Per the accepted calibration. **No legacy OCR/layout code is a candidate to cross except `NativeTextProbe`.** The OCR/layout stack itself is designed fresh in `IMPLEMENTATION_BLUEPRINT.md`; the calibration supplies its evidence and its measured cost, not its code.

| Layer | Decision | Cost (200 DPI, CPU) |
|---|---|---|
| Page render | `pypdfium2` — also serves §10 on-demand crops | 0.06–0.08 s/page |
| Text-layer triage | **PORT CANDIDATE** — `NativeTextProbe` (`c68f3a6`) | negligible |
| **OCR core** | **RapidOCR direct** (PP-OCRv6 det+cls+rec via onnxruntime). Not Docling. | 2.24 s/page · **31.7 MB** bundled ONNX |
| **Layout helper** | **`docling_ibm_models.layoutmodel.LayoutPredictor` standalone**, conf ≥ 0.5 + overlap-merge, FIGURE/TABLE/Caption/Page-header only. Optional, preparation-time only. | 0.79 s/page · 164 MB + torch 527 MB + transformers 113 MB |
| Full pipeline | ~3.0 s/page — **~25% faster than legacy Docling's 4.04 s/page**, and strictly more capable | |

**Geometry model** (blueprint §6 as amended today): persist **`Line`** as the authoritative detected object and **`Char`** cells as a derived per-line array. A selection is a contiguous char range within one line, materialized on demand. **Do not persist a `Word` entity** — measurement showed the engine returns 99.8% single characters, with x interpolated from CTC column index and y inherited from the line. Never infer product semantics from a field named `word_results`.

**Printed-page mapping:** implement header-band recovery **per Book / per source revision**, `UNKNOWN` otherwise. The observed `+308` (DMA) and `−11` (primary) offsets are **sample evidence only** and must never become a hard-coded cross-book rule — the two samples disagreeing is itself the proof.

### 8.1 Architecture decision ≠ installation action

These are separate, and the plan authorizes only the first:

| | |
|---|---|
| **Architecture decision (recorded here)** | `docling_ibm_models.layoutmodel.LayoutPredictor` is the **current accepted optional preparation-time layout candidate** for FIGURE/TABLE geometry, on the calibration evidence (7/7 figures, 2/2 tables, 0 false positives at conf ≥ 0.5; the OCR-only alternative scored 0/7). |
| **Installation action (NOT authorized here)** | Declaring or installing `torch` + `transformers` + `docling-ibm-models` (~805 MB) in the new repository. |

**Repository bootstrap must not install the ~805 MB ML stack.** Step 2's `pyproject.toml` carries packaging metadata and dev tooling only. Dependency declaration and install timing — which extras exist, what goes in each, and when they are first required — belong to `IMPLEMENTATION_BLUEPRINT.md` and the implementation phase that first needs layout detection. A repository that cannot be cloned and opened without a multi-hundred-megabyte download has taken on that cost before proving it needs it.

The legacy warm environment (`phase03/parser-runtime-venv`, 1.4 GiB) and model cache (505 MB) remain available **temporarily, as calibration/reference evidence**, outside both repositories. They are not the new project's dependency environment and nothing in the new repo may reference them.

### 8.2 Dependency split — a design constraint for the blueprint

When dependencies are eventually declared, they must be split: a light `serve` path (`pypdfium2`, `pypdf`; tens of MB) versus a heavy `prepare` path (`rapidocr`, `onnxruntime`, `cv2`, and — if approved then — `torch`, `transformers`, `docling-ibm-models`). **The Reader/serving path must never import torch.** Gate §13.12 enforces this once code exists.

**Explicitly dropped:** `docling` + `docling-parse` + `docling-core` + `doclang` (~48 MB) and TableFormer weights (342 MB); SourceBlock authority; `exact_text` as Product authority; Docling-item Product identity; reconstructed-reader assumptions; whole-document `ParsedDocument`; fabricated `page_label=str(idx+1)`; permanent figure PNG extraction.

---

## 9. Test / Fixture Transition

**Do not mechanically copy the suite.** Legacy baseline: 1 failed / 320 passed / 2 skipped (`.pytest-phase09-all.out`, 2026-08-31); the single failure is an obsolete phase-boundary guard that is dropped, not fixed.

Tests follow their capability: a test is a candidate only while the capability it covers is a candidate, and it crosses at step 8 only if gate **D** approved that capability at step 6. A rejected candidate takes its tests with it.

**Port/adapt candidates (≤ ~1,600 of 11,577 LOC):** `test_tasks.py` (single-winner claim under concurrency, crash-before-submit rediscovery, corrupt-newest checkpoint fallback) · `test_llm_boundary.py` (finite retry bound, breaker single-probe recovery, abandoned-lease reclaim, budget-blocks-before-call, provider-wait-holds-no-transaction) · `test_books.py` minus the dataset test (concurrent reconcilers, in-flight publication protection, delete/handoff race convergence, path-escape rejection) · `test_persistence.py` subset · `test_logging_setup.py` · `test_config.py` · `test_repository_safety.py` env-hygiene pair · `conftest.py`.

**Leave in legacy (~9,000 LOC):** `test_knowledge`, `test_references`, `test_bge_embedding`, `test_planning`, `test_generation`, `test_review`, `test_reader`, `test_reader_closure`, `test_parser_adapter`, most of `test_health`. Several encode reasoning worth *re-reading* (planning-fix remap; review disposition completeness) — that is REFERENCE_ONLY, not porting.

**Real fixtures — retain external, unchanged:** `phase03/primary/…第1-29页.pdf` (sha256 `327DA74E…0AA1`), `phase04/dma/…第320-348页.pdf`, `phase03/notes/runtime-validation-11-pages.pdf`. Keep the no-textbook-content-in-repo discipline.

**Calibration evidence promoted to acceptance reference.** The `ocrcal/` harness and its measured results become the OCR acceptance baseline for the new project's implementation phases — 9 representative pages, expected line/char counts, the 34-selection resolution set, the 6-anchor round-trip (IoU > 0.999), 7/7 figures + 2/2 tables at conf ≥ 0.5, and the printed-page recovery rates (28/29, 16/29). Copy the scripts + JSON results into `evidence/ocr-baseline/` alongside the step-3 archive drop — this is evidence, not code, so it is unaffected by gate **E** and is available to inform the blueprint at steps 4–6. It is consumed as an acceptance check at step 9. Note the two known caveats: the round-trip used the same engine version, and the only OCR errors found were in rotated in-figure labels.

---

## 10. Generic Legacy Principle Reference Matrix

Extracted principles only. **No legacy governance document is copied wholesale.** `CARRY_FORWARD` = restate in the new lightweight entrypoint or `IMPLEMENTATION_BLUEPRINT.md`.

| # | Legacy document / path | Generic principle | Why it still helps | Disposition |
|---|---|---|---|---|
| G1 | `CODEX_GOVERNANCE_V1_FROZEN.md` §8; `CODEX_MASTER_INSTRUCTION.md` §10 | **Research external/OSS solutions for large or specialized blocks — not for every task.** Trigger on: large/specialized block · mature production-grade solutions likely exist · self-building creates substantial correctness/parsing/compatibility/maintenance risk · the phase explicitly calls for technology evaluation. Small utilities and ordinary logic: implement directly. *"External research is a tool for high-leverage reuse, not a ritual."* | Directly vindicated by this project: the OCR engine and layout detector are exactly the "large specialized block" case, and the calibration is exactly the evaluation this rule asks for. Remaining unknowns (ONNX layout build) are of the same shape. | **CARRY_FORWARD** |
| G2 | `CODEX_GOVERNANCE_V1_FROZEN.md` §6.1; `CODEX_MASTER_INSTRUCTION.md` §7.3 | **Adopting a major/core external project requires fit analysis + user approval** — repo, intended use, what is reused, maintenance state, licence risk, integration cost, lock-in/replacement risk, architectural impact, self-build alternative. Not for every small library. | torch (527 MB) and the heron layout model are precisely this class. §14 gate D.1 is this rule in action. | **CARRY_FORWARD** |
| G3 | `CODEX_MASTER_INSTRUCTION.md` §6 | **Freeze invariants, not implementation trivia.** Module organization, naming, helpers, local algorithms, test layout are reversible engineering decisions — decide and proceed. | Keeps `IMPLEMENTATION_BLUEPRINT.md` from becoming the six-document stack again. The legacy `DEVELOPMENT_SPEC_V1.md` (25 sections of frozen schema) is the counter-example to avoid. | **CARRY_FORWARD** |
| G4 | `CODEX_GOVERNANCE_V1_FROZEN.md` §14 | **Each phase produces one concise development report** recording objective, capabilities, real architecture choices, changed modules, schema changes, validation performed, known limitations/debt, dependencies adopted, plan deviations, handoff notes. *"Both a human-readable log and future-AI maintenance context. Not a source dump."* | The single highest-value legacy artifact class. The Phase 01–03 reports are why this transition could cite real runtime, memory and licence evidence instead of guessing. | **CARRY_FORWARD** |
| G5 | `CODEX_GOVERNANCE_V1_FROZEN.md` §12 | **Test priority order:** frozen invariants → state transitions → idempotency → retry boundaries → persistence consistency → authority/ownership → failure recovery. Behavioural confidence over prescribed file counts; tests need not mirror document structure. | Explains why the ported tests are worth porting and why 9,000 LOC of product-semantic tests are not. | **CARRY_FORWARD** |
| G6 | `CODEX_GOVERNANCE_V1_FROZEN.md` §13; `CODEX_MASTER_INSTRUCTION.md` §13; §7.4 | **Meaningful safe Git checkpoints, not commit spam. Destructive Git always requires explicit approval** (`git reset`/`rebase`/`clean`/force-push/history rewrite/mass deletion). | Directly governs this transition (§14 gates A and B). | **CARRY_FORWARD** |
| G7 | `MAIN_FINAL.md` + `ZCODE_REVIEW_ORCHESTRATOR_FINAL.md` (the §3.1 Group A edits) | **Standing, bounded external-reviewer disclosure consent:** minimum-necessary context only; never credentials/keys/`.env`/private/unrelated content; disclosure consent ≠ automatic dispatch; no write or product authority conferred; scoped to a frozen reviewer set; **if minimum-necessary context cannot be separated from prohibited content, do not transmit — report the blocker.** | A genuinely good, reusable AI-collaboration safety pattern, independent of the abandoned product. The blocker-over-leak rule is the strongest part. | **CARRY_FORWARD** |
| G8 | `CLAUDE_PLANNING_WORKER_FINAL.md` §5, §9 | **Drafting is not authorization** — an artifact is a proposal until the user accepts it; never self-mark ACCEPTED/APPROVED/FROZEN. **`reviewer_invocation_failure ≠ PASS`** — never convert an invocation failure into zero findings. Self-checking is part of drafting, not a substitute for independent review. | Prevents exactly the failure mode where an agent's own confidence becomes project truth. This document is a proposal under this rule. | **CARRY_FORWARD** |
| G9 | `.gitignore`, `.env.example`, `tests/test_repository_safety.py` | **Secrets never committed; a non-secret `.env.example` is committed and test-enforced** (`.env` + `.env.*` ignored with `!.env.example`; a test asserts the example contains no secret assignment). | Cheap, already proven, and two of the ported tests enforce it. | **CARRY_FORWARD** |
| G10 | `CODEX_MASTER_INSTRUCTION.md` §3 | **Repository truth over model memory** — inspect the actual repo before planning; never substitute chat history, prior model memory, or an old draft for current state. | The printed-page correction is the case study: an audit trusted a derived artifact instead of the source and got the answer backwards. | **CARRY_FORWARD** |
| G11 | `CODEX_MASTER_INSTRUCTION.md` §7.1/§7.2 | **Named request protocols** for genuinely user-owned decisions (missing input, material ambiguity, OSS adoption, destructive Git) with a discipline rule: *the right to ask is not a requirement to ask frequently*; write `None` when nothing is needed. | Keeps approval gates explicit and rare. §14 uses it. | **CARRY_FORWARD** (simplify to 2–3 request types) |
| G12 | `CODEX_GOVERNANCE_V1_FROZEN.md` §11 | **Technical retry is distinct from content rework**; bounded finite retry, never open-ended loops. | Survives as blueprint §33.2. The ported gateway already implements the technical half. | **CARRY_FORWARD** |
| G13 | `COWORK.md` | Lightweight actor routing map (who drafts / implements / reviews; where findings go) with an explicit **"this file creates no authority tier"** boundary. | Useful *if* multi-agent working continues; the authority-boundary disclaimer is the reusable part. | **REFERENCE_ONLY** |
| G14 | `CODEX_MASTER_INSTRUCTION.md` §2, §4 | Seven-tier authority chain + formal context reload list. | **Superseded.** Blueprint §0.1 mandates two canonical documents. Reproducing this rebuilds the stack the new project exists to escape. | **LEGACY_ONLY** |
| G15 | `docs/04-phases/PHASE_ROADMAP_V1.md`, `PHASE_XX_BRIEF` structure, Phase 00–09 numbering | Formal Brief → Plan → Test Plan → approval → implement → report → acceptance workflow. | The *report* and *acceptance gate* survive as G4/G8. The heavy per-phase document triple and legacy Phase numbering must not: new phases are numbered from the new blueprint (gate §13.8). | **LEGACY_ONLY** (workflow shape: REFERENCE_ONLY) |
| G16 | `docs/01-product/SYSTEM_BLUEPRINT_V4.md`, `docs/07-review/V4_DECISION_REGISTER_REV3.md`, `docs/02-engineering/DEVELOPMENT_SPEC_V1.md`, `docs/03-skills/*.md` | Product V1 semantics. | Superseded by `PRODUCT_BLUEPRINT.md`. Archive so past decisions stay traceable; never authority. Agent-boundary thinking in the Skills docs is REFERENCE_ONLY. | **LEGACY_ONLY** |

---

## 11. Minimal New-Repo Document / Folder Skeleton

```
D:\codex\408-guided-reader\
├─ AGENTS.md                     # AUTHORITY — lightweight entrypoint/router (see below)
├─ PRODUCT_BLUEPRINT.md          # AUTHORITY — copied+verified from D:\codex\ (as amended 2026-09-03)
├─ IMPLEMENTATION_BLUEPRINT.md   # AUTHORITY — DOES NOT EXIST until §12 step 6
├─ README.md
├─ pyproject.toml                # metadata + dev tooling at seed; runtime extras deferred (§8.1)
├─ .gitignore  .env.example      # G9
├─ src/<pkg>/                    # EMPTY until step 7
├─ tests/                        # EMPTY until step 8
├─ migrations/versions/          # EMPTY at seed; new root revision only (§7)
├─ docs/
│   ├─ development-reports/      # G4 — one report per phase
│   └─ archive/                  # NON-AUTHORITATIVE, excluded from cold start
│       ├─ README.md             # "Nothing here is authority. Never cold-start reading."
│       ├─ LEGACY_REUSE_AUDIT.md
│       ├─ OCR_FOUNDATION_CALIBRATION.md
│       ├─ LEGACY_TRANSITION_PLAN.md   # this file, after execution
│       └─ provenance.md         # legacy repo path + the four §6 commits
└─ evidence/ocr-baseline/        # calibration harness + results (§9)
```

### 11.1 Cold-start surface changes in two phases

The required authority surface is **not** a fixed count of files.

**Before `IMPLEMENTATION_BLUEPRINT.md` exists** (steps 3–5) — required reading is **two** files:

```
AGENTS.md
PRODUCT_BLUEPRINT.md
```

This is deliberate and is the whole point of Patch 1: during the window in which the implementation architecture is being designed, the *only* authority is the product, so the architecture is derived from product requirements rather than from available legacy code.

**After `IMPLEMENTATION_BLUEPRINT.md` is reviewed and frozen** (step 6 onward) — required reading is **three** files:

```
AGENTS.md
PRODUCT_BLUEPRINT.md
IMPLEMENTATION_BLUEPRINT.md
```

`docs/archive/` and `evidence/` are **never** mandatory cold-start reading in either phase. They are opened only for transition/provenance work or when a specific evidentiary question arises, and `docs/archive/README.md` says so on its face. A reader who never opens them must still be able to work correctly.

### 11.2 `AGENTS.md` scope

Roughly one page. Its purpose is to **route**, not to specify:

- identify the currently authoritative files, and which of the two phases above is in effect;
- route the coding agent to the right document and section for a given question;
- preserve a small number of critical development/governance invariants — G10 repository-truth-over-memory, G3 freeze-invariants-not-trivia, G8 drafting-is-not-authorization + `reviewer_invocation_failure ≠ PASS`;
- define required approval / development-report / checkpoint behaviour — G11 request protocols, G4 one report per phase, G6 safe-Git and destructive-Git-needs-approval.

**It must not reproduce Product Blueprint or Implementation Blueprint content.** Restating product or engineering rules inside the entrypoint is exactly how the legacy six-document authority stack grew, and it creates a second place for those rules to drift. When `AGENTS.md` and a blueprint disagree, the blueprint governs — and the `AGENTS.md` line that caused the disagreement should be deleted rather than corrected.

---

## 12. Execution Sequence

Each step is separately reportable and stops on failure. **None is authorized yet.**

> **The ordering invariant from §2 governs this table: `IMPLEMENTATION_BLUEPRINT.md` is frozen at
> step 6, and no legacy-derived source code enters the repository before step 7.** Steps 1–5 produce
> documents only.

| # | Step | Produces | Gate |
|---|---|---|---|
| 0 | **Legacy closure.** One bounded documentation commit on legacy `main` covering **exactly the five paths listed in §3.1** — `.agents/skills/` and all other untracked content excluded. Verify HEAD, then treat legacy as frozen reference. | legacy commit | **A** |
| 1 | **Create new repo.** `mkdir` + `git init` at `D:\codex\408-guided-reader`. No remote, no legacy history, no orphan branch. | empty repo | **B** |
| 2 | **Baseline commit.** `.gitignore`, `.env.example`, minimal `pyproject.toml` (metadata + dev tooling only — **no ML/OCR dependency declarations**, §8.1), `README.md`, empty `src/`+`tests/`+`migrations/versions/`. | commit 1 | |
| 3 | **Install authority.** `AGENTS.md`; `PRODUCT_BLUEPRINT.md` via copy→verify→commit→remove (§4.1); `docs/archive/` with the three provenance documents + `provenance.md` + its non-authority README. | commit 2 | **C** |
| 4 | **Answer the architecture question from scratch.** With only `AGENTS.md` + `PRODUCT_BLUEPRINT.md` as authority (§11.1 phase one), derive the engineering architecture the product requires: module boundaries, persistence contracts, OCR/layout foundation, provider/tool interfaces, task/background-work model, test strategy. **Legacy is not consulted as a source of structure in this step.** | draft blueprint | |
| 5 | **Consult evidence, then reconcile.** *Now* read `LEGACY_REUSE_AUDIT.md` + `OCR_FOUNDATION_CALIBRATION.md` and test each §5 candidate against the step-4 draft: does the frozen architecture actually want a component of that shape, and does the legacy implementation objectively improve on writing it fresh? Record every accept/reject/reshape with its reason. Rejections are expected and are not failures. | reconciled blueprint + candidate dispositions | |
| 6 | **Review and freeze `IMPLEMENTATION_BLUEPRINT.md`,** including the new persistence schema and the final dependency/extras plan (§8.1–8.2). Cold-start surface becomes three files (§11.1 phase two). | commit 3 | **D** |
| 7 | **Port/adapt approved capabilities only** — the subset of §5.1/§5.2 that step 5 accepted and step 6 froze, with §6 provenance trailers. Author the new migration root containing only the tables the frozen schema defines. | source commits | **E** |
| 8 | **Port/adapt tests** (§9) for the capabilities actually ported. Run green. | test commits | |
| 9 | **Contamination + acceptance checks.** Run every §13 gate, plus the §9 OCR acceptance baseline once the OCR foundation exists. Any failure blocks step 10. | evidence | |
| 10 | **Begin formal implementation phases,** numbered from the new blueprint (never legacy Phase numbering). One development report per phase per G4. | | |

**Ordering rationale.** The previous draft ported the generic runtime at steps 4–5 and froze the blueprint at step 8 — which meant the imported code's shape would have silently pre-decided the architecture it was supposed to serve. Reversed: steps 4–5 answer *"if the legacy repository did not exist, what would we build?"* first and consult legacy only as evidence afterward, so every surviving port is pulled by a frozen requirement rather than pushed by its own availability. Step 9 still runs before implementation phases begin, when contamination remains cheap to remove; gate §13.5's "every table is designed in `IMPLEMENTATION_BLUEPRINT.md`" is now checkable by construction rather than retroactively.

One consequence worth stating plainly: **step 5 may reject candidates this document currently rates highly**, including parts of §5.1. That is the mechanism working, not a defect in the audit.

---

## 13. Legacy Contamination Gates

Mechanical checks, run at step 7 and in CI thereafter. Every one must pass.

| # | Gate | Check | Pass |
|---|---|---|---|
| 1 | No SourceBlock authority | `grep -ri "source_block\|sourceblock\|exact_text\|derived_text\|extraction_classification\|ParsedBlock\|SourceBlockType" src/ tests/ migrations/` | 0 hits |
| 2 | No KnowledgeDataset authority | `grep -ri "knowledge_dataset\|KnowledgeDataset\|reserved_knowledge_dataset_id\|coverage_role\|ALLOWED_SUPPORT\|NON_TEACHING_EXCLUDED"` | 0 hits |
| 3 | No StableSemanticAnchor | `grep -ri "stable_semantic_anchor\|anchor_id\|AnchorDraft"` in persistence/progress code | 0 hits (§8 anchoring uses geometry+quote, never an anchor entity) |
| 4 | No generated-Reader assumptions | `grep -ri "ORIGINAL_REFERENCE\|RenderNode\|render_tree\|generation_lineage\|GenerationUnit\|SegmentContract\|UnitPassRecord"` | 0 hits |
| 5 | No 61-table model graph | count `__tablename__` in `src/`; assert every table is designed in `IMPLEMENTATION_BLUEPRINT.md`; assert no single models module exceeds ~400 LOC (audit R1) | passes |
| 6 | No legacy migration chain | `migrations/versions/` contains only new-project revisions; `grep -r "20260827_0001\|20260828_000\|20260829_000\|20260830_000\|20260831_000\|20260901_0010"` | 0 hits; exactly one head |
| 7 | No reconstructed-ebook architecture | no module named `generation`/`planning`/`review`(as content-generation)/`knowledge`(as dataset); no code path where Reader content is assembled from generated nodes | passes |
| 8 | No legacy Phase numbering as authority | `grep -ri "PHASE_0[0-9]\|Product V1\|SYSTEM_BLUEPRINT_V4\|DEVELOPMENT_SPEC_V1\|CODEX_GOVERNANCE"` outside `docs/archive/` | 0 hits |
| 9 | No `Word` entity (calibration) | `grep -ri "word_results\|class Word\|word_id\|word_box"` in persistence/domain code | 0 hits — selections are ranges, not entities |
| 10 | No hard-coded page offset | `grep -rn "308\b"` near page-label logic | 0 hits — offsets are per-Book inferred, `UNKNOWN` otherwise |
| 11 | No Docling pipeline | `pyproject.toml` declares no `docling`, `docling-core`, `docling-parse`, `doclang` | passes; only `docling-ibm-models` under the `prepare` extra, and only if gate D.1 approved it |
| 12 | Serving path is light | importing the serve/Reader entrypoint must not import `torch`, `transformers`, `cv2`, `onnxruntime` | passes |
| 13 | Cold-start surface | exactly three authority documents at repo root; `docs/archive/README.md` declares non-authority | passes |
| 14 | Secrets hygiene (G9) | ported env-hygiene tests pass | passes |

---

## 14. User Approval Gates

Reissued after the 2026-09-03 closure patch. Five sequential primary gates, each requiring an explicit decision **before** its step. Nothing proceeds on assumption, and no gate is implied by another.

| ID | Gate | Decision needed | Blocks | Recommendation |
|---|---|---|---|---|
| **C** | **Approve this Transition Plan** as execution authority | Accept, or return findings | everything | Per **G8** this document is a proposal until accepted; it does not self-authorize. **Approve C first** — A and B are meaningless without it. |
| **A** | **Approve legacy closure/archive** — one bounded documentation commit on legacy `main` covering **exactly the five paths in §3.1**, then freeze the repo as reference | Approve the commit as scoped, **or** choose the no-write fallback (copy diffs into the new repo's archive) | Step 0 | **Approve.** Non-destructive; Markdown only; no source/schema/test/dependency file touched; nothing deleted; `.agents/skills/` and all other untracked content excluded. It is the only way the archive's own Phase 01–03 acceptance records match the provenance §6 cites. |
| **B** | **Approve new-repository initialization** — `mkdir` + `git init` at `D:\codex\408-guided-reader`, baseline commit, authority install | Confirm path and package name; confirm no orphan branch and no legacy remote; approve the copy→verify→commit→remove transfer of `PRODUCT_BLUEPRINT.md` (§4.1) | Steps 1–3 | Confirm. Package name (**U3**) is the only open sub-question. Note this authorizes **documents only** — no code. |
| **D** | **Approve/freeze `IMPLEMENTATION_BLUEPRINT.md`** — the new engineering architecture, persistence schema, OCR/layout foundation, and dependency/extras plan, **plus the step-5 candidate dispositions** (which §5 candidates were accepted, reshaped or rejected, and why) | Accept the architecture and the reuse decisions derived from it | Step 6 | Normal acceptance gate — but now the **load-bearing** one. Everything about what legacy code may cross is decided here, not earlier. |
| **E** | **Authorize code porting** — copy/adapt the subset of §5 that D approved | Confirm that porting may begin against the frozen blueprint | Step 7 | **Cannot be granted before D.** This is the gate the closure patch introduced: previously, porting began at step 4 with no equivalent checkpoint. |

Two subordinate decisions, deliberately *not* bundled into the five above:

| ID | Sub-gate | Decision needed | Blocks | Recommendation |
|---|---|---|---|---|
| **D.1** | **Adopt `docling-ibm-models` + torch + transformers (~805 MB) as an optional preparation-time dependency** — a major/core external adoption under principle **G2** | Approve, defer (ship OCR-only and add layout later), or reject | decided *inside* D; first *installed* in the implementation phase that needs it | **Approve as an optional `prepare` extra** on the calibration evidence (7/7 figures, 2/2 tables, 0 false positives; OCR-only scored 0/7). Per §8.1 this is an **architecture decision, not an installation action** — repository bootstrap installs none of it. Check **U1** first: an ONNX build would remove torch entirely. |
| **D.2** | **Retention of `phase03/parser-runtime-venv` (1.4 GiB) and `phase03/model-cache` (505 MB)** | Keep temporarily as calibration/reference evidence, or delete and re-provision later | nothing — evidence only | **Keep until the OCR foundation is implemented and its acceptance baseline passes.** RapidOCR ships its own 31.7 MB models; the 505 MB HF cache matters only if D.1 is approved. Neither is the new project's dependency environment. |

---

## 15. Remaining Unknowns

Only those that could change a decision above. None blocks accepting this plan.

**U1 — Is there an ONNX build of docling-layout-heron?** If yes, torch (527 MB) and transformers (113 MB) leave the prepare environment entirely and the whole stack becomes onnxruntime-only. Changes the *shape* of gate D.1, not the KEEP verdict. Cheap to check; worth checking **before step 6**, so the frozen blueprint records the right dependency plan.

**U2 — Cross-engine anchor remap robustness.** The calibration's 6/6 round-trip at IoU > 0.999 used the *same* engine version, so it proved determinism and quote-based re-resolution, not survival across an OCR upgrade. Blueprint §7.1 depends on the latter. Testable by re-running one page with a different PP-OCR model. Affects `IMPLEMENTATION_BLUEPRINT.md` (step 6), not this plan.

**U3 — New package name.** Sub-decision of gate B. `guided_reader` is the obvious default.

**U4 — Layout confidence threshold generality.** 0.5 gave perfect separation (kept min 0.872, dropped max 0.406) on 9 pages with 2 tables. Table-heavy chapters should be spot-checked before the threshold is frozen.

**U5 — Watermark contamination.** The `公众号：小兔网盘…` overprint merges into heading lines. Harmless for anchoring; will pollute heading detection and semantic indexing. Needs a filter rule; frequency unknown from a 9-page sample.

**U6 — Whether the 320 ported-and-adjacent legacy tests still pass today.** The recorded baseline is 2026-08-31 and the working tree has changed since. Verified naturally at step 8 when the ported subset runs green; no separate action needed.

---

**End of LEGACY_TRANSITION_PLAN — DRAFT, no execution authority.**
