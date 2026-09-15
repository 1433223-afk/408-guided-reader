import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');

const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-panel-performance-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), { recursive: true });
const backup = spawnSync('python', ['-c', [
  'import sqlite3,sys',
  'source=sqlite3.connect(sys.argv[1])',
  'target=sqlite3.connect(sys.argv[2])',
  'source.backup(target)',
  'target.close(); source.close()',
].join(';'), path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {
  windowsHide: true, encoding: 'utf8',
});
assert.equal(backup.status, 0, backup.stderr);

let service;
let browser;
const results = [];
try {
  service = await startService();
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(service.url);
  await openBook(page);

  const fixture = await page.evaluate(async () => {
    const books = (await (await fetch('/api/books')).json()).books;
    const revision = books.find(book => book.active_revision?.page_count === 348).active_revision.id;
    const outline = await (await fetch(`/api/revisions/${revision}/outline`)).json();
    const learning = await (await fetch(`/api/revisions/${revision}/learning`)).json();
    const guideSection = outline.nodes.find(node => node.kind === 'SECTION' && node.title.startsWith('2.1 '));
    let inlineSection = null;
    let inlineSnapshot = null;
    for (const section of outline.nodes.filter(node => node.kind === 'SECTION' && node.resolution_state === 'RESOLVED')) {
      const value = await (await fetch(`/api/revisions/${revision}/sections/${section.outline_node_id}/inline-teaching`)).json();
      if (value.published?.content?.items?.some(item => value.published.sources?.[item.target_id]?.available)) {
        inlineSection = section;
        inlineSnapshot = value;
        break;
      }
    }
    return {
      revision,
      outline,
      guideSection,
      inlineSection,
      inlineSnapshot,
      masterPoint: learning.points.find(point => point.thread_id),
    };
  });
  assert.ok(fixture.guideSection, 'real Library needs the accepted Guide section');
  assert.ok(fixture.inlineSection, 'real Library needs one published Inline Teaching section');
  assert.ok(fixture.masterPoint, 'real Library needs one retained Master topic');

  // Assistant: a real PDF selection supplies the temporary Root shell without invoking a provider.
  await selectExactReaderText(page, fixture.revision, 24, '时钟脉冲信号');
  await page.locator('#ask-selection').click();
  await page.locator('#assistant-panel').waitFor({ state: 'visible' });
  await settlePdf(page);
  await probe(page, 'assistant-close', () => page.locator('#assistant-close').click(),
    state('#assistant-panel', 'hidden', true));
  await probe(page, 'assistant-open', () => page.locator('#assistant-toggle').click(),
    state('#assistant-panel', 'hidden', false));
  await probe(page, 'assistant-resize', async () => {
    const handle = await page.locator('#assistant-resize-handle').boundingBox();
    await page.mouse.move(handle.x + 3, handle.y + 220);
    await page.mouse.down();
    await page.mouse.move(handle.x - 64, handle.y + 220, { steps: 5 });
    await page.mouse.up();
  });
  await probe(page, 'assistant-expand', () => page.locator('#assistant-expand').click(),
    state('#reader', 'class', 'assistant-expanded'));
  await probe(page, 'assistant-restore', () => page.locator('#assistant-expand').click(),
    state('#reader', 'class-not', 'assistant-expanded'));
  await probe(page, 'assistant-close-again', () => page.locator('#assistant-close').click(),
    state('#assistant-panel', 'hidden', true));

  // Master: open an existing durable topic, then use the same workspace for expand/restore/close.
  await showLearningMarker(page, fixture.masterPoint);
  const masterAction = page.locator(`.page[data-index="${fixture.masterPoint.display_end_page}"] .kp-learning-marker`)
    .filter({ hasText: fixture.masterPoint.title }).first().getByRole('button', { name: '继续 Master 对话' });
  await probe(page, 'master-open', () => masterAction.click(), state('#master-workspace', 'hidden', false), 900);
  await page.locator('#master-history').waitFor({ state: 'visible' });
  await probe(page, 'master-expand', () => page.locator('#master-expand').click(),
    state('#reader', 'class', 'assistant-expanded'));
  await probe(page, 'master-restore', () => page.locator('#master-expand').click(),
    state('#reader', 'class-not', 'assistant-expanded'));
  await probe(page, 'master-close', () => page.locator('#assistant-panel .dock-tabs').getByRole('button', { name: '收起' }).click(),
    state('#assistant-panel', 'hidden', true));

  // Reading Guide: its frozen split-reader column may move, but never rebuild, the PDF.
  await openOutlineSection(page, fixture.guideSection);
  const guideEntry = page.locator(`.section-guide-entry[data-section-id="${fixture.guideSection.outline_node_id}"]`);
  await guideEntry.scrollIntoViewIfNeeded();
  await settlePdf(page);
  await probe(page, 'guide-open', () => guideEntry.click(), state('#guide-panel', 'hidden', false), 900);
  await probe(page, 'guide-expand', () => page.locator('#guide-expand').click(), state('#guide-expand', 'aria-pressed', 'true'));
  await probe(page, 'guide-restore', () => page.locator('#guide-expand').click(), state('#guide-expand', 'aria-pressed', 'false'));
  await probe(page, 'guide-resize', async () => {
    const handle = await page.locator('#guide-divider').boundingBox();
    await page.mouse.move(handle.x + 4, handle.y + 220);
    await page.mouse.down();
    await page.mouse.move(handle.x - 64, handle.y + 220, { steps: 5 });
    await page.mouse.up();
  });
  await probe(page, 'guide-close', () => page.locator('#guide-close').click(), state('#guide-panel', 'hidden', true));
  await probe(page, 'guide-reopen', () => page.locator('#guide-reopen').click(), state('#guide-panel', 'hidden', false), 900);
  await page.locator('#guide-close').click();

  // Inline Teaching: warm the current-section asset, toggle it, and open/close an anchored Guidance card.
  const inlineSource = Object.values(fixture.inlineSnapshot.published.sources).find(source => source.available);
  await goToSource(page, inlineSource.pdf_page_index, Math.min(...inlineSource.quad.map(point => point[1])));
  await page.waitForFunction(id => document.querySelector('#inline-open')?.dataset.sectionId === id,
    fixture.inlineSection.outline_node_id);
  await page.waitForTimeout(900);
  await settlePdf(page);
  if (await page.locator('#inline-open').getAttribute('aria-pressed') !== 'true') {
    await probe(page, 'inline-enable', () => page.locator('#inline-open').click(), state('#inline-open', 'aria-pressed', 'true'), 900);
  }
  const inlineMarker = page.locator('.inline-marker').first();
  await inlineMarker.waitFor({ state: 'visible' });
  await probe(page, 'inline-card-open', () => inlineMarker.click(), state('#inline-panel', 'hidden', false));
  await probe(page, 'inline-card-close', () => page.locator('#inline-close').click(), state('#inline-panel', 'hidden', true));
  await probe(page, 'inline-card-reopen', () => inlineMarker.click(), state('#inline-panel', 'hidden', false));
  await probe(page, 'inline-disable', () => page.locator('#inline-open').click(), state('#inline-open', 'aria-pressed', 'false'), 900);

  // Temporary Reader navigation surfaces.
  await probe(page, 'outline-open', () => page.locator('#outline-toggle').click(), state('#outline-panel', 'hidden', false), 700);
  await probe(page, 'outline-close', () => page.locator('#outline-close').click(), state('#outline-panel', 'hidden', true));

  await goToSource(page, fixture.masterPoint.display_end_page, fixture.masterPoint.display_end_y);
  await page.locator('#reader-kp-action').filter({ hasText: /\d+ 个知识点/ }).waitFor({ timeout: 10_000 });
  await probe(page, 'knowledge-points-open', () => page.locator('#reader-kp-action').click(), state('#reader-kp-list', 'hidden', false), 900);
  await page.locator('#reader-kp-list .reader-kp-row').first().waitFor();
  await probe(page, 'knowledge-points-close', () => page.locator('#reader-kp-action').click(), state('#reader-kp-list', 'hidden', true));

  await probe(page, 'search-open', () => page.locator('#search-toggle').click(), state('#search-panel', 'hidden', false), 700);
  await probe(page, 'search-close', () => page.locator('#search-close').click(), state('#search-panel', 'hidden', true));
  await probe(page, 'marks-open', () => page.locator('#marks-toggle').click(), state('#marks-panel', 'hidden', false), 900);
  await probe(page, 'marks-close', () => page.locator('#marks-close').click(), state('#marks-panel', 'hidden', true));

  try {
    assert.deepEqual(pageErrors, []);
    for (const result of results) {
      assert.ok(result.stateChangeMs === null || result.stateChangeMs < 50,
        `${result.name} shell state took ${result.stateChangeMs}ms`);
      assert.ok(result.maxLongTaskMs < 50, `${result.name} long task took ${result.maxLongTaskMs}ms`);
      assert.equal(result.removedPdfNodes, 0, `${result.name} removed PDF DOM`);
      assert.equal(result.canvasIdentityPreserved, true, `${result.name} replaced a rendered PDF canvas`);
      assert.equal(result.canvasSizesStable, true, `${result.name} changed PDF canvas dimensions`);
      assert.equal(result.wrapperIdentityPreserved, true, `${result.name} replaced a PDF wrapper`);
      assert.equal(result.zoomStable, true, `${result.name} changed zoom`);
      assert.ok(Math.abs(result.scrollTopDelta) < 1, `${result.name} moved PDF scroll by ${result.scrollTopDelta}`);
      assert.ok(Math.abs(result.scrollLeftDelta) < 1, `${result.name} moved horizontal PDF scroll by ${result.scrollLeftDelta}`);
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', realPages: 348, measurements: results }, null, 2));
    throw error;
  }
  console.log(JSON.stringify({ status: 'PASS', realPages: 348, measurements: results }, null, 2));
} finally {
  if (browser) await browser.close();
  await stopService(service?.child);
  await rm(root, { recursive: true, force: true });
}

function state(selector, attribute, value) { return { selector, attribute, value }; }

async function probe(page, name, action, expectedState = null, observationMs = 650) {
  await settlePdf(page);
  await page.evaluate(({ name, expectedState }) => {
    const pages = document.querySelector('#pages');
    const viewer = document.querySelector('#viewer');
    const canvases = [...pages.querySelectorAll('canvas')];
    const wrappers = [...pages.children];
    const metric = window.__readerPanelMetric = {
      name, clickStart: null, firstFrame: null, stateChange: null, longTasks: [], removedPdfNodes: 0,
      canvases, wrappers, scrollTop: viewer.scrollTop, scrollLeft: viewer.scrollLeft,
      zoom: document.querySelector('#zoom-value').textContent,
      canvasSizes: canvases.map(canvas => {
        const bounds = canvas.getBoundingClientRect();
        return { page: canvas.closest('.page').dataset.index, width: canvas.width, height: canvas.height,
          cssWidth: bounds.width, cssHeight: bounds.height };
      }),
    };
    const stateMatches = () => {
      if (!expectedState) return false;
      const target = document.querySelector(expectedState.selector);
      if (!target) return expectedState.attribute === 'hidden' && expectedState.value === true;
      if (expectedState.attribute === 'hidden') return target.hidden === expectedState.value;
      if (expectedState.attribute === 'class') return target.classList.contains(expectedState.value);
      if (expectedState.attribute === 'class-not') return !target.classList.contains(expectedState.value);
      return target.getAttribute(expectedState.attribute) === expectedState.value;
    };
    metric.longTaskObserver = new PerformanceObserver(list => {
      metric.longTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
    });
    metric.longTaskObserver.observe({ type: 'longtask' });
    metric.pdfObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (node instanceof Element && (node.matches('canvas,.text-overlay,.page')
            || node.querySelector?.('canvas,.text-overlay,.page'))) metric.removedPdfNodes += 1;
      }
    });
    metric.pdfObserver.observe(pages, { childList: true, subtree: true });
    if (expectedState) {
      const target = document.querySelector(expectedState.selector) || document.querySelector('#reader');
      metric.stateObserver = new MutationObserver(() => {
        if (metric.clickStart !== null && metric.stateChange === null && stateMatches()) {
          metric.stateChange = performance.now();
        }
      });
      metric.stateObserver.observe(target, { attributes: true, childList: true, subtree: true });
    }
    document.addEventListener('pointerdown', () => {
      if (metric.clickStart !== null) return;
      metric.clickStart = performance.now();
      requestAnimationFrame(() => { metric.firstFrame = performance.now(); });
    }, { capture: true, once: true });
  }, { name, expectedState });
  await action();
  if (expectedState) await page.waitForFunction(({ selector, attribute, value }) => {
    const target = document.querySelector(selector);
    if (!target) return attribute === 'hidden' && value === true;
    if (attribute === 'hidden') return target.hidden === value;
    if (attribute === 'class') return target.classList.contains(value);
    if (attribute === 'class-not') return !target.classList.contains(value);
    return target.getAttribute(attribute) === value;
  }, expectedState);
  await page.waitForTimeout(observationMs);
  const result = await page.evaluate(() => {
    const metric = window.__readerPanelMetric;
    metric.longTaskObserver.disconnect(); metric.pdfObserver.disconnect(); metric.stateObserver?.disconnect();
    const viewer = document.querySelector('#viewer');
    const currentCanvases = [...document.querySelectorAll('#pages canvas')];
    const byPage = new Map(currentCanvases.map(canvas => [canvas.closest('.page').dataset.index, canvas]));
    const longTasks = metric.longTasks.filter(entry => metric.clickStart !== null
      && entry.start >= metric.clickStart && entry.start <= metric.clickStart + 600).map(entry => entry.duration);
    return {
      name: metric.name,
      stateChangeMs: metric.stateChange === null ? null : metric.stateChange - metric.clickStart,
      firstFrameMs: metric.firstFrame === null ? null : metric.firstFrame - metric.clickStart,
      maxLongTaskMs: Math.max(0, ...longTasks),
      removedPdfNodes: metric.removedPdfNodes,
      canvasIdentityPreserved: metric.canvasSizes.every((saved, index) => byPage.get(saved.page) === metric.canvases[index]),
      canvasSizesStable: metric.canvasSizes.every(saved => {
        const canvas = byPage.get(saved.page); if (!canvas) return false;
        const bounds = canvas.getBoundingClientRect();
        return canvas.width === saved.width && canvas.height === saved.height
          && Math.abs(bounds.width - saved.cssWidth) < .1 && Math.abs(bounds.height - saved.cssHeight) < .1;
      }),
      wrapperIdentityPreserved: metric.wrappers.every((wrapper, index) => document.querySelector('#pages').children[index] === wrapper),
      zoomStable: document.querySelector('#zoom-value').textContent === metric.zoom,
      scrollTopDelta: viewer.scrollTop - metric.scrollTop,
      scrollLeftDelta: viewer.scrollLeft - metric.scrollLeft,
    };
  });
  results.push(result);
}

