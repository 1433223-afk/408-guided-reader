# Reader 2.0 Practice prototypes — 2026-09-25

**Current status: HUMAN ACCEPTED / CHECKPOINTED — 2026-09-25.** The user accepted the current
Practice prototype after the favorite-record and progressive-Hint round. Earlier Prototype 01/02
pending notes below are historical; the final status and limits are at the end of this report.

## Prototype 01 result

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING`: a 16-question, original-PDF single-choice demo is implemented and the agent's real-book smoke path passed. Continuous human use of all 16 questions and an actual Assistant provider answer remain for the requested manual acceptance.

## What changed

- The Reader shows **练习** only for the exact source SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd` (`2026计算机组成原理`). Entering Practice opens a left rail, keeps the PDF in the center, and leaves the existing Assistant/Master dock available on the right.
- A fixed, temporary fixture marks single-choice questions 01–16 of **1.2.6 本节习题精选**. Questions are on one-based PDF pages 20–21; verified official answers and explanations are on pages 22–23. The chosen group includes two-column options, four options on one line, dense text, and multi-line options. It does not include a figure/table question.
- Clicking a marked option selects it. Clicking it again or pressing Enter in the PDF viewer submits it. Deterministic comparison shows `✓ 正确` or `✕ 不正确`; a wrong submission does not reveal the right letter. The rail supports retry, next question, a local hint, official-answer navigation, and return to the question. Progress and selection are session-only.
- Directory and Practice share the left position. Directory can temporarily replace the rail without losing the current question. Both left panels use the same draggable width. Practice forces the PDF-visible split layout and reflows the page when the right dock opens or closes; the zoom value is retained. The option highlights ignore pointer events, and dragging on OCR text still works for Assistant selection.
- Guide now closes Directory through the Reader shell so returning from Directory restores the Practice rail.

## How to use

Run `python -m reader_service --data-dir var/manual-browser` and open the 348-page `2026计算机组成原理` book. Click **练习** in the Reader toolbar. Click A/B/C/D on the original PDF; click the same option again or press Enter while the PDF viewer has focus. Use the left rail for retry/next question or **查看官方解析** → **返回题目**. **目录** temporarily shows navigation; closing it returns to Practice. A different PDF does not show this demo entry.

## What remains temporary

- The fixture is hard-coded to the book hash and normalized page rectangles. No extraction, general exercise model, persisted attempts/progress, mastery write, or learning-memory write exists.
- **给我一个提示** displays a short local strategy hint. **帮我找出错在哪** currently explains that Master Review is not connected; it does not make an AI request. Normal PDF selection opens an Assistant draft, but the smoke made no provider call.
- The sample contains no diagram/table question. A user should judge whether the existing 16-question mix is sufficient for the next iteration.

## Acceptance evidence and observed issues

- `tests-e2e/practice-prototype.mjs` PASS on a copy of the real 348-page library: wrong answer, retry and correct answer, Enter submission, official-answer round trip, next question, Directory switch, pointer and keyboard left resize, OCR text selection to Assistant draft, and PDF visibility at 1440/1024 px with the right dock open. No AI response was requested. Screenshots: `test-results/practice-prototype-1440.png` and `practice-prototype-1024.png` (ignored local evidence).
- `tests-js/directory-presentation.test.js`: 3/3 PASS. `tests-e2e/directory-pane.mjs`: PASS, including margin/split/navigation and the existing corpus sweep. `tests-e2e/guide-split-reader.mjs`: PASS when run against its required local server. Its first invocation without that server failed with connection refused; the correctly launched run passed.
- `node --check` for the changed JavaScript and e2e script, `python -m py_compile src/reader_service/server.py`, and `git diff --check`: PASS. Full project suites: `INTENTIONALLY_NOT_RUN` per this prototype's limited-check instruction; these unrelated suites share no new backend, persistence, or provider boundary.
- **Observed:** with both side panels open at 1024 px, the PDF remains visible but auto-fits to a very small page. The toolbar also gets cramped. At 1440 px, the current 110% saved zoom is workable but the page is noticeably narrower. Continuous 16-question human play and an actual Assistant answer have not been observed yet.

## Main files

