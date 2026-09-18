import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = fs.readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function releasePdf()'), source.indexOf('function closeReader()'));
function fixture(isBeta) {
  const announcements = [], tasks = [];
  const state = {generation:0, pdf:null, pdfLoadingTask:null};
  for (const key of ['assistantSaveIntents','assistantSavedTurns','annotationData','assistantScrollPositions','assistantChildRequests']) state[key] = new Map();
  const elements = new Proxy({}, {get:()=>({replaceChildren(){}})});
  const context = {state,elements,isBeta,launchToken:'',crypto:{randomUUID:()=> 'fixture'},clearTimeout,
    console,emptyAssistantState:()=>({}),announce:(...args)=>announcements.push(args),
    cancelRenders(){},closePreparationStream(){},clearAssistantReviewPolls(){},renderLibrary(){},
    buildPlaceholders(){},resetAssistantPanel(){},refreshAssistantStatus(){},
    master:{reset(){},refreshEntries:()=>Promise.resolve()},
    nextFrame:()=>Promise.resolve(),applyRestoredPosition(){},scheduleViewportUpdate(){},
    startPreparation:()=>Promise.resolve(),loadBookMap(){},
    pdfjsLib:{getDocument(options){
      let resolve,reject;const promise=new Promise((ok,no)=>{resolve=ok;reject=no;});
      const task={options,promise,resolve,reject,destroyed:0,destroy(){this.destroyed++;reject(new Error('aborted'));return Promise.resolve();}};
      tasks.push(task);return task;
    }}};
  runInNewContext(code,context);
  return {context,state,tasks,announcements,book:{id:'book',title:'fixture',active_revision:{id:'revision',page_count:1,position:{}}}};
}

for (const beta of [false,true]) test(`PDF range policy and loaded document cleanup: beta=${beta}`,async()=>{
  const f=fixture(beta);const opened=f.context.openBook(f.book);const task=f.tasks[0];
  assert.equal(task.options.disableStream,beta?true:undefined);
  assert.equal(task.options.disableAutoFetch,beta?true:undefined);
  task.resolve({numPages:1});await opened;
  f.context.releasePdf();f.context.releasePdf();
  assert.equal(task.destroyed,1);assert.equal(f.state.pdf,null);assert.equal(f.state.pdfLoadingTask,null);
});

test('replacing a pending PDF cancels it without clearing the new task or showing stale errors',async()=>{
  const f=fixture(true);const first=f.context.openBook(f.book);
  const second=f.context.openBook({...f.book,id:'other'});
  assert.equal(f.tasks[0].destroyed,1);
  f.tasks[1].resolve({numPages:1});await Promise.all([first,second]);
  assert.equal(f.state.pdfLoadingTask,f.tasks[1]);assert.equal(f.tasks[1].destroyed,0);
  assert.deepEqual(f.announcements,[]);
});

test('failed current PDF releases resources and leaves opening retryable',async()=>{
  const f=fixture(true);const first=f.context.openBook(f.book);
  f.tasks[0].reject(new Error('network failed'));await first;
  assert.equal(f.tasks[0].destroyed,1);assert.equal(f.state.pdfLoadingTask,null);
  assert.equal(f.announcements.length,1);
  const retry=f.context.openBook(f.book);f.tasks[1].resolve({numPages:1});await retry;
  assert.equal(f.state.pdfLoadingTask,f.tasks[1]);
});
