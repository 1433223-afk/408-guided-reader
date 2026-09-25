import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

// Directory adaptive pane — margin / split / navigation modes over the real 348-page
// textbook. The invariant under test: opening, using and closing the Directory never
// changes the rendered PDF page, zoom or reading position.
const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-directory-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true});
const sql = (code, args = []) => {
  const result = spawnSync('python', ['-c', code, ...args], {windowsHide: true, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
sql('import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  [path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')]);

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
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
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
  const page = await browser.newPage({viewport: {width: 1920, height: 1000}, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout: 30000});
  // The Library remembers zoom across sessions; geometry-mode assertions below
  // are calibrated at 100%, independent of the user's last saved reading zoom.
  while (Number.parseInt(await page.locator('#zoom-value').textContent(), 10) > 100) await page.locator('#zoom-out').click();
  while (Number.parseInt(await page.locator('#zoom-value').textContent(), 10) < 100) await page.locator('#zoom-in').click();

  const outline = await page.evaluate(async () => {
    const books = (await (await fetch('/api/books')).json()).books;
    const revision = books.find(book => book.active_revision?.page_count === 348).active_revision.id;
    // Mirror the app: the saved directory wins over a conflicting fresh build.
    let payload = await (await fetch(`/api/revisions/${revision}/outline?stored=1`)).json();
    if (!payload.evidence_source) payload = await (await fetch(`/api/revisions/${revision}/outline`)).json();
    return payload;
  });
  const sectionOf = prefix => outline.nodes.find(n => n.kind === 'SECTION' && n.title.startsWith(prefix));

  const state = () => page.evaluate(() => {
    const viewer = document.querySelector('#viewer');
    const canvas = document.querySelector('.page canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      pageNumber: document.querySelector('#page-number').value,
      zoom: document.querySelector('#zoom-value').textContent,
      scrollTop: viewer.scrollTop, scrollLeft: viewer.scrollLeft,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      cssWidth: rect.width, cssHeight: rect.height, canvasX: rect.left,
    };
  });
  const paneBox = () => page.locator('#outline-panel').boundingBox();
  const canvasBox = () => page.locator('.page canvas').first().boundingBox();

  // Park inside a resolved subsection of 2.2 so the active-item assertions exercise
  // the deepest authoritative outline identity, not just Section granularity.
  const section22 = sectionOf('2.2 ');
  const subsection = outline.nodes.find(n => n.parent_id === section22.outline_node_id
    && n.resolution_state === 'RESOLVED' && Number.isFinite(n.start_y));
  assert.ok(subsection, 'the real book must expose a resolved subsection under 2.2');
  await page.locator('#page-number').fill(String(subsection.start_page + 1));
  await page.locator('#page-number').press('Enter');
  await page.locator(`.page[data-index="${subsection.start_page}"] canvas`).waitFor({timeout: 30000});
  await page.waitForTimeout(300);
  // A direct reader interaction releases the navigation pin before parking.
  await page.locator('#viewer').click({position: {x: 700, y: 500}});
  const anchorY = Math.min(0.95, subsection.start_y + 0.02);
  await page.evaluate(({index, y}) => {
    const target = document.querySelector(`.page[data-index="${index}"]`);
    document.querySelector('#viewer').scrollTop = target.offsetTop + target.offsetHeight * y;
  }, {index: subsection.start_page, y: anchorY});
  await page.waitForTimeout(700);
  await page.screenshot({path: 'test-results/directory-default-reader.png'});

  const before = await state();

  // --- Margin mode (wide) ---
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.waitForTimeout(150);
  const readerClass = () => page.locator('#reader').evaluate(el => el.className);
  assert.match(await readerClass(), /directory-margin/, 'wide screen must use margin mode');
  assert.doesNotMatch(await readerClass(), /directory-split|directory-nav/);
  const afterOpen = await state();
  assert.equal(afterOpen.pageNumber, before.pageNumber, 'margin mode must not move the page');
  assert.equal(afterOpen.zoom, before.zoom, 'margin mode must not change zoom');
  assert.equal(afterOpen.scrollTop, before.scrollTop, 'margin mode must not scroll');
  assert.equal(afterOpen.cssWidth, before.cssWidth, 'margin mode must not resize the page');
  assert.equal(afterOpen.canvasX, before.canvasX, 'margin mode must not move the page horizontally');
  const marginPane = await paneBox(), marginCanvas = await canvasBox();
  assert.ok(marginCanvas.x >= marginPane.x + marginPane.width + 20,
    `margin mode pane overlaps the page: ${JSON.stringify({marginPane, marginCanvas})}`);
  // The saved-directory guard may legitimately show its conflict notice; only the
  // implementation-source line ("依据：...") is gone for the reading user.
  await page.locator('#outline-status').waitFor({state: 'attached'});
  assert.equal((await page.locator('#outline-status').textContent()).includes('依据：'), false,
    'the evidence source line must not surface in the pane');
  const active = page.locator(`li[data-node-id="${subsection.outline_node_id}"] > .outline-row .outline-target`);
  assert.equal(await active.getAttribute('aria-current'), 'true', 'the deepest current item must be marked');
  assert.ok(await active.evaluate(el => el.classList.contains('is-active')));
  assert.equal(await page.locator('#outline-tree .outline-target[aria-current="true"]').count(), 1,
    'exactly one directory item may claim the current position');
  assert.equal(await page.locator(`li[data-node-id="${section22.outline_node_id}"] > .outline-row .outline-target`).getAttribute('aria-current'), null,
    'ancestor Section must not steal the highlight from the deepest item');
  const treeBox = await page.locator('#outline-tree').boundingBox();
  const activeBox = await active.boundingBox();
  assert.ok(activeBox.y >= treeBox.y - 1 && activeBox.y + activeBox.height <= treeBox.y + treeBox.height + 1,
    'active item must be scrolled into view on open');
  await page.screenshot({path: 'test-results/directory-polish-subsection.png'});

  // The redundant reading label is gone; only the back button and book title remain.
  assert.equal(await page.locator('#reader-section-hint').count(), 0,
    'the current-reading label must not exist in the toolbar');
  await page.locator('#outline-close').click();
  assert.equal(await page.locator('#outline-panel').isVisible(), false);
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  assert.match(await readerClass(), /directory-margin/);

  // Navigating to another section keeps the pane open (margin mode).
  const section62 = outline.nodes.find(n => n.kind === 'SECTION' && n.title.startsWith('6.2 '));
  const chapter6 = outline.nodes.find(n => n.kind === 'CHAPTER' && n.title.startsWith('第6章'));
  const section62Row = page.locator(`li[data-node-id="${section62.outline_node_id}"] > .outline-row .outline-target`);
  if (!(await section62Row.isVisible())) {
    // Chapters outside the current reading path start folded; unfold chapter 6 first.
    await page.locator(`li[data-node-id="${chapter6.outline_node_id}"] > .outline-row .outline-fold`).click();
    await page.waitForTimeout(150);
  }
  await section62Row.click();
  await page.waitForFunction(value => document.querySelector('#page-number').value === value, String(section62.start_page + 1));
  await page.locator(`.page[data-index="${section62.start_page}"] canvas`).waitFor({timeout: 30000});
  assert.equal(await page.locator('#outline-panel').isVisible(), true, 'margin mode keeps the pane open after navigation');
  const afterNavigate = await state();
  assert.equal(afterNavigate.zoom, before.zoom, 'navigation must keep zoom');
  assert.equal(afterNavigate.cssWidth, before.cssWidth, 'navigation must keep page size');
  await page.waitForTimeout(400);
  const family62 = new Set([section62.outline_node_id, ...outline.nodes
    .filter(n => n.parent_id === section62.outline_node_id).map(n => n.outline_node_id)]);
  const currentId = await page.locator('#outline-tree .outline-target[aria-current="true"]')
    .evaluate(el => el.closest('li').dataset.nodeId);
  assert.ok(family62.has(currentId),
    `active item must follow the authoritative position in 6.2's family: ${currentId}`);
  await page.screenshot({path: 'test-results/directory-polish-wide.png'});

  // --- Trailing-subsection navigation correctness (习题精选 / 答案与解析) ---
  // Independent re-implementation of the projected landing coordinate: a page-only
  // PARTIAL node starts where its previous sibling's stored range ends.
  const projectedStart = (node, nodes) => {
    if (Number.isFinite(node.start_y)) return {page: node.start_page, y: node.start_y};
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const index = siblings.findIndex(n => n.outline_node_id === node.outline_node_id);
    const previous = siblings[index - 1];
    const y = previous && previous.end_page === node.start_page && Number.isFinite(previous.end_y)
      ? previous.end_y : 0;
    return {page: node.start_page, y};
  };
  const activeIds = () => page.locator('#outline-tree .outline-target[aria-current="true"]')
    .evaluateAll(list => list.map(el => el.closest('li').dataset.nodeId));
  const landingOf = node => page.evaluate(({index, y}) => {
    const target = document.querySelector(`.page[data-index="${index}"]`);
    return {scrollTop: document.querySelector('#viewer').scrollTop,
      expected: target.offsetTop + target.offsetHeight * y};
  }, {index: node.start_page, y: projectedStart(node, outline.nodes).y});
  async function clickAndVerify(node, label) {
    const row = page.locator(`li[data-node-id="${node.outline_node_id}"] > .outline-row .outline-target`);
    if (!(await row.isVisible())) {
      // Chapters outside the current reading path start folded; unfold from the
      // outermost folded ancestor inward — nearer lists may merely sit inside a
      // hidden subtree and must not be touched.
      const chain = [];
      for (let parent = outline.nodes.find(n => n.outline_node_id === node.parent_id); parent;
           parent = outline.nodes.find(n => n.outline_node_id === parent.parent_id)) chain.unshift(parent);
      for (const parent of chain) {
        const parentList = page.locator(`li[data-node-id="${parent.outline_node_id}"] > ul`);
        if (await parentList.count() && !(await parentList.isVisible())) {
          await page.locator(`li[data-node-id="${parent.outline_node_id}"] > .outline-row .outline-fold`).click();
          await page.waitForTimeout(120);
        }
      }
    }
    await row.click();
    await page.waitForTimeout(420);
    const landed = await landingOf(node);
    assert.ok(Math.abs(landed.scrollTop - landed.expected) <= 3,
      `${label}: navigation must land on the projected destination: ${JSON.stringify(landed)}`);
    const ids = await activeIds();
    assert.deepEqual(ids, [node.outline_node_id],
      `${label}: the clicked node must be the single authoritative current item, got ${JSON.stringify(ids)}`);
  }
  const section13 = sectionOf('1.3 ');
  const childrenOf = section => outline.nodes
    .filter(n => n.parent_id === section.outline_node_id).sort((a, b) => a.order_index - b.order_index);
  const [s131, s132, s133, s134] = childrenOf(section13);
  const section21 = sectionOf('2.1 ');
  const section33 = sectionOf('3.3 ');
  const trailing = [
    ...childrenOf(section21).filter(n => n.resolution_state === 'PARTIAL'),
    ...childrenOf(section33).filter(n => n.resolution_state === 'PARTIAL'),
  ];
  assert.ok(trailing.length >= 4, `three chapters' trailing nodes must be exercised, found ${trailing.length}`);

  // Case 1: a normal RESOLVED subsection.
  await clickAndVerify(s131, '1.3.1 resolved');
  // Cases 2-3: the last-but-one (习题精选) and last (答案与解析) trailing nodes —
  // the highlight must not fall back to the preceding subsection.
  await clickAndVerify(s133, '1.3.3 exercises');
  await clickAndVerify(s134, '1.3.4 answers');
  // Case 4: consecutive clicks keep exactly one authoritative item per destination.
  for (const node of [s131, s133, s134, s132]) await clickAndVerify(node, node.title);
  // Trailing nodes of two more chapters.
  for (const node of trailing) await clickAndVerify(node, node.title);

  // Case 5: scrolling away re-projects the current item; no click lock-in.
  const target211 = childrenOf(section21)[0];
  const entry = projectedStart(target211, outline.nodes);
  await page.locator('#viewer').click({position: {x: 700, y: 500}});
  await page.evaluate(({index, y}) => {
    const target = document.querySelector(`.page[data-index="${index}"]`);
    document.querySelector('#viewer').scrollTop = target.offsetTop + target.offsetHeight * (y + 0.05);
  }, {index: entry.page, y: entry.y});
  await page.waitForTimeout(700);
  const scrolledIds = await activeIds();
  assert.deepEqual(scrolledIds, [target211.outline_node_id],
    `scrolling into a reliable range must move the highlight, got ${JSON.stringify(scrolledIds)}`);

  // Peer exclusion: opening search closes the Directory without touching the PDF.
  const beforePeers = await state();
  await page.locator('#search-toggle').click();
  assert.equal(await page.locator('#outline-panel').isVisible(), false);
  await page.locator('#search-close').click();
  assert.deepEqual(await state(), beforePeers);

  // Knowledge Points remains the right learning context; the Directory yields.
  await page.locator('#page-number').fill(String(section22.start_page + 1));
  await page.locator('#page-number').press('Enter');
  await page.waitForTimeout(500);
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  const kpEntry = page.locator('#reader-kp-action');
  await kpEntry.filter({hasText: '个知识点'}).waitFor({timeout: 15000});
  await kpEntry.click();
  await page.locator('.reader-kp-row').first().waitFor();
  assert.equal(await page.locator('#outline-panel').isVisible(), false, 'KP entry must close the Directory');
  await page.screenshot({path: 'test-results/directory-knowledge-panel.png'});
  await page.locator('.reader-kp-row button').first().click();
  await page.waitForTimeout(400);

  // Closing returns the page to its untouched geometry.
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.locator('#outline-close').click();
  const closed = await state();
  assert.equal(closed.zoom, before.zoom);
  assert.equal(closed.cssWidth, before.cssWidth);

  // --- Split mode (medium) ---
  await page.setViewportSize({width: 1440, height: 1000});
  await page.waitForTimeout(500);
  const splitBefore = await state();
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.waitForTimeout(150);
  assert.match(await readerClass(), /directory-split/, 'medium screen must use split mode');
  const splitState = await state();
  assert.equal(splitState.zoom, splitBefore.zoom, 'split mode must not change zoom');
  assert.equal(splitState.cssWidth, splitBefore.cssWidth, 'split mode must keep the rendered page width');
  assert.equal(splitState.scrollTop, splitBefore.scrollTop, 'split mode must keep the reading anchor');
  const splitPane = await paneBox(), splitCanvas = await canvasBox();
  const splitViewer = await page.locator('#viewer').boundingBox();
  assert.ok(splitCanvas.x >= splitPane.x + splitPane.width + 20,
    `split mode pane overlaps the page: ${JSON.stringify({splitPane, splitCanvas})}`);
  assert.ok(splitCanvas.x >= splitViewer.x - 1 && splitCanvas.x + splitCanvas.width <= splitViewer.x + splitViewer.width + 1,
    'split mode must keep the whole page inside the remaining stage');
  await page.screenshot({path: 'test-results/directory-split-1440.png'});
  await page.locator('#outline-close').click();
  await page.waitForTimeout(150);
  const splitClosed = await state();
  assert.equal(splitClosed.cssWidth, splitBefore.cssWidth);
  assert.equal(splitClosed.scrollTop, splitBefore.scrollTop);

  // Zoom growth re-evaluates the mode: 150% at 1440 cannot sit beside the pane.
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  while (Number((await page.locator('#zoom-value').textContent()).replace('%', '')) < 150) {
    await page.locator('#zoom-in').click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);
  assert.match(await readerClass(), /directory-nav/, 'high zoom must fall back to navigation mode');
  assert.equal(await page.locator('#viewer').evaluate(el => getComputedStyle(el).visibility), 'hidden',
    'navigation mode must not show the PDF next to the pane');
  while (Number((await page.locator('#zoom-value').textContent()).replace('%', '')) > 100) {
    await page.locator('#zoom-out').click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);
  assert.match(await readerClass(), /directory-split/, 'restoring zoom returns to split mode');
  assert.equal(await page.locator('#viewer').evaluate(el => getComputedStyle(el).visibility), 'visible');
  await page.locator('#outline-close').click();
  await page.waitForTimeout(150);

  // --- Navigation mode (narrow) ---
  for (const width of [1280, 1024]) {
    await page.setViewportSize({width, height: 1000});
    await page.waitForTimeout(500);
    const navBefore = await state();
    await page.locator('#outline-toggle').click();
    await page.locator('#outline-tree .outline-target').first().waitFor();
    await page.waitForTimeout(150);
    assert.match(await readerClass(), /directory-nav/, `${width} must fall back to navigation mode`);
    assert.equal(await page.locator('#viewer').evaluate(el => getComputedStyle(el).visibility), 'hidden',
      'navigation mode hides the PDF instead of overlaying it');
    const navState = await state();
    assert.equal(navState.pageNumber, navBefore.pageNumber);
    assert.equal(navState.zoom, navBefore.zoom);
    assert.equal(navState.scrollTop, navBefore.scrollTop);
    await page.screenshot({path: `test-results/directory-nav-${width}.png`});
    if (width === 1280) {
      // A click navigates, closes the pane and returns to the PDF at the new position.
      // The landing check uses the exact scroll target (page top + normalized start_y,
      // Implementation §7.5); the page indicator may report the dominant neighbour page.
      const landing = () => page.evaluate(node => {
        const target = document.querySelector(`.page[data-index="${node.start_page}"]`);
        return {scrollTop: document.querySelector('#viewer').scrollTop,
          expected: target.offsetTop + target.offsetHeight * node.start_y,
          pageNumber: Number(document.querySelector('#page-number').value)};
      }, {start_page: section22.start_page, start_y: section22.start_y});
      await page.locator(`li[data-node-id="${section22.outline_node_id}"] > .outline-row .outline-target`).click();
      await page.waitForTimeout(400);
      const landed = await landing();
      assert.ok(Math.abs(landed.scrollTop - landed.expected) <= 3,
        `navigation must land on the section target: ${JSON.stringify(landed)}`);
      assert.ok(landed.pageNumber >= section22.start_page + 1 && landed.pageNumber <= section22.start_page + 2,
        `unexpected dominant page after jump: ${landed.pageNumber}`);
      assert.equal(await page.locator('#outline-panel').isVisible(), false, 'navigation mode closes the pane after a jump');
      assert.equal(await page.locator('#viewer').evaluate(el => getComputedStyle(el).visibility), 'visible');
      assert.equal((await state()).zoom, navBefore.zoom);
      // Direct close restores the untouched reading position.
      await page.locator('#outline-toggle').click();
      await page.locator('#outline-tree .outline-target').first().waitFor();
      await page.waitForTimeout(350);
      const escBefore = await state();
      await page.locator('#outline-close').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#outline-panel').isVisible(), false, 'Escape must close the pane');
      const escAfter = await state();
      assert.equal(escAfter.pageNumber, escBefore.pageNumber, 'Escape close must keep the page');
      assert.equal(escAfter.scrollTop, escBefore.scrollTop, 'Escape close must keep the scroll');
      assert.equal(escAfter.zoom, escBefore.zoom, 'Escape close must keep the zoom');
    } else {
      await page.locator('#outline-close').click();
    }
  }

  // --- Progressive collapse: defaults, affordance, keyboard, session persistence ---
  await page.setViewportSize({width: 1920, height: 1000});
  await page.waitForTimeout(500);
  // Park back inside 2.2.1 so the current path is chapter 2 / section 2.2.
  await page.locator('#page-number').fill(String(subsection.start_page + 1));
  await page.locator('#page-number').press('Enter');
  await page.waitForTimeout(300);
  await page.locator('#viewer').click({position: {x: 700, y: 500}});
  await page.evaluate(({index, y}) => {
    const target = document.querySelector(`.page[data-index="${index}"]`);
    document.querySelector('#viewer').scrollTop = target.offsetTop + target.offsetHeight * y;
  }, {index: subsection.start_page, y: anchorY});
  await page.waitForTimeout(500);
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.waitForTimeout(300);
  const chapter2 = outline.nodes.find(n => n.kind === 'CHAPTER' && n.title.startsWith('第2章'));
  // Chapter 5 can be expanded already when it was the Library's saved starting
  // position. Chapter 4 was not visited in this run, so it tests the default fold.
  const chapter4 = outline.nodes.find(n => n.kind === 'CHAPTER' && n.title.startsWith('第4章'));
  const chapter3 = outline.nodes.find(n => n.kind === 'CHAPTER' && n.title.startsWith('第3章'));
  const list2 = page.locator(`li[data-node-id="${chapter2.outline_node_id}"] > ul`);
  const list4 = page.locator(`li[data-node-id="${chapter4.outline_node_id}"] > ul`);
  const list3 = page.locator(`li[data-node-id="${chapter3.outline_node_id}"] > ul`);
  const fold4 = page.locator(`li[data-node-id="${chapter4.outline_node_id}"] > .outline-row .outline-fold`);
  const fold2 = page.locator(`li[data-node-id="${chapter2.outline_node_id}"] > .outline-row .outline-fold`);
  const fold22 = page.locator(`li[data-node-id="${section22.outline_node_id}"] > .outline-row .outline-fold`);
  // Default: current chapter expanded, other chapters folded.
  assert.equal(await list2.isVisible(), true, 'the current chapter must be expanded on open');
  assert.equal(await fold2.getAttribute('aria-expanded'), 'true');
  assert.equal(await list4.isVisible(), false, 'non-current chapters stay folded by default');
  assert.equal(await fold4.getAttribute('aria-expanded'), 'false');
  assert.equal(await fold4.textContent(), '展开');
  // Leaves have no fold; sections with real children do.
  assert.equal(await page.locator(`li[data-node-id="${subsection.outline_node_id}"] > .outline-row .outline-fold`).count(), 0,
    'leaf subsections must not offer folding');
  assert.notEqual(await fold22.count(), 0);
  // The fold label stays hidden until the row is hovered (no persistent affordance).
  assert.equal(await fold4.evaluate(el => getComputedStyle(el).opacity), '0');
  await page.locator(`li[data-node-id="${chapter4.outline_node_id}"] > .outline-row`).hover();
  await page.waitForTimeout(160); // let the reveal transition finish
  assert.equal(await fold4.evaluate(el => getComputedStyle(el).opacity), '1',
    'hovering a foldable row reveals the text affordance');
  await page.screenshot({path: 'test-results/directory-fold-hover.png'});
  // Folding changes child visibility only — never the PDF position.
  const beforeFold = await state();
  await fold4.click();
  assert.equal(await list4.isVisible(), true, 'fold click expands the chapter');
  assert.equal(await fold4.getAttribute('aria-expanded'), 'true');
  assert.equal(await fold4.textContent(), '收起');
  await fold4.click();
  assert.equal(await list4.isVisible(), false);
  assert.equal(await fold4.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await state(), beforeFold, 'folding must not move the PDF');
  // Keyboard: focus the fold and press Enter — same toggle, still no navigation.
  await fold4.focus();
  assert.equal(await fold4.evaluate(el => getComputedStyle(el).opacity), '1',
    'keyboard focus reveals the text affordance');
  await page.keyboard.press('Enter');
  assert.equal(await list4.isVisible(), true, 'Enter on a focused fold toggles expansion');
  assert.deepEqual(await state(), beforeFold, 'keyboard folding must not move the PDF');
  // Section-level fold: a non-current section folds freely; the current section
  // (an ancestor of the current item) refuses to fold away its current item.
  const section21row = outline.nodes.find(n => n.kind === 'SECTION' && n.title.startsWith('2.1 '));
  const fold21 = page.locator(`li[data-node-id="${section21row.outline_node_id}"] > .outline-row .outline-fold`);
  await fold21.click();
  const list21 = page.locator(`li[data-node-id="${section21row.outline_node_id}"] > ul`);
  assert.equal(await list21.isVisible(), false, 'non-current sections fold');
  assert.equal(await fold21.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(await activeIds(), [subsection.outline_node_id], 'folding another branch keeps the current highlight');
  await fold21.click();
  assert.equal(await list21.isVisible(), true);
  assert.equal(await fold21.getAttribute('aria-expanded'), 'true');
  await fold22.click();
  const list22 = page.locator(`li[data-node-id="${section22.outline_node_id}"] > ul`);
  assert.equal(await list22.isVisible(), true, 'the current section must not fold away the current item');
  assert.equal(await fold22.getAttribute('aria-expanded'), 'true');
  // Session persistence across pane close/reopen, other branches untouched.
  await fold4.click(); // leave chapter 4 folded
  await page.locator('#outline-close').click();
  await page.locator('#outline-toggle').click();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(await list4.isVisible(), false, 'manual fold state persists across reopen');
  assert.equal(await list2.isVisible(), true, 'the current path stays expanded');
  // Reading into a previously folded branch auto-expands only that path.
  const section31 = outline.nodes.find(n => n.kind === 'SECTION' && n.title.startsWith('3.1 '));
  await page.locator('#viewer').click({position: {x: 700, y: 500}});
  await page.evaluate(index => {
    const target = document.querySelector(`.page[data-index="${index}"]`);
    document.querySelector('#viewer').scrollTop = target.offsetTop + target.offsetHeight * 0.8;
  }, section31.start_page);
  await page.waitForTimeout(800);
  assert.equal(await list3.isVisible(), true, 'entering a folded branch expands its path');
  assert.equal(await list4.isVisible(), false, 'other branches keep their fold state');
  await page.screenshot({path: 'test-results/directory-collapse-current-path.png'});
  await page.locator('#outline-close').click();

  // Reading position survives the full interaction cycle.
  const finalState = await state();
  await page.locator('#back-to-library').click();
  await page.locator('#library-home').waitFor({state: 'visible'});
  await page.locator('.book-card').filter({hasText: '348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout: 30000});
  await page.waitForTimeout(900);
  const restored = await state();
  assert.equal(restored.pageNumber, finalState.pageNumber, 'reading position must survive reopen');
  assert.equal(restored.zoom, finalState.zoom);
  assert.equal(await page.locator('#outline-panel').isVisible(), false, 'the pane stays closed on reopen');

  // --- Generic click↔highlight consistency sweep over every book in the library ---
  // Invariant: clicking any navigable directory item makes exactly that item the
  // single authoritative current item, landing on its projected destination. This
  // guards the whole real corpus (bookmark-derived, TOC-derived, page-only trees)
  // instead of any single book's shape.
  const projectedStartOf = (node, nodes) => {
    if (Number.isFinite(node.start_y)) return {page: node.start_page, y: node.start_y};
    const siblings = nodes.filter(n => n.parent_id === node.parent_id).sort((a, b) => a.order_index - b.order_index);
    const index = siblings.findIndex(n => n.outline_node_id === node.outline_node_id);
    const previous = siblings[index - 1];
    const y = previous && previous.end_page === node.start_page && Number.isFinite(previous.end_y)
      ? previous.end_y : 0;
    return {page: node.start_page, y};
  };
  async function consistencySweep(bookPages) {
    // The sweep asserts live highlight state, so it needs a mode where the pane
    // stays open after clicks (margin mode) regardless of the prior test width.
    await page.setViewportSize({width: 1920, height: 1000});
    await page.waitForTimeout(500);
    await page.locator('#back-to-library').click();
    await page.locator('#library-home').waitFor({state: 'visible'});
    await page.locator('.book-card').filter({hasText: `${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('.page canvas').first().waitFor({timeout: 30000});
    const bookOutline = await page.evaluate(async pages => {
      const books = (await (await fetch('/api/books')).json()).books;
      const revision = books.find(b => b.active_revision?.page_count === pages).active_revision.id;
      let payload = await (await fetch(`/api/revisions/${revision}/outline?stored=1`)).json();
      if (!payload.evidence_source) payload = await (await fetch(`/api/revisions/${revision}/outline`)).json();
      return payload;
    }, bookPages);
    await page.locator('#outline-toggle').click();
    await page.locator('#outline-tree .outline-target').first().waitFor();
    await page.waitForTimeout(400);
    const kidsOf = parent => bookOutline.nodes
      .filter(n => n.parent_id === (parent ? parent.outline_node_id : null))
      .sort((a, b) => a.order_index - b.order_index);
    const activeTitles = () => page.locator('#outline-tree .outline-target[aria-current="true"]')
      .evaluateAll(list => list.map(el => el.textContent.trim()));
    const probes = [];
    // Chapters by kind, not by tree level: some books nest them under 篇 containers.
    for (const chapter of bookOutline.nodes.filter(n => n.kind === 'CHAPTER' && n.title.includes('章'))) {
      const sections = kidsOf(chapter);
      probes.push(chapter);
      if (sections[0]) probes.push(sections[0]);
      if (sections.at(-1)) probes.push(sections.at(-1));
      for (let i = 0, taken = 0; i + 1 < sections.length && taken < 2; i += 1) {
        if (sections[i].start_page !== null && sections[i].start_page === sections[i + 1].start_page) {
          probes.push(sections[i], sections[i + 1]);
          taken += 1;
        }
      }
      if (sections[1]) {
        const subs = kidsOf(sections[1]);
        if (subs[0]) probes.push(subs[0]);
        if (subs.at(-1)) probes.push(subs.at(-1));
        for (let i = 0, taken = 0; i + 1 < subs.length && taken < 1; i += 1) {
          if (subs[i].start_page !== null && subs[i].start_page === subs[i + 1].start_page) {
            probes.push(subs[i], subs[i + 1]);
            taken += 1;
          }
        }
      }
    }
    let clicked = 0;
    for (const node of probes) {
      if (node.start_page === null) continue;
      const row = page.locator(`li[data-node-id="${node.outline_node_id}"] > .outline-row .outline-target`);
      // Rows hidden inside the collapsed auxiliary group are out of sweep scope.
      if (!(await row.isVisible())) continue;
      await row.click();
      await page.waitForTimeout(420);
      const landed = await page.evaluate(({index, y}) => {
        const target = document.querySelector(`.page[data-index="${index}"]`);
        return {scrollTop: document.querySelector('#viewer').scrollTop,
          expected: target.offsetTop + target.offsetHeight * y};
      }, {index: node.start_page, y: projectedStartOf(node, bookOutline.nodes).y});
      assert.ok(Math.abs(landed.scrollTop - landed.expected) <= 3,
        `${bookPages}p ${node.title}: navigation must land on the projected destination: ${JSON.stringify(landed)}`);
      const current = await activeTitles();
      assert.deepEqual(current, [node.title],
        `${bookPages}p: clicking ${node.title} must make it the single current item, got ${JSON.stringify(current)}`);
      clicked += 1;
    }
    await page.screenshot({path: `test-results/directory-sweep-${bookPages}.png`});
    await page.locator('#outline-close').click();
    return clicked;
  }
  const swept = [await consistencySweep(412), await consistencySweep(364), await consistencySweep(348)];
  assert.ok(swept[0] >= 30 && swept[1] >= 25 && swept[2] >= 25,
    `every book must exercise a real probe set: ${JSON.stringify(swept)}`);

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({status: 'PASS', modes: ['margin@1920', 'split@1440', 'navigation@1280/1024'],
    pdfGeometryStable: true, activeItemFollowsSection: true, escapeCloseKeepsPosition: true,
    corpusSweepProbes: {ds412: swept[0], insurance364: swept[1], coa348: swept[2]}, errors}));
} finally {
  if (browser) await browser.close();
  await stop();
}
