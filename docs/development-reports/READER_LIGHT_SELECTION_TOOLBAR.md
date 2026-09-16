# Reader light selection toolbar — 2026-09-13

## Result

Reader selection toolbar uses a paper-white floating surface, thin gray-green border,
subtle shadow and deep-ink text. Primary actions use pale green emphasis rather than
white-on-dark fill. Hover/pressed feedback is quiet; the close action is muted. Button
heights/padding/radii are locally unified. Yellow remains bright; checked color swatches
have a dark-green ring separated from the swatch by a paper-colored gap.

No controls, order, handlers, selection geometry, persistence or business semantics changed.
Product changes are CSS scoped to #selection-actions. Previously requested Inline marker
fill/border corrections (both green) are retained in the same pending CSS checkpoint.

## Evidence

Before/after captured through actual OCR pointer selection on PDF page 303 in a disposable
copy of the real 348-page textbook. Original SHA256:
6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd.

- test-results/selection-toolbar-before.png / selection-toolbar-after.png: full scene.
- test-results/selection-toolbar-before-detail.png / selection-toolbar-after-detail.png:
  matching toolbar closeups.
- test-results/selection-toolbar-after-note.png: note editor open.

Screenshots visually inspected; transparent blue selected text retained. Served Assistant
harness covers OCR selection -> Ask, context/Child/Back/close/retry and Reader lifecycle.
The capture path also switches green/yellow, opens/fills/closes the note editor, then uses
Ask normally. No user data is modified; provider-dependent checks use loopback fixtures.
No extra product state or test-only product code was introduced.

## Retest

Refresh http://127.0.0.1:8767/ and select PDF text. Stop for user acceptance;
no USER_ACCEPTANCE PASS. Commit containing this report is the checkpoint.

Final status: READY_FOR_USER_RETEST. Served before/after/interaction harness PASS;
JavaScript 40 PASS; Python 285 PASS / 2 existing optional OCR skips
(145.236s). XML: test-results/selection-toolbar-closure.xml. Whitespace checks PASS.

## User-approved direction and final small adjustments — 2026-09-13

User explicitly accepted the visual direction and requested closing this item after two
small changes. Completed: color choices are initially hidden each time the selection
menu opens; first Highlight click reveals them, a subsequent Highlight click uses the
existing save action. Color selection and Note save semantics remain intact. Expansion
uses existing positioning/clamping, with aria-expanded/aria-controls. Shadow reduced to
0 2px 8px at 6% opacity. No other style or business changes.

Actual real-PDF path PASS: initially collapsed -> expand -> green/yellow -> Note editor
open/close -> save highlight -> reselect (collapsed again) -> Ask and existing recovery.
JavaScript closure suite 40 PASS; syntax/diff checks PASS. Backend unchanged; Python
closure from the immediately preceding implementation remains applicable. Other older
annotation harness selectors were updated to expand before choosing/saving a highlight;
those full older harnesses were not rerun. Final collapsed screenshot visually inspected.

This item is closed per the user's explicit completion instruction; no new independent
user-acceptance result is asserted for these final adjustments.
