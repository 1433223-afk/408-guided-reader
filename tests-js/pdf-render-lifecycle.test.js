import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';

// Run the actual Reader render lifecycle with controlled PDF reads/renders.
const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
const lifecycle = app.slice(app.indexOf('async function renderPage(index)'), app.indexOf('function setCurrentPage(index)'));
const relayout = app.slice(app.indexOf('function relayoutPages('), app.indexOf('function captureZoomAnchor('));
const tabletRange = app.slice(app.indexOf('function tabletVisiblePageRange('), app.indexOf('function updateViewport('));
const viewportUpdate = app.slice(app.indexOf('function updateViewport('), app.indexOf('async function renderPage('));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

test('tablet page-top navigation excludes the preceding blank gap and finds only intersecting original pages', () => {
  const pages = Array.from({length: 348}, (_, index) => ({offsetTop: 20 + index * 1020, offsetHeight: 1000}));
  let reads = 0;
  const measured = pages.map(page => ({get offsetTop() {reads += 1; return page.offsetTop;},
    get offsetHeight() {reads += 1; return page.offsetHeight;}}));
  const context = vm.createContext({elements: {pages: {children: measured}}});
  vm.runInContext(tabletRange, context);
  const range = context.tabletVisiblePageRange(pages[309].offsetTop, pages[309].offsetTop + 700);
  assert.equal(range.first, 309);
  assert.equal(range.last, 309);
  assert.ok(reads < 40, 'A distant jump must not scan all 348 layout boxes');
  const across = context.tabletVisiblePageRange(pages[91].offsetTop + 990, pages[92].offsetTop + 300);
  assert.equal(across.first, 91);
  assert.equal(across.last, 92);
  const gap = context.tabletVisiblePageRange(pages[91].offsetTop + 1005, pages[92].offsetTop + 300);
  assert.equal(gap.first, 92);
  assert.equal(gap.last, 92);
});

test('unrelated tablet viewport updates do not repeatedly cancel a neighbour HD prefetch', () => {
  const pauses = [];
  const pages = Array.from({length: 3}, (_, index) => ({dataset: {index: String(index)}, offsetTop: index * 1020,
    offsetHeight: 1000, style: {}}));
  const viewer = {scrollTop: 0, clientHeight: 600, getBoundingClientRect: () => ({top: 0})};
  const state = {pdf: {numPages: 3}, rendered: new Set([0]), pageRenderRequests: new Map([[1, {}]]),
    tabletRetained: new Set(), tabletVisibleRange: {first: 0, last: 0}};
  const context = vm.createContext({state, tabletMode: true, elements: {pages: {children: pages}, viewer},
    captureZoomAnchor: () => ({pageIndex: Math.floor(viewer.scrollTop / 1020)}), setCurrentPage() {}, renderReaderSectionHint() {},
    renderPage() {}, clearPage() {}, scheduleSave() {}, schedulePreparationPriority() {},
    pauseTabletUpgrade(index) {pauses.push(index);}});
  vm.runInContext(tabletRange + viewportUpdate, context);
  context.updateViewport(); context.updateViewport();
  assert.deepEqual(pauses, [], 'OCR/status completion on the current page must let the neighbour finish');
  state.pageRenderRequests = new Map([[0, {}]]); viewer.scrollTop = 1020;
  context.updateViewport(); context.updateViewport();
  assert.deepEqual(pauses, [0], 'A genuine page change gives its visible preview priority exactly once');
});

