import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-kp-overlay-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive:true});
const sql = (code, args = []) => {
  const result = spawnSync('python', ['-c', code, ...args], {windowsHide:true, encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
sql('import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  [path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')]);
const db = path.join(dataDir, 'state.sqlite3');
const durableCounts = () => JSON.parse(sql(`import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1])
print(json.dumps({t:c.execute('select count(*) from '+t).fetchone()[0] for t in ('master_threads','master_topics','master_messages')}))`, [db]));

let server;
let browser;
const stop = async () => {
  if (server?.exitCode === null) {
    const done = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await done;
  }
};
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide:true,
    stdio:['ignore','pipe','pipe'],
    env:{...process.env, GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1'},
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'server start timed out')), 30000);
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once('exit', () => { clearTimeout(timer); reject(new Error(stderr || 'server exited')); });
  });

  browser = await chromium.launch({
    executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless:true,
  });
  const page = await browser.newPage({viewport:{width:1600,height:1000}, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const card = page.locator('.book-card').filter({hasText:'348 个 PDF 页面'});
  await card.getByRole('button', {name:'打开', exact:true}).click();
  await page.locator('.overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor();

  const fixture = await page.evaluate(async () => {
    const books = (await (await fetch('/api/books')).json()).books;
    const revision = books.find(book => book.active_revision?.page_count === 348).active_revision.id;
    const entries = await (await fetch(`/api/revisions/${revision}/learning`)).json();
    return {
      revision,
      first:entries.points.find(point => point.status === 'UNCONFIRMED' && !point.thread_id),
      existing:entries.points.find(point => point.thread_id),
    };
  });
  assert.ok(fixture.first, 'real Library needs one unconfirmed KP without a Master thread');
  assert.ok(fixture.existing, 'real Library needs one KP with an existing Master thread');

  const showMarker = async point => {
    await page.locator('#page-number').fill(String(point.display_end_page + 1));
    await page.locator('#page-number').press('Enter');
    const rendered = page.locator(`.page[data-index="${point.display_end_page}"] canvas`);
    await rendered.waitFor();
    await page.waitForTimeout(900);
    const marker = page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`)
      .filter({hasText:point.title}).first();
    await marker.locator('summary').click();
    await marker.locator('.learning-marker-content').waitFor();
    return marker;
  };

  const firstMarker = await showMarker(fixture.first);
  assert.deepEqual(await firstMarker.getByRole('button').allTextContents(), ['这里没完全懂', '我已清楚']);
  const peerStyles = await firstMarker.getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return {background:style.backgroundColor, color:style.color, border:style.border};
  }));
  assert.deepEqual(peerStyles[0], peerStyles[1]);
  await mkdir('test-results', {recursive:true});
  await page.screenshot({path:'test-results/kp-first-pass.png'});

  const beforeCounts = durableCounts();
  if (!await firstMarker.evaluate(marker => marker.open)) await firstMarker.locator('summary').click();
  await Promise.all([
    page.waitForRequest(request => request.url().includes(`/learning/${fixture.first.knowledge_point_id}/understand`)),
    firstMarker.getByRole('button', {name:'我已清楚', exact:true}).click(),
  ]);
  await page.waitForFunction(id => {
    const markers = [...document.querySelectorAll('.kp-learning-marker')];
    return markers.some(marker => marker.textContent.includes('已弄懂') && marker.textContent.includes(id));
  }, fixture.first.title);
  assert.deepEqual(durableCounts(), beforeCounts, 'explicit KP confirmation must not create Master durable state');
  const confirmed = await page.evaluate(async ({revision, id}) =>
    (await (await fetch(`/api/revisions/${revision}/learning/${id}`)).json()),
    {revision:fixture.revision, id:fixture.first.knowledge_point_id});
  assert.equal(confirmed.status, 'UNDERSTOOD');
  assert.equal(confirmed.thread_id, null);
  await page.locator('#status:not(.visible)').waitFor();

  const existingMarker = await showMarker(fixture.existing);
  assert.deepEqual(await existingMarker.getByRole('button').allTextContents(), ['这里没完全懂', '继续 Master 对话']);
  assert.equal(await existingMarker.getByRole('button', {name:'我已清楚'}).count(), 0);
  await page.screenshot({path:'test-results/kp-existing-master.png'});

  await existingMarker.locator('summary').click();
  const canvas = page.locator(`.page[data-index="${fixture.existing.display_end_page}"] canvas`);
  const geometry = async () => page.evaluate(index => {
    const canvas = document.querySelector(`.page[data-index="${index}"] canvas`);
    const viewer = document.querySelector('#viewer');
    const rect = canvas.getBoundingClientRect();
    return {pixelWidth:canvas.width,pixelHeight:canvas.height,cssWidth:rect.width,cssHeight:rect.height,viewerWidth:viewer.clientWidth};
  }, fixture.existing.display_end_page);
  const before = await geometry();
  const kpEntry = page.locator('#reader-kp-action');
  await kpEntry.filter({hasText:'个知识点'}).waitFor();
  await kpEntry.click();
  const drawer = page.locator('#reader-kp-list');
  await drawer.locator('.reader-kp-row').first().waitFor();
  assert.deepEqual(await geometry(), before, 'opening KP navigation must not relayout the PDF canvas');
  const drawerBox = await drawer.boundingBox();
  const canvasBox = await canvas.boundingBox();
  assert.ok(drawerBox.width <= 301, JSON.stringify(drawerBox));
  assert.ok(drawerBox.x >= canvasBox.x + canvasBox.width,
    `KP navigation ${JSON.stringify(drawerBox)} overlaps PDF ${JSON.stringify(canvasBox)}`);
  assert.ok(drawerBox.x + drawerBox.width <= 1587, JSON.stringify(drawerBox));
  assert.equal(await page.locator('#outline-panel').isVisible(), false);
  await page.screenshot({path:'test-results/kp-reader-drawer.png'});
  await page.locator('#outline-toggle').click();
  assert.equal(await drawer.isVisible(), false);
  assert.equal(await page.locator('#outline-panel').isVisible(), true);
  assert.deepEqual(await geometry(), before, 'switching temporary navigation must not relayout the PDF canvas');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({status:'PASS',realPages:348,first:fixture.first.title,existing:fixture.existing.title,
    pdfGeometryStable:true,masterCountsUnchanged:true,screenshots:['test-results/kp-first-pass.png','test-results/kp-existing-master.png','test-results/kp-reader-drawer.png']}));
} finally {
  if (browser) await browser.close();
  await stop();
}
