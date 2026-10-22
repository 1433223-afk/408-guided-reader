import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/reader_service/static/visual-selection.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');

// Minimal event tree with capture/bubble ordering; no layout guesses are made by
// the DOM fake. Canvas and page-footer dimensions are deliberately different.
function fixture({touchActions = false} = {}) {
  const selected = [], confirmationStates = [], resizeObservers = [];
  let enters = 0;
  const enabled = {value: true};
  class Node {
    constructor(kind) {
      this.kind = kind;
      this.children = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.attributes = new Map();
      this.style = {};
      this.dataset = {};
      this.captures = new Set();
      this.hidden = true;
      this.disabled = false;
      const classes = new Set();
      this.classList = {
        contains: name => classes.has(name),
        toggle(name, value) {if (value) classes.add(name); else classes.delete(name);},
      };
    }
    get parentElement() {return this.parentNode;}
    get isConnected() {return this.kind === 'document' || Boolean(this.parentNode?.isConnected);}
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push({callback, capture: options === true || Boolean(options?.capture)});
    }
    append(...nodes) {for (const node of nodes) {node.parentNode = this; this.children.push(node);}}
    remove() {this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;}
    setAttribute(name, value) {
      this.attributes.set(name, value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) {return this.attributes.get(name) ?? null;}
    focus() {this.focused = true;}
    contains(node) {return node === this || this.children.some(child => child.contains(node));}
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(value => this.matches(value.trim()));
      const data = selector.match(/\[data-([a-z-]+)(?:="([^"]*)")?\]/);
      if (data) {
        const key = data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (data[2] === undefined ? !(key in this.dataset) : this.dataset[key] !== data[2]) return false;
      }
      const className = selector.match(/^\.([a-z-]+)/)?.[1];
      if (className) return className === 'page' && this.kind === 'page'
        || (this.className || '').split(' ').includes(className);
      return data ? true : selector === this.kind;
    }
    closest(selector) {return this.matches(selector) ? this : this.parentNode?.closest(selector);}
    querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    setPointerCapture(id) {this.captures.add(id);}
    hasPointerCapture(id) {return this.captures.has(id);}
    releasePointerCapture(id) {this.captures.delete(id); fire(this, 'lostpointercapture', {pointerId: id});}
  }
  function fire(target, type, init = {}) {
    const event = {target, type, button: 0, pointerId: 1, clientX: 0, clientY: 0,
      defaultPrevented: false, stopped: false,
      preventDefault() {this.defaultPrevented = true;},
      stopImmediatePropagation() {this.stopped = true;}, ...init};
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    for (const capture of [true, false]) {
      for (const node of capture ? [...path].reverse() : path) {
        for (const handler of node.listeners.get(type) || []) {
          if (handler.capture !== capture) continue;
          handler.callback(event);
          if (event.stopped) return event;
        }
      }
    }
    return event;
  }
  const document = new Node('document'), window = new Node('window');
  document.createElement = kind => new Node(kind);
  const viewer = new Node('viewer'), toggle = new Node('button'), hint = new Node('hint');
  const page = new Node('page'), canvas = new Node('canvas'), overlay = new Node('overlay'), footer = new Node('footer');
  const cancelButton = new Node('button'), confirmButton = new Node('button');
  cancelButton.dataset.regionCancel = ''; confirmButton.dataset.regionConfirm = '';
  confirmButton.getBoundingClientRect = cancelButton.getBoundingClientRect = () => ({left:10,top:20,right:110,bottom:64});
  document.append(viewer); document.append(toggle); document.append(hint); hint.append(confirmButton, cancelButton);
  viewer.append(page); page.append(canvas); page.append(overlay); page.append(footer);
  page.dataset.index = '7'; page.clientHeight = 760;
  const completeBounds = bounds => ({...bounds, right: bounds.left + bounds.width, bottom: bounds.top + bounds.height});
  viewer.bounds = {left: 0, top: 100, width: 900, height: 1000};
  viewer.getBoundingClientRect = () => completeBounds(viewer.bounds);
  Object.assign(hint, {offsetWidth: 88, offsetHeight: 32});
  Object.assign(canvas, {clientWidth: 500, clientHeight: 700, offsetLeft: 20, offsetTop: 30});
  canvas.bounds = {left: 100, top: 200, width: 500, height: 700};
  canvas.getBoundingClientRect = () => completeBounds(canvas.isConnected ? canvas.bounds : {left: 0, top: 0, width: 0, height: 0});
  const context = vm.createContext({document, window,
    ResizeObserver: class {constructor(callback) {resizeObservers.push(callback);} observe() {}},
  });
  vm.runInContext(source.replaceAll('export function ', 'function '), context);
  const ui = context.createVisualSelection({viewer, toggle, hint, touchActions, enabled: () => enabled.value,
    onSelect: item => {
      confirmationStates.push({active: ui.active, outlines: viewer.querySelectorAll('.visual-region-outline').length,
        hintHidden: hint.hidden, captures: viewer.captures.size});
      selected.push(JSON.parse(JSON.stringify(item)));
    }, onEnter: () => enters++});
  return {ui, context, document, window, viewer, toggle, hint, page, canvas, overlay, footer,
    selected, confirmationStates, confirmButton, cancelButton, enabled, fire, get enters() {return enters;},
    enter: () => fire(toggle, 'click'), resize: () => resizeObservers.forEach(callback => callback())};
}