function fixture({tablet = false, retained = false, cancelCompletes = true} = {}) {
  const reads = [], renders = [], mounts = [], swaps = [], canvases = [], errors = [], classes = new Set();
  const wrapper = {children: [], classList: {add(value) {classes.add(value);}, remove(value) {classes.delete(value);}},
    querySelector(selector) {return wrapper.children.find(node => node.kind === selector) || null;},
    get firstChild() {return wrapper.children[0];},
    replaceChildren(...nodes) {
      mounts.push(nodes);
      for (const node of wrapper.children) node.parentElement = null;
      wrapper.children = nodes;
      for (const node of nodes) node.parentElement = wrapper;
    }};
  function node(kind) {
    return {kind, style: {}, dataset: {}, parentElement: null, getContext() {return {};},
      get isConnected() {return this.parentElement === wrapper;},
      replaceWith(replacement) {
        const at = wrapper.children.indexOf(this);
        assert.ok(at >= 0, 'Only a connected old canvas may be replaced');
        wrapper.children[at] = replacement;
        replacement.parentElement = wrapper;
        this.parentElement = null;
        swaps.push({previous: this, replacement});
      }};
  }
  const oldCanvas = retained ? node('canvas') : null, overlay = retained ? node('.text-overlay') : null;
  if (retained) {
    oldCanvas.width = 300; oldCanvas.height = 400;
    wrapper.children.push(oldCanvas, overlay);
    oldCanvas.parentElement = overlay.parentElement = wrapper;
  }
  const state = {pdf: {getPage() {const read = deferred(); reads.push(read); return read.promise;}},
    generation: 1, renderGeneration: 1, revision: {page_geometry: [{}]}, rendered: new Set(retained ? [0] : []),
    tabletRetained: new Set(), renderTasks: new Map(), pageRenderRequests: new Map()};
  const context = vm.createContext({state, tabletMode: tablet, tabletInk: null, elements: {pages: {children: [wrapper]}, viewer: {clientWidth: 600}},
    document: {createElement(kind) {const canvas = node(kind); canvases.push(canvas); return canvas;}},
    snappedPageSize: () => ({backingWidth: 600, backingHeight: 800, cssWidth: 600, cssHeight: 800, pixelRatio: 1}),
    applyPageSize() {}, master: {renderPage() {}}, visualSelection: {render() {}}, renderGuideEntries() {}, renderPracticeOverlay() {},
    syncPagePreparationUi() {}, ensureOverlay() {}, clearSelection() {}, announce: message => errors.push(message),
    displayedRatio: () => 4 / 3, pageLeftMargin: () => 0, captureZoomAnchor: () => null, restoreZoomAnchor() {},
    scheduleViewportUpdate() {}, scheduleSave() {}, evaluateDirectoryMode() {}});
  vm.runInContext(lifecycle + relayout, context);
  const pdfPage = {getViewport: () => ({width: 600, height: 800}), render(options) {
    const render = deferred();
    render.options = options;
    renders.push(render);
    return {promise: render.promise, cancel() {if (cancelCompletes) render.resolve();}};
  }};
  return {context, state, reads, renders, mounts, swaps, canvases, classes, wrapper, oldCanvas, overlay, errors, pdfPage};
}

test('duplicate viewport updates share one pending page read', async () => {
  const f = fixture();
  const first = f.context.renderPage(0);
  await f.context.renderPage(0);
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  f.renders[0].resolve();
  await first;
  assert.equal(f.mounts.length, 1);
  assert.equal(f.state.rendered.has(0), true);
  assert.equal(f.state.pageRenderRequests.size, 0);
});

test('tablet next-image prefetch can overlap the visible selectable-text request', async () => {
  const f = fixture();
  const textReady = deferred();
  let viewportUpdates = 0;
  f.context.tabletMode = true;
  f.context.ensureOverlay = () => textReady.promise;
  f.context.scheduleViewportUpdate = () => {viewportUpdates += 1;};
  const pending = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  f.renders[0].resolve();
  await setImmediate();
  assert.equal(f.state.rendered.has(0), true, 'PDF is visible while its text loads');
  assert.equal(f.state.pageRenderRequests.has(0), true, 'Track the unfinished OCR request for cancellation');
  assert.equal(f.state.pageRenderRequests.get(0).imageReady, true, 'An OCR-only request no longer blocks next-page image transfer');
  assert.equal(viewportUpdates, 1);
  textReady.resolve();
  await pending;
  assert.equal(f.state.pageRenderRequests.has(0), false);
  assert.equal(viewportUpdates, 2);
  assert.deepEqual(f.errors, []);
});

