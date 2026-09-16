# 408 Guided Reader

**408 导学阅读器** — a new project.

> The original PDF remains the book. AI becomes the teacher attached to the book.

The reader keeps the original 408 textbook as the permanent reading surface, progressively builds a
machine-readable layer around it, creates stable learning structure only where it is needed, and
adds optional AI teaching exactly where a learner wants a teacher — without replacing the book.

See `PRODUCT_BLUEPRINT.md` for what the product is.

---

## Project identity

This is a **new project**, not a version of any previous one. It may selectively reuse proven
components from the earlier `408-ai-ebook` repository, but that repository's product rules, phase
decisions and domain model carry **no authority here**.

## Authority boundaries

| Document | Role | Status |
|---|---|---|
| `AGENTS.md` | Entry point and routing — identifies current authority and working rules | Active |
| `PRODUCT_BLUEPRINT.md` | **Product authority** — what the product is and must do | Frozen at Gate D |
| `IMPLEMENTATION_BLUEPRINT.md` | **Engineering authority** — architecture, contracts, phases | Frozen at Gate D |
| `docs/archive/transition/**` | Historical / audit / transition evidence | **Never authority.** Not cold-start reading. |

Read `AGENTS.md` first. It is short and tells you where to go next.

## Run the reader in a normal Windows browser

Prerequisites: Python 3.11+, Node.js 20+, and Chrome or Edge.

```powershell
cd D:\codex\408-guided-reader
python -m pip install -e .[test]
npm install
guided-reader
```

Keep that PowerShell window open. This single Core Service process serves both the frontend and API,
binds only to `127.0.0.1:8765`, prints `READY http://127.0.0.1:8765/`, and asks Windows to open the
default browser. Opening that plain localhost URL establishes an HttpOnly, same-site launch session;
there is no second frontend/API process or port to start.
If it does not open Chrome/Edge automatically, copy the complete printed URL into a normal Chrome or
Edge address bar. `python -m reader_service` is an equivalent startup command if the
`guided-reader` script is not on `PATH`.

Runtime data is stored outside the repository under the user's local application-data directory.
Override it for development with `guided-reader --data-dir D:\some\reader-data`. The loopback bind is
intentional: no firewall rule, LAN exposure, container port forwarding, or `0.0.0.0` bind is needed.

When a Core Service is started by a transient Codex/tool execution, that execution environment may
terminate the child process when its task ends. That is not a repository networking failure. For an
interactive session in the user's normal browser, run the command above directly in the user's own
PowerShell and leave it running.

Run the deterministic and service tests with `pytest` and the geometry tests with `npm test`. The
real-browser reading and R2 selectable-page flows are exercised with:

```powershell
$env:READER_REAL_PDF='D:\path\to\a-real-scan.pdf'
npm run test:e2e
npm run test:e2e:r2
npm run test:e2e:recovery
```

R3's formal annotation walkthrough reuses an app data directory that already contains the prepared,
hash-verified 29-page sample and 348-page complete scan. The same prepared library drives Find in
Book and Map the Book acceptance:

```powershell
$env:READER_DATA_DIR='D:\path\to\reader-data'
npm run test:e2e:r3
npm run test:e2e:find
npm run test:e2e:map
npm run test:e2e:ask
```

Opening a book schedules progressive page preparation. The visible page and nearby pages take
priority; the original PDF canvas remains readable while preparation runs or if one page fails. A
prepared page has a transparent text overlay: drag across one or more lines, then use the normal
copy shortcut or save the selection as a highlight with an optional short note. The page's **Marks**
button shows saved quotes/notes and the delete affordance. The Reader's **目录** button opens the
book's bookmark/TOC-derived logical directory; known targets navigate through the same original-PDF
page path. The toolbar shows a validated printed-page label when known and lets the user persist a
per-page manual label when inference must remain UNKNOWN. `--prepare-workers` (1–4, default 1) and
`--render-dpi` (default 200) are development tuning controls.

On a prepared page, selecting original-PDF text and right-clicking exposes **问 AI** when at least one
named model is available. Every textbook selection starts a retained temporary explanation topic;
select text in the current Assistant answer to **再问一层**, up to depth 5. The compact side panel can
switch topics, return to a parent explanation, continue at the same level, or close one topic and its
deeper explanations. Provider/model is fixed within each topic; all topics clear when the Reader
closes. A completed Assistant answer can be explicitly saved to Notes; the resulting AI-labelled
Annotation is committed immediately, while a separately configured reviewer updates only its
verification metadata. Review failure never removes the saved explanation. Store keys as Windows
**Generic Credentials** using the fixed targets documented in
`.env.example`; keys are never stored in the app database or config files. Exact provider request
bodies are available only from the authenticated localhost process-memory surface at
`/api/assistant/inspection`; this bounded buffer and all explanation state disappear on service restart.

The inherited nine-page real OCR suite uses external, hash-checked textbook files and runs only when
both paths are supplied:

```powershell
$env:READER_REAL_PRIMARY='D:\path\to\2026计算机组成原理_第1-29页.pdf'
$env:READER_REAL_DMA='D:\path\to\2026计算机组成原理_第320-348页.pdf'
pytest tests/test_real_ocr_acceptance.py
```

The current product still contains no body-heading detection, Pass 2 range refinement, layout
regions, correction-tier UI, chapter preparation, structure-scoped search, persistent Assistant
history, or multimodal explanation.
