# Find in Book Development Report

## Result

`IMPLEMENTATION_READY` — the Reader can search the current source revision's already-prepared OCR
text, show a short result snippet for each matching PDF page, and jump from a result to that real PDF
page. The clicked result's exact OCR cell range is temporarily painted and scrolled into view, so the
user sees the hit rather than only its page. Search coverage is explicit, so an empty result cannot
imply whole-book absence while pages are still being prepared.

`READY_FOR_USER_REAL_USE_REVIEW: YES`

`USER_REAL_USE_ACCEPTANCE: PASS` — the user completed real-use validation of Find in Book,
including the final soft-lavender transient match presentation, and explicitly accepted it on
2026-09-04.

`FIND_IN_BOOK_STATUS: CLOSED`

This is the independently named Find in Book slice after closed R3 and before R4. It is not R4 and
does not authorize R4.

## Implemented

- Revision-scoped `GET /api/revisions/{revision_id}/search?q=...` over the existing Foundation-owned
  `OCRLine.text` rows.
- A read-only repository snapshot joins OCR lines to `ocr_pages` and admits only `READY` rows. The
  same response reports `READY`, `NOT_PREPARED`, `PREPARING`, and `FAILED` counts plus the revision's
  total page count.
- Unicode NFKC normalization, Unicode case folding, and whitespace removal on both query and page
  text. This makes literal Chinese terms, phrases, and substrings reliable across incidental OCR
  whitespace or line breaks without adding fuzzy, semantic, or tokenizer-dependent behavior.
- One bounded snippet per matching page in PDF-page order, with at most 100 result pages and an
  explicit `truncated` flag. Each result also nests anonymous transient line/cell ranges for its first
  match; these positions have no ID and are never persisted. Empty queries return coverage only.
- A compact Reader search entry and collapsible panel with query input, coverage statement, page +
  snippet results, partial-coverage empty state, and real-PDF navigation through the existing
  `goToPage` path.
- A visually distinct soft-lavender translucent transient match marker. The client resolves returned
  runtime cell ranges against the current OCR overlay through the existing selection geometry functions,
  paints all fragments of a cross-line match, and scrolls the first fragment into view. Choosing
  another result replaces it; clearing/closing search or leaving the Reader removes it.
- User-visible UI now defaults to Simplified Chinese, including the existing Library, Reader,
  preparation, selection, Annotation, status, empty-state, and error surfaces. The durable project
  rule is recorded in `AGENTS.md`; identifiers, logs, and engineering documents remain exempt.

## Important implementation decisions

- No FTS or other index was introduced. At the current 348-page scale, a bounded in-process scan of
  existing READY line text is simple, predictable for Chinese substring matching, and comfortably
  responsive. There is no new migration, durable source of truth, business identity, or rebuild
  contract.
- Search calls `LibraryService.revision` only to establish revision existence and total pages, then
  performs a read snapshot. It does not call `ensure_revision`, create status rows, enqueue work,
  invoke OCR, reprocess a page, or read/change `foundation_version`.
- Results locate pages only. The API cannot return bulk page/book OCR text, and the UI does not build
  a reconstructed-text reading surface or paint all matches over the PDF. Only the first concrete
  match belonging to the result the user clicked is painted.
- Search match ranges are transient OCR runtime identity, analogous to the R2 selection expression:
  `line_ordinal` plus anonymous cell boundaries, nested in one response and consumed immediately.
  They never enter Annotation storage, never become a durable anchor, and introduce no geometry or
  foundation-version contract. Durable Annotation quads and styles use separate state and CSS.
- `FAILED` pages stay excluded just like other non-READY states, but their count is named in partial
  coverage copy. A fully READY revision displays `已检索全书 N 页`.

## Deviations from Spec

The original brief explicitly declined painting every match because page navigation was sufficient
for its first acceptance. After user real-use acceptance found page-only location insufficient, this
small authorized refinement paints only the clicked result's first concrete match. It does not paint
all page hits or expand Search semantics. OCR scheduling remains unchanged. No Outline, structure,
fuzzy/semantic/AI search, cross-book search, or new persistence/index authority was added.

## Acceptance evidence

- User real-use acceptance: **PASS**. The accepted final flow searches the current book's READY OCR
  pages, reports coverage, jumps to the real PDF page, and shows the clicked match as a lightweight
  soft-lavender translucent highlight without a debug-like hard border. The marker made the concrete
  hit immediately visible, remained visually distinct from durable yellow/green/blue Annotations,
  and retained the already-verified transient-only lifecycle. The user explicitly accepted the
  complete Find in Book interaction.
- `pytest -o addopts= -q -ra`: **40 passed, 2 skipped**. Search coverage/state filtering, Chinese
  phrase/substring normalization, NFKC/case/whitespace behavior, empty queries, absent terms,
  single-line cell-range resolution, cross-OCRLine multi-fragment resolution, revision existence,
  API shape, and book-delete cascade/no-ghost results are covered. The two
  conditional R2 real-OCR calibration tests remain skipped in the default run because their external
  environment variables are not set; real OCR acceptance is covered below.
