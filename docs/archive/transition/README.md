# Transition evidence — NOT AUTHORITY

**Everything in this directory is historical / audit / transition evidence.**

It is **not** product authority.
It is **not** engineering authority.
It is **not** cold-start reading.

You can work correctly on this project having never opened these files. Required reading is
`AGENTS.md` and `PRODUCT_BLUEPRINT.md` — plus `IMPLEMENTATION_BLUEPRINT.md` once that exists.

---

## Why these files are kept

408 Guided Reader is a new project. A previous project, `408-ai-ebook`, was retired as product
authority. These documents record **what was measured and decided during that retirement**, so the
reasoning stays inspectable instead of becoming folklore.

| File | What it is |
|---|---|
| `LEGACY_REUSE_AUDIT.md` | Read-only audit of the retired repository: what existed, what was worth reusing, what must never cross. Amended 2026-09-03. |
| `OCR_FOUNDATION_CALIBRATION.md` | Measured OCR/layout calibration on real textbook pages: what an OCR engine actually returns, and what that means for the machine layer. |
| `LEGACY_TRANSITION_PLAN.md` | The accepted plan for retiring the old repository and seeding this one. Superseded once the transition completes. |

## How they may and may not be used

**Do not consult these files as a source of architecture.** The engineering design for this project
must be derived from `PRODUCT_BLUEPRINT.md` — by answering *"if the legacy repository did not exist,
what would we build?"* — and frozen in `IMPLEMENTATION_BLUEPRINT.md` before any retired code is
considered. Reading old code for structure during that draft is exactly the failure these documents
were written to prevent: it lets an abandoned product model reappear through the back door.

They may be consulted during an explicit, separately authorized **reuse-reconciliation** step, once
the architecture is otherwise settled — to check whether a specific already-decided component has a
proven implementation worth adapting, and to resolve provenance questions.

They may always be consulted for **evidence**: measured runtimes, dependency sizes, licence notes,
test baselines, and why a particular approach was rejected.

## Not present, deliberately

The retired project's product and governance stack — its system blueprint, decision register,
development spec, agent skills, governance document and per-phase briefs/plans/reports — was **not**
copied here. Reproducing it would rebuild the multi-document authority stack this project exists to
avoid. It remains in `D:\codex\408-ai-ebook`, frozen, if a historical question ever requires it.
