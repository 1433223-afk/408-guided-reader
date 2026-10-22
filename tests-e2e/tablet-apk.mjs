// Installed QA APK + isolated Android AVD + real LAN temporary Reader Core.
// AVD creation/boot is deliberate setup; never targets a user's existing AVD.
// No model/OCR workers. No token is logged or captured in screenshots.
// Run: node tests-e2e/tablet-apk.mjs (isolated ReaderTabletQa at emulator-5580)
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';
import {INK_PALETTE} from '../src/reader_service/static/tablet-ink-store.js';

const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const serial = process.env.READER_APK_SERIAL || 'emulator-5580';
const pkg = 'com.guidedreader.tablet';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {windowsHide:true, timeout:45000, encoding:'utf8'}).trim();
assert.match(adb('emu', 'avd', 'name'), /^ReaderTabletQa\s/m, 'Only this task-owned isolated AVD may be modified');
const opening = await readFile('tests-e2e/tablet-opening.mjs', 'utf8');
let python = opening.match(/const python = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(python?.includes('server = ReaderServer('));
python = python.replace('server = ReaderServer(', String.raw`
import fitz
with library.database.connect() as c:
    for table in ('ink_operations', 'ink_strokes'):
        if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            c.execute('DELETE FROM ' + table)
upload = fitz.open()
sheet = upload.new_page(width=595, height=842)
sheet.insert_text((50,90), 'Tablet APK SAF upload smoke', fontsize=18)
upload.save(str(Path(os.environ['READER_OPENING_ROOT'])/'Tablet-apk-upload.pdf'))
upload.close()
server = ReaderServer(`);
const isPrivate = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  (values || []).map(value => ({name, ...value}))).filter(value => value.family === 'IPv4' && !value.internal && isPrivate(value.address));
const address = process.env.READER_TEST_LAN || interfaces.find(value => /wlan|wi-?fi/i.test(value.name))?.address || interfaces[0]?.address;
assert.ok(address && isPrivate(address));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-apk-'));
const artifacts = path.resolve('test-results/tablet-apk');
await mkdir(artifacts, {recursive:true});
const token = randomBytes(32).toString('hex');
const redact = value => String(value).replaceAll(token, '[credential]').replace(/token%3D[^\s"']+/gi, 'token%3D[credential]');
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd:process.cwd(), windowsHide:true, stdio:['ignore', 'pipe', 'pipe'],
  env:{...process.env, PYTHONPATH:path.join(process.cwd(), 'src'), PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1',
    READER_OPENING_ROOT:temporary, READER_OPENING_LAN:address, READER_OPENING_TOKEN:token},
});
let stdout = '', stderr = '', browser, page, report, forwardedPort, phase = 'fixture';
core.stdout.on('data', value => {stdout += value.toString();});
core.stderr.on('data', value => {stderr += value.toString();});
const checks = [], errors = [], screens = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function nativeXml() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/reader-qa-ui.xml');
  return adb('exec-out', 'cat', '/sdcard/reader-qa-ui.xml');
}
function uiNodes(xml) {
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])));
}
function tapNode(node) {
  assert.ok(node, 'Expected native UI node');
  const values = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((values[0] + values[2]) / 2)), String(Math.round((values[1] + values[3]) / 2)));
}
async function screenshot(name) {
  if (page) assert.equal(await page.evaluate(() => new URLSearchParams(location.search).has('token')), false, 'No launch credential in capture');
  const pixels = execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {windowsHide:true, timeout:15000});
  await writeFile(path.join(artifacts, name + '.png'), pixels); screens.push(name);
}
try {
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('APK Core timeout: ' + redact(stderr))), 90000);
    const check = () => {const match = stdout.match(/^OPENING_FIXTURE (.+)$/m); if (match) {clearTimeout(timer); resolve(JSON.parse(match[1]));}};
    core.stdout.on('data', check); core.once('error', reject);
    core.once('exit', code => {clearTimeout(timer); reject(new Error(`Temporary Core exited ${code}: ${redact(stderr)}`));}); check();
  });
  const origin = `http://${address}:${fixture.port}`;
  const coreGet = async route => {const response = await fetch(origin + route, {headers:{'X-Reader-Token':token}}); assert.equal(response.status, 200); return response.json();};
  const inkRoute = `/api/revisions/${fixture.revision}/ink?page=19`;
  async function waitInk(count) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {const value = await coreGet(inkRoute); if (value.strokes.length === count) return value.strokes; await pause(100);}
    throw new Error(`APK Core expected ${count} pen strokes`);
  }
  phase = 'install-and-first-open';
  adb('install', '-r', path.resolve('dist/android/GuidedReader-Tablet-0.1.0-qa.apk'));
  adb('shell', 'pm', 'clear', pkg);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await pause(800);
  const initial = uiNodes(await nativeXml());
  assert.ok(initial.some(node => node.class === 'android.widget.EditText'), 'First launch has native connection input');
  await screenshot('native-first-open');
  const launch = `${origin}/?tablet=1&token=${token}`;
  const deep = 'guidedreader://connect?url=' + encodeURIComponent(launch);
  // Capture subprocess output only in memory; never log this credential-bearing intent.
  adb('shell', `am start -a android.intent.action.VIEW -d '${deep}' -n ${pkg}/.MainActivity`);
  await pause(1200);
  const pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
  assert.match(pid, /^\d+$/);
  const forwarded = adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid);
  assert.match(forwarded, /^\d+$/);
  forwardedPort = forwarded;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {browser = await chromium.connectOverCDP('http://127.0.0.1:' + forwarded, {timeout:3000}); break;} catch (_) {await pause(300);}
  }
  assert.ok(browser, 'QA WebView exposes its debugging endpoint');
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page');
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(redact(error.message)));
  await page.waitForFunction(() => location.protocol === 'http:' && !new URLSearchParams(location.search).has('token') && document.querySelector('.book-card .book-open'));
  checks.push('QA installs; first-open native form and authenticated private-LAN deep link work');
  const webview = await page.evaluate(() => ({browser:navigator.userAgent.match(/(?:Chrome|Version)\/[\d.]+/g), secure:isSecureContext, viewport:[innerWidth, innerHeight], indexedDB:typeof indexedDB}));
  assert.ok(webview.viewport[0] > webview.viewport[1], 'Start in the task AVD natural landscape orientation');
  const client = await context.newCDPSession(page);
  async function ready(index, ocr = true) {
    await page.waitForFunction(({index, ocr}) => {
      const wrapper = document.querySelector(`.page[data-index="${index}"]`), canvas = wrapper?.querySelector('canvas');
      return canvas && canvas.dataset.readerPreview !== 'true' && !wrapper.classList.contains('loading') && (!ocr || wrapper.querySelector('.ocr-line'));
    }, {index, ocr}, {timeout:60000});
  }
  async function openReader() {
    await page.waitForFunction(() => [...document.querySelectorAll('.book-card .book-open,.overview-book-heading .primary-action,#reader')]
      .some(node => !node.closest('[hidden]') && node.getClientRects().length));
    if (await page.locator('.book-card .book-open').first().isVisible()) {
      await page.locator('.book-card .book-open').first().click();
      await page.locator('.overview-book-heading .primary-action').waitFor({state:'visible'});
    }
    if (await page.locator('.overview-book-heading .primary-action').isVisible()) await page.locator('.overview-book-heading .primary-action').click();
    await page.locator('#reader').waitFor({state:'visible'});
    await page.locator('#page-number').fill('20'); await page.locator('#page-number').press('Enter');
    adb('shell', 'input', 'keyevent', '111'); // Dismiss IME without app navigation.
    await ready(19);
  }
  async function enableInk() {
    if (await page.locator('#reader').evaluate(reader => reader.classList.contains('tablet-ink-enabled'))) return;
    if (await page.locator('#tablet-tools-reveal').getAttribute('aria-expanded') === 'false') await page.locator('#tablet-tools-reveal').click();
    await page.locator('#tablet-ink-toggle').click();
  }
  const pen = (type, x, y, buttons) => client.send('Input.dispatchMouseEvent', {type, x, y, pointerType:'pen', buttons,
    button:type === 'mouseMoved' ? 'none' : 'left', force:buttons ? .5 : 0, clickCount:type === 'mouseMoved' ? 0 : 1});
  async function visiblePoint() {
    return page.locator('.page[data-index="19"] canvas').evaluate(canvas => {
      const paper = canvas.getBoundingClientRect(), viewer = document.getElementById('viewer').getBoundingClientRect();
      return {x:Math.max(viewer.left + 100, paper.left + paper.width * .4), y:Math.max(paper.top + 100, viewer.top + 150)};
    });
  }
  phase = 'pdf-and-palette';
  await openReader();
  await page.evaluate(() => {window.__apkIdentity = Math.random().toString(16);});
  const identity = await page.evaluate(() => window.__apkIdentity);
  await enableInk();
  let previous = [];
  const point = await visiblePoint();
  for (const [row, item] of INK_PALETTE.entries()) {
    await page.locator('#tablet-ink-color').click();
    const palette = page.locator('#tablet-ink-choices[data-kind="color"]');
    await palette.waitFor({state:'visible'});
    assert.equal(await palette.locator('button').count(), 8);
    if (!row) await screenshot('android-landscape-palette');
    await palette.locator(`button[data-value="${item.color}"]`).click();
    assert.deepEqual((await coreGet(inkRoute)).strokes, previous, 'Color selection does not edit old ink');
    const y = point.y + row * 24;
    await pen('mousePressed', point.x, y, 1);
    for (let step = 1; step <= 12; step++) await pen('mouseMoved', point.x + step * 7, y + Math.sin(step / 3) * 7, 1);
    await pen('mouseReleased', point.x + 84, y + Math.sin(4) * 7, 0);
    previous = await waitInk(row + 1);
    assert.equal(previous.at(-1).color, item.color);
  }
  await screenshot('android-eight-colors');
  await page.locator('#tablet-ink-exit').click();
  await page.reload(); await openReader();
  assert.deepEqual((await coreGet(inkRoute)).strokes, previous);
  await page.waitForFunction(() => document.querySelectorAll('.page[data-index="19"] .tablet-ink-layer path').length === 8);
  checks.push('Actual Android system WebView opens real PDF and persists/reloads all eight colors');
  phase = 'rotate-and-resume';
  await page.evaluate(() => {window.__apkIdentity = Math.random().toString(16);});
  const rotationIdentity = await page.evaluate(() => window.__apkIdentity);
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  await page.waitForFunction(() => innerHeight > innerWidth);
  const portraitViewport = await page.evaluate(() => [innerWidth, innerHeight]);
  assert.equal(await page.evaluate(() => window.__apkIdentity), rotationIdentity, 'Rotation keeps the same WebView JS instance');
  await enableInk(); await page.locator('#tablet-ink-color').click();
  await screenshot('android-portrait-palette');
  await page.locator('#tablet-ink-color').click(); await page.locator('#tablet-ink-exit').click();
  adb('shell', 'input', 'keyevent', '3'); await pause(700); adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await pause(700);
  assert.equal(await page.evaluate(() => window.__apkIdentity), rotationIdentity, 'Background resume keeps the reader instance');
  assert.deepEqual((await coreGet(inkRoute)).strokes, previous);
  checks.push('Rotation and background resume keep WebView state and Core ink');
  phase = 'read-pen-selection';
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async value => {window.__apkCopied = value;}}}));
  const selection = await page.evaluate(async revision => {
    const overlay = document.querySelector('.page[data-index="19"] .text-overlay').getBoundingClientRect();
    const viewer = document.getElementById('viewer').getBoundingClientRect();
    const data = (await (await fetch(`/api/revisions/${revision}/overlay?page=19`)).json()).page;
    for (const line of data.lines) {
      const ys = line.quad.map(point => point[1]), y = overlay.top + (Math.min(...ys) + Math.max(...ys)) / 2 * overlay.height;
      if (y < viewer.top + 100 || y > viewer.bottom - 100) continue;
      for (let at = 0; at < line.cells.length - 3; at++) {
        const cells = line.cells.slice(at, at + 3), start = overlay.left + (cells[0][0] + cells[0][1]) / 2 * overlay.width;
        const end = overlay.left + (cells[2][0] + cells[2][1]) / 2 * overlay.width;
        if (start > viewer.left + 50 && end < viewer.right - 80 && cells.every(cell => cell[3] - cell[2] === 1))
          return {start, end, y, expected:line.text.slice(cells[0][2], cells[2][3])};
      }
    }
  }, fixture.revision);
  assert.ok(selection);
  await pen('mousePressed', selection.end, selection.y, 1);
  for (let step = 1; step <= 6; step++) await pen('mouseMoved', selection.end + (selection.start - selection.end) * step / 6, selection.y, 1);
  await pen('mouseReleased', selection.start, selection.y, 0);
  await page.locator('#copy-selection').click();
  assert.equal(await page.evaluate(() => window.__apkCopied), selection.expected);
  assert.equal((await coreGet(inkRoute)).strokes.length, 8);
  checks.push('Read mode reverse pen drag still selects exact OCR text without adding ink');
  phase = 'native-saf-import';
  adb('push', path.join(temporary, 'Tablet-apk-upload.pdf'), '/sdcard/Download/Tablet-apk-upload.pdf');
  adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Download/Tablet-apk-upload.pdf');
  await page.locator('#back-to-library').click();
  await page.getByRole('button', {name:'＋ 导入教材', exact:true}).click();
  let xml;
  for (let attempt = 0; attempt < 5; attempt++) {
    await pause(500); xml = await nativeXml();
    const found = uiNodes(xml).find(node => node.text === 'Tablet-apk-upload.pdf');
    if (found) {tapNode(found); break;}
    const download = uiNodes(xml).find(node => /^(Downloads|下载)$/.test(node.text));
    if (download) tapNode(download);
    else {
      const drawer = uiNodes(xml).find(node => /Show roots|显示根目录|显示根文件夹|显示位置/.test(node['content-desc'] || ''));
      if (drawer) tapNode(drawer);
    }
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.book-card')].some(card => card.textContent.includes('Tablet-apk-upload')), null, {timeout:30000});
  const importedBooks = await coreGet('/api/books');
  const imported = importedBooks.books.find(book => book.title.includes('Tablet-apk-upload'));
  assert.ok(imported?.active_revision);
  assert.equal(imported.active_revision.page_count, 1);
  // The existing importer opens the returned book immediately after success.
  // Its updated library card is intentionally hidden while that Reader is open.
  await page.locator('#reader').waitFor({state:'visible'});
  assert.equal(await page.locator('#reader-title').textContent(), imported.title);
  await ready(0, false); await screenshot('android-saf-import-opened');
  checks.push('Native SAF returns content URI; existing raw-PDF upload imports to isolated Core and opens PDF');
  phase = 'pen-probe-window';
  await enableInk(); await page.locator('#tablet-ink-test').click();
  await page.waitForFunction(() => location.pathname === '/tablet-pen-check.html' && typeof window.TabletPenCheck?.getReport === 'function');
  const probe = await page.evaluate(() => window.TabletPenCheck.getReport());
  assert.equal(probe.capabilities.secureContext, false);
  assert.equal(probe.capabilities.pointerEvents, true);
  await screenshot('android-pen-probe');
  checks.push('User-gesture window.open reaches authenticated pen probe inside APK');
  phase = 'production-install-and-launch';
  await browser.close(); browser = null; page = null;
  adb('install', '-r', path.resolve('dist/android/GuidedReader-Tablet-0.1.0.apk'));
  adb('shell', `am start -a android.intent.action.VIEW -d '${deep}' -n ${pkg}/.MainActivity`);
  let productionNodes = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    await pause(500);
    productionNodes = uiNodes(await nativeXml());
    if (productionNodes.some(node => node.text?.includes('Tablet-apk-upload'))) break;
  }
  assert.ok(productionNodes.some(node => node.text?.includes('Tablet-apk-upload')), 'Production APK reaches the authenticated real library');
  const productionPid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
  assert.match(productionPid, /^\d+$/);
  const unixSockets = adb('shell', 'cat', '/proc/net/unix');
  assert.equal(unixSockets.includes('webview_devtools_remote_' + productionPid), false, 'Production WebView has no debugger socket');
  const fatalExceptions = (adb('logcat', '-d', '-s', 'AndroidRuntime:E').match(/FATAL EXCEPTION/g) || []).length;
  assert.equal(fatalExceptions, 0, 'No AndroidRuntime fatal exception during QA/production smoke');
  await screenshot('production-authenticated-library');
  checks.push('Same-signature production install -r launches authenticated library, no debug endpoint or FATAL exception');
  report = {result:'PASS', environment:'Task-owned Android 37.1 emulator 1200x800 CSS-dp baseline, installed QA APK, actual LAN isolated Core; CDP pen is simulated, not Y900 stylus',
    checks, webview, portraitViewport, probeCapabilities:probe.capabilities, colors:previous.map(stroke => stroke.color), screens, errors, fatalExceptions, models:0, new_ocr:0};
} catch (error) {
  // Never capture the native credential input or a still-token-bearing page.
  if (page) await screenshot('failure').catch(() => {});
  report = {result:'FAIL', phase, error:redact(error.stack || error), checks, screens, errors, service:redact(stderr),
    debug:await page?.evaluate(() => ({ready:document.readyState, viewport:[innerWidth,innerHeight],
      reader:document.getElementById('reader')?.className, readerHidden:document.getElementById('reader')?.hidden,
      bookCards:document.querySelectorAll('.book-card').length, inkStatus:document.getElementById('tablet-ink-save-status')?.textContent})).catch(() => null)};
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (forwardedPort) {try {adb('forward', '--remove', 'tcp:' + forwardedPort);} catch (_) { /* A stopped task AVD already removes its transport. */ }}
  core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) return resolve(); core.once('exit', resolve); setTimeout(resolve, 5000);});
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  const root = await realpath(temporary), parent = await realpath(os.tmpdir());
  assert.equal(path.dirname(root), parent); assert.ok(path.basename(root).startsWith('reader-tablet-apk-'));
  await rm(root, {recursive:true, force:true});
}
console.log(JSON.stringify(report));
