import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as tick} from 'node:timers/promises';
import {clearTabletPdfPageCache, createTabletPdfPages} from '../src/reader_service/static/tablet-pdf-pages.js';

const revision = {id: 'revision-a', blob_sha256: 'a'.repeat(64), page_count: 3,
  page_geometry: [{media_box: [0, 0, 900, 600], rotation: 90}]};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const isCancelled = error => error.name === 'RenderingCancelledException';

function install(t, values) {
  clearTabletPdfPageCache();
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  t.after(clearTabletPdfPageCache);
}

function blob(width = 400, height = width * 2, data = 'png body') {
  return Object.assign(new Blob([data], {type: 'image/png'}), {pixelWidth: width, pixelHeight: height});
}

function response({width = 400, height = width * 2, pointWidth = 200, pointHeight = 400,
  status = 200, body = blob(width, height)} = {}) {
  let reads = 0;
  return {ok: status >= 200 && status < 300, status,
    headers: new Headers({'X-Reader-Page-Width': String(pointWidth), 'X-Reader-Page-Height': String(pointHeight),
      'X-Reader-Image-Width': String(width), 'X-Reader-Image-Height': String(height)}),
    blob() {reads += 1; return Promise.resolve(body);}, get reads() {return reads;}};
}

function bitmapDecoder(closed = []) {
  return async body => ({width: body.pixelWidth, height: body.pixelHeight, close() {closed.push(body);}});
}

function context() {
  const calls = [];
  return {calls, canvas: {width: 400, height: 800, dataset: {}}, save() {calls.push(['save']);},
    restore() {calls.push(['restore']);}, transform(...matrix) {calls.push(['transform', ...matrix]);},
    drawImage(...arguments_) {calls.push(['draw', ...arguments_]);}};
}

function create(options = {}) {
  return createTabletPdfPages({revision, getWidth: () => 400, token: 'test-token',
    loadFallback: () => {throw new Error('Unexpected PDF.js fallback');}, ...options});
}

async function paint(document, number = 1) {
  const page = await document.getPage(number);
  const canvasContext = context();
  await page.render({canvasContext, viewport: page.getViewport({scale: 2}), transform: [1, 0, 0, 1, 0, 0]}).promise;
  return canvasContext;
}

test('headers resolve the real viewport before the image body, then paint with the caller transform', async t => {
  const body = deferred(), fetches = [], closed = [];
  const incoming = response({body: body.promise});
  install(t, {fetch: (url, options) => {fetches.push({url, options}); return Promise.resolve(incoming);}, createImageBitmap: bitmapDecoder(closed)});
  const document = create();
  const page = await document.getPage(2);
  assert.equal(document.numPages, 3);
  assert.equal(incoming.reads, 0, 'getPage only awaits response headers');
  assert.deepEqual(page.getViewport({scale: 1}), {width: 200, height: 400, scale: 1});
  assert.equal(fetches[0].url, '/api/revisions/revision-a/page-image?page=1&width=400');
  assert.equal(fetches[0].options.headers['X-Reader-Token'], 'test-token');
  assert.equal(fetches[0].options.credentials, 'include');
  const canvasContext = context(), transform = [1.25, 0, 0, 1.5, 7, 9];
  let complete = false;
  const render = page.render({canvasContext, viewport: page.getViewport({scale: 2}), transform});
  render.promise.then(() => {complete = true;});
  await tick();
  assert.equal(incoming.reads, 1);
  assert.equal(complete, false);
  assert.equal(canvasContext.calls.length, 0);
  body.resolve(blob());
  await render.promise;
  assert.deepEqual(canvasContext.calls[1], ['transform', ...transform]);
  assert.deepEqual(canvasContext.calls[2].slice(2), [0, 0, 400, 800]);
  assert.equal(closed.length, 1);
  assert.equal(canvasContext.canvas.dataset.readerRenderer, 'page-image');
});

