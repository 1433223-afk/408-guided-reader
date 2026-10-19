// Active pens select immediately; fingers keep the separate native-scroll and
// long-hold path. Track ownership so hovering or another pointer cannot drag a
// selection that belongs to this pen.
export function createTabletPen({viewer, enabled = () => true, canSelect = () => true,
  onSelectionStart, onSelectionMove, onSelectionEnd, onSelectionCancel,
  windowTarget = window, documentTarget = document}) {
  let owner = null, frame = null;
  const removers = [];
  const listen = (target, name, callback, options) => {
    target.addEventListener(name, callback, options);
    removers.push(() => target.removeEventListener(name, callback, options));
  };
  const take = event => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  const pointAt = (event, target) => ({clientX: event.clientX, clientY: event.clientY, target});
  function clearFrame() {
    if (frame !== null) windowTarget.cancelAnimationFrame(frame);
    frame = null;
  }
  function release(completed) {
    try {
      if (viewer.hasPointerCapture(completed.pointerId)) viewer.releasePointerCapture(completed.pointerId);
    } catch (_) { /* The browser may already have cancelled capture. */ }
  }
  function cancel() {
    clearFrame();
    const completed = owner;
    owner = null;
    if (!completed) return;
    release(completed);
    onSelectionCancel();
  }
  function start(event) {
    if (event.pointerType === 'touch') {
      // A resting hand must not steal a live pen stroke. Once the tip lifts,
      // a new finger gesture is left entirely to native scrolling/selection.
      if (owner) take(event);
      return;
    }
    if (event.pointerType !== 'pen' || event.button !== 0 || !(event.buttons & 1)
        || event.isPrimary === false || owner || !enabled()) return;
    const target = event.target.closest?.('.text-overlay');
    if (!target || !viewer.contains(target)) return;
    const point = pointAt(event, target);
    if (!canSelect(point) || onSelectionStart(point) === false) return;
    owner = {pointerId: event.pointerId, point};
    take(event);
    // The viewer stays mounted when page overlays are replaced during layout.
    try {viewer.setPointerCapture(event.pointerId);} catch (_) {cancel();}
  }
  function move(event) {
    if (!owner || event.pointerType !== 'pen' || event.pointerId !== owner.pointerId) return;
    if (!enabled()) {cancel(); return;}
    take(event);
    if (!(event.buttons & 1)) return;
    owner.point = pointAt(event, owner.point.target);
    if (frame !== null) return;
    const expected = owner;
    frame = windowTarget.requestAnimationFrame(() => {
      frame = null;
      if (owner !== expected) return;
      if (!enabled()) {cancel(); return;}
      onSelectionMove(owner.point);
    });
  }
  function end(event) {
    if (!owner || event.pointerType !== 'pen' || event.pointerId !== owner.pointerId) return;
    take(event);
    if (!enabled()) {cancel(); return;}
    const completed = owner;
    owner = null;
    clearFrame();
    release(completed);
    const point = pointAt(event, completed.point.target);
    // Pointerup has buttons=0. Its last position still completes the contact
    // gesture and must win over a move waiting for the next animation frame.
    onSelectionMove(point);
    onSelectionEnd(point);
  }
  function interrupted(event) {
    if (!owner || event.pointerId !== owner.pointerId) return;
    take(event);
    cancel();
  }
  function penTouch(event) {
    // Android may also emit TouchEvents for a contacting pen. Suppress only
    // that owned stream; changing touch-action on hover would break the first
    // finger scroll after the pen leaves.
    if (!owner) return;
    if (!enabled()) {cancel(); return;}
    take(event);
  }
  listen(viewer, 'pointerdown', start, true);
  listen(viewer, 'pointermove', move, true);
  listen(viewer, 'pointerup', end, true);
  listen(viewer, 'pointercancel', interrupted, true);
  listen(viewer, 'lostpointercapture', interrupted, true);
  listen(viewer, 'touchstart', penTouch, {capture:true, passive:false});
  listen(viewer, 'touchmove', penTouch, {capture:true, passive:false});
  listen(windowTarget, 'blur', cancel);
  listen(windowTarget, 'orientationchange', cancel);
  listen(documentTarget, 'visibilitychange', () => {if (documentTarget.hidden) cancel();});
  return {get active() {return Boolean(owner);}, cancel, destroy() {cancel(); removers.forEach(remove => remove());}};
}
