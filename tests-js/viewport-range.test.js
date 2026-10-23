import test from 'node:test';
import assert from 'node:assert/strict';
import {pageViewportRange} from '../src/reader_service/static/geometry.js';

// The original Reader scan is the oracle, including page margins and tie order.
function scan(pages,top,bottom) {
  let first=null,last=0,bestIndex=0,bestDistance=Infinity;
  pages.forEach((page,index)=>{
    if(page.bottom>=top && first===null)first=index;
    if(page.top<=bottom)last=index;
    const distance=Math.abs((page.top+page.bottom)/2-(top+bottom)/2);
    if(distance<bestDistance){bestDistance=distance;bestIndex=index;}
  });
  return {first,last,bestIndex};
}
const check=(pages,top,bottom)=>assert.deepEqual(pageViewportRange(pages.length,index=>pages[index],top,bottom),scan(pages,top,bottom));

test('viewport search preserves exact edges, blank areas, multi-page view and focus ties',()=>{
  const pages=[{top:20,bottom:840},{top:840,bottom:1940},{top:1940,bottom:2360}];
  for(const top of [-100,0,20,839,840,841,1800,1940,2360,2400]) {
    for(const height of [0,100,932,1600,4000])check(pages,top,top+height);
  }
  check([],0,100);
  check([{top:0,bottom:100},{top:100,bottom:200}],50,150);
});

test('nonuniform page sizes, zoom levels and changing learning footers match the original scan',()=>{
  let seed=408;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let sample=0;sample<160;sample++) {
    let next=20;const pages=Array.from({length:1+Math.floor(random()*1200)},()=>{
      const top=next;next=top+120+random()*4200+(random()<.2?500:20);return {top,bottom:next};
    });
    for(let frame=0;frame<16;frame++) {
      const top=random()*next-100;check(pages,top,top+100+random()*2000);
    }
    // A newly expanded footer shifts all later pages; use current geometry.
    const at=Math.floor(random()*pages.length);
    pages[at].bottom+=320;
    for(let i=at+1;i<pages.length;i++){pages[i].top+=320;pages[i].bottom+=320;}
    check(pages,pages[at].bottom-80,pages[at].bottom+900);
  }
});

test('a long book only reads logarithmically many current page bounds',()=>{
  let reads=0;
  const result=pageViewportRange(2000,index=>{reads++;return {top:index*1020,bottom:(index+1)*1020};},900_000,901_000);
  assert.deepEqual(result,{first:882,last:883,bestIndex:882});
  assert.ok(reads<=35,`read ${reads} page bounds`);
});
