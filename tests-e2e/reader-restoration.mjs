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
  running=await start();
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const errors=[];
  async function open(legacy) {
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    if(legacy) for(const file of ['index.html','app.js','memory-ui.js','guide-ui.js']) {
      const r=spawnSync('git',['show',`92febf6:src/reader_service/static/${file}`],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0);
      await page.route(file==='index.html'?running.url:`**/${file}`,async route=>route.fulfill({response:await route.fetch(),body:r.stdout,contentType:file.endsWith('html')?'text/html':'text/javascript'}));
    }
    await page.goto(running.url);
    const card=page.locator('.book-card').filter({hasText:'348 个 PDF 页面'});
    if(legacy) await card.click(); else {await card.getByRole('button',{name:'打开',exact:true}).click();await page.locator('.overview-book-heading .primary-action').click();}
    await page.locator('.page canvas').first().waitFor();
    await page.locator('#page-number').fill('53');await page.locator('#page-number').press('Enter');
    await page.locator('.page[data-index="52"] canvas').waitFor();await page.waitForTimeout(1200);
    await page.evaluate(()=>{document.querySelector('#viewer').scrollTop=document.querySelector('.page[data-index="52"]').offsetTop;});
    await page.waitForTimeout(350);
    return page;
  }
  const baseline=await open(true), restored=await open(false);
  assert.equal(await restored.locator('#knowledge-toggle,.outline-map-action').count(),0);
  assert.equal(await restored.locator('#assistant-toggle').isVisible(),false);
  assert.ok((await restored.locator('#reader-section-hint').textContent()).includes('2.2'));
  const metrics=p=>p.evaluate(()=>{
    const c=document.querySelector('.page[data-index="52"] canvas'),v=document.querySelector('#viewer'),t=document.querySelector('.toolbar');
    const r=c.getBoundingClientRect();return {canvasWidth:c.width,canvasHeight:c.height,cssWidth:r.width,cssHeight:r.height,left:r.left,top:r.top,viewerWidth:v.clientWidth,toolbarHeight:t.getBoundingClientRect().height};
  });
  assert.deepEqual(await metrics(restored),await metrics(baseline));
  const originalPixels=await baseline.locator('.page[data-index="52"] canvas').evaluate(c=>c.toDataURL());
  const currentPixels=await restored.locator('.page[data-index="52"] canvas').evaluate(c=>c.toDataURL());
  assert.ok(originalPixels === currentPixels,'Original PDF canvas pixels must match baseline');
  await restored.screenshot({path:'test-results/reader-restored.png'});
  const stable=await metrics(restored);
  for(const width of [1600,1280,1024]) {
    await baseline.setViewportSize({width,height:1000});await restored.setViewportSize({width,height:1000});await restored.waitForTimeout(700);
    assert.deepEqual(await metrics(restored),await metrics(baseline));
    for(const [toggle,panel,close] of [['outline-toggle','outline-panel','outline-close'],['search-toggle','search-panel','search-close'],['marks-toggle','marks-panel','marks-close']]) {
      await baseline.locator('#'+toggle).click();await restored.locator('#'+toggle).click();
      assert.deepEqual(await restored.locator('#'+panel).boundingBox(),await baseline.locator('#'+panel).boundingBox());
      await baseline.locator('#'+close).click();await restored.locator('#'+close).click();
    }
    await restored.screenshot({path:`test-results/reader-restored-${width}.png`});
  }
  await restored.setViewportSize({width:1600,height:1000});
  const kp=restored.locator('.page[data-index="52"] .kp-learning-marker').first();
  await kp.locator('summary').click();
  await kp.getByRole('button',{name:'这里没完全懂',exact:true}).first().click();
  await restored.locator('#master-form').waitFor();
  assert.ok(await restored.locator('#master-title').textContent());
  await restored.locator('.dock-tabs').getByRole('button',{name:'收起',exact:true}).click();
  const dialog = new Promise(resolve=>restored.once('dialog',async d=>{assert.equal(d.type(),'prompt');await d.dismiss();resolve();}));
  await restored.locator('#printed-page-edit').click(); await dialog;
  await restored.locator('#search-toggle').click();
  await restored.locator('#search-query').fill('中断向量');
  await restored.locator('#search-form button').click();
  await restored.locator('.search-result').first().click();
  await restored.locator('.search-match-quad').first().waitFor();
  await restored.locator('#search-close').click();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',baseline:'92febf6',canvasPixelsIdentical:true,metrics:stable,responsiveGeometryIdentical:true,errors}));
} finally {if(browser)await browser.close();await stop();}
