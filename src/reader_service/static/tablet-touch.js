// Keep one-finger reading native. Only a deliberate hold or two-finger gesture
// takes ownership of the touch stream; PDF rendering happens once at pinch end.
export function createTabletTouch({viewer, enabled = () => true, getZoom, captureAnchor,
  commitZoom, canSelect = () => true, onSelectionStart, onSelectionMove,
  onSelectionEnd, onSelectionCancel, onPinchPreview = () => {}, onPinchClear = () => {},
  holdDelay = 430, moveTolerance = 10, minimumZoom = .5, maximumZoom = 4,
  windowTarget = window, documentTarget = document}) {
  let pending = null, selection = null, pinch = null, blocked = false;
  let holdTimer = null, previewFrame = null, contextMenuUntil = 0;
  const removers = [];
  const listen = (target, name, callback, options) => {
    target.addEventListener(name, callback, options);
    removers.push(() => target.removeEventListener(name, callback, options));
  };
  const suppress = event => {if (event.cancelable) event.preventDefault();};
  const clearHold = () => {clearTimeout(holdTimer); holdTimer = null; pending = null;};
  const clearFrame = () => {
    if (previewFrame !== null) windowTarget.cancelAnimationFrame(previewFrame);
    previewFrame = null;
  };
  const midpoint = touches => ({
    clientX: (touches[0].clientX + touches[1].clientX) / 2,
    clientY: (touches[0].clientY + touches[1].clientY) / 2,
  });
  const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY);
  const selectionPoint = (touch, target) => ({clientX: touch.clientX, clientY: touch.clientY, target});
  const findTouch = (touches, id) => Array.from(touches).find(touch => touch.identifier === id);

  function cancel() {
    clearHold(); clearFrame();
    const hadSelection = Boolean(selection), hadPinch = Boolean(pinch);
    selection = pinch = null; blocked = false;
    if (hadSelection) onSelectionCancel?.();
    if (hadPinch) onPinchClear();
  }

  function startPinch(event) {
    clearHold();
    if (selection) {selection = null; onSelectionCancel?.();}
    const start = midpoint(event.touches), span = distance(event.touches);
    if (span < 2) return;
    const zoom = getZoom();
    pinch = {start, current: start, distance: span, startZoom: zoom, zoom,
      anchor: captureAnchor(start.clientX, start.clientY)};
    contextMenuUntil = Date.now() + 1000;
    suppress(event);
  }

  function start(event) {
    if (!enabled()) return;
    // A zoom can replace the original OCR target after the first finger lifts.
    // Android then dispatches the last touchend to that detached target, so it
    // never reaches this viewer. A new touchstart containing exactly one finger
    // proves the previous stream has ended; an added finger would make >= 2.
    if (blocked && event.touches.length === 1) blocked = false;
    if (event.touches.length > 2) {cancel(); blocked = true; suppress(event); return;}
    if (blocked) {suppress(event); return;}
    if (event.touches.length === 2) {startPinch(event); return;}
    if (event.touches.length !== 1 || selection || pinch) return;
    clearHold();
    const target = event.target.closest?.('.text-overlay');
    if (!target || !viewer.contains(target)) return;
    const touch = event.touches[0], point = selectionPoint(touch, target);
    if (!canSelect(point)) return;
    pending = {identifier: touch.identifier, point};
    holdTimer = setTimeout(() => {
      const hold = pending;
      clearHold();
      if (!hold || !enabled()) return;
      if (onSelectionStart(hold.point) === false) return;
      selection = hold;
      contextMenuUntil = Date.now() + 1000;
    }, holdDelay);
  }

  function move(event) {
    if (!enabled()) {cancel(); return;}
    if (blocked) {suppress(event); return;}
    if (pinch && event.touches.length === 2) {
      suppress(event);
      pinch.current = midpoint(event.touches);
      pinch.zoom = Math.max(minimumZoom, Math.min(maximumZoom,
        pinch.startZoom * distance(event.touches) / pinch.distance));
      if (previewFrame === null) previewFrame = windowTarget.requestAnimationFrame(() => {
        previewFrame = null;
        if (!pinch) return;
        onPinchPreview({scale: pinch.zoom / pinch.startZoom,
          deltaX: pinch.current.clientX - pinch.start.clientX,
          deltaY: pinch.current.clientY - pinch.start.clientY,
          startX: pinch.start.clientX, startY: pinch.start.clientY,
          clientX: pinch.current.clientX, clientY: pinch.current.clientY});
      });
      return;
    }
    if (selection) {
      const touch = findTouch(event.touches, selection.identifier);
      if (!touch) {cancel(); return;}
      suppress(event);
      selection.point = selectionPoint(touch, selection.point.target);
      onSelectionMove(selection.point);
      return;
    }
    if (!pending) return;
    const touch = findTouch(event.touches, pending.identifier);
    if (!touch || Math.hypot(touch.clientX - pending.point.clientX,
      touch.clientY - pending.point.clientY) > moveTolerance) clearHold();
  }

  function end(event) {
    clearHold();
    if (pinch && event.touches.length < 2) {
      suppress(event); clearFrame();
      const completed = pinch;
      pinch = null;
      blocked = event.touches.length > 0;
      onPinchClear();
      const anchor = completed.anchor && {...completed.anchor,
        viewportX: completed.anchor.viewportX + completed.current.clientX - completed.start.clientX,
        viewportY: completed.anchor.viewportY + completed.current.clientY - completed.start.clientY};
      commitZoom(Math.round(completed.zoom * 100) / 100, anchor);
      contextMenuUntil = Date.now() + 700;
      return;
    }
    if (selection && !findTouch(event.touches, selection.identifier)) {
      suppress(event);
      const completed = selection;
      selection = null;
      const touch = findTouch(event.changedTouches, completed.identifier);
      if (touch) completed.point = selectionPoint(touch, completed.point.target);
      onSelectionEnd(completed.point);
      contextMenuUntil = Date.now() + 700;
    }
    if (blocked) suppress(event);
    if (!event.touches.length) blocked = false;
  }

  listen(viewer, 'touchstart', start, {passive: false, capture: true});
  listen(viewer, 'touchmove', move, {passive: false, capture: true});
  listen(viewer, 'touchend', end, {passive: false, capture: true});
  listen(viewer, 'touchcancel', cancel, {passive: true, capture: true});
  listen(viewer, 'pointercancel', event => {
    if (event.pointerType === 'touch' && !pinch) cancel();
  }, true);
  listen(viewer, 'contextmenu', event => {
    if (enabled() && (selection || pinch || Date.now() < contextMenuUntil)) suppress(event);
  }, true);
  listen(windowTarget, 'orientationchange', cancel);
  listen(windowTarget, 'blur', cancel);
  listen(documentTarget, 'visibilitychange', () => {if (documentTarget.hidden) cancel();});
  return {cancel, destroy() {cancel(); removers.forEach(remove => remove());}};
}
