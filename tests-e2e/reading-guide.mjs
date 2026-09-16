import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const root = await mkdtemp(path.join(os.tmpdir(), "guided-reader-guide-"));
const dataDir = path.join(root, "data");
console.log('Disposable guide Library:', dataDir);
await mkdir(dataDir);
await cp(path.join(source, "blobs"), path.join(dataDir, "blobs"), { recursive: true });
// The disposable copy must not resume unrelated live-library work against the test provider.
const backup = spawnSync("python", ["-c", "import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.execute(\"UPDATE jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING')\"); target.commit(); target.close(); source.close()", path.join(source, "state.sqlite3"), path.join(dataDir, "state.sqlite3")], { windowsHide: true, encoding: "utf8" });
assert.equal(backup.status, 0, backup.stderr);

let running;
let browser, fail = false;
const live = process.env.GUIDE_E2E_REAL === "1";
const guideUiFlowOnly = process.env.GUIDE_UI_FLOW_ONLY === "1";
const payloads = [];
const provider = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  let payload;
  try { payload = JSON.parse(body.messages[1].content); } catch { payload = null; }
  if (payload) payloads.push(payload);
  if (fail) { res.writeHead(401); res.end('{}'); return; }
  let answer = '所选导读建议先辨认概念，再结合教材比较条件，这是阅读方法而非教材引文。';
  if (payload?.candidate) answer = JSON.stringify({ verdict: 'PASS', issues: [] });
  else if (payload?.source?.evidence) {
    const refs = [payload.source.evidence[0].source_id];
    answer = JSON.stringify({ modules: [
      { id: 'm1', kind: 'article', title: '阅读导读', text: payload.draft, source_ids: refs }] });
  }
  await new Promise(r => setTimeout(r, payload?.candidate ? 650 : 180));
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (!payload) {
    for (const thought of ['先辨认本节位置。', '再组织知识之间的关系。']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thought } }] })}\n\n`);
      await new Promise(r => setTimeout(r, 45));
    }
  }
  const chunkSize = Math.max(1, Math.ceil(answer.length / 4));
  for (let offset = 0; offset < answer.length; offset += chunkSize) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(offset, offset + chunkSize) } }] })}\n\n`);
    await new Promise(r => setTimeout(r, 45));
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: answer.length } })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(r => provider.listen(0, '127.0.0.1', r));
const loopback = {
  GUIDED_READER_SYSTEM_PROVIDER: 'deepseek', GUIDED_READER_REVIEW_PROVIDER: 'zhipu',
  GUIDED_READER_DEEPSEEK_API_KEY: 'test-loopback-key', GUIDED_READER_ZHIPU_API_KEY: 'test-loopback-key',
  GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  GUIDED_READER_ZHIPU_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
};
try {
  running = await start(live ? {} : loopback);
  browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(running.url);
  const books = (await get(page, '/api/books')).books;
  const book = books.find(b => b.active_revision.page_count === 348);
  assert.equal(book.active_revision.blob_sha256, '6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd');
  const rev = book.active_revision.id;
  const outline = await get(page, `/api/revisions/${rev}/outline`);
  const ready = outline.nodes.find(n => n.kind === 'SECTION' && n.title.includes('1.1'));
  const noKp = outline.nodes.find(n => n.kind === 'SECTION' && n.title.startsWith('6.1'));
  assert.ok(ready && noKp);
  const base = section => `/api/revisions/${rev}/sections/${section.outline_node_id}/guide`;
  await openBook(page);
  await openGuide(page, ready);
  assert.equal(await page.locator('#guide-primary-action').isVisible(), true);
  assert.equal(await page.locator('#guide-primary-action').textContent(), '生成本节导读');
  assert.equal(await page.locator('#guide-regenerate').isVisible(), false);
  assert.equal(await page.locator('#guide-more,#guide-expand').count(), 0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/reading-guide-not-generated.png', fullPage: true });
  await page.evaluate(() => {
    window.__guideStages = [];
    window.__guideReasoningSeen = false;
    const record = () => {
      const value = [document.querySelector('#guide-status')?.textContent?.trim(), document.querySelector('#guide-draft-label')?.textContent?.trim()].filter(Boolean).join(' | ');
      if (value && window.__guideStages.at(-1) !== value) window.__guideStages.push(value);
      if (document.querySelector('#guide-reasoning-text')?.textContent?.includes('先辨认本节位置')) window.__guideReasoningSeen = true;
    };
    window.__guideStageObserver = new MutationObserver(record);
    window.__guideStageObserver.observe(document.querySelector('#guide-panel'), { subtree: true, childList: true, characterData: true });
    record();
  });
  await action(page, '生成本节导读', 'generate');
  let first = await settled(page, base(ready));
  const observed = await page.evaluate(() => { window.__guideStageObserver.disconnect(); return { stages: window.__guideStages, reasoningSeen: window.__guideReasoningSeen }; });
  const stages = observed.stages;
  assert.ok(stages.some(value => value.includes('准备')), JSON.stringify(stages));
  assert.ok(stages.some(value => value.includes('正在思考')), JSON.stringify(stages));
  assert.ok(stages.some(value => value.includes('正文持续生成')), JSON.stringify(stages));
  assert.ok(stages.some(value => value.includes('生成草稿 · 审查中')), JSON.stringify(stages));
  assert.equal(observed.reasoningSeen, true);
  assert.ok(first.published, JSON.stringify(first.task));
  await page.locator('.guide-text').first().waitFor();
  assert.equal(await page.locator('#guide-regenerate').isVisible(), true);
  assert.equal(await page.locator('#guide-more,#guide-expand').count(), 0);
  const sources = page.locator('.guide-source:not([disabled])');
  const sourceCount = await sources.count(); assert.ok(sourceCount);
  assert.deepEqual(await sources.allTextContents(), Array(sourceCount).fill('查看教材位置'));
  assert.equal(await page.locator('.guide-references').filter({ hasText: /\[\d+\]/ }).count(), 0);
  const ordered = first.published.content.modules.map(m => first.published.sources[m.source_ids.find(id => first.published.sources[id]?.available) || m.source_ids[0]]);
  for (let i = 0; i < sourceCount; i++) {
    await sources.nth(i).click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator('#guide-panel').isVisible());
    const position = await page.evaluate(source => {
      const viewer = document.getElementById('viewer');
      const target = document.querySelector(`.page[data-index="${source.pdf_page_index}"]`);
      return target.offsetTop + target.offsetHeight * source.y - viewer.scrollTop;
    }, ordered[i]);
    assert.ok(Math.abs(position) < 10, `Source geometry mismatch: ${position}`);
    await openGuide(page, ready);
  }
  // Guide prose uses the Reader selection treatment and exposes only Copy / Ask AI.
  const text = page.locator('.guide-text').first();
  const rect = await text.boundingBox();
  await page.mouse.move(rect.x + 3, rect.y + 13); await page.mouse.down();
  await page.mouse.move(rect.x + 180, rect.y + 13, { steps: 15 }); await page.mouse.up();
  await page.mouse.click(rect.x + 60, rect.y + 13, { button: 'right' });
  assert.deepEqual(await page.locator('#selection-actions .selection-action-row button:visible').allTextContents(), ['复制', '问 AI']);
  assert.equal(await text.evaluate(element => getComputedStyle(element, '::selection').backgroundColor), 'rgba(65, 126, 211, 0.2)');
  await page.screenshot({ path: 'test-results/reading-guide-selection-actions.png', fullPage: true });
  if (!guideUiFlowOnly) {
    await page.locator('#selection-actions #ask-selection').click();
    await page.locator('#assistant-draft-text').waitFor();
    await page.locator('#assistant-start').click();
    await page.locator('#assistant-turns .assistant-answer-bubble').first().waitFor({ timeout: 180000 });
    await page.locator('#assistant-close').click();
    await openGuide(page, ready);
  } else await page.keyboard.press('Escape');
  await page.locator('#guide-close').click();
  await page.locator('#next-page').click();
  await page.locator('#back-to-library').click();
  await stop(); running = await start(loopback);
  await page.goto(running.url); await openBook(page); await openGuide(page, ready);
  assert.equal((await get(page, base(ready))).published.id, first.published.id);
  fail = true;
  await action(page, '重新生成', 'regenerate');
  assert.equal((await get(page, base(ready))).published.id, first.published.id);
  const failed = await settled(page, base(ready));
  assert.equal(failed.task.state, 'FAILED'); assert.equal(failed.published.id, first.published.id);
  assert.equal(await page.locator('.guide-text').count(), first.published.content.modules.length);
  await page.locator('#guide-status-retry').waitFor({ state: 'visible' });
  fail = false;
  await stop(); running = await start(loopback); // Clear provider cooldown through an actual service restart.
  await page.goto(running.url); await openBook(page); await openGuide(page, ready);
  await action(page, '重试', 'retry');
  const replacement = await settled(page, base(ready));
  assert.equal(replacement.published.version, 2);
  await page.locator('#guide-close').click();
  if (live) { await stop(); running = await start({}); await page.goto(running.url); await openBook(page); }
  await openGuide(page, noKp);
  if (!live) {
    fail = true;
    await action(page, '生成本节导读', 'generate');
    const firstFailure = await settled(page, base(noKp));
    assert.equal(firstFailure.task.state, 'FAILED'); assert.equal(firstFailure.published, null);
    await page.locator('#guide-primary-action').filter({ hasText: '重试生成' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#guide-primary-action')?.disabled);
    assert.equal(await page.locator('#guide-primary-action').isEnabled(), true);
    const retryStyle = await page.locator('#guide-primary-action').evaluate(element => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, color: style.color, opacity: style.opacity };
    });
    assert.deepEqual(retryStyle, { backgroundColor: 'rgb(37, 73, 54)', color: 'rgb(255, 255, 255)', opacity: '1' });
    assert.equal(await page.locator('#guide-regenerate').isVisible(), false);
    await page.screenshot({ path: 'test-results/reading-guide-failed-retry.png', fullPage: true });
    fail = false;
    await stop(); running = await start(loopback);
    await page.goto(running.url); await openBook(page); await openGuide(page, noKp);
    await action(page, '重试生成', 'retry');
  } else await action(page, '生成本节导读', 'generate');
  const independent = await settled(page, base(noKp));
  assert.ok(independent.published, JSON.stringify(independent.task));
  await page.locator('.guide-text').first().waitFor();
  const inspect = await get(page, '/api/assistant/inspection');
  await page.screenshot({ path: 'test-results/reading-guide.png', fullPage: true });
  const check = spawnSync('python', ['tests-e2e/guide_verify.py', dataDir, ready.outline_node_id, noKp.outline_node_id], { windowsHide: true, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', live, pages: 348, first: first.published.id, replacement: replacement.published.id, nonKp: independent.published.id, dataDir, payloadCount: payloads.length, inspectionKeys: Object.keys(inspect) }));
} finally {
  if (browser) await browser.close();
  await stop(); await new Promise(r => provider.close(r));
}
async function get(page, url) { return page.evaluate(async url => { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }, url); }
async function openBook(page) {
  await page.locator('.book-card').filter({ hasText: '348 个 PDF 页面' }).locator('.book-open').click();
  const resume = page.locator('#book-overview .overview-book-heading .primary-action');
  if (await resume.isVisible()) await resume.click();
  await page.locator('.page canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
}
async function openGuide(page, section) {
  if (!(await page.locator('#outline-panel').isVisible())) await page.locator('#outline-toggle').click();
  const row = page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
  if (!(await row.isVisible())) await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
  await row.locator('.outline-target').click();
  await page.locator('#outline-toggle').click();
  await page.locator(`.section-guide-entry[data-section-id="${section.outline_node_id}"]`).click();
  await page.locator('#guide-title').filter({ hasText: section.title }).waitFor();
}
async function settled(page, url) {
  for (let i = 0; i < 1200; i++) {
    const result = await get(page, url);
    if (['PUBLISHED', 'FAILED'].includes(result.task?.state)) return result;
    await page.waitForTimeout(500);
  }
  throw new Error('Guide did not settle');
}
async function start(extra) {
  const child = spawn("python", ["tests-e2e/guide_runner.py", "--no-open", "--port", "0", "--data-dir", dataDir], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extra },
  });
  let output = "", errors = "";
  child.stderr.on("data", (v) => { errors += v; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(output + errors)), 30_000);
    child.stdout.on("data", (v) => { output += v; const match = output.match(/READY (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.on("exit", () => { clearTimeout(timeout); reject(new Error(errors || output)); });
  });
  return { child, url };
}
async function stop() {
  if (!running || running.child.exitCode !== null) return;
  const child = running.child;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function action(page, name, operation) {
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/guide/' + operation) && r.request().method() === 'POST'), page.getByRole('button', { name, exact: true }).click()]);
}
