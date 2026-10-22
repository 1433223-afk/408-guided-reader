// Actual LAN HTTP on a disposable copy of the real cached-OCR textbook.
// READER_NAVIGATION_BASELINE=1 uses the ignored pre-change adapter/app snapshot.
// No OCR worker or model exists in this fixture. It never changes the Demo.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const source = await readFile('tests-e2e/tablet-opening.mjs','utf8');
const python = source.match(/const python = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(python,'Reuse the existing isolated, no-model/no-OCR fixture');
const addresses = Object.entries(os.networkInterfaces()).flatMap(([name,values]) => (values || []).map(value => ({name,...value})))
  .filter(value => value.family === 'IPv4' && !value.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address));
const address = process.env.READER_TEST_LAN || addresses.find(value => /wlan|wi-?fi/i.test(value.name))?.address || addresses[0]?.address;
assert.ok(address);
const temporary = await mkdtemp(path.join(os.tmpdir(),'reader-tablet-navigation-'));
const token = randomBytes(32).toString('hex');
const baseline = process.env.READER_NAVIGATION_BASELINE === '1';
const folder = path.resolve('test-results/tablet-page-navigation',baseline ? 'before' : 'after');
await mkdir(folder,{recursive:true});
const core = spawn(process.env.READER_PYTHON || 'python',['-u','-c',python],{cwd:process.cwd(),windowsHide:true,
  stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONPATH:path.join(process.cwd(),'src'),PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',READER_OPENING_ROOT:temporary,
    READER_OPENING_LAN:address,READER_OPENING_TOKEN:token}});
