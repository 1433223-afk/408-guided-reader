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
// Reset only memberships in the isolated fixture, even after the user starts collecting.
assert.notEqual(path.resolve(dataDir), path.resolve(source));
sql(`import sqlite3,sys
c=sqlite3.connect(sys.argv[1])
if c.execute("select 1 from sqlite_master where type='table' and name='learning_memory'").fetchone():
    c.execute('delete from learning_memory'); c.commit()
c.close()`, [db]);
sql("import sqlite3,sys,datetime; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE reading_positions SET pdf_page_index=52, normalized_offset=0, zoom=1.1, updated_at=? WHERE book_source_revision_id IN (SELECT id FROM book_source_revisions WHERE page_count=348)', (datetime.datetime.now(datetime.timezone.utc).isoformat(),)); c.commit()",[db]);
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
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const json = url => page.evaluate(async url => {const r=await fetch(url); if(!r.ok)throw new Error(await r.text()); return r.json();},url);
  await page.goto(running.url);
  await page.locator('.book-open').first().waitFor();
  const books=(await json('/api/books')).books, book=books.find(b=>b.active_revision?.page_count===348), rev=book.active_revision.id;
  assert.equal(book.active_revision.blob_sha256,'6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd');
  await page.locator('.continue-stats').waitFor();
  await page.screenshot({path:'test-results/four-home.png'});
  await page.locator('#home-continue .primary-action').focus();await page.keyboard.press('Enter');
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  assert.equal(Number(await page.locator('#page-number').inputValue()),book.active_revision.position.pdf_page_index+1);
  await page.locator('#back-to-library').click();
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).getByRole('button',{name:'打开',exact:true}).click();
  await page.locator('.overview-section').first().waitFor();
  await page.screenshot({path:'test-results/four-overview.png'});
  const selected=page.locator('.chapter-row[aria-current="true"]');
  const mapPattern=`**/api/revisions/${rev}/chapters/*/knowledge-map`;
  for(const status of ['NOT_PREPARED','PREPARING','FAILED','READY']) {
    await page.route(mapPattern,async route=>{const response=await route.fetch();const value=await response.json();value.status=status;if(status!=='READY')value.knowledge_points=[];else value.regeneration_state='FAILED';await route.fulfill({json:value});});
    await selected.click();
    const expected={NOT_PREPARED:'本章学习结构尚未准备',PREPARING:'准备中',FAILED:'本章准备失败',READY:'重新生成失败'}[status];
    await page.locator('.overview-map').getByText(expected,{exact:false}).waitFor();
    assert.ok(await page.locator('.overview-book-heading .primary-action').isEnabled());
    if(status!=='READY')assert.equal(await page.locator('.overview-kp').count(),0);
    else assert.ok(await page.locator('.overview-kp').count()>0);
    await page.unroute(mapPattern);
  }
  const sourceEntry=page.locator('.overview-section[open] .overview-kp .source-action').first();
  const sourcePage=Number((await sourceEntry.textContent()).match(/PDF (\d+)/)[1]);
  await sourceEntry.click();
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  assert.ok(await page.locator(`.page[data-index="${sourcePage-1}"] canvas`).isVisible());
  await page.locator('#back-to-library').click();
  await page.locator('#home-continue .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  await page.locator('#page-number').fill('53'); await page.locator('#page-number').press('Enter');
  await page.waitForTimeout(1600);
  await page.screenshot({path:'test-results/four-reader.png'});
  for(const width of [1600,1280,1024]) {
    await page.setViewportSize({width,height:1000});
    await page.locator('#outline-toggle').click(); await page.waitForTimeout(400);
    assert.ok(await page.locator('#viewer').isVisible());
    await page.locator('#outline-close').click();
    await page.locator('#marks-toggle').click(); await page.waitForTimeout(400);
    const bounds=await page.locator('#viewer').boundingBox(), pane=await page.locator('#marks-panel').boundingBox();
    await page.locator('#marks-close').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:1600,height:1000});
  if(await page.locator('#current-guide').isVisible()) {
    await page.locator('#current-guide').click(); await page.waitForTimeout(600);
    assert.ok(await page.locator('#viewer').isVisible());
    await page.screenshot({path:'test-results/four-guide.png'});
    await page.locator('#guide-close').click();
  }
  await page.locator('#back-to-library').click();
  await page.locator('#library-home').waitFor({state:'visible'});
  await page.locator('#library-home .memory-open').click();
  await page.locator('#learning-memory').waitFor({state:'visible'});
  const existing=JSON.parse(sql(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
m=c.execute("select m.id from master_messages m join master_threads t on t.id=m.thread_id where t.book_source_revision_id=? and m.role='assistant' and m.state='COMPLETE' limit 1",(sys.argv[2],)).fetchone()
a=c.execute("select id,pdf_page_index from annotations where book_source_revision_id=? and source_kind='AI_SAVED' limit 1",(sys.argv[2],)).fetchone()
print(json.dumps({'master':m['id'],'annotation':a['id'],'annotation_page':a['pdf_page_index']}))`,[db,rev]));
  await page.locator('#memory-close').click();
  await page.locator('#page-number').fill(String(existing.annotation_page+1)); await page.locator('#page-number').press('Enter');
  await page.locator('#marks-toggle').click();
  const note=page.locator(`.mark-card[data-annotation-id="${existing.annotation}"]`);
  await note.getByRole('button',{name:'收入学习记忆',exact:true}).click();
  await note.getByRole('button',{name:'已收入学习记忆',exact:true}).waitFor();
  await page.locator('#back-to-library').click(); await page.locator('#library-home .memory-open').click();
  await page.evaluate(async ({rev,existing})=>{const r=await fetch(`/api/revisions/${rev}/memory`,{method:'POST',body:JSON.stringify({source_kind:'MASTER',source_id:existing.master})}); if(!r.ok)throw new Error(await r.text());},{rev,existing});
  await page.locator('#memory-filter-toggle').click(); await page.locator('#memory-refresh').click(); await page.locator('#memory-filter-toggle').click();
  await page.locator('.memory-answer').waitFor();
  await page.screenshot({path:'test-results/four-memory.png'});
  for(const width of [1600,1280,1024]) { await page.setViewportSize({width,height:1000}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false); }

  const memberships=(await json('/api/memory')).items;
  const protectedBefore=protectedState();
  for(const item of memberships) {
    await page.locator(`[data-memory-id="${item.id}"]`).getByRole('button',{name:'查看原回答'}).click();
    await page.waitForFunction(id=>document.querySelector(`[data-memory-id="${id}"]`)?.classList.contains('selected'),item.id);
    const original=item.source_kind==='MASTER'?item.source.content:item.source.body;
    await page.locator('#memory-detail .memory-original').last().locator('summary').click();
    assert.equal(await page.locator('#memory-detail pre').last().textContent(),original);
    await page.locator('.memory-detail-header button').click();
    await page.locator('#reader').waitFor({state:'visible'});
    if(item.source_kind==='MASTER') await page.locator(`[data-message-id="${item.source_id}"]`).waitFor({state:'visible'});
    else {
      await page.locator(`.mark-card[data-annotation-id="${item.source_id}"]`).waitFor({state:'visible'});
      assert.equal(Number(await page.locator('#page-number').inputValue()),item.source.pdf_page_index+1);
    }
    await page.locator('#back-to-library').click(); await page.locator('#library-home').waitFor({state:'visible'});
    await page.locator('#library-home .memory-open').click(); await page.locator('.memory-answer').waitFor();
  }
  const removeItem=memberships[0];
  await page.locator(`[data-memory-id="${removeItem.id}"]`).getByRole('button',{name:'查看原回答'}).click();
  await page.locator('#memory-detail').getByRole('button',{name:'移出学习记忆',exact:true}).click();
  await page.locator(`[data-memory-id="${removeItem.id}"]`).waitFor({state:'detached'});
  assert.equal((await json('/api/memory')).items.length,1);
  assert.equal(protectedState(),protectedBefore);
  await stop(); running=await start(); await page.goto(running.url);
  await page.locator('#library-home .memory-open').click(); await page.locator('.memory-answer').waitFor();
  assert.equal((await json('/api/memory')).items.length,1);
  await page.locator('#memory-close').click(); await page.locator('.page canvas').first().waitFor();
  const outline=(await json(`/api/revisions/${rev}/outline`)).nodes;
  const section=outline.find(n=>n.kind==='SECTION' && n.resolution_state==='RESOLVED');
  const go=async (index)=>{await page.locator('#page-number').fill(String(index+1));await page.locator('#page-number').press('Enter');await page.locator(`.page[data-index="${index}"] canvas`).waitFor({timeout:30000});await page.waitForTimeout(500);};
  // Local Guide failure preserves its already-published original, if present.
  const guideIds=JSON.parse(sql("import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('select section_node_id from section_guides where book_source_revision_id=?',(sys.argv[2],))]))",[db,rev]));
  assert.ok(guideIds.length,'real published Guide required');
  const guideSection=outline.find(n=>n.outline_node_id===guideIds[0]);
  await go(guideSection.start_page);
  await page.locator(`.section-guide-entry[data-section-id="${guideIds[0]}"]`).click();
  await page.locator('#guide-content .guide-text').first().waitFor();
  const guideText=await page.locator('#guide-content').textContent();
  await page.locator('#guide-divider').focus();
  const guideWidth=await page.locator('#guide-panel').evaluate(p=>p.clientWidth);
  await page.keyboard.press('ArrowLeft');
  assert.ok(await page.locator('#guide-panel').evaluate(p=>p.clientWidth)>guideWidth);
  await page.locator('#guide-scroll').evaluate(p=>p.scrollTop=150);
  const guideScroll=await page.locator('#guide-scroll').evaluate(p=>p.scrollTop);
  await page.locator('#guide-close').click();
  await page.locator('#guide-reopen').click();
  await page.locator('#guide-content .guide-text').first().waitFor();
  assert.ok(Math.abs(await page.locator('#guide-scroll').evaluate(p=>p.scrollTop)-guideScroll)<3);
  assert.equal(await page.locator('#guide-regenerate').isVisible(),true);
  assert.ok(await page.locator('#guide-panel').isVisible());
  const citation=page.locator('.guide-source:not([disabled])').first(); await citation.click();
  await page.locator('#guide-close').click();
  const guidePath=`**/api/revisions/${rev}/sections/${guideIds[0]}/guide`;
  await page.route(guidePath,async route=>{const r=await route.fetch();const value=await r.json();value.task={state:'FAILED',terminal:false,failure_detail:'受控的网络失败'};await route.fulfill({json:value});});
   await page.locator('#guide-reopen').click();
  await page.waitForFunction(()=>document.querySelector('#guide-status').textContent.includes('失败'));
  assert.equal(await page.locator('#guide-content').textContent(),guideText);
  assert.ok(await page.locator('#viewer').isVisible()); await page.locator('#guide-close').click(); await page.unroute(guidePath);
  // Visiting the actual resolved end records reading only, independently of KP preparation.
  const targets=(await json(`/api/revisions/${rev}/section-reading`)).sections;
  const target=targets.find(t=>!t.reading_reached_end_at && t.pdf_page_index<347);
  assert.ok(target); await go(target.pdf_page_index);
  await page.evaluate(t=>{const v=document.querySelector('#viewer'),p=document.querySelector(`.page[data-index="${t.pdf_page_index}"]`);v.scrollTop=p.offsetTop+p.offsetHeight*t.y-v.clientHeight/2;},target);
  await page.waitForFunction(async ({rev,id})=>{const r=await fetch(`/api/revisions/${rev}/section-reading`);return (await r.json()).sections.some(s=>s.outline_node_id===id && s.reading_reached_end_at);},{rev,id:target.outline_node_id});
  assert.equal(protectedState(),protectedBefore);
  // A genuinely served PDF and saved geometry remain usable with the OCR capability pending.
  const degraded=await browser.newPage({viewport:{width:1280,height:900}});
  degraded.on('pageerror',e=>errors.push(e.message));
  await degraded.route(`**/api/revisions/${rev}/preparation/events`,route=>route.fulfill({contentType:'text/event-stream',body:`event: pages\ndata: ${JSON.stringify({pages:Array.from({length:348},(_,pdf_page_index)=>({pdf_page_index,status:'PENDING'}))})}\n\n`}));
  await degraded.goto(running.url);
  await degraded.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).getByRole('button',{name:'打开',exact:true}).click();
  await degraded.locator('.overview-book-heading .primary-action').click();
  await degraded.locator('#page-number').fill(String(existing.annotation_page+1));await degraded.locator('#page-number').press('Enter');
  await degraded.locator(`.page[data-index="${existing.annotation_page}"] canvas`).waitFor();
  await degraded.locator('#marks-toggle').click();
  await degraded.locator(`.mark-card[data-annotation-id="${existing.annotation}"]`).waitFor();
  assert.equal(await degraded.locator('.ocr-line').count(),0);
  assert.ok(await degraded.locator('#next-page').isEnabled());
  await degraded.locator('#marks-close').click();await degraded.locator('#next-page').click();
  await degraded.close();
  const empty=await browser.newPage();
  await empty.route('**/api/books',route=>route.request().method()==='GET'?route.fulfill({json:{books:[]}}):route.continue());
  await empty.goto(running.url);await empty.locator('#library-empty').waitFor();
  const chooser=empty.waitForEvent('filechooser');
  await empty.locator('#library-empty button').focus();await empty.keyboard.press('Enter');
  await (await chooser).setFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid-pdf')});
  await empty.locator('#import-status').waitFor();
  await empty.unroute('**/api/books');await empty.reload();
  await empty.locator('.book-open').first().waitFor();assert.equal(await empty.locator('.book-open').count(),books.length);
  await empty.close();
  console.log(JSON.stringify({status:'PASS',errors,dataDir,sourceReturns:true,membershipRemoval:true,restart:true,publishedGuideFailure:true,sectionReadingNoMastery:true})); assert.deepEqual(errors,[]);

} finally { if(browser) await browser.close(); await stop(); }
