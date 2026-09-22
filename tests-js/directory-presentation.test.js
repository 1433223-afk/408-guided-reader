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

test('directory mode follows real geometry and never resizes the page',()=>{
  const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
  const constants=source.slice(source.indexOf('const DIRECTORY_PANE_WIDTH'),source.indexOf('const ASSISTANT_PROVIDER_LABELS'));
  const fn=source.slice(source.indexOf('function computeDirectoryMode('),source.indexOf('function evaluateDirectoryMode('));
  const mode=runInNewContext(`${constants}${fn}; computeDirectoryMode`);
  // Wide screen at 100% zoom: the idle left canvas already fits the pane.
  assert.equal(mode({viewerWidth:1903,pageCssWidth:920}),'margin');
  assert.equal(mode({viewerWidth:1583,pageCssWidth:920}),'margin');
  // Medium screen: pane plus unchanged 920px page still fit side by side.
  assert.equal(mode({viewerWidth:1423,pageCssWidth:920}),'split');
  // 1280-class screen: narrowing would shrink the rendered page, so never overlay.
  assert.equal(mode({viewerWidth:1263,pageCssWidth:920}),'navigation');
  assert.equal(mode({viewerWidth:1007,pageCssWidth:920}),'navigation');
  // High zoom: the same viewer width cannot fit the grown page next to the pane.
  assert.equal(mode({viewerWidth:1583,pageCssWidth:1380}),'navigation');
  // Inline teaching reserve shrinks the usable width below split safety.
  assert.equal(mode({viewerWidth:1583,pageCssWidth:920,inlineReserve:332}),'navigation');
  // Re-evaluating inside split mode compares against the un-split width and stays put.
  assert.equal(mode({viewerWidth:1095,pageCssWidth:920,splitActive:true}),'split');
  assert.equal(mode({viewerWidth:1903,pageCssWidth:920,splitActive:false}),'margin');
});
