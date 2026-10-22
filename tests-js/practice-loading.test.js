import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let practiceCatalogLoad = null;'),source.indexOf('function renderPracticeNavigation()'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture() {
  const calls=[],applied=[],errors=[];
  const state={revision:{id:'book',blob_sha256:'source'},generation:1,practice:{active:false,catalogLoadEpoch:0}};
  const context={state,tabletMode:true,practicePositionSave:Promise.resolve(),
    api:path=>{const gate=deferred();calls.push({path,...gate});return gate.promise;},
    replacePracticeSections:sections=>applied.push(sections),updatePracticeRail:()=>{},renderPracticePages:()=>{},
    announce:message=>errors.push(message)};
  runInNewContext(code+'globalThis.load=loadPracticeRecords;',context);
  function finish(offset,number) {
    calls[offset].resolve({sections:[{id:'section',questions:[{number}]}]});
    calls[offset+1].resolve({questions:[{number}],positions:{section:number}});
  }
  return {context,state,calls,applied,errors,finish};
}

test('returning to a saved question waits for the same catalog as Tablet first-page background work',async()=>{
  const f=fixture();
  let returned=false;
  const foreground=f.context.load({force:true}).then(()=>{returned=true;});
  await tick();
  const background=f.context.load({force:true});
  await tick();
  assert.equal(f.calls.length,2,'one catalog and one records request');
  f.calls[1].resolve({questions:[{number:7}],positions:{section:7}});
  await tick();
  assert.equal(returned,false);
  f.calls[0].resolve({sections:[{id:'section',questions:[{number:7}]}]});
  await Promise.all([foreground,background]);
  assert.equal(returned,true);
  assert.equal(f.applied.length,1);
  assert.equal(f.applied[0][0].questions[0].number,7);
  assert.equal(f.state.practice.records.get(7).number,7);
});

test('reopening the same book starts a new catalog and late results from its previous session cannot replace it',async()=>{
  const f=fixture();
  const old=f.context.load({force:true});await tick();
  f.state.generation++;
  f.state.practice={active:false,catalogLoadEpoch:0};
  const current=f.context.load({force:true});await tick();
  assert.equal(f.calls.length,4);
  f.finish(2,9);await current;
  f.finish(0,7);await old;
  assert.equal(f.applied.length,1);
  assert.equal(f.state.practice.records.has(9),true);
  assert.equal(f.state.practice.records.has(7),false);
});

test('a completed catalog is refreshed on the next explicit load rather than cached indefinitely',async()=>{
  const f=fixture();
  const first=f.context.load({force:true});await tick();f.finish(0,7);await first;
  const next=f.context.load({force:true});await tick();f.finish(2,8);await next;
  assert.equal(f.calls.length,4);
  assert.equal(f.applied.length,2);
  assert.equal(f.state.practice.records.has(8),true);
});

test('a failed shared load releases its request so an explicit retry can recover',async()=>{
  const f=fixture();
  const first=f.context.load({force:true}),background=f.context.load({force:true});await tick();
  f.calls[0].reject(new Error('network unavailable'));f.calls[1].resolve({questions:[]});
  await Promise.all([first,background]);
  assert.equal(f.errors.length,1);
  const retry=f.context.load({force:true});await tick();f.finish(2,7);await retry;
  assert.equal(f.applied.length,1);
  assert.equal(f.state.practice.records.has(7),true);
});

test('OCR completion refreshes the catalog after a load that began before the new pages were ready',async()=>{
  const f=fixture();
  const before=f.context.load({force:true});await tick();
  const completed=f.context.load({force:true,refresh:true});
  f.finish(0,7);await before;await tick();
  assert.equal(f.calls.length,4);
  f.finish(2,8);await completed;
  assert.equal(f.applied.length,2);
  assert.equal(f.state.practice.records.has(8),true);
});
