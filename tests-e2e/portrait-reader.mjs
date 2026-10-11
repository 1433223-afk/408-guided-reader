// Focused real-PDF check; all annotations are created in a temporary Library copy.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw Error('READER_DATA_DIR must name a prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'reader-portrait-'));
const data = path.join(root, 'data');
await mkdir(data);
await cp(path.join(source, 'blobs'), path.join(data, 'blobs'), {recursive:true});
const backup = spawnSync('python', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(data, 'state.sqlite3')], {windowsHide:true, encoding:'utf8'});
assert.equal(backup.status, 0, backup.stderr);
let server, browser, page, stderr = '';
const errors = [];
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
  page = await browser.newPage({viewport:{width:1080,height:1920}});
  page.setDefaultTimeout(30000);
  // Allow staging an Assistant draft, without credentials or callable AI.
  // The service remains disabled; this only supplies the browser's availability UI.
  await page.route('**/api/assistant/status', async route => {
    const response = await route.fetch(), status = await response.json();
    status.providers = status.providers.map(p => p.provider === 'deepseek'
      ? {...p, configuration_valid:true, configured:false, credential_available:false, ai_off_reason:'MISSING_CREDENTIAL'} : p);
    await route.fulfill({json:status});
  });
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

  const shot = name => page.screenshot({path:path.join(root,name+'.jpg')});
  const anchor = () => page.evaluate(() => {
    const viewer=document.querySelector('#viewer'), v=viewer.getBoundingClientRect();
    const y=v.top+Math.min(100,v.height*.1);
    const node=[...document.querySelectorAll('.page')].find(p=>{const b=p.getBoundingClientRect();return b.top<=y && b.bottom>=y;});
    const b=node?.getBoundingClientRect();
    return {page:node?.dataset.index,y:b?(y-b.top)/b.height:null,zoom:document.querySelector('#zoom-value').value};
  });
  const stable = async before => {
    const after=await anchor();
    assert.equal(after.page,before.page); assert.equal(after.zoom,before.zoom);
    assert.ok(Math.abs(after.y-before.y)<.003,JSON.stringify({before,after}));
  };
  const mode = async enabled => {
    if (await page.locator('#reader-more-toggle').isVisible() && await page.locator('#reader-more-toggle').getAttribute('aria-expanded')==='false') await page.locator('#reader-more-toggle').click();
    await page.locator('#reading-display-toggle').click();
    await page.locator('#reading-portrait').setChecked(enabled);
    await page.keyboard.press('Escape');
    await settleMenu();
  };
  const rects = () => page.evaluate(() => {
    const box=id=>document.querySelector(id).getBoundingClientRect().toJSON();
    return {viewer:box('#viewer'),right:box('#assistant-panel'),left:box('#practice-panel'),visibility:getComputedStyle(document.querySelector('#viewer')).visibility};
  });
  await open(); await go(29);
  await page.locator('#zoom-value').fill('125'); await page.locator('#zoom-value').press('Enter');
  await page.locator('#outline-toggle').click();
  assert.equal(await page.locator('#viewer').evaluate(n=>getComputedStyle(n).visibility),'hidden');
  await shot('1080-normal-directory');
  const before=await anchor(); await mode(true); await stable(before);
  assert.equal((await rects()).visibility,'visible');
  await page.locator('.page[data-index="29"] canvas').waitFor();
  await shot('1080-portrait-reading');
  await page.mouse.move(3,500); await page.locator('#outline-panel').waitFor();
  await page.mouse.move(170,550); await page.waitForTimeout(500);
  assert.equal(await page.locator('#outline-panel').isVisible(),true);
  await shot('1080-portrait-directory');
  await page.mouse.move(700,500); await page.locator('#outline-panel').waitFor({state:'hidden'});
  for(let i=0;i<2;i++) {
    await page.mouse.move(3,500); await page.locator('#outline-panel').waitFor();
    await page.mouse.move(700,500); await page.locator('#outline-panel').waitFor({state:'hidden'});
  }
  await page.locator('#outline-toggle').click();
  const prePin=await anchor(); await page.locator('#portrait-directory-pin').click(); await stable(prePin);
  await page.mouse.move(700,500); await page.waitForTimeout(550);
  assert.equal(await page.locator('#outline-panel').isVisible(),true);
  const pinBox=await page.locator('#outline-panel').boundingBox();
  const pinnedViewer=await page.locator('#viewer').boundingBox();
  assert.equal(pinBox.width,304); assert.ok(pinnedViewer.x>=pinBox.x+pinBox.width);
  await shot('1080-portrait-pinned');
  const pinnedAnchor=await anchor(); await page.locator('#outline-close').click(); await stable(pinnedAnchor);
  await page.locator('#reading-display-toggle').click(); await page.locator('[data-reading-fit="width"]').click();
  let canvas=await page.locator('.page[data-index="29"]').boundingBox(), viewer=await page.locator('#viewer').boundingBox();
  assert.ok(canvas.width<=viewer.width);
  await page.locator('#reading-display-toggle').click(); await page.locator('[data-reading-fit="page"]').click();
  canvas=await page.locator('.page[data-index="29"]').boundingBox();
  assert.ok(canvas.height<=viewer.height+2);
  await page.locator('#zoom-value').fill('125'); await page.locator('#zoom-value').press('Enter');
  const savedMarks=await marks(29);
  await page.setViewportSize({width:900,height:1600}); await go(19);
  await mode(false);
  await page.locator('.page[data-index="19"] .practice-entry').click();
  await page.locator('#practice-question-list button').first().click();
  // Only the copied Library is changed. No Hint or model request is sent.
  const option=page.locator('.practice-choice-area[data-choice="B"]').first();
  await option.waitFor();
  const optionBox=await option.boundingBox();
  await page.mouse.click(optionBox.x+optionBox.width/2,optionBox.y+optionBox.height/2);
  await page.mouse.click(optionBox.x+optionBox.width/2,optionBox.y+optionBox.height/2);
  await page.waitForFunction(()=>/正确/.test(document.querySelector('#practice-status').textContent));
  await page.locator('#practice-review').waitFor();
  await page.locator('#practice-review').click(); await page.locator('#master-workspace').waitFor();
  await page.waitForFunction(()=>/第 1 题/.test(document.querySelector('#master-title').textContent));
  await settleMenu();
  const normal=await rects(); await shot('900-normal-review');
  const preMode=await anchor(); await mode(true); await stable(preMode);
  const portrait=await rects();
  assert.equal(portrait.visibility,'visible');
  assert.ok(portrait.right.top>=portrait.viewer.bottom-1);
  assert.ok(portrait.viewer.width>normal.viewer.width+100);
  assert.ok(portrait.right.width>500);
  assert.equal(await page.locator('#practice-review-targets button').count(),5);
  await shot('900-portrait-review');
  await page.locator('#zoom-value').fill('150'); await page.locator('#zoom-value').press('Enter');
  await page.locator('.practice-choice-area').first().waitFor();
  const attemptBefore=(await api(`/api/revisions/${revision}/practice-prototype`)).questions;
  await mode(false); await mode(true);
  assert.equal(await page.locator('#zoom-value').inputValue(),'150%');
  assert.deepEqual((await api(`/api/revisions/${revision}/practice-prototype`)).questions,attemptBefore);
  await page.locator('#practice-close').click();
  await page.locator('#reader-more-toggle').click();
  await page.locator('#zoom-value').fill('100'); await page.locator('#zoom-value').press('Enter');
  await page.locator('#reader-more-toggle').click();
  await go(29);
  // Open the existing Assistant draft through the real OCR selection affordance.
  const overlay=(await api(`/api/revisions/${revision}/overlay?page=29`)).page;
  const line=overlay.lines.find(l=>l.cells.length>12 && l.quad[0][1]>.15 && l.quad[0][1]<.4);
  const box=await page.locator('.page[data-index="29"]').boundingBox();
  const y=box.y+(line.quad[0][1]+line.quad[2][1])/2*box.height;
  const x1=box.x+line.cells[0][0]*box.width, x2=box.x+line.cells[6][1]*box.width;
  await page.mouse.move(x1,y); await page.mouse.down(); await page.mouse.move(x2,y,{steps:8}); await page.mouse.up();
  await page.mouse.click((x1+x2)/2,y,{button:'right'});
  await page.locator('#ask-selection').click();
  await page.locator('#assistant-panel').waitFor();
  const assistant=await rects(); assert.ok(assistant.right.top>=assistant.viewer.bottom-1);
  await shot('900-portrait-assistant');
  assert.deepEqual(await marks(29),savedMarks);
  await page.locator('#back-to-library').click(); await open();
  assert.equal(await page.locator('#reading-portrait').isChecked(),true);
  await page.reload(); await open();
  assert.equal(await page.locator('#reading-portrait').isChecked(),true);
  await mode(false);
  await page.setViewportSize({width:1440,height:1000}); await go(29);
  await page.locator('#outline-toggle').click();
  assert.equal(await page.locator('#portrait-directory-edge').isVisible(),false);
  assert.equal(await page.locator('#portrait-directory-pin').isVisible(),false);
  await shot('landscape-restored');
  assert.deepEqual(errors,[]);
  assert.equal((await api('/api/assistant/inspection')).calls.length,0);
  console.log('Portrait smoke PASS',JSON.stringify({normalWidth:normal.viewer.width,portraitWidth:portrait.viewer.width,masterWidth:portrait.right.width,artifacts:root}));
} catch(error) {
  console.log('Browser errors:',JSON.stringify(errors));
  await page?.screenshot({path:path.join(root,'failure.jpg')}).catch(()=>{});
  console.log('Failure screenshot:',path.join(root,'failure.jpg')); throw error;
} finally {await browser?.close(); server?.kill();}
