# Chapter 4 source-capacity failure — 2026-09-13

## Result

The deterministic pre-provider blocker in Chapter 4 is fixed. Target: user retest at
http://127.0.0.1:8767/. No user acceptance or live-provider quality PASS is claimed.

## Diagnosis and implementation

On a SQLite backup of the actual Library, source projection and 183 evidence units
succeeded; semantic window construction failed before any provider call. Subsection
4.3.1 常用汇编指令介绍 contains 6,485 characters, exceeding the old 4,800-character cap.

Implementation Blueprint §12.2 requires one real Outline subsection per semantic judgment.
Splitting/chunking it would change that frozen rule. The bounded invocation capacity is
therefore 9,600 characters, sufficient for the observed source while retaining a finite
pre-invocation guard. This number limits input capacity; it does not partition KPs or
weaken source/unit accounting, Review, identity, freeze or atomic publication validation.

Over-limit failures now carry `SOURCE_CAPACITY / INPUT_LIMIT /
semantic_window_source_limit`, instead of the misleading generic INVALID_CANDIDATE code.
The existing toolbar position explains that the subsection exceeds processing capacity,
with a tooltip that repeated retries cannot resolve it. No migration or PDF geometry change.

## Verification

- Targeted Knowledge suite: 28 PASS, including unchanged large-subsection unit accounting,
  exact capacity boundary, over-bound rejection, specific failure projection and no provider
  invocation/publication for over-bound input.
- Actual served Chapter 4 flow on disposable real 348-page textbook: PASS. Source resolution,
  generation, structural Review failure, explicit retry, READY (14 fixture KPs), Reader list,
  source jump and Overview. Provider fixture exercises real transport/pipeline; no external
  calls or model-quality claim. Added assertion verifies 4.3.1 carries all 6,485 characters
  together in each invocation, rather than being split, truncated or summarized.
- Textbook SHA256: 6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd.
- JavaScript: 40 PASS. Python closure: 285 PASS / 2 existing optional OCR skips, 137.502s; test-results/kp-source-capacity-closure.xml.
- Serving process restarted on 8767 after confirming no active Chapter preparation jobs.
  Config retains authorized deepseek-flash and google/gemini-3.8-flash model IDs and disabled
  Zhipu. HTTP 200 / READY confirmed. No user preparation or existing map was reset.

## Limits and reproduction

Use `READER_KP_LIST_ONLY=1 node tests-e2e/knowledge-map.mjs` with READER_DATA_DIR pointing
to the real Library and READER_CHROMIUM set to installed Edge. This runs on a disposable
backup. The earlier data-structures Chapter 4 HEADING_NOT_RESOLVED issue is separate and
not fixed by this change. Actual external generation/Review may still fail for other causes.

The commit containing this report is the checkpoint. Stop at READY_FOR_USER_RETEST.
