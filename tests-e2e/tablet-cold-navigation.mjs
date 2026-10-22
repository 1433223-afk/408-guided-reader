// Cold chapter navigation and consecutive page turns over actual LAN HTTP.
// Reuses only the disposable, model-blocked Python fixture from full-reader.
// Desktop CPU/network throttling is not evidence of physical Y900 performance.
// Run: node tests-e2e/tablet-cold-navigation.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';
const root=process.cwd();
const source=await readFile('tests-e2e/tablet-full-reader.mjs','utf8');
const python=source.match(/const python = String.raw`([\s\S]*?)`;/)[1];
const address=process.env.READER_TEST_LAN || Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>entries.map(entry=>({name,...entry}))).find(entry=>/wlan|wi-?fi/i.test(entry.name)&&entry.family==='IPv4')?.address;
assert.ok(address && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address), 'Choose an assigned private LAN address');
const temporary=await mkdtemp(path.join(os.tmpdir(),'reader-nav-v2-'));
const token=randomBytes(32).toString('hex'),redact=value=>String(value).replaceAll(token,'[credential]');
const label=process.env.READER_NAV_LABEL || 'current';
assert.match(label,/^[a-z0-9-]+$/);
const artifacts=path.resolve('test-results/tablet-nav-v2',label);await mkdir(artifacts,{recursive:true});
const core=spawn('python',['-u','-c',python],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONPATH:path.join(root,'src'),PYTHONIOENCODING:'utf-8',
  GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1',
  READER_FULL_ROOT:temporary,READER_FULL_LAN:address,READER_FULL_TOKEN:token}});
