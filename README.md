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
| `PRODUCT_BLUEPRINT.md` | **Product authority** — what the product is and must do | Active |
| `IMPLEMENTATION_BLUEPRINT.md` | **Engineering authority** — architecture, contracts, phases | **Does not exist yet.** Becomes authority only once written, reviewed and frozen. |
| `docs/archive/transition/**` | Historical / audit / transition evidence | **Never authority.** Not cold-start reading. |

Read `AGENTS.md` first. It is short and tells you where to go next.

## Current state

Repository baseline only. **No engineering architecture has been chosen** — no framework, ORM,
database schema, migration root, package layout, task runtime, OCR engine or dependency set. Those
decisions belong to `IMPLEMENTATION_BLUEPRINT.md` and have not been made.

No implementation code is present, and none should be added before that document is frozen.
