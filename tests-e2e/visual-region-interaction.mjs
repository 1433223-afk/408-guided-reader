import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

// Run only against an already prepared, isolated Library. All real providers are
// disabled; the original PDF, OCR, Teaching assets and crop endpoint stay real.
const data = process.env.READER_DATA_DIR, output = process.env.READER_OUTPUT_DIR;
if (!data || !output) throw Error('Set isolated READER_DATA_DIR and READER_OUTPUT_DIR');
const revision = process.env.VISUAL_INTERACTION_REVISION || '9830db77-6811-45cb-822c-f54f3321450a';
const teachingSection = process.env.VISUAL_INTERACTION_TEACHING_SECTION || '772b3274-1291-58ba-b676-4dd71f0320ef';
await mkdir(output, {recursive: true});
const report = {status: 'RUNNING', checks: [], screenshots: [], pageErrors: [], blockedModelRequests: [],
  previewRequests: 0, practiceAttempts: 0};
const sanitize = value => String(value).replace(/token=[^\s&"']+/g, 'token=[redacted]');
let server, browser, page, stderr = '';
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', data], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1'},
  });
  server.stderr.on('data', value => {stderr += value;});
  const ready = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(Error('service did not start')), 30000);
    server.stdout.on('data', value => {
      stdout += value;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error('service exited before READY'));});
  });
  browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'});
  page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      if (endpoint.endsWith('/practice-prototype/knowledge-links')) {
        return route.fulfill({json: {section_id: request.postDataJSON().section_id, pending: false, matches: []}});
      }
      if (/\/assistant\/(ask|child|follow-up|retry|bake-off)$|\/(generate|regenerate|retry|send|hint)$/.test(endpoint)) {
        report.blockedModelRequests.push(endpoint);
        return route.abort('blockedbyclient');
      }
      if (endpoint.endsWith('/visual-region')) report.previewRequests++;
      if (endpoint.includes('/practice-prototype/') && endpoint.endsWith('/attempt')) report.practiceAttempts++;
    }
    return route.continue();
  });
  await page.goto(ready);
  await page.locator('.book-card').first().waitFor();
  const api = endpoint => page.evaluate(async endpoint => {
    const response = await fetch(endpoint);
    if (!response.ok) throw Error(`${endpoint}: ${response.status}`);
    return response.json();
  }, endpoint);
  const shot = async name => {
    const file = path.join(output, name + '.png');
    await page.screenshot({path: file}); report.screenshots.push(file);
  };
  const books = (await api('/api/books')).books;
  const bookIndex = books.findIndex(book => book.active_revision?.id === revision);
  assert.ok(bookIndex >= 0, 'sample book must exist');
  await page.locator('.book-card').nth(bookIndex).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#reader').waitFor();
  async function zoomTo(target) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const current = parseInt(await page.locator('#zoom-value').innerText(), 10);
      if (current === target) return;
      await page.locator(current < target ? '#zoom-in' : '#zoom-out').click();
    }
    throw Error('zoom control did not reach target');
  }
  async function navigate(index) {
    await page.locator('#page-number').fill(String(index + 1));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${index}"]:not(.loading) canvas`).waitFor();
    await page.locator(`.page[data-index="${index}"] .text-overlay`).waitFor();
  }
  async function points(index, rect) {
    const v = await page.locator('#viewer').boundingBox();
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.wheel(0, 1); await page.waitForTimeout(80);
    await page.evaluate(({index, rect}) => {
      const viewer = document.querySelector('#viewer');
      const c = document.querySelector(`.page[data-index="${index}"] canvas`).getBoundingClientRect();
      const v = viewer.getBoundingClientRect();
      viewer.scrollTop += c.top + rect[1] * c.height - v.top - 100;
      viewer.scrollLeft += c.left + (rect[0] + rect[2]) / 2 * c.width - v.left - v.width / 2;
    }, {index, rect});
    await page.waitForTimeout(180);
    const c = await page.locator(`.page[data-index="${index}"] canvas`).boundingBox();
    return {start: {x: c.x + rect[0] * c.width, y: c.y + rect[1] * c.height},
      end: {x: c.x + rect[2] * c.width, y: c.y + rect[3] * c.height}, canvas: c};
  }
  async function selectText(index) {
    const overlay = (await api(`/api/revisions/${revision}/overlay?page=${index}`)).page;
    const line = overlay.lines.find(line => line.cells.length > 12 && line.quad.every(p => p[1] > .08 && p[1] < .35));
    assert.ok(line, 'real OCR text needed');
    const y = line.quad.reduce((sum, p) => sum + p[1], 0) / 4;
    const rect = [line.cells[1][0], y, line.cells[10][1], y];
    const {start, end} = await points(index, rect);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, {steps: 12}); await page.mouse.up();
    await page.locator('.selection-quad').first().waitFor();
    assert.ok((await page.evaluate(() => window.getSelection()?.toString() || '')).length > 2);
    return {start, end};
  }
  async function drag(from, to) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 12}); await page.mouse.up();
  }
  async function normalReading(index) {
    assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.visual-region-outline').count(), 0);
    assert.equal(await page.locator('#visual-select-hint').isVisible(), false);
    assert.equal(await page.locator('#viewer').evaluate(node => node.classList.contains('visual-selecting')), false);
    const cursor = await page.locator(`.page[data-index="${index}"] canvas`).evaluate(node => getComputedStyle(node).cursor);
    assert.notEqual(cursor, 'crosshair');
    assert.notEqual(cursor, 'move');
    assert.ok(!cursor.endsWith('resize'));
  }
  async function assertPending(index, rect, previewsBefore) {
    assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-region-confirm]').isVisible(), true);
    assert.equal(report.previewRequests, previewsBefore, 'drawing or adjusting must not request a crop');
    const outline = await page.locator('.visual-region-outline').boundingBox();
    const canvas = await page.locator(`.page[data-index="${index}"] canvas`).boundingBox();
    const actual = [(outline.x - canvas.x) / canvas.width, (outline.y - canvas.y) / canvas.height,
      (outline.x + outline.width - canvas.x) / canvas.width, (outline.y + outline.height - canvas.y) / canvas.height];
    assert.ok(actual.every((value, i) => Math.abs(value - rect[i]) < 3 / (i % 2 ? canvas.height : canvas.width)),
      `pending outline follows final region: ${actual} vs ${rect}`);
  }

  await zoomTo(100); await navigate(121);
  await selectText(121); await shot('01-original-text-selection');
  await page.locator('#visual-select-toggle').click();
  assert.equal(await page.locator('.selection-quad').count(), 0);
  const cancelPoints = await points(121, [.16, .2, .55, .33]);
  await page.mouse.move(cancelPoints.start.x, cancelPoints.start.y); await page.mouse.down();
  await page.mouse.move(cancelPoints.end.x, cancelPoints.end.y, {steps: 8});
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.visual-region-outline').count(), 0);
  assert.equal(report.previewRequests, 0, 'cancelled drag must not request a crop');
  await selectText(121); await shot('02-text-selection-after-cancel');
  report.checks.push('Real OCR text selection works before and after region mode; Escape cancels drag without preview');
  await page.keyboard.press('Escape');

  // Real linked-list figure: draw imprecisely, then move and resize the pending box.
  await navigate(43);
  const initialRect = [.28, .15, .86, .285];
  const misplaced = await points(43, initialRect);
  await shot('adjust-00-before-region');
  await page.locator('#visual-select-toggle').click();
  await drag(misplaced.start, misplaced.end);
  await assertPending(43, initialRect, 0);
  assert.equal(await page.locator('#assistant-panel').isVisible(), false);
  await shot('adjust-01-pending-misplaced');
  const canvas = misplaced.canvas;
  const at = (x, y) => ({x: canvas.x + x * canvas.width, y: canvas.y + y * canvas.height});
  await drag(at(.52, .2), at(.49, .165));
  await assertPending(43, [.25, .115, .83, .25], 0);
  await shot('adjust-02-moved-inside');
  await drag(at(.83, .18), at(.74, .18));
  await assertPending(43, [.25, .115, .74, .25], 0);
  await shot('adjust-03-edge-shrunk');
  await drag(at(.74, .25), at(.80, .27));
  await assertPending(43, [.25, .115, .80, .27], 0);
  await shot('adjust-04-corner-expanded');
  const finalRect = [.25, .115, .80, .24];
  await drag(at(.52, .27), at(.52, .24));
  await assertPending(43, finalRect, 0);
  await shot('adjust-05-final-region');
  const clickResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/visual-region'));
  await page.locator('[data-region-confirm]').click();
  const clicked = await clickResponse;
  assert.equal(clicked.status(), 200);
  const clickPayload = clicked.request().postDataJSON();
  assert.equal(clickPayload.pdf_page_index, 43);
  assert.ok(clickPayload.rect.every((value, i) => Math.abs(value - finalRect[i]) < 2 / (i % 2 ? canvas.height : canvas.width)));
  report.adjustedCrop = {expected: finalRect, sent: clickPayload.rect};
  await page.locator('#assistant-first-turn').waitFor();
  await page.waitForFunction(() => !document.querySelector('#assistant-readiness').textContent.includes('正在准备'));
  assert.equal(await page.locator('#assistant-region-preview').isVisible(), false);
  await normalReading(43);
  await shot('adjust-06-confirmed-preview-no-overlay');
  await page.locator('#assistant-close').click();
  await selectText(43); await shot('adjust-07-text-selection-after-confirm');
  await page.keyboard.press('Escape');
  report.checks.push('Real linked-list figure pending box moves internally, edge shrinks, corner expands; click confirmation sends final coordinates and restores normal PDF selection without overlay');

  // Cancelling an already drawn box must also be entirely local.
  const beforePendingCancel = report.previewRequests;
  const pendingCancel = await points(43, finalRect);
  await page.locator('#visual-select-toggle').click();
  await drag(pendingCancel.start, pendingCancel.end);
  await assertPending(43, finalRect, beforePendingCancel);
  await page.keyboard.press('Escape');
  await normalReading(43);
  assert.equal(report.previewRequests, beforePendingCancel);
  assert.equal(await page.locator('#assistant-panel').isVisible(), false);
  await shot('adjust-08-pending-cancel-no-assistant');
  report.checks.push('Escape cancels both an active drag and a completed pending box without crop requests or opening Assistant');

  const teaching = await api(`/api/revisions/${revision}/sections/${teachingSection}/inline-teaching`);
  assert.ok(teaching.published, 'existing Teaching required; do not generate');
  const teachingItem = teaching.published.content.items.find(item => teaching.published.sources[item.target_id]?.available);
  assert.ok(teachingItem, 'Teaching source must be available');
  const teachingSource = teaching.published.sources[teachingItem.target_id];
  await navigate(teachingSource.pdf_page_index);
  await page.locator('#inline-open').click();
  const marker = page.locator(`.inline-marker[data-section-id="${teachingSection}"][data-item-id="${teachingItem.id}"]`);
  await marker.click(); await page.locator('.inline-text').first().waitFor();
  const teachingText = await page.locator('.inline-text').first().innerText();
  await shot('03-existing-teaching');
  await page.locator('#visual-select-toggle').click(); await page.keyboard.press('Escape');
  await marker.click(); await page.locator('.inline-text').first().waitFor();
  assert.equal(await page.locator('.inline-text').first().innerText(), teachingText);
  await shot('04-teaching-after-region-cancel');
  await page.locator('#inline-close').click();
  report.checks.push('Existing Teaching marker and source panel reopen with unchanged text after region cancellation');

  const catalog = (await api(`/api/revisions/${revision}/practice-prototype/catalog`)).sections;
  const section = catalog.find(item => item.questions.length > 2);
  assert.ok(section);
  await navigate(section.entryPage);
  await page.getByRole('button', {name: `进入 ${section.title} 的做题模式`, exact: true}).click();
  await page.locator('#practice-panel').waitFor();
  const question = section.questions[0];
  await page.locator(`.page[data-index="${question.page}"] .text-overlay`).waitFor();
  async function optionCenter(choice) {
    const option = page.locator(`.page[data-index="${question.page}"] .practice-choice-area[data-choice="${choice}"]`).first();
    await option.scrollIntoViewIfNeeded();
    const box = await option.boundingBox();
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  }
  let option = await optionCenter('A'); await page.mouse.click(option.x, option.y);
  await page.locator('#practice-status').filter({hasText: /已选 A/}).waitFor();
  await page.locator('#visual-select-toggle').click();
  option = await optionCenter('B'); await page.mouse.click(option.x, option.y);
  await page.keyboard.press('b'); await page.keyboard.press('Enter');
  assert.match(await page.locator('#practice-status').innerText(), /已选 A/);
  assert.equal(report.practiceAttempts, 0);
  await page.keyboard.press('Escape');
  option = await optionCenter('B'); await page.mouse.click(option.x, option.y);
  await page.locator('#practice-status').filter({hasText: /已选 B/}).waitFor();
  await shot('05-practice-option-after-cancel');
  await page.locator('#practice-close').click();
  report.checks.push('Real Practice A/B options remain clickable; active region mode blocks option clicks and A–D/Enter submission');

  await zoomTo(150); await navigate(74);
  const rect = [.13, .69, .65, .755];
  const crop = await points(74, rect);
  await page.locator('#visual-select-toggle').click();
  await page.mouse.move(crop.end.x, crop.end.y); await page.mouse.down();
  await page.mouse.move(crop.start.x, crop.start.y, {steps: 12});
  await shot('06-reverse-region-at-150-percent');
  const beforeEnter = report.previewRequests;
  await page.mouse.up();
  await assertPending(74, rect, beforeEnter);
  const previewResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/visual-region'));
  await page.keyboard.press('Enter');
  const response = await previewResponse;
  assert.equal(response.status(), 200);
  const payload = response.request().postDataJSON();
  assert.equal(payload.pdf_page_index, 74);
  const drift = payload.rect.map((value, index) => Math.abs(value - rect[index]));
  assert.ok(drift.every((value, index) => value < 2 / (index % 2 ? crop.canvas.height : crop.canvas.width)));
  await page.locator('#assistant-first-turn').waitFor();
  await page.waitForFunction(() => !document.querySelector('#assistant-readiness').textContent.includes('正在准备'));
  assert.equal(await page.locator('#assistant-region-preview').isVisible(), false);
  await normalReading(74);
  await shot('07-original-crop-preview-after-zoom');
  report.checks.push('Reverse drag at 150% waits for Enter confirmation, then requests original page coordinates, clears overlay/mode and prepares a real source-PDF crop without duplicating it in the normal dock');
  report.normalizedDrift = drift;
  assert.equal(report.previewRequests, 2, 'only click-confirm and Enter-confirm may request real crops');
  assert.deepEqual(report.blockedModelRequests, [], 'no model request should be attempted');
  assert.deepEqual(report.pageErrors, []);
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.error = sanitize(error.stack || error.message);
  if (page) await page.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], {windowsHide: true, stdio: 'ignore'});
  if (report.status === 'FAILED') report.serviceErrorTail = sanitize(stderr).slice(-1500);
  await writeFile(path.join(output, 'interaction-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, checks: report.checks, error: report.error,
    report: path.join(output, 'interaction-result.json')}));
}
