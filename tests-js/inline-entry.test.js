import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

test('current-Section Inline entry guards async clicks and keeps local visibility independent', async () => {
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1/inline-test', route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
    await page.goto('http://127.0.0.1/inline-test');
    await page.setContent('<div id="reader"><button id="guide-reopen"></button><div id="viewer"></div></div>');
    const source = fs.readFileSync(new URL('../src/reader_service/static/inline-ui.js', import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
    await page.addScriptTag({content: source + '\nwindow.createInlineUI=createInlineUI;'});
    await page.evaluate(() => {
      window.anchor = {pageIndex: 0, normalizedY: .5};
      window.posts = []; window.snapshots = {a: {task:null,published:null}, b: {task:null,published:null}};
      window.holdRead = null;
      window.ui = createInlineUI({
        state: {revision:{id:'r'},rendered:new Set(),outlineNodes:['a','b'].map((id,i)=>({outline_node_id:id,title:id,kind:'SECTION',resolution_state:'RESOLVED',start_page:i,end_page:i,start_y:0,end_y:1}))},
        api: async (url, options={}) => {
          const id = url.split('/sections/')[1].split('/')[0];
          if (!options.method) { if(window.holdRead) await window.holdRead; return window.snapshots[id]; }
          window.posts.push({id,url,body:JSON.parse(options.body)});
          return window.snapshots[id] = {task:{id:'asset',state:'DRAFT',stage:'GENERATE'},published:null};
        }, readingAnchor:()=>window.anchor, layout:f=>f(), hideContextMenu:()=>{},
      });
      window.ui.sync();
    });
    // Two clicks while the first local snapshot is pending must not send twice or drift to B.
    await page.evaluate(() => {
      window.holdRead = new Promise(r=>window.releaseRead=r);
      document.querySelector('#inline-open').click(); document.querySelector('#inline-open').click();
      window.anchor.pageIndex=1; document.querySelector('#viewer').dispatchEvent(new Event('scroll'));
      window.releaseRead(); window.holdRead=null;
    });
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(()=>window.posts),[]);
    await page.locator('#inline-open').click();
    await page.waitForFunction(()=>document.querySelector('#inline-open').textContent.includes('生成中'));
    assert.equal(await page.locator('#inline-open').isDisabled(),true);
    assert.equal(await page.locator('#inline-more').isVisible(),false);
    assert.deepEqual(await page.evaluate(()=>window.posts.map(p=>p.id)),['b']);
    await page.evaluate(()=>window.snapshots.b={task:{id:'asset',state:'IN_REVIEW',stage:'REVIEW'},published:null});
    await page.waitForFunction(()=>document.querySelector('#inline-open').textContent.includes('审查中'));
    await page.evaluate(()=>window.snapshots.b={task:{id:'asset',state:'PUBLISHED'},published:{id:'asset',content:{items:[]},sources:{},no_intervention:true}});
    await page.waitForFunction(()=>!document.querySelector('#inline-open').disabled);
    assert.equal(await page.locator('#inline-open').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#inline-more').isVisible(),true);
    await page.locator('#inline-more').click();
    assert.deepEqual(await page.locator('#inline-menu button').allTextContents(),['重新生成']);
    await page.locator('#inline-generate').press('Escape');
    assert.equal(await page.locator('#inline-menu').isVisible(),false);
    await page.locator('#inline-open').click();
    assert.equal(await page.locator('#inline-open').getAttribute('aria-pressed'),'false');
    await page.locator('#inline-open').press('Enter');
    assert.equal(await page.locator('#inline-open').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>window.posts.length),1);
    await page.evaluate(()=>{window.anchor.pageIndex=3;document.querySelector('#viewer').dispatchEvent(new Event('scroll'));});
    assert.equal(await page.locator('#inline-open').isDisabled(),true);
    assert.equal(await page.locator('#inline-open').getAttribute('data-section-id'),'');
    assert.equal(await page.locator('#inline-more').isVisible(),false);
  } finally { await browser.close(); }
});

test('failed Inline entry retries the owned stage or starts a new terminal candidate', async () => {
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    for (const terminal of [false,true]) {
      const page = await browser.newPage();
      await page.route('http://127.0.0.1/inline-test', route=>route.fulfill({contentType:'text/html',body:'<div id="reader"><button id="guide-reopen"></button><div id="viewer"></div></div>'}));
      await page.goto('http://127.0.0.1/inline-test');
      await page.addScriptTag({content: fs.readFileSync(new URL('../src/reader_service/static/inline-ui.js', import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function')});
      await page.evaluate(terminal=>{
        window.posts=[];
        const ui=createInlineUI({state:{revision:{id:'r'},rendered:new Set(),outlineNodes:[{outline_node_id:'s',title:'当前节',kind:'SECTION',resolution_state:'RESOLVED',start_page:0,end_page:0,start_y:0,end_y:1}]},
          readingAnchor:()=>({pageIndex:0,normalizedY:.5}), layout:f=>f(), hideContextMenu:()=>{},
          api:async(url,options={})=>{
            if(options.method) window.posts.push({url,body:JSON.parse(options.body)});
            return {task:{id:'owned-failure',state:options.method?'DRAFT':'FAILED',terminal},published:null};
          }});
        ui.sync();
      },terminal);
      await page.locator('#inline-open').click();
      await page.waitForFunction(()=>window.posts.length===1);
      const [post]=await page.evaluate(()=>window.posts);
      assert.ok(post.url.endsWith(terminal?'/generate':'/retry'));
      if(terminal) assert.ok(post.body.intent_id); else assert.deepEqual(post.body,{asset_id:'owned-failure'});
      await page.close();
    }
  } finally {await browser.close();}
});
