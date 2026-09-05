# Map the Book Development Report

## Result

`CLOSED` — the Reader now exposes a collapsible Simplified-Chinese `目录` built only
from the source PDF's embedded bookmarks or persisted READY OCR lines on complete TOC-page blocks.
A navigable entry follows the existing `goToPage` path to the original PDF canvas. The current page
shows its printed-page label when a validated per-page mapping exists and otherwise says
`印刷页未知`; a per-page manual label persists and takes precedence over inference.

`MAP_THE_BOOK_STATUS: CLOSED`

Final user real-use acceptance and the required independent narrow review both passed. The Phase may
close; no further Map the Book implementation or review gate remains open.

This is Outline Pass 1 plus printed-page mapping and Reader navigation only. It does not claim R4
complete and does not implement Pass 2 physical resolution or D-3 layout detection.

## Implemented

- Migration 6 adds the frozen `OutlineNode` and `PageLabel` fields, both source-revision-owned with
  foreign-key cascade. Every node starts with `identity_revision = 1` and
  `physical_revision = 1`; neither counter changes in this slice.
- Outline is a separate bounded context. It prefers embedded PDF bookmarks when present; otherwise
  it parses only a complete contiguous block of READY TOC pages. It never reads body headings as
  node-minting evidence.
- Reader presentation now keeps the formal textbook Chapters at the top level and moves the measured
  front/end-matter roots (cover/title/copyright/resource pages, preface, reader note, training-camp
  promotion, TOC itself, references, and comparable named matter) into one default-collapsed
  `其他内容` group. This is a transient UI projection: all 211 durable nodes remain stored with the
  same IDs, parents, depths, and order.
- Follow-up real-use correction: clicking a Chapter or Section title now toggles its immediate child
  list, rather than requiring the user to discover the small disclosure triangle. If that parent has
  a safe page target, the same click still follows the existing original-PDF `goToPage` path; an
  unresolved parent can expand without fabricating a navigation target. The recursive renderer has
  no depth ceiling.
- Embedded bookmark hierarchy is no longer capped at depth 2 during minting. Arbitrarily deep body
  bookmark nodes keep their source depth and parent chain; `SUBSECTION` remains the frozen kind for
  depth 2 and deeper. The two accepted real trees contained no bookmark deeper than depth 2, so this
  correction did not alter or conflict with either existing durable tree.
- Stable IDs are deterministic UUIDv5 values scoped to immutable source revision + evidence source +
  logical evidence key. A committed tree records its structural digest. A later derivation that
  would change node set, title, hierarchy, kind, or order sets `identity_conflict` and leaves the
  stored tree untouched.
- TOC bootstrap waits for the first READY non-TOC page after a detected TOC block before its first
  commit. This avoids minting a partial first TOC page and later inserting/reparenting nodes as more
  TOC pages become READY. More body READY pages and repeated bootstrap runs do not change logical
  identity, hierarchy, or order.
- TOC classification uses a normalized copy of each line. NFKC and the measured overprint patterns
  (`CIWEIYUNYIN`, `刺猬云印·在线打印`, the observed 研池悟空/微信 promotional strings) are stripped
  from that copy only; persisted `OCRLine.text` is never updated.
- Foundation owns one `PageLabel` row per PDF page. Header/footer-band Arabic and Roman candidates
  are grouped into local monotonic hypotheses. A run requires at least three observations over at
  least three PDF pages, no gap larger than one missing page, and at least 75% consistent
  recto/verso parity. Only a single bounded hole between two observations may be interpolated, at
  lower confidence. Everything else stays `method = NONE`, `printed_label = NULL`.
- `MANUAL` page-label writes use confidence 1, survive reopen/restart, and always win for their page.
  A printed label resolves an Outline target only when there is one safe page; one unique MANUAL row
  disambiguates inferred duplicates. Non-monotonic sibling targets are rejected per node and remain
  `UNRESOLVED` without hiding the logical entry.
- The Reader adds a collapsible tree, honest disabled state for nodes without a safe target, current
  printed-label display, and a per-page manual override. Search and Marks remain separate panels.
- Preparation refreshes mapping after early READY pages and bounded later checkpoints. Scheduling
  serializes enqueue/prioritize against worker claim, and the client completes preparation
  scheduling before requesting map bootstrap, avoiding the newly reproduced SQLite write race.

## Important implementation decisions

- The initial load-bearing TOC parser accepts `第N章`, `N.N`, and `N.N.N` rows, derives hierarchy
  only from those printed number tokens, and pairs a printed label only with a right-side numeric
  line at the same visual row. A page must yield at least three such entries and three right-side
  numeric labels to count as a TOC page. The largest contiguous block is used. These are the initial
  minting heuristics; changing them for an already-committed revision is an IDENTITY-tier operation,
  not ordinary tuning.
