# Provider Routing and Section Test Rebaseline

## Result

The main product's OpenRouter model selection now fails closed to the approved set. Reading Guide
defaults to `google/gemini-3.8-flash`; no default or fallback selects an OpenAI/GPT model. The
Section bulk-confirmation regression again tests its intended state isolation without changing
Learning behavior. This is a bounded correction after the user's acceptance of the current main
product, not a new product Phase.

## Implemented

- `ProviderConfig.validate()` rejects an unapproved configured OpenRouter model. The provider status
  reports `UNAPPROVED_MODEL`, and a per-call model override fails with `unapproved_model` before any
  credential use or network request. The approved set currently contains only
  `google/gemini-3.8-flash`; no free-model ID was inferred or added.
- Reading Guide's unconfigured OpenRouter path and `.env.example` select Gemini 3.8 Flash. Other
  OpenRouter defaults and overrides were checked: the provider runtime and Inline Teaching already
  defaulted to Gemini; explicit unapproved models now fail at the shared egress boundary without
  provider fallback.
- The short Knowledge Map fixture now yields one KP per Section. The failing Section confirmation
  test previously asserted two same-Section KPs before invoking the confirmation behavior. It now
  adds a second published KP in its own temporary test database, then checks the original invariant:
  the unclear KP/Topic is preserved, the other same-Section KP is confirmed, other Sections are
  untouched, and repeat/restart state remains correct. No product Learning code or schema changed.

## Important implementation decisions

The approved model check lives in the shared provider runtime so Assistant, Master, Guide, Inline
Teaching and Review cannot bypass it with a per-call model override. Invalid configuration disables
that provider capability; it does not crash the Reader or substitute another model.

## Deviations from Spec

None. No Desktop or salvage branch work was included.

## Acceptance evidence

- TARGETED: the repaired Section test, provider override/allowlist tests and Guide selection tests:
  6 passed.
- CLOSURE: `python -m pytest -o addopts='' -q`: 394 passed, 2 skipped. `npm test`: 59 passed.
- `git diff --check`: passed. Search found no remaining `openai/gpt-6-astra` production default or
  fallback. Tests assert that unapproved configured and per-call models fail before adapter calls.
- No paid or real provider call was made. The product's user-visible behavior was already accepted;
  this correction changes configuration enforcement and a test fixture only. Desktop UAT is outside
  this main-only task.

Label: `IMPLEMENTATION_READY`.

## Known limitations / deferred debt

Other free OpenRouter models require an explicit approved model ID before they can be added to the
set. No such ID is recorded here.

## Reproducible entry points

Run `python -m pytest -o addopts='' tests/test_learning.py::test_section_confirmation_preserves_unclear_topics_and_other_section tests/test_ask_about_this.py::test_openrouter_only_approved_model_can_be_configured_or_selected tests/test_teaching.py::test_guide_model_selection_respects_explicit_configuration -q`, then the full commands above.

## Important files / architecture entry points

- `src/reader_service/agent_runtime/runtime.py`: approved-model validation and fail-closed status.
- `src/reader_service/teaching/service.py`, `.env.example`: Guide default.
- `tests/test_learning.py`, `tests/test_ask_about_this.py`, `tests/test_teaching.py`: regression evidence.

## Git checkpoint

This report is included in the enclosing main checkpoint commit.
