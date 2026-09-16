import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-memory-'));
const dataDir = path.join(root, 'data'); await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), { recursive: true });
const sql = (code, args = []) => {
  const result = spawnSync('python', ['-c', code, ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
sql('import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()', [path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')]);
const db = path.join(dataDir, 'state.sqlite3');
let running, browser;
const start = async () => {
  const child = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1' },
  });
  let errors = ''; child.stderr.on('data', v => { errors += v; });
  const url = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error(errors)), 30000);
    child.stdout.on('data', v => { output += v; const match = output.match(/READY (http:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(errors)); });
  });
  return { child, url };
};
const stop = async () => { if (running && running.child.exitCode === null) { const done = new Promise(resolve => running.child.once('exit', resolve)); running.child.kill(); await done; } };
try {
  running = await start();
  browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(running.url);
  await page.locator('.continue-stats').waitFor();
  const books=await page.evaluate(async()=> (await(await fetch('/api/books')).json()).books);
  const recent=books.filter(b=>b.active_revision?.position.updated_at).sort((a,b)=>b.active_revision.position.updated_at.localeCompare(a.active_revision.position.updated_at))[0];
  const r=recent.active_revision, pos=r.position;
  const context=await page.evaluate(async ({id,p})=>(await(await fetch(`/api/revisions/${id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`)).json()),{id:r.id,p:pos});
  await page.waitForFunction(()=>!document.querySelector('.continue-stats').textContent.includes('正在'));
  assert.equal(await page.locator('.continue-location').textContent(),context.subsection?.title || context.section?.title || context.chapter?.title || '继续阅读教材');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/home-continue-default.png'});
  const box=await page.locator('.continue-location').boundingBox();
  await page.mouse.move(box.x+30,box.y+15);
  await page.waitForTimeout(150);
  await page.screenshot({path:'test-results/home-continue-hover.png'});
  await page.locator('.continue-progress').screenshot({path:'test-results/home-continue-progress.png'});
  const spine=await page.locator('.book-spine').first().evaluate(el=>({family:getComputedStyle(el).fontFamily,writing:getComputedStyle(el).writingMode,size:getComputedStyle(el).fontSize}));
  assert.ok(spine.family.startsWith('"Microsoft YaHei UI"'));
  assert.equal(spine.writing,'horizontal-tb');
  assert.equal(await page.locator('.book-cover').filter({hasText:/[\u4e00-\u9fff]/}).count(),0);
  assert.equal(await page.locator('.book-spine[data-cover-variant=ds]').count(),1);
  assert.equal(await page.locator('.book-spine[data-cover-variant=coa]').count(),1);
  await page.screenshot({path:'test-results/home-abstract-covers.png'});
  assert.equal(spine.size,'13px');
  await page.mouse.click(box.x+30,box.y+15);
  await page.locator('#reader').waitFor({state:'visible'});
  await page.locator(`.page[data-index="${pos.pdf_page_index}"] canvas`).waitFor({timeout:30000});
  await page.waitForFunction(p=>Number(document.querySelector('#page-number').value)===p+1,pos.pdf_page_index);
  await page.waitForTimeout(1200);
  const restored=await page.evaluate(index=>{const p=document.querySelector(`.page[data-index="${index}"]`);return (document.querySelector('#viewer').scrollTop-p.offsetTop)/p.offsetHeight;},pos.pdf_page_index);
  assert.ok(Math.abs(restored-pos.normalized_offset)<0.003);
  await page.screenshot({path:'test-results/home-continue-reader.png'});
  // A second real source position exercises resolved Section/Subsection projection.
  await page.locator('#page-number').fill('53');
  await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="52"] .text-overlay').waitFor({timeout:30000});
  await page.waitForTimeout(500);
  await page.locator('#back-to-library').click();
  await page.waitForFunction(()=>!document.querySelector('.continue-stats')?.textContent.includes('正在'));
  const resumedBooks=await page.evaluate(async()=> (await(await fetch('/api/books')).json()).books);
  const saved=resumedBooks.find(b=>b.active_revision?.id===r.id).active_revision.position;
  const resolved=await page.evaluate(async ({id,p})=>(await(await fetch(`/api/revisions/${id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`)).json()),{id:r.id,p:saved});
  assert.ok(resolved.section);
  assert.equal(await page.locator('.continue-location').textContent(),resolved.subsection?.title || resolved.section.title);
  await page.screenshot({path:'test-results/home-continue-section.png'});
  await page.locator('.continue-location').waitFor();
  await page.locator('#home-continue .primary-action').focus();
  await page.keyboard.press('Enter');
  await page.locator('#reader').waitFor({state:'visible'});
  await page.locator('#back-to-library').click();
  await page.locator('.continue-overview').click();
  await page.locator('#book-overview').waitFor({state:'visible'});
  assert.equal(await page.locator('#reader').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',book:recent.title,pdf:pos.pdf_page_index+1,offset:pos.normalized_offset,section:context.section?.title,subsection:context.subsection?.title,counts:context.learning_counts,spine,externalProviderCalls:0}));
} finally { if(browser)await browser.close();await stop(); }
