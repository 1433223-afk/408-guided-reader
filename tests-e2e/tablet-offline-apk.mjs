// Real installed APK smoke: task-owned AVD, airplane mode before first launch,
// local SAF PDF import, bundled ML Kit OCR, pen selection, ink and cold reopen.
// Does not start a computer Core or call an AI provider. CDP pen is simulated.
// Run with a debuggable APK:
//   $env:READER_OFFLINE_APK='...app-debug.apk'; node tests-e2e/tablet-offline-apk.mjs
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, mkdtemp, realpath, rm, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {INK_PALETTE} from '../src/reader_service/static/tablet-ink-store.js';

const root = process.cwd();
const sdk = path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
const adbPath = path.join(sdk, 'platform-tools/adb.exe');
const emulatorPath = path.join(sdk, 'emulator/emulator.exe');
const serial = process.env.READER_OFFLINE_SERIAL || 'emulator-5580';
assert.match(serial, /^emulator-\d+$/);
const emulatorPort = Number(serial.slice('emulator-'.length));
assert.ok(emulatorPort >= 5554 && emulatorPort <= 5682 && emulatorPort % 2 === 0);
const avdName = 'ReaderTabletQa';
const avdHome = path.resolve('.tmp/apk-avd/avds');
const emulatorHome = path.resolve('.tmp/apk-avd/emulator');
const avd = path.join(avdHome, avdName + '.avd');
const pkg = 'com.guidedreader.tablet';
const apk = path.resolve(process.env.READER_OFFLINE_APK || 'android/app/build/outputs/apk/debug/app-debug.apk');
const output = path.resolve('test-results/tablet-offline-apk');
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args],
  {windowsHide:true, timeout:60000, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}).trim();
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-offline-apk-'));
await mkdir(output, {recursive:true});
let browser, page, client, forwardedPort, emulator, report, phase = 'preflight';
let startedEmulator = false;
const checks = [], screens = [], browserErrors = [], externalRequests = [];
const redact = value => String(value).replace(/([?&]token=)[^&\s"'<>]+/gi, '$1[credential]')
  .replace(/(token%3D)[^%\s"'<>]+/gi, '$1[credential]');

async function nativeXml() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/reader-offline-qa-ui.xml');
  return adb('exec-out', 'cat', '/sdcard/reader-offline-qa-ui.xml');
}
function nodes(xml) {
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])));
}
function tapNode(node) {
  assert.ok(node, 'Expected Android SAF node');
  const bounds = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((bounds[0] + bounds[2]) / 2)),
    String(Math.round((bounds[1] + bounds[3]) / 2)));
}
async function screenshot(name) {
  if (page) assert.equal(await page.evaluate(() => new URLSearchParams(location.search).has('token')), false,
    'Screenshots must not contain an entry credential');
  const pixels = execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'],
    {windowsHide:true, timeout:15000});
  await writeFile(path.join(output, name + '.png'), pixels);
  screens.push(name);
}
async function attach() {
  const deadline = Date.now() + 45000;
  let pid;
  while (Date.now() < deadline) {
    try {
      pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
      if (/^\d+$/.test(pid)) {
        const sockets = adb('shell', 'cat', '/proc/net/unix');
        if (sockets.includes('webview_devtools_remote_' + pid)) break;
      }
    } catch (_) { /* App may still be starting. */ }
    await pause(300);
  }
  assert.match(pid || '', /^\d+$/, 'Offline Reader must start a process');
  forwardedPort = adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid);
  const pageDeadline = Date.now() + 90000;
  let targetReady = false;
  let nextNativeCheck = Date.now() + 5000;
  while (Date.now() < pageDeadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${forwardedPort}/json/list`,
        {signal:AbortSignal.timeout(1500)})).json();
      targetReady = targets.some(target => {
        try {return new URL(target.url).hostname === '127.0.0.1';} catch (_) {return false;}
      });
      if (targetReady) break;
    } catch (_) { /* Debug socket/page is still being initialized. */ }
    if (Date.now() > nextNativeCheck) {
      const text = nodes(await nativeXml()).map(node => node.text || '').join(' ');
      assert.equal(text.includes('本机 Reader 未能启动'), false, 'Native local-Core startup failed before the Reader page loaded');
      nextNativeCheck = Date.now() + 10000;
    }
    await pause(300);
  }
  assert.equal(targetReady, true, 'Local Core must navigate the WebView to its loopback Reader');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + forwardedPort, {timeout:30000});
  const context = browser.contexts()[0];
  page = context.pages()[0] || await context.waitForEvent('page', {timeout:30000});
  page.setDefaultTimeout(45000);
  page.on('pageerror', error => browserErrors.push(redact(error.message)));
  page.on('request', request => {
    try {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') externalRequests.push(url.origin);
    } catch (_) { /* Blob/data URLs are local. */ }
  });
  await page.waitForFunction(() => location.hostname === '127.0.0.1'
    && !new URLSearchParams(location.search).has('token') && document.getElementById('library-home'),
    null, {timeout:90000});
  client = await context.newCDPSession(page);
}
async function detach() {
  await browser?.close().catch(() => {});
  browser = page = client = null;
  if (forwardedPort) {
    try {adb('forward', '--remove', 'tcp:' + forwardedPort);} catch (_) { /* Transport already closed. */ }
    forwardedPort = null;
  }
}
async function getJson(route) {
  return page.evaluate(async route => {
    const response = await fetch(route);
    if (!response.ok) throw new Error(`Local API returned ${response.status}`);
    return response.json();
  }, route);
}
async function ready(index, ocr = true) {
  await page.waitForFunction(({index, ocr}) => {
    const wrapper = document.querySelector(`.page[data-index="${index}"]`);
    const canvas = wrapper?.querySelector('canvas');
    return canvas && !wrapper.classList.contains('loading')
      && canvas.dataset.readerPreview !== 'true' && (!ocr || wrapper.querySelector('.ocr-line'));
  }, {index, ocr}, {timeout:180000});
}
async function openReader() {
  if (await page.locator('#reader').isVisible()) return;
  await page.locator('.book-card .book-open').first().click();
  await page.locator('.overview-book-heading .primary-action').waitFor({state:'visible'});
  await page.locator('.overview-book-heading .primary-action').click();
  await page.locator('#reader').waitFor({state:'visible'});
}
async function revealTools() {
  if (await page.locator('#tablet-tools-reveal').getAttribute('aria-expanded') === 'false') {
    await page.locator('#tablet-tools-reveal').click();
  }
}
async function waitInk(revision, count) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const data = await getJson(`/api/revisions/${revision}/ink?page=0`);
    if (data.strokes.length === count) return data.strokes;
    await pause(150);
  }
  throw new Error('Local Core did not acknowledge pen strokes');
}
async function pen(type, x, y, buttons) {
  await client.send('Input.dispatchMouseEvent', {type, x, y, pointerType:'pen', buttons,
    button:type === 'mouseMoved' ? 'none' : 'left', force:buttons ? .5 : 0,
    clickCount:type === 'mouseMoved' ? 0 : 1});
}

const fixturePython = String.raw`
import json, os, sqlite3
from pathlib import Path
import fitz
source = Path(os.environ.get('READER_OFFLINE_SOURCE', str(Path(os.environ['LOCALAPPDATA'])/'408GuidedReaderAndroidTabletDemo'))).resolve()
database = source/'state.sqlite3'
with sqlite3.connect(database.as_uri()+'?mode=ro', uri=True) as c:
    c.execute('PRAGMA query_only=ON')
    row = c.execute("SELECT blob_sha256,page_count FROM book_source_revisions WHERE status='ACTIVE' AND page_count>=22 ORDER BY CASE WHEN page_count=348 THEN 0 ELSE 1 END,byte_size DESC LIMIT 1").fetchone()
if not row: raise RuntimeError('A real textbook of at least 22 pages is required')
digest,pages = row
pdf = source/'blobs'/digest[:2]/(digest+'.pdf')
output = fitz.open()
with fitz.open(str(pdf)) as original:
    for index in (19,20,21):
        page = original[index]
        # Image-only PDF deliberately has no inherited hidden text layer.
        pixmap = page.get_pixmap(dpi=140, alpha=False)
        sheet = output.new_page(width=page.rect.width, height=page.rect.height)
        sheet.insert_image(sheet.rect, pixmap=pixmap)
destination = Path(os.environ['READER_OFFLINE_TMP'])/'Reader-offline-qa.pdf'
output.save(str(destination), deflate=True)
output.close()
with fitz.open(str(destination)) as check:
    assert len(check)==3 and all(not page.get_text().strip() for page in check)
print(json.dumps({'pages':3,'bytes':destination.stat().st_size,'image_only':True}))
`;

try {
  await access(apk);
  const actualAvd = await realpath(avd);
  assert.equal(actualAvd, path.join(await realpath(avdHome), avdName + '.avd'), 'Use only this task-owned AVD');
  const ini = await readFile(path.join(avdHome, avdName + '.ini'), 'utf8');
  const declared = ini.match(/^path=(.+)$/m)?.[1].trim();
  assert.equal(await realpath(declared), actualAvd, 'AVD definition cannot point into user AVDs');
  let online = false, present = false;
  try {online = adb('get-state') === 'device'; present = true;} catch (error) {
    // A task AVD that is still booting already owns its data directory.
    // Avoid launching a second process against its locked userdata image.
    present = /device offline/.test(String(error.stderr || error.message));
  }
  if (!present) {
    emulator = spawn(emulatorPath, ['-avd', avdName, '-port', String(emulatorPort), '-no-window', '-no-audio',
      '-no-snapshot-load', '-no-snapshot-save', '-no-boot-anim', '-gpu', 'swiftshader'], {
      windowsHide:true, stdio:'ignore', env:{...process.env, ANDROID_AVD_HOME:avdHome,
        ANDROID_EMULATOR_HOME:emulatorHome, ANDROID_USER_HOME:path.dirname(emulatorHome)},
    });
    emulator.on('error', () => {});
    startedEmulator = true;
  }
  if (!online || adb('shell', 'getprop', 'sys.boot_completed') !== '1') {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      try {if (adb('shell', 'getprop', 'sys.boot_completed') === '1') {online = true; break;}} catch (_) { /* Boot pending. */ }
      await pause(1500);
    }
    assert.equal(online, true, 'Task-owned AVD must finish booting');
  }
  assert.match(adb('emu', 'avd', 'name'), /^ReaderTabletQa\s/m, 'Never modify a user-owned AVD');

  phase = 'offline-before-first-start';
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
  adb('shell', 'svc', 'wifi', 'disable');
  adb('shell', 'svc', 'data', 'disable');
  assert.equal(adb('shell', 'settings', 'get', 'global', 'airplane_mode_on'), '1');
  assert.equal(adb('shell', 'settings', 'get', 'global', 'wifi_on'), '0');
  assert.equal(adb('shell', 'settings', 'get', 'global', 'mobile_data'), '0');
  adb('install', '-r', apk);
  adb('shell', 'pm', 'clear', pkg);
  adb('logcat', '-c');
  adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '0');
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await attach();
  const firstBooks = await getJson('/api/books');
  assert.equal(firstBooks.books.length, 0, 'Fresh install starts with its own empty local library');
  const environment = await page.evaluate(() => ({origin:location.origin, online:navigator.onLine,
    viewport:[innerWidth, innerHeight], webview:navigator.userAgent.match(/(?:Chrome|Version)\/[\d.]+/g)}));
  assert.equal(environment.origin, 'http://127.0.0.1:18765');
  await screenshot('first-launch-airplane-local-library');
  checks.push('Wi-Fi and cellular disabled before first launch; bundled Core opens an empty local library on loopback');

  phase = 'make-image-only-real-textbook-fixture';
  const fixture = JSON.parse(execFileSync(process.env.READER_PYTHON || 'python', ['-c', fixturePython], {
    windowsHide:true, timeout:60000, encoding:'utf8', env:{...process.env,
      PYTHONIOENCODING:'utf-8', READER_OFFLINE_TMP:temporary},
  }).trim());
  assert.equal(fixture.image_only, true);
  const devicePdf = '/sdcard/Download/Reader-offline-qa.pdf';
  adb('push', path.join(temporary, 'Reader-offline-qa.pdf'), devicePdf);
  adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + devicePdf);

  phase = 'native-saf-local-import';
  await page.getByRole('button', {name:'＋ 导入教材', exact:true}).click();
  let chosen = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await pause(500);
    const entries = nodes(await nativeXml());
    const file = entries.find(node => node.text === 'Reader-offline-qa.pdf');
    if (file) {tapNode(file); chosen = true; break;}
    const download = entries.find(node => /^(Downloads|下载)$/.test(node.text));
    if (download) tapNode(download);
    else {
      const drawer = entries.find(node => /Show roots|显示根目录|显示根文件夹|显示位置/.test(node['content-desc'] || ''));
      if (drawer) tapNode(drawer);
    }
  }
  assert.equal(chosen, true, 'Android SAF exposes the locally copied PDF');
  await page.locator('#reader').waitFor({state:'visible', timeout:60000});
  await ready(0, false);
  const books = await getJson('/api/books');
  assert.equal(books.books.length, 1);
  const revision = books.books[0].active_revision.id;
  assert.equal(books.books[0].active_revision.page_count, 3);
  await screenshot('offline-import-original-page');
  checks.push('Native SAF imports three image-only real textbook pages into tablet-local storage and shows the original PDF');

  phase = 'first-offline-bundled-ocr-and-search';
  await ready(0);
  const overlay = (await getJson(`/api/revisions/${revision}/overlay?page=0`)).page;
  assert.equal(overlay.status, 'READY');
  assert.ok(overlay.lines.length > 5 && overlay.lines.some(line => /[\u3400-\u9fff]/.test(line.text)));
  const prepared = await getJson(`/api/revisions/${revision}/preparation`);
  await revealTools();
  await page.locator('#search-toggle').click();
  const term = overlay.lines.map(line => line.text.match(/[\u3400-\u9fff]{2,4}/)?.[0]).find(Boolean);
  assert.ok(term, 'Actual OCR must recognize Chinese text');
  await page.locator('#search-query').fill(term);
  await page.locator('#search-form').evaluate(form => form.requestSubmit());
  await page.locator('#search-results .search-result').first().waitFor({state:'visible'});
  await screenshot('offline-chinese-ocr-search');
  await page.locator('#search-close').click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable:true,
    value:{writeText:async text => {window.__offlineCopied = text;}}}));
  const selection = await page.evaluate(async revision => {
    const data = (await (await fetch(`/api/revisions/${revision}/overlay?page=0`)).json()).page;
    const paper = document.querySelector('.page[data-index="0"] .text-overlay').getBoundingClientRect();
    const viewer = document.getElementById('viewer').getBoundingClientRect();
    for (const line of data.lines) {
      const ys = line.quad.map(point => point[1]);
      const y = paper.top + (Math.min(...ys) + Math.max(...ys)) / 2 * paper.height;
      if (y < viewer.top + 90 || y > viewer.bottom - 80) continue;
      for (let at = 0; at + 2 < line.cells.length; at++) {
        const cells = line.cells.slice(at, at + 3);
        // Drag endpoints use insertion boundaries, unlike the initial pen
        // contact which selects the touched cell. Uneven ML Kit digit widths
        // make a character's center ambiguous between its two boundaries.
        const boundary = at ? (line.cells[at - 1][1] + cells[0][0]) / 2 : cells[0][0];
        const x0 = paper.left + boundary * paper.width;
        const x1 = paper.left + (cells[2][0] + cells[2][1]) / 2 * paper.width;
        if (x0 > viewer.left + 40 && x1 < viewer.right - 90 && x1 - x0 > 8
            && cells.every(cell => cell[3] - cell[2] === 1)) {
          return {x0, x1, y, expected:[...line.text].slice(cells[0][2], cells[2][3]).join('')};
        }
      }
    }
  }, revision);
  assert.ok(selection, 'Bundled OCR must expose fine cells within the visible page');
  await pen('mousePressed', selection.x1, selection.y, 1);
  for (let step = 1; step <= 8; step++) {
    await pen('mouseMoved', selection.x1 + (selection.x0 - selection.x1) * step / 8, selection.y, 1);
  }
  await pen('mouseReleased', selection.x0, selection.y, 0);
  await page.locator('#copy-selection').click();
  assert.equal(await page.evaluate(() => window.__offlineCopied), selection.expected);
  assert.equal((await getJson(`/api/revisions/${revision}/ink?page=0`)).strokes.length, 0);
  checks.push('Fresh first-run bundled ML Kit recognizes Chinese while offline; existing search and reverse pen selection use real OCR cells');

  phase = 'local-ink-page-zoom-and-rotation';
  await page.locator('#cancel-selection').click().catch(() => {});
  await revealTools(); await page.locator('#tablet-ink-toggle').click();
  const color = INK_PALETTE.find(item => item.color === '#2f80ed')?.color || INK_PALETTE[0].color;
  await page.locator('#tablet-ink-color').click();
  await page.locator(`#tablet-ink-choices button[data-value="${color}"]`).click();
  const point = await page.locator('.page[data-index="0"] canvas').evaluate(canvas => {
    const paper = canvas.getBoundingClientRect(), viewer = document.getElementById('viewer').getBoundingClientRect();
    return {x:Math.max(viewer.left + 80, paper.left + paper.width * .3), y:viewer.top + 140};
  });
  await pen('mousePressed', point.x, point.y, 1);
  for (let step = 1; step <= 15; step++) await pen('mouseMoved', point.x + step * 6, point.y + Math.sin(step / 3) * 14, 1);
  await pen('mouseReleased', point.x + 90, point.y + Math.sin(5) * 14, 0);
  const strokes = await waitInk(revision, 1);
  assert.equal(strokes[0].color, color);
  await page.locator('#tablet-ink-exit').click();
  await page.locator('#page-number').fill('3'); await page.locator('#page-number').press('Enter');
  adb('shell', 'input', 'keyevent', '111'); await ready(2, false);
  await page.locator('#page-number').fill('1'); await page.locator('#page-number').press('Enter');
  adb('shell', 'input', 'keyevent', '111'); await ready(0);
  await page.waitForFunction(() => document.querySelectorAll('.page[data-index="0"] .tablet-ink-layer path').length === 1);
  await page.locator('#zoom-value').fill('125%'); await page.locator('#zoom-value').press('Enter');
  adb('shell', 'input', 'keyevent', '111'); await ready(0);
  await page.waitForFunction(() => document.querySelectorAll('.page[data-index="0"] .tablet-ink-layer path').length === 1);
  await page.evaluate(() => {window.__offlineIdentity = Math.random().toString(16);});
  const identity = await page.evaluate(() => window.__offlineIdentity);
  await screenshot('offline-landscape-ink');
  adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
  await page.waitForFunction(() => innerHeight > innerWidth);
  await ready(0);
  assert.equal(await page.evaluate(() => window.__offlineIdentity), identity);
  assert.deepEqual(await waitInk(revision, 1), strokes);
  await screenshot('offline-portrait-ink');
  checks.push('Ink saves locally while offline, survives page jumps/zoom and portrait rotation without replacing the WebView');

  phase = 'verify-sqlite-after-force-stop';
  await detach();
  adb('shell', 'am', 'force-stop', pkg);
  const databaseDirectory = path.join(temporary, 'local-database');
  await mkdir(databaseDirectory);
  for (const suffix of ['', '-wal', '-shm']) {
    const source = 'files/reader-local/state.sqlite3' + suffix;
    try {
      const bytes = execFileSync(adbPath, ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', source],
        {windowsHide:true, timeout:15000, stdio:['ignore', 'pipe', 'ignore']});
      await writeFile(path.join(databaseDirectory, 'state.sqlite3' + suffix), bytes);
    } catch (error) {if (!suffix) throw error;}
  }
  const databaseCheck = String.raw`
import json, os, sqlite3
from pathlib import Path
db=Path(os.environ['READER_OFFLINE_DB']).resolve()
with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as c:
    c.execute('PRAGMA query_only=ON')
    profiles=c.execute("SELECT engine_profile,COUNT(*) FROM ocr_pages WHERE status='READY' GROUP BY engine_profile").fetchall()
    ink=c.execute('SELECT COUNT(*) FROM ink_strokes WHERE deleted=0').fetchone()[0]
    books=c.execute("SELECT COUNT(*) FROM books WHERE status='ACTIVE'").fetchone()[0]
assert ink==1 and books==1, (ink,books)
assert any('mlkit-chinese-16.0.1:bundled' in (p or '') and count>0 for p,count in profiles), profiles
print(json.dumps({'active_books':books,'active_ink':ink,'ocr_profiles':profiles}))
`;
  const durable = JSON.parse(execFileSync(process.env.READER_PYTHON || 'python', ['-c', databaseCheck], {
    windowsHide:true, timeout:15000, encoding:'utf8', env:{...process.env, PYTHONIOENCODING:'utf-8',
      READER_OFFLINE_DB:path.join(databaseDirectory, 'state.sqlite3')},
  }).trim());
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await attach(); await openReader(); await ready(0);
  assert.deepEqual(await waitInk(revision, 1), strokes);
  await page.waitForFunction(() => document.querySelectorAll('.page[data-index="0"] .tablet-ink-layer path').length === 1);
  await screenshot('offline-cold-reopen-restored');
  checks.push('After force-stop the actual tablet SQLite contains bundled OCR and ink; cold reopening without network restores the book and stroke');
  assert.deepEqual(externalRequests, [], 'Reader must not request assets, PDF, models or APIs from a remote computer');
  const fatalExceptions = (adb('logcat', '-d', '-s', 'AndroidRuntime:E').match(/FATAL EXCEPTION/g) || []).length;
  assert.equal(fatalExceptions, 0);
  report = {result:'PASS', environment, fixture, durable, prepared, checks, screens, browserErrors,
    externalRequests, fatalExceptions, models:0, new_ocr:'bundled ML Kit Chinese, real image-only textbook pages',
    caveat:'Task-owned emulator; CDP pen is simulated. Y900 hardware pen and palm rejection are not established.'};
} catch (error) {
  if (page) await screenshot('failure').catch(() => {});
  report = {result:'FAIL', phase, error:redact(error.stack || error), checks, screens, browserErrors,
    externalRequests, native:await nativeXml().then(xml => nodes(xml).map(node => node.text).filter(Boolean)).catch(() => [])};
  process.exitCode = 1;
} finally {
  await detach();
  await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  const actual = await realpath(temporary), base = await realpath(os.tmpdir());
  assert.equal(path.dirname(actual), base); assert.ok(path.basename(actual).startsWith('reader-offline-apk-'));
  await rm(actual, {recursive:true, force:true});
  // Leave only this QA app/AVD in airplane mode for reproducible follow-up.
  // An emulator started here is retained for inspection; never kill user AVDs.
  if (startedEmulator) emulator?.unref();
}
console.log(JSON.stringify(report));
