// Real-book regression for Exercise coverage, independent of option hit areas.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-source-coverage-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const backup = spawnSync('python', ['-c',
  'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
assert.equal(backup.status, 0, backup.stderr);

let server, browser, stderr = '';
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1'},
  });
  server.stderr.on('data', chunk => {stderr += chunk;});
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(Error(stderr || 'server start timeout')), 30000);
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error(stderr || 'server exited'));});
  });
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const api = route => page.evaluate(async route => (await fetch(route)).json(), route);
  const books = (await api('/api/books')).books;
  const cases = [
    ['2026计算机组成原理', '1.3.3', 26], // prompt-only first page + continuation table
    ['2026计算机组成原理', '5.2.4', 9], // options on both pages
    ['2026计算机组成原理', '5.2.4', 1], // ordinary single page
    ['2026计算机组成原理', '4.2.3', 1], // preceding table arrives late in OCR order
    ['2026数据结构', '6.4.6', 22],       // diagram after options, on the next page
    ['2026计算机网络', '5.3.7', 51],     // timing diagram after options, on the next page
  ];
  const results = [];
  const goToPage = async number => {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
  };
  for (const [title, sectionNumber, label] of cases) {
    const book = books.find(book => book.title === title);
    assert.ok(book, title);
    const sections = (await api(`/api/revisions/${book.active_revision.id}/practice-prototype/catalog`)).sections;
    const section = sections.find(section => section.title.startsWith(sectionNumber + ' '));
    const question = section?.questions.find(question => question.label === label);
    assert.ok(question, `${title} ${sectionNumber} ${label}`);
    await page.locator('.book-card').filter({hasText: title}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await goToPage(section.entryPage + 1);
    await page.locator(`.page[data-index="${section.entryPage}"] .practice-entry`).click();
    await page.locator('#practice-question-list button').filter({hasText: new RegExp(`^${String(label).padStart(2, '0')}$`)}).click();
    const check = async () => {
      await page.waitForFunction(regions => regions.every(region =>
        document.querySelector(`.page[data-index="${region.page}"] canvas`)
        && document.querySelector(`.page[data-index="${region.page}"] .practice-current-guide`)), question.sourceRegions);
      const facts = await page.evaluate(question => question.sourceRegions.map(source => {
        const wrapper = document.querySelector(`.page[data-index="${source.page}"]`);
        const guide = wrapper.querySelector('.practice-current-guide');
        return {page: source.page, label: guide.textContent, count: wrapper.querySelectorAll('.practice-current-guide').length,
          top: parseFloat(guide.style.top) / 100,
          bottom: (parseFloat(guide.style.top) + parseFloat(guide.style.height)) / 100,
          options: wrapper.querySelectorAll('.practice-choice-area').length};
      }), question);
      for (const [index, fact] of facts.entries()) {
        const source = question.sourceRegions[index];
        assert.equal(fact.count, 1);
        assert.equal(fact.label, source.page === question.page ? '当前' : '续');
        assert.ok(fact.top <= source.top && fact.bottom >= source.bottom);
        assert.equal(fact.options, question.regions.find(region => region.page === source.page)?.options.length || 0);
      }
      assert.equal(await page.locator('#practice-page-note').isVisible(), question.sourceRegions.length > 1);
      return facts;
    };
    const facts = await check();
    // Recycle page canvases, then return; coverage must be reconstructed.
    await goToPage(Math.min(book.active_revision.page_count, question.page + 14));
    await goToPage(question.page + 1);
    await check();
    results.push({book: title, section: sectionNumber, question: label, facts});
    await page.locator('#back-to-library').click();
  }
  assert.deepEqual(errors, []);
  assert.equal((await api('/api/assistant/inspection')).calls.length, 0);
  console.log('Practice source coverage browser smoke PASS', JSON.stringify(results));
} finally {
  await browser?.close();
  server?.kill();
}
