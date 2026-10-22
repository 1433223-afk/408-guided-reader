import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabletTouch} from '../src/reader_service/static/tablet-touch.js';

class Surface {
  handlers = new Map();
  addEventListener(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(callback);
  }
  removeEventListener(name, callback) {this.handlers.get(name)?.delete(callback);}
  emit(name, detail = {}) {
    const event = {cancelable: true, defaultPrevented: false, touches: [], changedTouches: [],
      preventDefault() {this.defaultPrevented = true;}, ...detail};
    for (const callback of this.handlers.get(name) || []) callback(event);
    return event;
  }
}
const touch = (identifier, clientX, clientY = 100) => ({identifier, clientX, clientY});
const waitForHold = () => new Promise(resolve => setTimeout(resolve, 25));

function fixture(overrides = {}) {
  const viewer = new Surface(), windowTarget = new Surface(), documentTarget = new Surface();
  const overlay = {closest: () => overlay};
  const calls = {start: [], move: [], end: [], cancel: 0, preview: [], clear: 0, zoom: []};
  const frames = new Map();
  let frame = 0;
  viewer.contains = target => target === overlay;
  windowTarget.requestAnimationFrame = callback => {frames.set(++frame, callback); return frame;};
  windowTarget.cancelAnimationFrame = id => frames.delete(id);
  const control = createTabletTouch({viewer, windowTarget, documentTarget, holdDelay: 10,
    getZoom: () => 1, captureAnchor: () => ({pageIndex: 5, viewportX: 150, viewportY: 100}),
    commitZoom: (zoom, anchor) => calls.zoom.push({zoom, anchor}),
    onSelectionStart: point => {calls.start.push(point); return true;},
    onSelectionMove: point => calls.move.push(point),
    onSelectionEnd: point => calls.end.push(point),
    onSelectionCancel: () => calls.cancel++, onPinchPreview: value => calls.preview.push(value),
    onPinchClear: () => calls.clear++, ...overrides});
  const emit = (name, touches, changedTouches = []) => viewer.emit(name, {target: overlay, touches, changedTouches});
  const flush = () => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());};
  return {viewer, windowTarget, documentTarget, calls, control, emit, flush, frames, overlay};
}

test('ordinary finger scrolling stays native and cancels the pending hold', async () => {
  const f = fixture();
  assert.equal(f.emit('touchstart', [touch(1, 100)]).defaultPrevented, false);
  assert.equal(f.emit('touchmove', [touch(1, 100, 125)]).defaultPrevented, false);
  await waitForHold();
  f.emit('touchend', [], [touch(1, 100, 125)]);
  assert.equal(f.calls.start.length, 0);
  assert.equal(f.calls.zoom.length, 0);
  f.control.destroy();
});

test('a held finger starts OCR selection, then drag and release reach the existing selection callbacks', async () => {
  const f = fixture();
  f.emit('touchstart', [touch(1, 100)]);
  await waitForHold();
  assert.equal(f.calls.start.length, 1);
  assert.equal(f.calls.start[0].target, f.overlay);
  assert.equal(f.emit('touchmove', [touch(1, 150, 125)]).defaultPrevented, true);
  assert.equal(f.calls.move[0].clientX, 150);
  assert.equal(f.emit('touchend', [], [touch(1, 160, 130)]).defaultPrevented, true);
  assert.equal(f.calls.end[0].clientX, 160);
  assert.equal(f.viewer.emit('contextmenu').defaultPrevented, true);
  assert.equal(f.calls.zoom.length, 0);
  f.control.destroy();
});

test('two fingers cancel the hold, preview at most once per frame, and commit one anchored zoom', async () => {
  const f = fixture();
  f.emit('touchstart', [touch(1, 100)]);
  assert.equal(f.emit('touchstart', [touch(1, 100), touch(2, 200)]).defaultPrevented, true);
  f.emit('touchmove', [touch(1, 50), touch(2, 250)]);
  f.emit('touchmove', [touch(1, 70, 130), touch(2, 290, 130)]);
  assert.equal(f.frames.size, 1);
  assert.equal(f.calls.zoom.length, 0);
  f.flush();
  assert.equal(f.calls.preview.length, 1);
  assert.equal(f.calls.preview[0].scale, 2.2);
  await waitForHold();
  assert.equal(f.calls.start.length, 0);
  f.emit('touchend', [touch(1, 70, 130)], [touch(2, 290, 130)]);
  assert.equal(f.calls.zoom.length, 1);
  assert.deepEqual(f.calls.zoom[0], {zoom: 2.2, anchor: {pageIndex: 5, viewportX: 180, viewportY: 130}});
  assert.equal(f.calls.clear, 1);
  assert.equal(f.emit('touchmove', [touch(1, 80, 140)]).defaultPrevented, true);
  f.emit('touchend', [], [touch(1, 80, 140)]);
  assert.equal(f.calls.zoom.length, 1);
  f.control.destroy();
});

