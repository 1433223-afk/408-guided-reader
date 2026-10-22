// One-time migration of the actual isolated Demo library into an empty APK.
// Only the task-owned ReaderTabletQa AVD is modified. No PC Core is started.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, writeFile, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const serial = process.env.READER_OFFLINE_SERIAL || 'emulator-5580';
const pkg = 'com.guidedreader.tablet';
const resume = process.env.READER_MIGRATION_RESUME === '1';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {
  windowsHide:true, timeout:90000, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'],
}).trim();
assert.match(adb('emu', 'avd', 'name'), /^ReaderTabletQa\s/m, 'Only the task-owned AVD may be changed');
const archive = path.resolve(process.env.READER_OFFLINE_LIBRARY || 'dist/android/GuidedReader-Tablet-Library-20261021.grlibrary');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-offline-migration-'));
const output = path.resolve('test-results/tablet-offline-migration');
await mkdir(output, {recursive:true});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, forward, result, phase = 'prepare';
const checks = [], screens = [], errors = [];
async function native() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/reader-offline-migration-ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/reader-offline-migration-ui.xml');
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])));
}
function tap(node) {
  assert.ok(node, 'Expected native migration/SAF node');
  const b = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String(Math.round((b[0] + b[2]) / 2)), String(Math.round((b[1] + b[3]) / 2)));
}
async function screen(name) {
  assert.equal(await page.evaluate(() => new URLSearchParams(location.search).has('token')), false);
  const bytes = execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p'], {windowsHide:true, timeout:15000});
  await writeFile(path.join(output, name + '.png'), bytes); screens.push(name);
}
async function get(route) {
  return page.evaluate(async route => {
    const r = await fetch(route); if (!r.ok) throw new Error(`Local API ${r.status}`); return r.json();
  }, route);
}
try {
  const fixtureCode = String.raw`
import json,os,sqlite3,zipfile
from pathlib import Path
with zipfile.ZipFile(os.environ['READER_MIGRATION_ARCHIVE']) as z:
    z.extract('state.sqlite3',os.environ['READER_MIGRATION_TMP'])
db=Path(os.environ['READER_MIGRATION_TMP'])/'state.sqlite3'
with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as c:
    c.execute('PRAGMA query_only=ON')
    books=c.execute("SELECT COUNT(*) FROM books WHERE status='ACTIVE'").fetchone()[0]
    revisions=c.execute("SELECT id,page_count FROM book_source_revisions WHERE status='ACTIVE'").fetchall()
    ink=c.execute('SELECT book_source_revision_id,pdf_page_index,COUNT(*) FROM ink_strokes WHERE deleted=0 GROUP BY 1,2 ORDER BY COUNT(*) DESC').fetchall()
    ink_states=c.execute('SELECT deleted,COUNT(*) FROM ink_strokes GROUP BY deleted ORDER BY deleted').fetchall()
    ready=c.execute("SELECT COUNT(*) FROM ocr_pages WHERE status='READY'").fetchone()[0]
    preserved={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['annotations','teaching_assets','inline_teaching_assets','master_messages']}
    guide=c.execute("SELECT a.book_source_revision_id,a.section_node_id,n.start_page FROM teaching_assets a JOIN outline_nodes n ON n.outline_node_id=a.section_node_id WHERE a.state='PUBLISHED' AND a.review_verdict='PASS' AND n.start_page IS NOT NULL ORDER BY n.start_page LIMIT 1").fetchone()
    note=c.execute("SELECT book_source_revision_id,pdf_page_index,id FROM annotations WHERE body IS NOT NULL ORDER BY CASE WHEN source_kind='USER' THEN 0 ELSE 1 END,created_at LIMIT 1").fetchone()
print(json.dumps({'books':books,'revisions':revisions,'ink':ink,'ink_states':ink_states,'ocr_ready':ready,'preserved':preserved,'ui':{'guide':guide,'note':note}}))
`;
  const expected = JSON.parse(execFileSync(process.env.READER_PYTHON || 'python', ['-c', fixtureCode], {
    windowsHide:true, encoding:'utf8', timeout:30000, env:{...process.env, PYTHONIOENCODING:'utf-8',
      READER_MIGRATION_ARCHIVE:archive, READER_MIGRATION_TMP:temporary},
  }).trim());
  assert.ok(expected.books > 0 && expected.ocr_ready > 0,
    'The actual migration archive must contain its saved books and OCR');
  phase = 'empty-local-library';
  adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable');
  adb('shell', 'svc', 'wifi', 'disable'); adb('shell', 'svc', 'data', 'disable');
  if (!resume) adb('shell', 'pm', 'clear', pkg);
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  await pause(1200);
  const pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
  forward = adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid);
  let readyTarget = false;
  for (let count = 0; count < 100; count++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${forward}/json/list`, {signal:AbortSignal.timeout(1500)})).json();
      readyTarget = list.some(target => target.url.startsWith('http://127.0.0.1:18765/'));
      if (readyTarget) break;
    } catch (_) { /* Core starts asynchronously. */ }
    await pause(300);
  }
  assert.ok(readyTarget, 'Local Core must open without a network');
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + forward, {timeout:30000});
  const context = browser.contexts()[0]; page = context.pages()[0];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(45000);
  await page.waitForFunction(() => document.querySelector('#library-home') && !new URLSearchParams(location.search).has('token'));
  assert.equal((await get('/api/books')).books.length, resume ? expected.books : 0);
  if (!resume) {
  const deviceArchive = '/sdcard/Download/Reader-local-library-qa.grlibrary';
  adb('push', archive, deviceArchive);
  adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file://' + deviceArchive);
  phase = 'native-saf-library-import';
  adb('shell', 'input', 'keyevent', '4');
  tap((await native()).find(node => node.text === '导入原有书库'));
  await pause(300);
  tap((await native()).find(node => node.text === '选择迁移文件'));
  let selected = false;
  for (let count = 0; count < 10; count++) {
    await pause(500); const entries = await native();
    const file = entries.find(node => node.text === 'Reader-local-library-qa.grlibrary');
    if (file) {tap(file); selected = true; break;}
    const downloads = entries.find(node => /^(Downloads|下载)$/.test(node.text));
    if (downloads) tap(downloads);
    else {
      const drawer = entries.find(node => /Show roots|显示根目录|显示根文件夹|显示位置/.test(node['content-desc'] || ''));
      if (drawer) tap(drawer);
    }
  }
  assert.ok(selected, 'SAF must select the local migration archive');
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length > 0
    && !new URLSearchParams(location.search).has('token'), null, {timeout:120000});
  }
  const books = (await get('/api/books')).books;
  assert.equal(books.length, expected.books);
  for (const [revision, pages] of expected.revisions) {
    assert.ok(books.some(book => book.active_revision?.id === revision && book.active_revision.page_count === pages));
  }
  // Actual user data may contain only erased strokes. Preserve that state;
  // never invent an active stroke to make a migration screenshot look better.
  const [revision, inkPage, inkCount] = expected.ink[0]
    || [expected.revisions.find(([, pages]) => pages === 348)?.[0] || expected.revisions[0][0], 19, 0];
  const savedInk = await get(`/api/revisions/${revision}/ink?page=${inkPage}`);
  assert.equal(savedInk.strokes.length, inkCount);
  checks.push('Android SAF imports the actual .grlibrary while offline into an empty local book library; saved revision IDs/pages and active ink counts match the source archive');
  await screen('offline-migrated-library');
  phase = 'read-existing-real-book-and-ink';
  const bookAt = books.findIndex(book => book.active_revision.id === revision);
  await page.locator('.book-card .book-open').nth(bookAt).click();
  await page.locator('.overview-book-heading .primary-action').click();
  await page.locator('#reader').waitFor({state:'visible'});
  await page.locator('#page-number').fill(String(inkPage + 1));
  await page.locator('#page-number').press('Enter'); adb('shell', 'input', 'keyevent', '111');
  await page.waitForFunction(({inkPage, inkCount}) => {
    const wrapper = document.querySelector(`.page[data-index="${inkPage}"]`);
    return wrapper?.querySelector('canvas') && wrapper.querySelector('.ocr-line')
      && wrapper.querySelectorAll('.tablet-ink-layer path').length === inkCount;
  }, {inkPage, inkCount}, {timeout:60000});
  await screen('offline-original-book-saved-ocr-ink');
  const overlay = (await get(`/api/revisions/${revision}/overlay?page=${inkPage}`)).page;
  assert.equal(overlay.status, 'READY'); assert.ok(overlay.lines.length > 0);
  checks.push('Migrated full real textbook opens from Android storage with saved OCR and the existing active/erased ink state, without contacting the computer');
  phase = 'read-published-guide-and-notes-offline';
  const reveal = async () => {
    if (await page.locator('#tablet-tools-reveal').getAttribute('aria-expanded') === 'false') await page.locator('#tablet-tools-reveal').click();
  };
  assert.ok(expected.ui.guide && expected.ui.note, 'Actual migrated library has published teaching and a saved note to inspect');
  const [guideRevision, sectionId] = expected.ui.guide;
  assert.equal(guideRevision, revision);
  await reveal(); await page.locator('#outline-toggle').click();
  const target = page.locator(`#outline-tree li[data-node-id="${sectionId}"]`);
  const ancestors = await target.evaluate(node => {
    const ids = []; for (let item = node.parentElement?.closest('li[data-node-id]'); item; item = item.parentElement?.closest('li[data-node-id]')) ids.push(item.dataset.nodeId);
    return ids.reverse();
  });
  for (const id of ancestors) {
    const fold = page.locator(`#outline-tree li[data-node-id="${id}"] > .outline-row > .outline-fold`);
    if (await fold.count() && await fold.getAttribute('aria-expanded') === 'false') await fold.click();
  }
  await target.locator(':scope > .outline-row > .outline-target').click();
  await reveal();
  await page.waitForFunction(() => !document.getElementById('tablet-guide-open').disabled);
  await page.locator('#tablet-guide-open').click();
  await page.waitForFunction(() => !document.getElementById('guide-panel').hidden
    && document.getElementById('guide-content').textContent.trim().length > 80);
  await screen('offline-published-guide-ui');
  await page.locator('#guide-close').click();
  await reveal();
  if (await page.locator('#reader-kp-action').isVisible()) {
    await page.locator('#reader-kp-action').click();
    await page.waitForFunction(() => !document.getElementById('reader-kp-list').hidden
      && document.querySelector('#reader-kp-list .reader-kp-body')?.textContent.length > 40);
    await screen('offline-knowledge-points-ui');
    await page.locator('#reader-kp-list .reader-kp-heading button').click();
  }
  const [noteRevision, notePage, noteId] = expected.ui.note;
  assert.equal(noteRevision, revision);
  await page.locator('#page-number').fill(String(notePage + 1)); await page.locator('#page-number').press('Enter');
  adb('shell', 'input', 'keyevent', '111');
  await reveal(); await page.locator('#marks-toggle').click();
  await page.locator(`#marks-list [data-annotation-id="${noteId}"]`).waitFor({state:'visible'});
  assert.ok((await page.locator(`#marks-list [data-annotation-id="${noteId}"]`).textContent()).trim().length > 20);
  await screen('offline-saved-note-ui');
  checks.push('Existing Directory navigation, published Guide, chapter KP list and saved Notes are actually readable in the offline UI; no generation/review was requested');
  phase = 'verify-migrated-learning-and-ink-database';
  adb('shell', 'am', 'force-stop', pkg);
  const migrated = path.join(temporary, 'migrated'); await mkdir(migrated);
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const bytes = execFileSync(adbPath, ['-s', serial, 'exec-out', 'run-as', pkg, 'cat',
        'files/reader-local/state.sqlite3' + suffix], {windowsHide:true, timeout:15000, maxBuffer:256 * 1024 * 1024,
        stdio:['ignore', 'pipe', 'ignore']});
      await writeFile(path.join(migrated, 'state.sqlite3' + suffix), bytes);
    } catch (error) {if (!suffix) throw error;}
  }
  const countCode = String.raw`
import sqlite3,json,os
from pathlib import Path
c=sqlite3.connect((Path(os.environ['READER_MIGRATED_DB'])/'state.sqlite3').as_uri()+'?mode=ro',uri=True)
try:
    ink=c.execute('SELECT deleted,COUNT(*) FROM ink_strokes GROUP BY deleted ORDER BY deleted').fetchall()
    saved={t:c.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['annotations','teaching_assets','inline_teaching_assets','master_messages']}
    print(json.dumps({'ink_states':ink,'preserved':saved}))
finally:c.close()
`;
  const durable = JSON.parse(execFileSync(process.env.READER_PYTHON || 'python', ['-c', countCode], {
    windowsHide:true, encoding:'utf8', timeout:15000, env:{...process.env, PYTHONIOENCODING:'utf-8', READER_MIGRATED_DB:migrated},
  }).trim());
  assert.deepEqual(durable.ink_states, expected.ink_states);
  assert.deepEqual(durable.preserved, expected.preserved);
  checks.push('Actual migrated SQLite retains the exact ink soft-delete state, annotations, published guides/inline assets and saved Master message counts');
  result = {result:'PASS', expected, durable, checks, screens, errors, models:0, mode:'airplane, no PC Core'};
} catch (error) {
  if (page) await screen('failure').catch(() => {});
  result = {result:'FAIL', phase, error:String(error.stack || error).replace(/([?&]token=)[^&\s"'<>]+/gi, '$1[credential]'),
    checks, screens, errors, native:await native().then(entries => entries.map(node => node.text).filter(Boolean)).catch(() => [])};
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (forward) {try {adb('forward', '--remove', 'tcp:' + forward);} catch (_) { /* Removed transport. */ }}
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  const actual = await realpath(temporary), base = await realpath(os.tmpdir());
  assert.equal(path.dirname(actual), base); assert.ok(path.basename(actual).startsWith('reader-offline-migration-'));
  await rm(actual, {recursive:true, force:true});
}
console.log(JSON.stringify(result));
