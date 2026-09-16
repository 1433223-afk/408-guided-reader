# OCR_FOUNDATION_CALIBRATION

**Document Type:** Calibration evidence. Authority Tier: NONE — subordinate to `PRODUCT_BLUEPRINT.md`.
**Date:** 2026-09-03
**Method:** clean-slate design question first, legacy consulted only afterward as control.
**Test bed:** real 王道 scanned pages, rendered at 200 DPI, CPU-only, Windows 11 / Python 3.13.2, warm models.
**Artifacts:** `…/scratchpad/ocrcal/` (scripts, page renders, per-page OCR JSON, overlays, crops, round-trip results).
**Read-only:** no legacy source, DB, or sample PDF was modified. `var/ai_ebook.db` was opened `mode=ro&immutable=1` for page-composition lookup only.

---

## 1. Executive Verdict

**OCR CORE: ACCEPT** — RapidOCR 3.9.2 driven **directly** (PP-OCRv6 det+cls+rec on onnxruntime). It satisfies every blueprint-required primitive on real pages: line geometry, sub-line geometry, selection→anchor resolution, highlight round-trip, and grounding-grade text.

**NATIVE GEOMETRY: line quads + per-character cells — not words.**
The detector produces **text-line quads** (real detections). `return_word_box=True` then produces sub-line units that are **99.8% single characters** (6,738 single CJK + 1,703 single Latin/digit vs **17** multi-character units across 8,458 units on 9 pages). Multi-character units occur only on lines containing *no* CJK at all. Their x-extent is **interpolated** from the CTC time-step column index, and their y-extent is **inherited wholesale from the parent line**. Source confirms the intent: `cal_rec_boxes/main.py` — *"汉字坐标是单字的，英语坐标是单词级别的"*. So `word_results` is a **mixed-granularity, partly-estimated character grid**, not a word layer.

**PRODUCT SELECTION UNIT: two layers — `Line` (authoritative) and `Char` (derived).**
Persist the **line** as the real detected object. Persist **character cells** as a derived, per-line array. A Product "selection" (word, phrase, term) is **not a stored object** — it is a contiguous character range within one line, materialized on demand as the union of its char cells. This satisfies §6 word-level *capability* without inventing a "word" entity that the engine does not actually produce.

**LAYOUT HELPER: KEEP — narrowly.**
Keep **only** `docling_ibm_models.layoutmodel.LayoutPredictor` (docling-layout-heron), used standalone at confidence ≥ 0.5 for `Picture` / `Table` / `Caption` / `Page-header`. Scored **7/7 figures, 2/2 tables, 0 false positives**, with a clean confidence gap (kept min 0.872, dropped max 0.406). The OCR-only alternative fails outright. **DROP** the `docling` pipeline, `docling-core`, `docling-parse`, `doclang`, and TableFormer (342 MB) — none is needed for geometry.

**LEGACY REUSE: one file.** `parsing/native.py` (`NativeTextProbe`) — PORT. Everything else in legacy Phase 03's parser layer is REFERENCE_ONLY or DROP. A clean implementation is objectively better and smaller.

**Correction to `LEGACY_REUSE_AUDIT.md`:** that audit recorded printed-page labels as NOT FOUND / UNKNOWN, on the legacy DMA experiment's evidence. **That conclusion is wrong.** Printed labels are present and recoverable: **28/29 DMA pages** yield an unambiguous label at a single consistent offset (+308), parity verified. The legacy `UNKNOWN` was an artifact of Docling classifying headers as page furniture and discarding them — not a property of the book. Two audit rows change (§8 below).

---

## 2. Representative Pages

9 pages from two retained sample PDFs. Printed labels are the values this calibration recovered.

