# DeepSeek V4.1 Flash enablement — 2026-09-12

## Result

READY_FOR_USER_RETEST. The user explicitly reauthorized native DeepSeek and requested V4.1 Flash.
The enabled Reader entry is http://127.0.0.1:8767/ using the existing `var/manual-browser` library.
Native DeepSeek is READY; Zhipu remains disabled; System/Teaching/Review and OpenRouter remain on
Gemini 3.8. Existing credentials are read from Windows Credential Manager, never copied or committed.

## Changes and evidence

- Official documentation at https://api-docs.deepseek.com/news/news09082026 specifies `deepseek-flash`
  for DeepSeek V4.1 Flash; retired `deepseek-v4-flash` names are compatibility aliases. Authenticated
  GET `/models` confirmed `deepseek-flash` and `deepseek-v4-pro`. No guessed `deepseek-v4.1-flash` slug.
- Updated runtime defaults, initial UI option, nonsecret environment example and current test model
  expectations. Historical development reports keep their original observed model names. AGENTS records
  the explicit native-DeepSeek exception without broadening the OpenRouter authorization.
- Native API preflight PASS: one short request returned OK (10 total tokens). One real textbook
  pointer-selection → Assistant Send → answer → close/Reader exit flow PASS on port 8767; actual Root
  model `deepseek-flash`. Screenshot: `test-results/deepseek41-live-answer.png`. No other live model calls.
- Targeted Assistant Python suite PASS (69 cases); controlled Assistant/Ask Deeper E2E PASS, including
  provider routing, Root/Child identity, historical reopen, close and AI-off recovery.
- Broad: `deepseek41-closure.xml`, **274 PASS / 2 optional real-OCR skips**; `npm test`, **33 PASS**.

## Runtime limitation

Automatic approval review blocked the command that would stop the old port-8766 service, reporting
only “blocked by policy”. It was not executed or bypassed. With no RUNNING/QUEUED background jobs,
an enabled service was safely started on port 8767 instead (PID 424 at launch). The old port 8766
service retains its original disabled-DeepSeek environment. Use the new entry; it has been requested
in the Codex browser panel. No book data was deleted or migrated by this configuration update.

## Checkpoint

`Enable native DeepSeek V4.1 Flash with official model alias`; hash reported after committing.
User acceptance remains pending.
