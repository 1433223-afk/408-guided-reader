// PNG vs current-worktree compact PDF.js. Both share the current Tablet startup
// strategy and the same isolated Core/OCR/network fixture.
// Run: node tests-e2e/tablet-page-opening.mjs
// Optional slower condition: READER_OPENING_SLOW=1 (1MiB/s, 100ms).
process.env.READER_OPENING_VARIANT = 'page-images';
await import('./tablet-opening.mjs');
