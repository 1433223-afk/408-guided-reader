import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, rm, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('Set READER_DATA_DIR to a prepared library with a retained Master thread');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-composer-'));
const dataDir = path.join(temporary, 'data');
await cp(source, dataDir, {recursive:true});
let browser;
const service = spawn('python', ['-m','reader_service','--no-open','--port','0','--data-dir',dataDir],
  {windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,
    GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1'}});
try {
  const url = await new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>reject(new Error('Service startup timed out')),30000);
    let output=''; service.stdout.on('data', chunk => { output+=chunk; const match=output.match(/READY (http:\/\/\S+)/); if(match){clearTimeout(timeout);resolve(match[1]);} });
    service.on('exit', code => {clearTimeout(timeout);reject(new Error(`Service exited ${code}`));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  const data=await page.evaluate(async()=>{
    const books=await (await fetch('/api/books')).json(); const book=books.books.find(b=>b.active_revision?.page_count===348);
    const revision=book.active_revision.id;
    return {revision, learning:await (await fetch(`/api/revisions/${revision}/learning`)).json()};
  });
  const point=data.learning.points.find(p=>p.thread_id);
  assert.ok(point, 'A retained Master thread is required');
  await page.locator('#page-number').fill(String(point.display_end_page+1));
  await page.locator('#page-number').press('Enter');
  const marker=page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`).filter({hasText:point.title}).first();
  await marker.locator('summary').click();
  await marker.getByRole('button',{name:'继续 Master 对话',exact:true}).click();
  await page.locator('#master-form').waitFor({state:'visible'});
  assert.equal(await page.locator('#master-mode').isHidden(),true);
  assert.equal(await page.locator('#master-review-trigger').textContent(),'标准 ▾');
  await page.locator('#master-review-trigger').click();
  await page.locator('#master-review-options [data-value="Deep"]').click();
  assert.equal(await page.locator('#master-mode').inputValue(),'Deep');
  await page.locator('#master-review-trigger').click();
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#master-mode').inputValue(),'Fast');
  await page.locator('#master-review-trigger').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#master-review-options').isHidden(),true);
  assert.equal(await page.locator('#master-review-trigger').evaluate(el=>el===document.activeElement),true);
  await page.locator('#master-review-trigger').click();
  await page.locator('#master-review-options [data-value="Standard"]').click();
  const captured=[];
  await page.route('**/learning/*/send', async route=>{
    captured.push(route.request().postDataJSON());
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试暂不可用，草稿保留'})});
  });
  await page.locator('#master-question').fill('请解释这个概念');
  await page.locator('#master-send').click();
  await page.locator('#master-status').filter({hasText:'测试暂不可用'}).waitFor();
  assert.equal(captured[0].review_mode,'Standard');
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  const typography=await page.evaluate(()=>Object.fromEntries(['master-question','assistant-question'].map(id=>{
    const s=getComputedStyle(document.getElementById(id)); return [id,{family:s.fontFamily,size:s.fontSize,line:s.lineHeight}];
  })));
  assert.deepEqual(typography['master-question'],typography['assistant-question']);
  assert.equal(typography['master-question'].size,'15px');
  await page.locator('#master-review-trigger').click();
  const positions=await page.evaluate(()=>{
    const menu=document.querySelector('#master-review-options').getBoundingClientRect();
    const trigger=document.querySelector('#master-review-trigger').getBoundingClientRect();
    return {above:menu.bottom<=trigger.top,onscreen:menu.top>=0&&menu.right<=innerWidth};
  });
  assert.deepEqual(positions,{above:true,onscreen:true});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/master-composer-polish.png'});
  await page.keyboard.press('Escape');
  await page.locator('.dock-tabs button').first().click();
  await page.locator('.dock-tabs button').nth(1).click();
  assert.equal(await page.locator('#master-mode').inputValue(),'Standard');
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  assert.deepEqual(errors,[]);
  // Layout-only long-content fixture; never persisted or sent to a provider.
  await page.locator('#master-history').evaluate(history => {
    const message=document.createElement('article'); message.className='master-message';
    for(let i=0;i<60;i++) { const p=document.createElement('p'); p.textContent=`滚动布局验证 ${i+1}：长内容应在工作区右侧滚动，正文保持居中。`; message.append(p); }
    history.append(message); history.scrollTop=80;
  });
  const dockWidth=await page.locator('#assistant-panel').evaluate(el=>el.getBoundingClientRect().width);
  await page.locator('#master-expand').click();
  assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('assistant-expanded')),true);
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#master-history').evaluate(el=>Math.round(el.getBoundingClientRect().right)),1440);
  assert.ok(await page.locator('#master-history').evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.locator('#master-history').hover(); await page.mouse.wheel(0,500);
  await page.waitForFunction(()=>document.querySelector('#master-history').scrollTop>80);
  await page.screenshot({path:'test-results/master-expanded-edge-scroll.png'});
  await page.locator('.dock-tabs button').first().click();
  assert.equal(await page.locator('#assistant-expand').getAttribute('aria-pressed'),'true');
  await page.locator('.dock-tabs button').nth(1).click();
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  await page.locator('#master-expand').click();
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#assistant-panel').evaluate(el=>el.getBoundingClientRect().width),dockWidth);
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  console.log(JSON.stringify({status:'PASS',typography,reviewModes:'Fast/Standard/Deep',sendMode:'Standard',failureDraftPreserved:true,externalProviderCalls:0}));
} finally {
  if(browser) await browser.close();
  service.kill(); await new Promise(resolve=>service.exitCode!==null?resolve():service.once('exit',resolve));
  await rm(temporary,{recursive:true,force:true});
}
