import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-directory-target-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const backup = spawnSync('python', ['-c',
  'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {encoding: 'utf8', windowsHide: true});
assert.equal(backup.status, 0, backup.stderr);

let server, browser;
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1'},
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
    executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const page = await browser.newPage({viewport: {width: 1920, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);

  async function openBook(pageCount) {
    if (await page.locator('#reader').isVisible()) await page.locator('#back-to-library').click();
    await page.locator('.book-card').filter({hasText: `${pageCount} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('.page canvas').first().waitFor({timeout: 30000});
    const nodes = await page.evaluate(async pages => {
      const books = (await (await fetch('/api/books')).json()).books;
      const revision = books.find(book => book.active_revision?.page_count === pages).active_revision.id;
      let payload = await (await fetch(`/api/revisions/${revision}/outline?stored=1`)).json();
      if (!payload.evidence_source) payload = await (await fetch(`/api/revisions/${revision}/outline`)).json();
      return payload.nodes;
    }, pageCount);
    await page.locator('#outline-toggle').click();
    await page.locator('#outline-tree .outline-target').first().waitFor();
    return nodes;
  }

  async function clickNode(node, nodes) {
    const ancestors = [];
    for (let parent = nodes.find(item => item.outline_node_id === node.parent_id); parent;
      parent = nodes.find(item => item.outline_node_id === parent.parent_id)) ancestors.unshift(parent);
    for (const parent of ancestors) {
      const list = page.locator(`li[data-node-id="${parent.outline_node_id}"] > ul`);
      if (await list.count() && !(await list.isVisible())) {
        await page.locator(`li[data-node-id="${parent.outline_node_id}"] > .outline-row .outline-fold`).click();
      }
    }
    await page.locator(`li[data-node-id="${node.outline_node_id}"] > .outline-row .outline-target`).click();
    const immediate = await page.locator('#outline-tree .outline-target[aria-current="true"]')
      .evaluateAll(items => items.map(item => item.closest('li').dataset.nodeId));
    assert.deepEqual(immediate, [node.outline_node_id], `clicked ${node.title} must become current immediately`);
    await page.waitForTimeout(500);
    if (!(await page.locator('#outline-panel').isVisible())) {
      await page.locator('#outline-toggle').click();
      await page.waitForTimeout(150);
    }
    const actual = await page.locator('#outline-tree .outline-target[aria-current="true"]')
      .evaluateAll(items => items.map(item => item.closest('li').dataset.nodeId));
    const position = await page.evaluate(index => {
      const viewer = document.querySelector('#viewer');
      const item = document.querySelector(`.page[data-index="${index}"]`);
      const y = (viewer.scrollTop - item.offsetTop) / item.offsetHeight;
      return {page: document.querySelector('#page-number').value, y, scrollTop: viewer.scrollTop};
    }, node.start_page);
    const siblings = nodes.filter(item => item.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const previous = siblings[siblings.findIndex(item => item.outline_node_id === node.outline_node_id) - 1];
    const expectedY = Number.isFinite(node.start_y) ? node.start_y
      : previous?.end_page === node.start_page && Number.isFinite(previous.end_y) ? previous.end_y : 0;
    assert.ok(Math.abs(position.y - expectedY) < 0.004,
      `clicked ${node.title} must land on its projected PDF position: ${JSON.stringify({position, expectedY})}`);
    assert.deepEqual(actual, [node.outline_node_id], `clicked ${node.title} must remain current`);
  }

  const coa = await openBook(348);
  while (Number.parseInt(await page.locator('#zoom-value').textContent(), 10) > 100) await page.locator('#zoom-out').click();
  while (Number.parseInt(await page.locator('#zoom-value').textContent(), 10) < 100) await page.locator('#zoom-in').click();
  await page.setViewportSize({width: 1440, height: 1000});
  await page.waitForTimeout(350);
  const directoryGeometry = await page.evaluate(() => {
    const pane = document.querySelector('#outline-panel');
    const viewer = document.querySelector('#viewer');
    return {paneWidth: pane.getBoundingClientRect().width,
      paneRight: pane.getBoundingClientRect().right,
      viewerLeft: viewer.getBoundingClientRect().left,
      paneBorder: getComputedStyle(pane).borderRightWidth,
      paneBackground: getComputedStyle(pane).backgroundColor,
      viewerBackground: getComputedStyle(viewer).backgroundColor};
  });
  assert.equal(await page.locator('#outline-panel .left-resize-handle').count(), 0);
  assert.equal(directoryGeometry.paneWidth, 304);
  assert.equal(directoryGeometry.paneBorder, '0px');
  assert.equal(directoryGeometry.paneBackground, directoryGeometry.viewerBackground);
  assert.ok(Math.abs(directoryGeometry.paneRight - directoryGeometry.viewerLeft) < 1,
    `Directory must meet PDF stage without gutter: ${JSON.stringify(directoryGeometry)}`);
  await page.screenshot({path: 'test-results/directory-fixed-split.png'});
  for (const zoomSteps of [0, 2, 1]) {
    for (let step = 0; step < zoomSteps; step += 1) await page.locator('#zoom-in').click();
    for (const prefix of ['5.4.2 ', '5.4.1 ', '5.4.3 ', '2.2.2 ', '6.2.2 ']) {
      const node = coa.find(item => item.kind === 'SUBSECTION' && item.title.startsWith(prefix));
      if (node) {
        await clickNode(node, coa);
        if (prefix === '5.4.2 ' && zoomSteps === 0) {
          await page.screenshot({path: 'test-results/directory-5.4.2.png'});
          await page.locator('#viewer').click({position: {x: 700, y: 500}});
          for (const [y, expectedPrefix] of [[0.5, '5.4.2 '], [0.9, '5.4.3 '], [0.2, '5.4.1 ']]) {
            await page.evaluate(({index, y}) => {
              const target = document.querySelector(`.page[data-index="${index}"]`);
              document.querySelector('#viewer').scrollTop = target.offsetTop + target.offsetHeight * y;
            }, {index: node.start_page, y});
            await page.waitForTimeout(180);
            const expected = coa.find(item => item.kind === 'SUBSECTION' && item.title.startsWith(expectedPrefix));
            const current = await page.locator('#outline-tree .outline-target[aria-current="true"]')
              .evaluateAll(items => items.map(item => item.closest('li').dataset.nodeId));
            assert.deepEqual(current, [expected.outline_node_id], `scrolling to ${expectedPrefix} must update current item`);
          }
        }
      }
    }
  }
  if (await page.locator('#outline-panel').isVisible()) await page.locator('#outline-close').click();
  await page.locator('#page-number').fill('20');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="19"] .practice-entry').waitFor({timeout: 30000});
  await page.locator('.page[data-index="19"] .practice-entry').click();
  const practiceBefore = (await page.locator('#practice-panel').boundingBox()).width;
  const handle = await page.locator('#practice-panel .left-resize-handle').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 180);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + 180, {steps: 5});
  await page.mouse.up();
  const practiceAfter = (await page.locator('#practice-panel').boundingBox()).width;
  assert.ok(practiceAfter > practiceBefore + 20, `Practice Rail resize must remain available: ${practiceBefore} → ${practiceAfter}`);
  await page.locator('#practice-close').click();
  await page.locator('#outline-toggle').click();
  assert.equal((await page.locator('#outline-panel').boundingBox()).width, 304,
    'Directory must stay fixed after Practice Rail was resized');
  const ds = await openBook(412);
  for (const prefix of ['5.4.1 ', '5.4.2 ', '5.4.3 ', '3.2.2 ', '6.2.2 ']) {
    const node = ds.find(item => item.kind === 'SUBSECTION' && item.title.startsWith(prefix));
    if (node) await clickNode(node, ds);
  }
  assert.deepEqual(errors, []);
  console.log('Directory current-target PASS');
} finally {
  if (browser) await browser.close();
  if (server?.exitCode === null) {
    const done = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await done;
  }
}
