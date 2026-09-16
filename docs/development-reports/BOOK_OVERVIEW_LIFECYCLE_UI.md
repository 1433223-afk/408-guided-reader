# Book Overview Chapter lifecycle UI

Status: USER_ACCEPTANCE PASS — explicitly confirmed by the user for lifecycle UI and typography;
checkpoint authorized. Earlier pending notes below describe their validation stage.

Presentation-only change. NOT_PREPARED has a direct generate action; FAILED has a direct retry
and a brief reading-availability note, with failure code inside closed technical details. READY
exposes only a low-frequency ellipsis menu. PREPARING and regeneration show the actual server
stage and positive section totals; no invented percentages or time-based advancement. A subtle
activity ellipsis indicates ongoing work (disabled under reduced motion). Regeneration continues
to render only the published READY payload. Existing allowed/disabled regeneration rules,
prepare/regenerate endpoints and 1400ms polling are unchanged. Source disable conditions remain
identical; only their label changes to 暂无法定位教材位置. Chapter rail, Section/KP hierarchy,
Reader and backend/persistence/publication semantics are unchanged.

Targeted frontend test: tests-js/overview-lifecycle.test.js PASS (direct generation/retry,
real stage labels/counts, concealed error code, protected regeneration, update notice).
Real 8767 read-only shortest path: Home -> Overview -> Chapter 5 NOT_PREPARED -> Chapter 6
FAILED -> Chapter 4 READY PASS. Stage previews intercept only knowledge-map GET responses
in an isolated browser: GENERATING, REVIEWING and READY+RUNNING; no provider calls or writes.
READY+RUNNING preserved all 36 published KP nodes; PREPARING exposes no KP payload.
No real generation/regeneration run is claimed; these screenshots are explicitly previews.

Local screenshots: overview-life-empty.png, overview-life-failed.png, overview-life-ready.png;
preview screenshots: overview-life-generating-preview.png, overview-life-reviewing-preview.png,
overview-life-regenerating-preview.png. No full-book or unrelated regression run.

User follow-up: initial FAILED now shows only failure, Retry and a lightweight technical-details
button. A native auto popover shows supplied error code/provider fields, supports Escape/outside
dismissal; no disclosure marker or reading note. Regeneration failure presentation unchanged.
Right-side Chapter is Serif 29/40px 600 with larger vertical margins; Section is Sans 20/30px 600;
KP title is Sans 15/24px 550. Left navigation and other lifecycle presentations unchanged.
Lifecycle test PASS including popover visibility/provider/Escape. Real Chapter 6 FAILED screenshot:
overview-failure-finish.png; open technical details: overview-failure-popover.png (empty_response,
deepseek). No generation request or broad regression. Awaiting user acceptance.

Checkpoint: lifecycle targeted test rerun PASS, including failure Retry callback, popover open/
Escape close, and NOT_PREPARED/PREPARING/READY/regeneration display. No UI edits after acceptance.
Reviewed endpoint selection, regeneration protection and source disable condition remain intact;
the accepted 29px Serif / 20px Sans / 15px Sans hierarchy remains unchanged. No real AI retry
was triggered at checkpoint; prior real-state screenshots and isolated stage previews remain
the evidence. Unrelated worktree changes excluded from staging.
