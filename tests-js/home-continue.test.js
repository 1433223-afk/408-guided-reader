import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
test('Home cover resolves defaults and preserves a fallback when a user image fails',async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page=await browser.newPage();
 await page.route('http://cover.test/**',route=>route.request().url().endsWith('/ok.svg')
   ? route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'})
   : route.fulfill({contentType:'text/html',body:'<body></body>'}));
 await page.goto('http://cover.test/');
 await page.addScriptTag({content:fs.readFileSync('src/reader_service/static/screens.js','utf8').replaceAll('export ','')});
 assert.deepEqual(await page.evaluate(()=>['计算机组成原理','数据结构','操作系统','计算机网络'].map(title=>createBookCover({title}).dataset.coverVariant)),['coa','ds','os','cn']);
 assert.deepEqual(await page.evaluate(()=>['Computer Organization','Data Structures','Operating Systems','Computer Networks'].map(title=>resolveBookCoverVariant({title}))),['coa','ds','os','cn']);
 const family=await page.evaluate(()=>{
   const variants=Object.keys(BOOK_COVER_FAMILY);
   return {count:variants.length, same:variants.every(variant=>{
     const book={id:'stable',title:'教材',cover:{variant}};
     const large=createBookCover(book,'continue-cover'), small=createBookCover(book,'book-spine');
     return large.dataset.coverVariant===small.dataset.coverVariant
       && large.dataset.coverDensity==='large' && small.dataset.coverDensity==='small'
       && large.innerHTML!==small.innerHTML
       && large.querySelector('svg rect:nth-child(2)').getAttribute('fill')===small.querySelector('svg rect:nth-child(2)').getAttribute('fill');
   }), unique:new Set(variants.map(variant=>createBookCover({title:'教材'},'',{defaultVariant:variant}).innerHTML)).size,
   assigned:new Set(Array.from({length:6},(_,i)=>resolveBookCoverVariant({id:String(i),title:'未知教材'}))).size,
   stable:resolveBookCoverVariant({id:'fixed',title:'甲'})===resolveBookCoverVariant({id:'fixed',title:'乙'})};
 });
 assert.deepEqual(family,{count:10,same:true,unique:10,assigned:6,stable:true});
 assert.equal(await page.evaluate(()=>createBookCover({title:'其他教材'},'',{defaultVariant:'ds'}).dataset.coverSource),'system');
 await page.evaluate(()=>document.body.append(createBookCover({title:'计算机组成原理',cover:{userCoverUrl:'/ok.svg'}},'custom')));
 await page.waitForFunction(()=>document.querySelector('.custom').dataset.coverSource==='user');
 await page.evaluate(()=>document.body.append(createBookCover({title:'其他教材'},'broken',{userCoverUrl:'/missing.png'})));
 await page.waitForFunction(()=>!document.querySelector('.broken img'));
 assert.equal(await page.locator('.broken').getAttribute('data-cover-source'),'fallback');
 assert.equal(await page.locator('.broken svg').count(),1);
 assert.equal(await page.evaluate(()=>createBookCover({title:'其他教材'},'',{userCoverUrl:'https://external.test/cover.png'}).querySelectorAll('img').length),0);
 } finally {await browser.close();}
});
test('Home projects section/subsection and honest progress; missing context never blocks resume',async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page=await browser.newPage();
 await page.setContent('<section id="library-home"><div id="book-list"></div><section id="home-continue"></section></section>');
 await page.addScriptTag({content:fs.readFileSync('src/reader_service/static/screens.js','utf8').replaceAll('export ','')});
 await page.evaluate(()=>{
 window.book={title:'真实位置投影测试',active_revision:{id:'r',page_count:100,position:{updated_at:'2026-09-16',pdf_page_index:12,normalized_offset:.3,zoom:1}}};
 window.context={chapter:{title:'第2章'},section:{title:'2.1 数据表示'},subsection:{title:'2.1.1 进位计数制'},learning_counts:{UNDERSTOOD:5,NOT_FULLY_CLEAR:8,UNCONFIRMED:34}};
 window.reads=[];window.ui=createScreens({api:async url=>url.endsWith('/preparation')?{pages:[]}:window.context,read:b=>window.reads.push(b.active_revision.position),home:()=>{},memory:()=>{}});
 return window.ui.library([window.book]);
 });
 assert.equal(await page.locator('.continue-section').textContent(),'2.1 数据表示');
 assert.equal(await page.locator('.continue-location').textContent(),'2.1.1 进位计数制');
 assert.equal(await page.locator('.continue-stats').textContent(),'本章 13 / 47 已确认 · 8 个仍需理解');
 assert.deepEqual(await page.locator('.continue-progress-strip span').evaluateAll(es=>es.map(e=>e.style.flexGrow)),['5','8','34']);
 await page.locator('.primary-action').first().click();
 assert.equal(await page.evaluate(()=>window.reads[0].pdf_page_index),12);
 await page.evaluate(async()=>{window.context={};await window.ui.library([window.book]);});
 assert.equal(await page.locator('.continue-progress-strip').count(),0);
 assert.equal(await page.locator('#home-continue .primary-action').isEnabled(),true);
 await page.evaluate(()=>window.ui.library([]));
 assert.equal(await page.locator('#home-continue').isVisible(),false);
 } finally {await browser.close();}
});
