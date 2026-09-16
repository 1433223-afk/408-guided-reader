import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1000}});
 await page.goto(process.env.READER_URL || 'http://127.0.0.1:8767/');
 const header=page.locator('#library-home .home-toolbar'),mark=header.locator('.brand-mark');
 await mark.locator('svg').waitFor();
 assert.equal(await header.locator('.brand').textContent(),'Guided Reader');
 assert.equal(await mark.locator('svg').getAttribute('stroke'),'currentColor');
 assert.equal(await mark.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
 assert.equal(await mark.evaluate(e=>e.getBoundingClientRect().width),20);
 const before=await header.boundingBox();await mark.hover();assert.deepEqual(await header.boundingBox(),before);
 const icon=fs.readFileSync('src/reader_service/static/guided-reader-icon.svg','utf8').trim();
 assert.equal(decodeURIComponent((await page.locator('link[rel=icon]').getAttribute('href')).split(',').slice(1).join(',')),icon);
 assert.equal(await page.evaluate(icon=>{
   const svg=new DOMParser().parseFromString(icon,'image/svg+xml');
   return [...svg.querySelectorAll('path')].map(e=>e.getAttribute('d')).join('|')===[...document.querySelectorAll('#library-home .brand svg path')].map(e=>e.getAttribute('d')).join('|');
 },icon),true);
 await page.emulateMedia({forcedColors:'active'});
 await page.waitForFunction(()=>matchMedia('(forced-colors: active)').matches);
 const colors=await mark.evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e.querySelector('svg')).stroke]);
 assert.equal(colors[0],colors[1]);
 await page.emulateMedia({forcedColors:'none'});
 const chooserPromise=page.waitForEvent('filechooser');await header.getByRole('button',{name:'＋ 导入教材'}).click();
 const chooser=await chooserPromise;assert.ok((await chooser.element().getAttribute('accept')).includes('pdf'));await chooser.setFiles([]);
 await header.getByRole('button',{name:'学习记忆',exact:true}).click();await page.locator('#learning-memory').waitFor({state:'visible'});
 await page.locator('#learning-memory .home-toolbar').getByRole('button',{name:'学习空间',exact:true}).click();
 await page.locator('#library-home').waitFor({state:'visible'});
 console.log('PASS: custom mark, 20px, shared favicon geometry, currentColor/forced-colors, stable hover, import chooser and header navigation. 16px visual evidence: brand-comparison.png.');
}finally{await browser.close();}
