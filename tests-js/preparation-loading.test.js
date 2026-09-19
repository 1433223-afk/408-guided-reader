import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
test('reopening a READY book reads saved state without POST or event stream',async()=>{
  const calls=[]; let applied;
  const context={state:{revision:{id:'r'},generation:1},elements:{},
    api:async(path,options)=>{calls.push({path,options});return {pages:[{status:'READY'}]};},
    applyPreparationStatuses:pages=>{applied=pages;},
    EventSource:class {constructor(){throw Error('READY book must not open stream');}}};
  await runInNewContext(source.slice(source.indexOf('async function startPreparation()'),source.indexOf('function closePreparationStream()'))+'startPreparation()',context);
  assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);assert.equal(applied[0].status,'READY');
});
test('completed book viewport changes do not schedule preparation',()=>{
  const context={state:{revision:{id:'r',page_count:2},preparation:new Map([[0,{status:'READY'}],[1,{status:'READY'}]])},
    clearTimeout:()=>{},setTimeout:()=>{throw Error('No scheduling for READY book');}};
  runInNewContext(source.slice(source.indexOf('function schedulePreparationPriority('),source.indexOf('async function refreshAssistantStatus()'))+'schedulePreparationPriority(0,1)',context);
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
    inline:{renderPage(){}},renderAnnotations(){},renderSearchMatch(){},updateMarksPanel(){},
    beginSelection(){},extendSelection(){},finishSelection(){},openSelectionContextMenu(){},
    refreshAnnotationPage:()=>{requested=true;return new Promise(()=>{});}};
  await runInNewContext(source.slice(source.indexOf('async function loadOverlay('),source.indexOf('function renderAnnotations('))+'loadOverlay(0,1)',context);
  assert.equal(mounted,true);assert.equal(requested,true);
});
