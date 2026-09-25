import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the prepared real-book Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-practice-memory-'));
const dataDir = path.join(root, 'data');
await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive:true});
const backup = spawnSync('python', ['-c', 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide:true,encoding:'utf8'});
assert.equal(backup.status, 0, backup.stderr);

let server, browser;
try {
  server = spawn('python', ['-m','reader_service','--no-open','--port','0','--data-dir',dataDir], {
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
      GUIDED_READER_MASTER_PROVIDER:'deepseek',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'},
  });
  let stderr=''; server.stderr.on('data',chunk=>{stderr+=chunk;});
  const url=await new Promise((resolve,reject)=>{
    let stdout='';const timer=setTimeout(()=>reject(Error(stderr||'server start timeout')),30000);
    server.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/READY (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    server.once('exit',()=>{clearTimeout(timer);reject(Error(stderr||'server exited'));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const hintRequests=[];
  const hintResponses=[];
  page.on('request',request=>{
    if(/\/practice-prototype\/hint\//.test(request.url())) hintRequests.push(JSON.parse(request.postData()));
  });
  page.on('response',response=>{
    if(/\/practice-prototype\/hint\//.test(response.url())) hintResponses.push(response.status());
  });
  await page.goto(url);
  const status=await page.evaluate(async()=> (await fetch('/api/assistant/status')).json());
  const deepseek=status.providers.find(item=>item.provider==='deepseek');
  assert.equal(deepseek?.model,'deepseek-flash','live calls require the approved native DeepSeek model');
  assert.equal(deepseek?.configured,true,'native DeepSeek must be configured for live Hint verification');
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#page-number').fill('20');await page.locator('#page-number').press('Enter');
  await page.locator('.page[data-index="19"] .practice-entry').waitFor({timeout:30000});
  await page.locator('.page[data-index="19"] .practice-entry').click();
  await page.locator('#practice-question-list button').nth(6).click();
  assert.equal(await page.locator('#practice-number').innerText(),'07');
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'),'false');
  const hints=[];
  for(let count=1;count<=3;count++) {
    await page.locator('#practice-hint-button').click();
    try { await page.waitForFunction(expected=>document.querySelectorAll('#practice-hint p').length===expected,count,{timeout:60000}); }
    catch(error) { throw Error(`${error.message}; hint statuses=${hintResponses}; button=${await page.locator('#practice-hint-button').innerText()}; rail=${(await page.locator('#practice-panel').innerText()).slice(0,500)}; page errors=${errors}; server=${stderr.slice(-500)}`); }
    hints.push((await page.locator('#practice-hint p').nth(count-1).innerText()).replace(/^提示 \d+/, '').trim());
  }
  assert.equal(new Set(hints).size,3,'Hints should advance instead of repeating verbatim');
  assert.deepEqual(hintRequests.map(request=>request.previous_hints.length),[0,1,2]);
  assert.ok(hintRequests.every(request=>!JSON.stringify(request).includes('official_answer')&&!JSON.stringify(request).includes('official_explanation')));
  const inspection=await page.evaluate(async()=> (await fetch('/api/assistant/inspection')).json());
  const providerHints=inspection.calls.filter(call=>call.interaction_id.startsWith('practice-hint:'));
  assert.equal(providerHints.length,3);
  for(const call of providerHints) {
    assert.equal(call.provider,'deepseek');
    const payload=JSON.parse(call.request_body.messages[1].content);
    assert.equal(payload.source.pages.length,1);
    assert.equal(payload.source.pages[0].pdf_page_number,21);
    assert.equal(Object.hasOwn(payload.source,'official_answer'),false);
    assert.equal(Object.hasOwn(payload.source,'official_explanation'),false);
    assert.equal(Object.hasOwn(payload.source,'last_correct'),false);
  }
  assert.equal(await page.locator('#practice-hint-button').innerText(),'再给一个提示');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/practice-hints-q7.png'});
  await page.locator('#practice-favorite').click();
  await page.locator('#practice-favorite[aria-pressed="true"]').waitFor();
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('#memory-library-view [data-memory-mode="practice"]').click();
  await page.locator('.memory-book-open').click();
  assert.match(await page.locator('.memory-chapter h2').first().innerText(),/第.?1.?章/);
  const q7=page.locator('.memory-item-open').filter({hasText:'第 07 题'});
  await q7.click();
  await page.locator('#memory-detail').filter({hasText:'第 07 题'}).waitFor();
  assert.match(await page.locator('#memory-detail').innerText(),/尚未作答/);
  await page.screenshot({path:'test-results/practice-memory-q7.png'});
  await page.getByRole('button',{name:'回到原题'}).click();
  await page.locator('#reader.practice-active').waitFor();
  assert.equal(await page.locator('#practice-number').innerText(),'07');
  assert.equal(await page.locator('#reader').evaluate(node=>node.classList.contains('practice-active')),true);
  assert.equal(await page.locator('#practice-favorite').getAttribute('aria-pressed'),'true');
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('.memory-book-open').click();
  await page.locator('.memory-item-open').filter({hasText:'第 07 题'}).click();
  await page.locator('#memory-detail').filter({hasText:'第 07 题'}).waitFor();
  const q5=page.locator('.memory-item-open').filter({hasText:'第 05 题'});
  await q5.click();
  await page.locator('#memory-detail').filter({hasText:'第 05 题'}).waitFor();
  await page.getByRole('button',{name:'继续复盘'}).click();
  await page.locator('#practice-number').filter({hasText:'05'}).waitFor();
  assert.equal(await page.locator('#practice-number').innerText(),'05');
  await page.locator('#master-title').filter({hasText:/第 5 题/}).waitFor();
  assert.ok(await page.locator('#master-history .assistant-answer-bubble').count()>=1);
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator('.memory-book-open').click();
  await page.locator('.memory-item-open').filter({hasText:'第 07 题'}).click();
  await page.locator('#memory-detail').filter({hasText:'第 07 题'}).waitFor();
  await page.locator('#memory-detail .memory-more > summary').click();
  await page.getByRole('button',{name:'取消收藏'}).click();
  await page.locator('.memory-item-open').filter({hasText:'第 07 题'}).waitFor({state:'detached'});
  assert.equal(await page.locator('.memory-item-open').filter({hasText:'第 07 题'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('practice memory + 3 live Hints real-book smoke PASS');
  console.log(JSON.stringify({provider:'deepseek',model:deepseek.model,hints},null,2));
} finally {
  if(browser)await browser.close();
  if(server&&server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done;}
}
