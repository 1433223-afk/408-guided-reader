# KP semantic projection correction — 2026-09-17

## Result

The real data-structures Chapter 1 now prepares to `READY` and publishes 10 Knowledge Points.
This follow-up is independent of the earlier heading-resolution correction: the Chapter had already
resolved its physical ranges and then failed during semantic generation with
`invalid_semantic_output.noncontiguous_units`.

## Root cause and correction

The first semantic window contained continuous textbook concepts separated by a generated evidence
unit whose only text was the printed page label and repeated running header:
`2 2026年数据结构考研复习指导`. DeepSeek correctly omitted that furniture while grouping the
concepts on both sides, but the resulting target skipped one unit ID. The strict continuous-range
validator correctly rejected all three same-contract attempts.

- The semantic projection now recognizes only top-band text repeated on at least two physical pages
  as running-header furniture. A pure Arabic/Roman page-label token beside such a repeated header is
  removed with it. A unique top-band line remains evidence because it may be a real heading.
- This is projection-only filtering. Persisted OCR text/geometry, page-label evidence, Outline
  identity and physical ranges are unchanged.
- The generator contract now says explicitly that one target may not list units on both sides of an
  omitted unit: it must include the incidental middle unit in the continuous source span or split
  into two individually continuous targets. Validation remains strict and no output is coerced.
- A subsequent real Chapter 3 attempt reached Review but was correctly rejected because the
  generator minted the pure transition `必须学习…把握规律…举一反三` as an `应用概述` KP. The static
  generator contract now explicitly classifies requirement/advice/transition-only units as
  `non_kp_units`. This is not Review-driven runtime repair: the failed attempt ended unchanged, and
  the user-requested retry created a fresh attempt under the same one-pass pipeline.

## Acceptance evidence

- TARGETED: `python -m pytest -q tests/test_knowledge_map.py tests/test_map_the_book.py` — 35 PASS.
  Coverage includes the real failure shape, adjacent printed page labels, repeated running headers,
  preservation of a unique top-band heading, cross-page sentence continuation, strict partition
  validation and the prior physical-heading correction.
- CLOSURE: full Python suite — PASS with two existing optional OCR skips.
- `python -m compileall -q src` and `git diff --check` — PASS.
- Disposable-copy real-provider acceptance, real 412-page data-structures revision
  `9830db77-6811-45cb-822c-f54f3321450a`, Chapter 1: `READY`, 4/4 Sections, 10 KPs;
  generator `deepseek/deepseek-flash`, reviewer
  `openrouter/google/gemini-3.8-flash`. The generated map contains no page-header/page-number KP.
- Live user-requested retry after service restart: Chapter 1 published `READY`, 4/4 Sections,
  structure version 1, 10 KPs, with the same approved generator/reviewer routes and no failure code.
- Live retry of the originally reported Chapter 3: the first post-geometry attempt reached 6/6
  Sections but received a valid structural Review FAIL for the transition-only pseudo-KP and
  published nothing. After the contract clarification, a fresh user-requested attempt published
  `READY`, 6/6 Sections, structure version 1, with Review PASS and no failure code. Generator and
  reviewer remained `deepseek/deepseek-flash` and
  `openrouter/google/gemini-3.8-flash` respectively.
- JavaScript suite: `INTENTIONALLY_NOT_RUN` for this correction because no JavaScript or UI contract
  changed; the real HTTP schedule/status path and live Reader data were exercised. The previously
  recorded unrelated `chapter-entry.test.js` fixture failure is unchanged.

## Known limitations / deferred debt

This is deliberately not a generic document-layout or furniture-detection subsystem. Unique or
non-top-band decoration remains in the semantic evidence unless an existing narrow rule recognizes
it. Such evidence must still obey the same continuous partition contract and fails closed if a
provider produces an invalid partition.

## Reproducible entry points

Run the targeted command above. For the real flow, copy `var/manual-browser/state.sqlite3` to a
disposable data directory, request Chapter 1 preparation, and verify the recorded provider identities
before allowing calls. Do not use the live Library merely as a test fixture.

## Important files / architecture entry points

- `src/reader_service/knowledge/semantic.py` — deterministic evidence-unit projection.
- `src/reader_service/knowledge/service.py` — frozen continuous-partition prompt contract.
- `tests/test_knowledge_map.py` — furniture and partition regressions.

## Git checkpoint

Recorded by the commit containing this report.
