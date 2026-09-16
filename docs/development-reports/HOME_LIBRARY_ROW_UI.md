# Home Library row interaction

Status: USER_ACCEPTANCE PASS — explicitly confirmed by the user; checkpoint authorized.

Library-only UI refinement: the existing native Open action now stretches across the row,
retaining its existing Book Overview destination and an explicit 打开 → button. The independent
details menu contains Overview, existing Add Version and Delete actions, and closes with Escape.
The duplicate preparation-status metadata is removed. No cover, Continue, Memory, source,
learning semantics or persistence changes.

Rows use a 120ms subtle gray-green hover/focus tint with an explicit focus ring; the menu fades
from low emphasis on row hover/focus. The menu is absolutely positioned inside its stable slot,
so opening it does not displace row controls. Reduced motion disables transitions. No page
crossfade, scale, elevation or additional metadata.

Validation: tests-js/home-continue.test.js 2/2 PASS; tests-e2e/library-row.mjs PASS against real
127.0.0.1:8767 Library (2026数据结构): body click, correct Overview title, Back, menu Overview,
keyboard Open, Enter/Escape menu, reduced motion, zero page errors. Initial test attempts raced
the existing asynchronous Home refresh; test waits now observe completion before keyboard focus.
No product lifecycle changes were needed. No full-book/unrelated regression run.

Screenshots in test-results: library-row-default.png, library-row-hover.png,
library-row-menu.png, library-row-focus.png. These remain local and uncommitted.

User-approved direction, final visual refinement: row focus uses a muted 2px inset outline;
hover tint reduced to 2.5%; menu minimum width 136px with 30px content rows. Delete alone uses
muted danger text; other menu items use ink. Existing native button focus ring remains clear.
Home tests 2/2 and real Library targeted browser test PASS again; screenshots refreshed.
No structural or behavior change. Final refinement accepted by the user.

Checkpoint verification: Home tests 2/2 PASS; real Library test PASS for row body and explicit
Open, Overview menu, Add Version file chooser (no file submitted), Delete confirmation/cancel
(no real textbook deleted), keyboard visibility/activation, unchanged row bounds under hover
and focus, and reduced motion. Cover and Continue code are unchanged in this checkpoint.
