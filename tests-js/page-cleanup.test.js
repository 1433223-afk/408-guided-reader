import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const source=app.match(/function releasePageProxy\([\s\S]+?\n}\n/)[0];
const tick=()=>new Promise(setImmediate);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture() {
  const pdf={},state={pdf,pageProxies:new Map(),pageRenderRequests:new Map()};let cleanups=0;
  const page={cleanup(){cleanups++;}};
  const release=vm.runInNewContext(`${source};releasePageProxy`,{state});
  return {pdf,state,page,release,get cleanups(){return cleanups;}};
}

test('offscreen page resources are released after its render cancellation settles',async()=>{
  const f=fixture(),render=deferred();
  f.release(f.page,7,f.pdf,render);await tick();assert.equal(f.cleanups,0);
  render.reject(Error('RenderingCancelledException'));await tick();assert.equal(f.cleanups,1);
});

test('a completed offscreen page also releases PDF resources, without a live task',async()=>{
  const f=fixture();f.release(f.page,7,f.pdf);await tick();assert.equal(f.cleanups,1);
});

test('a rapid return or zoom must protect a page that has acquired a new owner',async()=>{
  for(const owner of ['pageProxies','pageRenderRequests']) {
    const f=fixture(),render=deferred();f.release(f.page,7,f.pdf,render);
    f.state[owner].set(7,f.page);render.resolve();await tick();assert.equal(f.cleanups,0);
  }
});

test('a new book using the same index does not retain the old book resources',async()=>{
  const f=fixture(),render=deferred();f.release(f.page,7,f.pdf,render);
  f.state.pdf={};f.state.pageProxies.set(7,{});f.state.pageRenderRequests.set(7,{});
  render.resolve();await tick();assert.equal(f.cleanups,1);
});