let output='',stderr='',browser,report,currentPage,observedRequests,observedErrors;
core.stdout.on('data',value=>{output+=value;});core.stderr.on('data',value=>{stderr+=value;});
const fixture=await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('fixture start timeout '+redact(stderr))),90000);
 const check=()=>{const found=output.match(/^FULL_READER (.+)$/m);if(found){clearTimeout(timer);resolve(JSON.parse(found[1]));}};
 core.stdout.on('data',check);core.once('exit',code=>reject(Error('fixture exited '+code+' '+redact(stderr))));check();
});
try {
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1.5,isMobile:true,hasTouch:true});
 await context.route('**/app.js',async route=>{
   const response=await route.fetch(),headers={...response.headers()};
   for(const key of ['content-encoding','content-length','transfer-encoding','etag'])delete headers[key];
   let body=await response.text();
   if(process.env.READER_NAV_APP)body=await readFile(process.env.READER_NAV_APP,'utf8');
   body+='\nwindow.__navTest={state,goToPage};';
   await route.fulfill({status:200,headers,body});
 });
 await context.addInitScript(()=>{
  window.__navTasks=[];new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__navTasks.push({at:entry.startTime,duration:entry.duration,name:entry.name});}).observe({type:'longtask',buffered:true});
  window.__navEvents=[];
 });
 const page=currentPage=await context.newPage(),errors=observedErrors=[],requests=observedRequests=new Map();
 page.on('pageerror',error=>errors.push(redact(error.message)));
 const client=await context.newCDPSession(page);await client.send('Network.enable');
 let phase='boot';
 client.on('Network.requestWillBeSent',event=>{
  const url=new URL(event.request.url);if(!url.pathname.startsWith('/api/'))return;
  requests.set(event.requestId,{phase,path:url.pathname.replace(/\/api\/revisions\/[^/]+/,'/api/revisions/:id'),page:url.searchParams.get('page'),width:url.searchParams.get('width'),start:event.timestamp*1000});
 });
 client.on('Network.responseReceived',event=>{
  const entry=requests.get(event.requestId);if(!entry)return;
  entry.headers=event.timestamp*1000;entry.status=event.response.status;
  const headers=Object.fromEntries(Object.entries(event.response.headers).map(([key,value])=>[key.toLowerCase(),value]));
  entry.server=headers['server-timing'] || null;entry.cache=headers['x-reader-image-cache'] || null;entry.body=Number(headers['content-length']) || null;
 });
 client.on('Network.loadingFinished',event=>{const entry=requests.get(event.requestId);if(entry){entry.end=event.timestamp*1000;entry.encoded=event.encodedDataLength;}});
 client.on('Network.loadingFailed',event=>{const entry=requests.get(event.requestId);if(entry){entry.end=event.timestamp*1000;entry.error=event.errorText;}});
 await page.goto(`http://${address}:${fixture.port}/?tablet=1&token=${token}`);
 await page.locator('.book-card .book-open').tap();await page.locator('.overview-book-heading .primary-action').tap();
 const ready=async (index,full=false)=>page.waitForFunction(({index,full})=>{
  const wrapper=document.querySelector(`.page[data-index="${index}"]`),canvas=wrapper?.querySelector('canvas');
  return canvas?.dataset.readerRenderer && wrapper.querySelector('.ocr-line') && !wrapper.classList.contains('loading')
   && (!full || (canvas.dataset.readerPreview!=='true' && Number(canvas.dataset.readerImageWidth)>=canvas.width));
 },{index,full},{timeout:60000});
 await ready(19);await page.waitForFunction(()=>window.__navTest.state.outlineNodes.length>0);await page.waitForTimeout(1500);
 await client.send('Emulation.setCPUThrottlingRate',{rate:4});
 await client.send('Network.emulateNetworkConditions',{offline:false,latency:70,downloadThroughput:1*1024*1024,uploadThroughput:2*1024*1024,connectionType:'wifi'});
 // Measure navigation after the deliberately changed network profile settles.
 // ERR_NETWORK_CHANGED is separately retained in the earlier failure artifact.
 await page.waitForTimeout(1000);
 const chapters=await page.evaluate(()=>window.__navTest.state.outlineNodes.filter(node=>node.kind==='CHAPTER'&&Number.isInteger(node.start_page)).map(node=>({id:node.outline_node_id,page:node.start_page,y:node.start_y||0})).filter(node=>node.page>40));
 const runs=[];
 async function measure(name,index,action,{full=true}={}){
  phase=name;
  await page.evaluate(index=>{
   const m=window.__navMetric={start:performance.now(),index,paint:null,text:null,final:null,frames:0,blank:0};
   const check=()=>{
    if(window.__navMetric!==m)return;const wrapper=document.querySelector(`.page[data-index="${index}"]`),canvas=wrapper?.querySelector('canvas');
    const box=canvas?.getBoundingClientRect(),view=document.getElementById('viewer').getBoundingClientRect();
    const visible=canvas?.dataset.readerRenderer&&box.bottom>view.top&&box.top<view.bottom;
    m.frames++;if(!visible)m.blank++;
    if(visible){m.paint??=performance.now()-m.start;if(wrapper.querySelector('.ocr-line'))m.text??=performance.now()-m.start;
      if(canvas.dataset.readerPreview!=='true' && Number(canvas.dataset.readerImageWidth)>=canvas.width)m.final??=performance.now()-m.start;}
    requestAnimationFrame(check);
   };requestAnimationFrame(check);
  },index);
  const start=performance.now();await action();await ready(index);
  await page.waitForFunction(()=>window.__navMetric?.text!==null);
  if(full){await ready(index,true);await page.waitForFunction(()=>window.__navMetric?.final!==null);}
  const elapsed=performance.now()-start;
  const metric=await page.evaluate(()=>{const m=window.__navMetric;window.__navMetric=null;return {...m,longtasks:window.__navTasks.filter(entry=>entry.at>=m.start),rendered:[...window.__navTest.state.rendered],pending:[...window.__navTest.state.pageRenderRequests.keys()]};});
  const rows=[...requests.values()].filter(entry=>entry.phase===name).map(entry=>({...entry,ttfb:entry.headers-entry.start,total:entry.end-entry.start}));
  runs.push({name,index,...metric,automation:elapsed,requests:rows});
  console.log(JSON.stringify({name,index,paint:metric.paint,text:metric.text,final:metric.final,longtasks:metric.longtasks.length,requests:rows.length}));
 }
 const far=chapters.at(-2),near=chapters[0];assert.ok(far&&near);
 for(const [name,node] of [['far-chapter',far],['near-chapter',near]]){
  await page.locator('#outline-toggle').tap();await page.locator(`li[data-node-id="${node.id}"] > .outline-row > .outline-target`).waitFor({state:'visible'});
  await measure(name,node.page,()=>page.locator(`li[data-node-id="${node.id}"] > .outline-row > .outline-target`).tap());
 }
 for(let step=1;step<=6;step++)await measure(`continuous-${step}`,near.page+step,()=>page.locator('#next-page').evaluate(button=>button.click()));
 await measure('return-far',far.page,()=>page.evaluate(index=>window.__navTest.goToPage(index),far.page));
 for(let step=0;step<4;step++)await measure(`quick-turn-${step}`,220+step,
  ()=>page.evaluate(index=>window.__navTest.goToPage(index),220+step),{full:false});
 await ready(223,true);
 const fullWidth=await page.locator('.page[data-index="223"] canvas').evaluate(canvas=>({image:Number(canvas.dataset.readerImageWidth),target:canvas.width}));
 assert.ok(fullWidth.image>=fullWidth.target,'Rapid navigation still completes the last requested page at full target detail');
 await page.screenshot({path:path.join(artifacts,'final.png')});
 const checks=await page.evaluate(()=>fetch('/__full-reader_checks').then(response=>response.json()));
 assert.equal(checks.model_calls,0);assert.deepEqual(checks.blocked_requests,[]);assert.deepEqual(errors,[]);
 report={result:'PASS',label,environment:'Actual LAN HTTP, disposable real 348-page / 150MB source + original OCR and learning. Chrome 1200x800 DPR1.5, 4x CPU throttle, 1MiB/s +70ms. Not Y900 hardware.',models:0,runs,errors,allRequests:[...requests.values()],stderr:redact(stderr)};
}catch(error){report={result:'FAIL',error:redact(error.stack || error),stderr:redact(stderr),errors:observedErrors,requests:observedRequests?[...observedRequests.values()]:null,
 debug:await currentPage?.evaluate(()=>({metric:window.__navMetric,state:window.__navTest?{page:window.__navTest.state.currentPage,pinned:window.__navTest.state.pinnedLanding,rendered:[...window.__navTest.state.rendered],requests:[...window.__navTest.state.pageRenderRequests.keys()],preparation:[...window.__navTest.state.preparation].filter(([index])=>index>300).map(([index,row])=>[index,row.status])}:null,
 canvas:[...document.querySelectorAll('.page canvas')].map(canvas=>({index:canvas.parentElement.dataset.index,width:canvas.width,dataset:{...canvas.dataset},overlay:!!canvas.parentElement.querySelector('.text-overlay'),loading:canvas.parentElement.className})),status:document.getElementById('status')?.textContent})).catch(()=>null)};await currentPage?.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{
 await browser?.close();core.kill();await new Promise(resolve=>core.exitCode!==null?resolve():core.once('exit',resolve));
 await writeFile(path.join(artifacts,'result.json'),JSON.stringify(report,null,2));
 const actual=await realpath(temporary),parent=await realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);await rm(actual,{recursive:true,force:true});
}
console.log(JSON.stringify({result:report.result,error:report.error,artifacts}));
