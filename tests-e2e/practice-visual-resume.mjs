import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-visual-resume-'));
const dataDir = path.join(root, 'data');
const audit = path.join(root, 'model-input-facts.jsonl');
await mkdir(dataDir);
await writeFile(audit, '');
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const backup = spawnSync('python', ['-c',
  'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
assert.equal(backup.status, 0, backup.stderr);

let server, browser, stderr = '';
try {
  const launcher = fileURLToPath(new URL('./practice-visual-resume-server.py', import.meta.url));
  server = spawn('python', [launcher, '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_MASTER_PROVIDER: 'deepseek', GUIDED_READER_DEEPSEEK_DISABLED: '0',
      GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1',
      PRACTICE_VISUAL_AUDIT: audit},
  });
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
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const status = await page.evaluate(async () => (await fetch('/api/assistant/status')).json());
  const deepseek = status.providers.find(item => item.provider === 'deepseek');
  assert.equal(deepseek?.model, 'deepseek-flash');
  assert.equal(deepseek?.configured, true, 'approved DeepSeek Flash must be configured for real AI smoke');

  const openBook = async () => {
    await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
  };
  const goToPrintedPage = async number => {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
  };
  const choose = async (pdfIndex, letter) => {
    const marker = page.locator(`.page[data-index="${pdfIndex}"] .practice-choice-area[data-choice="${letter}"]`);
    await marker.scrollIntoViewIfNeeded();
    const box = await marker.boundingBox();
    assert.ok(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await openBook();
  await goToPrintedPage(27);
  await page.locator('.page[data-index="26"] .practice-entry').click();
  await page.locator('#practice-question-list button').filter({hasText: '26'}).click();
  assert.equal(await page.locator('#practice-number').innerText(), '26');
  await page.locator('#practice-hint-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#practice-hint p').length === 1, undefined, {timeout: 120000});
  await choose(29, 'A');
  await page.locator('#viewer').press('Enter');
  await page.waitForFunction(() => /正确|不正确/.test(document.querySelector('#practice-status').textContent), undefined,
    {timeout: 30000});
  await page.locator('#practice-review').click();
  await page.locator('[data-review-target="整题"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 1
    && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});

  await page.locator('#practice-close').click();
  await goToPrintedPage(228);
  await page.locator('.page[data-index="227"] .practice-entry').click();
  await page.locator('#practice-question-list button').filter({hasText: '09'}).click();
  assert.equal(await page.locator('#practice-number').innerText(), '09');
  await page.locator('#practice-hint-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#practice-hint p').length === 1, undefined, {timeout: 120000});

  const records = await page.evaluate(async () => {
    const books = (await (await fetch('/api/books')).json()).books;
    const book = books.find(item => item.active_revision?.page_count === 348);
    const revision = book.active_revision.id;
    return (await (await fetch(`/api/revisions/${revision}/practice-prototype`)).json()).positions;
  });
  assert.ok(records['524']);
  await page.locator('#back-to-library').click();
  await openBook();
  await goToPrintedPage(228);
  const entry = page.locator('.page[data-index="227"] .practice-entry');
  await entry.filter({hasText: '继续练习'}).waitFor();
  await entry.click();
  assert.equal(await page.locator('#practice-number').innerText(), '09');
  assert.equal(await page.locator('#practice-page-note').isVisible(), true);

  const facts = (await readFile(audit, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const tableHint = facts.find(item => item.kind === 'hint' && item.question === 26);
  const tableReview = facts.find(item => item.kind === 'review' && item.question === 26);
  const crossHint = facts.find(item => item.kind === 'hint' && item.question === 9);
  assert.equal(tableHint?.images.length, 2);
  assert.equal(tableReview?.images.length, 2);
  assert.deepEqual(tableHint.images, tableReview.images);
  assert.deepEqual([tableHint.has_answer, tableHint.has_explanation, tableHint.has_correctness], [false, false, false]);
  assert.deepEqual([tableReview.has_answer, tableReview.has_explanation, tableReview.has_correctness], [true, true, true]);
  assert.equal(crossHint?.images.length, 2);
  assert.deepEqual(crossHint.pages, [228, 229]);
  assert.deepEqual(errors, []);
  console.log('Practice visual + resume real-book browser smoke PASS', JSON.stringify(facts));
} finally {
  await browser?.close();
  server?.kill();
}