async function settlePdf(page) {
  await page.waitForFunction(() => !document.querySelector('#pages .page.loading'));
  await page.waitForTimeout(250);
}

async function openBook(page) {
  await page.locator('.book-card').filter({ hasText: '348 个 PDF 页面' }).locator('.book-open').click();
  await page.locator('#book-overview').waitFor({ state: 'visible' });
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#reader').waitFor({ state: 'visible' });
  await page.locator('.page canvas').first().waitFor({ state: 'visible', timeout: 30_000 });
  await settlePdf(page);
}

async function goToSource(page, pageIndex, y = 0) {
  await page.locator('#page-number').fill(String(pageIndex + 1));
  await page.locator('#page-number').press('Enter');
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: 'visible', timeout: 30_000 });
  await page.evaluate(({ pageIndex, y }) => {
    const viewer = document.querySelector('#viewer');
    const wrapper = document.querySelector(`.page[data-index="${pageIndex}"]`);
    viewer.scrollTop = wrapper.offsetTop + wrapper.offsetHeight * y;
    viewer.dispatchEvent(new Event('scroll'));
  }, { pageIndex, y });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: 'attached' });
  await settlePdf(page);
}

async function selectExactReaderText(page, revision, pageIndex, needle) {
  await goToSource(page, pageIndex);
  const overlay = await page.evaluate(async ({ revision, pageIndex }) => (
    await (await fetch(`/api/revisions/${revision}/overlay?page=${pageIndex}`)).json()
  ).page, { revision, pageIndex });
  const line = overlay.lines.find(candidate => candidate.text.includes(needle));
  assert.ok(line, `OCR line missing: ${needle}`);
  const start = line.text.indexOf(needle), end = start + needle.length;
  const first = line.cells.findIndex(cell => cell[3] > start && cell[2] < end);
  const last = line.cells.findLastIndex(cell => cell[3] > start && cell[2] < end);
  const boundaryX = index => index === 0 ? line.cells[0][0] : index === line.cells.length
    ? line.cells.at(-1)[1] : (line.cells[index - 1][1] + line.cells[index][0]) / 2;
  const box = await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = box.y + (Math.min(...ys) + Math.max(...ys)) / 2 * box.height;
  const x0 = box.x + boundaryX(first) * box.width, x1 = box.x + boundaryX(last + 1) * box.width;
  await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move(x1, y, { steps: 10 }); await page.mouse.up();
  await page.mouse.click((x0 + x1) / 2, y, { button: 'right' });
  await page.locator('#selection-actions').waitFor({ state: 'visible' });
}

