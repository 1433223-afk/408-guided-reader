// Focused tablet layout regression in desktop Chrome. The real PDF, OCR and
// directory are copied into a disposable snapshot; Android still needs review.
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
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-directory-'));
const artifacts = path.resolve('test-results/tablet-directory'), token = randomBytes(32).toString('hex');
const python = String.raw`
import os
from pathlib import Path
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.foundation import FoundationRepository, FoundationService, PageLabelRepository, PageLabelService
from reader_service.jobs import JobRepository
from reader_service.library import LibraryService
from reader_service.learning.repository import LearningRepository
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import prepare_demo
source = Path(os.environ.get('READER_PEN_SOURCE', str(Path(os.environ['LOCALAPPDATA']) / '408GuidedReaderAndroidTabletDemo')))
destination = Path(os.environ['READER_DIRECTORY_TEST_ROOT']) / 'snapshot'
prepare_demo(source, destination, [os.environ.get('READER_PEN_BOOK', 'f7daa312-a6f2-497b-bf2a-5951f4f18fea')])
library = LibraryService(ManagedPaths(destination))
def no_ocr():
    raise AssertionError('Layout regression must not invoke OCR')
foundation = FoundationService(library, FoundationRepository(library.database), no_ocr)
labels = PageLabelService(library, PageLabelRepository(library.database))
outline = OutlineService(library, OutlineRepository(library.database), labels)
outline.bootstrap = outline.stored_snapshot
annotations = AnnotationService(foundation, AnnotationRepository(library.database))
class CachedPreparation:
    def __init__(self):
        self.foundation = foundation
        self.jobs = JobRepository(library.database)
    def schedule_revision(self, *args, **kwargs):
        # Ignore viewport priority hints; no coordinator or worker exists.
        return None
class CachedLearning:
    # Read the copied published learning entries; no model runtime is present.
    repository = LearningRepository(library.database)
    runtime = None
    def status(self):
        return {'answer_provider': 'deepseek', 'review_provider': 'zhipu', 'providers': []}
    def snapshot(self, revision_id, scope_id):
        return self.repository.snapshot(revision_id, scope_id)
server = ReaderServer((os.environ['READER_DIRECTORY_TEST_LAN'], 0), handler_factory(
    library, os.environ['READER_DIRECTORY_TEST_TOKEN'], tablet_lan=True,
    preparation=CachedPreparation(), outline=outline, annotations=annotations, learning=CachedLearning()))
print('READY_PORT %s' % server.server_port, flush=True)
server.serve_forever()
`;
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, PYTHONPATH: path.join(process.cwd(), 'src'), PYTHONIOENCODING: 'utf-8',
    READER_DIRECTORY_TEST_ROOT: temporary, READER_DIRECTORY_TEST_LAN: address, READER_DIRECTORY_TEST_TOKEN: token},
});
let output = '', serviceErrors = '', browser, page;
core.stderr.on('data', chunk => {serviceErrors += chunk.toString();});
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Temporary directory snapshot Core did not start')), 60000);
  core.stdout.on('data', chunk => {
    output += chunk.toString(); const match = output.match(/READY_PORT (\d+)/);
    if (match) {clearTimeout(timeout); resolve(Number(match[1]));}
  });
  core.once('error', error => {clearTimeout(timeout); reject(error);});
  core.once('exit', code => {clearTimeout(timeout); reject(new Error(`Temporary Core exited (${code}): ${serviceErrors}`));});
});
try {
  const port = await ready;
  await mkdir(artifacts, {recursive: true});
  browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context = await browser.newContext({viewport: {width: 1200, height: 800},
    screen: {width: 1200, height: 800}, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true});
  page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [], modelRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/assistant\//.test(request.url())) modelRequests.push(new URL(request.url()).pathname);
  });
  // Browser-only availability metadata permits an ordinary selected-text draft.
  // Credentials stay absent, Send stays disabled, and Core has no AI runtime.
  await page.route('**/api/assistant/status', async route => {
    const response = await route.fetch(), status = await response.json();
    status.active_provider = 'deepseek';
    status.providers = [{provider: 'deepseek', model: 'offline-layout-fixture', configuration_valid: true,
      endpoint_valid: true, model_valid: true, configured: false, credential_available: false, ai_off_reason: 'MISSING_CREDENTIAL'}];
    await route.fulfill({json: status});
  });
  const settle = () => page.waitForTimeout(650);
  const shot = name => page.screenshot({path: path.join(artifacts, `${name}.png`)});
  const anchor = () => page.evaluate(() => {
    const viewer = document.getElementById('viewer'), y = viewer.getBoundingClientRect().top + 1;
    const pages = [...document.querySelectorAll('#pages > .page')];
    const page = pages.find(page => {const r = page.getBoundingClientRect(); return r.top <= y && r.bottom >= y;});
    const r = page?.getBoundingClientRect();
    return {page: page?.dataset.index, offset: r ? (y - r.top) / r.height : null,
      zoom: document.getElementById('zoom-value').value};
  });
  async function stable(before, action) {
    await action(); await settle();
    const after = await anchor();
    assert.equal(after.page, before.page, 'Layout preserves the top reading page');
    assert.equal(after.zoom, before.zoom, 'Layout preserves the user zoom');
    assert.ok(Math.abs(after.offset - before.offset) < .012, `Top anchor moved: ${JSON.stringify({before, after})}`);
  }
  async function layout(panelId = 'outline-panel') {
    const boxes = await page.evaluate(id => {
      const box = id => document.getElementById(id).getBoundingClientRect().toJSON();
      return {viewer: box('viewer'), panel: box(id), toolbar: document.querySelector('.toolbar').getBoundingClientRect().toJSON(),
        portrait: document.documentElement.classList.contains('tablet-portrait'), width: innerWidth, height: innerHeight,
        horizontalOverflow: document.getElementById('reader').scrollWidth > innerWidth + 1};
    }, panelId);
    const {viewer, panel, toolbar} = boxes;
    const overlap = Math.max(0, Math.min(viewer.right, panel.right) - Math.max(viewer.left, panel.left)) *
      Math.max(0, Math.min(viewer.bottom, panel.bottom) - Math.max(viewer.top, panel.top));
    assert.ok(overlap < 2, `${panelId} must have its own space beside/below PDF`);
    assert.ok(panel.left >= -1 && panel.right <= boxes.width + 1 && panel.bottom <= boxes.height + 1);
    assert.equal(boxes.horizontalOverflow, false, 'Reader stays within the usable CSS viewport');
    if (boxes.portrait) {
      assert.ok(panel.top >= viewer.bottom - 1);
      assert.ok(viewer.height >= (boxes.height - toolbar.height) / 2 - 2, 'Bottom workspaces leave at least half the reading height');
    } else if (panelId === 'outline-panel') assert.ok(panel.right <= viewer.left + 1);
    else assert.ok(viewer.right <= panel.left + 1);
    return boxes;
  }
  async function treeText() {
    const metrics = await page.evaluate(() => {
      const nav = document.getElementById('outline-tree');
      const context = document.createElement('canvas').getContext('2d');
      const titles = [...nav.querySelectorAll('.outline-target span')].filter(node => node.offsetParent).map(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect(); context.font = style.font;
        return {whiteSpace: style.whiteSpace, width: box.width, height: box.height,
          singleLineWidth: context.measureText(node.textContent).width, lineHeight: parseFloat(style.lineHeight),
          client: node.clientWidth, scroll: node.scrollWidth};
      });
      const controls = [...nav.querySelectorAll('.outline-target,.outline-fold')].filter(node => node.offsetParent)
        .map(node => ({height: node.getBoundingClientRect().height, fold: node.classList.contains('outline-fold'), width: node.getBoundingClientRect().width}));
      return {titles, controls, overflow: nav.scrollWidth > nav.clientWidth + 1};
    });
    assert.equal(metrics.overflow, false, 'Directory has no horizontal scrollbar');
    assert.ok(metrics.controls.every(control => control.height >= 47 && (!control.fold || control.width >= 47)), 'Tree controls keep 48 CSS pixel touch targets');
    assert.ok(metrics.titles.every(title => title.whiteSpace !== 'nowrap' && title.scroll <= title.client + 1), 'Actual title spans can wrap without clipping');
    for (const title of metrics.titles.filter(title => title.singleLineWidth > title.width + 2))
      assert.ok(title.height >= title.lineHeight * 1.6, 'A long real textbook title occupies multiple lines');
  }
  async function openDirectory() {
    await page.locator('#outline-toggle').tap();
    await page.locator('#outline-panel').waitFor({state: 'visible'}); await settle();
    assert.equal(await page.locator('#reader').evaluate(node => node.classList.contains('tablet-directory-open')), true);
    assert.equal(await page.locator('#tablet-directory-scrim').isVisible(), false);
  }
  const closeDirectory = () => page.locator('#outline-close').tap();
  async function go(number) {
    await page.locator('#page-number').fill(String(number)); await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${number - 1}"] .text-overlay`).waitFor({timeout: 45000}); await settle();
  }
  await page.goto(`http://${address}:${port}/?tablet=1&token=${token}`);
  await page.locator('.book-card .book-open').tap(); await page.locator('.overview-book-heading .primary-action').tap();
  await go(20);
  await page.locator('#reader-more-toggle').tap(); await page.locator('#zoom-value').fill('125');
  await page.locator('#zoom-value').press('Enter'); await page.locator('#reader-more-toggle').tap();
  await settle();
  await page.evaluate(() => {const p = document.querySelector('.page[data-index="19"]'); document.getElementById('viewer').scrollTop = p.offsetTop + p.offsetHeight * .35;});
  await settle(); await shot('1200x800-reading');
  await stable(await anchor(), openDirectory); await layout(); await treeText();
  const beforeNavScroll = await page.evaluate(() => ({pdf: document.getElementById('viewer').scrollTop,
    directory: document.getElementById('outline-tree').scrollTop}));
  const treeBox = await page.locator('#outline-tree').boundingBox();
  const scrollX = treeBox.x + treeBox.width * .7, scrollStart = treeBox.y + treeBox.height - 60;
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', {type,
    touchPoints: y === null ? [] : [{id: 1, x: scrollX, y, radiusX: 2, radiusY: 2, force: 1}]});
  await touch('touchStart', scrollStart);
  for (let step = 1; step <= 10; step++) {await touch('touchMove', scrollStart - step * 24); await page.waitForTimeout(18);}
  await touch('touchEnd', null); await page.waitForTimeout(350);
  const afterNavScroll = await page.evaluate(() => ({pdf: document.getElementById('viewer').scrollTop,
    directory: document.getElementById('outline-tree').scrollTop}));
  assert.ok(afterNavScroll.directory > beforeNavScroll.directory + 30, 'A finger scrolls the directory itself');
  assert.ok(Math.abs(afterNavScroll.pdf - beforeNavScroll.pdf) < 1, 'Directory touch scroll does not move the PDF');
  const fold = page.locator('#outline-tree .outline-fold[aria-expanded="false"]:visible').first();
  if (await fold.count()) await stable(await anchor(), () => fold.tap());
  await shot('1200x800-directory');
  await stable(await anchor(), closeDirectory);

  // Stage a draft via the genuine OCR pen selection, without sending a model request.
  const selected = await page.evaluate(async () => {
    const book = (await (await fetch('/api/books')).json()).books[0];
    const data = (await (await fetch(`/api/revisions/${book.active_revision.id}/overlay?page=19`)).json()).page;
    const r = document.querySelector('.page[data-index="19"]').getBoundingClientRect(), v = document.getElementById('viewer').getBoundingClientRect();
    const line = data.lines.find(line => {const y = line.quad.reduce((s, p) => s + p[1], 0) / 4;
      return line.cells.length > 8 && r.top + y * r.height > v.top + 50 && r.top + y * r.height < v.bottom - 100;});
    if (!line) return null;
    return {x: r.left + (line.cells[4][0] + line.cells[4][1]) / 2 * r.width,
      y: r.top + line.quad.reduce((s, p) => s + p[1], 0) / 4 * r.height};
  });
  assert.ok(selected);
  for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]])
    await cdp.send('Input.dispatchMouseEvent', {type, ...selected, pointerType: 'pen', button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: 1, force: buttons ? .5 : 0});
  await page.locator('#ask-selection').tap(); await page.locator('#assistant-panel').waitFor({state: 'visible'}); await settle();
  assert.equal(await page.locator('#assistant-start').isDisabled(), true);
  const draft = await page.locator('#assistant-draft-text').textContent(); assert.ok(draft.trim());
  await layout('assistant-panel'); await shot('1200x800-assistant-draft');
  await openDirectory(); assert.equal(await page.locator('#assistant-panel').isVisible(), false); await layout();
  await stable(await anchor(), () => page.setViewportSize({width: 800, height: 1200}));
  await layout(); await treeText(); await shot('800x1200-directory');
  await stable(await anchor(), closeDirectory);
  assert.equal(await page.locator('#assistant-panel').isVisible(), true);
  assert.equal(await page.locator('#assistant-draft-text').textContent(), draft);
  await layout('assistant-panel'); await shot('800x1200-assistant-draft');
  await page.locator('#assistant-close').tap(); await settle(); await shot('800x1200-reading');

  for (const [width, height] of [[900,600], [800,520], [600,900]]) {
    await stable(await anchor(), () => page.setViewportSize({width,height}));
    await stable(await anchor(), openDirectory); await layout(); await treeText();
    await shot(`${width}x${height}-directory`); await stable(await anchor(), closeDirectory);
  }
  await openDirectory();
  const target = page.locator('#outline-tree .outline-target:not([disabled])').nth(1);
  const targetId = await target.evaluate(node => node.closest('li').dataset.nodeId);
  const expectedPage = await page.evaluate(async id => {
    const book = (await (await fetch('/api/books')).json()).books[0];
    const data = await (await fetch(`/api/revisions/${book.active_revision.id}/outline?stored=1`)).json();
    return data.nodes.find(node => node.outline_node_id === id).start_page + 1;
  }, targetId);
  await target.tap(); await page.locator('#outline-panel').waitFor({state: 'hidden'}); await settle();
  assert.equal(Number(await page.locator('#page-number').inputValue()), expectedPage);
  await stable(await anchor(), () => page.waitForTimeout(500));
  // Minimal Desktop isolation check on this same disposable Core. Its ordinary
  // directory and manually selected portrait mode retain their existing entry.
  const desktop = await context.newPage();
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(`http://${address}:${port}/?token=${token}`);
  await desktop.locator('.book-card .book-open').click(); await desktop.locator('.overview-book-heading .primary-action').click();
  await desktop.locator('.page canvas').first().waitFor({timeout: 45000});
  assert.equal(await desktop.locator('html').evaluate(node => node.classList.contains('tablet')), false);
  await desktop.locator('#outline-toggle').click(); await desktop.locator('#outline-panel').waitFor({state: 'visible'});
  assert.equal(await desktop.locator('#reader').evaluate(node => node.classList.contains('tablet-directory-open')), false);
  await desktop.locator('#outline-close').click(); await desktop.locator('#outline-panel').waitFor({state: 'hidden'});
  if (await desktop.locator('#reader-more-toggle').isVisible()) await desktop.locator('#reader-more-toggle').click();
  await desktop.locator('#reading-display-toggle').click();
  await desktop.locator('#reading-portrait').check();
  assert.equal(await desktop.locator('#reader').evaluate(node => node.classList.contains('portrait-mode')), true);
  await desktop.locator('#reading-portrait').uncheck(); await desktop.keyboard.press('Escape');
  await desktop.close();
  // Final review images use 100% in the active PDF column, while the assertions
  // above retain the full 125% open/close/rotation regression. Real notifications
  // are allowed to expire through announce(); the test never hides an error.
  for (const [width, height, name] of [[1200,800,'landscape-directory'], [800,1200,'portrait-directory']]) {
    if (await page.locator('#outline-panel').isVisible()) {await closeDirectory(); await settle();}
    await page.setViewportSize({width,height}); await settle(); await go(20); await openDirectory();
    await page.locator('#reader-more-toggle').tap(); await page.locator('#zoom-value').fill('100');
    await page.locator('#zoom-value').press('Enter'); await page.locator('#reader-more-toggle').tap(); await settle();
    await layout(); await treeText();
    await page.waitForFunction(() => !document.getElementById('status').classList.contains('visible'), {}, {timeout: 12000});
    await shot(name);
  }
  assert.deepEqual(errors, []); assert.deepEqual(modelRequests, []);
  assert.equal(serviceErrors.includes('Traceback'), false);
  console.log(JSON.stringify({result: 'PASS', checks: ['real textbook snapshot', 'landscape left column',
    'portrait bottom navigation', 'PDF never covered', '48px targets', 'long titles wrap', 'fold preserves PDF',
    'open/close/rotation anchor and zoom', 'directory jump stable', 'AI draft restored', 'narrow/short viewports',
    'directory touch scroll does not move PDF', '100 percent clean review screenshots',
    'Desktop opt-in isolation and original portrait menu'],
    viewports: ['1200x800','800x1200','900x600','800x520','600x900'], modelCalls: 0, newOcrCalls: 0, screenshots: artifacts}));
} catch (error) {
  await page?.screenshot({path: path.join(artifacts, 'failure.png')}).catch(() => {});
  throw new Error(String(error.stack || error).replaceAll(token, '[redacted]'));
} finally {
  await browser?.close(); core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) resolve(); else core.once('exit', resolve);});
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  await rm(temporary, {recursive: true, force: true});
}
