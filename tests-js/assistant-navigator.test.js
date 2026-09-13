import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('topic tree selects independent nodes, expands by keyboard, and never mounts conversation bodies', async () => {
  const browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<aside><div class="assistant-heading-title"></div></aside>');
    await page.evaluate(() => {
      for (const id of ['assistant-context-bar','assistant-children','assistant-scope','assistant-first-turn','assistant-turns','assistant-empty','assistant-follow-up']) {
        const el = document.createElement('div'); el.id=id; document.querySelector('aside').append(el);
      }
    });
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/assistant-navigator.js',import.meta.url),'utf8').replace('export ','')});
    await page.evaluate(() => {
      window.focusCalls=[];
      const navigator=createAssistantNavigator(document.querySelector('aside'), (...args) => window.focusCalls.push(args));
      navigator.render({roots:[{root_id:'r',label:'根主题',turns:[{answer:'NEVER MOUNT THIS'}],nodes:[
        {node_id:'a',parent_ref:{node_id:null},label:'分支 A'},
        {node_id:'b',parent_ref:{node_id:null},label:'分支 B'},
        {node_id:'c',parent_ref:{node_id:'a'},label:'下一层'},
      ]}], current:{root_id:'r',node_id:null,label:'根主题'}});
    });
    const rows=page.locator('[role=treeitem]');
    assert.equal(await rows.count(),4);
    assert.deepEqual(await rows.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-level'))),['1','2','3','2']);
    await rows.first().focus(); await rows.first().press('ArrowLeft');
    assert.equal(await rows.count(),1);
    await rows.first().press('ArrowRight');
    assert.equal(await rows.count(),4);
    await rows.first().press('ArrowDown'); await page.keyboard.press('Enter');
    await rows.first().click();
    assert.deepEqual(await page.evaluate(()=>window.focusCalls),[['r','a'],['r',null]]);
    assert.ok(!(await page.locator('body').innerText()).includes('NEVER MOUNT THIS'));
  } finally { await browser.close(); }
});