test('tablet first preview mounts once and keeps its original OCR target during the full-detail paint', async () => {
  const f = fixture({tablet: true});
  const overlay = {kind: '.text-overlay', parentElement: null};
  f.context.ensureOverlay = () => {
    if (!f.wrapper.children.includes(overlay)) {f.wrapper.children.push(overlay); overlay.parentElement = f.wrapper;}
  };
  const pending = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  f.renders[0].options.onPreview();
  const canvas = f.wrapper.querySelector('canvas');
  assert.ok(canvas);
  assert.equal(f.wrapper.querySelector('.text-overlay'), overlay);
  assert.equal(f.classes.has('loading'), false);
  assert.equal(f.state.rendered.has(0), false, 'A thumbnail never masquerades as completed full detail');
  f.renders[0].resolve();
  await pending;
  assert.equal(f.wrapper.querySelector('canvas'), canvas);
  assert.equal(f.wrapper.querySelector('.text-overlay'), overlay);
  assert.equal(f.mounts.length, 1, 'Completing the same canvas cannot destroy its connected selectable text');
  assert.equal(f.state.rendered.has(0), true);
});

test('turning past a preview pauses only its HD upgrade and preserves the page and OCR for Back', async () => {
  const f = fixture({tablet: true});
  const pending = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  f.renders[0].options.onPreview();
  const canvas = f.wrapper.querySelector('canvas');
  canvas.dataset.readerPreview = 'true';
  f.context.pauseTabletUpgrade(0);
  assert.equal(f.state.pageRenderRequests.size, 0);
  assert.equal(f.state.renderTasks.size, 0);
  assert.equal(f.state.tabletRetained.has(0), true);
  assert.equal(f.wrapper.querySelector('canvas'), canvas);
  await pending;
  assert.equal(f.state.rendered.has(0), false);
  assert.equal(f.wrapper.querySelector('canvas'), canvas);
});

test('virtualized page cannot be resurrected by an old read', async () => {
  const f = fixture();
  const pending = f.context.renderPage(0);
  f.context.clearPage(0);
  f.reads[0].resolve(f.pdfPage);
  await pending;
  assert.deepEqual(f.mounts, [[]]);
  assert.equal(f.renders.length, 0);
  assert.equal(f.state.rendered.size, 0);
});

test('late old read cannot clear the replacement request after a relayout', async () => {
  const f = fixture();
  const old = f.context.renderPage(0);
  f.state.renderGeneration++;
  f.context.cancelRenders();
  const current = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await old;
  assert.equal(f.state.pageRenderRequests.size, 1);
  assert.equal(f.mounts.length, 0);
  f.reads[1].resolve(f.pdfPage);
  await setImmediate();
  f.renders[0].resolve();
  await current;
  assert.equal(f.mounts.length, 1);
  assert.equal(f.state.rendered.has(0), true);
});

test('cancelled old render cannot remove the new render task', async () => {
  const f = fixture();
  const old = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  f.context.clearPage(0);
  const current = f.context.renderPage(0);
  f.reads[1].resolve(f.pdfPage);
  await setImmediate();
  await old;
  assert.equal(f.state.renderTasks.size, 1);
  f.renders[1].resolve();
  await current;
  assert.equal(f.state.rendered.has(0), true);
  assert.deepEqual(f.errors, []);
});

