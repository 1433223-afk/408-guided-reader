import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

// UI REPLAY ONLY. PDF rendering and crop requests are real; Assistant SSE replays
// a previously captured answer. All server providers are disabled. This test
// cannot provide new evidence of model capability or answer quality.
const data = process.env.READER_DATA_DIR, output = process.env.READER_OUTPUT_DIR;
if (!data || !output) throw Error('Set an isolated READER_DATA_DIR and READER_OUTPUT_DIR');
const answerFile = process.env.VISUAL_LAYOUT_ANSWER || 'D:\\408-reader-visual-region-20261002\\formula\\answer.txt';
const answer = await readFile(answerFile, 'utf8');
assert.ok(answer.includes('香农定理'), 'expected the saved real formula answer as UI replay input');
const revision = '0581f325-67dc-4a2c-ab7d-3b13e0daaa10', pdfPage = 43;
const region = [.115, .51, .905, .765];
const ui = {row: '#assistant-region-preview', thumb: '#assistant-region-image',
  open: '#assistant-region-open', dialog: '#assistant-region-dialog',
  fullImage: '#assistant-region-full-image', close: '#assistant-region-dialog-close'};
await mkdir(output, {recursive: true});
const report = {status: 'RUNNING', evidenceType: 'UI_REPLAY_NOT_A_REAL_MODEL_RUN',
  replayAnswerFile: answerFile, replayAnswerSha256: createHash('sha256').update(answer).digest('hex'),
  checks: [], screenshots: [], pageErrors: [], blockedModelRequests: [], previewRequests: 0, replayRequests: []};