- `npm test`: **30 passed** — geometry and selection unit regressions remain green.
- `npm run test:e2e:find`: **PASS** against the hash-verified prepared library after the transient
  match refinement. The 29-page scan
  (SHA-256 `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`)
  searched `总线`, returned 6 matching pages, displayed full coverage, and rendered the result list in
  **77.7 ms**. The 348-page scan
  (`6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`)
  searched the Chinese phrase `中断向量`, returned 10 matching pages, and rendered in **390.2 ms**.
  At both scales, the first result navigated to its exact zero-based API page as the corresponding
  one-based real PDF page, painted its concrete OCR cells, and automatically placed the first marker
  inside the visible Reader viewport. Clicking the second result moved the page and replaced the old
  marker. Closing and clearing search both removed every transient marker; Annotation API snapshots
  for both clicked pages remained exactly equal before and after. An impossible
  query displayed the covered-scope empty result. No visible UI hang occurred.
- The first refinement E2E invocation is **not** counted as PASS: switching to the second result lost
  its marker because an unrelated nearby page's asynchronous overlay render globally removed search
  markers. Cleanup is now target-overlay-scoped and programmatic page jumps explicitly schedule a
  viewport update; both bounded reruns above passed.
- READY / NOT_PREPARED / PREPARING / FAILED semantics: **PASS** in a deterministic four-page
  fixture whose non-READY pages deliberately retained matching line rows. Only the READY page was
  returned and coverage was exactly 1/4 with one page in each state. This directly proves exclusion
  depends on authoritative page status rather than merely on line presence.
- Delete semantics: **PASS**. Book deletion cascaded the revision's OCR rows; the old revision became
  unresolvable and could not return ghost results. Source-revision ownership uses the existing
  Foundation foreign-key cascade; no search-owned data exists.
- `npm run test:e2e`: final bounded rerun **PASS** on the real 29-page scan: Reader virtualization,
  page rendering, zoom, position persistence/reopen, duplicate import, and book deletion. The first
  invocation reached cleanup but failed on a transient Windows PDF file handle (`EBUSY`); a second
  invocation correctly failed because its assertion still expected the pre-translation English
  duplicate-import message. Neither is counted as PASS; the localized assertion was corrected and
  the final run passed.
- `npm run test:e2e:r2`: **PASS**, 29/29 real pages READY with selection, copy, precise `6.2.1` TOC
  selection, and scoped right-click behavior intact.
- `npm run test:e2e:r3`: **PASS** again after the transient-match refinement on both real books. Six temporary annotations covered highlight,
  note, all visible styles plus `NONE`, quiet selection, context-menu scoping, restart persistence,
  deletion, and collapsed Marks. Acceptance marks were removed and original reading positions were
  restored.
- Search produced no SQLite write-lock during unit, API, or two-scale browser acceptance. The live
  Reader was restored on `127.0.0.1:8766` after exclusive use of the prepared acceptance library.

## Known limitations / deferred debt

- Matching is honest normalized substring matching over stored OCR. OCR recognition errors are not
  corrected, and there is no fuzzy, ranked, semantic, structural, or cross-book search.
- Precise temporary paint depends on the READY line's existing anonymous selectable cells. A result
  still navigates to its PDF page if a malformed legacy line lacks cells, but no alternate guessed
  geometry is fabricated. Both current real corpora produced visible precise markers.
- The result cap is 100 matching pages; `truncated=true` tells the UI that only the first 100 in page
  order were returned.
- Coverage is the authoritative snapshot at the time of each query. Search never waits for or
  triggers remaining OCR work; searching again incorporates newly READY pages.
- Cross-page continuous selection remains required but deferred.
- Cross-version OCR regeneration anchor round-trip remains pending because reprocessing does not
  exist.
- `static/geometry.js` becoming the single live conversion authority remains P2 deferred.
- The previously observed, not-stably-reproduced SQLite preparation write lock remains separate
  deferred debt. Find in Book did not reproduce it and did not change scheduling or concurrency.
- Whether whole-book progressive preparation should later become more lazy/idle-aware remains an
  open resource-policy question, not a Frozen Product invariant. This slice showed no Reader impact
  and made no scheduling changes.

## Reproducible entry points

```powershell
pytest -o addopts= -q -ra
npm test

$env:READER_REAL_PDF='D:\path\to\the-29-page-primary-scan.pdf'
npm run test:e2e
npm run test:e2e:r2

# Must contain the prepared, hash-verified 29- and 348-page acceptance books.
$env:READER_DATA_DIR='D:\path\to\reader-data'
npm run test:e2e:r3
npm run test:e2e:find
```

Manual replay: open either real book, open the small search panel, confirm the coverage statement,
search a Chinese term or phrase, click a result, and verify the page input and rendered PDF both land
on the listed page with a soft lavender hit visible. Click a second result and confirm the old marker
is replaced. Close the search panel, then repeat and clear the input; no marker or new item in Marks
should remain. Search an impossible phrase and confirm the empty state still names the searched
coverage rather than claiming an unqualified whole-book absence.

## Important files / architecture entry points

- `src/reader_service/foundation/repository.py` — atomic coverage + READY-line read snapshot and
  matched-page-only transient cell lookup.
- `src/reader_service/foundation/service.py` — normalization, page matching, snippet/result bounds,
  and anonymous runtime match ranges.
- `src/reader_service/server.py` — revision-scoped search HTTP route.
- `src/reader_service/static/index.html`, `app.js`, `styles.css` — localized search entry, coverage,
  results, and real-PDF navigation.
- `tests/test_search.py`, `tests/test_api.py` — state/coverage/query/delete/API contracts.
- `tests-e2e/find-in-book.mjs` — hash-verified 29/348-page real-browser acceptance and timings.

## Git checkpoint

The implementation checkpoint is the commit containing this report; its exact hash is recorded in
the completion handoff.
