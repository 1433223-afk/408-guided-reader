// Cold first paint vs reopen, using an isolated real Library and no AI calls.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {cp,mkdir,mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const source=process.env.READER_DATA_DIR;
const bookPages=Number(process.env.READER_FIRST_BOOK_PAGES||348);
assert.ok(source,'READER_DATA_DIR must name the source Library');
const root=await mkdtemp(path.join(os.tmpdir(),'reader-first-paint-'));
const data=path.join(root,'data');await mkdir(data);
await cp(path.join(source,'blobs'),path.join(data,'blobs'),{recursive:true});
const copied=spawnSync('python',['-c',`import sqlite3,sys,os
from pathlib import Path
s=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)
d=sqlite3.connect(sys.argv[2]);s.backup(d);s.close()
if not os.environ.get('READER_FIRST_PRESERVE_POSITION'): d.execute('UPDATE reading_positions SET zoom=1,pdf_page_index=50,normalized_offset=0')
d.commit();d.close()`,
  path.join(source,'state.sqlite3'),path.join(data,'state.sqlite3')],{windowsHide:true,encoding:'utf8'});
assert.equal(copied.status,0,copied.stderr);
const env={...process.env,GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'};
if(process.env.READER_TEST_PYTHONPATH) env.PYTHONPATH=process.env.READER_TEST_PYTHONPATH;
const launcher=`from pathlib import Path
import reader_service.__main__ as app
factory=app.handler_factory
app.handler_factory=lambda *a,**k: factory(*a,project_root=Path.cwd(),**k)
app.main()`;
const executable=process.env.READER_TEST_CORE || 'python';
const args=process.env.READER_TEST_CORE ? [] : ['-c',launcher];
args.push('--no-open','--port','0','--data-dir',data);
const service=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
service.stderr.resume();let browser,page;
const result={label:process.env.READER_TEST_LABEL||'current',rounds:[],requests:[],errors:[],consoleErrors:[],httpErrors:[]};
try {
  const ready=await new Promise((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(Error('Service startup timeout')),60000);
    service.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/READY (http:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});
    service.once('exit',()=>{clearTimeout(timer);reject(Error('Service exited before READY'));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:process.env.READER_FIRST_HEADED!=='1'});
  page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:Number(process.env.READER_FIRST_DPR||1)});page.setDefaultTimeout(60000);
  const network=await page.context().newCDPSession(page),pdfRequests=new Set();let pdfBytes=0;
  await network.send('Network.enable');
  network.on('Network.responseReceived',event=>{if(new URL(event.response.url).pathname.endsWith('/pdf'))pdfRequests.add(event.requestId);});
  network.on('Network.dataReceived',event=>{if(pdfRequests.has(event.requestId))pdfBytes+=event.encodedDataLength;});
  await page.route('**/app.js',async route=>{
    const response=await route.fetch();const app=process.env.READER_FIRST_APP_SOURCE
      ? await readFile(process.env.READER_FIRST_APP_SOURCE,'utf8') : await response.text();
    const start=app.indexOf('async function openBook('),end=app.indexOf('function closeReader()',start);
    assert.ok(start>=0 && end>start,'Recognize the real Reader open path before injecting an experiment');
    let opening=app.slice(start,end);
    opening=opening.replace('  state.generation += 1;','  window.__readerPageCache=new Map(); window.__readerOverlays={}; window.__readerStages=[]; window.__readerStage=(name,index)=>window.__readerStages.push({name,index,at:Date.now()}); window.__readerStage("open"); window.__readerPaints={}; window.__readerPreviewPaint=null; state.generation += 1;');
    opening=opening.replace('    await nextFrame();','    window.__readerPdfReadyMs=Date.now(); await nextFrame();');
    let body=app.slice(0,start)+opening+app.slice(end);
    body=body.replace('    wrapper.append(image);',
      '    wrapper.append(image); requestAnimationFrame(()=>requestAnimationFrame(()=>{if(image.isConnected)window.__readerPreviewPaint={at:Date.now(),page:index};}));');
    body=body.replace('      state.rendered.add(index);',
      '      state.rendered.add(index); requestAnimationFrame(()=>requestAnimationFrame(()=>{if(canvas.isConnected && canvas.width) window.__readerPaints[index]=Date.now();}));');
    body=body.replace('    const page = await state.pdf.getPage(index + 1);',
      '    window.__readerStage?.("getPageStart",index); const page = await state.pdf.getPage(index + 1); window.__readerPageCache?.set(index,page); window.__readerStage?.("getPageEnd",index);');
    body=body.replace('    await task.promise;',
      '    window.__readerStage?.("renderStart",index); await task.promise; window.__readerStage?.("renderEnd",index);');
    body=body.replace('    await image.decode();',
      '    window.__readerStage?.("decodeStart",index); await image.decode(); window.__readerStage?.("decodeEnd",index);');
    body=body.replace('  wrapper.append(overlay);',
      '  wrapper.append(overlay); requestAnimationFrame(()=>requestAnimationFrame(()=>{if(overlay.isConnected)window.__readerOverlays[index]=Date.now();}));');
    if(process.env.READER_FIRST_DEFAULT_LOADING==='1') body=body.replace(
      /disableRange: state\.revision\.byte_size >= 32 \* 1024 \* 1024\s*&& state\.revision\.byte_size <= 256 \* 1024 \* 1024/,
      'disableRange:false');
    if(process.env.READER_FIRST_SCROLL_PROFILE==='1') {
      body+='\nwindow.__scrollProfile={};\n';
      for(const name of ['updateViewport','setCurrentPage','updatePreparationLabel','updatePrintedPageLabel','renderReaderSectionHint','syncDirectoryActive','captureZoomAnchor','schedulePreparationPriority']) {
        body+=`${name}=((original)=>function(...args){const start=performance.now();try{return original(...args);}finally{const row=window.__scrollProfile['${name}']||={calls:0,ms:0,max:0};const ms=performance.now()-start;row.calls++;row.ms+=ms;row.max=Math.max(row.max,ms);}})(${name});\n`;
      }
    }
    if(process.env.READER_FIRST_LIFETIME==='1') {
      body+='\nwindow.__readerDataCounts=()=>({overlayPages:state.overlayData.size,annotationPages:state.annotationData.size});\n';
    }
    await route.fulfill({response,body});
  });
  page.on('pageerror',e=>{if(result.errors.length<8)result.errors.push({message:e.message,stack:e.stack});});
  page.on('console',m=>{if(m.type()==='error' && result.consoleErrors.length<12) result.consoleErrors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400 && result.httpErrors.length<12) result.httpErrors.push({path:new URL(r.url()).pathname,status:r.status()});});
  page.on('requestfinished',request=>{const t=request.timing();result.requests.push({path:new URL(request.url()).pathname,
    start:t.startTime,connectStart:t.connectStart,connectEnd:t.connectEnd,requestStart:t.requestStart,
    firstByte:t.responseStart,end:t.responseEnd});});
  await page.goto(ready);await page.locator('.book-card').first().waitFor();
  const position=await page.evaluate(async count=>{
    const books=(await(await fetch('/api/books')).json()).books;
    return books.find(b=>b.active_revision?.page_count===count).active_revision.position.pdf_page_index;
  },bookPages);
  for(let round=0;round<2;round++) {
    const previousPdfBytes=pdfBytes;
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    const start=Date.now();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('#reader').waitFor();const shell=Date.now()-start;
    await page.waitForFunction(index=>window.__readerPaints?.[index] || window.__readerPreviewPaint?.page===index,position,{timeout:15000});
    const firstSource=await page.evaluate(index=>Math.min(window.__readerPaints?.[index]||Infinity,
      window.__readerPreviewPaint?.page===index ? window.__readerPreviewPaint.at : Infinity),position)-start;
    await page.screenshot({path:path.join(root,`round-${round}-first.jpg`)});
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),position,{timeout:15000});
    const paint=await page.evaluate(index=>window.__readerPaints[index],position)-start;
    await page.waitForFunction(position=>{
      const c=document.querySelector(`.page[data-index="${position}"] canvas`);if(!c?.width)return false;
      const p=document.createElement('canvas');p.width=p.height=32;const x=p.getContext('2d');x.drawImage(c,0,0,32,32);
      const pixels=x.getImageData(0,0,32,32).data;let ink=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<210)ink++;
      return ink>10;
    },position);
    result.rounds.push({round,start,page:position+1,shellMs:shell,firstSourceMs:firstSource,canvasMs:paint,inkMs:Date.now()-start,
      pdfReadyMs:await page.evaluate(()=>window.__readerPdfReadyMs)-start,workers:page.workers().length,
      stages:await page.evaluate(start=>(window.__readerStages||[]).map(s=>({...s,ms:s.at-start})),start)});
    await page.screenshot({path:path.join(root,`round-${round}.jpg`)});
    if(process.env.READER_FIRST_INTERACTION==='1') {
      await page.waitForFunction(index=>Boolean(window.__readerOverlays?.[index]),position,{timeout:15000});
      result.rounds.at(-1).textLayerMs=await page.evaluate(index=>window.__readerOverlays[index],position)-start;
    }
    result.rounds.at(-1).pdfBytesAtReady=pdfBytes-previousPdfBytes;
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
  }
  if(process.env.READER_FIRST_GUARDS==='1') {
    // Reject an image with the wrong source identity and retain the real PDF path.
    await page.route('**/visual-region',route=>route.fulfill({json:{source_sha256:'wrong-source',pdf_page_index:position,image:{data_url:'data:image/png;base64,AA=='}}}));
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),position,{timeout:15000});
    assert.equal(await page.locator('.page-preview').count(),0);
    assert.equal(await page.evaluate(()=>window.__readerPreviewPaint),null);
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
    await page.unroute('**/visual-region');
    // Scrolling after the preview appears must survive PDF.js completing.
    let releasePdf,seenPdf;
    const heldPdf=new Promise(resolve=>{releasePdf=resolve;}),pdfRequested=new Promise(resolve=>{seenPdf=resolve;});
    await page.route('**/api/revisions/*/pdf',async route=>{seenPdf();await heldPdf;try{await route.continue();}catch{}});
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await pdfRequested;await page.locator('.page-preview').waitFor();
    const scrolled=Math.min(position+3,bookPages-1);
    await page.evaluate(index=>{
      const viewer=document.querySelector('#viewer'),wrapper=document.querySelector(`.page[data-index="${index}"]`);
      viewer.scrollTop=wrapper.offsetTop+wrapper.offsetHeight*.1;
    },scrolled);
    releasePdf();
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),scrolled,{timeout:15000});
    assert.equal(await page.locator('#page-number').inputValue(),String(scrolled+1));
    await page.unroute('**/api/revisions/*/pdf');
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    const section=page.locator('.overview-section').filter({has:page.locator('.source-action:not([disabled])')}).first();
    await section.waitFor();
    const sectionId=await section.getAttribute('data-section-id');
    const destination=await page.evaluate(async({count,sectionId})=>{
      const books=(await(await fetch('/api/books')).json()).books;
      const revision=books.find(b=>b.active_revision?.page_count===count).active_revision.id;
      return (await(await fetch(`/api/revisions/${revision}/outline?stored=1`)).json()).nodes.find(n=>n.outline_node_id===sectionId);
    },{count:bookPages,sectionId});
    await section.locator('summary .source-action').click();
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),destination.start_page,{timeout:15000});
    const initialPreview=await page.evaluate(()=>window.__readerPreviewPaint);
    if(initialPreview) assert.equal(initialPreview.page,destination.start_page,'a section jump must never flash the last-read page');
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
    let release,seen,finished;
    const held=new Promise(resolve=>{release=resolve;}),requested=new Promise(resolve=>{seen=resolve;}),done=new Promise(resolve=>{finished=resolve;});
    await page.route('**/visual-region',async route=>{seen();await held;try {await route.continue();} catch {} finally {finished();}});
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await requested;
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
    release();await done;
    assert.equal(await page.locator('.page-preview').count(),0,'a late page image must not survive closing the book');
    await page.unroute('**/visual-region');
    result.guards={wrongSourceFallback:true,explicitDestination:true,closeDuringPreview:true,scrollDuringLoad:true};
  }
  if(process.env.READER_FIRST_SCROLL_PROFILE==='1') {
    await network.send('Performance.enable');
    await network.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.READER_FIRST_CPU_RATE||1)});
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),position);
    await page.waitForTimeout(1000);
    for(const directory of [false,true]) {
      if(directory){await page.locator('#outline-toggle').click();await page.locator('.outline-target').first().waitFor();await page.waitForTimeout(200);}
      await page.evaluate(()=>{window.__scrollProfile={};});
      const before=Object.fromEntries((await network.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
      const frames=await page.evaluate(async()=>{
        const viewer=document.querySelector('#viewer'),top=viewer.scrollTop,times=[];let last=performance.now();
        for(let frame=0;frame<120;frame++){viewer.scrollTop=top+(frame%2)*8;await new Promise(requestAnimationFrame);const now=performance.now();times.push(now-last);last=now;}
        await new Promise(requestAnimationFrame);return times;
      });
      const after=Object.fromEntries((await network.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
      const metrics=Object.fromEntries(['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','TaskDuration','ScriptDuration'].map(k=>[k,after[k]-before[k]]));
      (result.scrollProfiles||=[]).push({directory,cpuRate:Number(process.env.READER_FIRST_CPU_RATE||1),metrics,
        functions:await page.evaluate(()=>window.__scrollProfile),framesP95:frames.toSorted((a,b)=>a-b)[114],max:Math.max(...frames)});
    }
    await page.screenshot({path:path.join(root,'scroll-profile.jpg')});
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
  }
  if(process.env.READER_FIRST_LIFETIME==='1') {
    const browserCdp=await browser.newBrowserCDPSession();await network.send('Performance.enable');
    const snapshot=async name=>{
      await network.send('HeapProfiler.collectGarbage');
      const metrics=Object.fromEntries((await network.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
      const proxies=await page.evaluate(()=>{
        const pages=[...window.__readerPageCache.entries()];
        const active=new Set([...document.querySelectorAll('.page canvas')].map(c=>Number(c.closest('.page').dataset.index)));
        return {visited:pages.length,retained:pages.filter(([,p])=>p._intentStates.size>0).length,
          offscreenRetained:pages.filter(([i,p])=>!active.has(i) && p._intentStates.size>0).length,
          active:active.size,operations:pages.reduce((sum,[,p])=>sum+[...p._intentStates.values()].reduce((s,v)=>s+v.operatorList.fnArray.length,0),0)};
      });
      const processes=(await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
      const memory=spawnSync('python',['-c','import json,sys,psutil; print(json.dumps([psutil.Process(int(p)).memory_info().rss for p in sys.argv[1:] if psutil.pid_exists(int(p))]))',...processes.map(p=>String(p.id))],{windowsHide:true,encoding:'utf8'});
      const row={name,...proxies,...await page.evaluate(()=>window.__readerDataCounts?.()),heapMiB:metrics.JSHeapUsedSize/1024**2,rssMiB:memory.status===0?JSON.parse(memory.stdout).reduce((a,b)=>a+b,0)/1024**2:null};
      (result.lifetime||=[]).push(row);
    };
    await page.locator('.book-card').filter({hasText:`${bookPages} 个 PDF 页面`}).locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),position);
    await page.waitForTimeout(200);await snapshot('start');
    const count=Number(process.env.READER_FIRST_LIFETIME_PAGES||20),jumps=[];
    for(let index=0;index<count;index++) {
      const target=Math.min(10+index*6,bookPages-4),start=Date.now();
      await page.locator('#page-number').fill(String(target+1));await page.locator('#page-number').press('Enter');
      await page.waitForFunction(index=>Boolean(window.__readerPaints?.[index]),target);
      jumps.push(Date.now()-start);await page.waitForTimeout(160);
      if((index+1)%5===0)await snapshot(`visited-${index+1}`);
    }
    await page.locator('#page-number').fill('11');await page.locator('#page-number').press('Enter');
    await page.locator('.page[data-index="10"]:not(.loading) canvas').waitFor();
    await page.locator('.page[data-index="10"] .text-overlay').waitFor();
    assert.ok(await page.locator('.page[data-index="10"] canvas').evaluate(canvas=>{
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]<180 && pixels[offset+1]<180 && pixels[offset+2]<180)return true;
      return false;
    }),'returning to an evicted page restores original book pixels and selectable text');
    await page.screenshot({path:path.join(root,'reading-return.jpg')});
    await snapshot('return');result.lifetimeJumpsMs=jumps;
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor();
  }
  const inspection=await page.evaluate(async()=>(await(await fetch('/api/assistant/inspection')).json()).calls||[]);
  assert.equal(inspection.length,0,'first paint never calls an AI provider');
  assert.deepEqual(result.errors,[]);
  if(process.env.READER_FIRST_NATIVE==='1') {
    // Built-in PDF viewer: capture compositor frames rather than treating the
    // extension's load event or its toolbar as proof that book content appeared.
    const native=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:Number(process.env.READER_FIRST_DPR||1)});
    await native.goto(ready);await native.locator('.book-card').first().waitFor();
    const revision=await native.evaluate(async count=>{
      const books=(await(await fetch('/api/books')).json()).books;
      return books.find(b=>b.active_revision?.page_count===count).active_revision;
    },bookPages);
    const cdp=await native.context().newCDPSession(native);
    for(let round=0;round<2;round++) {
      const frames=[];
      const listener=event=>{
        frames.push({data:event.data,at:Date.now(),timestamp:event.metadata.timestamp});
        void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{});
      };
      cdp.on('Page.screencastFrame',listener);
      await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1440,maxHeight:1000,everyNthFrame:1});
      const start=Date.now();
      const pdfFile=path.join(data,'blobs',revision.blob_sha256.slice(0,2),`${revision.blob_sha256}.pdf`);
      await native.goto(`${pathToFileURL(pdfFile).href}#page=${position+1}&zoom=125`,{waitUntil:'commit'});
      await native.bringToFront();
      await native.waitForTimeout(5000);
      await native.screenshot({path:path.join(root,`native-${round}-final.jpg`)});
      await cdp.send('Page.stopScreencast');cdp.off('Page.screencastFrame',listener);
      const records=[];
      for(let index=0;index<frames.length;index++) {
        const file=`native-${round}-${index}.jpg`;
        await writeFile(path.join(root,file),Buffer.from(frames[index].data,'base64'));
        records.push({file,ms:frames[index].at-start,timestamp:frames[index].timestamp});
      }
      (result.native||=[]).push({round,page:position+1,zoom:125,frames:records,
        status:'Captures only: verify actual target book pixels before deriving a native timing.',
        framesInfo:native.frames().map(frame=>({url:frame.url().replace(/\?token=[^#]+/,'?token=[redacted]')}))});
      await native.goto('about:blank');
    }
    await native.close();
  }
  console.log(JSON.stringify({label:result.label,rounds:result.rounds,artifacts:root}));
} catch(error) {
  result.failure=error.message;
  await page?.screenshot({path:path.join(root,'failure.jpg')}).catch(()=>{});
  throw error;
} finally {
  await writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));
  await browser?.close();
  if(service.exitCode===null) {const closed=new Promise(resolve=>service.once('exit',resolve));service.kill();await closed;}
  if(process.env.READER_FIRST_KEEP_DATA!=='1') {
    const resolved=await realpath(data),boundary=await realpath(root);
    assert.equal(path.dirname(resolved),boundary);
    assert.ok(boundary.toLowerCase().startsWith((path.resolve(os.tmpdir())+path.sep).toLowerCase()));
    assert.ok(path.basename(boundary).startsWith('reader-first-paint-'));
    await rm(resolved,{recursive:true,force:true});
  }
}