- Bookmarks are preferred when present because the Frozen Core names them as authoritative for title,
  hierarchy, order, and start page. For a book with usable bookmarks, TOC OCR is not used to
  re-derive a competing tree. TOC parsing remains an unchanged fallback for the 29-page source that
  has no bookmarks; no fallback heuristic or threshold was added or broadened in this correction.
- Front/end-matter grouping is intentionally presentation-only. It is based on conservative named
  root-title classification, defaults closed, and preserves the original nodes and their complete
  descendant hierarchy inside the group. Body descendants are never hidden based on depth; third
  level is a minimum expectation, not a display maximum.
- Page-label inference computes local relation hypotheses in memory but persists only per-page rows;
  no global offset constant, setting, or stored mapping formula exists.
- Bookmark parsing owns and deterministically closes its PDF stream. This is required on Windows so
  building the Outline cannot retain a source-file handle and obstruct book deletion.
- READY-state signatures cache only repeated inference work within one process. The durable rows,
  source OCR, and restart behavior remain authoritative.

## Deviations from Spec

None. The implementation stayed within Pass 1, existing bookmark/TOC evidence, current OCR rows,
per-page label mapping, and original-PDF navigation. No body-heading fallback, Pass 2, layout,
correction UI/tier workflow, KP/Teaching/Assistant, AI, or structure-scoped search was added.

## Acceptance evidence

### Final gate outcomes

- **User real-use acceptance: PASS.** The main directory foregrounds formal Chapters;
  front/end matter is grouped under default-collapsed `其他内容`; body hierarchy expands recursively
  with no artificial display-depth ceiling; and `6.2.1 总线事务` navigates through the original-PDF
  path to PDF page 303 while showing printed page 291.
- **ZCode independent narrow review: PASS — P0 0 / P1 0 / P2 3.** The review covered the Phase's
  narrow load-bearing scope and explicitly allowed Map the Book to close. Its three P2 observations
  are recorded below as non-blocking deferred observations, not current defects and not closure
  blockers.

- `python -m compileall -q src`: **PASS**.
- Correction rerun: `pytest -o addopts= -q -ra`: **46 passed, 2 skipped**. The two skips are the pre-existing optional
  external-path OCR calibration tests; the same hash-verified real books were exercised in browser
  acceptance below. Coverage includes schema shape, embedded-bookmark trees, TOC parsing with a
  watermark-contaminated line, stored-text immutability, complete-block waiting, stable re-bootstrap
  after more READY pages, identity-conflict blocking, monotonic target rejection, validated label
  runs, UNKNOWN pages, MANUAL precedence after reconstructed service objects, arbitrary embedded
  bookmark depth, API contracts, and Outline/PageLabel cascade with no ghost rows after book deletion.
- Correction rerun: `npm test`: **30 passed** — geometry and selection regressions remain green.
- Correction rerun: `npm run test:e2e:map`: **PASS** on an isolated copy of the prepared acceptance library.
  - 29-page scan, SHA-256
    `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`: evidence source `TOC`,
    203 logical nodes, 22 `INFERRED` page labels, 7 honest UNKNOWN rows. Clicking
    `1.2.2 计算机硬件` navigated to original PDF page 15 and displayed printed page 3.
  - 348-page scan, SHA-256
    `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`: evidence source
    `BOOKMARK`, 211 logical nodes, 340 `INFERRED` page labels, 8 honest UNKNOWN rows. Clicking
    `6.2.1 总线事务` navigated to original PDF page 303 and displayed printed page 291.
    Its main presentation has exactly the seven formal Chapters plus one default-collapsed
    `其他内容` group containing the eight measured non-body root nodes. The raw API still returns all
    211 nodes. Clicking `第6章 总线` exposes exactly `6.1`–`6.4`; clicking
    `6.2 总线事务和定时` exposes exactly `6.2.1`–`6.2.4` before the `6.2.1` navigation check.
  - Both trees' complete `(outline_node_id, parent_id, depth, order_index, title)` snapshots were
    byte-for-byte stable after service restart; all node revision counters remained 1.
  - A manual `封面` label on an UNKNOWN page remained `MANUAL` after book close/reopen and after a
    Core Service restart. The test operated on a copied data directory and did not alter user data.
  - The target page's actual PDF.js canvas was rendered; no OCR/reconstructed reading surface was
    used for navigation.
- Correction final real regressions: `npm run test:e2e` **PASS**; `npm run test:e2e:r2` **PASS** with 29/29 READY
  and precise `6.2.1` selection; `npm run test:e2e:r3` **PASS** on both books with restart,
  selection/copy, six temporary marks, deletion, cleanup, and restored reading positions;
  `npm run test:e2e:find` **PASS** with 6 and 10 matches at 29/348-page scale (125.6 ms / 393.5 ms).
- One correction-cycle R2 invocation is explicitly **not** counted as PASS: it reproduced the
  previously observed SQLite writer contention while reprioritizing preparation during OCR page
  publication, and page 29's overlay consequently timed out. A full bounded rerun passed. The
  failure caused no persistent data damage, but remains reported evidence rather than being converted
  into a clean first-attempt result; this UI/source-priority correction did not expand into unrelated
  queue/database concurrency work.
