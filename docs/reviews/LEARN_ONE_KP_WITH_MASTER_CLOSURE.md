# Learn One KP with Master — independent narrow closure review

Date: 2026-09-10. Reviewer: **independent Codex agent** (`closure_audit`), not ZCode.
The reviewer did not design or implement this Phase. Reviewed implementation:
`3aff1639c4679c728ee924a6468e8bd15836df8d`.

**P0=0 · P1=1 · P2=0. INDEPENDENT_NARROW_REVIEW: FAIL.
CLOSURE_RECOMMENDATION: BLOCK.** User acceptance PASS, reported by the user, is a separate
gate and is not withdrawn by this finding. No implementation change or waiver was made.

## Material finding

### P1 — Deterministic source grounding accepts unsupported page and figure citations

`src/reader_service/learning/service.py:89` checks only non-empty text and page numbers matching
`PDF\s*第?\s*(\d+)\s*页`. It does not recognize an ordinary alternate PDF citation such as
`PDF p. 999`, or check explicit textbook figure identifiers. `_run` then saves that response as
a completed durable answer at `service.py:110`; Fast returns immediately with no independent
Review. The same incomplete gate runs before Standard/Deep Review at `service.py:128`.

An isolated, populated synthetic Library supplied only PDF page 1, with OCR text equivalent to
`1.1 第一节` and `概念 A 的起点`, and no figure 999-9. An injected provider returned:

| Provider answer | Observed durable result |
|---|---|
| `PDF 第 999 页` | User question `FAILED`; no answer saved |
| `The textbook states this at PDF p. 999.` | Assistant `COMPLETE`, `NOT_REQUESTED` |
| `教材图 999-9 明确表明了这一事实。` | Assistant `COMPLETE`, `NOT_REQUESTED` |

The second case retried the same retained question, proving this is the real save boundary,
not just a standalone regex observation. The third case was a new Fast send. Neither invented
reference existed in the actual assembled source. All providers in this experiment were in-memory
stubs; no provider account or real textbook was accessed.

This is a source-attribution violation, not a request to independently assess academic correctness
in Fast mode. Product §30.1 forbids fabricated page/figure citations even in Fast;
Implementation §13.6 (`IMPLEMENTATION_BLUEPRINT.md:1308`) explicitly requires checking
deterministically checkable page labels and figure identifiers. §13.7
(`IMPLEMENTATION_BLUEPRINT.md:1337`) requires deterministic gates before reviewer calls.
The Phase also makes grounding mandatory in every mode.

Required before closure: enforce the supported source-reference forms against the supplied evidence
at the existing answer/Review boundary, including rejecting unsupported explicit textbook figure
references; add adversarial coverage for alternate page notation and absent identifiers. Retain the
question and retry semantics. This review does not prescribe a new generic parser or dependency.

Minimal reproduction of the faulty gate (PowerShell, repository root):

```powershell
@'
from reader_service.learning.service import LearningService
source = {'pages': [{'pdf_page_number': 1, 'ocr_text': 'Concept A'}]}
for answer in ('PDF p. 999', '\u6559\u6750\u56fe 999-9'):
    LearningService.grounding(answer, source)
    print('INCORRECTLY ACCEPTED:', ascii(answer))
'@ | python -
```

## Checks and scope

Read AGENTS, the full accepted Phase brief and relevant development reports, and the named
Product/Implementation authority sections. Inspected Learning schema/repository/service/display,
HTTP authorization and routing, startup recovery, the permanent Knowledge lock, migration handling,
Master UI projection consumption, and the reused provider runtime/credential transport boundary.

- Published identity/source ownership: `learning/repository.py:13` resolves an ACTIVE revision,
  READY Chapter and matching published structure version. Threads use the real opaque KP key;
  `learning/schema.py:5` enforces one thread per KP. No replacement identity or source rewrite found.
- Mastery/event authority: `learning/repository.py:77`, `:106`, `:116`, `:129` implement explicit
  evidence and same-transaction projection/history/lock writes. Open never downgrades UNDERSTOOD;
  Review only updates message metadata (`service.py:123`). Event mutation/deletion triggers are at
  `schema.py:49`. Permanent locking uses `knowledge/repository.py:581` and the irreversible trigger
  at `library/database.py:725`.
