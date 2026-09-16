# Personal stable baseline — personal-v0.1

## Result

2026-09-16: the user confirmed completion and acceptance of the UI work and requested a local
personal checkpoint. This checkpoint preserves the Windows personal edition. It is not Beta
implementation, deployment acceptance, or a claim that every viewport/performance criterion passes.
The annotated tag `personal-v0.1` identifies this report's containing checkpoint on `main`.
Private GitHub backup remains pending: no Git remote is configured.

## Audited change inventory

- `static/app.js`: Guide/Inline explanation uses the existing selection-to-Assistant draft helper;
  the existing session/pending guards remain, with the helper's revision guard.
- `static/inline-ui.js`: Escape/outside-pointer dismissal, one “继续问AI” action, removal of the
  redundant source-jump action; source/asset/item/span payload is retained.
- `static/screens.css`: accepted Memory UI fonts, Inline card spacing/actions, and global Header
  alignment, typography, focus and reduced-motion styling.
- Initially untracked `header-polish.mjs` and `GLOBAL_HEADER_POLISH.md`: tests/report for that
  Header work. The report now records the user's explicit acceptance.
- `static/screens.js` initially appeared modified, but its normalized Git blob matched HEAD
  (`f9ebdba1fb97f033aa3c78b56259f43b399bfbd5`); there was no content change to include.

No unfinished experiment was found in the pending diff. No backend, schema, dependency, provider
routing or deployment change is included. Existing accepted UI is preserved without further
product edits. Baseline preparation updates only tests and documentation: the obsolete Memory
serif assertion now checks the accepted UI font; the Reader test has an explicit functional-smoke
mode that retains real interactions and state assertions without claiming performance acceptance.
The Beta brief/index record the local checkpoint and pending private remote.

## Acceptance evidence

- Targeted JavaScript: **14 passed**, covering Inline entry/placement, Memory, Assistant navigator,
  Master marker, Overview lifecycle and Home continue.
- Targeted Python: **24 passed**, `tests/test_inline_teaching.py` (20) and `tests/test_memory.py` (4).
- Header branding and polish browser tests: **PASS**; 1600/1280/1024 widths, centered navigation,
  stable hover/focus geometry, Home/Overview/Memory navigation, file chooser cancellation, shared
  favicon geometry, forced colors and reduced motion.
- Memory browser regression: **PASS**; Memory → Book → Section/KP → item → retained Master source
  → Library → Memory → book list, including recovery and no browser page errors.
- Core Reader functional smoke: **PASS** at 1600px, no browser page errors. Real pointer selection,
  Assistant draft open/close/reopen, retained Master conversation, Guide, KP/dock switches and
  retained draft/scroll state; Inline card close/reopen, Escape/outside dismissal and Assistant
  handoff; outline/search/marks open/close.
- Fixture: isolated SQLite backup and copied blobs from `var/manual-browser`, a real 348-page
  textbook (SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`).
  The source Library is not modified; no PDF/database/secret enters Git.
- Memory run disables all providers. Reader smoke uses a dummy DeepSeek key, loopback endpoint
  `http://127.0.0.1:1/chat/completions`, and disabled Zhipu/OpenRouter; it never sends a prompt.
  This validates local interaction and retained content, not live generation or Review quality.

## Failed checks and bounded limitations

- Initial Memory run failed its obsolete serif expectation; updating the assertion to the
  accepted sans-serif specification made the real path pass.
- Initial Reader attempts with all providers disabled correctly encountered a disabled “问 AI”
  control. Subsequent runs use the test's fake key and loopback-only endpoint.
- Expanded performance probes did **not** pass: at 1440px, enabling Inline Teaching yielded
  toolbar control widths 609px/606px (3px overflow). At 1600px an Inline marker click initially
  triggered scrolling/virtualization; pre-scrolling the marker removed the DOM/scroll changes,
  but the probe still measured 166px PDF center error with the card open. These are unresolved
  layout/performance observations, not silently converted into PASS. The tested interactions
  remained operable. Review these before claiming all-width layout/performance acceptance.
- The first functional-mode attempt sampled Guide DOM before its asynchronous refresh settled;
  the runner now retains the original pre-action PDF settling and observation interval.
- `INTENTIONALLY_NOT_RUN`: full Python/E2E closure, OCR reprocessing, live model quality/cost tests
  and Linux/multi-user load tests. This is a user-requested checkpoint of accepted UI, not a new
  Phase closure; no backend/provider/deployment implementation changed. Heavy unrelated suites
  would not validate this diff. Beta prerequisites and acceptance remain in its own brief.

## Reproducible entry points

```powershell
node --test tests-js/inline-entry.test.js tests-js/inline-placement.test.js tests-js/memory-ui.test.js tests-js/assistant-navigator.test.js tests-js/master-marker.test.js tests-js/overview-lifecycle.test.js tests-js/home-continue.test.js
python -m pytest tests/test_inline_teaching.py tests/test_memory.py -q
$env:READER_DATA_DIR='D:\codex\408-guided-reader\var\manual-browser'
node tests-e2e/memory-navigation.mjs
$env:GUIDED_READER_DEEPSEEK_DISABLED='0'
$env:GUIDED_READER_DEEPSEEK_ENDPOINT='http://127.0.0.1:1/chat/completions'
$env:GUIDED_READER_ASSISTANT_PROVIDER='deepseek'
$env:GUIDED_READER_SYSTEM_PROVIDER='deepseek'
$env:READER_VIEWPORT_WIDTH='1600'
$env:READER_FUNCTIONAL_SMOKE='1'
node tests-e2e/reader-panel-performance.mjs
```

Run Header scripts with `READER_URL` pointing at an isolated prepared-Library service:
`node tests-e2e/header-branding.mjs` and `node tests-e2e/header-polish.mjs`.
Local screenshots and extended probe output are ignored under `test-results/`.

## Git checkpoint / next boundary

Resolve the local checkpoint with `git rev-parse personal-v0.1^{commit}`. No tag existed before
this operation; no existing tag is moved. The checkpoint includes accepted UI, its tests and
reports, and the Beta prerequisite status only. `git status --porcelain` must be empty afterward.
No remote exists, so no push is attempted and no repository is created. Obtain the user's private
GitHub repository URL, verify private visibility and remote history, then push `main` and the tag.
Code recovery uses this tag; personal-data recovery still requires a separate compatible backup.
Do not start FRIENDS_PRIVATE_BETA as part of this checkpoint task.
