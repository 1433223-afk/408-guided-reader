# Home Continue Learning — 2026-09-16

Status: USER_ACCEPTANCE PASS — explicitly confirmed by the user after the large/small cover
refinement; checkpoint authorized. Earlier pending statuses below describe their validation stage.

User-scoped local Home change plus explicitly requested global font-family normalization.
Continue projects Book < Section < Subsection visual priority, using only the existing reading-context
response. Missing deeper context falls back honestly to Chapter; no guessed location or mastery.
Chapter counts format as confirmed (UNDERSTOOD + NOT_FULLY_CLEAR) / all KPs, with a three-part
3px green / warm-yellow / gray strip and an accessible textual breakdown. No denominator is
invented when counts are unavailable. A stretched native Continue button makes the content clickable
while retaining the explicit CTA, keyboard activation, and independent secondary Overview action.

All explicit application UI font stacks in styles.css/screens.css use the requested shared Chinese
Sans token; editorial roles use the requested Serif token. Code/KaTeX/PDF fonts are unchanged.
Home metadata is at least 12px and actions 13px. The initial vertical Chinese spine was superseded
by the user-requested abstract cover family below.
No layout or functional edits outside Home; unrelated existing Memory changes remain in the worktree.
No provider/backend/storage/reading-position/authority change, dependency or new page transition.
Hover feedback is 120ms and disabled for reduced-motion.

Validation: Home-only frontend test PASS (Section/Subsection, count formatting, absent context,
no saved position, preserved read target). Home-only real-material browser test PASS on an isolated
SQLite backup and blob copy of the existing 348-page textbook. Actual saved PDF 37 / normalized
0.4539007092 restored within 0.003; real counts 5 understood + 8 unclear + 34 unconfirmed. Body-click,
keyboard CTA, Back, and independent Overview entry work. In that isolated library, actual Reader
page navigation to PDF 53 followed by Back produces Section 2.2 and Subsection 2.2.1, and Continue
reopens Reader. Original library untouched; zero external provider calls. No 348-page full-feature
regression or unrelated suites run, per explicit user testing scope.

Local screenshots: test-results/home-continue-default.png, home-continue-hover.png,
home-continue-progress.png, home-continue-reader.png; additional resolved subsection example:
home-continue-section.png. Screenshots and original textbook are not committed.

## Abstract cover family (user follow-up)

Continue and Library now share one native SVG cover component: paper margin, fine border,
restrained geometry and a tiny Latin identifier. COA uses pine green modular blocks; DS uses
mist blue-green grid/nodes/connections; other books use gray-green overlapping planes (408).
Chinese titles and reading metadata remain outside the cover. Both sizes reuse the same artwork.
No dependencies or generated raster assets were introduced.

The presentation helper accepts optional userCoverUrl/defaultVariant: a successfully loaded local
user image takes precedence over the inferred/explicit system variant, then the generic fallback.
A broken user image leaves the built-in cover visible. This reserves an interface only; upload,
Book schema and persistence are unchanged.

Targeted Home tests cover cover selection, user image precedence and failure fallback. Real-book
Home browser validation passed with the 348-page COA and 412-page DS books, including Continue,
correct PDF position, Back and Overview. Both cover variants contain no Chinese title text.
Visual inspection: test-results/home-abstract-covers.png. No broad regression run, per user scope.

Accepted-direction finishing pass: DS background is now mist blue #637e90, while COA retains
pine #304d40. The outer CSS border is transparent with its dimensions retained, removing the
image-container outline without moving Home content. No cover text or interaction was added.
Home-only visual check on the live real-book library confirmed identical SVG markup for the
same book in Continue and Library; only dimensions differ. Screenshot: home-cover-finish.png.

## Ten-cover family extension

Preserved COA/DS artwork and palette; added OS slate-blue scheduling layers and CN cold-teal
topology, plus Grid, Node, Layer, Flow, Block and Signal generic illustrations. Generic covers
contain no text. Shared paper margins and transparent outer border remain unchanged.
BOOK_COVER_FAMILY defines variant metadata. Core Chinese/English book titles resolve to dedicated
variants; otherwise a stable hash of Book ID (title if absent) selects one of six generic covers.
This is deterministic rotation, not uniqueness: larger libraries may share a variant. No list-order
or reading-recency dependency. Optional presentation book.cover = {variant, userCoverUrl} reserves
future mapping/upload integration without changing the database, API or upload behavior.

Cover-only browser test PASS: ten distinct artworks, identical large/small SVG for every variant,
four bilingual title matches, six generic allocations, ID stability across rename, user-image
precedence and broken-image fallback. Inspected both sizes using actual component and Home CSS:
test-results/home-cover-family-sheet.png (isolated visual sheet, not a Library screenshot).
Live Home screenshot attempt could not run because port 8767 refused the connection; no live
navigation or unrelated regression is claimed for this pass. Home layout/interaction untouched.

### Live Home follow-up

Started 127.0.0.1:8767 against var/manual-browser; listener left running for user acceptance.
Home/cover targeted tests: 2 PASS. Actual Home browser path PASS: COA/DS dedicated covers,
identical Continue/Library SVG, undistorted fitted artwork, no Chinese cover text; content click
and explicit Continue CTA, saved PDF 43 / offset 0.2737588652 restored, Back and Overview work,
zero page errors. Six synthetic generic identities tested through the served resolver before/after
reload and reversed ordering: assignments unchanged; no synthetic books persisted.
Inspected OS/CN and six generic designs at both sizes in a temporary browser-only preview using
the served component/CSS: coherent family, distinguishable silhouettes, readable small patterns.
Real Home screenshot: test-results/home-8767-accepted-family.png; Reader evidence:
home-8767-continue-reader.png; separate preview: home-8767-family-preview.png.
No product changes in this verification pass. Cover extension adds no migration, database writes,
or durable persistence semantics: only optional UI metadata and a rendering resolver.
No 348-page/full-feature regression run. READY_FOR_USER_RETEST; user acceptance pending.

### Size-specific cover density (user-approved rule change)

The previous identical-SVG requirement is superseded: the same variant now has large/small
artwork with shared palette and identity. Library selects small density; Continue selects large.
All ten small compositions remove secondary details and enlarge core geometry. DS is a branching
tree, CN a mesh/routed topology, Generic Node a radial hub; Generic Block is a stepped silhouette
distinct from COA's structural modules. No Home CSS, layout, actions or persistence changed.
Cover-only test PASS for variant/palette continuity, distinct densities and existing assignment/
custom-image fallback contracts. Served component visually inspected at 104/40/56px:
test-results/home-cover-density.png. Small details remain separable at 40px. No broad tests run.
