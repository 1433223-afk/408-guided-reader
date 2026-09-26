# Reader 2.0 Practice — Wangdao automatic extraction (2026-09-26)

## Result

**HUMAN ACCEPTED — 2026-09-26.** The user accepted automatic question-region generation and the full-book Practice expansion on the real 348-page 《2026计算机组成原理》 PDF. For source SHA-256 `6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd`, the Reader exposes **607 scoreable single-choice questions across 27 exercise sections**, including **14 cross-page questions**. Eighteen of 625 sequential-number candidates remain readable in the PDF but are excluded from scoring because their source evidence is incomplete or ambiguous. These counts describe the validated catalog; they do not claim that a human checked all 607 answers one by one.

## Implemented

- `practice_catalog.py` pairs existing Outline exercise/answer nodes and scans READY OCR lines in page order. OCR quads and cells provide question positions and per-option hit regions, including merged A/B lines and options split across pages. Publication requires one complete A/B/C/D sequence, one matching official answer heading, nonoverlapping geometry and explanation text; ambiguous candidates fail closed.
- The generated record feeds the existing PDF overlay and Practice Rail, deterministic grading, multi-round Hint, post-submission Master Review, favorite, attempt state and Learning Memory return. Solve-mode source includes each question page but excludes the official answer and explanation. The two-section fixture remains only as a compatibility fallback; adding sections no longer requires hand-written rectangles.
- Existing IDs 1–16 and 101–115 retain their identity and answer letters; new IDs derive from the immutable source hash, section heading and printed question number. SQLite migrations 22–24 widen Practice identity constraints after verified backups while preserving attempts, favorites and Review threads/messages. The final migration-24 backup and live database had matching counts (9 Practice rows, 4 Review threads, 8 Review messages) and clean foreign-key checks.
- The original PDF keeps normal scrolling. The active question draws **当前** beside its first page region and **续** beside a continuation region; option interaction and submission remain one exercise. The entry uses OCR heading bounds and ignores unrelated text merged into a heading line. Its Reader UI font, ochre **做题模式** frame and compact narrow-page label distinguish it from the green **学习** markers; the left rail uses the same mode name.

## Important decisions and limits

- Coverage is bound to the exact textbook revision above. It is a conservative extractor over this book's existing OCR and Outline, not a general parser for other textbooks or new question types. Unresolved printed questions stay in the PDF without a scoreable overlay.
- The prior-art check considered Docling (MIT), LayoutParser (Apache-2.0) and pdfplumber (MIT). No external code or new dependency was adopted: the needed line order, geometry and OCR cells already exist locally.
- Source-specific answer accuracy beyond the representative real-book checks remains an ongoing content-quality concern. Rechecking OCR must not silently rewrite saved attempts or Review history.

## Acceptance evidence

- Recorded targeted Python Practice/Review/Hint checks: **12 PASS** for automatic extraction, cross-page regions, merged OCR options, disjoint hit areas, answer isolation, fail-closed incomplete options and migration-24 backup/state preservation. JavaScript region/fallback checks: **3 PASS**. A real-book catalog sweep found zero invalid rectangles and zero overlapping option hit areas among the 607 published questions.
- Real-book browser smokes passed for generated 4.4.4 question 04 across PDF 215–216, legacy 1.2.6, and 5.2.4 including cross-page printed 09 on PDF 228–229. The flows exercised option selection and Enter submission, official-answer navigation and Back, progressive Hint, Master Review, favorite, saved state and Learning Memory source return. The live Hint/Review calls in those smokes resolved to the authorized native `deepseek-flash`; pre-submission Hint source omitted official answers and explanations.
- The later visual UAT checks exercised the entry on PDF pages 20, 27, 215 and 228, at 100%, 75% and 50% zoom, including the heading line merged with a watermark, mode entry/exit recovery, and comparison with the green **学习** marker. Browser DevTools confirmed that the entry and Reader toolbar both render in `Microsoft YaHei UI`. Related browser flow, JavaScript syntax and `git diff --check` passed after the final name/color change.
- **Human acceptance:** the user explicitly accepted automatic regions and full-book Practice on 2026-09-26. Broad unrelated suites were `INTENTIONALLY_NOT_RUN` under the user's earlier bounded-testing instruction; the targeted tests and real-material browser paths above cover the changed Practice risk surface.

## Reproducible entry points

Run `python -m reader_service --data-dir var/manual-browser` with the user's local book. PDF page 215 opens the generated 4.4.4 section; PDF page 228 opens 5.2.4 and its cross-page question 09. The local `var/` library, backups, diagnostic scripts and `test-results/` screenshots are ignored and are not part of this checkpoint.

Core files: `src/reader_service/practice_catalog.py`, `practice_prototype.py`, `practice_review.py`, `library/database.py`, `server.py`, `static/app.js`, `static/practice-fixture.js`, `static/styles.css`. Related tests are `tests/test_practice_catalog.py`, `tests/test_practice_prototype.py`, `tests/test_practice_review.py`, `tests-js/practice-fixture-regions.test.js` and the `tests-e2e/practice-*.mjs` browser smokes.

## Git checkpoint

Included in the checkpoint named `Automate practice extraction across Wangdao sections`; the commit hash is reported in the handover.