test('a cold tablet page paints its original-source preview before full detail on the same canvas', async t => {
  const fullBody = deferred(), requests = [], closed = [];
  install(t, {fetch: async url => {
    const width = Number(new URL(url, 'http://reader.invalid').searchParams.get('width'));
    requests.push(width);
    return response({width, body: width === 1024 ? fullBody.promise : blob(width)});
  }, createImageBitmap: bitmapDecoder(closed)});
  const document = create({getWidth: () => 1024});
  const page = await document.getPage(1, {preview: true}), canvasContext = context();
  let previews = 0;
  const pending = page.render({canvasContext, viewport: page.getViewport({scale: 1024 / 200}),
    onPreview() {previews += 1; assert.equal(canvasContext.canvas.dataset.readerImageWidth, '512');}}).promise;
  await tick();
  assert.equal(previews, 1);
  assert.equal(canvasContext.canvas.dataset.readerPreview, 'true');
  assert.equal(canvasContext.calls.filter(row => row[0] === 'draw').length, 1);
  assert.deepEqual(requests, [512, 1024]);
  fullBody.resolve(blob(1024));
  await pending;
  assert.equal(canvasContext.canvas.dataset.readerImageWidth, '1024', 'Full detail is mandatory even after a usable first paint');
  assert.equal(canvasContext.canvas.dataset.readerPreview, undefined);
  assert.equal(canvasContext.calls.filter(row => row[0] === 'draw').length, 2);
  assert.equal(closed.length, 2);
  const cachedPage = await document.getPage(1, {preview: true});
  const cachedCanvas = context();
  await cachedPage.render({canvasContext: cachedCanvas, viewport: cachedPage.getViewport({scale: 1024 / 200}),
    onPreview() {previews += 1;}}).promise;
  assert.deepEqual(requests, [512, 1024], 'An already cached full page bypasses the thumbnail request');
  assert.equal(previews, 1);
});

test('cancelling during a cold preview aborts the pending full image without painting stale detail', async t => {
  const fullBody = deferred(), requests = [];
  install(t, {fetch: async (url, options) => {
    const width = Number(new URL(url, 'http://reader.invalid').searchParams.get('width'));
    requests.push({width, signal: options.signal});
    return response({width, body: width === 1024 ? fullBody.promise : blob(width)});
  }, createImageBitmap: bitmapDecoder()});
  const document = create({getWidth: () => 1024});
  const page = await document.getPage(1, {preview: true}), canvasContext = context();
  const pending = page.render({canvasContext, viewport: page.getViewport({scale: 1024 / 200})}).promise;
  await tick();
  assert.equal(canvasContext.calls.filter(row => row[0] === 'draw').length, 1);
  document.cancelPage(1);
  await assert.rejects(pending, isCancelled);
  assert.equal(requests.every(row => row.signal.aborted), true);
  fullBody.resolve(blob(1024));
  await tick();
  assert.equal(canvasContext.calls.filter(row => row[0] === 'draw').length, 1);
});

test('completed blobs and exact geometry survive document destruction, keyed by source/page/current pixel width', async t => {
  let width = 400;
  const requests = [], closed = [];
  install(t, {fetch: async url => {requests.push(url); return response({width});}, createImageBitmap: bitmapDecoder(closed)});
  const first = create({getWidth: () => width});
  await paint(first);
  first.destroy();
  const reopened = create({revision: {...revision, id: 'another-revision'}, getWidth: () => width});
  await paint(reopened);
  assert.equal(requests.length, 1, 'same immutable PDF reuses the RAM blob');
  width = 800;
  await paint(reopened);
  assert.equal(requests.length, 2, 'zoom/DPR width never reuses a smaller image');
  assert.match(requests[1], /width=800$/);
  await paint(create({revision: {...revision, blob_sha256: 'b'.repeat(64)}, getWidth: () => width}));
  assert.equal(requests.length, 3, 'another source cannot reuse the image');
  assert.equal(closed.length, 4);
});

