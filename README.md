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

## Run the R1 reader in a normal Windows browser

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
real-browser R1 flow is exercised with:

```powershell
$env:READER_REAL_PDF='D:\path\to\a-real-scan.pdf'
npm run test:e2e
```

R1 deliberately contains no OCR, selection, outline, annotations, or AI code.