| Tag | Source | pdf idx | printed | Why chosen |
|---|---|---|---|---|
| D00 | `phase04/dma/…第320-348页.pdf` | 0 | 308 | normal CN body + multi-level headings + figure with **rotated in-figure labels** |
| D05 | same | 5 | 313 | **TABLE 表7.1 + FIGURE 图7.7 + section heading 7.3.3 + watermark overprint** (hardest page) |
| D07 | same | 7 | 315 | 2 figures + 2 captions + CN/EN/number mixing throughout |
| D08 | same | 8 | 316 | timing diagram + **flowchart** (nested/fragmentable) + shaded 命题追踪 block |
| D09 | same | 9 | 317 | dense text, headings, 命题追踪, **no figure** (false-positive control) |
| D15 | same | 15 | 323 | dense exercise page + TABLE |
| D16 | same | 16 | 324 | **formula/numeric-adjacent**: `0.2μs`, `9600b/s`, `0.0005%`, `4KB（此处 K = 1000）`, `2×10⁷÷500M` |
| P00 | `phase03/primary/…第1-29页.pdf` | 0 | — | second PDF, front matter, figure, no printed label (absent-label control) |
| P04 | same | 4 | — | second PDF, large title, plain prose |

Coverage against the brief: normal CN + headings ✅ · CN/EN/numbers ✅ · formula-adjacent ✅ · large figure + caption ✅ · table ✅ · dense figure/text ✅ · 命题追踪 shaded block ✅ · difficult page (watermark + rotated labels) ✅.

---

## 3. Product Action Results

| Test | Result | Evidence | Problem |
|---|---|---|---|
| **A. Line geometry** | **PASS** | 393 lines over 9 pages. Overlapping line pairs: **0 or 1 per page**. Abnormally tall lines: 5 total, all legitimate (4 rotated in-figure labels on D00, 1 large title on P04). Mean recognition score 0.978–0.995; **zero** lines below 0.85. Visual overlay `overlay/D08_lines.png` shows tight boxes and correct top-down/left-right reading order 0→54 through body text. | Reading order interleaves *inside* flowcharts (D08 图7.12). Harmless — §10 treats a figure as one region; no reading order is needed inside it. |
| **B. Fine-grained selection** | **PASS with re-definition** | 8,458 sub-line units: **6,738 single CJK chars, 1,703 single Latin/digit chars, 17 multi-char**. `DMA` inside a Chinese line → `D`,`M`,`A` (3 units). Only all-Latin lines group (`A,` `C,` `D` — note it swallowed the comma). 34/34 target strings (`主存储器`, `DMA`, `Cache 缺失`, `32位`, `9600b/s`, `MIPS`, `4KB`, `0.2`, `I/O`, `命题追踪`, `中断屏蔽字`, `缺失`, `313`, `324`) resolved to geometry and were cropped back to the correct glyphs — verified visually in `contact_sheet.png`. | Units are **not words**. Boxes are interpolated in x, line-inherited in y. Sub-character bleed (±½ glyph) in ~10/34 crops; `0.0005%` clipped half the `%`. Acceptable for highlighting, **not** for per-glyph hit-testing. Punctuation is grouped into Latin tokens. |
| **C. Assistant anchor** | **PASS** | For every selection the harness recovered `{selected text, pdf_page_index, normalized geometry, containing line text, prefix/suffix context}` with no model call. 6/6 in `roundtrip/persisted_anchors.json`. | None. Line text gives the "nearby context" §24 needs directly. |
| **D. Highlight round-trip** | **PASS** | 6 selections persisted as **`pdf_page_index` + normalized box + quote + 12-char prefix/suffix only — no OCR ids**, then re-resolved against a **fresh OCR pass**: **6/6 recovered, IoU 0.9993–0.9997, same containing line 6/6**. Redrawn from persisted data alone in `roundtrip/D16_highlight.png` — lands exactly on `9600b/s` and `0.0005%` mid-paragraph. | The re-run was the **same engine version**, so this proves determinism + quote-based re-resolution, **not** robustness across an engine upgrade. See §8. |
| **E. OCR machine-layer quality** | **PASS** | 15 body lines transcribed by eye and diffed: **100.00% character agreement (0 diffs / 382 chars)** after normalizing whitespace and full/half-width punctuation. Spans headings, captions, CN/EN/numeric/formula-adjacent text. Two of my own transcriptions were wrong and the OCR was right (`和` not `与` on D09). | Real errors are confined to **rotated in-figure labels**: `中断请求` → `中断清求`, twice on D00, at scores 0.968/0.930 — the score did not flag them. Also: **watermark text is merged into the heading line** on D05 (`7.3.3 DMA 方式公众号：小兔网盘免费分享无水印PDF`). Spacing around CN/Latin boundaries is inconsistent → normalize before indexing. |
| **F1. Figure detection** | **PASS** | Layout model @ conf ≥ 0.5 + overlap-merge: **7/7 figures, 0 false positives**. Real detections 0.872–0.968; all noise ≤ 0.406. D08 图7.12 fragments into 3 boxes (0.918 / 0.404 / 0.329) — threshold + merge resolves it to exactly 1. | Needs the threshold **and** the merge step; raw output over-detects (D08 raw = 5 Pictures). Nested/low-confidence fragments are always ≤ 0.41 on this sample. |
| **F2. Table detection** | **PASS** | **2/2 tables, 0 false positives.** 表7.1 @ **0.981** with a tight bbox; D15 table @ **0.985**. D16 (no table) correctly yields 0. | Sample contains only 2 tables — thin evidence. Confidence is very high on both, and D09/D16 confirm no false positives on dense text. |
| **G. Printed-page mapping** *(added — see §1)* | **PASS** | Header-band OCR over **both full PDFs**: DMA **28/29** pages give one unambiguous numeric label, **28/28 consistent with offset +308**, even-left/odd-right parity holds. PRIMARY **16/29**, offset −11, all consistent, parity holds. | The 13 PRIMARY misses are front matter with no arabic label — exactly the "absent or non-numeric" case §5 anticipates. Correct behaviour is UNKNOWN for those pages, not a guess. Note the filename `第320-348页` is **wrong**; true printed range is 308–336. |

