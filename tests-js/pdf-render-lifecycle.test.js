import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';

// Run the actual Reader render lifecycle with controlled PDF reads/renders.
const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lifecycle = app.slice(app.indexOf('async function renderPage(index)'), app.indexOf('function setCurrentPage(index)'));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};

function fixture() {
  const reads = [], renders = [], mounts = [], errors = [];
  const wrapper = {classList: {add() {}, remove() {}}, querySelector() {return null;}, replaceChildren(...nodes) {mounts.push(nodes);}};
  const state = {pdf: {getPage() {const read = deferred(); reads.push(read); return read.promise;}},
    generation: 1, renderGeneration: 1, rendered: new Set(), renderTasks: new Map(), pageRenderRequests: new Map(), pageProxies: new Map()};
  const context = vm.createContext({state, elements: {pages: {children: [wrapper], querySelectorAll() {return [];}}},
    document: {createElement() {return {style: {}, dataset: {}, getContext() {return {};}};}},
    snappedPageSize: () => ({backingWidth: 600, backingHeight: 800, cssWidth: 600, cssHeight: 800, pixelRatio: 1}),
    applyPageSize() {}, master: {renderPage() {}}, visualSelection: {render() {}}, renderGuideEntries() {}, renderPracticeOverlay() {},
    syncPagePreparationUi() {}, ensureOverlay() {}, clearSelection() {}, startReaderContext() {}, scheduleViewportUpdate() {}, announce: message => errors.push(message)});
  vm.runInContext(lifecycle, context);
  const pdfPage = {cleanup() {}, getViewport: () => ({width: 600, height: 800}), render() {
    const render = deferred();
    renders.push(render);
    return {promise: render.promise, cancel() {render.resolve();}};
  }};
  return {context, state, reads, renders, mounts, errors, pdfPage};
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

test('Inline reserve change rebuilds PDF layout even when the viewer width is unchanged', () => {
  let reserve = 0;
  const anchor = {pageIndex: 9, normalizedY: .5};
  const calls = [];
  const context = vm.createContext({state: {practice: {active: false}},
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
  const context = vm.createContext({state: {practice: {active: false}},
    captureZoomAnchor: () => null, inlineReserve: () => 0,
    relayoutPages: () => calls.push('render'), evaluateDirectoryMode: () => calls.push('directory')});
  const source = app.match(/layout: (change => \{[\s\S]*?\n  \}),\n  closeDock/)[1];
  vm.runInContext(`var layout = ${source};`, context);
  context.layout(() => {});
  assert.deepEqual(calls, ['directory']);
});
