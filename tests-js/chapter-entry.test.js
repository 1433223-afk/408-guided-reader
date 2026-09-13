import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('chapter entry ignores departed context and coalesces preparation clicks', async()=>{
  const browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<button id="outline-toggle">目录</button>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replaceAll('export ','')});
    await page.evaluate(()=>{
      window.posts=[];window.opened=[];window.published=0;
      window.snapshot={status:'NOT_PREPARED',knowledge_points:[]};
      window.ui=createChapterEntry({revision:()=> 'revision',published:()=>window.published++,openOverview:id=>window.opened.push(id),
        api:async(url,options={})=>{
          if(url.includes('/chapters/old/'))return new Promise(r=>window.finishOld=r);
          if(options.method){window.posts.push(url);return {chapter_map:window.snapshot={status:'PREPARING',prepare_stage:'QUEUED',knowledge_points:[]}};}
          return window.snapshot;
        }});
      window.ui.sync('old','s-old');window.ui.sync('current','s');
      window.finishOld({status:'READY',knowledge_points:[{primary_section_id:'s-old'}]});
    });
    await page.locator('#reader-kp-action').filter({hasText:'生成本章 KP'}).waitFor();
    await page.evaluate(()=>{const b=document.querySelector('#reader-kp-action');b.click();b.click();});
    await page.waitForFunction(()=>document.querySelector('#reader-kp-action').textContent.includes('等待开始'));
    assert.deepEqual(await page.evaluate(()=>window.posts),['/api/revisions/revision/chapters/current/knowledge-map/prepare']);
    assert.equal(await page.locator('#reader-kp-action').isDisabled(),true);
    await page.evaluate(()=>window.snapshot={status:'READY',knowledge_points:[{primary_section_id:'s'},{primary_section_id:'other'}]});
    await page.locator('#reader-kp-action').filter({hasText:'本节 1 KP'}).waitFor();
    await page.locator('#reader-kp-action').click();
    assert.deepEqual(await page.evaluate(()=>window.opened),['current']);
    assert.equal(await page.evaluate(()=>window.published),1);
    await page.evaluate(()=>window.ui.reset());
    assert.equal(await page.locator('#reader-kp-action').isVisible(),false);
  } finally {await browser.close();}
});
