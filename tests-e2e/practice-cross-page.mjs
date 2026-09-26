import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-cross-page-'));
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
  const providers = await page.evaluate(async () => (await fetch('/api/assistant/status')).json());
  const deepseek = providers.providers.find(item => item.provider === 'deepseek');
  assert.equal(deepseek?.model, 'deepseek-flash');
  assert.equal(deepseek?.configured, true, 'native DeepSeek is required for the requested Hint and Review smoke');
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#page-number').fill('228');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="227"] .practice-entry').click();
  assert.equal(await page.locator('#practice-question-list button').count(), 15);
  await page.locator('#practice-question-list button').filter({hasText: '09'}).click();
  assert.equal(await page.locator('#practice-number').innerText(), '09');
  assert.equal(await page.locator('#practice-page-note').isVisible(), true);
  assert.match(await page.locator('#practice-page-note').innerText(), /跨页/);
  assert.equal(await page.locator('.page[data-index="227"] .practice-choice-area').count(), 2);
  await page.locator('.page[data-index="228"] canvas').waitFor();
  const guides = await page.evaluate(() => [227, 228].map(index => {
    const sourcePage = document.querySelector(`.page[data-index="${index}"]`);
    const guide = sourcePage.querySelector('.practice-current-guide');
    const options = [...sourcePage.querySelectorAll('.practice-choice-area')];
    const guideBox = guide?.getBoundingClientRect();
    return {label: guide?.textContent, count: sourcePage.querySelectorAll('.practice-current-guide').length,
      covers: !!guideBox && options.length === 2
        && guideBox.top <= Math.min(...options.map(option => option.getBoundingClientRect().top))
        && guideBox.bottom >= Math.max(...options.map(option => option.getBoundingClientRect().bottom))};
  }));
  assert.deepEqual(guides, [{label: '当前', count: 1, covers: true}, {label: '续', count: 1, covers: true}]);

  const choice = async (pdfIndex, letter) => {
    const marker = page.locator(`.page[data-index="${pdfIndex}"] .practice-choice-area[data-choice="${letter}"]`);
    await marker.scrollIntoViewIfNeeded();
    const box = await marker.boundingBox();
    assert.ok(box, `missing ${letter} on PDF ${pdfIndex + 1}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await choice(227, 'A');
  assert.match(await page.locator('#practice-selection').innerText(), /再次点 A/);
  await page.locator('#practice-hint-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#practice-hint p').length === 1, undefined,
    {timeout: 120000});
  await page.locator('#practice-hint-button').click();
  await page.waitForFunction(() => document.querySelectorAll('#practice-hint p').length === 2, undefined,
    {timeout: 120000});
  await choice(228, 'C');
  await page.screenshot({path: 'test-results/practice-cross-page-guide.png'});
  assert.match(await page.locator('#practice-selection').innerText(), /再次点 C/);
  assert.equal(await page.locator('.page[data-index="228"] .practice-choice-area').count(), 2);
  await page.locator('#viewer').press('Enter');
  await page.locator('#practice-status').filter({hasText: '不正确'}).waitFor();
  assert.equal(await page.locator('#practice-page-note').isVisible(), false);
  await page.locator('#practice-favorite').click();
  await page.locator('#practice-favorite[aria-pressed="true"]').waitFor();
  await page.locator('#practice-review').click();
  await page.locator('#master-title').filter({hasText: /第 9 题/}).waitFor();
  await page.locator('[data-review-target="C"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 1
    && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});

  const inspection = await page.evaluate(async () => (await fetch('/api/assistant/inspection')).json());
  const hints = inspection.calls.filter(call => call.interaction_id.startsWith('practice-hint:'));
  const master = inspection.calls.find(call => call.interaction_id.startsWith('master-practice:'));
  assert.equal(hints.length, 2);
  assert.ok(hints.every(call => call.provider === 'deepseek'));
  assert.equal(master?.provider, 'deepseek');
  const hintSource = JSON.parse(hints[0].request_body.messages[1].content).source;
  assert.deepEqual(hintSource.pages.map(item => item.pdf_page_number), [228, 229]);
  assert.deepEqual(Object.keys(hintSource.options).sort(), ['A', 'B', 'C', 'D']);
  assert.equal(Object.hasOwn(hintSource, 'official_answer'), false);
  assert.equal(Object.hasOwn(hintSource, 'official_explanation'), false);
  const nextHint = JSON.parse(hints[1].request_body.messages[1].content);
  assert.equal(nextHint.previous_hints.length, 1);
  assert.equal(Object.hasOwn(nextHint.source, 'official_answer'), false);
  const reviewSource = JSON.parse(master.request_body.messages[1].content).source;
  assert.equal(reviewSource.official_answer, 'A');
  assert.ok(reviewSource.official_explanation);
  await page.screenshot({path: 'test-results/practice-cross-page-q09.png'});

  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
  await page.waitForFunction(() => document.querySelector('#memory-status').textContent !== '正在读取…');
  await page.locator('#memory-library-view .memory-book-open').click();
  await page.locator('#memory-tree .memory-section-open').filter({hasText: '5.2'}).click();
  await page.locator('.memory-item-open').filter({hasText: '第 09 题'}).click();
  await page.getByRole('button', {name: '回到原题'}).click();
  await page.locator('#reader.practice-active').waitFor();
  assert.equal(await page.locator('#practice-number').innerText(), '09');
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#practice-status').innerText(), /上次未做对/);
  await page.locator('.page[data-index="227"] .practice-choice-area').first().waitFor();
  assert.equal(await page.locator('.page[data-index="227"] .practice-choice-area').count(), 2);
  assert.deepEqual(errors, []);
  console.log('Cross-page 09 real-book browser smoke PASS');
} finally {
  await browser?.close();
  server?.kill();
}
