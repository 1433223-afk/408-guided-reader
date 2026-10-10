import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cp, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

// Only these explicit crops run. All model calls go through the audited launcher.
const source = process.env.READER_DATA_DIR, output = process.env.READER_OUTPUT_DIR;
const manifest = process.env.VISUAL_REGION_MANIFEST;
const zhipuCases = new Set((process.env.VISUAL_REGION_ZHIPU_CASE || '').split(',').filter(Boolean));
if (!source || !output || !manifest) throw Error('Set READER_DATA_DIR, READER_OUTPUT_DIR, VISUAL_REGION_MANIFEST');
const samples = JSON.parse(await readFile(manifest, 'utf8'));
assert.ok(Array.isArray(samples) && samples.length > 0 && samples.length <= 5, 'select at most five real samples');
const data = path.join(output, 'data'), audit = path.join(output, 'model-calls.jsonl');
await mkdir(data, {recursive: true});
const src = (await realpath(source)).toLowerCase(), dst = (await realpath(data)).toLowerCase();
assert.ok(src !== dst && !dst.startsWith(src + path.sep), 'service must run in a separate Library copy');
if (process.env.READER_REUSE_DATA !== '1') {
  await cp(path.join(source, 'blobs'), path.join(data, 'blobs'), {recursive: true, force: false, errorOnExist: true});
  const backup = spawnSync('python', ['-c',
    'import sqlite3,sys; s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
    path.join(source, 'state.sqlite3'), path.join(data, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
  assert.equal(backup.status, 0, backup.stderr);
}
const resultPath = path.join(output, 'smoke-result.json');
const previous = process.env.READER_REUSE_RESULTS === '1'
  ? JSON.parse(await readFile(resultPath, 'utf8').catch(() => '{"cases":[]}')) : {cases: []};
if (process.env.READER_KEEP_AUDIT !== '1') await writeFile(audit, '');
const events = async () => (await readFile(audit, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const calls = async () => (await events()).filter(event => event.event === 'request').length;
const report = {status: 'RUNNING', cases: []};
const save = () => writeFile(resultPath, JSON.stringify(report, null, 2));
const imageFacts = preview => {
  const bytes = Buffer.from(preview.image.data_url.split(',')[1], 'base64');
  return {rect: preview.rect, width: preview.image.width, height: preview.image.height,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
};
let server, browser, page, stderr = '';
try {
  const launcher = fileURLToPath(new URL('./visual-region-server.py', import.meta.url));
  server = spawn('python', [launcher, '--no-open', '--port', '0', '--data-dir', data], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_ASSISTANT_PROVIDER: 'deepseek', GUIDED_READER_DEEPSEEK_DISABLED: '0',
      GUIDED_READER_ZHIPU_DISABLED: process.env.VISUAL_REGION_ZHIPU_CASE ? '0' : '1',
      GUIDED_READER_OPENROUTER_DISABLED: '1', VISUAL_REGION_CALL_AUDIT: audit},
  });
  server.stderr.on('data', value => {stderr += value;});
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(Error('server start timeout')), 30000);
    server.stdout.on('data', value => {
      stdout += value;
      const ready = stdout.match(/READY (http:\/\/\S+)/);
      if (ready) {clearTimeout(timer); resolve(ready[1]);}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error('server exited'));});
  });
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
  page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(30000);
  // Read streaming evidence inside the page; CDP may not retain SSE response bodies.
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    window.__visualSmokeStreams = [];
    window.fetch = async (...args) => {
      const response = await fetchOriginal(...args);
      if (String(args[0]).endsWith('/assistant/ask')) {
        const entry = {status: response.status, done: false};
        window.__visualSmokeStreams.push(entry);
        response.clone().text().then(text => {entry.text = text; entry.done = true;},
          error => {entry.error = error.message; entry.done = true;});
      }
      return response;
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const api = (route, body) => page.evaluate(async ({route, body}) => {
    const response = await fetch(route, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : undefined);
    if (!response.ok) throw Error(`${route}: ${response.status}`);
    return response.json();
  }, {route, body});
  const closePanel = async () => {
    if (await page.locator('#assistant-panel').isVisible()) await page.locator('#assistant-close').click();
  };
  const setZoom = async target => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const current = parseInt(await page.locator('#zoom-value').inputValue(), 10);
      if (current === target) return;
      await page.locator(current < target ? '#zoom-in' : '#zoom-out').click();
    }
    throw Error(`cannot select ${target}% zoom`);
  };
  const navigate = async sample => {
    await page.locator('#page-number').fill(String(sample.page_index + 1));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${sample.page_index}"]:not(.loading) canvas`).waitFor();
    await page.locator(`.page[data-index="${sample.page_index}"] .text-overlay`).waitFor();
  };
  // Scroll the actual viewer so the selected rectangle fits; do not resize the PDF.
  const cropPoints = async sample => {
    const visibleViewer = await page.locator('#viewer').boundingBox();
    await page.mouse.move(visibleViewer.x + visibleViewer.width / 2, visibleViewer.y + visibleViewer.height / 2);
    // Ordinary wheel input releases Reader's navigation landing pin before positioning.
    await page.mouse.wheel(0, 1);
    await page.waitForTimeout(80);
    await page.evaluate(({index, rect}) => {
      const viewer = document.querySelector('#viewer'), canvas = document.querySelector(`.page[data-index="${index}"] canvas`);
      const v = viewer.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      viewer.scrollTop += c.top + rect[1] * c.height - v.top - 90;
      viewer.scrollLeft += c.left + ((rect[0] + rect[2]) / 2) * c.width - (v.left + v.width / 2);
    }, {index: sample.page_index, rect: sample.normalized_rect});
    await page.waitForTimeout(150);
    const canvas = await page.locator(`.page[data-index="${sample.page_index}"] canvas`).boundingBox();
    const viewer = await page.locator('#viewer').boundingBox();
    const [x0, y0, x1, y1] = sample.normalized_rect;
    const start = {x: canvas.x + x0 * canvas.width, y: canvas.y + y0 * canvas.height};
    const end = {x: canvas.x + x1 * canvas.width, y: canvas.y + y1 * canvas.height};
    assert.ok(start.x >= viewer.x && end.x <= viewer.x + viewer.width && start.y >= viewer.y
      && end.y <= viewer.y + viewer.height, 'sample crop must fit inside the visible PDF viewport');
    return {start, end, canvas};
  };
  for (const sample of samples) {
    const reused = previous.cases.find(value => value.name === sample.name && value.modelCompleted
      && value.revision === sample.revision_id && JSON.stringify(value.rect) === JSON.stringify(sample.normalized_rect));
    if (reused) {report.cases.push({...reused, reusedModelEvidence: true}); await save(); continue;}
    const current = {name: sample.name, label: sample.label, revision: sample.revision_id,
      page: sample.page_index, rect: sample.normalized_rect, checks: [], previews: [], status: 'RUNNING'};
    report.cases.push(current);
    const directory = path.join(output, sample.name.replace(/[^a-z0-9_-]/gi, '-'));
    await mkdir(directory, {recursive: true});
    const screenshot = name => page.screenshot({path: path.join(directory, name + '.png')});
    await page.setViewportSize({width: 1440, height: 1000});
    if (await page.locator('#reader').isVisible()) await page.locator('#back-to-library').click();
    await page.locator('#library-home').waitFor();
    const books = (await api('/api/books')).books;
    const index = books.findIndex(book => book.active_revision?.id === sample.revision_id);
    assert.ok(index >= 0, 'sample revision must be in the real Library');
    await page.waitForFunction(count => document.querySelectorAll('.book-card').length === count, books.length);
    const card = page.locator('.book-card').nth(index);
    assert.equal(await card.locator('.book-card-title').innerText(), books[index].title);
    await card.locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('#reader').waitFor();
    await navigate(sample);
    const initialCalls = await calls();
    let finalPreview;
    for (const [width, zoom] of [[1440, 80], [1440, 100], [1440, 150], [900, 80]]) {
      await closePanel();
      // Narrow Reader hides zoom controls; select the same zoom before resizing.
      await page.setViewportSize({width: 1440, height: 1000});
      await setZoom(zoom);
      await page.setViewportSize({width, height: 1000});
      await navigate(sample);
      const {start, end, canvas} = await cropPoints(sample);
      const prefix = `${width}-${zoom}`;
      await screenshot(prefix + '-before');
      await page.locator('#visual-select-toggle').click();
      assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'true');
      await screenshot(prefix + '-active');
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await screenshot(prefix + '-down');
      await page.mouse.move(end.x, end.y, {steps: 12});
      await screenshot(prefix + '-drag');
      await page.mouse.up();
      await screenshot(prefix + '-up');
      assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'true');
      await page.locator('[data-region-confirm]').waitFor();
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(`/api/revisions/${sample.revision_id}/visual-region`));
      await page.locator('[data-region-confirm]').click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      finalPreview = await response.json();
      const request = response.request().postDataJSON();
      assert.equal(request.pdf_page_index, sample.page_index);
      const drift = request.rect.map((value, i) => Math.abs(value - sample.normalized_rect[i]));
      assert.ok(drift.every((value, i) => value <= 1.5 / (i % 2 ? canvas.height : canvas.width)), 'drag must preserve normalized PDF coordinates');
      assert.deepEqual(finalPreview.rect, request.rect);
      await page.locator('#assistant-first-turn').waitFor();
      await page.waitForFunction(() => !document.querySelector('#assistant-start').disabled);
      assert.equal(await page.locator('#assistant-region-preview').isVisible(), false);
      assert.equal(await page.locator('.visual-region-outline').count(), 0);
      assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'false');
      await screenshot(prefix + '-draft');
      // Exact same source request must produce identical pixels regardless of UI zoom.
      const canonical = await api(`/api/revisions/${sample.revision_id}/visual-region`,
        {pdf_page_index: sample.page_index, rect: sample.normalized_rect});
      current.previews.push({width, zoom, drag: imageFacts(finalPreview), maxNormalizedDrift: Math.max(...drift), canonical: imageFacts(canonical)});
      if (current.previews.length > 1) assert.deepEqual(current.previews[0].canonical, imageFacts(canonical));
      await save();
    }
    assert.equal(await calls(), initialCalls, 'dragging, preview and zoom cannot call a model');
    current.checks.push('1440px 80%/100%/150% and 900px 80% drag coordinates align; canonical crop dimensions and PNG hash are identical');
    const provider = zhipuCases.has(sample.name) ? 'zhipu' : 'deepseek';
    await page.locator('#assistant-model-trigger').click();
    await page.locator(`#assistant-model-options [data-value="${provider}"]`).click();
    await page.locator('#assistant-region-question').fill(sample.question || '请解释这块教材区域，说明其中的符号、图形或步骤之间的关系；看不清的地方请直接说明。');
    await page.locator('#assistant-start').waitFor();
    assert.equal(await page.locator('#assistant-start').isEnabled(), true);
    const auditOffset = (await events()).length;
    const answerResponse = page.waitForResponse(response => response.request().method() === 'POST'
      && response.url().endsWith(`/api/revisions/${sample.revision_id}/assistant/ask`));
    await page.locator('#assistant-start').click();
    const response = await answerResponse;
    assert.equal(response.status(), 200);
    const timeout = Number(process.env.VISUAL_REGION_TIMEOUT_MS || 240000);
    await page.locator('#assistant-turns .assistant-answer-bubble').last().waitFor({timeout});
    await page.waitForFunction(() => window.__visualSmokeStreams.at(-1)?.done, undefined, {timeout});
    const captured = await page.evaluate(() => window.__visualSmokeStreams.at(-1));
    assert.equal(captured.error, undefined);
    const streamText = captured.text;
    const streamEvents = streamText.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    const complete = streamEvents.find(event => event.type === 'complete');
    assert.ok(complete, 'real model must finish through the existing Assistant stream');
    const answer = streamEvents.filter(event => event.type === 'delta').map(event => event.content).join('');
    assert.ok(answer.trim().length > 20, 'model should explain the actual crop');
    await writeFile(path.join(directory, 'answer.txt'), answer, 'utf8');
    current.answerFile = path.join(directory, 'answer.txt');
    current.provider = provider;
    current.modelEvents = (await events()).slice(auditOffset);
    const requestEvent = current.modelEvents.find(event => event.event === 'request');
    assert.ok(requestEvent && requestEvent.image_count === 1 && requestEvent.stream);
    assert.equal(requestEvent.images[0].sha256, imageFacts(finalPreview).sha256);
    assert.equal(await calls(), initialCalls + 1);
    current.modelCompleted = true;
    await save();
    await page.locator('#assistant-turns .assistant-answer-bubble:not(.assistant-answer-streaming)').last().waitFor();
    await page.locator('#assistant-turns').evaluate(element => {element.scrollTop = 0;});
    await screenshot('answer-900');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.waitForTimeout(350);
    await page.locator('#assistant-turns').evaluate(element => {element.scrollTop = 0;});
    await screenshot('answer-1440');
    await closePanel();
    await page.locator('#visual-select-toggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#visual-select-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await calls(), initialCalls + 1);
    current.checks.push('One real multimodal streaming answer; preview and sent PNG hashes agree; Escape cancels without model calls');
    current.status = 'PASS';
    await save();
    console.log(JSON.stringify({sample: current.name, status: current.status, provider}));
  }
  assert.deepEqual(errors, []);
  report.status = 'PASS';
  await save();
} catch (error) {
  report.status = 'FAIL'; report.error = error.message;
  await save();
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'server.log'), stderr.replace(/token=[^\s&"']+/g, 'token=[redacted]'));
  await browser?.close();
  if (server?.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill(); await stopped;
  }
}