let stdout='',stderr='',browser,report;
core.stdout.on('data',value => {stdout += value.toString();});
core.stderr.on('data',value => {stderr += value.toString();});
try {
  const fixture = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('Fixture did not start')),60000);
    const check=()=>{const match=stdout.match(/^OPENING_FIXTURE (.+)$/m);if(match){clearTimeout(timer);resolve(JSON.parse(match[1]));}};
    core.stdout.on('data',check);core.once('exit',code=>{clearTimeout(timer);reject(new Error(`Fixture exited ${code}`));});check();
  });
  browser = await chromium.launch({headless:true,executablePath:process.env.READER_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1.5,isMobile:true,hasTouch:true});
  await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
    writeText:async value=>{window.__navigationCopied=value;},
  }}));
  if(baseline) for(const file of ['app.js','tablet-pdf-pages.js']) await context.route(`**/${file}`,async route=>{
    const response=await route.fetch(),headers={...response.headers()};
    for(const name of ['content-encoding','content-length','transfer-encoding','etag']) delete headers[name];
    await route.fulfill({status:200,headers,body:await readFile(`.tmp/tablet-render-before/${file}`,'utf8')});
  });
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/page-image'))requests.push({page:Number(url.searchParams.get('page')),width:Number(url.searchParams.get('width')),at:Date.now()});});
  await page.goto(`http://${address}:${fixture.port}/?tablet=1&token=${token}`);
  await page.locator('.book-card .book-open').tap();
  await page.locator('.overview-book-heading .primary-action').tap();
  const ready=async index=>page.waitForFunction(index=>{
    const wrapper=document.querySelector(`.page[data-index="${index}"]`),canvas=wrapper?.querySelector('canvas');
    const rect=canvas?.getBoundingClientRect(),view=document.getElementById('viewer').getBoundingClientRect();
    return canvas?.dataset.readerRenderer && !wrapper.classList.contains('loading') && wrapper.querySelector('.ocr-line')
      && rect.bottom>view.top && rect.top<view.bottom
      && Math.abs(canvas.width-rect.width*devicePixelRatio)<=1
      && Number(canvas.dataset.readerImageWidth)>=canvas.width;
  },index,{timeout:60000});
  await ready(19);
  await page.waitForTimeout(1400);
  const client=await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:70,downloadThroughput:2*1024*1024,uploadThroughput:2*1024*1024,connectionType:'wifi'});
  const runs=[];
  async function measure(label,action,index) {
    requests.length=0;
    await page.evaluate(index=>{
      const metric=window.__navigationMetric={start:performance.now(),blankFrames:0,frames:0,index};
      const check=()=>{if(window.__navigationMetric!==metric)return;metric.frames++;
        const canvas=document.querySelector(`.page[data-index="${index}"] canvas`);
        if(!canvas || !canvas.dataset.readerRenderer)metric.blankFrames++;
        requestAnimationFrame(check);};check();
    },index);
    const started=performance.now();
    await action();
    await ready(index);
    const elapsed=Math.round(performance.now()-started);
    const metric=await page.evaluate(()=>{const result=window.__navigationMetric;window.__navigationMetric=null;return result;});
    const canvas=await page.locator(`.page[data-index="${index}"] canvas`).evaluate(canvas=>({width:canvas.width,imageWidth:Number(canvas.dataset.readerImageWidth),height:canvas.height,imageHeight:Number(canvas.dataset.readerImageHeight)}));
    assert.ok(canvas.imageWidth>=canvas.width,'Never replace the target with a lower-resolution final image');
    runs.push({label,ready_ms:elapsed,blank_frames:metric.blankFrames,frames:metric.frames,requests:[...requests],canvas});
  }
  const zoom=async value=>{
    const current=Number((await page.locator('#zoom-value').inputValue()).replace('%',''));
    const ratio=Number(value.replace('%',''))/current;
    const rect=await page.locator('#viewer').boundingBox(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const dispatch=(type,span)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:span ? [{x:x-span,y,id:1},{x:x+span,y,id:2}] : []});
    await dispatch('touchStart',100);await page.waitForTimeout(30);await dispatch('touchMove',100*ratio);await page.waitForTimeout(70);await dispatch('touchEnd',0);
    await page.waitForFunction(value=>document.getElementById('zoom-value').value===value,value,{timeout:5000});
  };
  await measure('pinch-150',()=>zoom('150%'),19);
  await page.waitForTimeout(1100);
  await measure('pinch-100-return',()=>zoom('100%'),19);
  await page.waitForTimeout(600);
  await measure('pinch-150-return',()=>zoom('150%'),19);
  await page.waitForTimeout(1100);
  await measure('neighbour-page',()=>page.locator('#next-page').evaluate(button=>button.click()),20);
  await measure('back-page',()=>page.locator('#previous-page').evaluate(button=>button.click()),19);
  const selection=await page.evaluate(async revision=>{
    const data=(await(await fetch(`/api/revisions/${revision}/overlay?page=19`)).json()).page;
    const box=document.querySelector('.page[data-index="19"] .text-overlay').getBoundingClientRect();
    const view=document.getElementById('viewer').getBoundingClientRect();
    for(const line of data.lines) {
      const ys=line.quad.map(point=>point[1]),y=box.top+(Math.min(...ys)+Math.max(...ys))/2*box.height;
      if(y<view.top+90 || y>view.bottom-120) continue;
      for(let at=0;at<line.cells.length-3;at++) {
        const cells=line.cells.slice(at,at+3);
        const start=box.left+(cells[0][0]+cells[0][1])/2*box.width;
        const end=box.left+(cells[2][0]+cells[2][1])/2*box.width;
        if(start>view.left+40 && end<view.right-40 && cells.every(cell=>cell[3]-cell[2]===1))
          return {start,end,y,expected:line.text.slice(cells[0][2],cells[2][3])};
      }
    }
  },fixture.revision);
  assert.ok(selection,'A genuine OCR row remains available at the final zoom');
  const pen=(type,x,buttons)=>client.send('Input.dispatchMouseEvent',{type,x,y:selection.y,pointerType:'pen',
    button:type==='mouseMoved'?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1,force:buttons ? .5 : 0});
  await pen('mousePressed',selection.start,1);
  for(let step=1;step<=5;step++) await pen('mouseMoved',selection.start+(selection.end-selection.start)*step/5,1);
  await pen('mouseReleased',selection.end,0);
  await page.locator('#copy-selection').click();
  assert.equal(await page.evaluate(()=>window.__navigationCopied),selection.expected,'Original OCR coordinates stay exact after repeated scaling and returning to a page');
  assert.deepEqual(errors,[]);
  report={result:'PASS',variant:baseline?'before':'after',environment:'Desktop Chrome 1200x800 DPR1.5, actual LAN HTTP, 2MiB/s + 70ms artificial latency; not Y900 hardware',models:0,new_ocr:0,
    post_zoom_pen_selection:'Three original OCR cells copied exactly after three pinches and next/back navigation',runs};
  await page.screenshot({path:path.join(folder,'ready.png')});
} catch(error) {report={result:'FAIL',error:String(error.stack || error)};process.exitCode=1;}
finally {
  await browser?.close();core.kill();await new Promise(resolve=>{if(core.exitCode!==null)resolve();else core.once('exit',resolve);});
  await writeFile(path.join(folder,'result.json'),JSON.stringify(report,null,2));
  const root=await realpath(temporary),parent=await realpath(os.tmpdir());assert.equal(path.dirname(root),parent);await rm(root,{recursive:true,force:true});
}
console.log(JSON.stringify(report));
