import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('READER_DATA_DIR must name the prepared real Library');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'reader-kp-front-matter-'));
await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive:true});
const copied = spawnSync('python', ['-c',
  'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
  path.join(source,'state.sqlite3'),path.join(dataDir,'state.sqlite3')], {windowsHide:true,encoding:'utf8'});
assert.equal(copied.status,0,copied.stderr);
const child = spawn('python',['-m','reader_service','--no-open','--port','0','--data-dir',dataDir], {
  windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'},
});
let browser;
try {
  const url = await new Promise((resolve,reject)=>{
    let output='';
    const timeout=setTimeout(()=>reject(new Error('Reader startup timeout')),30000);
    child.stdout.on('data',b=>{output+=b;const m=output.match(/READY (http:\/\/\S+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});
    child.stderr.on('data',()=>{});
    child.on('exit',()=>{clearTimeout(timeout);reject(new Error('Reader exited'));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(url);
  const books=await page.evaluate(async()=> (await (await fetch('/api/books')).json()).books);
  const book=books.find(b=>b.active_revision.page_count===412);
  assert.ok(book,'Need the real 412-page data-structures book');
  const rev=book.active_revision.id;
  const outline=await page.evaluate(async id=>(await fetch(`/api/revisions/${id}/outline`)).json(),rev);
  const toc=outline.nodes.find(n=>n.title.replace(/\s/g,'')==='目录');
  assert.ok(toc);
  await page.locator('.book-card').filter({hasText:'412 个 PDF 页面'}).getByRole('button',{name:/^打开教材 /}).click();
  await page.locator('.overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  async function go(number,visible) {
    await page.locator('#page-number').fill(String(number));
    await page.locator('#page-number').press('Enter');
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#reader-kp-action').isVisible(),visible,`PDF ${number}`);
  }
  await go(2,false);
  await go(toc.start_page+1,false);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/kp-front-matter.png'});
  const chapter1=outline.nodes.find(n=>n.kind==='CHAPTER' && n.title.startsWith('第1章'));
  const chapter4=outline.nodes.find(n=>n.kind==='CHAPTER' && n.title.startsWith('第4章'));
  await go(chapter1.start_page+1,true);
  await page.locator('#reader-kp-action').click();
  await page.locator('#reader-kp-list').waitFor({state:'visible'});
  await page.locator('#reader-kp-list').getByRole('button',{name:'关闭',exact:true}).click();
  await go(chapter4.start_page+1,true);
  await go(toc.start_page+1,false);
  const rejected=await page.evaluate(async ({rev,id})=>{
    const r=await fetch(`/api/revisions/${rev}/chapters/${id}/knowledge-map/prepare`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    return {status:r.status,body:await r.json()};
  },{rev,id:toc.outline_node_id});
  assert.equal(rejected.status,400);
  assert.match(rejected.body.error,/没有正文小节/);
  assert.deepEqual(await page.evaluate(async id=>(await fetch(`/api/revisions/${id}/outline`)).json(),rev),outline);
  console.log(JSON.stringify({status:'PASS',checks:['copyright hidden','TOC hidden','READY list open/close','PARTIAL chapter visible','back to TOC hidden','API rejects without job','Outline unchanged'],externalProviders:'disabled'}));
} finally {
  await browser?.close();
  const exited=new Promise(resolve=>child.once('exit',resolve));
  if(child.exitCode===null){child.kill();await exited;}
}