test('zooming out reuses the closest larger original image but zooming in never uses fewer source pixels', async t => {
  let width = 800;
  const requests = [];
  install(t, {fetch: async url => {requests.push(url); return response({width});}, createImageBitmap: bitmapDecoder()});
  const document = create({getWidth: () => width});
  await paint(document);
  width = 300; // More than a 2x decode penalty: fetch the right-sized original.
  await paint(document);
  width = 600;
  const smaller = await paint(document);
  assert.equal(requests.length, 2);
  assert.equal(smaller.canvas.dataset.readerImageWidth, '800');
  width = 900;
  await paint(document);
  assert.equal(requests.length, 3, 'A smaller cached PNG must never be the final zoomed-in image');
  width = 700;
  const closest = await paint(document);
  assert.equal(requests.length, 3);
  assert.equal(closest.canvas.dataset.readerImageWidth, '800', 'Avoid decoding the larger 900px image unnecessarily');
  await paint(document, 2);
  assert.equal(requests.length, 4, 'Neighbouring pages cannot reuse the source pixels');
});

test('a completed body remains reusable when zoom cancels only its pending decode', async t => {
  const pending = deferred();
  let requests = 0, decodes = 0;
  install(t, {fetch: async () => {requests += 1; return response();}, createImageBitmap: body => {
    decodes += 1;
    return decodes === 1 ? pending.promise : bitmapDecoder()(body);
  }});
  const document = create(), page = await document.getPage(1), canvasContext = context();
  const render = page.render({canvasContext, viewport: page.getViewport({scale: 2})});
  await tick();
  render.cancel();
  await assert.rejects(render.promise, isCancelled);
  await paint(document);
  assert.equal(requests, 1, 'The complete source image must not be requested twice');
  let released = 0;
  pending.resolve({width: 400, height: 800, close() {released += 1;}});
  await tick();
  assert.equal(released, 1);
  assert.equal(canvasContext.calls.length, 0, 'Cancelled decode never paints the old target');
});

test('cancelPage aborts an awaited response header without loading fallback', async t => {
  const head = deferred();
  let signal, fallbacks = 0;
  install(t, {fetch: (_url, options) => {signal = options.signal; return head.promise;}});
  const document = create({loadFallback: () => {fallbacks += 1;}});
  const pending = document.getPage(2);
  document.cancelPage(2);
  await assert.rejects(pending, isCancelled);
  assert.equal(signal.aborted, true);
  head.resolve(response());
  await tick();
  assert.equal(fallbacks, 0);
});

test('cancelAll stops the body, keeps future pages usable and destroy cancels future getPage', async t => {
  const body = deferred();
  let fallbacks = 0, signal;
  install(t, {fetch: async (_url, options) => {signal = options.signal; return response({body: body.promise});}, createImageBitmap: bitmapDecoder()});
  const document = create({loadFallback: () => {fallbacks += 1;}});
  const page = await document.getPage(1), canvasContext = context();
  const render = page.render({canvasContext, viewport: page.getViewport({scale: 2})});
  await tick();
  document.cancelAll();
  await assert.rejects(render.promise, isCancelled);
  assert.equal(signal.aborted, true);
  body.resolve(blob());
  await tick();
  assert.equal(canvasContext.calls.length, 0);
  assert.equal(fallbacks, 0);
  const next = await document.getPage(1);
  await next.render({canvasContext, viewport: next.getViewport({scale: 2})}).promise;
  assert.equal(canvasContext.calls.some(call => call[0] === 'draw'), true);
  document.destroy();
  await assert.rejects(document.getPage(1), isCancelled);
});

test('a bitmap completing after cancellation is released and can never draw into the old canvas', async t => {
  const decoded = deferred();
  let closes = 0, fallbacks = 0;
  install(t, {fetch: async () => response(), createImageBitmap: () => decoded.promise});
  const document = create({loadFallback: () => {fallbacks += 1;}});
  const page = await document.getPage(1), canvasContext = context();
  const render = page.render({canvasContext, viewport: page.getViewport({scale: 2})});
  await tick();
  render.cancel();
  await assert.rejects(render.promise, isCancelled);
  decoded.resolve({width: 400, height: 800, close() {closes += 1;}});
  await tick();
  assert.equal(closes, 1);
  assert.equal(canvasContext.calls.length, 0);
  assert.equal(fallbacks, 0);
});

