import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfSession} from '../src/reader_service/static/pdf-session.js';
import {pageRenderWindow, pageRenderPlan} from '../src/reader_service/static/geometry.js';

const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick = () => new Promise(setImmediate);

test('close during loading releases the loading task once and discards its late result',async()=>{
  const pending=deferred();let destroyed=0;
  const session=createPdfSession(()=>({promise:pending.promise,destroy(){destroyed++;}}));
  const opening=session.open({});await tick();
  await session.close();await session.close();
  pending.resolve({old:true});
  assert.equal(await opening,null);assert.equal(destroyed,1);
});

test('rapid replacement and a failed load release workers before the next open',async()=>{
  const old=deferred();let destroyed=0,calls=0;
  const session=createPdfSession(()=>({promise:++calls===1?old.promise:Promise.resolve({current:true}),
    async destroy(){destroyed++;}}));
  const first=session.open({});await tick();
  const second=session.open({});assert.deepEqual(await second,{current:true});
  old.reject(Error('cancelled'));assert.equal(await first,null);
  await session.close();assert.equal(destroyed,2);
  const broken=createPdfSession(()=>({promise:Promise.reject(Error('bad PDF')),destroy(){destroyed++;}}));
  await assert.rejects(broken.open({}),/bad PDF/);await broken.close();assert.equal(destroyed,3);
});

test('pixel budget preserves all visible pages and reduces only offscreen work',()=>{
  assert.deepEqual(pageRenderWindow(20,20,100,1_000_000),{start:18,end:22});
  assert.deepEqual(pageRenderWindow(20,20,100,20_000_000),{start:20,end:20});
  assert.deepEqual(pageRenderWindow(20,22,100,20_000_000),{start:20,end:22});
  assert.deepEqual(pageRenderWindow(0,0,1,20_000_000),{start:0,end:0});
});

test('current visible pages finish before neighbours enter the render queue',()=>{
  const plan = rendered => pageRenderPlan({first:20,last:21,focus:21,start:18,end:23,rendered:new Set(rendered)});
  assert.deepEqual(plan([]),{visible:[21,20],preload:[]});
  assert.deepEqual(plan([21]),{visible:[21,20],preload:[]});
  assert.deepEqual(plan([20,21]),{visible:[21,20],preload:[22,19,23,18]});
  assert.deepEqual(pageRenderPlan({first:0,last:0,focus:0,start:0,end:0,rendered:new Set()}),
    {visible:[0],preload:[]});
});
