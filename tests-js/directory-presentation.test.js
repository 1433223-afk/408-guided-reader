import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {runInNewContext} from 'node:vm';

test('front/back matter stays distinct from numbered parts and chapters',()=>{
  const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function isAuxiliaryOutlineRoot('),source.indexOf('function makeAuxiliaryOutlineGroup('));
  const isAuxiliary=runInNewContext(`${fn}; isAuxiliaryOutlineRoot`);
  for(const title of ['封面','书名','版权','附录1 各类保险学说','主要参考文献','再版后记','第三版后记']) assert.equal(isAuxiliary({title}),true,title);
  for(const title of ['第一篇 保险基础','第六章 保险公司','第一节 风险概述']) assert.equal(isAuxiliary({title}),false,title);
});

test('known PDF page is enough for navigation, no exact learning range gate',()=>{
  const source=fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('  function source(n,'),source.indexOf('  async function loadMap('));
  let destination;
  const make=runInNewContext(`${fn}; source`,{selectedBook:'book',read:(_book,target)=>destination=target,
    action:(text,click)=>({textContent:text,click})});
  const partial=make({start_page:349,resolution_state:'PARTIAL'},'附录');
  assert.equal(partial.disabled,false);partial.click();assert.equal(destination.page,349);
  const unknown=make({start_page:null,resolution_state:'UNRESOLVED'},'附录');
  assert.equal(unknown.disabled,true);assert.match(unknown.textContent,/附录.*待核实/);
});
