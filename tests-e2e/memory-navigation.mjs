import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the real prepared Library');
const root = await mkdtemp(path.join(os.tmpdir(), 'guided-reader-memory-navigation-'));
const dataDir = path.join(root, 'data'); await mkdir(dataDir);
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), { recursive: true });
const sql = (code, args = []) => {
  const result = spawnSync('python', ['-c', code, ...args], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
sql('import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()', [path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')]);
const fixture = JSON.parse(sql(`import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
r=c.execute("""select m.id source_id,t.book_source_revision_id revision,t.knowledge_point_id
from master_messages m join master_threads t on t.id=m.thread_id
join book_source_revisions r on r.id=t.book_source_revision_id join books b on b.id=r.book_id
where m.role='assistant' and m.state='COMPLETE' and m.review_state='PASS'
and t.knowledge_point_id is not null and r.status='ACTIVE' and b.status='ACTIVE' limit 1""").fetchone()
print(json.dumps(dict(r)))`, [path.join(dataDir, 'state.sqlite3')]));

let service, browser;
const stop = async () => {
  if(service && service.exitCode === null) {
    const done = new Promise(resolve => service.once('exit', resolve)); service.kill(); await done;
  }
};
try {
  service = spawn('python', ['-m','reader_service','--no-open','--port','0','--data-dir',dataDir], {
    windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1'},
  });
  const url = await new Promise((resolve,reject) => {
    let output='', errors=''; const timer=setTimeout(()=>reject(new Error(errors || 'startup timeout')),30000);
    service.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/READY (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    service.stderr.on('data',chunk=>{errors+=chunk;}); service.on('exit',()=>{clearTimeout(timer);reject(new Error(errors));});
  });
  browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  const item = await page.evaluate(async fixture => {
    const response = await fetch(`/api/revisions/${fixture.revision}/memory`, {method:'POST',body:JSON.stringify({source_kind:'MASTER',source_id:fixture.source_id})});
    if(!response.ok) throw new Error(await response.text());
    const list = await fetch('/api/memory'); if(!list.ok) throw new Error(await list.text());
    return (await list.json()).items.find(item => item.source_kind === 'MASTER' && item.source_id === fixture.source_id);
  }, fixture);
  await mkdir('test-results',{recursive:true});
  await page.locator('#library-home .memory-open').click();
  const book = page.locator(`.memory-book-open[data-book-id="${item.book_id}"]`);
  await book.waitFor();
  assert.equal(await page.locator('#memory-book,#memory-section,#memory-kp,#memory-refresh').count(),0);
  await page.screenshot({path:'test-results/memory-ia-home.png'});
  await book.click();
  await page.locator(`.memory-section-open[data-section-id="${item.section.id}"]`).click();
  await page.locator(`.memory-kp-group[data-kp-id="${item.knowledge_point.id}"]`).waitFor();
  const memory = page.locator(`.memory-item-open[data-memory-id="${item.id}"]`);
  const typography = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const pick = selector => {
      const computed = style(selector);
      return {fontSize:computed.fontSize,lineHeight:computed.lineHeight,fontWeight:computed.fontWeight,fontFamily:computed.fontFamily};
    };
    return {
      book:pick('.memory-book-heading h1'),
      eyebrow:pick('.memory-book-heading .eyebrow'),
      chapter:pick('.memory-chapter h2'),
      section:pick('.memory-section-open'),
      metadata:pick('.memory-section-open small'),
      kp:pick('.memory-kp-group h2'),
      title:pick('.memory-item-open > strong'),
      summary:pick('.memory-card-summary'),
      groupColor:style('.memory-kp-group h2').color,
      titleColor:style('.memory-item-open > strong').color,
    };
  });
  assert.deepEqual(typography.book.fontSize,'31px'); assert.deepEqual(typography.book.lineHeight,'40px');
  assert.match(typography.book.fontFamily,/Microsoft YaHei UI|Noto Sans CJK SC|Source Han Sans SC/i);
  assert.doesNotMatch(typography.book.fontFamily,/Noto Serif|Songti|SimSun/i);
  assert.deepEqual(typography.eyebrow.fontSize,'11px');
  assert.deepEqual({...typography.chapter,fontFamily:undefined},{fontSize:'14px',lineHeight:'22px',fontWeight:'600',fontFamily:undefined});
  assert.deepEqual({...typography.section,fontFamily:undefined},{fontSize:'14px',lineHeight:'22px',fontWeight:'500',fontFamily:undefined});
  assert.equal(Number.parseFloat(typography.metadata.fontSize) >= 12,true);
  assert.deepEqual({...typography.kp,fontFamily:undefined},{fontSize:'18px',lineHeight:'28px',fontWeight:'600',fontFamily:undefined});
  assert.deepEqual({...typography.title,fontFamily:undefined},{fontSize:'17px',lineHeight:'26px',fontWeight:'600',fontFamily:undefined});
  assert.equal(typography.groupColor,'rgb(63, 87, 73)'); assert.equal(typography.titleColor,'rgb(32, 40, 32)');
  assert.deepEqual(typography.summary.fontSize,'14px'); assert.deepEqual(typography.summary.lineHeight,'23px');
  for(const role of ['chapter','section','kp','title','summary']) assert.doesNotMatch(typography[role].fontFamily,/Noto Serif|Songti|SimSun/i);
  await page.screenshot({path:'test-results/memory-ia-book.png'});
  await memory.click();
  await page.locator(`#memory-detail[data-detail-id="${item.id}"]`).waitFor();
  const detailWidth = await page.locator('.memory-detail-body').evaluate(element => getComputedStyle(element).maxWidth);
  assert.equal(detailWidth,'690px');
  await page.screenshot({path:'test-results/memory-ia-detail.png'});
  await page.getByRole('button',{name:'返回来源',exact:true}).click();
  await page.locator('#learning-memory').waitFor({state:'hidden'});
  await page.locator(`[data-message-id="${fixture.source_id}"]`).waitFor({state:'visible',timeout:30000});
  await page.locator('#back-to-library').click();
  await page.locator('#library-home .memory-open').click();
  await page.locator(`.memory-book-open[data-book-id="${item.book_id}"]`).click();
  await page.locator('#memory-back-books').click();
  await page.locator('#memory-library-view').waitFor({state:'visible'});
  assert.equal(await page.locator(`.memory-book-open[data-book-id="${item.book_id}"]`).isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',path:'Memory → Book → Section/KP → Item → source → Book list',providersDisabled:true}));
} finally {
  if(browser) await browser.close(); await stop();
}