`src/reader_service/static/practice-fixture.js`, `app.js`, `index.html`, `styles.css`, `guide-ui.js`, `src/reader_service/server.py`, and `tests-e2e/practice-prototype.mjs`.

## Git checkpoint

Pending human acceptance of the prototype; no checkpoint or Phase closure is claimed. Existing untracked Reader 2.0 draft, layout assessment, and research files were left intact.

## Prototype 02 initial result (historical)

`FULL_REAL_MATERIAL_ACCEPTANCE_PENDING`: the revised demo passed targeted persistence tests and an isolated real-book browser smoke. Continuous human use, the 1024 px reading comfort decision, and an actual AI explanation remain for manual acceptance.

### Current behavior

- The entry moved from the toolbar to beside the **1.2.6 本节习题精选** heading on PDF page 20. The fixture still covers original-PDF single-choice questions 01–16 on pages 20–21, with official answers/explanations on pages 22–23. The exact book SHA-256 is `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`.
- The PDF stays between the Practice rail and Assistant/Master. In Practice, both pane borders and resize gutters use a fine divider, and the right dock has no floating shadow. Right-dock overlay/expand is suppressed while Practice is active. The left divider supports drag and arrow keys. Option highlights are lighter and still allow OCR text selection.
- A bounded SQLite row per question saves attempt count, most recent correctness, whether it was ever correct, and favorite. The rail and small marks beside original questions show these states after leaving and reopening the Reader. A wrong answer still does not reveal the correct letter.
- After an attempt, **帮我找出错在哪** opens a right-side review workspace while the left rail keeps **A/B/C/D/整题** available. Choosing a target updates the review focus. This is a UI/state skeleton only: it does not call Master or present a generated explanation. The existing Assistant and Master remain available after exiting review.

### Manual acceptance

The refreshed local service is running at **http://127.0.0.1:8765/** against `var/manual-browser`. Open the 348-page **2026计算机组成原理** book, go to PDF page **20**, and click **练习** beside the heading. Try a wrong answer on question 01, use **再试一次**, then submit D; try Enter on another question. Use ☆ to favorite, switch questions, exit and reopen the Reader to inspect saved marks/counts. Open review, switch A/B/整题 on the left, then **返回解释**. Open Assistant from an original-PDF text selection and resize both sides. Refresh the browser if it was already open before the service restart.

### Verification and limits

- `python -m pytest tests/test_practice_prototype.py -q`: PASS, including wrong→correct→wrong count/ever-correct preservation, favorite survival through a fresh Database object, and rejection of unsupported source/input.
- `tests-e2e/practice-prototype.mjs`: PASS on a copied real 348-page library. It exercised heading entry, favorite save, wrong/retry/correct, review targets, official-answer round trip, Enter, Directory switch, left drag and keyboard resize, OCR selection to Assistant draft, separate three-column bounds at 1440/1024/800 px, and Reader reopen persistence. No provider call was made. Ignored local screenshots: `test-results/practice-prototype-review.png`, `practice-prototype-1440.png`, `practice-prototype-1024.png`.
- `node --test tests-js/directory-presentation.test.js`: 3/3 PASS. Changed JavaScript syntax, Python compile, and `git diff --check`: PASS. There is no project build script. Full suites were intentionally not run for this bounded prototype per the user's instruction.
- At 1024 px with both side panels open, the PDF remains visible and unobscured, but its text is small. The toolbar is crowded at that width. Review is intentionally a skeleton, and Hint is still a one-step local text strategy. There is no automated extraction, generic exercise model, full attempt history, or AI question context.

Manual acceptance is pending. The existing uncommitted Prototype 01 work and user-supplied Reader 2.0 documents remain in place; no Git checkpoint or Phase closure is claimed.

## Prototype 02 revision after human acceptance

The Practice Rail now distinguishes **继续练习** from **理解这题**. Before an answer, **下一题** is the main action and Hint is a full secondary control. After an incorrect answer, **再试一次** is primary, **下一题** remains available, and **帮我找出错在哪** has a visible learning-action surface. Official explanation is another full control rather than a footer link.