test('cancelAll covers multiple header requests and destroy is idempotent', async t => {
  const signals = [];
  install(t, {fetch: (_url, {signal}) => {signals.push(signal); return new Promise(() => {});}});
  const document = create();
  const one = document.getPage(1), two = document.getPage(2);
  document.cancelAll();
  await Promise.all([assert.rejects(one, isCancelled), assert.rejects(two, isCancelled)]);
  assert.equal(signals.every(signal => signal.aborted), true);
  document.destroy();
  document.destroy();
});

for (const status of [401, 403, 404, 409, 500, 502, 503, 504]) test(`HTTP ${status} never enters fallback`, async t => {
  let fallbacks = 0;
  install(t, {fetch: async () => response({status})});
  await assert.rejects(create({loadFallback: () => {fallbacks += 1;}}).getPage(1), error => error.status === status);
  assert.equal(fallbacks, 0);
});

test('unsupported page images share one lazy PDF.js document and proxy the requested page', async t => {
  let fallbacks = 0;
  const pages = [], renders = [];
  const native = {numPages: 3, async getPage(number) {pages.push(number); return {
    getViewport({scale}) {return {width: 200 * scale, height: 400 * scale, native: true};},
    render(options) {renders.push(options); return {promise: Promise.resolve(), cancel() {}};}};}};
  install(t, {fetch: async () => response({status: 422})});
  const document = create({loadFallback: async () => {fallbacks += 1; return native;}});
  for (const number of [1, 2, 3]) await paint(document, number);
  assert.equal(fallbacks, 1);
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(renders.every(options => options.viewport.native), true);
});

test('network and interrupted image bodies stay retryable without loading the full PDF', async t => {
  let fallbacks = 0, requests = 0;
  install(t, {fetch: async () => {
    requests += 1;
    if (requests === 1) throw new TypeError('network unavailable');
    if (requests === 2) return response({body: Promise.reject(new TypeError('body interrupted'))});
    return response();
  }, createImageBitmap: bitmapDecoder()});
  const document = create({loadFallback: () => {fallbacks += 1;}});
  await assert.rejects(document.getPage(1), /network unavailable/);
  await assert.rejects(paint(document), /body interrupted/);
  await paint(document);
  assert.equal(requests, 3);
  assert.equal(fallbacks, 0);
});

test('a failed lazy PDF.js connection can be retried without refreshing the reader', async t => {
  let fallbacks = 0;
  install(t, {fetch: async () => response({status: 422})});
  const native = {numPages: 3, getPage: async () => ({getViewport: ({scale}) => ({width: 200 * scale, height: 400 * scale}),
    render: () => ({promise: Promise.resolve(), cancel() {}})})};
  const document = create({loadFallback: async () => {
    fallbacks += 1;
    if (fallbacks === 1) throw new TypeError('temporary PDF connection failure');
    return native;
  }});
  await assert.rejects(document.getPage(1), /temporary PDF connection failure/);
  await paint(document, 2);
  assert.equal(fallbacks, 2);
});

test('decode failure rebuilds a native viewport on the same canvas and remains cancellable', async t => {
  const nativeDone = deferred();
  let rendered, cancelledNative = 0, fallbacks = 0;
  const native = {numPages: 3, async getPage() {return {
    getViewport({scale}) {return {width: 300 * scale, height: 600 * scale, native: true};},
    render(options) {rendered = options; return {promise: nativeDone.promise, cancel() {cancelledNative += 1;}};}};}};
  install(t, {fetch: async () => response(), createImageBitmap: async () => {throw new Error('bad PNG');}});
  const document = create({loadFallback: async () => {fallbacks += 1; return native;}});
  const page = await document.getPage(1), canvasContext = context();
  const render = page.render({canvasContext, viewport: page.getViewport({scale: 2}), transform: [1, 0, 0, 1, 0, 0]});
  await tick();
  assert.equal(rendered.canvasContext, canvasContext);
  assert.deepEqual(rendered.viewport, {width: 400, height: 800, native: true});
  assert.equal(canvasContext.calls.length, 0);
  document.cancelPage(1);
  await assert.rejects(render.promise, isCancelled);
  assert.equal(cancelledNative, 1);
  assert.equal(fallbacks, 1);
  nativeDone.resolve();
});