function pointer(f, x, y) {
  return {clientX: f.canvas.bounds.left + x * f.canvas.bounds.width,
    clientY: f.canvas.bounds.top + y * f.canvas.bounds.height};
}
function draw(f, rect = [.2, .25, .8, .75]) {
  f.fire(f.overlay, 'pointerdown', pointer(f, rect[0], rect[1]));
  f.fire(f.viewer, 'pointermove', pointer(f, rect[2], rect[3]));
  f.fire(f.viewer, 'pointerup', pointer(f, rect[2], rect[3]));
}
function dragTarget(f, target, from, to) {
  assert.ok(target, 'pending region/handle exists');
  f.fire(target, 'pointerdown', pointer(f, ...from));
  f.fire(f.viewer, 'pointermove', pointer(f, ...to));
  f.fire(f.viewer, 'pointerup', pointer(f, ...to));
}

test('Tablet confirmation completes from one touch tap when Chrome suppresses the compatibility click',()=>{
  const f=fixture({touchActions:true});f.enter();draw(f);
  const touch={pointerType:'touch',clientX:50,clientY:40,cancelable:true};
  f.fire(f.confirmButton,'pointerdown',touch);f.fire(f.confirmButton,'pointerup',touch);
  assert.equal(f.selected.length,1);
  assert.equal(f.ui.active,false);
  f.fire(f.confirmButton,'click',{detail:1,pointerType:'touch'});
  assert.equal(f.selected.length,1,'an optional compatibility click cannot confirm twice');
});

test('sliding or cancelling a Tablet action leaves the crop pending and keyboard confirmation still works',()=>{
  const f=fixture({touchActions:true});f.enter();draw(f);
  const touch={pointerType:'touch',clientX:50,clientY:40,cancelable:true};
  f.fire(f.confirmButton,'pointerdown',touch);
  f.fire(f.confirmButton,'pointermove',{...touch,clientX:75});
  f.fire(f.confirmButton,'pointerup',touch);
  f.fire(f.confirmButton,'click',{detail:1});
  assert.equal(f.selected.length,0,'moving away and back does not activate');
  f.fire(f.confirmButton,'pointerdown',touch);f.fire(f.confirmButton,'pointercancel',touch);
  f.fire(f.confirmButton,'pointerup',touch);f.fire(f.confirmButton,'click',{detail:1});
  assert.equal(f.selected.length,0);
  assert.equal(f.ui.active,true);
  f.fire(f.confirmButton,'click',{detail:0});
  assert.equal(f.selected.length,1,'keyboard/programmatic click remains available');
});