Practice uses one shared split-width calculation against the Reader container. Both side handles clamp at a central PDF minimum; expanding either side cannot overlap the PDF. The constraints were exercised by dragging both dividers to their limits at 1440 px and by checking the three independent pane bounds at 1024 and 800 px. Practice also suppresses the right dock's overlay and expanded modes. At 800 px the PDF is still narrow; the toolbar remains crowded.

**Master Practice Review is now real.** The left A/B/C/D/整题 controls stay visible while the right side uses the existing Master conversation view, model selector, streaming display, retry, and free follow-up composer. One durable thread is keyed to each of the 16 source-specific questions. Clicking another target adds to that question's thread; reopening the Reader retrieves the same messages. The server builds context from actual OCR question/option lines and the official answer/explanation lines. It checks that the question has been submitted before opening or sending a Review request. The last selected option is newly saved; earlier Prototype 02 attempts may have no saved letter. Review writes no KP mastery, learning event, or Learning Memory. The Practice Review provider boundary permits the approved native `deepseek-flash` and OpenRouter `google/gemini-3.8-flash` only; the real smoke used native DeepSeek.

**Evidence:** `tests/test_practice_prototype.py` and `tests/test_practice_review.py` passed. A temporary copy of the real 348-page Library verified that all 16 question regions yield A/B/C/D OCR text and matching official explanations. The browser smoke passed with both side dividers dragged to limits, 1440/1024/800 px separation, and Reader reopen. A second isolated smoke made real A → B → free follow-up Master calls and reopened the same thread with three answers. JavaScript syntax, Python compile, `git diff --check`, and the three Directory presentation tests passed. No full suite was run, per the user's scope. There is no build script.

