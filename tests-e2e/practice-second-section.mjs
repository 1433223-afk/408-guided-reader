import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-524-'));
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
      GUIDED_READER_MASTER_PROVIDER: 'deepseek', GUIDED_READER_ZHIPU_DISABLED: '1',
      GUIDED_READER_OPENROUTER_DISABLED: '1'},
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
  const status = await page.evaluate(async () => (await fetch('/api/assistant/status')).json());
  const deepseek = status.providers.find(item => item.provider === 'deepseek');
  assert.equal(deepseek?.model, 'deepseek-flash');
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#page-number').fill('228');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="227"] .practice-entry').click();
  assert.match(await page.locator('#practice-section-title').innerText(), /5\.2\.4/);
  assert.equal(await page.locator('#practice-question-list button').count(), 15);
  assert.equal(await page.locator('#practice-number').innerText(), '01');

  const choice = async (pdfPage, letter) => {
    const box = await page.locator(`.page[data-index="${pdfPage}"] .practice-choice-area[data-choice="${letter}"]`).boundingBox();
    assert.ok(box, `missing ${letter} on PDF ${pdfPage + 1}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await choice(227, 'B');
  await choice(227, 'B');
  await page.locator('#practice-status').filter({hasText: '不正确'}).waitFor();
  await page.locator('#practice-favorite').click();
  await page.locator('#practice-favorite[aria-pressed="true"]').waitFor();
  await page.locator('#practice-review').click();
  await page.locator('#master-title').filter({hasText: /第 1 题/}).waitFor();
  if (process.env.PRACTICE_SECOND_LIVE === '1') {
    assert.equal(deepseek?.configured, true, 'native DeepSeek must be configured for live review');
    await page.locator('[data-review-target="A"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 1
      && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});
  }
  await page.locator('#practice-answer').click();
  await page.locator('.page[data-index="228"] canvas').waitFor();
  assert.equal(await page.locator('#practice-back').isVisible(), true);
  await page.locator('#practice-back').click();
  await page.locator('#practice-question-list button').filter({hasText: '10'}).click();
  assert.equal(await page.locator('#practice-number').innerText(), '10');
  await choice(228, 'C');
  await page.locator('#viewer').press('Enter');
  await page.locator('#practice-status').filter({hasText: '正确'}).waitFor();
  await page.locator('#practice-question-list button').filter({hasText: '14'}).click();
  assert.equal(await page.locator('.page[data-index="228"] .practice-choice-area').count(), 4);
  if (process.env.PRACTICE_SECOND_LIVE === '1') {
    for (let count = 1; count <= 2; count++) {
      await page.locator('#practice-hint-button').click();
      await page.waitForFunction(expected => document.querySelectorAll('#practice-hint p').length === expected,
        count, {timeout: 90000});
    }
    const inspection = await page.evaluate(async () => (await fetch('/api/assistant/inspection')).json());
    const hints = inspection.calls.filter(call => call.interaction_id.startsWith('practice-hint:'));
    assert.equal(hints.length, 2);
    for (const call of hints) {
      assert.equal(call.provider, 'deepseek');
      const payload = JSON.parse(call.request_body.messages[1].content);
      assert.equal(payload.source.pages[0].pdf_page_number, 229);
      assert.equal(Object.hasOwn(payload.source, 'official_answer'), false);
      assert.equal(Object.hasOwn(payload.source, 'official_explanation'), false);
    }
  }
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
  await page.waitForFunction(() => document.querySelector('#memory-status').textContent !== '正在读取…');
  await page.locator('#memory-library-view .memory-book-open').click();
  await page.locator('#memory-tree .memory-section-open').filter({hasText: '5.2'}).click();
  await page.locator('.memory-item-open').filter({hasText: '第 01 题'}).click();
  await page.getByRole('button', {name: '回到原题'}).click();
  await page.locator('#reader.practice-active').waitFor();
  assert.equal(await page.locator('#practice-number').innerText(), '01');
  assert.match(await page.locator('#practice-section-title').innerText(), /5\.2\.4/);
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), 'true');
  if (process.env.PRACTICE_SECOND_LIVE === '1') {
    await page.locator('#back-to-library').click();
    await page.locator('#library-home .memory-open').click();
    await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
    await page.waitForFunction(() => document.querySelector('#memory-status').textContent !== '正在读取…');
    await page.locator('#memory-library-view .memory-book-open').click();
    await page.locator('#memory-tree .memory-section-open').filter({hasText: '5.2'}).click();
    await page.locator('.memory-item-open').filter({hasText: '第 01 题'}).click();
    await page.getByRole('button', {name: '继续复盘'}).click();
    await page.locator('#master-title').filter({hasText: /第 1 题/}).waitFor();
    assert.ok(await page.locator('#master-history .assistant-answer-bubble').count() >= 1);
  }
  assert.deepEqual(errors, []);
  console.log(`5.2.4 browser smoke PASS; live AI=${process.env.PRACTICE_SECOND_LIVE === '1'}`);
} finally {
  await browser?.close();
  server?.kill();
}