- One post-implementation R1 run is explicitly **not** counted as PASS: concurrent preparation
  scheduling and initial map bootstrap reproduced the previously deferred SQLite write lock and
  produced two empty preparation responses. Scheduling/map request ordering and process-local job
  dispatch coordination were corrected; the final R1 rerun passed including book deletion, with no
  write lock or failed API request.
- Two early Map E2E attempts are not counted as PASS because the harness tried to reopen a book while
  the asynchronous return-to-library flow was still completing. The harness now waits for the
  Library surface; subsequent full runs passed.

Overall status: `CLOSED`. Automated and real-browser acceptance passed on both named real books;
user real-use acceptance passed; and the required independent narrow ZCode review passed and allowed
closure.

## Known limitations / deferred debt

The final narrow review recorded three **P2, non-blocking deferred observations**. They are not
upgraded to current defects and are intentionally not fixed in this Phase:

- inferred PageLabel conflict visibility / first-inference locking;
- TOC fallback classifier false-positive risk;
- TOC fallback trailing FAILED page indefinite wait.

- The 29-page source is a front-of-book excerpt. Its TOC describes the whole textbook, so nodes whose
  printed pages are outside the excerpt remain visible and honestly `UNRESOLVED`; for example its
  `6.2.1` cannot navigate. The in-range `1.2.2` acceptance proves TOC-derived navigation.
- Some early 29-page TOC rows have no same-row printed label in persisted OCR. Those logical nodes
  remain visible but un-navigable even if a matching body page happens to be in the excerpt; body
  heading evidence is deliberately forbidden in this Phase.
- TOC parsing is deterministic but corpus-bounded to the frozen numbered forms above. A future
  heuristic/threshold change that alters an existing tree must follow the IDENTITY-tier path; the
  runtime guard will not silently apply it.
- The Reader's `其他内容` classification is deliberately conservative and presentation-only. An
  unfamiliar non-body root title may remain in the main list until observed in real material; fixing
  that list does not remint or edit OutlineNodes.
- A correction-cycle R2 run reproduced transient SQLite writer contention once; its complete rerun
  passed. The recurrence remains a bounded reliability observation outside this directory-presentation
  correction, not a claimed clean result.
- Page labels remain UNKNOWN when a locally validated run cannot be established. OCR recognition
  errors are not guessed around; manual override is the supported recovery in this slice.
- Pass 2 start-y/end-range resolution, RESOLVED transitions, body heading detection, exact deferred
  fallback-target policy, layout/VisualRegion work, and correction-tier UI remain out of scope.
- Cross-page continuous selection, cross-version OCR regeneration anchor round-trip,
  `static/geometry.js` live-authority cleanup, and lazy/idle OCR policy remain standing debt.

## Reproducible entry points

```powershell
python -m compileall -q src
pytest -o addopts= -q -ra
npm test

$env:READER_REAL_PDF='D:\path\to\the-29-page-primary-scan.pdf'
npm run test:e2e
npm run test:e2e:r2

# Must contain the hash-verified prepared 29- and 348-page acceptance books.
$env:READER_DATA_DIR='D:\path\to\reader-data'
npm run test:e2e:map
npm run test:e2e:r3
npm run test:e2e:find
```

Manual replay: open each book, open `目录`, expand a Chapter/Section, and click an enabled entry.
Confirm the page control and rendered original PDF page match the target and the toolbar shows the
physical book's printed page. Visit an UNKNOWN page and confirm `印刷页未知`; set a manual value, close
and reopen the book, restart the service, and confirm the value remains. On the 348-page book replay
`6.2.1 总线事务` → PDF page 303 / printed page 291. On the 29-page excerpt replay
`1.2.2 计算机硬件` → PDF page 15 / printed page 3, and confirm out-of-excerpt nodes remain disabled.

## Important files / architecture entry points

- `src/reader_service/library/database.py` — migration 6 entity shape and cascade ownership.
- `src/reader_service/foundation/page_labels.py` — per-page candidate extraction, local run fitting,
  UNKNOWN/MANUAL semantics, and safe label-to-PDF resolution.
- `src/reader_service/outline/service.py` — bookmark/TOC-only Pass 1 parser, watermark classification
  copy, deterministic minting, identity conflict guard, and monotonic target validation.
- `src/reader_service/outline/repository.py` — transactional logical commit and physical-target-only
  updates.
- `src/reader_service/jobs/worker.py` — early/bounded bootstrap retries and dispatch coordination.
- `src/reader_service/server.py` — Outline/PageLabel APIs.
- `src/reader_service/static/index.html`, `app.js`, `styles.css` — Chinese directory, original-PDF
  navigation, printed-label state, and manual override.
- `tests/test_map_the_book.py`, `tests/test_api.py`, `tests-e2e/map-the-book.mjs` — machine and both-book
  acceptance contracts.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its exact hash is recorded in
the completion handoff.