test('pinch scale respects existing Reader zoom limits', () => {
  const f = fixture({getZoom: () => 3});
  f.emit('touchstart', [touch(1, 100), touch(2, 200)]);
  f.emit('touchmove', [touch(1, 0), touch(2, 400)]);
  f.flush();
  assert.equal(f.calls.preview[0].scale, 4 / 3);
  f.emit('touchend', []);
  assert.equal(f.calls.zoom[0].zoom, 4);
  f.control.destroy();
});

test('rotation cancels selection and an interrupted pinch never commits or leaves a queued preview', async () => {
  const f = fixture();
  f.emit('touchstart', [touch(1, 100)]);
  await waitForHold();
  f.emit('touchstart', [touch(1, 100), touch(2, 200)]);
  assert.equal(f.calls.cancel, 1);
  f.emit('touchmove', [touch(1, 50), touch(2, 250)]);
  f.windowTarget.emit('orientationchange');
  f.flush();
  f.emit('touchend', []);
  assert.equal(f.calls.preview.length, 0);
  assert.equal(f.calls.clear, 1);
  assert.equal(f.calls.zoom.length, 0);
  f.control.destroy();
});

test('touch cancellation, pointer scroll cancellation, backgrounding and disposal clear pending holds', async () => {
  for (const trigger of [f => f.emit('touchcancel', []),
    f => f.viewer.emit('pointercancel', {pointerType: 'touch'}),
    f => f.windowTarget.emit('blur'),
    f => {f.documentTarget.hidden = true; f.documentTarget.emit('visibilitychange');},
    f => f.control.destroy()]) {
    const f = fixture();
    f.emit('touchstart', [touch(1, 100)]);
    trigger(f);
    await waitForHold();
    assert.equal(f.calls.start.length, 0);
    f.control.destroy();
  }
});

test('third-finger interruption waits for every finger to lift before accepting a new gesture', async () => {
  const f = fixture();
  f.emit('touchstart', [touch(1, 100), touch(2, 200)]);
  f.emit('touchstart', [touch(1, 100), touch(2, 200), touch(3, 300)]);
  f.emit('touchend', [touch(1, 100)]);
  f.emit('touchstart', [touch(1, 100), touch(4, 200)]);
  await waitForHold();
  assert.equal(f.calls.start.length, 0);
  f.emit('touchend', []);
  f.emit('touchstart', [touch(5, 100)]);
  await waitForHold();
  assert.equal(f.calls.start.length, 1);
  assert.equal(f.calls.zoom.length, 0);
  f.control.destroy();
});

test('a new one-finger stream recovers when replacing the OCR target swallowed the final touchend', async () => {
  const f = fixture();
  f.emit('touchstart', [touch(1, 100), touch(2, 200)]);
  f.emit('touchmove', [touch(1, 50), touch(2, 250)]);
  f.emit('touchend', [touch(2, 250)], [touch(1, 50)]);
  assert.equal(f.calls.zoom.length, 1);
  // No zero-finger touchend reaches the viewer: the old OCR target detached.
  assert.equal(f.emit('touchstart', [touch(3, 100)]).defaultPrevented, false);
  f.emit('touchstart', [touch(3, 100), touch(4, 200)]);
  f.emit('touchmove', [touch(3, 75), touch(4, 225)]);
  f.emit('touchend', []);
  assert.equal(f.calls.zoom.length, 2, 'The very next pinch must work');
  f.emit('touchstart', [touch(5, 100)]);
  await waitForHold();
  assert.equal(f.calls.start.length, 1, 'Finger selection is usable after recovery');
  f.control.destroy();
});
