import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared scanned-book validation Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-scanned-'));
const dataDir = path.join(root, 'data');
let server, browser;
try {
  await mkdir(dataDir);
  await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
  const backup = spawnSync('python', ['-c',
    'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
    path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
  assert.equal(backup.status, 0, backup.stderr);
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
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
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.route('**/practice-prototype/hint/*', route => route.fulfill({json: {
    hint: '先确认题目限定的条件。', number: 1, hint_number: 1,
  }}));

  for (const [pageCount, title] of [[371, '操作系统'], [312, '计算机网络']]) {
    await page.locator('.book-card').filter({hasText: `${pageCount} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    const catalog = await page.evaluate(async count => {
      const books = (await (await fetch('/api/books')).json()).books;
      const revision = books.find(book => book.active_revision?.page_count === count).active_revision.id;
      return (await (await fetch(`/api/revisions/${revision}/practice-prototype/catalog`)).json()).sections;
    }, pageCount);
    assert.ok(catalog.length > 0, `${title} has no validated Practice sections`);
    assert.ok(catalog.every(section => section.questions.every(question => !Object.hasOwn(question, 'answer'))));
    const section = catalog[0];
    await page.locator('#page-number').fill(String(section.entryPage + 1));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${section.entryPage}"] .practice-entry`).click();
    await page.locator('#practice-section-title').filter({hasText: section.title}).waitFor();
    await page.locator('#practice-hint-button').click();
    await page.locator('#practice-hint').filter({hasText: '先确认题目限定的条件。'}).waitFor();
    const question = section.questions[0];
    const choice = page.locator(`.page[data-index="${question.page}"] .practice-choice-area[data-choice="A"]`);
    await choice.scrollIntoViewIfNeeded();
    const box = await choice.boundingBox();
    assert.ok(box, `${title} has no clickable A option`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#viewer').press('Enter');
    await page.locator('#practice-status').filter({hasText: /正确/}).waitFor();
    await page.locator('#practice-answer').click();
    await page.locator('#practice-back').click();
    await page.locator('#practice-review').click();
    await page.locator('#master-title').filter({hasText: /第 1 题/}).waitFor();
    await page.locator('#practice-favorite').click();
    await page.locator('#practice-favorite[aria-pressed="true"]').waitFor();
    await page.locator('#back-to-library').click();
    await page.locator('#library-home .memory-open').click();
    await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
    await page.waitForFunction(() => document.querySelector('#memory-status').textContent !== '正在读取…');
    await page.locator('#memory-library-view .memory-book-open').filter({hasText: title}).click();
    await page.locator('#memory-tree .memory-section-open').filter({hasText: section.title.split('.')[0] + '.' + section.title.split('.')[1]}).click();
    await page.locator('.memory-item-open').filter({hasText: '第 01 题'}).click();
    await page.getByRole('button', {name: '回到原题'}).click();
    await page.locator('#reader.practice-active').waitFor();
    assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), 'true');
    await page.locator('#back-to-library').click();
    console.log(`${title}: ${catalog.length} sections, ${catalog.reduce((n, item) => n + item.questions.length, 0)} questions; smoke PASS`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())
      || !path.basename(root).startsWith('guided-reader-practice-scanned-')) {
    throw Error(`Unexpected validation directory: ${root}`);
  }
  await rm(root, {recursive: true, force: true});
}
