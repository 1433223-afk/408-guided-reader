import test from 'node:test';
import assert from 'node:assert/strict';
import { placeInline } from '../src/reader_service/static/inline-placement.js';
const target = { available: true, quad: [[.1,.3],[.8,.3],[.8,.32],[.1,.32]] };
test('source-relative gutter remains outside PDF at two zoom levels', () => {
  for (const scale of [.67, 1.5]) {
    const page = { left: 32, top: 100, width: 600*scale, height: 900*scale, bottom: 100+900*scale };
    const p = placeInline(target, page, {left:0,right:1000}, []);
    assert.ok(p.right < page.left); assert.equal(p.top+12, page.top+page.height*.31);
  }
});
test('occluded or unresolvable placement is omitted instead of shifted', () => {
  const page = {left:32,top:0,height:900,bottom:900};
  const p = placeInline(target,page,{left:0,right:900},[]);
  assert.equal(placeInline(target,page,{left:20,right:900},[]),null);
  assert.equal(placeInline(target,page,{left:0,right:900},[p]),null);
  assert.equal(placeInline(target,page,{left:0,right:900},[],[p]),null);
  assert.equal(placeInline({...target,available:false},page,{left:0,right:900},[]),null);
});