- Durable send/retry/replay/concurrency/restart: `repository.py:153` commits intent before
  scheduling, rejects changed replay content/mode, and serializes unfinished questions;
  `schema.py:16` and `:30` enforce active-Topic and per-intent uniqueness. `service.py:41`/`:48`
  guard local scheduling/retry; `repository.py:179` marks interrupted work honestly retryable.
  Existing adversarial tests exercise six concurrent duplicate sends and retries, response replay,
  explicit resolution during provider execution, and restart.
- Section/Subsection: `repository.py:69` derives scope from authoritative owner/range; `:129`
  confirms only missing projections and retains unclear KPs/Topics. Same-page, cross-page,
  crossing-range and other-scope cases passed.
- Migration/cascade: migration 12 only adds Learning tables/triggers (`library/database.py:737`),
  under the existing atomic migration transaction. Independent populated migration experiment
  preserved **13 pre-existing tables / 40 rows exactly**, with integrity and FK checks clean.
  Existing cascade/ownership test passed; Learning records cascaded with their book and the sibling
  book remained. No claim is made that this synthetic sample proves every real Library condition.
- Context/credentials: `service.py:72` assembles KP-local evidence; `:103` selects only the current
  Topic; `:133` creates the separate Review allowlist. No Assistant state or credential enters those
  builders. Configured reviewer identity is recorded; no fallback path found. Existing mode,
  allowlist and failure/retry tests passed. Provider credentials are separate from the request body
  (`agent_runtime/runtime.py:327`, `:385`; `agent_runtime/deepseek.py:35`). No live credential read
  or live-provider verification was performed by this reviewer.
- Display projection: `learning/display.py:7` only reads stored OCR/page labels and adds display
  fields to response dictionaries. Membership is computed before projection (`repository.py:63`),
  Master source uses the published range, and UI footer placement consumes only display coordinates
  (`static/master-ui.js:228`). The display test passed its no-writes/original-field preservation
  assertions.

## Executed evidence and limitations

1. `python -m pytest tests/test_learning.py tests/test_learning_display.py -o addopts='' -q`
   — **15 passed in 13.62s**. These are existing implementation tests independently rerun, not new
   independent test authorship. Fixtures use pytest temporary Libraries/in-memory SQLite.
2. Two inline PowerShell here-string scripts piped to `python -` used
   `tempfile.TemporaryDirectory(prefix='master-closure-audit-')`, `LibraryService`,
   `test_knowledge_map.build_fixture`/`claim_and_run`, `LearningService`, `ProviderCompletion` stubs
   and `test_learning.idle`. Both exited 0. They reproduced the durable grounding bypass described
   above. The second used Unicode escapes and ASCII JSON output to avoid console encoding ambiguity.
3. The second script first temporarily restricted `reader_service.library.database.MIGRATIONS`
   to versions <=11 using `unittest.mock.patch.object`, created/published the synthetic Chapter,
   snapshotted every pre-existing table except migration bookkeeping, restored migrations and ran
   `database.initialize()`. Exact row comparison, `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check` passed: `POPULATED_MIGRATION_PASS 13 tables 40 rows unchanged`.
4. One evidence-search command failed at PowerShell parsing because shell brace expansion was used;
   its replacement search succeeded for implementation evidence but a guessed `adapters.py` path was
   absent. `rg --files src/reader_service/agent_runtime` followed by a directory-wide credential/
   transport search succeeded. Neither command failure was counted as a passing check.

No user `var/manual-browser` Library writes, UI/business changes, live provider calls, commits or
service restarts were made by this reviewer. Temporary synthetic fixtures were automatically removed
by their test/temporary-directory lifecycle. Browser golden paths and broad suites were not rerun by
this narrow reviewer; the implementation report and coordinating agent provide separate evidence.
No claim of exhaustive semantic correctness or multi-process execution support is made.

The finding was reported to the coordinating agent before finalizing this report. Independent
acceptance remains failed and the Phase must remain open until the grounding defect is addressed and
independently rechecked under appropriate authorization.