test('a Tablet cancel tap discards the crop without calling onSelect',()=>{
  const f=fixture({touchActions:true});f.enter();draw(f);
  const touch={pointerType:'touch',clientX:50,clientY:40,cancelable:true};
  f.fire(f.cancelButton,'pointerdown',touch);f.fire(f.cancelButton,'pointerup',touch);
  assert.equal(f.ui.active,false);assert.equal(f.selected.length,0);
  assert.equal(f.hint.hidden,true);
});
function confirm(f) {f.fire(f.confirmButton, 'click');}
function closeEnough(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9,
    `coordinate ${index}: ${value} != ${expected[index]}`));
}

test('selection actions appear only after drawing, follow scroll and hide outside the viewer', () => {
  const f = fixture(); f.enter();
  assert.equal(f.hint.hidden, true);
  f.fire(f.overlay, 'pointerdown', pointer(f, .2, .25));
  f.fire(f.viewer, 'pointermove', pointer(f, .8, .75));
  assert.equal(f.hint.hidden, true);
  f.fire(f.viewer, 'pointerup', pointer(f, .8, .75));
  assert.equal(f.hint.hidden, false);
  const firstTop = Number.parseFloat(f.hint.style.top);
  assert.ok(Number.isFinite(firstTop), 'actions have a viewport position');
  const outline = f.viewer.querySelector('.visual-region-outline');
  f.canvas.bounds.top -= 80;
  f.fire(f.viewer, 'scroll');
  assert.equal(Number.parseFloat(f.hint.style.top), firstTop - 80);
  assert.equal(f.viewer.querySelector('.visual-region-outline'), outline, 'scroll does not recreate handles');
  f.canvas.bounds.top = -1000;
  f.fire(f.viewer, 'scroll');
  assert.equal(f.hint.hidden, true);
  assert.equal(f.ui.active, true, 'scrolling preserves the pending selection');
  assert.deepEqual(f.selected, []);
  f.canvas.bounds.top = 200;
  f.fire(f.viewer, 'scroll');
  assert.equal(f.hint.hidden, false);
  confirm(f);
  assert.deepEqual(f.selected, [{pageIndex: 7, rect: [.2, .25, .8, .75]}]);
});

test('mouseup leaves an editable pending rectangle without opening Assistant', () => {
  const f = fixture(); f.enter();
  f.fire(f.footer, 'pointerdown', {clientX: 300, clientY: 920});
  assert.equal(f.viewer.captures.size, 0);
  f.fire(f.overlay, 'pointerdown', {clientX: 500, clientY: 725});
  f.fire(f.viewer, 'pointerup', {clientX: 200, clientY: 375});
  assert.deepEqual(f.selected, []);
  assert.equal(f.ui.active, true);
  assert.equal(f.confirmButton.disabled, false);
  const outline = f.viewer.querySelectorAll('.visual-region-outline')[0];
  assert.match(outline.style.cssText, /left:120px;top:205px;/);
  assert.match(outline.style.cssText, /height:350px/);
  assert.deepEqual(outline.querySelectorAll('[data-region-handle]').map(node => node.dataset.regionHandle).sort(),
    ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  confirm(f);
  assert.deepEqual(f.selected, [{pageIndex: 7, rect: [.2, .25, .8, .75]}]);
  assert.deepEqual(f.confirmationStates, [{active: false, outlines: 0, hintHidden: true, captures: 0}]);
});

test('drag endpoints clamp to the original page and small clicks keep selection mode ready', () => {
  const f = fixture(); f.enter();
  f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 550});
  f.fire(f.viewer, 'pointerup', {clientX: 305, clientY: 560});
  assert.equal(f.selected.length, 0);
  assert.equal(f.ui.active, true);
  assert.equal(f.confirmButton.hidden, true);
  confirm(f);
  assert.equal(f.selected.length, 0);
  f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 550});
  f.fire(f.viewer, 'pointerup', {clientX: 20, clientY: 1000});
  assert.equal(f.selected.length, 0);
  confirm(f);
  assert.deepEqual(f.selected, [{pageIndex: 7, rect: [0, .5, .4, 1]}]);
});

