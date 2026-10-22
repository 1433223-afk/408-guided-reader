// Disposable browser origin + simulated Core. No running Reader or study data.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';

const revision='00000000-0000-4000-8000-000000000001',strokes=new Map(),operations=new Map(),requests=[];
let offline=false;
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#efeee7}#reader{height:100vh}#viewer{height:550px;overflow:auto;touch-action:pan-x pan-y}
#pages{padding:16px}.page{position:relative;width:600px;height:840px;margin:0 0 30px;background:white}canvas{width:100%;height:100%;display:block}
</style><div id="reader"><div id="viewer"><div id="pages"><article class="page" data-index="0"><canvas width="1200" height="1680"></canvas></article></div></div></div>
<script type="module">
import {createTabletInk} from '/tablet-ink.js';
const reader=document.getElementById('reader'),viewer=document.getElementById('viewer'),pages=document.getElementById('pages');
window.readPenEvents=0;viewer.addEventListener('pointerdown',event=>{if(event.pointerType==='pen') window.readPenEvents++;});
window.ink=createTabletInk({reader,viewer,pages,getRevision:()=>({id:'${revision}'}),getPageIndex:()=>0,
onState:state=>window.inkState=state,api:async(path,options)=>{const response=await fetch(path,options);const body=await response.json();if(!response.ok)throw new Error(body.error||'save failed');return body;}});
ink.mountPage(0);window.ready=true;
</script>`;
const browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try {
  const context=await browser.newContext({viewport:{width:800,height:1000},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  await context.route('http://tablet-ink.test/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/') return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname.endsWith('.js')) return route.fulfill({contentType:'text/javascript',body:await readFile(path.join('src/reader_service/static',url.pathname.slice(1)),'utf8')});
    if(request.method()==='GET') return route.fulfill({json:{strokes:[...strokes.values()].filter(item=>!item.deleted).map(item=>item.stroke)}});
    const body=request.postDataJSON();requests.push(body);
    if(offline) return route.abort('connectionfailed');
    assert.ok(!body.stroke||!('id' in body.stroke));
    if(!operations.has(body.operation_id)) {
      if(body.action==='put'&&!strokes.has(body.stroke_id)) strokes.set(body.stroke_id,{stroke:{...body.stroke,id:body.stroke_id},deleted:false});
      const item=strokes.get(body.stroke_id);
      if(!item) return route.fulfill({status:404,json:{error:'stroke missing'}});
      if(body.action==='delete') item.deleted=true;if(body.action==='restore') item.deleted=false;
      operations.set(body.operation_id,body);
    }
    const item=strokes.get(body.stroke_id);
    return route.fulfill({json:{operation_id:body.operation_id,stroke_id:body.stroke_id,action:body.action,deleted:item.deleted,stroke:item.stroke}});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://tablet-ink.test/');await page.waitForFunction(()=>window.ready);
  const client=await context.newCDPSession(page);
  const pen=async(x=150,y=150)=>{
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',pointerType:'pen',x,y,button:'left',buttons:1,force:.6});
    for(let i=1;i<=8;i++) await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',pointerType:'pen',x:x+i*10,y:y+i*5,buttons:1,force:.6});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',pointerType:'pen',x:x+80,y:y+40,button:'left',buttons:0,force:0});
  };
  await pen();assert.equal(requests.length,0);assert.equal(await page.evaluate(()=>readPenEvents),1);
  await page.evaluate(()=>ink.setEnabled(true));await pen();
  await page.waitForFunction(()=>inkState.pending===0&&!inkState.saving);
  assert.equal(strokes.size,1);assert.equal(await page.locator('.tablet-ink-layer path').count(),1);
  const savedId=[...strokes.keys()][0];
  // Writing mode must leave native finger panning available between contacts.
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:400,y:450,id:1}]});
  for(let y=420;y>=180;y-=30) await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:400,y,id:1}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.getElementById('viewer').scrollTop>100);
  await page.evaluate(()=>document.getElementById('viewer').scrollTop=0);
  offline=true;await pen(200,200);
  await page.waitForFunction(()=>inkState.pending>0&&!inkState.saving&&inkState.error);
  const pendingOperation=requests.at(-1).operation_id;
  await page.reload();await page.waitForFunction(()=>window.ready&&inkState.pending>0&&!inkState.saving);
  await page.waitForFunction(()=>document.querySelectorAll('.tablet-ink-layer path').length===2);
  assert.equal(await page.evaluate(()=>ink.enabled),false);
  offline=false;await page.evaluate(()=>ink.retry());
  await page.waitForFunction(()=>inkState.pending===0&&!inkState.saving);
  assert.equal(requests.at(-1).operation_id,pendingOperation);assert.equal(strokes.size,2);
  await page.evaluate(async()=>{ink.setEnabled(true);await ink.undo();});
  // Undo history is intentionally this session only; the reloaded session has
  // no undo item, so use the whole-stroke eraser for the persisted original.
  await page.evaluate(()=>ink.setTool('eraser'));await pen();
  await page.waitForFunction(()=>inkState.pending===0&&!inkState.saving);
  assert.equal(strokes.get(savedId).deleted,true);
  await page.reload();await page.waitForFunction(()=>window.ready);
  await page.waitForFunction(()=>document.querySelectorAll('.tablet-ink-layer path').length===1);
  assert.deepEqual(errors,[]);
  const folder='test-results/tablet-ink-engine';await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'result.json'),JSON.stringify({passed:true,browser:browser.version(),
    evidence:'Disposable browser origin, actual IndexedDB and CDP pen/touch. Not physical Y900 evidence.',
    checks:['reading pen passthrough','pen writes','native finger scroll between pen contacts','IndexedDB offline reload',
      'same operation UUID retry','persisted whole-stroke erasing','deleted stroke remains absent after reload'],
    requests:requests.map(item=>({action:item.action,operation_id:item.operation_id})),errors},null,2));
  process.stdout.write('Tablet ink isolated browser smoke passed.\n');
} finally {await browser.close();}
