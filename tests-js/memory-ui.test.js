import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

test('memory collect retry preserves displayed intent after committed response loss', async () => {
  const source = fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/, '').replace('export function createMemoryUI', 'function createMemoryUI');
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="home-toolbar"></div><div class="reader-controls"></div>');
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
      const click = async () => { button.click(); while (button.disabled) await new Promise(resolve => setTimeout(resolve, 0)); };
      await click();
      const afterLost = { label: button.textContent, stored: Boolean(stored) };
      await click();
      const afterRetry = { label: button.textContent, stored: Boolean(stored) };
      await click();
      return { afterLost, afterRetry, actions, afterExplicitRemove: Boolean(stored) };
    });
    assert.deepEqual(result.afterLost, { label: '收入学习记忆', stored: true });
    assert.deepEqual(result.afterRetry, { label: '移出学习记忆', stored: true });
    assert.deepEqual(result.actions, ['POST', 'POST', 'DELETE']);
    assert.equal(result.afterExplicitRemove, false);
  } finally { await browser.close(); }
});

test('memory exposes the entire durable original beyond the formatted rendering limit', async () => {
  const source = fs.readFileSync(new URL('../src/reader_service/static/memory-ui.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/, '').replace('export function createMemoryUI', 'function createMemoryUI');
  const browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="home-toolbar"></div><div class="reader-controls"></div>');
    await page.addScriptTag({ content: 'function renderAssistantAnswer(node, body) { node.textContent = body.slice(0, 50000); }\n' + source + '\nwindow.createMemoryUI=createMemoryUI;' });
    await page.evaluate(() => {
      const item = { id: 'membership', book_id: 'book', book_title: '教材', book_source_revision_id: 'revision', source_kind: 'AI_SAVED', source_id: 'answer',
        source: { body: '文'.repeat(50001) + '\n**完整末尾 <script>不可执行</script>**', verification_state: 'FAIL', pdf_page_index: 0, anchor_state: 'OK', quote: '来源', provenance: { answer_question: '原问题' } } };
      window.expectedOriginal = item.source.body;
      createMemoryUI({ api: async path => path === '/api/memory' ? { items: [item] } : { item }, announce: () => {}, returnToSource: () => {} });
    });
    await page.locator('.memory-open').first().click();
    await page.getByRole('button', { name: '查看原回答', exact: true }).click();
    await page.getByText('查看完整原文（含 Markdown 标记）', { exact: true }).click();
    const content = await page.locator('#memory-detail pre').textContent();
    assert.equal(content, await page.evaluate(() => window.expectedOriginal));
    assert.equal(await page.locator('#memory-detail script').count(), 0);
    assert.match(await page.locator('#memory-detail').textContent(), /AI 审查未通过/);
  } finally { await browser.close(); }
});
