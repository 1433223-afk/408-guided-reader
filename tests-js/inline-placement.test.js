import test from 'node:test';
import assert from 'node:assert/strict';
import { placeInline } from '../src/reader_service/static/inline-placement.js';
const target = { available: true, quad: [[.1,.3],[.8,.3],[.8,.32],[.1,.32]] };
const viewport={left:0,right:1000};
const page={left:32,top:100,width:600,height:900,bottom:1000};
test('marker stays inside PDF margins at two zoom levels, retaining source y',()=>{
  for(const scale of [.67,1.5]) {
    const bounds={...page,width:600*scale,height:900*scale,bottom:100+900*scale};
    const p=placeInline(target,bounds,viewport,[]);
    assert.ok(p.left>=bounds.left && p.right<=bounds.left+bounds.width);
    assert.equal(p.top+12,bounds.top+bounds.height*.31);
  }
});
test('learning control or OCR collision uses opposite margin without changing source',()=>{
  const right=placeInline(target,page,viewport,[]);
  const left=placeInline(target,page,viewport,[right]);
  assert.ok(left.right<right.left); assert.equal(left.y,right.y);
  assert.equal(placeInline(target,page,viewport,[right,left]),null);
  assert.equal(placeInline(target,page,viewport,[],[right,left]),null);
});
test('unsafe targets and margins fail closed, horizontal scrolling does not change identity',()=>{
  assert.equal(placeInline({...target,available:false},page,viewport,[]),null);
  assert.equal(placeInline({...target,quad:[[NaN,0],[0,0],[0,0],[0,0]]},page,viewport,[]),null);
  assert.equal(placeInline({...target,quad:[[0,0],[1,0],[1,0],[0,0]]},page,viewport,[]),null);
  assert.equal(placeInline(target,{...page,width:20},viewport,[]),null);
  assert.deepEqual(placeInline(target,page,{left:500,right:700},[]),placeInline(target,page,viewport,[]));
});
