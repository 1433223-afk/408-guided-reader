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
        section: {id:'section',title:'2.1 数据表示'}, knowledge_point:{id:'kp',title:'补码'},
        source: { body: '文'.repeat(50001) + '\n**完整末尾 <script>不可执行</script>**', verification_state: 'FAIL', pdf_page_index: 0, anchor_state: 'OK', quote: '来源', provenance: { answer_question: '原问题' } } };
      const other = {...item,id:'other-membership',book_id:'other-book',book_title:'另一教材',book_source_revision_id:'other-revision',
        source_id:'other-answer',source:{...item.source,body:'只属于另一教材的内容',provenance:{answer_question:'另一教材问题'}}};
      window.expectedOriginal = item.source.body;
      createMemoryUI({ api: async path => path === '/api/memory' ? { items: [item, other] }
        : path.endsWith('/outline') ? {nodes:[
          {outline_node_id:'chapter',kind:'CHAPTER',title:'第2章 数据表示',parent_id:null,start_page:0,start_y:0},
          {outline_node_id:'section',kind:'SECTION',title:'2.1 数据表示',parent_id:'chapter',start_page:0,start_y:0},
        ]} : { item }, announce: () => {}, returnToSource: () => {} });
    });
    await page.locator('.memory-open').first().click();
    assert.equal(await page.locator('#memory-book').count(), 0);
    assert.equal(await page.locator('#memory-section').count(), 0);
    assert.equal(await page.locator('#memory-refresh').count(), 0);
    await page.locator('.memory-book-open[data-book-id="book"]').click();
    assert.equal(await page.locator('#memory-search').isHidden(), true);
    assert.equal(await page.locator('.memory-chapter h2').innerText(), '第2章 数据表示');
    assert.equal(await page.locator('.memory-section-open span').innerText(), '2.1 数据表示');
    assert.equal(await page.locator('.memory-section-open small').innerText(), '1');
    assert.equal(await page.locator('.memory-kp-group h2').innerText(), '补码');
    await page.locator('#memory-search-toggle').click();
    await page.locator('#memory-query').fill('只属于另一教材');
    assert.equal(await page.locator('.memory-item-open').count(), 0);
    await page.locator('#memory-query').press('Escape');
    assert.equal(await page.locator('#memory-search').isHidden(), true);
    await page.locator('.memory-item-open').click();
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
      const items=['a','b'].map(id=>({id,book_id:'book',book_title:'教材',book_source_revision_id:'revision',source_kind:'MASTER',source_id:id,
        section:{id:'section',title:'1.1 小节'},knowledge_point:{id:'kp',title:'知识点'},source:{question:id,content:'原回答 '+id}}));
      window.deletes=[];
      createMemoryUI({announce:()=>{},returnToSource:()=>{},api:async(path,options={})=>{
        if(options.method==='DELETE'){window.deletes.push(path);return {};}
        if(path==='/api/memory')return {items};
        if(path.endsWith('/outline'))return {nodes:[
          {outline_node_id:'chapter',kind:'CHAPTER',title:'第1章',parent_id:null,start_page:0,start_y:0},
          {outline_node_id:'section',kind:'SECTION',title:'1.1 小节',parent_id:'chapter',start_page:0,start_y:0},
        ]};
        if(path.endsWith('/b'))await new Promise(resolve=>{window.resolveSecond=resolve;});
        return {item:items.find(i=>path.endsWith('/'+i.id))};
      }});
    });
    await page.locator('.memory-open').click();await page.locator('.memory-book-open').click();
    await page.locator('.memory-item-open[data-memory-id="a"]').click();await page.locator('#memory-detail[data-detail-id="a"]').waitFor();
    await page.locator('.memory-item-open[data-memory-id="b"]').click();
    assert.equal(await page.locator('#memory-detail button').count(),0);
    await page.evaluate(()=>window.resolveSecond());await page.locator('#memory-detail[data-detail-id="b"]').waitFor();
    await page.locator('#memory-detail .memory-more > summary').click();
    await page.getByRole('button',{name:'移出学习记忆',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.deletes),['/api/revisions/revision/memory/b']);
  } finally {await browser.close();}
});

test('section-only records stay subordinate and technical review remains low frequency', async () => {
  const source=fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace('export function createMemoryUI','function createMemoryUI');
  const browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  try {
    const page=await browser.newPage();await page.setContent('<div class="home-toolbar"></div>');
    await page.addStyleTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.css',import.meta.url),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replaceAll('export ','')});
    await page.addScriptTag({content:'function renderAssistantAnswer(n,s){n.textContent=s;}\n'+source+'\nwindow.createMemoryUI=createMemoryUI;'});
    await page.evaluate(()=>{
      const item={id:'technical',book_id:'book',book_title:'教材',book_source_revision_id:'revision',source_kind:'MASTER',source_id:'answer',
        section:{id:'section',title:'1.1 小节'},knowledge_point:null,source:{question:'问题',content:'回答',review_state:'TECHNICAL_FAILURE'}};
      createMemoryUI({announce:()=>{},returnToSource:()=>{},api:async path=>path==='/api/memory'?{items:[item]}
        :path.endsWith('/outline')?{nodes:[
          {outline_node_id:'chapter',kind:'CHAPTER',title:'第1章',parent_id:null,start_page:0,start_y:0},
          {outline_node_id:'section',kind:'SECTION',title:'1.1 小节',parent_id:'chapter',start_page:0,start_y:0},
        ]}:{item}});
    });
    await page.locator('.memory-open').click();await page.locator('.memory-book-open').click();
    assert.equal(await page.locator('.memory-chapter h2').innerText(),'第1章');
    assert.equal(await page.locator('.memory-section-open span').innerText(),'1.1 小节');
    const fallback = page.locator('.memory-unassigned-group');
    assert.equal(await fallback.locator('h2').innerText(),'未归属知识点');
    assert.equal(await fallback.locator('.memory-item-open').count(),1);
    const fallbackStyle = await fallback.evaluate(element => {
      const group = getComputedStyle(element); const heading = getComputedStyle(element.querySelector('h2'));
      return {background:group.backgroundColor,fontSize:heading.fontSize,lineHeight:heading.lineHeight,fontWeight:heading.fontWeight};
    });
    assert.deepEqual(fallbackStyle,{background:'rgba(0, 0, 0, 0)',fontSize:'18px',lineHeight:'28px',fontWeight:'600'});
    assert.equal(await page.getByText('审查暂不可用',{exact:true}).count(),0);
    assert.equal(await page.locator('#memory-items .memory-review-status').count(),0);
    await page.locator('.memory-item-open').click();await page.locator('#memory-detail[data-detail-id="technical"]').waitFor();
    assert.equal(await page.locator('.memory-detail-body .memory-review-status').count(),0);
    assert.equal(await page.locator('.memory-technical-review').isVisible(),false);
    await page.locator('#memory-detail .memory-more > summary').click();
    assert.equal(await page.locator('.memory-technical-review').isVisible(),true);
  } finally {await browser.close();}
});
