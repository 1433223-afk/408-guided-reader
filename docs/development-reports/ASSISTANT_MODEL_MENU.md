# Assistant model menu — 2026-09-13

## Result

Product-owned paper model menu replaces the system-rendered dropdown. Current selection
uses muted dark green and paper text; hover uses pale gray-green, keyboard focus a green
outline. Full provider/model names remain in options; trigger keeps the short model name.
Menu has a thin border/light shadow and is horizontally clamped into the viewport.

The native select is hidden but remains the source of values, option availability,
change event and disabled/locked state. The visual adapter forwards one change event to
existing switching logic; no provider routing, root locking or lifecycle changes.
Keyboard Arrow/Home/End navigate, Enter/Space commit, Escape cancels, Tab/outside closes.

## Validation

- Existing JS suite 40 PASS plus new targeted keyboard/lock test PASS.
- Actual served real-textbook Assistant harness PASS: mouse selection, keyboard open/
  Escape, unavailable-provider behavior, locked roots and full existing recursion/recovery.
  Uses loopback providers; zero external calls.
- Screenshot visually inspected: test-results/assistant-model-menu-detail.png and
  assistant-model-menu.png. No system blue UI remains in the product-owned menu.
- Five older/real-provider harnesses have their native-select interactions updated to the
  new trigger/options; these were not rerun and no external provider calls were made.
- Syntax/diff checks PASS. No backend, dependency, schema or PDF geometry change.

Implementation: createAssistantModelMenu in existing screens.js, sync from existing
syncModelSelector; styles scoped to this menu. Commit containing report is checkpoint.
Refresh http://127.0.0.1:8767/ and open a new-context Assistant draft to inspect unlocked
model menu. Existing explanation trees correctly retain model locking.
Stop for user retest; no user-acceptance claim.
