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
          if (url === '/api/learning/status') return {providers:[]};
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

test('Tablet preserves open KP controls through unrelated refreshes and updates changed learning data', async () => {
  const browser = await chromium.launch({
    executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  try {
    const page = await browser.newPage({viewport:{width:1180,height:800},hasTouch:true});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fixture = `<!doctype html><style>
      body { margin:0; }
      .viewer { width:900px; height:760px; overflow:auto; }
      .page { position:relative; width:800px; height:900px; }
      .learning-marker { position:absolute; right:8px; }
      summary { min-width:64px; min-height:48px; }
      .learning-marker-content { width:280px; max-height:500px; background:white; }
      .learning-footer { position:absolute; top:100%; width:100%; }
      .learning-scope-marker summary { display:block; min-height:52px; }
      #dock { display:none; }
    </style><section class="reader"><aside id="dock"></aside>
      <div class="viewer"><div id="pages"><div class="page" data-index="0"><canvas></canvas></div></div></div>
    </section>`;
    await page.route('http://127.0.0.1/master-marker-test', route => route.fulfill({contentType:'text/html',body:fixture}));
    const modules = {
      '/master-ui.js':'../src/reader_service/static/master-ui.js',
      '/id.js':'../src/reader_service/static/id.js',
      '/screens.js':'../src/reader_service/static/screens.js',
      '/assistant-render.js':'../src/reader_service/static/assistant-render.js',
      '/vendor/marked.esm.js':'../node_modules/marked/lib/marked.esm.js',
      '/vendor/purify.es.mjs':'../node_modules/dompurify/dist/purify.es.mjs',
      '/vendor/katex.mjs':'../node_modules/katex/dist/katex.mjs',
    };
    for (const [path, file] of Object.entries(modules)) {
      const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
      await page.route(`http://127.0.0.1${path}`, route => route.fulfill({contentType:'text/javascript',body:source}));
    }
    await page.goto('http://127.0.0.1/master-marker-test');
    await page.addScriptTag({type:'module',content:"import {createMasterUI} from '/master-ui.js'; window.createMasterUI=createMasterUI;"});
    await page.waitForFunction(() => typeof window.createMasterUI === 'function');
    await page.evaluate(async () => {
      window.entries = {
        points:[{knowledge_point_id:'kp',scope_id:'kp',scope_kind:'KP',title:'教材知识点',status:'UNCONFIRMED',thread_id:null,display_end_page:0,display_end_y:.4}],
        sections:[{outline_node_id:'subsection',title:'1.1.1 教材小节',kind:'SUBSECTION',end_page:0,end_y:.7,knowledge_point_ids:['kp']},
          {outline_node_id:'section',title:'1.1 教材节',kind:'SECTION',status:'AVAILABLE',thread_id:null,end_page:0,end_y:.8,knowledge_point_ids:['kp']}],
        topics:[],
      };
      window.calls = [];
      window.ui = createMasterUI({
        tablet:true,
        api:async (url, options) => {
          if (url.endsWith('/learning')) return structuredClone(window.entries);
          if (url === '/api/learning/status') return {providers:[]};
          window.calls.push([url, options?.method]);
          if (url.endsWith('/confirm-section')) return {changed:0,unclear:0};
          if (url.endsWith('/check-section') || url.endsWith('/open')) return {point:{...window.entries.sections[1],scope_id:'section',scope_kind:'SECTION'},status:'AVAILABLE',topics:[],messages:[]};
          throw new Error(`Unexpected API request: ${url}`);
        },
        revision:() => 'revision', pages:document.querySelector('#pages'), dock:document.querySelector('#dock'),
        openDock:() => {}, goToPage:() => {}, announce:() => {},
        memoryControl:() => document.createElement('button'), toggleExpanded:() => {},
      });
      await window.ui.refreshEntries();
    });
    const marker = page.locator('.kp-learning-marker');
    await marker.locator('summary').tap();
    await page.waitForFunction(() => document.querySelector('.kp-learning-marker').open);
    await page.evaluate(() => {
      window.savedMarker = document.querySelector('.kp-learning-marker');
      window.savedButton = window.savedMarker.querySelector('button');
      window.savedFooter = document.querySelector('.learning-footer');
      window.savedScope = document.querySelector('.learning-scope-marker');
    });

    // Reproduce a PDF repaint followed by an async fetch of identical data.
    await page.evaluate(async () => { window.ui.renderPage(0); await window.ui.refreshEntries(); });
    assert.deepEqual(await page.evaluate(() => ({
      sameMarker:document.querySelector('.kp-learning-marker') === window.savedMarker,
      sameButton:document.querySelector('.kp-learning-marker button') === window.savedButton,
      sameFooter:document.querySelector('.learning-footer') === window.savedFooter,
      sameScope:document.querySelector('.learning-scope-marker') === window.savedScope,
      connected:window.savedMarker.isConnected && window.savedButton.isConnected,
      open:window.savedMarker.open,
    })), {sameMarker:true,sameButton:true,sameFooter:true,sameScope:true,connected:true,open:true});

    // A real state change must update both the KP and its section totals.
    await page.evaluate(async () => {
      window.entries.points[0].status = 'UNDERSTOOD';
      await window.ui.refreshEntries();
    });
    assert.equal(await page.evaluate(() => window.savedMarker.isConnected), false);
    await marker.locator('summary').tap();
    assert.match(await marker.locator('.learning-marker-content > p').textContent(), /已弄懂/);
    assert.equal(await marker.getByRole('button', {name:'我已清楚',exact:true}).count(), 0);
    assert.match(await page.locator('.learning-scope-marker .learning-batch-stats').first().textContent(), /已确认 1 个/);
    assert.equal(await marker.locator('.learning-footer, .learning-scope-marker').count(), 0);

    // Adding a saved conversation must expose the current continuation action.
    await page.evaluate(async () => {
      window.savedMarker = document.querySelector('.kp-learning-marker');
      window.entries.points[0].thread_id = 'saved-thread';
      await window.ui.refreshEntries();
    });
    assert.equal(await page.evaluate(() => window.savedMarker.isConnected), false);
    await marker.locator('summary').tap();
    assert.equal(await marker.getByRole('button', {name:'继续 Master 对话',exact:true}).count(), 1);

    // A corrected textbook anchor must move the control instead of reusing it.
    const oldTop = await marker.evaluate(node => parseFloat(node.style.top));
    await page.evaluate(async () => {
      window.savedMarker = document.querySelector('.kp-learning-marker');
      window.entries.points[0].display_end_y = .65;
      await window.ui.refreshEntries();
    });
    assert.equal(await page.evaluate(() => window.savedMarker.isConnected), false);
    assert.equal(await marker.getAttribute('data-source-y'), '0.65');
    assert.ok(await marker.evaluate(node => parseFloat(node.style.top)) > oldTop);
    // Scope actions are visually and semantically separate from a single KP.
    const scopes = page.locator('.learning-scope-marker');
    assert.deepEqual(await scopes.locator('.learning-scope-kind').allTextContents(), ['小节确认', '本节确认']);
    assert.equal(await scopes.locator('.learning-scope-title').first().textContent(), '1.1.1 教材小节');
    const smallScope = page.locator('.learning-scope-marker[data-outline-node-id="subsection"]');
    await smallScope.locator('summary').tap();
    await page.waitForFunction(() => document.querySelector('.learning-scope-marker[data-outline-node-id="subsection"]').open);
    await page.evaluate(async () => {
      window.savedScope = document.querySelector('.learning-scope-marker[data-outline-node-id="subsection"]');
      window.ui.renderPage(0); await window.ui.refreshEntries();
    });
    assert.equal(await smallScope.evaluate(node => node === window.savedScope && node.open), true);
    const popupInside = await smallScope.locator('.learning-marker-content').evaluate(node => {
      const box=node.getBoundingClientRect(),view=document.querySelector('.viewer').getBoundingClientRect();
      return box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom;
    });
    assert.equal(popupInside, true);
    await smallScope.getByRole('button', {name:'确认本小节',exact:true}).tap();
    await page.waitForFunction(() => window.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.calls), [['/api/revisions/revision/learning/subsection/confirm-section', 'POST']]);
    const wholeScope = page.locator('.learning-scope-marker[data-outline-node-id="section"]');
    assert.equal(await wholeScope.getByRole('button', {name:'确认本小节',exact:true}).count(), 0);
    await wholeScope.locator('summary').tap();
    await page.waitForFunction(() => document.querySelector('.learning-scope-marker[data-outline-node-id="section"]').open);
    assert.equal(await smallScope.evaluate(node => node.open), false);
    await wholeScope.getByRole('button', {name:'都清楚了',exact:true}).tap();
    await page.waitForFunction(() => window.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.calls[1]), ['/api/revisions/revision/learning/section/check-section', 'POST']);
    await wholeScope.getByRole('button', {name:'还有些地方不完全清楚',exact:true}).tap();
    await page.waitForFunction(() => window.calls.length === 3);
    assert.equal(await wholeScope.evaluate(node => node.open), false, 'Opening Master closes the scope popover');
    assert.deepEqual(await page.evaluate(() => window.calls[2]), ['/api/revisions/revision/learning/section/open', 'POST']);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
