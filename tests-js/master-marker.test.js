import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('first-pass KP confirmation stays separate from existing Master conversations', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<section class="reader"><aside id="dock"></aside><div id="pages"><div class="page" data-index="0"><canvas></canvas></div></div></section>`);
    const source = fs.readFileSync(new URL('../src/reader_service/static/master-ui.js', import.meta.url), 'utf8')
      .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
    await page.addScriptTag({content: `
      function renderAssistantAnswer(node, text) { node.textContent = text; }
      function createComposerChoice() {}
      function createMessageRail() {}
      ${source}
    `});
    await page.evaluate(() => {
      const first = {knowledge_point_id:'first',scope_id:'first',scope_kind:'KP',title:'首次知识点',status:'UNCONFIRMED',thread_id:null,display_end_page:0,display_end_y:.5};
      window.entries = {points:[first],sections:[],topics:[]};
      window.calls = [];
      window.ui = createMasterUI({
        api: async (url, options = {}) => {
          if (url.endsWith('/learning')) return structuredClone(window.entries);
          window.calls.push([url, options.method]);
          if (url.endsWith('/understand')) window.entries.points[0].status = 'UNDERSTOOD';
          return {point:first,status:'UNDERSTOOD',topics:[],messages:[]};
        },
        revision: () => 'revision', pages: document.querySelector('#pages'), dock: document.querySelector('#dock'),
        openDock: () => {}, goToPage: () => {}, announce: () => {}, relayout: () => {},
        memoryControl: () => document.createElement('button'), toggleExpanded: () => {},
      });
      return window.ui.refreshEntries();
    });

    const marker = page.locator('.kp-learning-marker').first();
    await marker.locator('summary').click();
    assert.deepEqual(await marker.getByRole('button').allTextContents(), ['这里没完全懂', '我已清楚']);
    await marker.getByRole('button', {name:'我已清楚', exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.kp-learning-marker')?.textContent.includes('已弄懂'));
    assert.deepEqual(await page.evaluate(() => window.calls), [['/api/revisions/revision/learning/first/understand', 'POST']]);
    await marker.locator('summary').click();
    assert.deepEqual(await marker.getByRole('button').allTextContents(), ['这里没完全懂']);

    await page.evaluate(() => {
      window.entries.points[0] = {...window.entries.points[0], status:'NOT_FULLY_CLEAR', thread_id:'thread'};
      return window.ui.refreshEntries();
    });
    await marker.locator('summary').click();
    assert.deepEqual(await marker.getByRole('button').allTextContents(), ['这里没完全懂', '继续 Master 对话']);
    assert.equal(await marker.getByRole('button', {name:'我已清楚'}).count(), 0);
  } finally {
    await browser.close();
  }
});
