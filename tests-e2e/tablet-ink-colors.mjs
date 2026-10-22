// Eight-color ink smoke only: real textbook, actual LAN HTTP, disposable Core.
// No OCR/model worker, no writes to the running Demo, no complete ink suite.
// Run: node tests-e2e/tablet-ink-colors.mjs
// Optional READER_TEST_LAN, READER_OPENING_SOURCE, READER_OPENING_BOOK,
// READER_CHROMIUM, READER_PYTHON. Artifacts are ignored under test-results/.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';
import {INK_PALETTE} from '../src/reader_service/static/tablet-ink-store.js';

assert.equal(INK_PALETTE.length, 8);
assert.equal(new Set(INK_PALETTE.map(item => item.color)).size, 8);
const opening = await readFile('tests-e2e/tablet-opening.mjs', 'utf8');
let python = opening.match(/const python = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(python?.includes('server = ReaderServer('), 'Reuse the no-model/no-OCR real textbook snapshot');
python = python.replace('server = ReaderServer(', String.raw`
with library.database.connect() as connection:
    for table in ('ink_operations', 'ink_strokes'):
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            connection.execute('DELETE FROM ' + table)
server = ReaderServer(`);
const isPrivate = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  (values || []).map(value => ({name, ...value}))).filter(value => value.family === 'IPv4' && !value.internal && isPrivate(value.address));
const address = process.env.READER_TEST_LAN || interfaces.find(value => /wlan|wi-?fi/i.test(value.name))?.address || interfaces[0]?.address;
assert.ok(address && isPrivate(address), 'An assigned private LAN IPv4 is required');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-ink-colors-'));
const artifacts = path.resolve('test-results/tablet-ink-colors');
await mkdir(artifacts, {recursive:true});
const token = randomBytes(32).toString('hex');
const redact = value => String(value).replaceAll(token, '[credential]');
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd:process.cwd(), windowsHide:true, stdio:['ignore', 'pipe', 'pipe'],
  env:{...process.env, PYTHONPATH:path.join(process.cwd(), 'src'), PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1',
    READER_OPENING_ROOT:temporary, READER_OPENING_LAN:address, READER_OPENING_TOKEN:token},
});
let stdout = '', stderr = '', browser, page, report;
core.stdout.on('data', value => {stdout += value.toString();});
core.stderr.on('data', value => {stderr += value.toString();});
const errors = [], responses = [], layouts = [], storedColors = [];
let inkPosts = 0;
try {
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Color fixture timeout: ' + redact(stderr))), 90000);
    const check = () => {const match = stdout.match(/^OPENING_FIXTURE (.+)$/m); if (match) {clearTimeout(timer); resolve(JSON.parse(match[1]));}};
    core.stdout.on('data', check);
    core.once('error', error => {clearTimeout(timer); reject(error);});
    core.once('exit', code => {clearTimeout(timer); reject(new Error(`Color fixture exited ${code}: ${redact(stderr)}`));});
    check();
  });
  const origin = `http://${address}:${fixture.port}`, index = 19;
  const inkRoute = `/api/revisions/${fixture.revision}/ink`;
  browser = await chromium.launch({headless:true, executablePath:process.env.READER_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context = await browser.newContext({viewport:{width:1200, height:800}, screen:{width:1200, height:800},
    deviceScaleFactor:1.5, isMobile:true, hasTouch:true});
  page = await context.newPage(); page.setDefaultTimeout(25000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (request.method() === 'POST' && new URL(request.url()).pathname === inkRoute) inkPosts++;});
  page.on('response', response => {if (response.status() >= 400) responses.push({status:response.status(), path:new URL(response.url()).pathname});});
  const client = await context.newCDPSession(page);
  const palette = page.locator('#tablet-ink-choices[data-kind="color"]');
  const coreStrokes = async () => {
    const response = await context.request.get(`${origin}${inkRoute}?page=${index}`);
    assert.equal(response.status(), 200, 'Authenticated Core ink GET');
    return (await response.json()).strokes;
  };
  const waitStored = async count => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const strokes = await coreStrokes();
      if (strokes.length === count) return strokes;
      await page.waitForTimeout(100);
    }
    throw new Error(`Expected ${count} colors in isolated Core`);
  };
  async function openReader() {
    if (await page.locator('.book-card .book-open').first().isVisible()) await page.locator('.book-card .book-open').first().tap();
    if (await page.locator('.overview-book-heading .primary-action').isVisible()) await page.locator('.overview-book-heading .primary-action').tap();
    await page.locator('#reader').waitFor({state:'visible'});
    await page.locator('#page-number').fill(String(index + 1)); await page.locator('#page-number').press('Enter');
    await page.waitForFunction(index => {
      const wrapper = document.querySelector(`.page[data-index="${index}"]`), canvas = wrapper?.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect(), view = document.getElementById('viewer')?.getBoundingClientRect();
      return canvas && rect && view && canvas.dataset.readerPreview !== 'true' && !wrapper.classList.contains('loading')
        && rect.bottom > view.top + 20 && rect.top < view.bottom - 50;
    }, index, {timeout:60000});
  }
  async function enableInk() {
    if (await page.locator('#reader').evaluate(reader => reader.classList.contains('tablet-ink-enabled'))) return;
    if (await page.locator('#tablet-tools-reveal').getAttribute('aria-expanded') === 'false') await page.locator('#tablet-tools-reveal').tap();
    await page.locator('#tablet-ink-toggle').tap();
    await page.waitForFunction(() => document.getElementById('reader').classList.contains('tablet-ink-enabled'));
  }
  async function showPalette() {
    if (!await palette.isVisible()) await page.locator('#tablet-ink-color').tap();
    await palette.waitFor({state:'visible'});
    assert.equal(await palette.locator('button').count(), 8);
    assert.deepEqual(await palette.locator('button').evaluateAll(buttons => buttons.map(button => button.dataset.value)), INK_PALETTE.map(item => item.color));
    assert.equal(await page.locator('#tablet-ink-color').textContent(), '颜色');
  }
  async function checkLayout(name) {
    await showPalette();
    const metric = await palette.evaluate(node => {
      const rect = value => {const box = value.getBoundingClientRect(); return {left:box.left, right:box.right, top:box.top, bottom:box.bottom, width:box.width, height:box.height};};
      return {viewport:{width:innerWidth, height:innerHeight}, panel:rect(node), buttons:[...node.querySelectorAll('button')].map(button => ({color:button.dataset.value, ...rect(button)}))};
    });
    assert.ok(metric.panel.left >= 0 && metric.panel.top >= 0 && metric.panel.right <= metric.viewport.width && metric.panel.bottom <= metric.viewport.height, name + ' palette remains inside viewport');
    for (const button of metric.buttons) assert.ok(button.width >= 48 && button.height >= 48, name + ' every color has a touch area >=48 CSS px');
    assert.equal(await palette.locator('button[aria-pressed="true"]').count(), 1);
    await page.screenshot({path:path.join(artifacts, name + '-palette.png')});
    layouts.push({name, ...metric});
  }
  async function closeOnBlank() {
    await page.locator('#viewer').tap({position:{x:3, y:80}});
    await palette.waitFor({state:'hidden'});
    assert.equal(await page.locator('#tablet-ink-color').getAttribute('aria-expanded'), 'false');
  }
  const pen = (type, x, y, buttons) => client.send('Input.dispatchMouseEvent', {type, x, y, pointerType:'pen',
    button:type === 'mouseMoved' ? 'none' : 'left', buttons, force:buttons ? .5 : 0, clickCount:type === 'mouseMoved' ? 0 : 1});
  await page.goto(`${origin}/?tablet=1&token=${token}`);
  await openReader(); await enableInk();
  await checkLayout('landscape1200'); await closeOnBlank();
  const drawing = await page.locator(`.page[data-index="${index}"] canvas`).evaluate(canvas => {
    const paper = canvas.getBoundingClientRect(), view = document.getElementById('viewer').getBoundingClientRect();
    const top = Math.max(paper.top + 60, view.top + 140), bottom = Math.min(paper.bottom - 60, view.bottom - 60);
    if (bottom - top < 240) throw new Error('The real PDF needs at least 240 CSS px of visible drawing space');
    return {x:Math.max(paper.left + paper.width * .4, view.left + 70), y:top + 15};
  });
  let previous = [];
  for (const [row, item] of INK_PALETTE.entries()) {
    const beforePosts = inkPosts;
    await showPalette(); await palette.locator(`button[data-value="${item.color}"]`).tap();
    await palette.waitFor({state:'hidden'});
    assert.equal(inkPosts, beforePosts, 'Choosing a color alone cannot write ink');
    assert.deepEqual(await coreStrokes(), previous, 'Choosing a color cannot recolor older saved strokes');
    await showPalette();
    assert.equal(await palette.locator(`button[data-value="${item.color}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await palette.locator('button[aria-pressed="true"]').count(), 1);
    const indicator = await page.locator('#tablet-ink-color').evaluate(button => getComputedStyle(button, '::before').backgroundColor);
    const channels = item.color.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
    assert.equal(indicator, `rgb(${channels.join(', ')})`, 'Solid circle reflects current color');
    await closeOnBlank();
    const y = drawing.y + row * 28;
    await pen('mousePressed', drawing.x, y, 1);
    for (let step = 1; step <= 16; step++) await pen('mouseMoved', drawing.x + step * 6, y + Math.sin(step / 3) * 6, 1);
    await pen('mouseReleased', drawing.x + 96, y + Math.sin(16 / 3) * 6, 0);
    const stored = await waitStored(row + 1);
    assert.deepEqual(stored.slice(0, previous.length), previous, 'New colored ink leaves old normalized geometry untouched');
    assert.equal(stored.at(-1).color, item.color, item.name + ' survives Core validation and SQLite storage');
    previous = stored; storedColors.push(item.color);
  }
  await page.screenshot({path:path.join(artifacts, 'landscape-eight-colors.png')});
  await page.reload(); await openReader();
  await page.waitForFunction(index => document.querySelectorAll(`.page[data-index="${index}"] .tablet-ink-layer path`).length === 8, index);
  assert.deepEqual(await coreStrokes(), previous, 'Every stroke and exact color survives reload');
  const rendered = await page.locator(`.page[data-index="${index}"] .tablet-ink-layer path`).evaluateAll(paths =>
    Object.fromEntries(paths.map(path => [path.dataset.strokeId, path.getAttribute('stroke')])));
  assert.equal(Object.keys(rendered).length, previous.length);
  for (const stroke of previous) assert.equal(rendered[stroke.id], stroke.color, 'Each restored path keeps its own stored color');
  await page.setViewportSize({width:800, height:1200});
  await enableInk(); await checkLayout('portrait800');
  await closeOnBlank(); await showPalette();
  assert.equal(await palette.locator('button[aria-pressed="true"]').count(), 1, 'Current color remains marked after reopening');
  await closeOnBlank();
  await page.screenshot({path:path.join(artifacts, 'portrait-eight-colors.png')});
  assert.deepEqual(await coreStrokes(), previous, 'Opening and closing the portrait palette cannot alter old strokes');
  assert.equal(inkPosts, 8, 'Exactly eight pen contacts produce exactly eight Core writes');
  assert.deepEqual(errors, []);
  const fixtureUnavailable = responses.filter(response => response.status === 503 && /\/(knowledge-map|inline-teaching)$/.test(response.path));
  assert.deepEqual(responses.filter(response => !fixtureUnavailable.includes(response)), [], 'No unexpected failed HTTP response');
  report = {result:'PASS', environment:'Actual private LAN HTTP, disposable real textbook snapshot, desktop Chrome CDP pen; not physical Y900',
    colors:storedColors, persisted_strokes:previous.length, ink_posts:inkPosts, models:0, new_ocr:0,
    checks:['Eight real selected colors persist unchanged in Core', 'Color selection never recolors existing strokes',
      'Reload preserves all eight colors and normalized strokes', 'Landscape and portrait palette remain onscreen with >=48 CSS px touch areas',
      'Outside touch closes palette and reopening marks current color', 'Toolbar label stays 颜色 with a current-color solid indicator'],
    layouts, errors, unexpected_responses:[], unavailable_fixture_reads:fixtureUnavailable.length};
} catch (error) {
  process.exitCode = 1;
  await page?.screenshot({path:path.join(artifacts, 'failure.png')}).catch(() => {});
  report = {result:'FAIL', error:redact(error.stack || error), colors:storedColors, layouts, errors, responses,
    service:redact(stderr), debug:await page?.evaluate(() => ({reader:document.getElementById('reader')?.className,
      inkStatus:document.getElementById('tablet-ink-save-status')?.textContent, palette:document.getElementById('tablet-ink-choices')?.outerHTML})).catch(() => null)};
} finally {
  await browser?.close(); core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) return resolve(); core.once('exit', resolve); setTimeout(resolve, 5000);});
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  const root = await realpath(temporary), parent = await realpath(os.tmpdir());
  assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('reader-tablet-ink-colors-'));
  await rm(root, {recursive:true, force:true});
}
console.log(JSON.stringify(report));
