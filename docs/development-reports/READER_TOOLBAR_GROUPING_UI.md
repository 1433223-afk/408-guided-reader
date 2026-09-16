# Reader toolbar grouping — reverted

User rejected the proposed grouping polish and requested restoration of the prior appearance.
Removed the uncommitted right-toolbar CSS override, including the changed compact zoom breakpoint;
restored the READY label to N 个知识点. Removed the proposal-specific test. No Reader handler,
PDF geometry, panel or business semantics changed.

The prior toolbar is already in HEAD, so this checkpoint records the restoration decision;
there is no net toolbar code change to commit. Unrelated Global Header polish and Inline Teaching
work remain untouched and unstaged.

Validation: live 8767 toolbar check PASS for restored gap, READY label and original compact-menu breakpoint. Screenshot: test-results/reader-toolbar-restored.png.
