# Reader KP Navigation and First Confirmation Development Report

## Result

`IMPLEMENTATION_READY / READY_FOR_USER_RETEST`. Reader knowledge points now use a temporary,
right-side navigation overlay while Outline remains on the left. Opening it does not overlap,
resize or cover the Viewer PDF canvas at the verified Reader viewport. A previously unconfirmed KP with no Master conversation shows
`这里没完全懂` and `我已清楚` as peer actions; a KP with durable Master history retains
`这里没完全懂` and `继续 Master 对话`. User acceptance is pending.

## Implemented

- The current-Chapter KP list is a 300px maximum-width fixed right overlay. It remains closed by default,
  closes on Escape/source navigation/explicit close, and is mutually exclusive with Outline,
  Search, Marks, the legacy hidden Knowledge panel and the Assistant dock. Section grouping,
  authoritative KP state, PDF source jumps and the Book Overview footer remain unchanged.
- `我已清楚` records the existing explicit `KP_EXPLICIT_UNDERSTOOD` evidence and current KP status.
  The narrow authenticated endpoint accepts only a KP with no Master Thread, is idempotent, and
  never creates, resolves, reactivates or otherwise changes Master Thread/Topic/Message state.
  Existing learning-state locking and Knowledge identity/freeze behavior are reused.
- The established Master-conversation branch is unchanged. Any KP with a durable Master Thread
  continues to show only the existing unclear and continuation actions.

## Important implementation decisions

The existing `/confirm` endpoint requires and resolves an active Master Topic, so it cannot express
first-pass understanding without changing Topic lifecycle. The new `/understand` action therefore
writes the same explicit-understanding event at the repository boundary while rejecting scopes that
already own a Master Thread. This keeps the two user-visible branches structurally enforced rather
than relying only on a hidden frontend condition.

## Deviations from Spec

None.

## Acceptance evidence

- TARGETED: `python -m pytest tests/test_learning.py -k first_pass_understanding -q` — PASS.
  The new test verifies UNDERSTOOD status, one append-only explicit event, idempotency, HTTP wiring,
  zero Master durable rows and rejection after a Master Thread exists.
- AFFECTED: `python -m pytest tests/test_learning.py tests/test_section_learning.py -q` — 31 PASS.
- FRONTEND: `npm test` — 47 PASS. The added browser unit test covers both exact action branches and
  the direct `/understand` call; Chapter-entry tests cover peer-panel closure.
- REAL USE: `tests-e2e/kp-reader-overlay.mjs` — PASS against an isolated SQLite/blob copy of the
  real 348-page textbook Library. It exercised the real Reader route with KP `机器字长` in the
  first-pass state and `计算机采用二进制编码的原因` with an existing Master conversation.
  Explicit confirmation changed the former to UNDERSTOOD while Master Thread/Topic/Message counts
  remained byte-for-byte equal as counts. The KP overlay and Outline were opened in sequence;
  canvas pixel dimensions, canvas CSS dimensions and Viewer width remained identical throughout;
  the panel's left edge remained beyond the PDF canvas's right edge, with zero overlap.
  Screenshots were visually inspected.
- BROAD: `python -m pytest -q` — 296 PASS / 2 unchanged optional OCR skips; `npm test` — 47 PASS.
- `git diff --check` — PASS.

All automated mutations used a disposable real-Library copy. The source Library used by port 8767
was read only during this verification. No provider call was needed or made.

## Known limitations / deferred debt

No known limitation within this requested slice. The overlay remains a temporary Reader navigator;
full Knowledge Map ownership stays with Book Overview.

## Reproducible entry points

```powershell
python -m pytest tests/test_learning.py tests/test_section_learning.py -q
npm test
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/kp-reader-overlay.mjs
python -m pytest -q
```

Screenshots: `test-results/kp-first-pass.png`, `test-results/kp-existing-master.png`, and
`test-results/kp-reader-drawer.png`.

## Important files / architecture entry points

- `src/reader_service/static/screens.js`, `screens.css`, `app.js` — temporary KP navigation and
  peer-panel ownership.
- `src/reader_service/static/master-ui.js` — the two KP card branches.
- `src/reader_service/learning/repository.py`, `server.py` — explicit first-pass evidence boundary.
- `tests-js/master-marker.test.js`, `tests-e2e/kp-reader-overlay.mjs`, `tests/test_learning.py` —
  focused contract and real-material evidence.

## Git checkpoint

The commit containing this report is the implementation checkpoint. It does not claim user
acceptance.
