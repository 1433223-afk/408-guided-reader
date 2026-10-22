import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabletInkStore,validateInkStroke} from '../src/reader_service/static/tablet-ink-store.js';

const REVISION = '00000000-0000-4000-8000-000000000001';
const STROKE = '00000000-0000-4000-8000-000000000002';
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
const tick = async () => {for(let i=0;i<8;i++) await new Promise(resolve => setImmediate(resolve));};
const stroke = () => ({id:STROKE,page_index:0,color:'#252923',width:.0025,coordinate_version:1,points:[[.1,.2,.5],[.2,.3,.6]]});
let nextId = 10;
const id = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12,'0')}`;
function persistence() {
  const operations = new Map(),states = new Map(); let sequence=0;
  return {operations,states,
    async load() {return {operations:clone([...operations.values()]),states:clone([...states.values()])};},
    async append(operation,state) {const key=++sequence; operations.set(key,{...clone(operation),sequence:key});states.set(state.key,clone(state));return key;},
    async acknowledge(key,state) {operations.delete(key); if(state && states.get(state.key)?.operation_id===state.operation_id) states.set(state.key,clone(state));},
    async forget(values) {for(const state of values) if(states.get(state.key)?.operation_id===state.operation_id && states.get(state.key)?.version===state.version) states.delete(state.key);},
  };
}
const operation = (action='put',value=stroke()) => ({operation_id:id(),revision_id:REVISION,page_index:0,action,stroke_id:STROKE,stroke:value});
const ack = body => ({operation_id:body.operation_id,stroke_id:body.stroke_id,action:body.action,deleted:body.action==='delete',stroke:body.stroke ? {...body.stroke,id:body.stroke_id} : stroke()});

test('an operation is durably appended before POST, and a blocked PUT cannot be overtaken by DELETE',async () => {
  const disk=persistence(),saved=deferred(),response=deferred(),calls=[];
  const append=disk.append; let first=true;
  disk.append=async(...args) => {if(first) {first=false;await saved.promise;} return append(...args);};
  const store=createTabletInkStore({persistence:disk,api:async(path,options) => {
    const body=JSON.parse(options.body);calls.push(body);if(calls.length===1) await response.promise;return ack(body);
  }});
  await store.ready;
  const create=store.enqueue(operation()); await tick(); assert.equal(calls.length,0);
  saved.resolve();await create;await tick();assert.deepEqual(calls.map(call=>call.action),['put']);
  await store.enqueue(operation('delete'));await tick();
  assert.deepEqual(store.getPage(REVISION,0),[]);assert.equal(store.getState().pending,2);
  assert.deepEqual(calls.map(call=>call.action),['put']);
  response.resolve();await tick();assert.deepEqual(calls.map(call=>call.action),['put','delete']);
  assert.equal('id' in calls[0].stroke,false);
  assert.equal(store.getState().pending,0);assert.equal(disk.operations.size,0);store.destroy();
});

test('a stale GET cannot resurrect an acknowledged deletion, or erase an acknowledged restore',async () => {
  const disk=persistence(),reads=[],store=createTabletInkStore({persistence:disk,api:async(path,options) => {
    if(!options) {const read=deferred();reads.push(read);return read.promise;}
    return ack(JSON.parse(options.body));
  }});
  await store.ready;
  const old=store.loadPage(REVISION,0);await tick();
  await store.enqueue(operation());await tick();await store.enqueue(operation('delete'));await tick();
  reads[0].resolve({strokes:[stroke()]});await old;assert.deepEqual(store.getPage(REVISION,0),[]);
  const staleEmpty=store.loadPage(REVISION,0,{force:true});await tick();
  await store.enqueue(operation('restore'));await tick();
  reads[1].resolve({strokes:[]});await staleEmpty;assert.deepEqual(store.getPage(REVISION,0),[stroke()]);
  const fresh=store.loadPage(REVISION,0,{force:true});await tick();reads[2].resolve({strokes:[stroke()]});await fresh;
  assert.equal(disk.states.size,0);assert.deepEqual(store.getPage(REVISION,0),[stroke()]);store.destroy();
});

test('a retried PUT acknowledged as deleted never brings erased ink back',async () => {
  const store=createTabletInkStore({persistence:persistence(),api:async(path,options) => ({...ack(JSON.parse(options.body)),deleted:true})});
  await store.ready;await store.enqueue(operation());await tick();
  assert.equal(store.getState().pending,0);assert.deepEqual(store.getPage(REVISION,0),[]);store.destroy();
});

test('storage failure holds every later operation locally; explicit retry keeps FIFO and original UUIDs',async () => {
  const disk=persistence(),append=disk.append,calls=[];let unavailable=true;
  disk.append=async(...args) => {if(unavailable) throw new Error('quota');return append(...args);};
  const store=createTabletInkStore({persistence:disk,api:async(path,options)=>{const body=JSON.parse(options.body);calls.push(body);return ack(body);}});
  await store.ready;const put=operation(),remove=operation('delete');
  await store.enqueue(put);await store.enqueue(remove);await tick();
  assert.equal(calls.length,0);assert.equal(store.getState().pending,2);assert.ok(store.getState().error);
  unavailable=false;await store.retry();await tick();
  assert.deepEqual(calls.map(call=>call.operation_id),[put.operation_id,remove.operation_id]);
  assert.equal(store.getState().pending,0);assert.deepEqual(store.getPage(REVISION,0),[]);store.destroy();
});

test('reopening the browser queue resumes a failed operation without changing its identity',async () => {
  const disk=persistence(),put=operation(),first=createTabletInkStore({persistence:disk,api:async()=>{throw new Error('offline');}});
  await first.ready;await first.enqueue(put);await tick();assert.equal(first.getState().pending,1);first.destroy();
  const calls=[],second=createTabletInkStore({persistence:disk,api:async(path,options)=>{
    const body=JSON.parse(options.body);calls.push(body);return ack(body);
  }});
  await second.ready;await tick();assert.equal(calls.length,1);assert.equal(calls[0].operation_id,put.operation_id);
  assert.equal(second.getState().pending,0);assert.deepEqual(second.getPage(REVISION,0),[stroke()]);second.destroy();
});

test('the deletion guard still sees pending drafts restored after a browser refresh',async () => {
  const disk=persistence(),first=createTabletInkStore({persistence:disk,api:async()=>{throw new Error('offline');}});
  await first.ready;await first.enqueue(operation());await tick();assert.equal(await first.hasPending(),true);first.destroy();
  const second=createTabletInkStore({persistence:disk,api:async()=>{throw new Error('offline');}});
  await second.ready;assert.equal(await second.hasPending(),true);await tick();assert.equal(await second.hasPending(),true);second.destroy();
});

test('a failed initial database read cannot allow new writes to overtake older durable operations',async () => {
  const disk=persistence(),old=operation(),state={key:`${REVISION}:${STROKE}`,revision_id:REVISION,page_index:0,
    stroke_id:STROKE,stroke:stroke(),deleted:false,pending:true,operation_id:old.operation_id,version:10};
  await disk.append({...old,local_state:state},state);
  const load=disk.load;let failed=true;disk.load=async()=>{if(failed) throw new Error('locked');return load();};
  const calls=[],store=createTabletInkStore({persistence:disk,api:async(path,options)=>{const body=JSON.parse(options.body);calls.push(body);return ack(body);}});
  await store.ready;const remove=operation('delete');await store.enqueue(remove);await tick();assert.equal(calls.length,0);
  failed=false;await store.retry();await tick();
  assert.deepEqual(calls.map(call=>call.operation_id),[old.operation_id,remove.operation_id]);
  assert.deepEqual(store.getPage(REVISION,0),[]);store.destroy();
});

test('normalized stroke validation rejects nonfinite, oversized and cross-contract values',() => {
  assert.deepEqual(validateInkStroke(stroke()),stroke());
  for(const invalid of [{...stroke(),width:.03},{...stroke(),color:'red'},
    {...stroke(),points:[[NaN,.2,.5]]},{...stroke(),points:[[.1,1.01,.5]]},
    {...stroke(),points:Array.from({length:1501},()=>[.1,.2,.5])}]) assert.throws(()=>validateInkStroke(invalid));
});
