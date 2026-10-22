import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('Tablet learning reads share navigation work without hiding writes or publication', async t => {
  const browser = await chromium.launch({
    executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless:true,
  });
  const source = fs.readFileSync(new URL('../src/reader_service/static/master-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  async function fixture(tablet = true) {
    const page = await browser.newPage();
    await page.setContent('<section class="reader"><aside id="dock"></aside><div id="pages"></div><span data-learning-status="kp">未读取</span></section>');
    await page.addScriptTag({content:`
      function renderAssistantAnswer(node,text) { node.textContent=text; }
      function createComposerChoice() { return {sync(){}}; }
      function createMessageRail() {}
      ${source}
    `});
    await page.evaluate(tablet => {
      window.owner = 'revision'; window.chapterId = 'chapter'; window.reads = []; window.requests = [];
      window.failures = [];
      window.payload = (status = 'UNCONFIRMED', structureVersion = 1) => ({
        points:[{knowledge_point_id:'kp',chapter_outline_node_id:window.chapterId,chapter_structure_version:structureVersion,status}],
        sections:[],topics:[],
      });
      window.ui = createMasterUI({tablet,
        api:url => new Promise((resolve,reject) => window.reads.push({url,resolve,reject})),
        revision:() => window.owner, chapter:() => window.chapterId,
        pages:document.getElementById('pages'),dock:document.getElementById('dock'),
        openDock:() => {},goToPage:() => {},announce:message => window.failures.push(message),
        memoryControl:() => document.createElement('button'),toggleExpanded:() => {},
      });
      window.start = options => {
        const index=window.requests.length;
        window.requests.push(window.ui.refreshEntries(options).then(result => ({result}),error => ({error:error.message})));
        return index;
      };
      window.finish = async (index,status,version) => {
        window.reads[index].resolve(window.payload(status,version));
        await Promise.resolve(); await Promise.resolve();
      };
    },tablet);
    return page;
  }
  try {
    await t.test('same-chapter background reads issue one request and retry after a shared failure', async () => {
      const page=await fixture();
      await page.evaluate(() => { window.start({background:true}); window.start({background:true}); });
      assert.equal(await page.evaluate(() => window.reads.length),1);
      await page.evaluate(async () => {window.reads[0].reject(new Error('temporary connection'));await Promise.all(window.requests);window.start({background:true});});
      assert.equal(await page.evaluate(() => window.reads.length),2);
      await page.evaluate(async () => {await window.finish(1,'UNDERSTOOD');await window.requests[2];});
      assert.equal(await page.locator('[data-learning-status]').textContent(),'已弄懂');
      await page.close();
    });

    await t.test('a fresh write result supersedes an older navigation response', async () => {
      const page=await fixture();
      await page.evaluate(() => {window.start({background:true});window.start();window.start({background:true});});
      assert.equal(await page.evaluate(() => window.reads.length),2,'Background can follow a new refresh; the refresh cannot follow an old read');
      await page.evaluate(async () => {await window.finish(1,'UNDERSTOOD');await Promise.all(window.requests.slice(1));await window.finish(0,'UNCONFIRMED');await window.requests[0];});
      assert.equal(await page.locator('[data-learning-status]').textContent(),'已弄懂');
      await page.close();
    });

    await t.test('returning to a chapter cannot accept its earlier out-of-order read', async () => {
      const page=await fixture();
      await page.evaluate(() => {
        window.start({background:true});window.chapterId='other';window.start({background:true});
        window.chapterId='chapter';window.start({background:true});
      });
      assert.equal(await page.evaluate(() => window.reads.length),3);
      await page.evaluate(async () => {await window.finish(2,'UNDERSTOOD');await window.requests[2];await window.finish(0,'UNCONFIRMED');await window.requests[0];await window.finish(1,'NOT_FULLY_CLEAR');await window.requests[1];});
      assert.equal(await page.locator('[data-learning-status]').textContent(),'已弄懂');
      await page.close();
    });

    await t.test('initial READY reuses matching data but refetches a newly published structure', async () => {
      const page=await fixture();
      await page.evaluate(() => {
        window.start({background:true});
        window.start({background:true,publication:{chapterId:'chapter',knowledgePointIds:['kp'],structureVersion:2}});
      });
      assert.equal(await page.evaluate(() => window.reads.length),1);
      await page.evaluate(async () => {await window.finish(0,'UNCONFIRMED',1);await window.requests[0];});
      await page.waitForFunction(() => window.reads.length===2);
      await page.evaluate(async () => {await window.finish(1,'UNDERSTOOD',2);await window.requests[1];});
      assert.equal(await page.locator('[data-learning-status]').textContent(),'已弄懂');
      await page.evaluate(async () => {
        const count=window.start({background:true,publication:{chapterId:'chapter',knowledgePointIds:['kp'],structureVersion:2}});
        await window.requests[count];
      });
      assert.equal(await page.evaluate(() => window.reads.length),2,'A first READY callback may arrive just after the matching navigation read finished');
      await page.evaluate(() => {
        window.start({background:true});
        window.start({background:true,publication:{chapterId:'chapter',knowledgePointIds:['kp'],structureVersion:2}});
      });
      assert.equal(await page.evaluate(() => window.reads.length),3);
      await page.evaluate(async () => {await window.finish(2,'UNDERSTOOD',2);await Promise.all(window.requests.slice(3));});
      assert.equal(await page.evaluate(() => window.reads.length),3,'Matching published IDs/version need no second transfer');
      await page.close();
    });

    await t.test('reset invalidates an in-flight read, and Desktop retains independent reads', async () => {
      const page=await fixture();
      await page.evaluate(async () => {window.start({background:true});window.ui.reset();await window.finish(0,'UNDERSTOOD');await window.requests[0];});
      assert.equal(await page.locator('[data-learning-status]').textContent(),'未读取');
      await page.close();
      const desktop=await fixture(false);
      await desktop.evaluate(() => {window.start({background:true});window.start({background:true});});
      assert.equal(await desktop.evaluate(() => window.reads.length),2);
      await desktop.evaluate(async () => {await window.finish(0,'UNCONFIRMED');await window.finish(1,'UNDERSTOOD');await Promise.all(window.requests);});
      await desktop.close();
    });
  } finally {
    await browser.close();
  }
});
