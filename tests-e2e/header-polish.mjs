import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.goto(process.env.READER_URL || 'http://127.0.0.1:8767/');
 await page.locator('#library-home .brand svg').waitFor();
 const check=async root=>{
   const header=page.locator(`${root} .home-toolbar`);
   const metrics=await header.evaluate(e=>{
     const rect=s=>e.querySelector(s).getBoundingClientRect(),nav=rect('.space-navigation'),brand=rect('.brand');
     const action=[...e.children].find(n=>n.matches('button')&&n.getClientRects().length);
     return {height:e.getBoundingClientRect().height,center:(nav.left+nav.right)/2,viewport:innerWidth,
       overlap:brand.right>nav.left || (action?nav.right>action.getBoundingClientRect().left:false),
       fonts:[...e.querySelectorAll('.brand strong,.space-navigation button')].map(n=>[getComputedStyle(n).fontFamily,getComputedStyle(n).fontSize]),
       underline:getComputedStyle(e.querySelector('[aria-current=page]'),'::after').height};
   });
   assert.equal(metrics.height,55);assert.ok(Math.abs(metrics.center-metrics.viewport/2)<1);assert.equal(metrics.overlap,false);assert.equal(metrics.underline,'1px');
   assert.deepEqual(metrics.fonts.map(f=>f[1]),['14px','13px','13px']);assert.ok(metrics.fonts.every(f=>f[0].includes('Microsoft YaHei UI')));
   const nav=header.locator('.space-navigation button').first(),box=await nav.boundingBox();
   await nav.hover();assert.deepEqual(await nav.boundingBox(),box);await nav.focus();assert.deepEqual(await nav.boundingBox(),box);
   await nav.evaluate(e=>e.blur());await page.mouse.move(0,100);
 };
 for(const width of [1600,1280,1024]) {
   await page.setViewportSize({width,height:1000});await check('#library-home');
   await page.locator('#library-home .home-toolbar').screenshot({path:`test-results/header-polish-${width}.png`});
 }
 await page.locator('.continue-overview').click();await page.locator('#book-overview').waitFor({state:'visible'});await check('#book-overview');
 await page.locator('#book-overview .space-navigation').getByRole('button',{name:'学习记忆',exact:true}).click();
 await page.locator('#learning-memory').waitFor({state:'visible'});await check('#learning-memory');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#learning-memory .space-navigation button')).transitionDuration==='0s');
 console.log('PASS: Header 1600/1280/1024, centered navigation, no overlaps, stable fonts/geometry, 1px underline, Home/Overview/Memory parity, reduced motion.');
}finally{await browser.close();}