const sanitize = value => String(value).replace(/token=[^\s&"']+/g, 'token=[redacted]');
let server, browser, page, stderr = '', preview, assistantState;
const rootId = 'visual-layout-ui-replay-root';
function projection(turns, version = 1) {
  const scope = {kind: 'SECTION', chapter_title: '第2章 物理层', section_title: '2.1.2 信道的极限容量', pdf_page_index: pdfPage};
  const root = {root_id: rootId, label: `PDF 第 ${pdfPage + 1} 页选中区域`, provider: 'deepseek', model: 'deepseek-flash', scope,
    created_from: {kind: 'VISUAL_REGION', selected_text_preview: `PDF 第 ${pdfPage + 1} 页选中区域`,
      visual_region: {pdf_page_index: pdfPage, rect: preview.rect, width: preview.image.width, height: preview.image.height}},
    focused_node_id: null, active_child_id: null, child_pending: false, turns, nodes: []};
  return {version, roots: [root], focused_ref: {root_id: rootId, node_id: null}, current: {
    root_id: rootId, node_id: null, parent_ref: null, depth: 1, label: root.label, active_child_id: null,
    child_pending: false, pending: false, error: null, children: [], provider: root.provider, model: root.model,
    scope, turns, breadcrumb: [{root_id: rootId, node_id: null, depth: 1, label: root.label}],
  }};
}
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
      const found = stdout.match(/READY (http:\/\/\S+)/);
      if (found) {clearTimeout(timer); resolve(found[1]);}
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
    if (endpoint === '/api/assistant/status') {
      const provider = {provider: 'deepseek', model: 'deepseek-flash', configured: true, cooling: false,
        configuration_valid: true, credential_available: true, endpoint_valid: true, model_valid: true,
        ai_off_reason: null, supports_images: true};
      return route.fulfill({json: {...provider, active_provider: 'deepseek', providers: [provider]}});
    }
    if (request.method() !== 'POST') return route.continue();
    if (endpoint.endsWith('/visual-region')) {report.previewRequests++; return route.continue();}
    if (endpoint.endsWith('/assistant/ask') || endpoint === '/api/assistant/follow-up') {
      const payload = request.postDataJSON(), first = endpoint.endsWith('/assistant/ask');
      report.replayRequests.push({endpoint, fixture: true, first});
      if (first) {
        assert.equal(payload.source_kind, 'VISUAL_REGION');
        assert.equal(payload.question, '', 'default question must be tested without typing a custom prompt');
        assert.deepEqual(payload.rect, preview.rect);
        assistantState = projection([{turn_id: 'ui-replay-first', question: '请解释这个区域中的内容和关系。', answer}]);
      } else {
        const turns = [...assistantState.current.turns, {turn_id: 'ui-replay-followup', question: payload.question,
          answer: '**UI 回放检查**：这是一条固定追问回答，用来确认来源行不重复；未调用模型。'}];
        assistantState = projection(turns, 2);
      }
      const responseAnswer = assistantState.current.turns.at(-1).answer;
      const events = [{type: 'stage', stage: 'answering'}, {type: 'delta', content: responseAnswer},
        {type: 'complete', assistant: assistantState}];
      return route.fulfill({status: 200, contentType: 'text/event-stream',
        body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')});
    }
    if (endpoint === '/api/assistant/close-root') {
      return route.fulfill({json: {assistant: {version: 3, roots: [], focused_ref: null, current: null}}});
    }
    if (/\/assistant\/(child|follow-up|retry|bake-off)$|\/(generate|regenerate|retry|send|hint)$/.test(endpoint)) {
      report.blockedModelRequests.push(endpoint); return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  await page.goto(ready);
  const shot = async name => {
    const file = path.join(output, `${name}.png`); await page.screenshot({path: file}); report.screenshots.push(file);
  };
  const api = endpoint => page.evaluate(async endpoint => (await fetch(endpoint)).json(), endpoint);
  const books = (await api('/api/books')).books;
  const index = books.findIndex(book => book.active_revision?.id === revision);
  assert.ok(index >= 0);
  await page.locator('.book-card').nth(index).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#reader').waitFor();
  for (let i = 0; i < 20; i++) {
    const current = parseInt(await page.locator('#zoom-value').inputValue(), 10);
    if (current === 80) break;
    await page.locator(current > 80 ? '#zoom-out' : '#zoom-in').click();
  }
  await page.locator('#page-number').fill(String(pdfPage + 1));
  await page.locator('#page-number').press('Enter');
  await page.locator(`.page[data-index="${pdfPage}"]:not(.loading) canvas`).waitFor();
  await page.locator(`.page[data-index="${pdfPage}"] .text-overlay`).waitFor();
  const viewer = await page.locator('#viewer').boundingBox();
  await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height / 2);
  await page.mouse.wheel(0, 1); await page.waitForTimeout(100);
  await page.evaluate(({pdfPage, region}) => {
    const viewer = document.querySelector('#viewer'), canvas = document.querySelector(`.page[data-index="${pdfPage}"] canvas`);
    const v = viewer.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    viewer.scrollTop += c.top + region[1] * c.height - v.top - 90;
  }, {pdfPage, region});
  await page.waitForTimeout(180);
  const canvas = await page.locator(`.page[data-index="${pdfPage}"] canvas`).boundingBox();
  await page.locator('#visual-select-toggle').click();
  await page.mouse.move(canvas.x + region[0] * canvas.width, canvas.y + region[1] * canvas.height);
  await page.mouse.down();
  await page.mouse.move(canvas.x + region[2] * canvas.width, canvas.y + region[3] * canvas.height, {steps: 12});
  await page.mouse.up();
  const cropResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/visual-region'));
  await page.locator('[data-region-confirm]').click();
  const response = await cropResponse;
  assert.equal(response.status(), 200); preview = await response.json();
  await page.locator('#assistant-start').waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector('#assistant-start').disabled);
  assert.equal(await page.locator(ui.row).isVisible(), false, 'normal draft cannot duplicate the PDF crop');
  await shot('01-normal-draft');
  const draftInput = page.locator('#assistant-region-question');
  const draftHeight = (await draftInput.boundingBox()).height;
  assert.ok(draftHeight <= 48, 'empty region question is one line');
  await draftInput.fill(Array(45).fill('测试输入自然换行').join('\n'));
  const draftSize = await draftInput.evaluate(node => ({height: node.getBoundingClientRect().height,
    client: node.clientHeight, scroll: node.scrollHeight, overflow: getComputedStyle(node).overflowY}));
  assert.ok(draftSize.height > draftHeight && draftSize.height <= 170 && draftSize.scroll > draftSize.client);
  assert.ok(['auto', 'scroll'].includes(draftSize.overflow));
  await draftInput.fill('');
  assert.ok((await draftInput.boundingBox()).height <= draftHeight + 2);
  await page.locator('#assistant-start').click();
  await page.locator('#assistant-turns .assistant-answer-bubble:not(.assistant-answer-streaming)').waitFor();
  await page.locator('#assistant-turns').evaluate(node => {node.scrollTop = 0;});
  assert.equal(await page.locator(ui.row).isVisible(), false);
  assert.equal(await page.locator('#assistant-turns .assistant-question-bubble:visible').count(), 0);
  await shot('02-normal-answer-replay');
  report.checks.push('Normal draft and answer show no duplicate crop; implicit first question has no user bubble');

  await page.locator('#assistant-expand').click();
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('assistant-expanded'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator(ui.row).count(), 1);
  assert.equal(await page.locator(ui.row).isVisible(), true);
  assert.match(await page.locator(ui.row).innerText(), /44/);
  assert.match(await page.locator(ui.row).innerText(), /信道的极限容量/);
  assert.equal(await page.locator(ui.open).isVisible(), true);
  const thumb = await page.locator(ui.thumb).boundingBox();
  assert.ok(thumb.width <= 150 && thumb.height <= 90, 'expanded source keeps a small thumbnail');
  const closeRoot = await page.locator('#assistant-close-root').boundingBox();
  const heading = await page.locator('.assistant-heading').boundingBox();
  const sourceRow = await page.locator(ui.row).boundingBox();
  assert.ok((closeRoot.y < heading.y + heading.height && closeRoot.y + closeRoot.height > heading.y)
    || (closeRoot.y < sourceRow.y + sourceRow.height && closeRoot.y + closeRoot.height > sourceRow.y),
    'close topic shares heading/source row instead of consuming a separate row');
  await page.locator('#assistant-turns').evaluate(node => {node.scrollTop = 0;});
  await shot('03-expanded-single-source-row');
  await page.locator('#assistant-turns').evaluate(node => {node.scrollTop = 200;});
  const scroll = await page.locator('#assistant-turns').evaluate(node => node.scrollTop);
  await page.locator(ui.open).click();
  await page.locator(ui.dialog).waitFor({state: 'visible'});
  const full = page.locator(ui.fullImage);
  await page.waitForFunction(selector => document.querySelector(selector)?.naturalWidth > 0, ui.fullImage);
  assert.equal(await full.evaluate(node => node.naturalWidth), preview.image.width);
  assert.ok((await full.boundingBox()).width > thumb.width * 3);
  await shot('04-expanded-temporary-original');
  await page.locator(ui.close).click();
  assert.equal(await page.locator(ui.dialog).isVisible(), false);
  assert.ok(Math.abs(await page.locator('#assistant-turns').evaluate(node => node.scrollTop) - scroll) <= 1);
  await page.locator(ui.open).click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator(ui.dialog).isVisible(), false);
  assert.ok(Math.abs(await page.locator('#assistant-turns').evaluate(node => node.scrollTop) - scroll) <= 1);
  report.checks.push('Expanded mode has one compact source row; original image opens temporarily, closes by button/Escape and preserves answer scroll');

  const input = page.locator('#assistant-question');
  const shortHeight = (await input.boundingBox()).height;
  assert.ok(shortHeight <= 48, 'empty follow-up is one line');
  await input.fill(Array(45).fill('测试输入自然换行').join('\n'));
  const multiline = await input.evaluate(node => ({height: node.getBoundingClientRect().height,
    clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflow: getComputedStyle(node).overflowY}));
  assert.ok(multiline.height > shortHeight && multiline.height <= 170);
  assert.ok(multiline.scrollHeight > multiline.clientHeight);
  assert.ok(['auto', 'scroll'].includes(multiline.overflow));
  await shot('05-input-grown-with-internal-scroll');
  await input.fill('这里的信噪比为何不能直接代入分贝数？');
  assert.ok((await input.boundingBox()).height <= shortHeight + 2);
  await page.locator('#assistant-send').click();
  await page.locator('#assistant-turns .assistant-answer-bubble:not(.assistant-answer-streaming)').nth(1).waitFor();
  assert.equal(await page.locator(ui.row).count(), 1);
  assert.equal(await page.locator('#assistant-turns .assistant-question-bubble:visible').count(), 1);
  await shot('06-follow-up-single-source-row');
  report.checks.push('Follow-up retains one source row; input grows from one line, caps height with internal scroll and shrinks again');

  await page.locator(ui.open).click();
  // A non-modal viewer still permits the ordinary collapse control. If the
  // viewer is modal, first Escape restores normal controls before collapsing.
  if (await page.locator(ui.dialog).evaluate(node => node.matches('dialog:modal'))) await page.keyboard.press('Escape');
  await page.locator('#assistant-expand').click();
  await page.waitForFunction(() => !document.querySelector('#reader').classList.contains('assistant-expanded'));
  await page.waitForTimeout(600);
  assert.equal(await page.locator(ui.dialog).isVisible(), false);
  assert.equal(await page.locator(ui.row).isVisible(), false);
  await shot('07-return-to-normal-no-image');
  report.checks.push('Returning to normal mode removes source thumbnail and any temporary original image');
  // One additional viewport is for visual inspection of header/source/composer,
  // not another model or backend scenario.
  await page.setViewportSize({width: 1156, height: 900});
  await page.waitForTimeout(350);
  await page.locator('#assistant-turns').evaluate(node => {node.scrollTop = 0;});
  await shot('08-narrow-normal-1156');
  await page.locator('#assistant-expand').click();
  await page.waitForFunction(() => document.querySelector('#reader').classList.contains('assistant-expanded'));
  await page.waitForTimeout(600);
  await page.locator('#assistant-turns').evaluate(node => {node.scrollTop = 0;});
  await shot('09-narrow-expanded-1156');
  assert.equal(report.previewRequests, 1);
  assert.equal(report.replayRequests.length, 2);
  assert.deepEqual(report.blockedModelRequests, []);
  assert.deepEqual(report.pageErrors, []);
  report.status = 'PASSED';
} catch (error) {
  report.status = 'FAILED'; report.error = sanitize(error.stack || error.message); process.exitCode = 1;
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
} finally {
  await browser?.close();
  if (server && server.exitCode === null) spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], {windowsHide: true, stdio: 'ignore'});
  if (report.status === 'FAILED') report.serviceErrorTail = sanitize(stderr).slice(-1500);
  await writeFile(path.join(output, 'layout-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, evidenceType: report.evidenceType, checks: report.checks,
    error: report.error, report: path.join(output, 'layout-result.json')}));
}
