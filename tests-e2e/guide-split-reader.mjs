import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(process.env.READER_URL || 'http://127.0.0.1:8766/');
 await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).click();
 await page.locator('.page canvas').first().waitFor({timeout:30000});
 await page.locator('#outline-toggle').click();
 const outline=await page.evaluate(async()=>{const books=await (await fetch('/api/books')).json();const rev=books.books.find(b=>b.active_revision.page_count===348).active_revision.id;return (await fetch(`/api/revisions/${rev}/outline`)).json();});
 const section=outline.nodes.find(n=>n.kind==='SECTION'&&n.title.startsWith('2.1 '));
 const row=page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
 if(!await row.isVisible())await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
 await row.locator('.outline-guide-action').click();await page.locator('.guide-text').first().waitFor();
 const width=()=>page.locator('#guide-panel').evaluate(el=>el.getBoundingClientRect().width);
 const pdfVisible=async()=>{const pdf=await page.locator('#viewer').boundingBox(),guide=await page.locator('#guide-panel').boundingBox();assert.ok(pdf.width>=319);assert.ok(pdf.x+pdf.width<=guide.x+1);};
 await pdfVisible();const original=await width();
 const handle=await page.locator('#guide-divider').boundingBox();await page.mouse.move(handle.x+5,handle.y+250);await page.mouse.down();await page.mouse.move(handle.x-110,handle.y+250,{steps:8});await page.mouse.up();assert.ok(await width()>original+80);await pdfVisible();
 // Real wheel scrolling; capture the visible article block before changing layout.
 const body=await page.locator('#guide-scroll').boundingBox();await page.mouse.move(body.x+body.width/2,body.y+250);await page.mouse.wheel(0,650);await page.waitForTimeout(250);
 const pos=()=>page.locator('#guide-scroll').evaluate(el=>{const top=el.getBoundingClientRect().top;const t=[...el.querySelectorAll('.guide-text')].find(t=>t.getBoundingClientRect().bottom>top);const r=t.getBoundingClientRect();return {id:t.dataset.moduleId,fraction:Math.max(0,(top-r.top)/r.height),scroll:el.scrollTop};});
 const before=await pos();assert.ok(before.scroll>0);
 const resized=await width();await page.locator('#guide-expand').click();await pdfVisible();assert.ok(await width()>=resized);await page.locator('#guide-expand').click();assert.ok(Math.abs(await width()-resized)<2);
 let after=await pos();assert.equal(after.id,before.id);assert.ok(Math.abs(after.fraction-before.fraction)<.025);
 await page.locator('#guide-close').click();await page.locator('#guide-reopen').click();await page.locator('.guide-text').first().waitFor();after=await pos();assert.equal(after.id,before.id);assert.ok(Math.abs(after.fraction-before.fraction)<.025);
 // A source near the current reading position must move only the PDF, keeping Guide open.
 const ref=page.locator(`.guide-text[data-module-id="${after.id}"]`).locator('..').locator('.guide-source').first();
 await ref.scrollIntoViewIfNeeded();const sourceBefore=await pos();await ref.click();await page.waitForTimeout(500);assert.ok(await page.locator('#guide-panel').isVisible());const sourceAfter=await pos();assert.equal(sourceBefore.id,sourceAfter.id);assert.ok(Math.abs(sourceBefore.scroll-sourceAfter.scroll)<2);
 await page.locator('#guide-divider').focus();const keyWidth=await width();await page.keyboard.press('ArrowRight');assert.ok(await width()<keyWidth);await page.keyboard.press('Enter');assert.ok(await page.locator('#guide-reopen').isVisible());await page.keyboard.press('Enter');await page.locator('.guide-text').first().waitFor();
 await page.setViewportSize({width:900,height:800});await page.waitForTimeout(300);await pdfVisible();await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(300);
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
 await mkdir('.tmp', {recursive:true});
 await page.screenshot({path:'.tmp/guide-2.1-dual.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('SPLIT_READER_PASS: pointer resize, keyboard resize, expand/restore, collapse/reopen, source retention, window resize, PDF visible');
}finally{await browser.close();}
