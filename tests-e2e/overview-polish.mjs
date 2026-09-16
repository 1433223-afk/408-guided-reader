import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}});
 await page.goto(process.env.READER_URL || 'http://127.0.0.1:8767/');
 await page.locator('.book-card').filter({hasText:'计算机组成'}).locator('.book-open').click();
 await page.locator('.chapter-row').filter({hasText:'第4章'}).click();
 await page.locator('.overview-kp').first().waitFor({state:'attached'});
 const section=page.locator('.overview-section').first();
 if(!await section.evaluate(e=>e.open)) await section.locator('summary').click();
 await page.waitForTimeout(180);
 const styles=()=>page.evaluate(()=>Object.fromEntries(['.chapter-heading h2','.section-heading h3','.overview-kp strong'].map(selector=>{
   const s=getComputedStyle(document.querySelector(selector));return [selector,[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]];
 })));
 const typeBaseline=await styles();
 assert.deepEqual(Object.values(typeBaseline).map(s=>s[1]),['30px','18px','15px']);
 for(const width of [1600,1280,1024]) {
   await page.setViewportSize({width,height:1100});await page.waitForTimeout(180);
   assert.deepEqual(await styles(),typeBaseline);
   const measure=await page.evaluate(()=>{
     const root=document.querySelector('#book-overview');
     const rect=s=>document.querySelector(s).getBoundingClientRect();
     return {overflow:root.scrollWidth-root.clientWidth,
       titleDelta:rect('.section-heading h3').left-rect('.overview-kp strong').left,
       actionDelta:rect('.section-heading .source-action').right-rect('.overview-kp .source-action').right,
       smallMetadata:[...root.querySelectorAll('.muted,.eyebrow,.chapter-row small,.kp-state,.source-action')].filter(e=>e.getClientRects().length&&parseFloat(getComputedStyle(e).fontSize)<12).length};
   });
   assert.ok(measure.overflow<=1,JSON.stringify(measure));assert.ok(Math.abs(measure.titleDelta)<=1);assert.ok(Math.abs(measure.actionDelta)<=1);assert.equal(measure.smallMetadata,0);
   const kp=section.locator('.overview-kp').first();
   const bounds=()=>kp.evaluate(e=>[e.offsetLeft,e.offsetTop,e.offsetWidth,e.offsetHeight]);
   const before=await bounds();await kp.hover();assert.deepEqual(await bounds(),before);
   await kp.locator('button').focus();assert.deepEqual(await bounds(),before);
   await kp.locator('button').evaluate(e=>e.blur());await page.mouse.move(0,0);
   await page.screenshot({path:`test-results/overview-polish-${width}.png`});
 }
 await page.setViewportSize({width:1600,height:1100});
 await section.locator('summary').click();await page.waitForTimeout(180);assert.equal(await section.evaluate(e=>e.open),false);
 await section.locator('summary').click();await page.waitForTimeout(180);
 await section.screenshot({path:'test-results/overview-polish-expanded.png'});
 for(const chapter of ['第5章','第6章']) {
   await page.locator('.chapter-row').filter({hasText:chapter}).click();
   await page.waitForFunction(()=>!!document.querySelector('.structure-lifecycle'));
   const current=await page.locator('.chapter-heading h2').evaluate(e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight];});
   assert.deepEqual(current,typeBaseline['.chapter-heading h2']);
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.overview-section'),'::details-content').transitionDuration==='0s');
 console.log(JSON.stringify({status:'PASS',widths:[1600,1280,1024],typeBaseline,alignment:true,noOverflow:true,stableHoverFocus:true,reducedMotion:true}));
}finally{await browser.close();}
