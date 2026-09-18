import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function startPreparation()'),source.indexOf('function closePreparationStream()'));
function fixture(isBeta=true){
 const streams=[],applied=[];let resolve,reject;
 const scheduled=new Promise((ok,no)=>{resolve=ok;reject=no;});
 const state={revision:{id:'rev'},generation:1,currentPage:0,preparation:new Map()};
 const label={textContent:'pending'};
 const context={state,isBeta,elements:{'preparation-status':label},api:()=>scheduled,
  EventSource:class{constructor(url,options){this.url=url;this.options=options;this.listeners={};streams.push(this);}addEventListener(name,fn){this.listeners[name]=fn;}},
  applyPreparationStatuses(pages){applied.push(...pages);for(const p of pages)state.preparation.set(p.pdf_page_index,p);},
  updatePreparationLabel(){label.textContent='available';}};
 runInNewContext(code,context);return {context,state,label,streams,applied,resolve,reject};
}
test('Beta restores authoritative READY status while scheduling remains pending',async()=>{
 const f=fixture();const work=f.context.startPreparation();
 assert.equal(f.streams.length,1);assert.equal(f.streams[0].options.withCredentials,true);
 f.streams[0].listeners.pages({data:JSON.stringify({pages:[{pdf_page_index:0,status:'READY'}]})});
 assert.equal(f.applied[0].status,'READY');
 f.reject(new Error('scheduling failed'));await work;
 assert.equal(f.label.textContent,'available');
});
test('late status and POST failure from a closed/reopened same revision cannot alter current reader',async()=>{
 const f=fixture();const work=f.context.startPreparation();
 f.state.generation++;f.state.eventSource=null;
 f.streams[0].listeners.pages({data:JSON.stringify({pages:[{pdf_page_index:0,status:'READY'}]})});
 f.reject(new Error('old failure'));await work;
 assert.equal(f.applied.length,0);assert.equal(f.label.textContent,'pending');
});
test('personal keeps subscribe-after-scheduling order',async()=>{
 const f=fixture(false);const work=f.context.startPreparation();assert.equal(f.streams.length,0);
 f.resolve({});await work;assert.equal(f.streams.length,1);
});
