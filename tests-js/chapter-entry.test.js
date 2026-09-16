import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('chapter entry ignores departed context and coalesces preparation clicks', async()=>{
  const browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<section id="reader"><button id="outline-toggle">目录</button></section>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replaceAll('export ','')});
    await page.evaluate(()=>{
      window.posts=[];window.opened=[];window.jumps=[];window.published=0;window.closedPeers=0;
      window.snapshot={status:'NOT_PREPARED',knowledge_points:[]};
      window.ui=createChapterEntry({revision:()=> 'revision',published:()=>window.published++,closePeers:()=>window.closedPeers++,openOverview:id=>window.opened.push(id),goToPage:(...args)=>window.jumps.push(args),
        api:async(url,options={})=>{
          if(url.endsWith('/outline')) return {nodes:[{kind:'SECTION',parent_id:'current',outline_node_id:'s',title:'第一节'}]};
          if(url.endsWith('/learning')) return {points:[{knowledge_point_id:'kp',status:'UNDERSTOOD'}]};
          if(url.includes('/chapters/old/'))return new Promise(r=>window.finishOld=r);
          if(options.method){window.posts.push(url);return {chapter_map:window.snapshot={status:'PREPARING',prepare_stage:'QUEUED',knowledge_points:[]}};}
          return window.snapshot;
        }});
      window.ui.sync('old','s-old');window.ui.sync('current','s');
      window.finishOld({status:'READY',knowledge_points:[{primary_section_id:'s-old'}]});
    });
    await page.locator('#reader-kp-action').filter({hasText:'＋ 生成本章知识点'}).waitFor();
    await page.evaluate(()=>{const b=document.querySelector('#reader-kp-action');b.click();b.click();});
    await page.waitForFunction(()=>document.querySelector('#reader-kp-action').textContent.includes('等待开始'));
    assert.deepEqual(await page.evaluate(()=>window.posts),['/api/revisions/revision/chapters/current/knowledge-map/prepare']);
    assert.equal(await page.locator('#reader-kp-action').isDisabled(),true);
    await page.evaluate(()=>window.snapshot={status:'READY',knowledge_points:[{knowledge_point_id:'kp',primary_section_id:'s',title:'真实来源',start_page:7,start_y:0.25},{primary_section_id:'other',title:'无来源'}]});
    await page.locator('#reader-kp-action').filter({hasText:'2 个知识点'}).waitFor();
    await page.locator('#reader-kp-action').click();
    assert.deepEqual(await page.evaluate(()=>window.opened),[]);
    assert.equal(await page.evaluate(()=>window.closedPeers),1);
    await page.getByText('已理解',{exact:true}).waitFor();
    await page.getByRole('button',{name:'PDF 8 ↗',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.jumps),[[7,0.25]]);
    assert.equal(await page.locator('#reader-kp-list').isVisible(),false);
    await page.locator('#reader-kp-action').click();
    await page.getByRole('button',{name:'查看完整学习结构 ↗'}).click();
    assert.deepEqual(await page.evaluate(()=>window.opened),['current']);
    assert.equal(await page.evaluate(()=>window.published),1);
    await page.evaluate(()=>window.ui.reset());
    assert.equal(await page.locator('#reader-kp-action').isVisible(),false);
  } finally {await browser.close();}
});

test('Reader identifies an unprepared chapter from page bookmarks without inventing exact ranges', async()=>{
  const {runInNewContext}=await import('node:vm');
  const source=fs.readFileSync(new URL('../src/reader_service/static/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function renderReaderSectionHint()'),source.indexOf('function updateViewport()'));
  const nodes=[{kind:'CHAPTER',outline_node_id:'a',resolution_state:'PARTIAL',start_page:10},
    {kind:'CHAPTER',outline_node_id:'b',resolution_state:'PARTIAL',start_page:20}];
  let target;
  const context={state:{outlineNodes:nodes},document:{getElementById:()=>({})},
    elements:{viewer:{getBoundingClientRect:()=>({top:68})}},
    captureZoomAnchor:()=>({pageIndex:19,normalizedY:0.5}),chapterEntry:{sync:id=>target=id},
    master:{viewportChanged:()=>{}}};
  runInNewContext(fn+'renderReaderSectionHint();',context);assert.equal(target,'a');
  context.captureZoomAnchor=()=>({pageIndex:20,normalizedY:0});
  runInNewContext(fn+'renderReaderSectionHint();',context);assert.equal(target,'b');
  nodes.push({...nodes[1],outline_node_id:'ambiguous'});
  runInNewContext(fn+'renderReaderSectionHint();',context);assert.equal(target,null);
  assert.equal(nodes[0].start_y,undefined);assert.equal(nodes[0].end_page,undefined);
});
