import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-auto-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const backup = spawnSync('python', ['-c',
  'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
assert.equal(backup.status, 0, backup.stderr);

let server, browser;
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1'},
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(Error(stderr || 'server start timeout')), 30000);
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once('exit', () => { clearTimeout(timer); reject(Error(stderr || 'server exited')); });
  });
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  const catalog = await page.evaluate(async () => {
    const books = (await (await fetch('/api/books')).json()).books;
    const revision = books.find(book => book.active_revision?.page_count === 348).active_revision.id;
    return (await (await fetch(`/api/revisions/${revision}/practice-prototype/catalog`)).json()).sections;
  });
  assert.equal(catalog.length, 27);
  assert.ok(catalog.every(section => section.questions.length > 0));
  assert.ok(catalog.every(section => section.questions.every(question => !Object.hasOwn(question, 'answer'))));
  const target = catalog.find(section => section.title.startsWith('4.4.4'));
  assert.equal(target.questions.length, 5);
  assert.deepEqual(target.questions.find(q => q.label === 4).regions.map(region => region.page), [214, 215]);
  await page.locator('#page-number').fill('215');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="214"] .practice-entry').click();
  await page.locator('#practice-section-title').filter({hasText: '4.4.4'}).waitFor();
  await page.locator('#practice-question-list button').filter({hasText: '04'}).click();
  assert.equal(await page.locator('#practice-page-note').isVisible(), true);
  await page.locator('.page[data-index="215"] canvas').waitFor();
  assert.equal(await page.locator('.page[data-index="214"] .practice-current-guide').innerText(), '当前');
  assert.equal(await page.locator('.page[data-index="215"] .practice-current-guide').innerText(), '续');
  assert.equal(await page.locator('.page[data-index="215"] .practice-choice-area').count(), 2);
  const guidesCoverOptions = await page.evaluate(() => [214, 215].every(index => {
    const sourcePage = document.querySelector(`.page[data-index="${index}"]`);
    const guide = sourcePage.querySelector('.practice-current-guide')?.getBoundingClientRect();
    const options = [...sourcePage.querySelectorAll('.practice-choice-area')].map(node => node.getBoundingClientRect());
    return guide && options.length === 2 && guide.top <= Math.min(...options.map(option => option.top))
      && guide.bottom >= Math.max(...options.map(option => option.bottom));
  }));
  assert.equal(guidesCoverOptions, true);
  const marker = page.locator('.page[data-index="215"] .practice-choice-area[data-choice="C"]');
  await marker.scrollIntoViewIfNeeded();
  await mkdir('test-results', {recursive: true});
  await page.screenshot({path: 'test-results/practice-automatic-cross-page.png'});
  const box = await marker.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.match(await page.locator('#practice-selection').innerText(), /再次点 C/);
  await page.locator('#viewer').press('Enter');
  await page.locator('#practice-status').filter({hasText: '正确'}).waitFor();
  await page.locator('#practice-answer').click();
  await page.locator('#practice-back').waitFor();
  await page.screenshot({path: 'test-results/practice-automatic-answer.png'});
  await page.locator('#practice-back').click();
  await page.locator('#practice-favorite').click();
  await page.locator('#practice-favorite[aria-pressed="true"]').waitFor();
  await page.locator('#practice-review').click();
  await page.locator('#master-title').filter({hasText: /第 4 题/}).waitFor();
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
  await page.waitForFunction(() => document.querySelector('#memory-status').textContent !== '正在读取…');
  await page.locator('#memory-library-view .memory-book-open').click();
  await page.locator('#memory-tree .memory-section-open').filter({hasText: '4.4'}).click();
  await page.locator('.memory-item-open').filter({hasText: '第 04 题'}).click();
  await page.getByRole('button', {name: '回到原题'}).click();
  await page.locator('#reader.practice-active').waitFor();
  assert.match(await page.locator('#practice-section-title').innerText(), /4\.4\.4/);
  assert.equal(await page.locator('#practice-number').innerText(), '04');
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(errors, []);
  console.log('Automatic catalog real-book browser smoke PASS');
} finally {
  await browser?.close();
  server?.kill();
}
