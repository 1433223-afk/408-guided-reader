import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabletPen} from '../src/reader_service/static/tablet-pen.js';

class Surface {
  handlers = new Map();
  addEventListener(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(callback);
  }
  removeEventListener(name, callback) {this.handlers.get(name)?.delete(callback);}
  emit(name, detail = {}) {
    const event = {type: name, cancelable: true, defaultPrevented: false, stopped: false,
      preventDefault() {this.defaultPrevented = true;}, stopPropagation() {this.stopped = true;}, ...detail};
    for (const callback of this.handlers.get(name) || []) callback(event);
    return event;
  }
}

function fixture(overrides = {}) {
  const viewer = new Surface(), windowTarget = new Surface(), documentTarget = new Surface();
  const overlay = {closest: () => overlay}, captures = new Set(), frames = new Map(), calls = [];
  let frame = 0;
  viewer.contains = target => target === overlay;
  viewer.setPointerCapture = id => {captures.add(id);};
  viewer.hasPointerCapture = id => captures.has(id);
  viewer.releasePointerCapture = id => {
    captures.delete(id);
    viewer.emit('lostpointercapture', {pointerId: id});
  };
  windowTarget.requestAnimationFrame = callback => {frames.set(++frame, callback); return frame;};
  windowTarget.cancelAnimationFrame = id => frames.delete(id);
  const control = createTabletPen({viewer, windowTarget, documentTarget,
    onSelectionStart: point => {calls.push(['start', point]); return true;},
    onSelectionMove: point => calls.push(['move', point]),
    onSelectionEnd: point => calls.push(['end', point]),
    onSelectionCancel: () => calls.push(['cancel']), ...overrides});
  const emit = (name, detail = {}) => viewer.emit(name, {pointerType: 'pen', pointerId: 7,
    isPrimary: true, button: 0, buttons: 1, clientX: 100, clientY: 200, target: overlay, ...detail});
  const flush = () => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback());};
  return {viewer, windowTarget, documentTarget, overlay, frames, captures, calls, control, emit, flush};
}

test('a primary pen tip selects immediately, captures its pointer and consumes the accepted contact', () => {
  const f = fixture();
  const down = f.emit('pointerdown');
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.stopped, true);
  assert.equal(f.captures.has(7), true);
  assert.deepEqual(f.calls, [['start', {clientX: 100, clientY: 200, target: f.overlay}]]);
  f.control.destroy();
});

test('only a live pen owns companion TouchEvents; finger touches after it ends stay native', () => {
  const f = fixture();
  assert.equal(f.viewer.emit('touchstart').defaultPrevented, false);
  f.emit('pointerdown');
  assert.equal(f.control.active, true);
  assert.equal(f.viewer.emit('touchstart').defaultPrevented, true);
  assert.equal(f.viewer.emit('touchmove').defaultPrevented, true);
  f.emit('pointerup', {buttons:0});
  assert.equal(f.control.active, false);
  assert.equal(f.viewer.emit('touchstart').defaultPrevented, false);
});

test('mouse, eraser, barrel-only, hovering and secondary pens do not enter the selection path', () => {
  for (const detail of [{pointerType: 'mouse'}, {button: 5, buttons: 32},
    {button: 2, buttons: 2}, {buttons: 0}, {isPrimary: false}]) {
    const f = fixture();
    const event = f.emit('pointerdown', detail);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.stopped, false);
    assert.deepEqual(f.calls, []);
    assert.equal(f.captures.size, 0);
    f.control.destroy();
  }
});

test('only the owned contacting pen moves the selection; moves are coalesced to the latest frame', () => {
  const f = fixture();
  f.emit('pointerdown');
  assert.equal(f.emit('pointermove', {pointerId: 99, clientX: 900}).stopped, false);
  f.emit('pointermove', {buttons: 0, clientX: 800});
  assert.equal(f.frames.size, 0, 'Hover must not schedule a selection update');
  f.emit('pointermove', {clientX: 110});
  f.emit('pointermove', {clientX: 120});
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'move']);
  assert.equal(f.calls[1][1].clientX, 120);
  f.control.destroy();
});

