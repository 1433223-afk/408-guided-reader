// Survey only. Use the disposable snapshot made by tools/profile_reader_performance.py.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';

const source=path.resolve(process.env.READER_PERF_SNAPSHOT || '.');
assert.ok(source.toLowerCase().startsWith((path.resolve(os.tmpdir())+path.sep).toLowerCase()),
  'Use a disposable snapshot under the system temporary directory');
const root=path.dirname(source);
assert.notEqual(process.env.READER_PERF_DESTROY,'1','PDF disposal is now in the product; do not inject the obsolete experiment');
const dpr=Number(process.env.READER_PERF_DPR||1),rounds=Number(process.env.READER_PERF_ROUNDS||5);
const rangeChunk=Number(process.env.READER_PERF_RANGE_CHUNK||0);
const demand=process.env.READER_PERF_DEMAND==='1';
const result={dpr,rounds,rangeChunk,demand,stages:[],requests:{},errors:[]};
const started=performance.now();
const service=spawn('python',['-m','reader_service','--no-open','--port','0','--data-dir',source],{
  windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'},
});
service.stderr.resume();
let browser,page;
try {
  const ready=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Startup timeout')),30000);
    service.stdout.on('data',data=>{output+=data;const match=output.match(/READY (http:\/\/\S+)/);
      if(match){clearTimeout(timer);resolve(match[1]);}});
    service.once('exit',()=>{clearTimeout(timer);reject(Error('Service exited'));});
  });
  result.serviceReadyMs=Math.round(performance.now()-started);
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:dpr});
  if(rangeChunk || demand) {
    const app=await readFile('src/reader_service/static/app.js','utf8');
    assert.ok(app.includes('pdfSession.open({'));
    await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',
      body:app.replace('pdfSession.open({',`pdfSession.open({${rangeChunk?`rangeChunkSize:${rangeChunk},`:''}${demand?'disableAutoFetch:true,disableStream:true,':''}`)}));
  }
  page=await context.newPage();page.setDefaultTimeout(45000);
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.addInitScript(()=>{
    window.__perfLongTasks=[];
    new PerformanceObserver(list=>window.__perfLongTasks.push(...list.getEntries().map(
      entry=>({start:entry.startTime,ms:entry.duration})))).observe({type:'longtask',buffered:true});
  });
  const cdp=await context.newCDPSession(page);
  const browserCdp=await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');await cdp.send('Network.enable');
  const requests=new Map();
  cdp.on('Network.requestWillBeSent',event=>{
    const url=new URL(event.request.url);
    const name=url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g,':id');
    requests.set(event.requestId,{name,start:event.timestamp});
    const row=result.requests[name] ||= {count:0,bytes:0,decodedBytes:0,declaredBytes:0,ms:[]};row.count++;
  });
  cdp.on('Network.responseReceived',event=>{
    const request=requests.get(event.requestId);if(!request)return;
    const headers=event.response.headers;
    result.requests[request.name].declaredBytes+=Number(headers['Content-Length']||headers['content-length']||0);
  });
  cdp.on('Network.dataReceived',event=>{
    const request=requests.get(event.requestId);if(request)result.requests[request.name].decodedBytes+=event.dataLength;
  });
  cdp.on('Network.loadingFinished',event=>{
    const request=requests.get(event.requestId);if(!request)return;
    const row=result.requests[request.name];row.bytes+=event.encodedDataLength;
    row.ms.push(Math.round((event.timestamp-request.start)*1000));
  });
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const settle=async index=>{
    await page.locator(`.page[data-index="${index}"]:not(.loading) canvas`).waitFor();
    await page.waitForFunction(index=>{
      const canvas=document.querySelector(`.page[data-index="${index}"] canvas`);
      if(!canvas?.width)return false;
      const probe=document.createElement('canvas');probe.width=probe.height=32;
      const ctx=probe.getContext('2d');ctx.drawImage(canvas,0,0,32,32);
      const data=ctx.getImageData(0,0,32,32).data;
      let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]<210&&data[i+3])ink++;
      return ink>10;
    },index);
    await frame();
  };
  const snapshot=async(name,ms=null)=>{
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const dom=await page.evaluate(()=>({
      canvases:[...document.querySelectorAll('#pages canvas')].map(c=>({width:c.width,height:c.height})),
      pages:document.querySelectorAll('#pages .page').length,
      overlayNodes:document.querySelectorAll('.text-overlay *').length,
      longTasks:window.__perfLongTasks.splice(0),
    }));
    const processes=(await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
    const rss=spawnSync('python',['-c',
      'import json,sys,psutil; print(json.dumps({p:psutil.Process(p).memory_info().rss for p in map(int,sys.argv[1:]) if psutil.pid_exists(p)}))',
      ...processes.map(p=>String(p.id))],{windowsHide:true,encoding:'utf8'});
    const rssMiB=rss.status===0 ? Object.values(JSON.parse(rss.stdout)).reduce((sum,n)=>sum+n,0)/1024**2 : null;
    const stage={name,ms,workers:page.workers().length,rssMiB,metrics,dom};result.stages.push(stage);
    if(name.startsWith('open-')) assert.equal(stage.workers,1,'only the active PDF worker should remain');
    if(name.startsWith('closed-')) assert.equal(stage.workers,0,'closing must release the PDF worker');
    console.log(name,JSON.stringify({ms,workers:stage.workers,heapMiB:Math.round(metrics.JSHeapUsedSize/1024**2),
      rssMiB:rssMiB===null?null:Math.round(rssMiB),
      canvasMiB:Math.round(dom.canvases.reduce((sum,c)=>sum+c.width*c.height*4,0)/1024**2),
      longestTaskMs:Math.max(0,...dom.longTasks.map(x=>x.ms))}));
  };
  await page.goto(ready);
  await page.locator('.book-card').first().waitFor();
  await snapshot('library-first');
  for(let round=1;round<=rounds;round++) {
    const start=performance.now();
    await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('#reader').waitFor();
    await page.locator('#page-number').fill('51');await page.locator('#page-number').press('Enter');
    await settle(50);
    await page.waitForTimeout(350);
    await snapshot(`open-${round}`,Math.round(performance.now()-start));
    if(round===rounds) break;
    await page.locator('#back-to-library').click();
    await page.locator('#library-home').waitFor();
    await page.waitForTimeout(250);
    await snapshot(`closed-${round}`);
  }
  for(const zoom of (process.env.READER_PERF_ZOOMS||'100,200,400,100').split(',').map(Number)) {
    const start=performance.now();
    await page.locator('#zoom-value').fill(String(zoom));await page.locator('#zoom-value').press('Enter');
    await settle(50);await page.waitForTimeout(250);
    await snapshot(`zoom-${zoom}`,Math.round(performance.now()-start));
  }
  const scroll=await page.evaluate(async()=>{
    const viewer=document.querySelector('#viewer'), deltas=[];let previous=performance.now();
    for(let i=0;i<90;i++) {
      await new Promise(requestAnimationFrame);const now=performance.now();deltas.push(now-previous);previous=now;
      viewer.scrollTop+=90;
    }
    return {frames:deltas.length,p50:deltas.toSorted((a,b)=>a-b)[45],p95:deltas.toSorted((a,b)=>a-b)[85],max:Math.max(...deltas)};
  });
  result.scroll=scroll;await snapshot('after-scroll');
  await page.screenshot({path:path.join(root,'reader-survey.jpg')});
  await page.locator('#page-number').fill('51');await page.locator('#page-number').press('Enter');
  await settle(50);
  if(await page.locator('#assistant-toggle').isVisible()) {
    const start=performance.now();await page.locator('#assistant-toggle').click();await frame();
    await snapshot('assistant-open',Math.round(performance.now()-start));
  } else result.assistantProbe='No existing temporary topic; measured separately with a real selection';
  result.aiCalls=await page.evaluate(async()=>((await(await fetch('/api/assistant/inspection')).json()).calls || []).length);
  assert.equal(result.aiCalls,0);
  if(process.env.READER_PERF_IDLE==='1') {
    const processInfo=()=>JSON.parse(spawnSync('python',['-c',
      'import psutil,json,sys; p=psutil.Process(int(sys.argv[1])); t=p.cpu_times(); print(json.dumps({"cpu":t.user+t.system,"rssMiB":p.memory_info().rss/1024**2,"threads":p.num_threads()}))',
      String(service.pid)],{windowsHide:true,encoding:'utf8'}).stdout);
    await new Promise(resolve=>setTimeout(resolve,1500));
    const before=processInfo();const countBefore=Object.values(result.requests).reduce((sum,x)=>sum+x.count,0);
    await new Promise(resolve=>setTimeout(resolve,5000));
    const after=processInfo();
    result.idleServer={before,after,seconds:5,oneCoreCpuPercent:(after.cpu-before.cpu)/5*100,
      newRequests:Object.values(result.requests).reduce((sum,x)=>sum+x.count,0)-countBefore};
  }
  assert.deepEqual(result.errors,[]);
  const filename=rangeChunk||demand?`browser-range-${rangeChunk}${demand?'-demand':''}.json`:dpr!==1?`browser-dpr-${dpr}.json`:'browser.json';
  await writeFile(path.join(root,filename),JSON.stringify(result,null,2));
  console.log('Browser survey artifacts:',root);
} catch(error) {
  result.failure=error.message;
  await writeFile(path.join(root,'browser-partial.json'),
    JSON.stringify(result,null,2)).catch(()=>{});
  await page?.screenshot({path:path.join(root,'survey-failure.jpg')}).catch(()=>{});
  console.log('Survey failure artifacts:',root);throw error;
} finally {await browser?.close();service.kill();}
