// CDP trusted pen/pointer events in desktop Chrome with a tablet viewport.
// These are not Android-native pen packets or a physical Lenovo pen test.
// OCR and PDF coordinates come from one prepared textbook copied by prepare_demo.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const privateAddress = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const address = process.env.READER_TEST_LAN || Object.values(os.networkInterfaces()).flat()
  .find(item => item && item.family === 'IPv4' && !item.internal && privateAddress(item.address))?.address;
assert.ok(address && privateAddress(address), 'Set READER_TEST_LAN to an assigned RFC1918 IPv4 address');
const workspace = process.cwd(), temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-pen-'));
const token = randomBytes(32).toString('hex');
const python = String.raw`
import os
from pathlib import Path
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.foundation import FoundationRepository, FoundationService, PageLabelRepository, PageLabelService
from reader_service.jobs import JobRepository
from reader_service.library import LibraryService
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import prepare_demo
source = Path(os.environ.get('READER_PEN_SOURCE', str(Path(os.environ['LOCALAPPDATA']) / '408GuidedReaderAndroidTabletDemo')))
destination = Path(os.environ['READER_PEN_TEST_ROOT']) / 'snapshot'
prepare_demo(source, destination, [os.environ.get('READER_PEN_BOOK', 'f7daa312-a6f2-497b-bf2a-5951f4f18fea')])
library = LibraryService(ManagedPaths(destination))
def no_ocr():
    raise AssertionError('This regression must never invoke OCR')
foundation = FoundationService(library, FoundationRepository(library.database), no_ocr)
labels = PageLabelService(library, PageLabelRepository(library.database))
outline = OutlineService(library, OutlineRepository(library.database), labels)
outline.bootstrap = outline.stored_snapshot
annotations = AnnotationService(foundation, AnnotationRepository(library.database))
class CachedPreparation:
    # Only the existing GET endpoints need this shape. No coordinator, worker,
    # model runtime, or page preparation is constructed or started.
    def __init__(self):
        self.foundation = foundation
        self.jobs = JobRepository(library.database)
    def schedule_revision(self, *args, **kwargs):
        # The UI can send a priority hint before the initial status GET wins
        # its race. This cached-only fixture does not enqueue or prepare pages.
        return None
server = ReaderServer((os.environ['READER_PEN_TEST_LAN'], 0), handler_factory(
    library, os.environ['READER_PEN_TEST_TOKEN'], tablet_lan=True,
    preparation=CachedPreparation(), outline=outline, annotations=annotations))
print('READY_PORT %s' % server.server_port, flush=True)
server.serve_forever()
`;
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, PYTHONPATH: path.join(workspace, 'src'), PYTHONIOENCODING: 'utf-8',
    READER_PEN_TEST_ROOT: temporary, READER_PEN_TEST_LAN: address, READER_PEN_TEST_TOKEN: token},
});
let output = '', serviceErrors = '', browser, page;
core.stderr.on('data', chunk => {serviceErrors += chunk.toString();});
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Temporary textbook snapshot Core did not start')), 60000);
  core.stdout.on('data', chunk => {
    output += chunk.toString(); const match = output.match(/READY_PORT (\d+)/);
    if (match) {clearTimeout(timeout); resolve(Number(match[1]));}
  });
  core.once('error', error => {clearTimeout(timeout); reject(error);});
  core.once('exit', code => {clearTimeout(timeout); reject(new Error(`Temporary Core exited (${code}): ${serviceErrors}`));});
});
try {
  const port = await ready;
  browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context = await browser.newContext({viewport: {width: 1200, height: 800},
    screen: {width: 1200, height: 800}, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true});
  await context.addInitScript(() => {
    // Record the actual app copySelection output without requiring a system
    // Clipboard permission on LAN HTTP. This does not supply selection/OCR data.
    window.__copiedSelection = null; window.__penPackets = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
      writeText: async text => {window.__copiedSelection = text;},
    }});
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, event => {
        if (event.pointerType === 'pen') window.__penPackets.push({type, trusted: event.isTrusted,
          pointerId: event.pointerId, buttons: event.buttons});
      }, true);
    }
  });
  page = await context.newPage();
  const pageErrors = [], prohibited = [], rangeChecks = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /\/assistant(\/|$)/.test(new URL(request.url()).pathname))
      prohibited.push(new URL(request.url()).pathname);
  });
  page.on('response', response => {
    if (!/\/api\/revisions\/[^/]+\/pdf$/.test(new URL(response.url()).pathname) || response.status() !== 206) return;
    // Read immediately: old/cancelled range bodies can disappear from CDP when
    // PDF.js leaves a page. Normal cancellation is not a malformed PDF response.
    const body = response.body().then(bytes => ({bytes}), error => ({error}));
    rangeChecks.push((async () => {
      const headers = await response.allHeaders();
      const match = headers['content-range']?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      assert.ok(match, 'Every observed partial response has a valid Content-Range');
      assert.equal(Number(headers['content-length']), Number(match[2]) - Number(match[1]) + 1);
      const result = await body;
      if (result.error) {
        assert.ok(response.request().failure(), 'Only a cancelled request may lack its completed response body');
        return {cancelled: true};
      }
      assert.equal(result.bytes.length, Number(match[2]) - Number(match[1]) + 1);
      return {cancelled: false};
    })());
  });
  const client = await context.newCDPSession(page);
  async function pen(type, point, buttons = type === 'mouseMoved' ? 0 : 1) {
    await client.send('Input.dispatchMouseEvent', {type, x: point.x, y: point.y,
      pointerType: 'pen', button: type === 'mouseMoved' ? 'none' : 'left', buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1, force: buttons & 1 ? .5 : 0});
  }
  async function stroke(start, end = start) {
    await pen('mouseMoved', start);
    await pen('mousePressed', start);
    if (end !== start) {
      for (let step = 1; step <= 5; step++) {
        await pen('mouseMoved', {x: start.x + (end.x - start.x) * step / 5,
          y: start.y + (end.y - start.y) * step / 5}, 1);
        await page.waitForTimeout(20);
      }
    }
    await pen('mouseReleased', end, 0);
    await page.locator('#selection-actions').waitFor({state: 'visible'});
  }
  async function copied() {
    await page.evaluate(() => {window.__copiedSelection = null;});
    await page.locator('#copy-selection').click();
    await page.waitForFunction(() => window.__copiedSelection !== null);
    return page.evaluate(() => window.__copiedSelection);
  }
  const touch = (type, points) => client.send('Input.dispatchTouchEvent', {type,
    touchPoints: points.map(([x, y, id = 1]) => ({x, y, id, radiusX: 2, radiusY: 2, force: 1}))});
  async function go(number) {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${number - 1}"] .text-overlay`).waitFor({timeout: 45000});
    await page.waitForFunction(index => !document.querySelector(`.page[data-index="${index}"]`).classList.contains('loading'), number - 1);
    await page.waitForTimeout(200);
  }
  async function realLine() {
    return page.evaluate(async () => {
      const book = (await (await fetch('/api/books')).json()).books[0];
      const data = (await (await fetch(`/api/revisions/${book.active_revision.id}/overlay?page=19`)).json()).page;
      const overlay = document.querySelector('.page[data-index="19"] .text-overlay').getBoundingClientRect();
      const view = document.getElementById('viewer').getBoundingClientRect();
      const found = data.lines.find(line => {
        const ys = line.quad.map(point => point[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2;
        return line.cells.length > 18 && line.cells.every(cell => cell[3] - cell[2] === 1)
          && overlay.top + y * overlay.height > view.top + 90
          && overlay.top + y * overlay.height < view.bottom - 120;
      });
      if (!found) return null;
      const ys = found.quad.map(point => point[1]), y = (Math.min(...ys) + Math.max(...ys)) / 2;
      return {line: found, overlay: {left: overlay.left, top: overlay.top, width: overlay.width, height: overlay.height},
        y: overlay.top + y * overlay.height};
    });
  }
  await page.goto(`http://${address}:${port}/?tablet=1&token=${token}`);
  await page.locator('.book-card .book-open').click();
  await page.locator('.overview-book-heading .primary-action').click();
  await go(20);
  assert.equal(await page.evaluate(() => isSecureContext), false);
  assert.equal(await page.locator('.page').count(), 348);
  const sample = await realLine();
  assert.ok(sample, 'Choose an existing prepared, visible textbook line with individual cells');
  const point = (index, fraction = .5) => ({x: sample.overlay.left + sample.overlay.width *
    (sample.line.cells[index][0] + (sample.line.cells[index][1] - sample.line.cells[index][0]) * fraction), y: sample.y});
  const expected = (first, last) => sample.line.text.slice(sample.line.cells[first][2], sample.line.cells[last][3]);
  await stroke(point(5, .2));
  assert.equal(await copied(), expected(5, 5), 'Left half of the cell selects that exact character');
  await stroke(point(5, .8));
  const beforeHover = await page.locator('.selection-quad').evaluateAll(nodes => nodes.map(node => node.getAttribute('style')));
  await pen('mouseMoved', point(13), 0);
  assert.deepEqual(await page.locator('.selection-quad').evaluateAll(nodes => nodes.map(node => node.getAttribute('style'))), beforeHover);
  assert.equal(await copied(), expected(5, 5), 'Right half selects the same character and hover does not extend it');
  await stroke(point(4), point(9, .95));
  assert.equal(await copied(), expected(4, 9), 'Forward drag includes the original touched cell');
  await stroke(point(10), point(6, .05));
  assert.equal(await copied(), expected(6, 10), 'Reverse drag includes the original touched cell');

  // Losing real browser pointer capture is a cancellation. It must not apply a
  // final point or open the successful-selection menu on the later physical up.
  await pen('mousePressed', point(5));
  await pen('mouseMoved', point(5), 1);
  await page.evaluate(() => {
    const packet = window.__penPackets.findLast(item => item.type === 'pointerdown');
    document.getElementById('viewer').releasePointerCapture(packet.pointerId);
  });
  await pen('mouseMoved', point(9), 1);
  await pen('mouseReleased', point(9), 0);
  assert.equal(await page.locator('#selection-actions').isVisible(), false, 'Capture cancellation cannot open the completed-selection menu');
  assert.equal(await page.locator('.selection-quad').count(), 0, 'Capture cancellation clears the transient range');

  await stroke(point(5));
  const beforeScroll = await page.locator('#viewer').evaluate(node => node.scrollTop);
  await touch('touchStart', [[650, 610]]);
  for (let y = 590; y >= 330; y -= 26) {await touch('touchMove', [[650, y]]); await page.waitForTimeout(18);}
  await touch('touchEnd', []);
  await page.waitForTimeout(350);
  assert.ok(await page.locator('#viewer').evaluate(node => node.scrollTop) > beforeScroll + 100,
    'The first finger gesture after a pen can still scroll natively');
  await go(20);
  const fingerLine = await realLine();
  const fingerX = fingerLine.overlay.left + fingerLine.line.cells[6][0] * fingerLine.overlay.width;
  await touch('touchStart', [[fingerX, fingerLine.y]]); await page.waitForTimeout(520);
  await touch('touchEnd', []);
  await page.locator('#selection-actions').waitFor({state: 'visible'});
  assert.ok((await copied()).trim(), 'Finger long hold still selects genuine textbook text');

  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target:not([disabled])').nth(1).click();
  assert.equal(await page.locator('#outline-panel').isVisible(), false);
  await go(348);
  assert.ok(await page.locator('.page[data-index="347"] canvas').evaluate(node => node.width > 0 && node.height > 0));
  const checkedRanges = await Promise.all(rangeChecks);
  assert.ok(checkedRanges.filter(range => !range.cancelled).length > 0, 'Tablet reading completes partial PDF requests');
  const packets = await page.evaluate(() => window.__penPackets);
  assert.ok(packets.some(packet => packet.type === 'pointerdown' && packet.trusted));
  assert.ok(packets.filter(packet => ['pointerdown', 'pointermove', 'pointerup'].includes(packet.type)).every(packet => packet.trusted));
  assert.deepEqual(prohibited, [], 'No model request is sent; cached-only Core cannot start OCR');
  assert.deepEqual(pageErrors, []);
  assert.equal(serviceErrors.includes('Traceback'), false, 'Cached-only Core has no unhandled failure');
  console.log(JSON.stringify({result: 'PASS', checks: ['isolated real 348-page textbook snapshot',
    'existing OCR cells', 'CDP trusted pen left/right cell tap', 'forward/reverse exact copied text',
    'pen up action menu', 'hover ignored', 'capture cancellation', 'first finger after pen scrolls',
    'finger long hold', 'touch directory jump', 'far page 348 rendering', 'partial PDF response byte lengths'],
    rangeResponses: checkedRanges.filter(range => !range.cancelled).length, modelCalls: 0, newOcrCalls: 0,
    limitation: 'Desktop Chrome CDP pen events; physical Android Lenovo pen remains for manual acceptance'}));
} catch (error) {
  if (page) {await mkdir('test-results', {recursive: true}); await page.screenshot({path: 'test-results/tablet-pen-failure.png'}).catch(() => {});}
  throw new Error(String(error.stack || error).replaceAll(token, '[redacted]'));
} finally {
  await browser?.close(); core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) resolve(); else core.once('exit', resolve);});
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  await rm(temporary, {recursive: true, force: true});
}
