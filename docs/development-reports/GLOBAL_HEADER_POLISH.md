# Global Header final polish

Status: USER_ACCEPTED (2026-09-16). The user confirmed UI closure and acceptance when
requesting the personal stable baseline. Fresh regression evidence is recorded in
`PERSONAL_STABLE_BASELINE.md`.

Scoped Header CSS only. Existing 55px height retained so page content does not move. Equal
flexible side columns keep the center navigation at the viewport midpoint. Brand artwork and
20px size unchanged, wordmark 14px/500 UI Sans, navigation 13px, action 13px/500. Active underline
is 1px and follows the text width; hover changes color only. Import uses a light gray-green fill
and fine border. Existing per-page action ownership remains intact (Memory's return action is
not replaced by a new import flow). All feedback is 120ms, no movement/scale; reduced motion
removes transitions. No page content, routes or business logic changed.

Header-only tests PASS: header-branding.mjs (mark/currentColor/forced colors, favicon identity,
file chooser and navigation) and header-polish.mjs (1600/1280/1024 centered navigation, no
overlap, 55px height, stable fonts/hover/focus geometry, Home/Overview/Memory parity, reduced
motion). No expanded regression. Local screenshots: test-results/header-polish-1600.png,
header-polish-1280.png, header-polish-1024.png.