test('different fallback page geometry is rejected instead of stretching it under OCR', async t => {
  let renders = 0;
  install(t, {fetch: async () => response(), createImageBitmap: async () => {throw new Error('bad PNG');}});
  const document = create({loadFallback: async () => ({numPages: 3, getPage: async () => ({
    getViewport: ({scale}) => ({width: 200 * scale, height: 300 * scale}),
    render() {renders += 1;},
  })})});
  await assert.rejects(paint(document), error => error.name === 'TabletPdfMetadataError');
  assert.equal(renders, 0);
});

test('a mismatching fallback page count fails once without retrying the loader', async t => {
  let fallbacks = 0;
  install(t, {fetch: async () => response({status: 422})});
  const document = create({loadFallback: async () => {fallbacks += 1; return {numPages: 2};}});
  await assert.rejects(document.getPage(1), error => error.name === 'TabletPdfMetadataError');
  await assert.rejects(document.getPage(2), error => error.name === 'TabletPdfMetadataError');
  assert.equal(fallbacks, 1);
});

for (const width of [120, 8193]) test(`valid backing width ${width} outside the image budget uses native rendering without downsampling or HTTP 400`, async t => {
  let fetches = 0, requestedPage;
  install(t, {fetch: async () => {fetches += 1; throw new Error('Image budget must be checked before fetch');}});
  const document = create({getWidth: () => width, loadFallback: async () => ({numPages: 3, getPage: async number => {
    requestedPage = number;
    return {getViewport: ({scale}) => ({width: 200 * scale, height: 400 * scale}), render: () => ({promise: Promise.resolve(), cancel() {}})};
  }})});
  const page = await document.getPage(2);
  assert.equal(page.getViewport({scale: width / 200}).width, width);
  assert.equal(requestedPage, 2);
  assert.equal(fetches, 0);
});

test('a canvas programming failure is reported without an unrelated PDF.js fallback', async t => {
  let fallbacks = 0;
  const closed = [];
  install(t, {fetch: async () => response(), createImageBitmap: bitmapDecoder(closed)});
  const document = create({loadFallback: () => {fallbacks += 1;}}), page = await document.getPage(1);
  const canvasContext = context();
  canvasContext.drawImage = () => {throw new Error('canvas unavailable');};
  await assert.rejects(page.render({canvasContext, viewport: page.getViewport({scale: 2})}).promise, /canvas unavailable/);
  assert.equal(fallbacks, 0);
  assert.equal(closed.length, 1);
});

test('metadata cannot silently downsample the requested backing width', async t => {
  let fallbacks = 0, signal;
  const incoming = response({width: 200});
  install(t, {fetch: async (_url, options) => {signal = options.signal; return incoming;}});
  await assert.rejects(create({loadFallback: () => {fallbacks += 1;}}).getPage(1), error => error.name === 'TabletPdfMetadataError');
  assert.equal(incoming.reads, 0);
  assert.equal(fallbacks, 0);
  assert.equal(signal.aborted, true);
});

test('the session LRU evicts older blobs once their combined size exceeds 32 MiB', async t => {
  let fetches = 0;
  const large = blob(400, 800, 'x'.repeat(12 * 1024 * 1024));
  install(t, {fetch: async () => {fetches += 1; return response({body: large});}, createImageBitmap: bitmapDecoder()});
  const document = create();
  await paint(document, 1);
  await paint(document, 2);
  await paint(document, 1); // Touch page 1 so page 2 becomes least recent.
  await paint(document, 3);
  await paint(document, 1);
  assert.equal(fetches, 3);
  await paint(document, 2);
  assert.equal(fetches, 4);
});

test('the image-element decode path revokes its Blob URL after painting', async t => {
  let image, revoked = 0;
  class Image {
    constructor() {this.width = 400; this.height = 800; image = this;}
    set src(value) {this.value = value; if (value) queueMicrotask(() => this.onload?.());}
  }
  install(t, {fetch: async () => response(), createImageBitmap: undefined, Image});
  t.mock.method(URL, 'createObjectURL', () => 'blob:page-image-test');
  t.mock.method(URL, 'revokeObjectURL', () => {revoked += 1;});
  await paint(create());
  assert.equal(revoked, 1);
  assert.equal(image.value, '');
});