---

## 4. Geometry Granularity Finding

**Engine-native primitive**

1. **Text line** — a real detection. Quad from the DBNet-style detector, one recognized string, one confidence. This is the only geometry the engine actually *measures* below page level.
2. **Sub-line cell** — *derived, not detected*. `CTCLabelDecode.get_word_info` records each decoded character's **time-step column index**; `CalRecBoxes.calc_box` maps that index onto the line box with a uniform `avg_col_width = line_width / line_txt_len` and centres a cell of `avg_char_width` on it. Therefore:
   - **y comes from the line, not the glyph** (measured: D16 1430/1430 units share the line's y-range exactly; D05 898/934, the 36 exceptions being skewed quads);
   - **x is an estimate** that is good to roughly ±½ glyph;
   - granularity is **per-character for anything containing CJK**, and per-token only on all-Latin lines.

**Product-normalized Reader selection unit**

```
Page  → pdf_page_index, size, foundation_version
Line  → normalized quad, text, confidence      [AUTHORITATIVE: detected]
Char  → normalized cell + offset in line text  [DERIVED: interpolated, line-inherited y]
Selection → (line, char_start, char_end)  →  union of cells, resolved on demand
```

Three rules follow directly from the measurement:

- **Do not persist a "word" object.** The engine does not produce one. Anything word-shaped is a query-time grouping over the char array, which is exactly what §6.3 says to do for paragraphs.
- **The line is the anchoring authority; the char cell is a presentation detail.** §22.2's Guidance target and §24's Assistant context resolve to a *line* + character range. This keeps the durable anchor on the one thing that was really measured.
- **Never hit-test at sub-character precision.** Map a user's pointer to the nearest char cell within the line, then snap. Given ±½-glyph x error, per-glyph exactness is not available and is not needed for selection, copy, highlight, or note anchoring.

This satisfies §6.1 (selection/copy/highlight/note anchoring) and §6.2 (line context, Guidance targeting) without inheriting a false "word" abstraction.

---

## 5. Layout Comparison

Per page, 200 DPI, CPU, warm models.

| | OCR only | OCR + layout model |
|---|---|---|
| Figures found | **0/7** | **7/7** |
| Tables found | **0/2**, and cannot label a region as TABLE at all | **2/2** |
| False positives | 9 undifferentiated regions | **0** |
| Captions | not identified | 7 identified, correctly paired with their figure/table |
| Page-header (printed label) | recoverable by band heuristic | labelled explicitly, 2 per page |
| Runtime | 2.24 s/page | 3.03 s/page (+0.79) |
| Model bytes | **31.7 MB** (bundled ONNX) | +164 MB (heron) |
| Python deps | rapidocr, onnxruntime, cv2, numpy ≈ **222 MB** | + torch **527 MB**, transformers 113 MB, docling-ibm-models 1 MB |

The OCR-only heuristic (vertical gaps in line coverage) **fails structurally, not marginally**: figures on D00/D07/D08 contain OCR'd internal labels, so no gap exists and they are invisible to it; meanwhile it emits 4 spurious regions each on the sparse P00/P04. It also cannot distinguish FIGURE from TABLE from whitespace. There is no cheap fix.

**Verdict: KEEP**, scoped to `LayoutPredictor` alone. It earns its cost — but the cost is real (~805 MB, dominated by torch) and it is **preparation-time only**. Isolate it behind an optional extra so the Reader/serving path never imports torch.

Reference point: the legacy full Docling pipeline cost **4.04 s/page** (117.1 s / 29 pages, Phase 03 report) and produced *no* character geometry and *no* printed page labels. The recommended stack is **~25% faster and strictly more capable**.

---

## 6. Legacy Reuse Decision

| Legacy item | Decision | Reason |
|---|---|---|
| `parsing/native.py` — `NativeTextProbe` | **PORT** | Genuinely useful and product-neutral: per-page `pypdf` text-layer triage with a compacted-length threshold, U+FFFD/NUL replacement ratio, encrypted-PDF rejection, page-cap. Decides which pages need OCR at all. ~57 lines, no domain coupling. |
| `parsing/contracts.py` — `BBox` | **REFERENCE_ONLY** | The explicit `coordinate_origin` discipline is the right instinct and should be reproduced. The class itself is entangled with `SourceBlockType`/`ExtractionClassification` and the new model normalizes coordinates anyway. Rewrite, ~15 lines. |
| `parsing/adapter.py` — probe-before-backend invariant | **REFERENCE_ONLY** | "An unreliable native page may not stay on the NATIVE route" is worth keeping as a rule. Two lines of logic; not worth importing the file. |
| `parsing/adapter.py` — `DoclingLayoutParser` | **DROP** | Item-level output only, whole-document conversion, fabricated `page_label=str(idx+1)`, permanent PNG extraction. Superseded on every axis. |
| `parsing/contracts.py` — `ParsedDocument` / `ParsedPage` / `ParsedBlock` | **DROP** | `ParsedDocument` requires every page exactly once in order — structurally incompatible with §4.2 progressive preparation. `ParsedBlock` is the SourceBlock model. |
| `parsing/service.py` — per-page resumable persistence loop | **REFERENCE_ONLY** | Correct shape (skip-persisted → re-verify eligibility → publish → persist → checkpoint → rollback on failure). Re-implement against the new page/line/char model; the existing code is welded to ParseRun + SourceBlock. |
| `parsing/storage.py` — `ManagedSourceStorage` | **REFERENCE_ONLY** *(role change)* | Under §10 there are no permanent extracted assets to store. The containment/atomic-publish/orphan-reconcile pattern is still right, but its new job is an **on-demand crop cache**, which is a different lifecycle (evictable, derivable). Reuse the pattern from `books/storage.py`, which the audit already ports. |
| `parsing/repository.py`, `source_blocks`, `document_sections` | **DROP** | SourceBlock authority and a SourceBlock-anchored outline with no physical range. |
| `tests/test_parser_adapter.py` | **DROP** | All 4 tests assert SourceBlock classification semantics. |
| Docling as a *pipeline* dependency | **DROP** | `docling` 7 MB + `docling-parse` 37 MB + `docling-core` 3 MB + `doclang` 1 MB + TableFormer weights 342 MB, all unnecessary. |
| `docling_ibm_models.layoutmodel.LayoutPredictor` | **PORT (as dependency)** | Verified standalone: imports only torch/transformers/PIL/numpy, no docling. Earns its keep per §5. |

Net: **one file ported** (`native.py`), one third-party class adopted, everything else rewritten clean. This is a smaller, cleaner reuse set than the audit anticipated for Phase 03, and it is the objectively better outcome.

---

## 7. Recommended Foundation

```
pypdfium2      render page → PIL image        0.06–0.08 s/page   (also serves §10 on-demand crops)
NativeTextProbe (pypdf)  text-layer triage     negligible        (all 29 王道 pages are scan-only → OCR route)
RapidOCR direct  det + cls + rec, word_box=True   2.24 s/page    → Line[] + Char[] geometry + text
LayoutPredictor  heron, conf ≥ 0.5 + merge      0.79 s/page      → Picture / Table / Caption / Page-header bbox
                                               ─────────────
                                               ~3.0 s/page total, CPU
```

Persisted machine layer per page: `page(size, foundation_version)` · `line(quad, text, conf)` · `char(cell, offset)` · `region(bbox, FIGURE|TABLE, caption_line_ref?)` · `printed_page_label(value | UNKNOWN)`.

Why this is the simplest thing that satisfies the blueprint:

- **§2 / §4.1** — the PDF renders in ~70 ms with no OCR at all, so reading is never gated.
- **§4.2** — ~3 s/page and fully per-page, so background preparation is genuinely incremental and prioritizable. A 300-page book is ~15 CPU-minutes of background work, and any single page is usable the moment it finishes.
- **§6** — line + char is exactly what the engine measures and estimates; nothing is invented.
- **§7** — OCR is a separate, correctable layer; the PDF is untouched. Corrections edit `line.text` / `char` without touching page geometry.
- **§8** — durable anchors are `pdf_page_index` + normalized geometry + quote + context; validated 6/6 with IoU > 0.999.
- **§10** — regions store geometry only; crops are rendered on demand by the same pypdfium2 call already in the stack.
- **§5** — printed labels are recovered where present (28/29, 16/29) and left UNKNOWN where genuinely absent.

**Deployment note:** split dependencies into `serve` (pypdfium2, pypdf — tens of MB) and `prepare` (rapidocr, onnxruntime, cv2, torch, transformers, docling-ibm-models). The Reader path must never need torch.

---

## 8. Remaining Unknowns

Only those that materially affect `LEGACY_TRANSITION_PLAN`.

1. **Cross-version anchor robustness — the one real gap.** The round-trip proved determinism and quote-based re-resolution, but the re-run used the *same* engine version. §7.1 requires dependent artifacts to survive a foundation upgrade. **Unmeasured: how much line/char geometry moves across an OCR engine or model-version change, and whether quote+context re-resolution absorbs it.** Testable cheaply by re-running one page with a different PP-OCR model. This gates the §7.1 remap design, not the engine choice.
2. **Layout on table-heavy content.** 2/2 tables is encouraging but thin. 王道 chapters with many tables (e.g. instruction-format or addressing-mode chapters) should be spot-checked before freezing the threshold at 0.5.
3. **Is there an ONNX build of docling-layout-heron?** If yes, torch (527 MB) and transformers (113 MB) drop out of the preparation environment entirely and the whole stack becomes onnxruntime-only. Not investigated. Materially changes the dependency verdict, not the KEEP decision.
4. **Render DPI.** All results are at 200 DPI. Lower DPI would cut the 2.24 s/page OCR cost; the accuracy/latency curve was not measured.
5. **Watermark contamination.** The `公众号：小兔网盘…` overprint merges into heading lines (D05). Harmless for anchoring; it will pollute heading detection and semantic indexing. Needs a filter rule, and the sample set was too small to know how often it lands on structurally important lines.
6. **Rotated in-figure text.** The only OCR errors found, and confidence scores did not flag them (0.930–0.968). Per §10 these should go to a multimodal model via a PDF crop rather than being trusted as text — but if in-figure OCR text is ever indexed, it needs a lower trust tier.
7. **`LEGACY_REUSE_AUDIT.md` §4.3 and §12 now contain a superseded claim.** The rows asserting printed-page labels are absent, and the confidence line citing the DMA experiment's `UNKNOWN`, are contradicted by §3.G here. The audit should be corrected before the transition plan cites it. Its unknown #1 ("can Docling emit word/line boxes?") is also now resolved and moot — Docling is not the OCR engine.

---

**End of OCR_FOUNDATION_CALIBRATION — evidence artifact, authority tier NONE.**