**Manual acceptance:** refresh [the local Reader](http://127.0.0.1:8765/), open the 348-page **2026计算机组成原理**, jump to PDF page **20**, and click the **练习** button beside **1.2.6 本节习题精选**. Submit a question, open **帮我找出错在哪**, click A then B or 整题, and ask a free follow-up in the right Master composer. Try both dividers at their limits. This remains a 16-question, hash-bound prototype; Hint is still a local one-step strategy, and no general extraction, full History, memory page, or mastery update was added.

No checkpoint was committed. Human acceptance remains pending.

## UI polish after Prototype 02 acceptance

The rail now uses a compact question heading, quieter status/attempt text, one restrained progression action, separate full-width learning rows, and a low-contrast text index instead of a tile dashboard. Review targets use underlined text tabs. On the PDF, question marks read as margin annotations: a dot before an attempt, × after a wrong result, ✓ after a correct result, and a small attempt count for repeated work; the favorite star remains separate. Option hover and result states use a faint wash and hairline underline rather than framed rectangles.

Practice page sizing now uses a 12 px reading inset and a matching canvas width calculation. The viewer background and page shadow are lighter, removing the broad gray channel next to the left rail. Both pane borders remain the same fine line. No Practice behavior, Master path, provider, or persistence model changed.

**Verification:** the isolated browser smoke on the real 348-page textbook passed after the final CSS change, including option submission, Review entry, PDF text selection, pane resizing at 1440/1024/800 px, and reopening saved state. `node --check` and `git diff --check` passed. The smoke's Review title assertion now waits for the existing asynchronous thread open. Full tests were intentionally not run. At 1024 px with both side panes open, the book remains readable at reduced size; toolbar crowding remains outside this UI-only pass. No checkpoint was committed; manual acceptance is pending.

## Right pane obscuring the PDF: human acceptance fix

The right dock still allowed up to 760 px, while the ordinary Reader only reserved 280 px for the PDF. Practice had a separate width calculation, but its right minimum remained large at narrow window sizes. At saved zooms above 100%, the page itself could also extend past the center viewport, which looked like the right pane covering the book.

Practice now caps both side panes at 440 px, gives them similar adaptive minimum widths, and reserves most of a 1024 px window for the PDF. The right pane is forced into its grid track during Practice Review. The ordinary Reader dock also limits its width using the actual split left pane and a PDF minimum. Opening or resizing the right pane in Practice temporarily fits the PDF to 100% when necessary; leaving Practice restores the reader's prior zoom, and the temporary fit is not saved as the user's zoom preference. A later explicit zoom action still works normally.

The width calculation reserves right-side space only while that pane is actually open, so entering Practice with only the left rail does not unnecessarily narrow it.

Entering Practice also converts an already-open narrow-screen Assistant overlay into the same docked right pane. The split regression covers this overlay-to-dock transition as a prepared UI state; the main real-material path uses actual pointer and keyboard actions.

**Verification:** real-book browser smoke passed with question 04's existing Master Review at the right width limit, at both 1440 and 1024 px: both pane edges stayed outside the PDF viewport, and the full width of the original page remained inside the center viewport. The smoke also checked drag and keyboard resize, 800 px separation, text selection, reopening the Reader, restoration of the original saved zoom, and overlay-to-dock conversion. No provider call or full suite was run. No checkpoint was committed; manual acceptance remains pending.

## Current-question marker: human acceptance fix

The page-margin dot, ×, and ✓ describe attempt history but did not identify which question is currently active. Practice now adds a small **当前** label and a thin vertical rule beside only the active question, spanning its prompt and options. Switching questions moves the guide; leaving Practice removes it. The guide does not intercept PDF text selection or cover the printed question.

The real-book browser smoke passed after switching to question 07 at 1024 px. Its screenshot (`test-results/practice-prototype-q7-1024.png`) shows the guide beside the printed 07, and the smoke asserts that there is exactly one guide and that it disappears on close. JavaScript syntax and `git diff --check` passed. Full tests were not run for this local UI correction. No checkpoint was committed; human acceptance remains pending.

## Favorite questions in Learning Memory and progressive Hint

Favorite is now the explicit membership rule for **习题学习记录** inside the existing Learning Memory page. The page has **正文记忆 / 习题学习记录** navigation and reuses its Book, Chapter/Section rail, item list, selected detail, search, source return, and remove interaction. The Practice view reads the existing durable favorite rows, joined to the real Outline and any existing Practice Master thread; it stores no duplicate memory copy or new history. A record shows question number, most recent result, attempt count, and Review availability. It can return to the original PDF question or reopen that question's existing Master conversation. Cancelling favorite removes the record. The original body-memory collection and provider boundaries remain unchanged.

The Practice Rail now accumulates transient AI hints. Each request sends the current OCR question/options, optional selected letter, and earlier hints. The server constructs a separate Solve-mode source from the question page alone; it never reads official answer pages for Hint. It resolves the approved model before each real call and uses the existing Master Quick runtime settings, with no new Agent or persistence table. Switching questions or retrying clears the Hint sequence. The left UI remains a light text annotation rather than a stack of cards.

**Verification:** targeted Practice/Review/Hint Python tests and Learning Memory JS tests passed; syntax/compile checks passed. The real 348-page textbook browser smoke used the approved native `deepseek-flash` for three consecutive hints on question 07. They progressed from CPU composition, to register/decoder roles, to a comparison check without naming a correct letter. The runtime payload inspector confirmed all three actual provider requests contained only PDF page 21 question OCR and no `official_answer`, `official_explanation`, or correctness field. In an isolated Library copy, the smoke favorited question 07, found it under Learning Memory, left and reopened Reader, returned to that question, continued question 05's existing Master thread, and removed question 07 by cancelling favorite. The existing Practice real-book smoke and Learning Memory source-navigation smoke also passed. Full suites were not run per user request.

**Prototype limits:** the fixture remains bound to one textbook SHA and 16 questions. Hint text exists only during the current Solve interaction; it is not a durable conversation or learning signal. The model can infer from the printed options, so phrasing restraint is still partly prompt-based even though official answer data is structurally excluded. No checkpoint was committed. Human acceptance remains pending.

## Human acceptance and checkpoint closeout — 2026-09-25

The user confirmed that the current Reader 2.0 Practice prototype passed manual acceptance and requested a clear Git checkpoint. The immediately preceding section records the final implemented behavior and actual verification. Its last sentence describes the pre-acceptance state and is superseded by this closeout.

The final diff review found only Practice implementation, targeted tests, this report, the Reader 2.0 draft product blueprint, and the layout assessment. Local screenshots, logs, the real textbook/library data, and scratch files remain ignored and are not part of the checkpoint. No product behavior was changed during closeout. Full project suites remain intentionally unrun as requested; this checkpoint is for the accepted bounded prototype, not a claim that a general Practice system or a separately governed Phase has closed.
