// Real textbook + actual LAN HTTP + disposable Core snapshot. No real Demo
// writes, OCR, or models. Desktop Chrome CDP input is not Y900 hardware evidence.
// Run: node tests-e2e/tablet-ink.mjs
// Optional READER_TEST_LAN, READER_OPENING_SOURCE, READER_OPENING_BOOK,
// READER_CHROMIUM, READER_PYTHON. Results remain ignored under test-results/.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const source = await readFile('tests-e2e/tablet-opening.mjs', 'utf8');
let python = source.match(/const python = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(python, 'Use the existing no-model/no-OCR snapshot fixture');
const extraFixture = String.raw`
no_ocr_page = 22
with library.database.connect() as c:
    # Only this disposable snapshot is changed. It deliberately has one page
    # without available OCR, while the original PDF and geometry remain real.
    c.execute("UPDATE ocr_pages SET status='NOT_PREPARED' WHERE book_source_revision_id=? AND pdf_page_index=?", (revision['id'], no_ocr_page))
    for table in ('ink_operations', 'ink_strokes'):
        if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            c.execute('DELETE FROM ' + table)
`;
assert.ok(python.includes('server = ReaderServer('));
python = python.replace('server = ReaderServer(', extraFixture + '\nserver = ReaderServer(')
  .replace("'pages':revision['page_count']", "'no_ocr_page':no_ocr_page, 'pages':revision['page_count']");
const privateAddress = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  (values || []).map(value => ({name, ...value}))).filter(value => value.family === 'IPv4' && !value.internal && privateAddress(value.address));
const address = process.env.READER_TEST_LAN || interfaces.find(value => /wlan|wi-?fi/i.test(value.name))?.address || interfaces[0]?.address;
assert.ok(address && privateAddress(address), 'Use an assigned private LAN IPv4');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-ink-'));
const artifacts = path.resolve('test-results/tablet-ink');
await mkdir(artifacts, {recursive:true});
const token = randomBytes(32).toString('hex');
const redact = value => String(value).replaceAll(token, '[credential]');
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd:process.cwd(), windowsHide:true, stdio:['ignore', 'pipe', 'pipe'],
  env:{...process.env, PYTHONPATH:path.join(process.cwd(), 'src'), PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1',
    READER_OPENING_ROOT:temporary, READER_OPENING_LAN:address, READER_OPENING_TOKEN:token},
});
let stdout = '', stderr = '', browser, page, report, fixture;
core.stdout.on('data', value => {stdout += value.toString();});
core.stderr.on('data', value => {stderr += value.toString();});
const errors = [], writes = [], failures = [], screenshots = [], checks = [];
try {
  fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Ink fixture timeout: ' + redact(stderr))), 90000);
    const check = () => {const match = stdout.match(/^OPENING_FIXTURE (.+)$/m); if (match) {clearTimeout(timer); resolve(JSON.parse(match[1]));}};
    core.stdout.on('data', check);
    core.once('error', error => {clearTimeout(timer); reject(error);});
    core.once('exit', code => {clearTimeout(timer); reject(new Error(`Ink fixture exited ${code}: ${redact(stderr)}`));});
    check();
  });
  const origin = `http://${address}:${fixture.port}`;
  browser = await chromium.launch({headless:true, executablePath:process.env.READER_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context = await browser.newContext({viewport:{width:1200, height:800}, screen:{width:1200, height:800},
    deviceScaleFactor:1.5, isMobile:true, hasTouch:true, acceptDownloads:true});
  await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{
    writeText:async value => {window.__inkCopied = value;},
  }}));
  page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const pathname = new URL(request.url()).pathname;
    if (!['GET', 'HEAD'].includes(request.method())) writes.push({method:request.method(), path:pathname});});
  page.on('response', response => {if (response.status() >= 400) failures.push({status:response.status(), path:new URL(response.url()).pathname});});
  const client = await context.newCDPSession(page);
  const inkRoute = `/api/revisions/${fixture.revision}/ink`;
  const inkPosts = () => writes.filter(write => write.path === inkRoute && write.method === 'POST').length;
  const coreStrokes = async index => {
    const response = await context.request.get(`${origin}${inkRoute}?page=${index}`);
    assert.equal(response.status(), 200, 'Authenticated Core ink GET');
    return (await response.json()).strokes;
  };
  const waitCoreCount = async (index, count) => {
    await assert.doesNotReject(async () => {
      const limit = Date.now() + 15000;
      while (Date.now() < limit) {if ((await coreStrokes(index)).length === count) return; await page.waitForTimeout(100);}
      throw new Error(`Core page ${index}: expected ${count} strokes`);
    });
  };
  async function openReader() {
    if (await page.locator('.book-card .book-open').first().isVisible()) await page.locator('.book-card .book-open').first().tap();
    if (await page.locator('.overview-book-heading .primary-action').isVisible()) await page.locator('.overview-book-heading .primary-action').tap();
    await page.locator('#reader').waitFor({state:'visible'});
  }
  async function ready(index, requireOcr = true) {
    await page.waitForFunction(({index, requireOcr}) => {
      const wrapper = document.querySelector(`.page[data-index="${index}"]`), canvas = wrapper?.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect(), view = document.getElementById('viewer')?.getBoundingClientRect();
      return canvas && rect && view && canvas.dataset.readerPreview !== 'true' && !wrapper.classList.contains('loading')
        && rect.bottom > view.top + 20 && rect.top < view.bottom - 30 && (!requireOcr || wrapper.querySelector('.ocr-line'));
    }, {index, requireOcr}, {timeout:60000});
  }
  async function go(index, requireOcr = true) {
    await page.locator('#page-number').fill(String(index + 1)); await page.locator('#page-number').press('Enter');
    await ready(index, requireOcr);
  }
  async function showTools() {
    const reveal = page.locator('#tablet-tools-reveal');
    if (await reveal.getAttribute('aria-expanded') === 'false') await reveal.tap();
  }
  async function enableInk() {
    if (!await page.locator('#reader').evaluate(reader => reader.classList.contains('tablet-ink-enabled'))) {
      await showTools(); await page.locator('#tablet-ink-toggle').tap();
    }
    await page.waitForFunction(() => document.getElementById('reader').classList.contains('tablet-ink-enabled'));
  }
  const pen = async (type, x, y, buttons = 1, pressure = .5) => client.send('Input.dispatchMouseEvent', {
    type, x, y, pointerType:'pen', button:type === 'mouseMoved' ? 'none' : 'left', buttons,
    force:buttons ? pressure : 0, clickCount:type === 'mouseMoved' ? 0 : 1,
  });
  async function drawingArea(index) {
    return page.locator(`.page[data-index="${index}"] canvas`).evaluate(canvas => {
      const rect = canvas.getBoundingClientRect(), view = document.getElementById('viewer').getBoundingClientRect();
      const top = Math.max(rect.top + 55, view.top + 130), bottom = Math.min(rect.bottom - 55, view.bottom - 100);
      if (bottom - top < 50) throw new Error('Navigate to more visible paper before drawing');
      return {x:Math.max(rect.left + rect.width * .38, view.left + 65), y:(top + bottom) / 2};
    });
  }
  async function stroke(index, offset = 0, holdMs = 0) {
    const point = await drawingArea(index); point.y += offset;
    await pen('mousePressed', point.x, point.y);
    for (let step = 1; step <= 15; step++) await pen('mouseMoved', point.x + step * 5, point.y + Math.sin(step / 3) * 18, 1, .2 + step / 30);
    if (holdMs) {
      const before = await page.locator(`.page[data-index="${index}"] canvas`).boundingBox();
      await page.waitForTimeout(holdMs);
      assert.equal(await page.locator('#reader').evaluate(reader => reader.classList.contains('tablet-tools-hidden')), false, 'Idle timeout must not hide tools during a pen contact');
      const after = await page.locator(`.page[data-index="${index}"] canvas`).boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) < .1, `Live contact must not reflow paper ${key}`);
      checks.push('A pen held down beyond the rail idle deadline never hides tools or reflows PDF');
    }
    await pen('mouseReleased', point.x + 75, point.y + Math.sin(5) * 18, 0);
    return point;
  }
  async function picture(name) {
    await page.waitForFunction(() => !document.getElementById('status')?.classList.contains('visible'));
    await page.screenshot({path:path.join(artifacts, name + '.png')}); screenshots.push(name);
  }
  async function measureStroke(index, id) {
    return page.locator(`.page[data-index="${index}"] .tablet-ink-layer path[data-stroke-id="${id}"]`).evaluate(node => {
      const paper = node.closest('.page').querySelector('canvas').getBoundingClientRect(), ink = node.getBoundingClientRect();
      return {d:node.getAttribute('d'), x:(ink.left - paper.left) / paper.width, y:(ink.top - paper.top) / paper.height,
        width:ink.width / paper.width, height:ink.height / paper.height};
    });
  }
  function samePosition(before, after, name) {
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) < .003, `${name}: normalized ${key}`);
  }

  const anonymous = await browser.newContext();
  for (const route of ['/tablet-pen-check.html', inkRoute + '?page=19']) {
    const response = await anonymous.request.get(origin + route); assert.equal(response.status(), 401, 'Anonymous route keeps authentication');
  }
  await anonymous.close();
  await page.goto(`${origin}/?tablet=1&token=${token}`);
  await openReader(); await go(19);
  assert.equal(await page.evaluate(() => isSecureContext), false, 'Actual LAN HTTP fixture');
  const baselinePosts = inkPosts();
  const findSelection = index => page.evaluate(async ({revision, index}) => {
    const data = (await (await fetch(`/api/revisions/${revision}/overlay?page=${index}`)).json()).page;
    const overlay = document.querySelector(`.page[data-index="${index}"] .text-overlay`).getBoundingClientRect();
    const view = document.getElementById('viewer').getBoundingClientRect();
    for (const line of data.lines) {
      const ys = line.quad.map(point => point[1]), y = overlay.top + (Math.min(...ys) + Math.max(...ys)) / 2 * overlay.height;
      if (y < view.top + 100 || y > view.bottom - 140) continue;
      for (let at = 0; at < line.cells.length - 3; at++) {
        const cells = line.cells.slice(at, at + 3);
        const start = overlay.left + (cells[0][0] + cells[0][1]) / 2 * overlay.width;
        const end = overlay.left + (cells[2][0] + cells[2][1]) / 2 * overlay.width;
        if (start > view.left + 50 && end < view.right - 100 && cells.every(cell => cell[3] - cell[2] === 1))
          return {start, end, y, expected:line.text.slice(cells[0][2], cells[2][3])};
      }
    }
  }, {revision:fixture.revision, index});
  const selection = await findSelection(19);
  assert.ok(selection, 'A visible genuine OCR line');
  await pen('mousePressed', selection.start, selection.y);
  for (let step = 1; step <= 5; step++) await pen('mouseMoved', selection.start + (selection.end - selection.start) * step / 5, selection.y);
  await pen('mouseReleased', selection.end, selection.y, 0);
  await page.locator('#copy-selection').click();
  assert.equal(await page.evaluate(() => window.__inkCopied), selection.expected, 'Default pen still selects exact original OCR text');
  assert.equal(inkPosts(), baselinePosts, 'Default reading never POSTs ink');
  assert.equal((await coreStrokes(19)).length, 0);
  checks.push('Default stylus OCR selection creates no ink');

  await enableInk(); await page.locator('#tablet-ink-pen').tap();
  const firstPoint = await stroke(19, 0, 6500); await waitCoreCount(19, 1);
  const first = (await coreStrokes(19))[0];
  await page.locator(`.tablet-ink-layer path[data-stroke-id="${first.id}"]`).waitFor();
  await picture('landscape-written');
  await page.locator('#tablet-ink-undo').tap(); await waitCoreCount(19, 0);
  await page.locator('#tablet-ink-redo').tap(); await waitCoreCount(19, 1);
  await page.locator('#tablet-ink-eraser').tap();
  await pen('mousePressed', firstPoint.x + 35, firstPoint.y + Math.sin(7 / 3) * 18);
  await pen('mouseReleased', firstPoint.x + 35, firstPoint.y + Math.sin(7 / 3) * 18, 0);
  await waitCoreCount(19, 0);
  await page.locator('#tablet-ink-undo').tap(); await waitCoreCount(19, 1);
  await page.locator('#tablet-ink-redo').tap(); await waitCoreCount(19, 0);
  await page.locator('#tablet-ink-undo').tap(); await waitCoreCount(19, 1);
  checks.push('Write, undo, redo, erase, restore reach the real isolated Core');

  await page.locator('#tablet-ink-exit').tap();
  await ready(19);
  const postsAtExit = inkPosts();
  for (const reverse of [false, true]) {
    const selected = await findSelection(19);
    assert.ok(selected, 'OCR selection after finishing handwriting');
    const from = reverse ? selected.end : selected.start, to = reverse ? selected.start : selected.end;
    await pen('mousePressed', from, selected.y);
    for (let step = 1; step <= 5; step++) await pen('mouseMoved', from + (to - from) * step / 5, selected.y);
    await pen('mouseReleased', to, selected.y, 0);
    await page.locator('#copy-selection').click();
    assert.equal(await page.evaluate(() => window.__inkCopied), selected.expected, `Immediate ${reverse ? 'reverse' : 'forward'} pen selection after ink exit`);
  }
  assert.equal(inkPosts(), postsAtExit, 'Immediately selecting after exit never writes another ink operation');
  checks.push('Finishing handwriting immediately restores exact forward and reverse pen text selection without refreshing');
  await page.reload(); await openReader(); await go(19);
  await page.locator(`.tablet-ink-layer path[data-stroke-id="${first.id}"]`).waitFor();
  assert.equal(await page.locator('#reader').evaluate(reader => reader.classList.contains('tablet-ink-enabled')), false);
  assert.deepEqual((await coreStrokes(19))[0], first, 'Stored geometry survives reload unchanged');
  const before = await measureStroke(19, first.id);
  await page.locator('#zoom-value').fill('125%'); await page.locator('#zoom-value').press('Enter'); await ready(19);
  await page.locator(`.tablet-ink-layer path[data-stroke-id="${first.id}"]`).waitFor();
  samePosition(before, await measureStroke(19, first.id), 'Zoom reflow');
  await picture('landscape-zoomed');
  await page.setViewportSize({width:800, height:1200}); await ready(19);
  await page.locator(`.tablet-ink-layer path[data-stroke-id="${first.id}"]`).waitFor();
  samePosition(before, await measureStroke(19, first.id), 'Portrait reflow');
  await picture('portrait-persisted');
  assert.deepEqual((await coreStrokes(19))[0], first, 'Layout does not rewrite stored normalized coordinates');
  checks.push('Reload, zoom, and orientation keep original-page stroke alignment');

  await page.locator('#zoom-value').fill('100%'); await page.locator('#zoom-value').press('Enter'); await ready(19);
  await enableInk(); await picture('portrait-writing'); await page.locator('#tablet-ink-exit').tap();
  await go(220);
  await page.waitForFunction(() => !document.querySelector('.page[data-index="19"] canvas'));
  await go(19);
  await page.locator(`.tablet-ink-layer path[data-stroke-id="${first.id}"]`).waitFor();
  assert.deepEqual((await coreStrokes(19))[0], first, 'Far-page virtualization leaves durable original geometry untouched');
  checks.push('Returning from a far chapter remounts the original ink after PDF page virtualization');

  await enableInk(); await page.locator('#tablet-ink-pen').tap();
  await page.evaluate(() => document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'pen') window.__inkCancelPointer = event.pointerId;
  }, {capture:true, once:true}));
  const cancelledPoint = await drawingArea(19);
  await pen('mousePressed', cancelledPoint.x, cancelledPoint.y + 45);
  await pen('mouseMoved', cancelledPoint.x + 25, cancelledPoint.y + 56);
  await pen('mouseMoved', cancelledPoint.x + 50, cancelledPoint.y + 45);
  // CDP has no pen-cancel command. Real CDP pen samples precede one explicit
  // DOM pointercancel; this checks cancellation handling, not Android palm rejection.
  const cancelled = await page.evaluate(() => {
    const pointerId = window.__inkCancelPointer;
    document.getElementById('viewer').dispatchEvent(new PointerEvent('pointercancel', {
      pointerType:'pen', pointerId, bubbles:true, cancelable:false,
    }));
    return {pointerId, drawing:document.getElementById('reader').classList.contains('tablet-ink-drawing')};
  });
  assert.equal(typeof cancelled.pointerId, 'number', 'Cancel the actual captured CDP pen id');
  assert.equal(cancelled.drawing, false, 'Cancellation finishes input before the later pointerup');
  await waitCoreCount(19, 2);
  await pen('mouseReleased', cancelledPoint.x + 50, cancelledPoint.y + 45, 0);
  await waitCoreCount(19, 2);
  assert.deepEqual((await coreStrokes(19)).find(value => value.id === first.id), first, 'Cancelling current input cannot remove older saved strokes');
  checks.push('Explicit pen pointercancel retains actual samples and older saved strokes');

  await page.locator('#zoom-value').fill('90%'); await page.locator('#zoom-value').press('Enter');
  await go(fixture.no_ocr_page, false);
  assert.equal(await page.locator(`.page[data-index="${fixture.no_ocr_page}"] .ocr-line`).count(), 0);
  await enableInk(); await page.locator('#tablet-ink-pen').tap();
  await stroke(fixture.no_ocr_page); await waitCoreCount(fixture.no_ocr_page, 1);
  await picture('portrait-no-ocr-written');
  checks.push('Original PDF accepts and persists ink with no available OCR');

  await context.setOffline(true);
  await stroke(fixture.no_ocr_page, 65);
  await page.waitForFunction(() => /待|尚未|重试|网络|连接/.test(document.getElementById('tablet-ink-save-status').textContent));
  await picture('offline-pending');
  await context.setOffline(false);
  await waitCoreCount(fixture.no_ocr_page, 2);
  await page.waitForFunction(() => /已保存/.test(document.getElementById('tablet-ink-save-status').textContent));
  await picture('reconnected-saved');
  checks.push('Offline ink stays visible, then uploads after actual browser online transition');

  const touches = (type, points) => client.send('Input.dispatchTouchEvent', {type,
    touchPoints:points.map(point => ({...point, radiusX:4, radiusY:4, force:1}))});
  const touchPoint = await drawingArea(fixture.no_ocr_page);
  const initialScroll = await page.locator('#viewer').evaluate(viewer => viewer.scrollTop);
  await touches('touchStart', [{x:touchPoint.x, y:touchPoint.y + 80, id:1}]);
  for (let step = 1; step <= 8; step++) {
    await touches('touchMove', [{x:touchPoint.x, y:touchPoint.y + 80 - step * 20, id:1}]);
    await page.waitForTimeout(20);
  }
  await touches('touchEnd', []);
  await page.waitForFunction(before => Math.abs(document.getElementById('viewer').scrollTop - before) > 40, initialScroll);
  await go(fixture.no_ocr_page, false);
  const zoomBefore = Number((await page.locator('#zoom-value').inputValue()).replace('%', ''));
  const pinchPoint = await drawingArea(fixture.no_ocr_page);
  await touches('touchStart', [{x:pinchPoint.x - 70, y:pinchPoint.y, id:3}, {x:pinchPoint.x + 70, y:pinchPoint.y, id:4}]);
  await touches('touchMove', [{x:pinchPoint.x - 84, y:pinchPoint.y, id:3}, {x:pinchPoint.x + 84, y:pinchPoint.y, id:4}]);
  await touches('touchEnd', []);
  await page.waitForFunction(before => parseFloat(document.getElementById('zoom-value').value) > before, zoomBefore);
  await ready(fixture.no_ocr_page, false);
  assert.equal((await coreStrokes(fixture.no_ocr_page)).length, 2, 'Finger pan/pinch never writes ink');
  checks.push('While writing is enabled, finger scrolling and pinch zoom retain pen-only ink');

  let blockUploads = true;
  await context.route('**/api/revisions/*/ink', route =>
    blockUploads && route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue());
  await page.locator('#zoom-value').fill('90%'); await page.locator('#zoom-value').press('Enter');
  await go(fixture.no_ocr_page, false); await stroke(fixture.no_ocr_page, 15);
  await page.waitForFunction(() => /待|尚未|重试|网络|连接/.test(document.getElementById('tablet-ink-save-status').textContent));
  assert.equal((await coreStrokes(fixture.no_ocr_page)).length, 2, 'Rejected upload has no Core acknowledgement');
  await page.reload(); await openReader(); await go(fixture.no_ocr_page, false);
  await page.waitForFunction(index => document.querySelectorAll(`.page[data-index="${index}"] .tablet-ink-layer path`).length >= 3, fixture.no_ocr_page);
  await picture('pending-survives-reload');
  blockUploads = false;
  await context.setOffline(true); await context.setOffline(false);
  await waitCoreCount(fixture.no_ocr_page, 3);
  checks.push('IndexedDB keeps an unacknowledged stroke across reload, then uploads it exactly once');

  const probe = await context.newPage();
  await probe.goto(origin + '/tablet-pen-check.html');
  await probe.waitForFunction(() => typeof window.TabletPenCheck?.getReport === 'function');
  const probeReport = await probe.evaluate(() => window.TabletPenCheck.getReport());
  assert.equal(probeReport.capabilities.secureContext, false);
  assert.equal(JSON.stringify(probeReport).includes(token), false);
  assert.equal(JSON.stringify(probeReport).includes(origin), false);
  await probe.close();
  checks.push('Authenticated standalone pen probe works on current HTTP capabilities');
  const desktopContext = await browser.newContext({viewport:{width:1366, height:900}});
  const desktop = await desktopContext.newPage();
  const desktopWrites = [], desktopErrors = [];
  desktop.on('pageerror', error => desktopErrors.push(error.message));
  desktop.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/ink')) desktopWrites.push('ink');});
  await desktop.goto(`${origin}/?token=${token}`);
  await desktop.locator('.book-card .book-open').first().click();
  await desktop.locator('.overview-book-heading .primary-action').click();
  await desktop.locator('.page canvas').first().waitFor({timeout:60000});
  assert.equal(await desktop.locator('html').evaluate(html => html.classList.contains('tablet')), false);
  assert.equal(await desktop.locator('#tablet-ink-toggle').count(), 0);
  assert.equal(await desktop.locator('.tablet-ink-layer').count(), 0);
  assert.deepEqual(desktopWrites, []); assert.deepEqual(desktopErrors, []);
  await desktopContext.close();
  checks.push('Ordinary desktop Reader opens without tablet handwriting UI or ink writes');
  assert.deepEqual(errors, []);
  const unavailableFixtures = failures.filter(failure => failure.status === 503 && /\/(inline-teaching|knowledge-map)$/.test(failure.path));
  assert.deepEqual(failures.filter(failure => !unavailableFixtures.includes(failure)), [], 'No unexpected failed HTTP responses');
  report = {result:'PASS', environment:'Actual private LAN HTTP, disposable real textbook snapshot, desktop Chrome touch/CDP pen; not physical Y900',
    models:0, new_ocr:0, checks, screenshots, ink_posts:inkPosts(), errors,
    unavailable_fixture_reads:unavailableFixtures.length, unexpected_responses:[]};
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({path:path.join(artifacts, 'failure.png')}).catch(() => {});
  const debug = await page?.evaluate(() => ({reader:document.getElementById('reader')?.className,
    active:document.activeElement?.id, page:document.getElementById('page-number')?.value,
    inkStatus:document.getElementById('tablet-ink-save-status')?.textContent,
    paths:document.querySelectorAll('.tablet-ink-layer path').length})).catch(() => null);
  report = {result:'FAIL', error:redact(error.stack || error), checks, screenshots, errors, writes, responses:failures, debug, service:redact(stderr)};
} finally {
  await browser?.close(); core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) return resolve(); core.once('exit', resolve); setTimeout(resolve, 5000);});
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  const root = await realpath(temporary), parent = await realpath(os.tmpdir());
  assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('reader-tablet-ink-'));
  await rm(root, {recursive:true, force:true});
}
console.log(JSON.stringify(report));
