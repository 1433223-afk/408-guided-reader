import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const backup = spawnSync('python', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
assert.equal(backup.status, 0, backup.stderr);

let server, browser;
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1'},
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(stderr || 'server start timeout')), 30000);
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once('exit', () => { clearTimeout(timer); reject(new Error(stderr || 'server exited')); });
  });
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#page-number').fill('20');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="19"] canvas').waitFor({timeout: 30000});
  const initialZoom = await page.locator('#zoom-value').innerText();
  await page.locator('.page[data-index="19"] .practice-entry').click();
  assert.equal(await page.locator('#practice-panel').isVisible(), true);
  assert.equal(await page.locator('#practice-next').isVisible(), true);
  assert.equal(await page.locator('#practice-hint-button').isVisible(), true);
  const initialAttempts = Number((await page.locator('#practice-attempts').innerText()).match(/(\d+) 次/)?.[1] || 0);
  const initialFavorite = await page.locator('#practice-favorite').getAttribute('aria-pressed');
  const expectedFavorite = initialFavorite === 'true' ? 'false' : 'true';
  await page.locator('#practice-favorite').click();
  await page.waitForFunction(expected => document.querySelector('#practice-favorite')?.getAttribute('aria-pressed') === expected, expectedFavorite);
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), expectedFavorite);
  const choice = async letter => {
    const box = await page.locator(`.page[data-index="19"] .practice-choice-area[data-choice="${letter}"]`).boundingBox();
    assert.ok(box, `missing ${letter} option geometry`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await choice('A');
  assert.match(await page.locator('#practice-status').innerText(), /已选 A/);
  await choice('A');
  await page.locator('#practice-status').filter({hasText: '不正确'}).waitFor();
  assert.ok(!(await page.locator('#practice-panel').innerText()).includes('正确答案是'));
  await page.locator('#practice-review').click();
  await page.locator('#master-workspace').waitFor();
  await page.locator('#master-title').filter({hasText: /第 1 题/}).waitFor();
  if (Number.parseInt(initialZoom, 10) > 100) assert.equal(await page.locator('#zoom-value').innerText(), '100%');
  assert.match(await page.locator('#master-title').innerText(), /第 1 题/);
  assert.equal(await page.locator('#practice-review-targets').isVisible(), true);
  if (process.env.PRACTICE_REVIEW_LIVE === '1') {
    await page.locator('[data-review-target="A"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 1
      && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});
    await page.locator('[data-review-target="B"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 2
      && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});
    await page.locator('#master-question').fill('为什么 A 只列出部分组成？');
    await page.locator('#master-send').click();
    await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 3
      && !document.querySelector('#master-history [data-master-stream]'), undefined, {timeout: 120000});
    const thread = await page.locator('#master-history').innerText();
    assert.match(thread, /A 选项/);
    assert.match(thread, /B 选项/);
  }
  await mkdir('test-results', {recursive: true});
  await page.screenshot({path: 'test-results/practice-prototype-review.png'});
  await page.locator('#practice-retry').click();
  await choice('D');
  await choice('D');
  await page.locator('#practice-status').filter({hasText: '正确'}).waitFor();
  assert.match(await page.locator('#practice-attempts').innerText(), new RegExp(`${initialAttempts + 2} 次`));
  await page.locator('#practice-answer').click();
  await page.waitForFunction(() => {
    const paper = document.querySelector('.page[data-index="21"]')?.getBoundingClientRect();
    const viewer = document.querySelector('#viewer')?.getBoundingClientRect();
    return paper && viewer && paper.bottom > viewer.top && paper.top < viewer.bottom;
  });
  await page.locator('#practice-back').click();
  await page.waitForFunction(() => {
    const paper = document.querySelector('.page[data-index="19"]')?.getBoundingClientRect();
    const viewer = document.querySelector('#viewer')?.getBoundingClientRect();
    return paper && viewer && paper.bottom > viewer.top && paper.top < viewer.bottom;
  });
  await page.locator('#practice-next').click();
  assert.equal(await page.locator('#practice-number').innerText(), '02');
  await choice('A');
  await page.locator('#viewer').press('Enter');
  await page.locator('#practice-status').filter({hasText: '正确'}).waitFor();
  await page.locator('#outline-toggle').click();
  assert.equal(await page.locator('#outline-panel').isVisible(), true);
  await page.locator('#outline-close').click();
  assert.equal(await page.locator('#practice-panel').isVisible(), true);
  const layout = await page.evaluate(() => ({
    visible: getComputedStyle(document.querySelector('#viewer')).visibility,
    width: document.querySelector('#viewer').getBoundingClientRect().width,
    left: document.querySelector('#practice-panel').getBoundingClientRect().width,
    leftEdge: document.querySelector('#practice-panel').getBoundingClientRect().right,
    centerStart: document.querySelector('#viewer').getBoundingClientRect().left,
  }));
  assert.equal(layout.visible, 'visible');
  assert.ok(layout.width > 300 && layout.left >= 210, JSON.stringify(layout));
  assert.ok(layout.leftEdge <= layout.centerStart + 1, JSON.stringify(layout));
  const handle = await page.locator('#practice-panel .left-resize-handle').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 240);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 48, handle.y + 240, {steps: 6});
  await page.mouse.up();
  const resizedLeft = await page.locator('#practice-panel').evaluate(node => node.getBoundingClientRect().width);
  assert.ok(resizedLeft < layout.left - 30, `left resize did not move: ${layout.left} → ${resizedLeft}`);
  await page.locator('#practice-panel .left-resize-handle').press('ArrowRight');
  // Text selection on the question body must still expose the normal Assistant action.
  const overlay = page.locator('.page[data-index="19"] .text-overlay');
  await overlay.waitFor({timeout: 10000});
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + box.width * .20, box.y + box.height * .75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .40, box.y + box.height * .75, {steps: 8});
  await page.mouse.up();
  await page.mouse.click(box.x + box.width * .30, box.y + box.height * .75, {button: 'right'});
  assert.equal(await page.locator('#ask-selection').isVisible(), true);
  await page.locator('#ask-selection').click();
  assert.equal(await page.locator('#assistant-panel').isVisible(), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#viewer')).visibility), 'visible');
  const threeColumns = await page.evaluate(() => ({
    leftEnd: document.querySelector('#practice-panel').getBoundingClientRect().right,
    viewerStart: document.querySelector('#viewer').getBoundingClientRect().left,
    viewerEnd: document.querySelector('#viewer').getBoundingClientRect().right,
    rightStart: document.querySelector('#assistant-panel').getBoundingClientRect().left,
  }));
  assert.ok(threeColumns.leftEnd <= threeColumns.viewerStart + 1
    && threeColumns.viewerEnd <= threeColumns.rightStart + 1, JSON.stringify(threeColumns));
  const rightHandle = await page.locator('#assistant-resize-handle').boundingBox();
  await page.mouse.move(rightHandle.x + rightHandle.width / 2, rightHandle.y + 280);
  await page.mouse.down();
  await page.mouse.move(rightHandle.x + rightHandle.width / 2 - 800, rightHandle.y + 280, {steps: 12});
  await page.mouse.up();
  const stretched = await page.evaluate(() => ({
    center: document.querySelector('#viewer').getBoundingClientRect().width,
    right: document.querySelector('#assistant-panel').getBoundingClientRect().width,
    centerEnd: document.querySelector('#viewer').getBoundingClientRect().right,
    rightStart: document.querySelector('#assistant-panel').getBoundingClientRect().left,
  }));
  assert.ok(stretched.center >= 599 && stretched.right <= 441
    && stretched.centerEnd <= stretched.rightStart + 1, JSON.stringify(stretched));
  await page.locator('#assistant-resize-handle').press('Home');
  const leftLimitHandle = await page.locator('#practice-panel .left-resize-handle').boundingBox();
  await page.mouse.move(leftLimitHandle.x + leftLimitHandle.width / 2, leftLimitHandle.y + 280);
  await page.mouse.down();
  await page.mouse.move(leftLimitHandle.x + leftLimitHandle.width / 2 + 800, leftLimitHandle.y + 280, {steps: 12});
  await page.mouse.up();
  const leftStretched = await page.evaluate(() => ({
    left: document.querySelector('#practice-panel').getBoundingClientRect().width,
    center: document.querySelector('#viewer').getBoundingClientRect().width,
    leftEnd: document.querySelector('#practice-panel').getBoundingClientRect().right,
    centerStart: document.querySelector('#viewer').getBoundingClientRect().left,
  }));
  assert.ok(leftStretched.left <= 440 && leftStretched.center >= 599
    && leftStretched.leftEnd <= leftStretched.centerStart + 1, JSON.stringify(leftStretched));
  await mkdir('test-results', {recursive: true});
  await page.screenshot({path: 'test-results/practice-prototype-1440.png'});
  await page.setViewportSize({width: 1024, height: 900});
  await page.locator('.page[data-index="19"] canvas').waitFor({timeout: 30000});
  await page.waitForTimeout(500);
  const narrow = await page.evaluate(() => ({
    visibility: getComputedStyle(document.querySelector('#viewer')).visibility,
    width: document.querySelector('#viewer').getBoundingClientRect().width,
    canvas: !!document.querySelector('.page[data-index="19"] canvas'),
    pageWidth: document.querySelector('.page[data-index="19"]').getBoundingClientRect().width,
    scrollWidth: document.querySelector('#viewer').scrollWidth,
    centerEnd: document.querySelector('#viewer').getBoundingClientRect().right,
    rightEdge: document.querySelector('#assistant-panel').getBoundingClientRect().left,
  }));
  assert.equal(narrow.visibility, 'visible');
  assert.ok(narrow.width >= 460 && narrow.canvas && narrow.pageWidth <= narrow.width - 20
    && narrow.scrollWidth >= narrow.pageWidth
    && narrow.centerEnd <= narrow.rightEdge + 1, JSON.stringify(narrow));
  await page.screenshot({path: 'test-results/practice-prototype-1024.png'});
  const savedProgress = await page.locator('#practice-progress').innerText();
  await page.setViewportSize({width: 800, height: 900});
  await page.waitForTimeout(500);
  const compact = await page.evaluate(() => ({
    visibility: getComputedStyle(document.querySelector('#viewer')).visibility,
    center: document.querySelector('#viewer').getBoundingClientRect().width,
    centerEnd: document.querySelector('#viewer').getBoundingClientRect().right,
    rightStart: document.querySelector('#assistant-panel').getBoundingClientRect().left,
    overlay: document.querySelector('#assistant-panel').classList.contains('assistant-overlay-open'),
  }));
  assert.ok(compact.visibility === 'visible' && compact.center >= 360
    && !compact.overlay && compact.centerEnd <= compact.rightStart + 1, JSON.stringify(compact));
  await page.screenshot({path: 'test-results/practice-prototype-800.png'});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.locator('#back-to-library').click();
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#page-number').fill('20');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="19"] .practice-entry').waitFor({timeout: 30000});
  assert.equal(await page.locator('#zoom-value').innerText(), initialZoom);
  await page.locator('.page[data-index="19"] .practice-question-mark').first().waitFor();
  await page.locator('.page[data-index="19"] .practice-entry').click();
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'), expectedFavorite);
  assert.match(await page.locator('#practice-attempts').innerText(), new RegExp(`${initialAttempts + 2} 次`));
  assert.equal(await page.locator('#practice-progress').innerText(), savedProgress);
  if (process.env.PRACTICE_REVIEW_LIVE === '1') {
    await page.locator('#practice-review').click();
    await page.waitForFunction(() => document.querySelectorAll('#master-history .assistant-answer-bubble').length >= 3);
    assert.equal(await page.locator('#practice-review-targets [data-review-target]').count(), 5);
  }
  await page.locator('#practice-question-list button').nth(3).click();
  await page.locator('.page[data-index="20"] canvas').waitFor({timeout: 30000});
  assert.equal(await page.locator('.practice-current-guide').count(), 1);
  assert.equal(await page.locator('.page[data-index="20"] .practice-current-guide').innerText(), '当前');
  const fourthOption = await page.locator('.page[data-index="20"] .practice-choice-area[data-choice="A"]').boundingBox();
  assert.ok(fourthOption);
  await page.mouse.click(fourthOption.x + fourthOption.width / 2, fourthOption.y + fourthOption.height / 2);
  await page.mouse.click(fourthOption.x + fourthOption.width / 2, fourthOption.y + fourthOption.height / 2);
  await page.locator('#practice-status').filter({hasText: /正确/}).waitFor();
  await page.locator('#practice-review').click();
  await page.locator('#master-title').filter({hasText: /第 4 题/}).waitFor();
  await page.locator('#assistant-resize-handle').press('End');
  const fourthLayout = await page.evaluate(() => {
    const left = document.querySelector('#practice-panel').getBoundingClientRect();
    const center = document.querySelector('#viewer').getBoundingClientRect();
    const right = document.querySelector('#assistant-panel').getBoundingClientRect();
    const paper = document.querySelector('.page[data-index="20"]').getBoundingClientRect();
    return {leftEnd: left.right, centerStart: center.left, centerWidth: center.width,
      centerEnd: center.right, rightStart: right.left, rightWidth: right.width,
      paperStart: paper.left, paperEnd: paper.right};
  });
  assert.ok(fourthLayout.leftEnd <= fourthLayout.centerStart + 1
    && fourthLayout.centerWidth >= 599 && fourthLayout.centerEnd <= fourthLayout.rightStart + 1
    && fourthLayout.rightWidth <= 441 && fourthLayout.paperStart >= fourthLayout.centerStart
    && fourthLayout.paperEnd <= fourthLayout.centerEnd, JSON.stringify(fourthLayout));
  await page.screenshot({path: 'test-results/practice-prototype-q4-boundary.png'});
  await page.setViewportSize({width: 1024, height: 900});
  await page.waitForTimeout(500);
  const compactReview = await page.evaluate(() => {
    const center = document.querySelector('#viewer').getBoundingClientRect();
    const right = document.querySelector('#assistant-panel').getBoundingClientRect();
    const paper = document.querySelector('.page[data-index="20"]').getBoundingClientRect();
    return {centerStart: center.left, centerWidth: center.width, centerEnd: center.right, rightStart: right.left,
      rightWidth: right.width, paperStart: paper.left, paperEnd: paper.right};
  });
  assert.ok(compactReview.centerWidth >= 580 && compactReview.rightWidth <= 241
    && compactReview.centerEnd <= compactReview.rightStart + 1
    && compactReview.paperStart >= compactReview.centerStart && compactReview.paperEnd <= compactReview.centerEnd,
  JSON.stringify(compactReview));
  await page.screenshot({path: 'test-results/practice-prototype-q4-1024.png'});
  await page.locator('#practice-question-list button').nth(6).click();
  assert.equal(await page.locator('#practice-number').innerText(), '07');
  assert.equal(await page.locator('.practice-current-guide').count(), 1);
  assert.equal(await page.locator('.page[data-index="20"] .practice-current-guide').innerText(), '当前');
  await page.screenshot({path: 'test-results/practice-prototype-q7-1024.png'});
  await page.locator('#practice-close').click();
  assert.equal(await page.locator('.practice-current-guide').count(), 0);
  await page.setViewportSize({width: 850, height: 900});
  await page.locator('#page-number').fill('20');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="19"] .practice-entry').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const reader = document.querySelector('#reader');
    const panel = document.querySelector('#assistant-panel');
    panel.hidden = false;
    panel.classList.add('assistant-overlay-open');
    reader.classList.remove('assistant-dock-open');
  });
  assert.equal(await page.locator('#assistant-panel').evaluate(node => node.classList.contains('assistant-overlay-open')), true);
  await page.locator('.page[data-index="19"] .practice-entry').click();
  const convertedDock = await page.evaluate(() => ({
    practice: document.querySelector('#reader').classList.contains('practice-active'),
    dock: document.querySelector('#reader').classList.contains('assistant-dock-open'),
    overlay: document.querySelector('#assistant-panel').classList.contains('assistant-overlay-open'),
    centerEnd: document.querySelector('#viewer').getBoundingClientRect().right,
    rightStart: document.querySelector('#assistant-panel').getBoundingClientRect().left,
  }));
  assert.ok(convertedDock.practice && convertedDock.dock && !convertedDock.overlay
    && convertedDock.centerEnd <= convertedDock.rightStart + 1, JSON.stringify(convertedDock));
  assert.deepEqual(errors, []);
  console.log('practice prototype real-book smoke PASS');
} finally {
  await browser?.close();
  if (server?.exitCode === null) {
    const done = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await done;
  }
}
