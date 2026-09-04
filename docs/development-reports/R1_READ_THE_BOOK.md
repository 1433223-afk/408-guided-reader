# R1 — Read the Book Development Report

## Result

`IMPLEMENTATION_READY` — a user can manage books on Library/Home, open an original PDF into a
separate Reader surface, navigate by page or scroll, zoom without losing the reading anchor, return
to Library, and reopen the book on the same PDF page and in-page position. Byte-identical re-import is
a no-op; a different PDF can be attached as a new immutable source revision.

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` — the required ~700-page scanned textbook was not available.
R1 was exercised with the largest available real excerpt (29 pages), so sustained virtualization and
deep navigation at the intended full-book scale have not genuinely been tested.

## Implemented

- Library context with `Book`, `BookSourceRevision`, and `ReadingPosition` persistence in SQLite (WAL,
  foreign keys enabled, explicit initial migration).
- Streamed PDF intake with SHA-256 identity, size limit, structural validation, encryption rejection,
  page count/media-box/rotation capture, atomic blob publication, duplicate no-op, and immutable source
  revision supersession.
- Contained managed storage through one path helper; shared content-addressed blobs; successful delete
  removes database rows and unreferenced blobs. Failed deletion becomes a non-readable, retryable state.
- Token-protected loopback HTTP Core Service with library, intake, PDF range-serving, position, and
  deletion endpoints.
- Browser Reader using the original PDF canvas as its only reading surface: scroll and page navigation,
  DPR-aware rendering, anchor-preserving mouse/keyboard/button zoom, mixed-size placeholders, and
  viewport-window canvas virtualization.
- Separate Library/Home and Reader surfaces. Import, book list, revision, and removal stay on Home;
  Reader contains only return navigation, current-book identity, page/zoom controls, and the PDF.
- One normalized top-left geometry module covering PDF media-box origins and 0/90/180/270-degree
  rotation. No OCR, text layer, selection, outline, annotations, or AI code exists in R1.

## Important implementation decisions

- The Core Service uses Python's standard HTTP and SQLite libraries rather than adding a web framework
  or ORM. Persistence classes remain separate from plain service/domain data.
- Browser rendering is `pdfjs-dist` 6.3.289 (Apache-2.0), the conventional Chromium rendering choice
  delegated by the Phase brief. Intake validation/metadata uses `pypdf` 6.x (BSD-3-Clause). Exact
  versions are locked where applicable.
- The browser uploads the selected file body directly to the local service. It never uses `file://` or
  a privileged host bridge, preserving the frozen packaging boundary.
- Position stores zero-based PDF page index, normalized offset within the page, and zoom. Page labels or
  inferred printed pagination are intentionally absent.

## Deviations from Spec

None in implemented scope. The 700-page material gap is an explicitly declared acceptance limitation,
not a downgraded criterion.

## R1 real-use correction

Real use found that the Codex-started service did not remain available to an external browser after
the tool execution ended, high-DPI canvases could be undersampled, zoom could move the reading point,
and the permanent Library sidebar diluted the Reader surface.

- The server's `127.0.0.1` bind was already correct. Installed Chrome reached the loopback service
  while it was running. The access failure was the transient Codex execution lifecycle, not a
  repository networking defect; README now gives a direct user-PowerShell startup path and explains
  that the terminal must remain open and the complete printed tokenized URL can be pasted into normal
  Chrome/Edge.
- Canvas output no longer caps DPR at 2 or rounds backing dimensions down. Backing dimensions round up
  and the PDF.js render transform uses the exact backing/CSS ratio on every virtualized re-render.
- Zoom captures a page-local normalized `(x, y)` plus its viewport position and restores that anchor
  after relayout. Toolbar/keyboard zoom uses the viewport center; Ctrl+wheel uses the point under the
  pointer. Ctrl+`+`/`=` and Ctrl+`-` are handled only while the Reader viewport has focus.
- Manual image comparison used PDF page 12 at approximately the same displayed width in the corrected
  Reader and Chrome's built-in PDF viewer. No additional softness attributable to canvas undersampling
  was visible after the fix.

## Acceptance evidence

