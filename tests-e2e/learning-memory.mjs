import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-memory-'));
const dataDir = path.join(root, 'data'); await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), { recursive: true });
const sql = (code, args = []) => {
  const result = spawnSync('python', ['-c', code, ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
sql('import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()', [path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')]);
const db = path.join(dataDir, 'state.sqlite3');
const protectedState = () => sql(`import sqlite3,sys,json,hashlib
c=sqlite3.connect(sys.argv[1])
tables=['master_threads','master_topics','master_messages','kp_status','section_learning_states','learning_events','knowledge_points','chapter_preparations','teaching_assets','section_guides','inline_teaching_assets','section_inline_teaching']
existing={r[0] for r in c.execute("select name from sqlite_master where type='table'")}
print(json.dumps({t:hashlib.sha256(repr(c.execute('select * from '+t+' order by rowid').fetchall()).encode()).hexdigest() for t in tables if t in existing},sort_keys=True))`, [db]);
let running, browser;
const start = async () => {
  const child = spawn('python', ['-m', 'reader_service', '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1' },
  });
  let errors = ''; child.stderr.on('data', v => { errors += v; });
  const url = await new Promise((resolve, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error(errors)), 30000);
    child.stdout.on('data', v => { output += v; const match = output.match(/READY (http:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(errors)); });
  });
  return { child, url };
};
const stop = async () => { if (running && running.child.exitCode === null) { const done = new Promise(resolve => running.child.once('exit', resolve)); running.child.kill(); await done; } };
try {
  running = await start();
  browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const json = async url => page.evaluate(async url => { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }, url);
  await page.goto(running.url);
  const books = (await json('/api/books')).books;
  const book = books.find(b => b.active_revision?.page_count === 348);
  assert.equal(book.active_revision.blob_sha256, '6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd');
  const rev = book.active_revision.id;
  const existing = JSON.parse(sql(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
m=c.execute("select m.id,t.knowledge_point_id,t.section_outline_node_id from master_messages m join master_threads t on t.id=m.thread_id where t.book_source_revision_id=? and m.role='assistant' and m.state='COMPLETE' limit 1",(sys.argv[2],)).fetchone()
a=c.execute("select id,pdf_page_index from annotations where book_source_revision_id=? and source_kind='AI_SAVED' limit 1",(sys.argv[2],)).fetchone()
print(json.dumps({'master':dict(m),'annotation':dict(a)}))`, [db, rev]));
  const scope = existing.master.knowledge_point_id || existing.master.section_outline_node_id;
  const original = await json(`/api/revisions/${rev}/learning/${scope}`);
  const sourceAnswer = original.messages.find(m => m.id === existing.master.id);
  const originalNote = (await json(`/api/revisions/${rev}/annotations?page=${existing.annotation.pdf_page_index}`)).annotations.find(a => a.id === existing.annotation.id);
  assert.ok(originalNote.save_intent_id, 'Assistant fixture already crossed the existing AI_SAVED boundary');
  const before = protectedState();
  const inspection = await json('/api/assistant/inspection');
  assert.deepEqual((await json('/api/memory')).items, []);
  await page.locator('.book-card').filter({ hasText: '348 个 PDF 页面' }).click();
  await page.locator('.page canvas').first().waitFor({ timeout: 30000 });
  const entries = await json(`/api/revisions/${rev}/learning`);
  const point = entries.points.find(p => p.knowledge_point_id === scope);
  assert.ok(point, 'Real saved Master KP fixture required');
  await page.locator('#outline-toggle').click();
  await page.locator(`li[data-node-id="${point.chapter_outline_node_id}"] > .outline-row .outline-map-action`).click();
  const kpRow = page.locator('#knowledge-map li').filter({ has: page.locator('strong', { hasText: point.title }) }).first();
  await kpRow.getByRole('button', { name: '继续 Master 对话', exact: true }).click();
  const masterRow = page.locator(`[data-message-id="${sourceAnswer.id}"]`);
  await masterRow.getByRole('button', { name: '收入学习记忆', exact: true }).click();
  await masterRow.getByRole('button', { name: '移出学习记忆', exact: true }).waitFor();
  await page.locator('.dock-tabs').getByRole('button', { name: '收起', exact: true }).click();
  await page.locator('#page-number').fill(String(existing.annotation.pdf_page_index + 1));
  await page.locator('#page-number').press('Enter');
  await page.locator('#marks-toggle').click();
  const noteCard = page.locator(`.mark-card[data-annotation-id="${originalNote.id}"]`);
  await noteCard.getByRole('button', { name: '收入学习记忆', exact: true }).click();
  await noteCard.getByRole('button', { name: '移出学习记忆', exact: true }).waitFor();
  let items = (await json('/api/memory')).items;
  assert.equal(items.length, 2);
  const masterItem = items.find(i => i.source_kind === 'MASTER');
  const noteItem = items.find(i => i.source_kind === 'AI_SAVED');
  assert.equal(masterItem.source.content, sourceAnswer.content);
  assert.deepEqual(noteItem.source, originalNote);
  assert.equal(noteItem.knowledge_point, null);
  const openMemory = async () => { await page.locator('.memory-open:visible').click(); await page.locator('.memory-card').first().waitFor(); };
  const openDetail = async item => { await page.locator(`[data-memory-id="${item.id}"]`).getByRole('button', { name: '查看原回答' }).click(); await page.locator('#memory-detail').waitFor({ state: 'visible' }); };
  await openMemory();
  await page.locator('#memory-book').selectOption(book.id);
  await page.locator('#memory-section').selectOption(masterItem.section.id);
  assert.ok(await page.locator(`[data-memory-id="${masterItem.id}"]`).isVisible());
  await page.locator('#memory-kp').selectOption(masterItem.knowledge_point.id);
  assert.equal(await page.locator('.memory-card').count(), 1);
  await page.locator('#memory-section').selectOption('');
  await page.locator('#memory-kp').selectOption('');
  await openDetail(masterItem);
  assert.ok((await page.locator('#memory-detail').innerText()).includes('没有精确 PDF'));
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/memory-master.png' });
  await page.getByRole('button', { name: '回到 Master 上下文', exact: true }).click();
  await page.locator('#learning-memory').waitFor({ state: 'hidden' });
  await masterRow.waitFor({ state: 'visible' });
  assert.ok(await masterRow.isVisible());
  await page.waitForFunction(id => document.activeElement?.dataset.messageId === id, sourceAnswer.id);
  await openMemory(); await openDetail(noteItem);
  assert.ok((await page.locator('#memory-detail').innerText()).includes(originalNote.quote));
  await page.screenshot({ path: 'test-results/memory-assistant.png' });
  await page.getByRole('button', { name: '回到笔记 / PDF 来源', exact: true }).click();
  await page.locator('#learning-memory').waitFor({ state: 'hidden' });
  await noteCard.waitFor({ state: 'visible' });
  assert.ok(await noteCard.isVisible());
  assert.equal(Number(await page.locator('#page-number').inputValue()), originalNote.pdf_page_index + 1);
  await page.locator('#back-to-library').click();
  await stop(); running = await start(); await page.goto(running.url);
  await openMemory();
  assert.deepEqual((await json('/api/memory')).items, items);
  await openDetail(masterItem);
  await page.locator('#memory-detail').getByRole('button', { name: '移出学习记忆', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.memory-card').length === 1);
  assert.deepEqual(await json(`/api/revisions/${rev}/learning/${scope}`), original);
  await openDetail(noteItem); await page.getByRole('button', { name: '回到笔记 / PDF 来源', exact: true }).click();
  await page.locator('#learning-memory').waitFor({ state: 'hidden' });
  await noteCard.waitFor({ state: 'visible' });
  await noteCard.getByRole('button', { name: '移出学习记忆', exact: true }).click();
  await noteCard.getByRole('button', { name: '收入学习记忆', exact: true }).waitFor();
  assert.deepEqual((await json(`/api/revisions/${rev}/annotations?page=${originalNote.pdf_page_index}`)).annotations.find(a => a.id === originalNote.id), originalNote);
  await noteCard.getByRole('button', { name: '收入学习记忆', exact: true }).click();
  await noteCard.getByRole('button', { name: '移出学习记忆', exact: true }).waitFor();
  await page.locator('#marks-close').click();
  await page.locator('#outline-toggle').click();
  await page.locator(`li[data-node-id="${point.chapter_outline_node_id}"] > .outline-row .outline-map-action`).click();
  await kpRow.getByRole('button', { name: '继续 Master 对话', exact: true }).click();
  await masterRow.getByRole('button', { name: '收入学习记忆', exact: true }).click();
  await masterRow.getByRole('button', { name: '移出学习记忆', exact: true }).waitFor();
  assert.equal((await json('/api/memory')).items.length, 2);
  assert.equal(protectedState(), before);
  assert.deepEqual(await json('/api/assistant/inspection'), inspection);
  await openMemory(); items = (await json('/api/memory')).items;
  await openDetail(items.find(i => i.source_kind === 'AI_SAVED'));
  await page.getByRole('button', { name: '回到笔记 / PDF 来源', exact: true }).click();
  await page.locator('#learning-memory').waitFor({ state: 'hidden' });
  page.once('dialog', d => d.accept());
  await noteCard.getByRole('button', { name: '删除这条 AI 笔记', exact: true }).click();
  await noteCard.waitFor({ state: 'detached' });
  assert.deepEqual((await json('/api/memory')).items.map(i => i.source_kind), ['MASTER']);
  assert.equal(protectedState(), before);
  const sibling = books.find(b => b.id !== book.id);
  const siblingBefore = sql("import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(repr(c.execute('select * from book_source_revisions where book_id=?',(sys.argv[2],)).fetchall()))", [db, sibling.id]);
  await page.evaluate(async id => { const r = await fetch(`/api/books/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); }, book.id);
  assert.deepEqual((await json('/api/memory')).items, []);
  assert.equal(sql("import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(repr(c.execute('select * from book_source_revisions where book_id=?',(sys.argv[2],)).fetchall()))", [db, sibling.id]), siblingBefore);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'PASS', pages: 348, existingDurableRealAnswers: true, newProviderCalls: 0, restartAIoff: true, sourceReturns: true, removalRecollectionCascades: true, protectedStateUnchanged: true, dataDir }));
} finally { if (browser) await browser.close(); await stop(); }