test('pointerup with buttons=0 flushes its final point before ending and clears pending frames and capture', () => {
  const f = fixture();
  f.emit('pointerdown');
  f.emit('pointermove', {clientX: 150});
  f.emit('pointerup', {buttons: 0, clientX: 170, clientY: 220});
  f.flush();
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'move', 'end']);
  assert.deepEqual(f.calls[1][1], {clientX: 170, clientY: 220, target: f.overlay});
  assert.deepEqual(f.calls[2][1], f.calls[1][1]);
  assert.equal(f.frames.size, 0);
  assert.equal(f.captures.size, 0);
  f.emit('pointermove', {buttons: 0, clientX: 900});
  assert.equal(f.calls.length, 3, 'Hover after a completed stroke stays inert');
  f.control.destroy();
});

test('moves retain the initial text overlay as the selection target across captured events', () => {
  const f = fixture();
  f.emit('pointerdown');
  f.emit('pointermove', {target: f.viewer, clientX: 120});
  f.flush();
  f.emit('pointerup', {target: f.viewer, buttons: 0});
  assert.ok(f.calls.filter(([name]) => name !== 'cancel').every(([, point]) => point.target === f.overlay));
  f.control.destroy();
});

test('cancellation, capture loss, rotation, blur, backgrounding and disposal only cancel without extending or ending', () => {
  for (const interrupt of [f => f.emit('pointercancel', {clientX: 0, clientY: 0}),
    f => f.emit('lostpointercapture'), f => f.windowTarget.emit('orientationchange'),
    f => f.windowTarget.emit('blur'),
    f => {f.documentTarget.hidden = true; f.documentTarget.emit('visibilitychange');},
    f => f.control.cancel(), f => f.control.destroy()]) {
    const f = fixture();
    f.emit('pointerdown');
    f.emit('pointermove', {clientX: 150});
    interrupt(f); f.flush();
    f.emit('pointerup', {buttons: 0});
    assert.deepEqual(f.calls.map(([name]) => name), ['start', 'cancel']);
    assert.equal(f.captures.size, 0);
    assert.equal(f.frames.size, 0);
    f.control.destroy();
    assert.equal(f.calls.length, 2, 'Cleanup must not cancel twice through capture loss');
  }
});

test('a resting touch cannot steal a pen stroke; a new finger after pen up stays native', () => {
  const f = fixture();
  f.emit('pointerdown');
  f.emit('pointermove', {clientX: 150});
  const touch = f.emit('pointerdown', {pointerType: 'touch', pointerId: 2});
  f.flush();
  assert.equal(touch.defaultPrevented, true);
  assert.equal(touch.stopped, true);
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'move']);
  f.emit('pointerup', {buttons:0});
  assert.equal(f.emit('pointerdown', {pointerType:'touch', pointerId:3}).defaultPrevented, false);
  f.control.destroy();
});

test('unrelated pointer endings do not cancel or complete the owned pen', () => {
  const f = fixture();
  f.emit('pointerdown');
  assert.equal(f.emit('pointercancel', {pointerId: 99}).stopped, false);
  assert.equal(f.emit('pointerup', {pointerId: 99, buttons: 0}).stopped, false);
  f.emit('pointerup', {buttons: 0});
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'move', 'end']);
  f.control.destroy();
});

test('disabled or rejected starts do not capture; losing availability cancels an active stroke', () => {
  for (const overrides of [{enabled: () => false}, {canSelect: () => false}, {onSelectionStart: () => false}]) {
    const f = fixture(overrides);
    const down = f.emit('pointerdown');
    assert.equal(down.defaultPrevented, false);
    assert.equal(down.stopped, false);
    assert.equal(f.captures.size, 0);
    f.control.destroy();
  }
  let available = true;
  const f = fixture({enabled: () => available});
  f.emit('pointerdown'); available = false;
  f.emit('pointermove');
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'cancel']);
  f.control.destroy();
  available = true;
  const queued = fixture({enabled: () => available});
  queued.emit('pointerdown'); queued.emit('pointermove');
  available = false; queued.flush();
  assert.deepEqual(queued.calls.map(([name]) => name), ['start', 'cancel']);
  queued.control.destroy();
});

test('failed pointer capture rolls back the newly created pen selection', () => {
  const f = fixture();
  f.viewer.setPointerCapture = () => {throw new Error('Pointer no longer active');};
  f.emit('pointerdown');
  assert.deepEqual(f.calls.map(([name]) => name), ['start', 'cancel']);
  f.control.destroy();
});