- `pytest`: **11 passed**. Covers containment (including Windows post-creation path
  canonicalization), atomic/deduplicated intake behavior, immutable revision
  creation, shared-blob deletion, retryable delete failure, corrupt/encrypted rejection with no commit,
  position validation/persistence, token enforcement, and PDF byte-range serving.
- `npm test`: **25 passed**. Covers normalized point/rect round trips for all four rotations, non-zero
  media-box origins, and mixed page sizes.
- `npm run test:e2e`: **PASS** in installed Google Chrome with AI absent. Used
  `D:\codex\408-ai-ebook-samples\phase03\primary\2026计算机组成原理_第1-29页.pdf`, 12,582,672 bytes,
  SHA-256 `327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1`.
  The browser verified Library → Reader → Library transitions, no permanent Library sidebar, import,
  duplicate no-op, removal, and reopen at PDF page 12 / 120% zoom. At simulated Windows DPR 2.5 the
  canvas output scale was 2.5 with 3 resident canvases for 29 placeholders. Toolbar anchor drift was
  ~0.00017 normalized page units and pointer anchor drift ~0.00011. Ctrl+wheel, Ctrl+`+`, and Ctrl+`-`
  passed. Corrected Reader, Library, and Chrome built-in-viewer comparison screens were visually
  inspected.
- A materially different source revision is covered deterministically with synthetic PDFs whose
  geometry and identity are exact. The available second 29-page real excerpt was not required to prove
  the source-identity rule and was not used as a substitute for the missing complete textbook.
- **Not tested:** the frozen ~700-page real scanned textbook criterion. Long-range navigation,
  sustained scrolling, canvas eviction, and position persistence hundreds of pages deep remain
  `FULL_REAL_MATERIAL_ACCEPTANCE_PENDING` until that user material is supplied or the user explicitly
  accepts the 29-page excerpt as final R1 closure.
- Ancillary environment checks did not produce a clean result: npm's configured mirror lacks the audit
  endpoint, and one bounded retry against npmjs.org ended in a socket hang-up. The system-wide Python
  environment also has an unrelated pre-existing `httpcore2`/`h11` version mismatch reported by
  `pip check`; R1 does not depend on either package.

## Known limitations / deferred debt

- Full-book scale acceptance needs a representative ~700-page scan. No complete book was available.
- Packaging remains deferred by the Frozen Core; R1 runs as a standalone local Python service plus the
  supported installed Chrome/Edge browser.
- Dependency vulnerability audit evidence is unavailable because both audit endpoint attempts failed;
  this is not recorded as a pass.

## Reproducible entry points

```powershell
python -m pip install -e '.[test]'
npm install
guided-reader

pytest
npm test
$env:READER_REAL_PDF='D:\codex\408-ai-ebook-samples\phase03\primary\2026计算机组成原理_第1-29页.pdf'
npm run test:e2e
```

Manual acceptance: start `guided-reader` in the user's own PowerShell and leave it running; open the
printed tokenized URL in normal Chrome/Edge; import the hash-verified 29-page sample; open it from
Library; scroll and jump among PDF pages; compare page 12 with Chrome's built-in viewer; exercise
button, Ctrl+wheel, Ctrl+`+`, and Ctrl+`-` zoom; return to Library; reopen the book and confirm
page/offset/zoom restoration. Repeat at hundreds-of-pages scale when the missing full scan becomes
available.

## Important files / architecture entry points

- `src/reader_service/library/service.py` — intake, validation, immutable blob/revision, and deletion
  orchestration.
- `src/reader_service/library/database.py` and `repository.py` — explicit schema migration and Library
  persistence.
- `src/reader_service/storage.py` — managed-path containment and atomic blob store.
- `src/reader_service/server.py` — tokenized loopback API and original-PDF range serving.
- `src/reader_service/static/app.js` — Reader flow and canvas virtualization.
- `src/reader_service/static/geometry.js` — shared normalized coordinate conversion.
- `tests-e2e/reader.mjs` — real-browser R1 acceptance path.

## Git checkpoint

Implementation checkpoint: `88ec5bc` (`feat: deliver R1 original PDF reader`). Windows packaged-app
data-directory compatibility follow-up: `14f45f0` (`fix: handle virtualized Windows data directory`).
Real-use correction checkpoint: `b2ea679` (`fix: apply R1 real-use reader corrections`).
