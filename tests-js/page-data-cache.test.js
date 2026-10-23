import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const trim=app.match(/function trimPageDataCaches\([\s\S]+?\n}\n/)[0];
const refresh=app.slice(app.indexOf('async function refreshAnnotationPage('),app.indexOf('function pollSavedExplanationReview('));
function fixture() {
  const state={revision:{id:'same-book'},generation:1,currentPage:10,selection:null,
    overlayData:new Map(),annotationData:new Map(),pageProxies:new Map(),pageRenderRequests:new Map()};
  let renders=0,updates=0,resolve;
  const context=vm.createContext({state,api:()=>new Promise(done=>{resolve=done;}),
    renderAnnotations(){renders++;},updateMarksPanel(){updates++;}});
  vm.runInContext(trim+refresh,context);
  return {state,context,get renders(){return renders;},get updates(){return updates;},reply:value=>resolve(value)};
}

test('reading caches are bounded while retaining visible, pending, current and selected pages',()=>{
  const f=fixture();
  for(let i=0;i<80;i++){f.state.overlayData.set(i,{page:i});f.state.annotationData.set(i,[{id:i}]);}
  f.state.pageProxies.set(0,{});f.state.pageRenderRequests.set(1,{});f.state.selection={pageIndex:2};
  f.context.trimPageDataCaches();
  for(const cache of [f.state.overlayData,f.state.annotationData]) {
    assert.equal(cache.size,24);
    for(const index of [0,1,2,10,79])assert.ok(cache.has(index));
    assert.equal(cache.has(3),false);
  }
});

test('a viewport with more than the cache budget never loses visible data',()=>{
  const f=fixture();for(let i=0;i<35;i++){f.state.overlayData.set(i,{});f.state.pageProxies.set(i,{});}
  f.context.trimPageDataCaches();assert.equal(f.state.overlayData.size,35);
});

test('late annotation fetch from a previous opening of the same book is discarded',async()=>{
  const f=fixture(),pending=f.context.refreshAnnotationPage(10);
  f.state.generation++;f.reply({annotations:[{id:'old'}]});await pending;
  assert.equal(f.state.annotationData.size,0);assert.equal(f.renders,0);assert.equal(f.updates,0);
});

test('fresh annotations update the page and can be fetched after their cache entry was removed',async()=>{
  const f=fixture();const first=f.context.refreshAnnotationPage(10);
  f.reply({annotations:[{id:'saved'}]});await first;assert.equal(f.state.annotationData.get(10)[0].id,'saved');
  f.state.annotationData.delete(10);
  const second=f.context.refreshAnnotationPage(10);f.reply({annotations:[{id:'saved'}]});await second;
  assert.equal(f.state.annotationData.get(10)[0].id,'saved');assert.equal(f.renders,2);assert.equal(f.updates,2);
});
