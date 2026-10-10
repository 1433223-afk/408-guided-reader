// Focused real-PDF check; all annotations are created in a temporary Library copy.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name a prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'reader-display-'));
const data = path.join(root, 'data');
await mkdir(data);
await cp(path.join(source, 'blobs'), path.join(data, 'blobs'), {recursive:true});
const backup = spawnSync('python', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(data, 'state.sqlite3')], {windowsHide:true, encoding:'utf8'});
assert.equal(backup.status, 0, backup.stderr);
let server, browser, page, stderr = '';
try {
  server = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', data], {
    windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1'},
  });
  server.stderr.on('data', chunk => {stderr += chunk;});
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Reader start timeout')), 30000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/READY (http:\/\/\S+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error('Reader exited before READY'));});
  });
  browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true});
  page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  const api = route => page.evaluate(async route => (await fetch(route)).json(), route);
  const books = (await api('/api/books')).books;
  const book = books.find(item => item.title === '2026计算机组成原理');
  assert.ok(book);
  const revision = book.active_revision.id;
  const open = async () => {
    await page.locator('.book-card').filter({hasText:book.title}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('.page canvas').first().waitFor();
  };
  const go = async index => {
    await page.locator('#page-number').fill(String(index + 1));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${index}"] .text-overlay`).waitFor();
  };
  const marks = async index => (await api(`/api/revisions/${revision}/annotations?page=${index}`)).annotations;
  const settleMenu = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const create = async (index, note) => {
    await go(index);
    const overlay = (await api(`/api/revisions/${revision}/overlay?page=${index}`)).page;
    const line = overlay.lines.find(line => line.cells.length > 10 && line.quad.every(([,y]) => y > .3 && y < .6));
    assert.ok(line);
    const old = new Set((await marks(index)).map(item => item.id));
    const box = await page.locator(`.page[data-index="${index}"]`).boundingBox();
    const y = box.y + (line.quad[0][1] + line.quad[2][1]) / 2 * box.height;
    const x1 = box.x + line.cells[0][0] * box.width;
    const x2 = box.x + line.cells[7][1] * box.width;
    await page.mouse.move(x1,y); await page.mouse.down();
    await page.mouse.move(x2,y,{steps:8}); await page.mouse.up();
    await page.mouse.click((x1+x2)/2,y,{button:'right'});
    await page.locator('#selection-actions').waitFor();
    await settleMenu();
    if (note) {
      await page.locator('#add-note').click(); await settleMenu();
      await page.locator('#annotation-note').fill(note);
      await page.locator('#save-note').click();
    } else {
      await page.locator('#save-highlight').click();
      await settleMenu();
      await page.locator('#save-highlight').click();
    }
    await page.getByText(note ? '笔记已保存。' : '高亮已保存。',{exact:true}).waitFor();
    const item = (await marks(index)).find(item => !old.has(item.id));
    assert.ok(item);
    return {index,item};
  };
  const visible = async record => {
    await page.locator(`.annotation-quad[data-annotation-id="${record.item.id}"]`).first().waitFor();
    assert.equal(await page.locator(`.annotation-quad[data-annotation-id="${record.item.id}"]`).count(),record.item.quads.length);
    assert.deepEqual((await marks(record.index)).find(item => item.id === record.item.id), record.item);
  };
  await open();
  const records = [await create(19,null), await create(173,'阅读反馈 smoke：保存的笔记应随原文恢复。')];
  for (const record of records) {
    await go(record.index); await visible(record);
    await go(record.index + 12);
    await page.waitForFunction(index => !document.querySelector(`.page[data-index="${index}"] canvas`), record.index);
    await go(record.index); await visible(record);
  }
  await page.locator('#back-to-library').click(); await open();
  for (const record of records) {await go(record.index); await visible(record);}
  await page.reload(); await open();
  for (const record of records) {await go(record.index); await visible(record);}
  await page.screenshot({path:path.join(root,'saved-marks.jpg')});
  assert.deepEqual(errors,[]);
  console.log('Saved marks: page recycling, book reopen and browser reload PASS');
  if (!process.env.READER_DISPLAY_BASELINE) {
    await go(173);
    const zoom = page.locator('#zoom-value');
    const edit = async (text, key = 'Enter') => {await zoom.fill(text); await zoom.press(key);};
    await edit('125');
    assert.equal(await zoom.inputValue(),'125%');
    await visible(records[1]);
    const anchor = await page.locator('.page[data-index="173"]').evaluate(node => {
      const rect = node.getBoundingClientRect(), viewer = document.querySelector('#viewer').getBoundingClientRect();
      return (viewer.top + viewer.height / 2 - rect.top) / rect.height;
    });
    await edit('175%');
    const anchorAfter = await page.locator('.page[data-index="173"]').evaluate(node => {
      const rect = node.getBoundingClientRect(), viewer = document.querySelector('#viewer').getBoundingClientRect();
      return (viewer.top + viewer.height / 2 - rect.top) / rect.height;
    });
    assert.ok(Math.abs(anchorAfter - anchor) < .002);
    assert.equal(await page.locator('#page-number').inputValue(),'174');
    await visible(records[1]);
    await edit('150','Escape');
    assert.equal(await zoom.inputValue(),'175%');
    await zoom.fill('150%'); await page.locator('#reading-display-toggle').click();
    assert.equal(await zoom.inputValue(),'150%');
    await page.keyboard.press('Escape');
    await zoom.fill('150oops'); await page.locator('#zoom-in').click();
    assert.equal(await zoom.inputValue(),'175%');
    await edit(''); assert.equal(await zoom.inputValue(),'175%');
    await edit('500'); assert.equal(await zoom.inputValue(),'400%');
    await edit('25'); assert.equal(await zoom.inputValue(),'50%');
    await edit('125'); await page.locator('#zoom-in').click();
    assert.equal(await zoom.inputValue(),'150%');
    await page.locator('#zoom-out').click(); assert.equal(await zoom.inputValue(),'125%');
    const viewerBox = await page.locator('#viewer').boundingBox();
    await page.mouse.move(viewerBox.x + viewerBox.width/2,viewerBox.y + viewerBox.height/2);
    await page.keyboard.down('Control'); await page.mouse.wheel(0,-100); await page.keyboard.up('Control');
    await page.waitForFunction(() => document.querySelector('#zoom-value').value === '150%');
    await visible(records[1]);
    await page.screenshot({path:path.join(root,'zoom-edit.jpg')});
    console.log('Editable zoom: Enter, Escape, blur, validation, bounds, buttons, Ctrl-wheel and anchor PASS');
    await page.locator('#reading-display-toggle').click();
    await page.locator('[data-reading-fit="width"]').click();
    await page.locator('.page[data-index="173"] canvas').waitFor();
    await visible(records[1]);
    const widthBefore = (await page.locator('.page[data-index="173"]').boundingBox()).width;
    await page.screenshot({path:path.join(root,'fit-width.jpg')});
    await page.locator('#reading-display-toggle').click();
    await page.locator('[data-reading-fit="content"]').click();
    await page.waitForFunction(width => document.querySelector('.page[data-index="173"]').getBoundingClientRect().width > width + 10, widthBefore);
    await page.locator('.page[data-index="173"] canvas').waitFor();
    await visible(records[1]);
    const widthAfter = (await page.locator('.page[data-index="173"]').boundingBox()).width;
    assert.ok(widthAfter > widthBefore);
    await page.screenshot({path:path.join(root,'fit-content.jpg')});
    await page.locator('#reading-display-toggle').click(); await page.locator('#reading-paper').check();
    const filter = await page.locator('.page[data-index="173"] canvas').evaluate(canvas => getComputedStyle(canvas).filter);
    assert.notEqual(filter,'none');
    await page.screenshot({path:path.join(root,'soft-paper.jpg')});
    await page.keyboard.press('Escape');
    await page.locator('#reading-display-toggle').click(); await page.locator('[data-reading-fit="page"]').click();
    const rect = await page.locator('.page[data-index="173"]').boundingBox();
    const viewer = await page.locator('#viewer').boundingBox();
    assert.ok(rect.height <= viewer.height + 2);
    await page.reload(); await open(); await go(173);
    assert.equal(await page.locator('#reading-paper').isChecked(),true);
    await visible(records[1]);
    for (const [index,name] of [[29,'table'],[31,'formula'],[254,'diagram']]) {
      await go(index);
      await page.locator('#reading-display-toggle').click(); await page.locator('[data-reading-fit="content"]').click();
      await page.locator(`.page[data-index="${index}"] .text-overlay`).waitFor();
      await page.screenshot({path:path.join(root,`${name}-content.jpg`)});
    }
    await edit('125'); await go(19);
    await page.locator('.page[data-index="19"] .practice-entry').click();
    await page.locator('#practice-question-list button').first().click();
    if (await page.locator('#practice-retry').isVisible()) await page.locator('#practice-retry').click();
    await edit('150');
    const option = page.locator('.page[data-index="19"] .practice-choice-area[data-choice="A"]').first();
    await option.waitFor();
    const optionBox = await option.boundingBox();
    await page.mouse.click(optionBox.x+optionBox.width/2, optionBox.y+optionBox.height/2);
    await page.waitForFunction(() => document.querySelector('#practice-status').textContent.includes('已选 A'));
    const optionGeometry = await option.evaluate(node => [node.style.left,node.style.top,node.style.width,node.style.height]);
    await edit('175%'); await option.waitFor();
    assert.deepEqual(await option.evaluate(node => [node.style.left,node.style.top,node.style.width,node.style.height]),optionGeometry);
    assert.ok((await option.getAttribute('class')).includes('selected'));
    await page.locator('#practice-close').click();
    await edit('125'); await go(29);
    await page.locator('#visual-select-toggle').click();
    const canvasBox = await page.locator('.page[data-index="29"] canvas').boundingBox();
    const start = {x:canvasBox.x+canvasBox.width*.3,y:canvasBox.y+canvasBox.height*.15};
    const end = {x:canvasBox.x+canvasBox.width*.6,y:canvasBox.y+canvasBox.height*.25};
    await page.mouse.move(start.x,start.y); await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:8}); await page.mouse.up();
    const outline = await page.locator('.visual-region-outline').boundingBox();
    assert.ok(Math.abs(outline.x-start.x)<2 && Math.abs(outline.y-start.y)<2);
    assert.ok(Math.abs(outline.width-(end.x-start.x))<2);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.visual-region-outline').count(),0);
    console.log('Practice option hits and Visual Region after editable zoom PASS');
    await page.setViewportSize({width:663,height:850});
    const moreButton = await page.locator('#reader-more-toggle').boundingBox();
    assert.ok(moreButton.x >= 0 && moreButton.x + moreButton.width <= 663);
    assert.equal(await page.locator('#preparation-status').isVisible(),false);
    await page.locator('#reader-more-toggle').click(); await page.locator('#reading-display-toggle').click();
    assert.equal(await page.locator('#reading-display-menu').isVisible(),true);
    assert.equal(await page.evaluate(() => document.body.scrollLeft),0);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#reading-display-menu').isVisible(),false);
    await page.locator('#zoom-value').fill('150%');
    await page.locator('#reader-more-toggle').click();
    assert.equal(await page.locator('#zoom-value').inputValue(),'150%');
    assert.deepEqual(errors,[]);
    assert.equal((await api('/api/assistant/inspection')).calls.length,0);
    console.log('Display and saved marks PASS',JSON.stringify({widthBefore,widthAfter,filter,artifacts:root}));
  } else console.log('Artifacts',root);
} catch (error) {
  await page?.screenshot({path:path.join(root,'failure.jpg')}).catch(() => {});
  console.log('Failure screenshot:',path.join(root,'failure.jpg'));
  throw error;
} finally {
  await browser?.close(); server?.kill();
}
