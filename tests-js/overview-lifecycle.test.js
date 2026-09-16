import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
test('Chapter lifecycle exposes actions, real stages and safe failure details',async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page=await browser.newPage();await page.setContent('<main></main>');
 await page.addScriptTag({content:fs.readFileSync('src/reader_service/static/screens.js','utf8').replaceAll('export ','')});
 const render=p=>page.evaluate(p=>{window.calls=0;document.querySelector('main').replaceChildren(createStructureLifecycle(p,()=>window.calls++));},p);
 await render({status:'NOT_PREPARED'});assert.equal(await page.locator('details').count(),0);
 await page.getByRole('button',{name:'生成学习结构'}).click();assert.equal(await page.evaluate(()=>window.calls),1);
 for(const [stage,label] of [['GENERATING','生成知识点'],['REVIEWING','独立审查']]){
 await render({status:'PREPARING',prepare_stage:stage,sections_completed:3,sections_total:7});
 assert.equal(await page.locator('[aria-current=step]').textContent(),label);
 assert.ok((await page.locator('main').innerText()).includes('3 / 7 小节'));assert.equal(await page.locator('button').count(),0);
 }
 await render({status:'FAILED',failure_code:'empty_response',generator_provider:'test-provider'});
 assert.equal(await page.locator('details').count(),0);
 assert.ok(!(await page.locator('main').innerText()).includes('仍可阅读教材'));
 assert.ok(!(await page.locator('main').innerText()).includes('empty_response'));
 await page.getByText('技术详情',{exact:true}).click();assert.ok((await page.locator('main').innerText()).includes('empty_response'));
 assert.ok((await page.getByRole('dialog').innerText()).includes('test-provider'));
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('button',{name:'重试',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls),1);
 await render({status:'READY',regeneration_allowed:false});assert.equal(await page.locator('main').innerText(),'···');
 await page.locator('summary').click();assert.equal(await page.getByRole('button').isDisabled(),true);
 await render({status:'READY',regeneration_allowed:true,regeneration_state:'RUNNING',prepare_stage:'REVIEWING'});
 assert.ok((await page.locator('main').innerText()).includes('仍可使用现有学习结构'));assert.equal(await page.locator('.structure-steps [aria-current]').textContent(),'独立审查');
 }finally{await browser.close();}
});
