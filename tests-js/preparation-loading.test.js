import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
test('reopening a READY book reads saved state without POST or event stream',async()=>{
  const calls=[]; let applied;
  const context={state:{revision:{id:'r'},generation:1},elements:{'preparation-status':{}},
    api:async(path,options)=>{calls.push({path,options});return {pages:[{status:'READY'}]};},
    applyPreparationStatuses:pages=>{applied=pages;},
    clearTimeout:()=>{},
    EventSource:class {constructor(){throw Error('READY book must not open stream');}}};
  await runInNewContext(source.slice(source.indexOf('function preparationFinished('),source.indexOf('function closePreparationStream()'))+'startPreparation()',context);
  assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);assert.equal(applied[0].status,'READY');
});
test('OCR stream reconnect refreshes progress after the bounded stream closes without rescheduling work',async()=>{
  const calls=[]; const streams=[]; const timers=[]; const labels=[];
  const pages=(ready)=>Array.from({length:50},(_,pdf_page_index)=>({pdf_page_index,status:pdf_page_index<ready?'READY':'NOT_PREPARED'}));
  let ready=30;
  class EventSource {
    constructor(){this.listeners={};this.closed=false;streams.push(this);}
    addEventListener(name,handler){this.listeners[name]=handler;}
    close(){this.closed=true;}
    emit(payload){this.listeners.pages({data:JSON.stringify(payload)});}
  }
  const state={revision:{id:'r'},generation:1,eventSource:null,preparationRetryTimer:0,preparationRetryDelay:1000};
  const context={state,EventSource,elements:{'preparation-status':{}},
    AbortSignal:{timeout:()=>null},
    api:async(_path,options)=>{calls.push(options?.method||'GET');return options?{}:{pages:pages(ready),jobs:{QUEUED:20,RUNNING:1}};},
    applyPreparationStatuses:rows=>labels.push(rows.filter(p=>p.status==='READY').length),
    updatePreparationLabel:()=>{},loadPracticeRecords:()=>{},
    clearTimeout:()=>{},setTimeout:handler=>{timers.push(handler);return timers.length;}};
  const code=source.slice(source.indexOf('function preparationFinished('),source.indexOf('function closePreparationStream()'));
  runInNewContext(code+'globalThis.run=startPreparation',context);
  await context.run();
  assert.deepEqual(calls,['GET','POST']);
  assert.equal(streams.length,1);
  streams[0].emit({pages:pages(30),active_jobs:true});
  streams[0].onerror();
  assert.equal(streams[0].closed,true);
  ready=31;
  timers[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['GET','POST','GET']);
  assert.deepEqual(labels,[30,30,31]);
  assert.equal(streams.length,2);
  streams[0].emit({pages:pages(29),active_jobs:true});
  assert.equal(labels.at(-1),31,'stale stream must not replace newer progress');
  streams[1].emit({pages:pages(50),active_jobs:false});
  assert.equal(streams[1].closed,true);
  assert.equal(state.eventSource,null);
});
test('finished OCR with a failed page does not enter a reconnect loop',async()=>{
  const context={state:{revision:{id:'r'},generation:1},elements:{'preparation-status':{}},clearTimeout:()=>{},
    api:async()=>({pages:[{status:'READY'},{status:'FAILED'}],jobs:{QUEUED:0,RUNNING:0}}),
    applyPreparationStatuses:()=>{},EventSource:class {constructor(){throw Error('finished book must not open stream');}}};
  await runInNewContext(source.slice(source.indexOf('function preparationFinished('),source.indexOf('function closePreparationStream()'))+'startPreparation()',context);
});
test('queued retry keeps progress stream open while the page still reads failed',async()=>{
  let streams=0;
  const context={state:{revision:{id:'r'},generation:1,eventSource:null},elements:{'preparation-status':{}},clearTimeout:()=>{},
    api:async()=>({pages:[{status:'FAILED'}],jobs:{QUEUED:1,RUNNING:0}}),
    applyPreparationStatuses:()=>{},EventSource:class {constructor(){streams++;} addEventListener(){} close(){} }};
  await runInNewContext(source.slice(source.indexOf('function preparationFinished('),source.indexOf('function closePreparationStream()'))+'startPreparation(false)',context);
  assert.equal(streams,1);
});
test('a successful status refresh clears a temporary connection error even when page states are unchanged',async()=>{
  let reads=0; let refreshed=0;
  const label={textContent:'',onclick:null,className:''};
  const context={state:{revision:{id:'r'},generation:1,eventSource:null,preparationRetryTimer:0,preparationRetryDelay:1000},
    elements:{'preparation-status':label},clearTimeout:()=>{},setTimeout:()=>1,
    api:async()=>{if (++reads===1) throw Error('offline');return {pages:[{status:'NOT_PREPARED'}],jobs:{QUEUED:1,RUNNING:0}};},
    applyPreparationStatuses:()=>{label.onclick=null;},
    updatePreparationLabel:()=>{refreshed++;label.textContent='0/1 页';},
    EventSource:class {addEventListener(){} close(){}}};
  runInNewContext(source.slice(source.indexOf('function preparationFinished('),source.indexOf('function closePreparationStream()'))+'globalThis.run=startPreparation',context);
  await context.run(false);
  assert.match(label.textContent,/读取失败/);
  await context.run(false);
  assert.equal(label.textContent,'0/1 页');
  assert.equal(refreshed,1);
});
test('completed book viewport changes do not schedule preparation',()=>{
  const context={state:{revision:{id:'r',page_count:2},preparation:new Map([[0,{status:'READY'}],[1,{status:'READY'}]])},
    clearTimeout:()=>{},setTimeout:()=>{throw Error('No scheduling for READY book');}};
  runInNewContext(source.slice(source.indexOf('function schedulePreparationPriority('),source.indexOf('async function refreshAssistantStatus()'))+'schedulePreparationPriority(0,1)',context);
});
test('OCR progress only touches pages whose state changed',()=>{
  const calls={sync:[],overlay:[],labels:0};
  const children=Array.from({length:300},()=>({dataset:{}}));
  const state={preparation:new Map(Array.from({length:300},(_,pdf_page_index)=>
    [pdf_page_index,{pdf_page_index,status:'NOT_PREPARED',prepared_at:null,failure_code:null}]))};
  const context={state,elements:{pages:{children},'preparation-status':{}},
    syncPagePreparationUi:index=>calls.sync.push(index),
    ensureOverlay:index=>calls.overlay.push(index),
    updatePreparationLabel:()=>calls.labels++};
  const code=source.slice(source.indexOf('function applyPreparationStatuses('),source.indexOf('function coverageText('));
  const pages=Array.from(state.preparation.values(),page=>({...page}));
  pages[125]={pdf_page_index:125,status:'READY',prepared_at:'now',failure_code:null};
  runInNewContext(code+'applyPreparationStatuses(pages)',{...context,pages});
  assert.deepEqual(calls.sync,[125]);
  assert.deepEqual(calls.overlay,[125]);
  assert.equal(calls.labels,1);
  runInNewContext(code+'applyPreparationStatuses(pages)',{...context,pages});
  assert.deepEqual(calls.sync,[125]);
  assert.equal(calls.labels,1);
});
test('selectable overlay mounts without waiting for annotation request',async()=>{
  let mounted=false, requested=false;
  const wrapper={querySelector:s=>s==='canvas'?{}:s==='.text-overlay'&&mounted?{}:null,
    append:()=>{mounted=true;}};
  const context={state:{preparation:new Map(),revision:{id:'r'},generation:1,
    overlayData:new Map(),annotationData:new Map(),currentPage:0},
    elements:{pages:{children:[wrapper]}},
    api:async()=>({page:{status:'READY',lines:[]}}),
    document:{createElement:()=>({dataset:{},setAttribute(){},addEventListener(){}})},
    inline:{renderPage(){}},renderAnnotations(){},renderSearchMatch(){},updateMarksPanel(){},trimPageDataCaches(){},
    beginSelection(){},extendSelection(){},finishSelection(){},openSelectionContextMenu(){},
    beginPracticePointer(){},updatePracticeHover(){},finishPracticePointer(){},
    refreshAnnotationPage:()=>{requested=true;return new Promise(()=>{});}};
  await runInNewContext(source.slice(source.indexOf('async function loadOverlay('),source.indexOf('function renderAnnotations('))+'loadOverlay(0,1)',context);
  assert.equal(mounted,true);assert.equal(requested,true);
});
