# Guided Reader Page + Guide branding

Status: USER_ACCEPTANCE PASS — explicitly confirmed by the user; checkpoint authorized.

Original clean inline SVG follows the user-confirmed reference: open page contour, reading/guide
curve and one node. No stock BookOpen icon, raster asset, library, numeric logo or decorative
container. Header is 20px, stroke 1.75 in a 24-unit viewBox, currentColor, 8px gap, existing UI
Sans wordmark 14px/500. Hover opacity 120ms, no transform; reduced motion disables transition,
forced-colors uses CanvasText. Header navigation and actions untouched.

Shared header helper and initial HTML use the same SVG. SVG favicon is embedded as a data URL
to avoid changing static server routing; guided-reader-icon.svg is the matching vector app-icon
artifact, pine background/paper mark. Browser title drops the content-specific 408 prefix.

Branding-only live 8767 check PASS: 20x20 geometry, 8px gap, transparent background, Guided Reader
text, no transform, favicon equality to vector artifact. Visual review of 16/20px marks, 16px
favicon, 96px app icon and monochrome sample. Screenshots: test-results/brand-before.png,
brand-after.png, brand-comparison.png. No unrelated regression or business changes.

Checkpoint: tests-e2e/header-branding.mjs PASS on live 8767. Verified custom SVG/currentColor,
transparent 20px mark, favicon path identity, forced-colors stroke inheritance, stable hover,
Home -> Memory -> Home header navigation and import file chooser (canceled without upload).
16px clarity uses the user-accepted visual sheet. No Logo/Header edits after acceptance.
