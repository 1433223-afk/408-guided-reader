// Run against an already prepared, isolated LAN demo; never point at a daily library.
// READER_TABLET_CONNECTION is a private JSON file {url}; credentials are never logged.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const connection = JSON.parse(await readFile(process.env.READER_TABLET_CONNECTION || '.tmp/tablet-connection.json', 'utf8'));
const artifacts = path.resolve('test-results/tablet');
await mkdir(artifacts, {recursive:true});
const browser = await chromium.launch({headless:true, executablePath:process.env.READER_CHROMIUM || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const context = await browser.newContext({viewport:{width:1200,height:800}, screen:{width:1200,height:800}, deviceScaleFactor:1.5, hasTouch:true, isMobile:true});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const client = await context.newCDPSession(page);
const touch = (type, points) => client.send('Input.dispatchTouchEvent', {type,touchPoints:points.map(([x,y,id=1])=>({x,y,id,radiusX:2,radiusY:2,force:1}))});
const wait = ms => page.waitForTimeout(ms);
const position = () => page.evaluate(() => {
  const v=document.getElementById('viewer'), pages=[...document.querySelectorAll('#pages > .page')];
  const y=v.scrollTop+1;
  const p=pages.find(p=>p.offsetTop+p.offsetHeight>y) || pages.at(-1);
  return {page:Number(p.dataset.index),offset:(y-p.offsetTop)/p.offsetHeight,zoom:document.getElementById('zoom-value').value};
});
async function open() {
  await page.locator('.book-card .book-open').first().tap();
  await page.locator('.overview-book-heading .primary-action').tap();
  await page.locator('#reader').waitFor({state:'visible'});
  await page.waitForFunction(()=>!!document.querySelector('.page canvas'));
  await wait(500);
}
async function go(number) {
  await page.locator('#page-number').fill(String(number));
  await page.locator('#page-number').press('Enter');
  await page.locator(`.page[data-index="${number-1}"] canvas`).waitFor();
  await wait(350);
}
try {
  await page.goto(connection.url);
  await page.waitForSelector('.book-card');
  assert.equal(await page.evaluate(()=>isSecureContext),false,'Exercise real LAN HTTP');
  await open();
  await page.locator('#reader-more-toggle').tap();
  await page.locator('#zoom-value').fill('100%');
  await page.locator('#zoom-value').press('Enter');
  await page.locator('#reader-more-toggle').tap();
  await wait(350);
  await go(20);
  await page.screenshot({path:path.join(artifacts,'landscape-reading.png')});
  const beforeScroll = await position();
  await touch('touchStart',[[600,560]]);
  for(let y=540;y>=310;y-=23) {await touch('touchMove',[[600,y]]); await wait(18);}
  await touch('touchEnd',[]);
  await wait(500);
  const afterScroll = await position();
  assert.ok(afterScroll.page>beforeScroll.page || afterScroll.offset>beforeScroll.offset+.08,'Native finger scroll moves the real PDF');
  assert.equal(await page.locator('#selection-actions').isVisible(),false,'Scroll must not turn into selection');

  const beforeRotate = await position();
  await page.setViewportSize({width:800,height:1200});
  await wait(800);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('tablet-portrait')),true);
  const afterRotate = await position();
  assert.equal(afterRotate.page,beforeRotate.page);
  assert.ok(Math.abs(afterRotate.offset-beforeRotate.offset)<.015,`Rotation offset ${beforeRotate.offset} -> ${afterRotate.offset}`);
  await page.screenshot({path:path.join(artifacts,'portrait-reading.png')});

  await page.locator('#outline-toggle').tap();
  await page.locator('#outline-tree .outline-target').first().waitFor();
  await page.screenshot({path:path.join(artifacts,'portrait-directory.png')});
  assert.equal(await page.locator('#tablet-directory-scrim').isVisible(),true);
  const fold=page.locator('#outline-tree .outline-fold').first();
  const expanded=await fold.getAttribute('aria-expanded');
  if(expanded==='false') {await fold.tap();assert.equal(await fold.getAttribute('aria-expanded'),'true');}
  await page.locator('#outline-tree .outline-target:not([disabled])').nth(1).tap();
  assert.equal(await page.locator('#outline-panel').isVisible(),false,'Jump closes touch drawer');
  await go(20);

  // Touch the center of a real OCR line visible on the rendered textbook page.
  const line = await page.evaluate(()=> {
    const v=document.getElementById('viewer').getBoundingClientRect();
    const lines=[...document.querySelectorAll('.ocr-line')].map(n=>({n,r:n.getBoundingClientRect()}));
    const hit=lines.find(({n,r})=>n.textContent.length>12 && r.top>v.top+80 && r.bottom<v.bottom-120 && r.width>100);
    if(!hit) return null;
    return {x:Math.round(hit.r.left+hit.r.width*.25),y:Math.round(hit.r.top+hit.r.height/2),end:Math.round(hit.r.left+hit.r.width*.8)};
  });
  assert.ok(line,'Real prepared OCR must be selectable');
  await touch('touchStart',[[line.x,line.y]]);
  await wait(500);
  await touch('touchMove',[[line.end,line.y]]);
  await touch('touchEnd',[]);
  await wait(150);
  assert.equal(await page.locator('#selection-actions').isVisible(),true,'Long hold exposes Assistant action');
  assert.ok(await page.locator('.selection-quad').count());
  await page.screenshot({path:path.join(artifacts,'portrait-selection.png')});
  const aiStatus = await page.evaluate(async()=>await(await fetch('/api/assistant/status')).json());
  console.log(JSON.stringify({providers:aiStatus.providers?.map(p=>({provider:p.provider,model:p.model,configured:p.configured}))}));
  await page.locator('#ask-selection').tap();
  await page.locator('#assistant-panel').waitFor({state:'visible'});
  await wait(400);
  const portraitLayout=await page.evaluate(()=>{
    const v=document.getElementById('viewer').getBoundingClientRect(),a=document.getElementById('assistant-panel').getBoundingClientRect();
    return {viewerBottom:v.bottom,aiTop:a.top,aiWidth:a.width};
  });
  assert.ok(portraitLayout.aiTop>=portraitLayout.viewerBottom-1);
  assert.ok(portraitLayout.aiWidth>780);
  await page.screenshot({path:path.join(artifacts,'portrait-assistant.png')});

  await page.setViewportSize({width:1200,height:800});
  await wait(700);
  const landscapeLayout=await page.evaluate(()=>{
    const v=document.getElementById('viewer').getBoundingClientRect(),a=document.getElementById('assistant-panel').getBoundingClientRect();
    return {viewerRight:v.right,aiLeft:a.left,aiWidth:a.width};
  });
  assert.ok(landscapeLayout.aiLeft>=landscapeLayout.viewerRight-1);
  assert.ok(landscapeLayout.aiWidth>=336);
  await page.screenshot({path:path.join(artifacts,'landscape-assistant.png')});
  // Optional real call: only the allowed, resolved provider may run.
  if(process.env.READER_TABLET_REAL_AI==='1') {
    const selected=await page.locator('#assistant-model').inputValue();
    assert.ok(['deepseek','zhipu'].includes(selected));
    const start=page.locator('#assistant-start');
    if(await start.isVisible()) await start.tap();
    await page.locator('.assistant-answer-bubble').first().waitFor({timeout:90000});
    await page.locator('#assistant-follow-up').waitFor({state:'visible',timeout:90000});
    await page.waitForFunction(()=>!document.querySelector('.assistant-pending,.assistant-stream-turn'),{},{timeout:90000});
    await page.locator('#assistant-question').fill('用一句话概括。');
    await page.locator('#assistant-send').tap();
    await page.waitForFunction(()=>document.querySelectorAll('.assistant-answer-bubble').length>=2,{},{timeout:90000});
    await page.waitForFunction(()=>!document.querySelector('.assistant-pending,.assistant-stream-turn'),{},{timeout:90000});
    await page.screenshot({path:path.join(artifacts,'landscape-assistant-answer.png')});
    await page.setViewportSize({width:800,height:1200});
    await wait(700);
    await page.screenshot({path:path.join(artifacts,'portrait-assistant-answer.png')});
    await page.setViewportSize({width:1200,height:800});
    await wait(700);
  }
  await page.locator('#assistant-close').tap();
  await wait(400);
  const beforePinch=Number((await page.locator('#zoom-value').inputValue()).replace('%',''));
  await touch('touchStart',[[460,400,1],[680,400,2]]);
  for(let d=0;d<60;d+=10) {await touch('touchMove',[[460-d,400,1],[680+d,400,2]]); await wait(20);}
  await touch('touchEnd',[]);
  await wait(650);
  const afterPinch=Number((await page.locator('#zoom-value').inputValue()).replace('%',''));
  assert.ok(afterPinch>beforePinch+10,`Pinch ${beforePinch} -> ${afterPinch}`);
  assert.equal(await page.locator('#pages').evaluate(n=>n.style.transform),'');
  // Keep the tail of one page at the top while the next is also visible.
  await page.evaluate(()=>{
    const page=document.querySelector('.page[data-index="19"]');
    document.getElementById('viewer').scrollTop=page.offsetTop+page.offsetHeight*.85;
  });
  await wait(400);
  const saved=await position();
  await page.reload();
  await open();
  const restored=await position();
  assert.equal(restored.page,saved.page);
  assert.equal(restored.zoom,saved.zoom);
  assert.ok(Math.abs(restored.offset-saved.offset)<.015);
  const desktopUrl=new URL(connection.url);
  desktopUrl.searchParams.delete('tablet');
  await page.goto(desktopUrl.href);
  await page.waitForSelector('.book-card');
  await open();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('tablet')),false);
  assert.equal(await page.locator('.toolbar').evaluate(n=>n.getBoundingClientRect().height),68);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',checks:['real textbook','native finger scroll','rotation anchor','touch directory','long hold OCR','Assistant portrait/landscape','pinch','two-page refresh position','desktop opt-in isolation'],screenshots:artifacts}));
} catch (error) {
  await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});
  console.error(JSON.stringify({pageErrors:errors}));
  throw error;
} finally {
  await browser.close();
}
