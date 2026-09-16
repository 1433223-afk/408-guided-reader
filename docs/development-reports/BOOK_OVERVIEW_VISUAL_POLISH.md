# Book Overview visual polish

Status: USER_ACCEPTANCE PASS — explicitly confirmed by the user. Book Overview UI sealed;
checkpoint authorized, no further UI edits in this pass.

Scoped CSS only: 4px spacing rhythm; stable Chapter 29/40px 600 Serif, Section 20/30px 600
Sans, KP 15/24px 550 Sans. Metadata minimum 12px. Actual platform-font audit found the old
Serif stack mixing Source Han Heavy and SimSun; Overview now explicitly prefers the installed
Noto Serif SC family, verified to render the complete Chapter label at SemiBold. No font download
or dependency, global Home/Reader type tokens unchanged.

Section and KP titles share an inset, source controls share a right edge; ellipsis has reserved
space. Responsive left rail 240/208/192px with 40/32/24px gap at the requested widths. Navigation
page metadata moves onto its own line at <=1280px rather than compressing titles. Source and
state meanings, lifecycle, links and persistence unchanged. Native details block-size transitions
140ms when supported; unsupported browsers switch directly, reduced motion disables transitions.

Validation: lifecycle unit test PASS; tests-e2e/overview-polish.mjs PASS on live 8767 at
1600/1280/1024: stable typography, no overflow, aligned titles/source controls, metadata floor,
no hover/focus geometry movement, collapse/reopen, actual NOT_PREPARED/FAILED Chapter heading
consistency, reduced-motion fallback. No full-book regression or generation calls.
Screenshots: test-results/overview-polish-1600.png, overview-polish-1280.png,
overview-polish-1024.png, overview-polish-expanded.png. Local visual evidence, not committed.

Checkpoint checks: overview-lifecycle.test.js PASS; overview-polish.mjs PASS at all three widths;
overview-sections.mjs PASS including independent Section source action, stable hover/focus,
correct KP PDF 169 / Y 0.3195564449, and Back. No unrelated/full-book regression.
Only scoped CSS, this report and the responsive test enter the checkpoint; other worktree
changes remain uncommitted.

## Follow-up visual polish — 2026-09-16

READY_FOR_USER_RETEST for this follow-up; the user accepted the previous direction and requested
this additional CSS-only adjustment. Content width capped at 1120px, chapter rail reduced to 216px
(176px at <=1100), main map capped at 800px and Section/KP reading groups at 760px. Top spacing is
reduced, Chapter remains editorial 30/40px while Section is lighter 18/28px 500. Expanded Section
uses 1.5% green tint without the inset stripe. KP states consistently use muted green, muted warm
neutral and gray-green; dots inherit their status text color. The existing ellipsis is visually
aligned with Chapter metadata with reserved room, and 1024px rows/spacing are denser. No new UI,
border, explanatory text, IA, event handler or business-state change.

Real-book overview-polish.mjs PASS at 1600/1280/1024: no overflow, title/PDF alignment, stable
hover/focus geometry, native Section collapse/reopen, heading consistency and reduced motion.
Screenshots visually inspected at 1600 and 1024. No broad E2E or generation requests.

Checkpoint requested by the user on 2026-09-16. This records the tested follow-up;
no additional user-acceptance result is inferred from the commit request.
