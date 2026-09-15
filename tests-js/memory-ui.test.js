import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

test('memory collect retry preserves displayed intent after committed response loss', async () => {
  const source = fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function createMemoryUI', 'function createMemoryUI');
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="home-toolbar"></div><div class="reader-controls"></div>');
    await page.addScriptTag({content: fs.readFileSync(new URL('../src/reader_service/static/screens.js', import.meta.url),'utf8').replaceAll('export ', '')});
    await page.addScriptTag({ content: source + '\nwindow.createMemoryUI=createMemoryUI;' });
    const result = await page.evaluate(async () => {
      let stored = null, fail = true; const actions = [];
      const api = async (path, options = {}) => {
        if (!options.method) return { items: stored ? [stored] : [] };
        actions.push(options.method);
        if (options.method === 'POST') {
          stored = { id: 'membership', book_source_revision_id: 'revision', source_kind: 'MASTER', source_id: 'answer' };
          if (fail) { fail = false; throw Error('response lost'); }
          return { item: stored };
        }
        if (options.method === 'DELETE') { stored = null; return {}; }
      };
      const ui = createMemoryUI({ api, announce: () => {}, returnToSource: () => {} });
      const button = ui.control('revision', 'MASTER', 'answer'); document.body.append(button);
      await ui.refresh();
      const click = async () => { button.click(); while (button.disabled && button.textContent !== '已收入学习记忆') await new Promise(resolve => setTimeout(resolve, 0)); };
      await click();
      const afterLost = { label: button.textContent, stored: Boolean(stored) };
      await click();
      const afterRetry = { label: button.textContent, stored: Boolean(stored) };
      await click();
      return { afterLost, afterRetry, actions, afterCollectedClick: Boolean(stored), disabled: button.disabled,
        readerEntries: document.querySelectorAll('.reader-controls .memory-open').length };
    });
    assert.deepEqual(result.afterLost, { label: '收入学习记忆', stored: true });
    assert.deepEqual(result.afterRetry, { label: '已收入学习记忆', stored: true });
    assert.deepEqual(result.actions, ['POST', 'POST']);
    assert.equal(result.afterCollectedClick, true);
    assert.equal(result.disabled, true);
    assert.equal(result.readerEntries, 0);
  } finally { await browser.close(); }
});

test('memory keeps raw Markdown and technical review detail out of the reading view', async () => {
  const source = fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function createMemoryUI', 'function createMemoryUI');
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="home-toolbar"></div><div class="reader-controls"></div>');
    await page.addScriptTag({content: fs.readFileSync(new URL('../src/reader_service/static/screens.js', import.meta.url),'utf8').replaceAll('export ', '')});
    await page.addScriptTag({ content: 'function renderAssistantAnswer(node, body) { node.textContent = body.slice(0, 50000); }\n' + source + '\nwindow.createMemoryUI=createMemoryUI;' });
    await page.evaluate(() => {
      const item = { id: 'membership', book_id: 'book', book_title: '教材', book_source_revision_id: 'revision', source_kind: 'AI_SAVED', source_id: 'answer',
        source: { body: '文'.repeat(50001) + '\n**完整末尾 <script>不可执行</script>**', verification_state: 'FAIL', pdf_page_index: 0, anchor_state: 'OK', quote: '来源', provenance: { answer_question: '原问题' } } };
      window.expectedOriginal = item.source.body;
      createMemoryUI({ api: async path => path === '/api/memory' ? { items: [item] } : { item }, announce: () => {}, returnToSource: () => {} });
    });
    await page.locator('.memory-open').first().click();
    await page.locator('.memory-card-open').click();
    await page.locator('#memory-detail[data-detail-id="membership"]').waitFor();
    const content = await page.locator('#memory-detail .memory-answer').textContent();
    assert.equal(content, '文'.repeat(50000));
    assert.equal(await page.locator('#memory-detail pre').count(), 0);
    assert.equal(await page.locator('#memory-detail script').count(), 0);
    assert.equal((await page.locator('#memory-detail').textContent()).includes('完整末尾'), false);
    assert.match(await page.locator('#memory-detail').textContent(), /内容需要核对/);
  } finally { await browser.close(); }
});

test('switching Memory detail immediately removes stale destructive actions', async () => {
  const source = fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function createMemoryUI', 'function createMemoryUI');
  const browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    const page=await browser.newPage(); await page.setContent('<div class="home-toolbar"></div>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replaceAll('export ','')});
    await page.addScriptTag({content:'function renderAssistantAnswer(n,s){n.textContent=s;}\n'+source+'\nwindow.createMemoryUI=createMemoryUI;'});
    await page.evaluate(()=>{
      const items=['a','b'].map(id=>({id,book_id:'book',book_title:'教材',book_source_revision_id:'revision',source_kind:'MASTER',source_id:id,source:{question:id,content:'原回答 '+id}}));
      window.deletes=[];
      createMemoryUI({announce:()=>{},returnToSource:()=>{},api:async(path,options={})=>{
        if(options.method==='DELETE'){window.deletes.push(path);return {};}
        if(path==='/api/memory')return {items};
        if(path.endsWith('/b'))await new Promise(resolve=>{window.resolveSecond=resolve;});
        return {item:items.find(i=>path.endsWith('/'+i.id))};
      }});
    });
    await page.locator('.memory-open').click();await page.locator('#memory-detail[data-detail-id="a"]').waitFor();
    await page.locator('[data-memory-id="b"] .memory-card-open').click();
    assert.equal(await page.locator('#memory-detail button').count(),0);
    await page.evaluate(()=>window.resolveSecond());await page.locator('#memory-detail[data-detail-id="b"]').waitFor();
    await page.locator('#memory-detail .memory-more > summary').click();
    await page.getByRole('button',{name:'移出学习记忆',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.deletes),['/api/revisions/revision/memory/b']);
  } finally {await browser.close();}
});