async function showLearningMarker(page, point) {
  await goToSource(page, point.display_end_page, point.display_end_y);
  const marker = page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`)
    .filter({ hasText: point.title }).first();
  await marker.locator('summary').click();
  await marker.locator('.learning-marker-content').waitFor();
}

async function openOutlineSection(page, section) {
  if (!await page.locator('#outline-panel').isVisible()) await page.locator('#outline-toggle').click();
  const row = page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
  if (!await row.isVisible()) {
    await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
  }
  await row.locator('.outline-target').click();
  if (await page.locator('#outline-panel').isVisible()) await page.locator('#outline-toggle').click();
  await page.locator(`.page[data-index="${section.start_page}"] canvas`).waitFor({ state: 'visible', timeout: 30_000 });
  await settlePdf(page);
}

async function startService() {
  const child = spawn(process.env.READER_PYTHON || 'python',
    ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GUIDED_READER_DEEPSEEK_API_KEY: 'performance-test-no-call',
        GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1' },
    });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'server start timed out')), 30_000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(stderr || 'server exited')); });
  });
  return { child, url };
}

async function stopService(child) {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await stopped;
}

function chromePath() {
  const candidates = [process.env.READER_CHROMIUM,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  const fs = process.getBuiltinModule('node:fs');
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge is required');
  return found;
}