test('moving a pending rectangle clamps it inside the same PDF without changing its size', () => {
  const f = fixture(); f.enter(); draw(f);
  dragTarget(f, f.viewer.querySelector('.visual-region-outline'), [.5, .5], [1.5, 1.5]);
  assert.equal(f.selected.length, 0);
  dragTarget(f, f.viewer.querySelector('.visual-region-outline'), [.7, .75], [-.5, -.5]);
  confirm(f);
  closeEnough(f.selected[0].rect, [0, 0, .6, .5]);
});

test('all eight resize handles change only their named edges and clamp to the page', () => {
  const cases = [
    ['nw', [.2, .25], [-.2, -.2], [0, 0, .8, .75]],
    ['n', [.5, .25], [.5, -.2], [.2, 0, .8, .75]],
    ['ne', [.8, .25], [1.2, -.2], [.2, 0, 1, .75]],
    ['e', [.8, .5], [1.2, .5], [.2, .25, 1, .75]],
    ['se', [.8, .75], [1.2, 1.2], [.2, .25, 1, 1]],
    ['s', [.5, .75], [.5, 1.2], [.2, .25, .8, 1]],
    ['sw', [.2, .75], [-.2, 1.2], [0, .25, .8, 1]],
    ['w', [.2, .5], [-.2, .5], [0, .25, .8, .75]],
  ];
  for (const [handle, from, to, expected] of cases) {
    const f = fixture(); f.enter(); draw(f);
    dragTarget(f, f.viewer.querySelector(`[data-region-handle="${handle}"]`), from, to);
    assert.equal(f.selected.length, 0);
    confirm(f);
    closeEnough(f.selected[0].rect, expected);
  }
});

test('resizing past the opposite edge preserves the minimum 10-pixel selection', () => {
  const cases = [
    ['nw', [.2, .25], [1, 1]], ['n', [.5, .25], [.5, 1]], ['ne', [.8, .25], [0, 1]],
    ['e', [.8, .5], [0, .5]], ['se', [.8, .75], [0, 0]], ['s', [.5, .75], [.5, 0]],
    ['sw', [.2, .75], [1, 0]], ['w', [.2, .5], [1, .5]],
  ];
  for (const [handle, from, to] of cases) {
    const f = fixture(); f.enter(); draw(f);
    dragTarget(f, f.viewer.querySelector(`[data-region-handle="${handle}"]`), from, to);
    confirm(f);
    const [x0, y0, x1, y1] = f.selected[0].rect;
    assert.ok((x1 - x0) * 500 >= 10 - 1e-8 && (y1 - y0) * 700 >= 10 - 1e-8, handle);
    if (/[ew]/.test(handle)) assert.ok(Math.abs((x1 - x0) * 500 - 10) < 1e-8, handle);
    if (/[ns]/.test(handle)) assert.ok(Math.abs((y1 - y0) * 700 - 10) < 1e-8, handle);
  }
});

test('Escape releases pointer capture, hides temporary UI and cannot complete a cancelled region', () => {
  const f = fixture(); f.enter();
  f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 500});
  const escape = f.fire(f.viewer, 'keydown', {key: 'Escape'});
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.ui.active, false);
  assert.equal(f.viewer.captures.size, 0);
  assert.equal(f.hint.hidden, true);
  assert.equal(f.toggle.attributes.get('aria-pressed'), 'false');
  assert.equal(f.viewer.querySelectorAll('.visual-region-outline').length, 0);
  f.fire(f.viewer, 'pointerup', {clientX: 500, clientY: 700});
  assert.equal(f.selected.length, 0);
});

