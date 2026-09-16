# Reader single right Dock — 2026-09-16

Status: CLOSED — USER_ACCEPTANCE PASS. The user accepted this change and requested its
checkpoint commit on 2026-09-16 ("可以通过，提交commit").

The user authorized a local Reader ownership change: knowledge points, Guide and the shared
Assistant/Master workspace occupy one right-hand slot, with only one visible at a time.

The existing AI and Guide entry points now claim that slot and hide their peers. Knowledge points
use the same second Grid column rather than a fixed overlay on desktop. Assistant/Master keep their
existing internal tabs and mounted workspace. Guide has a non-destructive suspension path: switching
away retains its content, stream state and scroll, and returning to the same section restores them.
Guide selection → Assistant also uses suspension. Knowledge navigation restores per-chapter scroll.
Guide and AI write the same bounded Dock width; knowledge navigation inherits it. Existing resize
handles remain attached to their workspaces to preserve pointer ownership; no new resize system or
PDF relayout was introduced. Narrow-screen temporary presentation remains responsive.

Validation: two focused JS tests (Assistant navigator and Master marker) PASS. The real 348-page
Reader resize-only script PASS, extended with Guide → Assistant → Guide → KP → Assistant/Master →
Guide → Assistant/Master → KP → close. It verifies mutual exclusion, Guide DOM/scroll retention,
KP scroll retention, and retained Master title, composer draft and history scroll. The test opens an
Assistant selection shell without a provider call. It does not claim a new provider conversation test.
Existing probes show unchanged canvas/wrapper identity, dimensions, page/zoom/scroll, zero PDF DOM
removals, no measured Long Task >=50ms, full-width toolbar and recentering on Dock close.

No full E2E or all-book/all-function suite was run, as explicitly requested for this local fix.
Backend semantics, source authority and mastery writes were not changed by this work. Pre-existing
and concurrently edited files from other work remain intact; this report describes only this delta.
