# Chapter heading resolution correction — 2026-09-17

## Result

`HEADING_NOT_RESOLVED` no longer blocks Chapter Knowledge Map preparation when a real Outline
contains unnumbered structural Sections such as `归纳总结` or `思维拓展`. The correction stays inside
the existing target-Chapter physical-range resolver: it changes no logical Outline identity, schema,
publication contract, provider route, or Reader behavior outside Chapter preparation.

## Root cause and correction

The resolver previously required every required heading to have a `第 N 章` or `N.N…` prefix.
The 412-page data-structures textbook has direct, required, unnumbered Section bookmarks whose OCR
headings are present and trustworthy, so the old predicate rejected valid evidence by construction.

- Unnumbered headings now require an exact normalized-title match, remain constrained by document
  order, and may match only within one PDF page of their bookmark hint. Repeated labels on another
  page are therefore not accepted opportunistically.
- Numbered headings still require the exact numbering prefix and now also require at least 0.70
  title similarity. Conservative same-row joins handle OCR that splits `3.4` from
  `数组和特殊矩阵`; an unrelated line sharing only the number is rejected.
- The observed `公众号：小兔网盘免费分享无水印PDF` contamination is removed only by the existing
  classification copy. Persisted OCR text and selectable geometry remain unchanged.

## Acceptance evidence

- TARGETED: `python -m pytest -q tests/test_knowledge_map.py tests/test_map_the_book.py` — 34 PASS.
  The regression covers split numbered headings, a misleading same-number line, a repeated
  unnumbered title on the wrong page, and exact `归纳总结` / `思维拓展` resolution.
- AFFECTED Python closure suite — PASS, with the two existing optional OCR skips.
- `python -m compileall -q src` and `git diff --check` — PASS.
- Real 412-page data-structures revision
  `9830db77-6811-45cb-822c-f54f3321450a` (PDF SHA-256
  `114b5f64075e9dd7d15443eb96508f9d4d0c99c6b0cfbd4a78c46b90c84601e4`): all 8 numbered
  Chapters resolved on a disposable SQLite copy. Chapter 3 resolved all 27 required nodes;
  `归纳总结` matched PDF index 120, line 36. Outline `identity_revision` was unchanged.
- Real 348-page computer-organization revision
  `8ed51463-78da-448f-883a-cf26684d902b`: all 7 numbered Chapters resolved on a disposable SQLite
  copy, including the contaminated `7.3.3 DMA方式…` heading.
- The user's live Library was not mutated and no AI/provider call was made.
- BROAD JavaScript: `npm test` — 50 PASS / 1 FAIL. The failure is pre-existing and outside this
  backend change: `tests-js/chapter-entry.test.js` provides no `#reader`, while the current
  `openList()` dereferences that element before the test can observe `已理解`. It reproduces alone;
  no JavaScript file changed here, so this suite is not claimed as PASS.

## Known limitations / deferred debt

The resolver intentionally does not fuzzy-match unnumbered headings or search far from their
bookmark hint. Ambiguous or materially inaccurate Outline evidence continues to fail closed instead
of inventing source ranges. The unrelated JavaScript fixture failure above remains to be handled in
its own risk surface.

## Reproducible entry points

Retry Chapter preparation from the Reader after restarting the local service. For deterministic
coverage, run the targeted command above. Real-material validation must use a disposable copy of
`var/manual-browser/state.sqlite3`; do not use Chapter preparation as a test against the live user
Library.

## Important files / architecture entry points

- `src/reader_service/outline/service.py` — classification and physical heading matching.
- `tests/test_knowledge_map.py` — resolver integration regression.
- `tests/test_map_the_book.py` — classification-only watermark regression.

## Git checkpoint

Recorded by the commit containing this report.