test('tablet zoom keeps the original canvas and OCR connected until the full replacement has painted', async () => {
  const f = fixture({tablet: true, retained: true});
  f.context.relayoutPages();
  assert.equal(f.oldCanvas.isConnected, true);
  assert.equal(f.overlay.isConnected, true);
  assert.equal(f.oldCanvas.style.width, '600px', 'Old pixels immediately follow the new CSS zoom');
  assert.equal(f.state.tabletRetained.has(0), true);
  const pending = f.context.renderPage(0);
  f.reads[0].resolve(f.pdfPage);
  await setImmediate();
  const replacement = f.canvases[0];
  assert.equal(replacement.isConnected, false, 'The new full-resolution canvas paints offscreen');
  assert.equal(f.wrapper.querySelector('canvas'), f.oldCanvas);
  assert.equal(f.wrapper.querySelector('.text-overlay'), f.overlay);
  assert.equal(f.oldCanvas.isConnected && f.overlay.isConnected, true);
  assert.equal(f.classes.has('loading'), false, 'A readable retained canvas never becomes a blank loading page');
  f.renders[0].resolve();
  await pending;
  assert.equal(f.wrapper.querySelector('canvas'), replacement);
  assert.equal(f.oldCanvas.isConnected, false);
  assert.equal(replacement.isConnected && f.overlay.isConnected, true);
  assert.equal(f.wrapper.querySelector('.text-overlay'), f.overlay, 'Preserve the actual OCR event target across the swap');
  assert.equal(f.swaps.length, 1);
  assert.equal(f.mounts.length, 0, 'Never clear the page around a retained OCR layer');
  assert.equal(f.state.tabletRetained.has(0), false);
  assert.deepEqual(f.errors, []);
});

for (const delayed of ['read', 'render']) test(`tablet late old ${delayed} cannot replace or clear the current canvas after another zoom`, async () => {
  const f = fixture({tablet: true, retained: true, cancelCompletes: false});
  f.context.relayoutPages();
  const old = f.context.renderPage(0);
  if (delayed === 'render') {
    f.reads[0].resolve(f.pdfPage);
    await setImmediate();
  }
  f.context.relayoutPages();
  assert.equal(f.oldCanvas.isConnected && f.overlay.isConnected, true, 'Cancellation keeps the previous readable page');
  const current = f.context.renderPage(0);
  f.reads[1].resolve(f.pdfPage);
  await setImmediate();
  const currentRender = f.renders.at(-1), currentCanvas = f.canvases.at(-1);
  currentRender.resolve();
  await current;
  assert.equal(f.wrapper.querySelector('canvas'), currentCanvas);
  if (delayed === 'read') f.reads[0].resolve(f.pdfPage);
  else f.renders[0].resolve();
  await old;
  assert.equal(f.wrapper.querySelector('canvas'), currentCanvas);
  assert.equal(currentCanvas.isConnected && f.overlay.isConnected, true);
  assert.equal(f.wrapper.querySelector('.text-overlay'), f.overlay);
  assert.equal(f.swaps.length, 1, 'Only the latest owned render is allowed to swap');
  assert.equal(f.mounts.length, 0, 'An obsolete finally block cannot clear the current page');
  assert.equal(f.state.rendered.has(0), true);
  assert.equal(f.state.renderTasks.size, 0);
  assert.equal(f.state.pageRenderRequests.size, 0);
  assert.deepEqual(f.errors, []);
});

test('Inline reserve change rebuilds PDF layout even when the viewer width is unchanged', () => {
  let reserve = 0;
  const anchor = {pageIndex: 9, normalizedY: .5};
  const calls = [];
  const context = vm.createContext({tabletMode: false, state: {practice: {active: false}},
    captureZoomAnchor: () => anchor, inlineReserve: () => reserve,
    relayoutPages: saved => calls.push(saved), evaluateDirectoryMode: () => calls.push('directory')});
  const source = app.match(/layout: (change => \{[\s\S]*?\n  \}),\n  closeDock/)[1];
  vm.runInContext(`var layout = ${source};`, context);
  context.layout(() => {reserve = 332;});
  context.layout(() => {reserve = 0;});
  assert.deepEqual(calls, [anchor, anchor]);
});

test('a teaching UI update without a changed reserve does not rebuild PDF pages', () => {
  const calls = [];
  const context = vm.createContext({tabletMode: false, state: {practice: {active: false}},
    captureZoomAnchor: () => null, inlineReserve: () => 0,
    relayoutPages: () => calls.push('render'), evaluateDirectoryMode: () => calls.push('directory')});
  const source = app.match(/layout: (change => \{[\s\S]*?\n  \}),\n  closeDock/)[1];
  vm.runInContext(`var layout = ${source};`, context);
  context.layout(() => {});
  assert.deepEqual(calls, ['directory']);
});