test('Escape, cancel button and toolbar toggle discard a completed pending rectangle', () => {
  for (const cancel of [f => f.fire(f.viewer, 'keydown', {key: 'Escape'}),
    f => f.fire(f.cancelButton, 'click'), f => f.fire(f.toggle, 'click')]) {
    const f = fixture(); f.enter(); draw(f);
    cancel(f);
    assert.equal(f.ui.active, false);
    assert.equal(f.hint.hidden, true);
    assert.equal(f.viewer.querySelectorAll('.visual-region-outline').length, 0);
    confirm(f);
    assert.equal(f.selected.length, 0);
  }
});

test('pointer cancellation, focus loss and layout changes abort a pending crop', () => {
  for (const cancel of [f => f.fire(f.viewer, 'pointercancel'), f => f.fire(f.window, 'blur'), f => f.resize()]) {
    const f = fixture(); f.enter();
    f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 500});
    cancel(f);
    f.fire(f.viewer, 'pointerup', {clientX: 500, clientY: 700});
    assert.equal(f.ui.active, false);
    assert.equal(f.viewer.captures.size, 0);
    assert.equal(f.selected.length, 0);
  }
});

test('capture prevents active region gestures reaching Practice or text-selection handlers', () => {
  const f = fixture();
  let practiceDown = 0, practiceUp = 0;
  f.overlay.addEventListener('pointerdown', () => practiceDown++);
  f.overlay.addEventListener('pointerup', () => practiceUp++);
  f.enter();
  f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 500});
  f.fire(f.overlay, 'pointerup', {clientX: 500, clientY: 700});
  assert.equal(practiceDown, 0); assert.equal(practiceUp, 0);
  assert.equal(f.ui.active, true);
  confirm(f);
  // After the temporary mode ends, ordinary Reader interactions work again.
  f.fire(f.overlay, 'pointerdown', {clientX: 300, clientY: 500});
  f.fire(f.overlay, 'pointerup', {clientX: 300, clientY: 500});
  assert.equal(practiceDown, 1); assert.equal(practiceUp, 1);
});

test('Enter confirms the region without bubbling a Practice submission, then normal keys recover', () => {
  const f = fixture();
  const choices = [], submissions = [];
  Object.assign(f.context, {visualSelection: f.ui, elements: {viewer: f.viewer, 'outline-panel': {hidden: true}},
    state: {practice: {active: true}, selection: null, pinnedLanding: null},
    selectPracticeChoice: choice => choices.push(choice), submitPracticeChoice: () => submissions.push(true)});
  const start = app.indexOf('elements.viewer.addEventListener("keydown", (event) => {');
  const end = app.indexOf('document.addEventListener("copy"', start);
  vm.runInContext(app.slice(start, end), f.context);
  f.enter();
  f.fire(f.viewer, 'keydown', {key: 'A'}); f.fire(f.viewer, 'keydown', {key: 'Enter'});
  assert.deepEqual(choices, []); assert.deepEqual(submissions, []);
  assert.equal(f.selected.length, 0);
  draw(f);
  const enter = f.fire(f.viewer, 'keydown', {key: 'Enter'});
  assert.equal(enter.defaultPrevented, true);
  assert.equal(f.selected.length, 1);
  assert.deepEqual(submissions, []);
  assert.deepEqual(f.confirmationStates, [{active: false, outlines: 0, hintHidden: true, captures: 0}]);
  f.fire(f.viewer, 'keydown', {key: 'b'}); f.fire(f.viewer, 'keydown', {key: 'Enter'});
  assert.deepEqual(choices, ['B']); assert.deepEqual(submissions, [true]);
});

