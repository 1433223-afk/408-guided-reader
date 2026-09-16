import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
const viewportWidth=Number(process.env.READER_VIEWPORT_WIDTH||1440);
const page = await browser.newPage({viewport:{width:viewportWidth,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(process.env.READER_URL || 'http://127.0.0.1:8766/');
 await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
 await page.locator('#book-overview .overview-book-heading .primary-action').click();
 await page.locator('.page canvas').first().waitFor({timeout:30000});
 await page.locator('#outline-toggle').click();
 const outline=await page.evaluate(async()=>{const books=await (await fetch('/api/books')).json();const rev=books.books.find(b=>b.active_revision.page_count===348).active_revision.id;return (await fetch(`/api/revisions/${rev}/outline`)).json();});
 const section=outline.nodes.find(n=>n.kind==='SECTION'&&n.title.startsWith('2.1 '));
 const row=page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
 if(!await row.isVisible())await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
 assert.equal(await page.locator('.outline-guide-action').count(), 0);
 await row.locator('.outline-target').click();
 await page.locator('#outline-toggle').click();
 const entry=page.locator(`.section-guide-entry[data-section-id="${section.outline_node_id}"]`);
 await entry.scrollIntoViewIfNeeded();
 await page.screenshot({path:'.tmp/guide-section-entry.png'});
 const entryPosition=()=>entry.evaluate(button=>{
  const page=button.closest('.page'), r=page.getBoundingClientRect(), b=button.getBoundingClientRect();
  return {y:(b.top-r.top)/r.height, right:r.right-b.right, width:r.width};
 });
 assert.ok(Math.abs((await entryPosition()).y-section.start_y)<.002);
 await page.locator('#zoom-in').click();
 await entry.waitFor();
 assert.ok(Math.abs((await entryPosition()).y-section.start_y)<.002);
 await page.locator('#zoom-out').click();
 await entry.waitFor();
 assert.equal(await entry.count(),1);
 await entry.click();await page.locator('.guide-text').first().waitFor();
 assert.ok(await page.getByRole('button',{name:'重新生成',exact:true}).isVisible());
 assert.equal(await page.locator('#guide-more,#guide-expand').count(),0);
 const width=()=>page.locator('#guide-panel').evaluate(el=>el.getBoundingClientRect().width);
 const pdfVisible=async()=>{const pdf=await page.locator('#viewer').boundingBox(),guide=await page.locator('#guide-panel').boundingBox();assert.ok(pdf.width>=279);assert.ok(pdf.x+pdf.width<=guide.x+1);};
 const guideMinimum=Math.min(320,Math.max(240,viewportWidth-24));
 const guideMaximum=Math.max(guideMinimum,Math.min(760,viewportWidth-280));
 await pdfVisible();const original=await width();assert.ok(Math.abs(original-410)<2,`Guide default width ${original} differs from Assistant`);
 await page.mouse.move(10,10);await page.waitForTimeout(50);
 const handleUi=await page.evaluate(()=>{
  const guide=getComputedStyle(document.querySelector('#guide-divider'));
  const assistant=getComputedStyle(document.querySelector('#assistant-resize-handle'));
  const guideScroll=getComputedStyle(document.querySelector('#guide-scroll'));
  const assistantScroll=getComputedStyle(document.querySelector('#assistant-turns'));
  return {guide:{left:guide.left,width:guide.width,cursor:guide.cursor},assistant:{left:assistant.left,width:assistant.width,cursor:assistant.cursor},
    guideScroll:{width:guideScroll.scrollbarWidth,color:guideScroll.scrollbarColor},assistantScroll:{width:assistantScroll.scrollbarWidth,color:assistantScroll.scrollbarColor}};
 });
 assert.deepEqual(handleUi.guide,handleUi.assistant);
 assert.deepEqual(handleUi.guideScroll,handleUi.assistantScroll);
 const handle=await page.locator('#guide-divider').boundingBox();await page.mouse.move(handle.x+6,handle.y+250);await page.waitForTimeout(180);
 const activeHandleUi=await page.evaluate(()=>{
  const assistantPanel=document.querySelector('#assistant-panel');assistantPanel.classList.add('resizing');
  const guide=getComputedStyle(document.querySelector('#guide-divider'),'::after').backgroundColor;
  const assistant=getComputedStyle(document.querySelector('#assistant-resize-handle'),'::after').backgroundColor;
  assistantPanel.classList.remove('resizing');return {guide,assistant};
 });
 assert.equal(activeHandleUi.guide,activeHandleUi.assistant);
 await page.mouse.down();await page.mouse.move(handle.x-110,handle.y+250,{steps:8});await page.mouse.up();assert.ok(await width()>original+80);await pdfVisible();
 // Real wheel scrolling; capture the visible article block before changing layout.
 const body=await page.locator('#guide-scroll').boundingBox();await page.mouse.move(body.x+body.width/2,body.y+250);await page.mouse.wheel(0,650);await page.waitForTimeout(250);
 const pos=()=>page.locator('#guide-scroll').evaluate(el=>{const top=el.getBoundingClientRect().top;const t=[...el.querySelectorAll('.guide-text')].find(t=>t.getBoundingClientRect().bottom>top);const r=t.getBoundingClientRect();return {id:t.dataset.moduleId,fraction:Math.max(0,(top-r.top)/r.height),scroll:el.scrollTop};});
 const before=await pos();assert.ok(before.scroll>0);
 const resized=await width();assert.ok(resized>original+80);
 let after=await pos();assert.equal(after.id,before.id);assert.ok(Math.abs(after.fraction-before.fraction)<.025);
 await page.locator('#guide-close').click();
 assert.ok(await page.locator('.reader-controls #guide-reopen').isVisible());
 await page.locator('#guide-reopen').click();await page.locator('.guide-text').first().waitFor();after=await pos();assert.equal(after.id,before.id);assert.ok(Math.abs(after.fraction-before.fraction)<.025);
 // A source near the current reading position must move only the PDF, keeping Guide open.
 const ref=page.locator(`.guide-text[data-module-id="${after.id}"]`).locator('..').locator('.guide-source').first();
 await ref.scrollIntoViewIfNeeded();const sourceBefore=await pos();await ref.click();await page.waitForTimeout(500);assert.ok(await page.locator('#guide-panel').isVisible());const sourceAfter=await pos();assert.equal(sourceBefore.id,sourceAfter.id);assert.ok(Math.abs(sourceBefore.scroll-sourceAfter.scroll)<2);
 await page.locator('#guide-divider').focus();const keyWidth=await width();await page.keyboard.press('ArrowRight');assert.ok(await width()<keyWidth);
 await page.keyboard.press('End');assert.ok(Math.abs(await width()-guideMaximum)<2);await pdfVisible();
 await page.keyboard.press('Enter');assert.ok(await page.locator('#guide-reopen').isVisible());await page.keyboard.press('Enter');await page.locator('.guide-text').first().waitFor();
 await page.setViewportSize({width:900,height:800});await page.waitForTimeout(300);await pdfVisible();await page.setViewportSize({width:viewportWidth,height:1000});await page.waitForTimeout(300);
 await page.locator('#guide-scroll').evaluate(el=>el.scrollTop=0);
 await page.locator('.guide-source').first().click();
 await page.waitForTimeout(400);
 const sourceOffset=await page.evaluate(async sid=>{
  const books=await (await fetch('/api/books')).json();const rev=books.books.find(b=>b.active_revision.page_count===348).active_revision.id;
  const guide=await (await fetch(`/api/revisions/${rev}/sections/${sid}/guide`)).json();
  const anchor=guide.published.sources[guide.published.content.modules[0].source_ids[0]];
  const target=document.querySelector(`.page[data-index="${anchor.pdf_page_index}"]`);
  return target.offsetTop+target.offsetHeight*anchor.y-document.getElementById('viewer').scrollTop;
 },section.outline_node_id);
 assert.ok(Math.abs(sourceOffset)<10, `Source offset ${sourceOffset}`);
 // Closing a dock after horizontal reading must center the current PDF page in the restored viewport.
 while(Number((await page.locator('#zoom-value').textContent()).replace('%',''))<250)await page.locator('#zoom-in').click();
 await page.waitForTimeout(300);
 const closeState=await page.evaluate(()=>{
  const viewer=document.querySelector('#viewer'),pageIndex=Number(document.querySelector('#page-number').value)-1;
  viewer.scrollLeft=viewer.scrollWidth-viewer.clientWidth;
  window.__guideCloseCanvas=document.querySelector(`.page[data-index="${pageIndex}"] canvas`);
  return {pageIndex,zoom:document.querySelector('#zoom-value').textContent,scrollTop:viewer.scrollTop};
 });
 await page.locator('#guide-close').click();await page.waitForTimeout(100);
 const centered=await page.evaluate(({pageIndex,zoom,scrollTop})=>{
  const viewer=document.querySelector('#viewer'),page=document.querySelector(`.page[data-index="${pageIndex}"]`);
  const vr=viewer.getBoundingClientRect(),pr=page.getBoundingClientRect();
  return {centerError:Math.abs((pr.left+pr.right-vr.left-vr.right)/2),canvasSame:page.querySelector('canvas')===window.__guideCloseCanvas,
   pageSame:Number(document.querySelector('#page-number').value)-1===pageIndex,zoomSame:document.querySelector('#zoom-value').textContent===zoom,
   scrollTopDelta:viewer.scrollTop-scrollTop,scrollLeft:viewer.scrollLeft,scrollWidth:viewer.scrollWidth,clientWidth:viewer.clientWidth,
   pageLeft:pr.left,pageRight:pr.right,viewerLeft:vr.left,viewerRight:vr.right};
 },closeState);
 assert.ok(centered.centerError<2,JSON.stringify(centered));assert.equal(centered.canvasSame,true);assert.equal(centered.pageSame,true);assert.equal(centered.zoomSame,true);assert.ok(Math.abs(centered.scrollTopDelta)<1);
 await page.locator('#guide-reopen').click();await page.locator('.guide-text').first().waitFor();
 await mkdir('.tmp', {recursive:true});
 await page.screenshot({path:'.tmp/guide-2.1-dual.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('SPLIT_READER_PASS: direct regenerate, pointer resize, keyboard resize, collapse/reopen, source retention, close recenter, PDF visible');
}finally{await browser.close();}
