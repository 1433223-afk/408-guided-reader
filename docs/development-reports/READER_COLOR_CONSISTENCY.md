# Reader color consistency — 2026-09-13

## Result

`READY_FOR_USER_RETEST`. Color-only Reader cleanup.
No user acceptance PASS. Refresh http://127.0.0.1:8767/; no backend restart required.

## Changes

- Deep green actions, hover/active and confirmations; paper-white panel surfaces;
  gray-green neutral states, borders, metadata and code backgrounds; deep ink content.
- Search CTA/results, Inline Teaching card/actions, Guide menus/source controls,
  Notes/teaching markers, Assistant/Master actions and Reader toolbar states follow
  the same palette. “继续问 Assistant” uses deep green; source-return actions use green.
- Small inactive Teaching markers and yellow annotation swatches retain clear warm yellow.
  Yellow was not globally replaced with green. Active Teaching marker uses green.
- PDF/OCR selection stays transparent blue. Search source highlighting changes from
  purple to the same transparent blue family, keeping geometry and animation timing.
- Errors/failures/deletion use red; pending and unconfirmed states stay neutral.
  Native browser tooltips remain browser-controlled; no new tooltip component.

Only color declarations and Reader-scoped color variables were added to screens.css.
No product JavaScript, DOM structure, dimensions, spacing, positioning, PDF rendering,
source authority, learning semantics or responsive interaction changes. Selection toolbar
lives beside Reader in the DOM, so its existing ID is scoped separately.

## Real-use evidence and screenshots

Real 348-page textbook SHA256:
6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd.
Disposable library copies; no user data mutations or external model calls.

Same-scene before/after screenshots (ignored local artifacts):
- test-results/reader-colors-before-search.png
- test-results/reader-colors-after-search.png
- test-results/reader-colors-before-inline.png
- test-results/reader-colors-after-inline.png

reader-restoration verifies original PDF canvas pixels and reader/panel geometry against
92febf6 at 1600/1280/1024px, plus search -> source, Notes, KP/Master and toolbar controls.
Inline harness verifies generation/Review, display/off/on, source actions, Assistant,
regeneration failure/retry, menu and responsive/zoom paths with loopback providers.
The only harness additions are opt-in screenshot captures via READER_COLOR_CAPTURE.

## Checkpoint

The commit containing this report is the checkpoint. No acceptance authority claimed.

Final verification: reader-restoration, inline-teaching and ask-about-this served harnesses PASS.
JavaScript 40 PASS; Python 285 PASS / 2 existing optional OCR skips, 172.660s.
Closure XML: test-results/reader-colors-closure.xml. Whitespace checks PASS.
Before/after screenshots visually inspected at matching viewport/page/control states.