test('pending source coordinates survive viewer resize and explicit clear removes the outline', () => {
  const f = fixture(); f.enter();
  f.fire(f.overlay, 'pointerdown', {clientX: 200, clientY: 375});
  f.fire(f.viewer, 'pointerup', {clientX: 500, clientY: 725});
  f.canvas.clientWidth = 1000; f.canvas.clientHeight = 1400;
  f.resize();
  assert.equal(f.selected.length, 0);
  assert.match(f.viewer.querySelectorAll('.visual-region-outline')[0].style.cssText, /left:220px;top:380px;/);
  confirm(f);
  assert.deepEqual(f.selected[0].rect, [.2, .25, .8, .75]);
  f.ui.cancel({clear: true});
  assert.equal(f.viewer.querySelectorAll('.visual-region-outline').length, 0);
  f.enabled.value = false; f.enter();
  assert.equal(f.ui.active, false);
  assert.equal(f.enters, 1);
});

test('a PDF canvas removed by virtualization cannot complete a different crop', () => {
  const f = fixture(); f.enter();
  f.fire(f.overlay, 'pointerdown', {clientX: 200, clientY: 375});
  f.canvas.remove();
  f.fire(f.viewer, 'pointerup', {clientX: 500, clientY: 725});
  assert.equal(f.selected.length, 0);
  assert.equal(f.ui.active, false);
  assert.equal(f.viewer.captures.size, 0);
});

test('confirming a pending region after its source canvas is removed cancels it', () => {
  const f = fixture(); f.enter(); draw(f);
  f.canvas.remove();
  confirm(f);
  assert.equal(f.selected.length, 0);
  assert.equal(f.ui.active, false);
  assert.equal(f.viewer.querySelectorAll('.visual-region-outline').length, 0);
});

test('a visual reply binds its preview to the new root when focus moved to an older topic', () => {
  const previousImage = {image: {data_url: 'previous-crop'}};
  const images = new Map([['old-root', previousImage]]);
  const context = vm.createContext({assistantRegionImages: images});
  const start = app.indexOf('function cacheAssistantRegion(');
  const end = app.indexOf('async function sendAssistantFirstTurn(', start);
  vm.runInContext(app.slice(start, end), context);
  const preview = {pdf_page_index: 7, rect: [.2, .25, .8, .75], image: {data_url: 'new-crop'}};
  const nextState = {current: {root_id: 'old-root'}, roots: [
    {root_id: 'old-root', created_from: {kind: 'VISUAL_REGION',
      visual_region: {pdf_page_index: 7, rect: preview.rect}}},
    {root_id: 'new-root', created_from: {kind: 'VISUAL_REGION',
      visual_region: {pdf_page_index: 7, rect: preview.rect}}},
  ]};
  context.cacheAssistantRegion(preview, new Set(['old-root']), nextState);
  assert.equal(images.get('old-root'), previousImage);
  assert.equal(images.get('new-root'), preview);
});

test('preview caching requires a new visual root with the same page and rectangle', () => {
  const images = new Map();
  const context = vm.createContext({assistantRegionImages: images});
  const start = app.indexOf('function cacheAssistantRegion(');
  const end = app.indexOf('async function sendAssistantFirstTurn(', start);
  vm.runInContext(app.slice(start, end), context);
  const preview = {pdf_page_index: 7, rect: [.2, .25, .8, .75], image: {data_url: 'new-crop'}};
  const roots = [
    {root_id: 'wrong-page', created_from: {kind: 'VISUAL_REGION',
      visual_region: {pdf_page_index: 8, rect: preview.rect}}},
    {root_id: 'wrong-rect', created_from: {kind: 'VISUAL_REGION',
      visual_region: {pdf_page_index: 7, rect: [.2, .25, .8, .85]}}},
    {root_id: 'text-root', created_from: {kind: 'ORIGINAL_PDF',
      visual_region: {pdf_page_index: 7, rect: preview.rect}}},
    {root_id: 'already-present', created_from: {kind: 'VISUAL_REGION',
      visual_region: {pdf_page_index: 7, rect: preview.rect}}},
  ];
  context.cacheAssistantRegion(preview, new Set(['already-present']), {roots});
  assert.equal(images.size, 0);
  context.cacheAssistantRegion(null, new Set(), {roots});
  assert.equal(images.size, 0);
});
