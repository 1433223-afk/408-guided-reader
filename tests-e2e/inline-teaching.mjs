import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const root = await mkdtemp(path.join(os.tmpdir(), "guided-reader-inline-"));
const dataDir = path.join(root, "data");
console.log('Disposable inline Library:', dataDir);
await mkdir(dataDir);
await cp(path.join(source, "blobs"), path.join(dataDir, "blobs"), { recursive: true });
// The disposable copy must not resume unrelated live-library work against the test provider.
const backup = spawnSync("python", ["-c", "import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.execute(\"UPDATE jobs SET status='CANCELLED' WHERE status IN ('QUEUED','RUNNING')\"); target.commit(); target.close(); source.close()", path.join(source, "state.sqlite3"), path.join(dataDir, "state.sqlite3")], { windowsHide: true, encoding: "utf8" });
assert.equal(backup.status, 0, backup.stderr);
const baseline = spawnSync('python', ['tests-e2e/inline_verify.py', dataDir, '--baseline'], {windowsHide:true, encoding:'utf8'});
assert.equal(baseline.status,0,baseline.stderr);

let running;
let browser, fail = false;
const live = process.env.GUIDE_E2E_REAL === "1";
const payloads = [];
const provider = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  let payload;
  try { payload = JSON.parse(body.messages[1].content); } catch { payload = null; }
  if (payload) payloads.push(payload);
  if (fail) { res.writeHead(401); res.end('{}'); return; }
  let answer = '所选导读建议先辨认概念，再结合教材比较条件，这是阅读方法而非教材引文。';
  if (payload?.candidate) answer = JSON.stringify({ verdict: 'PASS', issues: [] });
  else if (payload?.source?.evidence) {
    const evidence = payload.source.evidence;
    const offsets = [0, Math.floor(evidence.length*.25), Math.floor(evidence.length*.55), evidence.length-1];
    answer = JSON.stringify({ items: ['lead_in','bridge','warning','recall'].map((kind,i) => ({
      id: `i${i+1}`, kind, target_id: evidence[offsets[i]].source_id,
      source_ids: [evidence[0].source_id], text: '先留意概念成立的条件，再联系本节的具体情境理解。',
      prompt: kind === 'recall' ? '回想刚才的概念：它在什么条件下适用？' : null,
      reference_thought: kind === 'recall' ? '从前面的定义与适用条件出发，核对自己的理解。' : null,
    })) });
  }
  await new Promise(r => setTimeout(r, 200));
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({choices:[{delta:{content:answer}}]})}\n\n`);
    res.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }));
  }
});
await new Promise(r => provider.listen(0, '127.0.0.1', r));
const loopback = {
  GUIDED_READER_SYSTEM_PROVIDER: 'deepseek', GUIDED_READER_REVIEW_PROVIDER: 'zhipu',
  GUIDED_READER_DEEPSEEK_DISABLED: '0', GUIDED_READER_ZHIPU_DISABLED: '0',
  GUIDED_READER_DEEPSEEK_API_KEY: 'test-loopback-key', GUIDED_READER_ZHIPU_API_KEY: 'test-loopback-key',
  GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  GUIDED_READER_ZHIPU_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
};
const geminiOnly = {
  GUIDED_READER_SYSTEM_PROVIDER: 'openrouter', GUIDED_READER_REVIEW_PROVIDER: 'openrouter',
  GUIDED_READER_ASSISTANT_PROVIDER: 'openrouter', GUIDED_READER_OPENROUTER_MODEL: 'google/gemini-3.8-flash',
  GUIDED_READER_INLINE_MODEL: 'google/gemini-3.8-flash',
  GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1',
};
try {
  running = await start(live ? geminiOnly : loopback);
  browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: {width:1440,height:1000} });
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(running.url);
  const books=(await get(page,'/api/books')).books;
  const book=books.find(b=>b.active_revision.page_count===348), rev=book.active_revision.id;
  assert.equal(book.active_revision.blob_sha256,'6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd');
  const nodes=(await get(page,`/api/revisions/${rev}/outline`)).nodes;
  const ready=nodes.find(n=>n.kind==='SECTION' && n.title.includes('1.1'));
  const noKp=nodes.find(n=>n.kind==='SECTION' && n.title.startsWith('6.1'));
  const base=s=>`/api/revisions/${rev}/sections/${s.outline_node_id}/inline-teaching`;
  await openBook(page);
  await navigateSection(page,ready);
  assert.equal(await page.locator('#inline-enabled,#inline-section').count(),0);
  await Promise.all([page.waitForResponse(r => /inline-teaching\/(generate|regenerate)$/.test(r.url()) && r.request().method()==='POST'), page.locator('#inline-open').click()]);
  assert.ok(await page.locator('.page canvas').count());
  let first=await settled(page,base(ready));
  assert.ok(first.published,JSON.stringify(first.task));
  console.log('Published first',first.published.id,'items',first.published.content.items.length);
    for (const item of first.published.content.items) {
      const target=first.published.sources[item.target_id];
      // Navigate with the real page control, then reveal the page-relative marker.
      await page.locator('#page-number').fill(String(target.pdf_page_index+1)); await page.locator('#page-number').press('Enter');
      const marker=page.locator(`.inline-marker[data-item-id="${item.id}"]`).first();
      await marker.waitFor({timeout:30000}); await marker.click();
      await page.locator('.inline-text').first().waitFor();
      await assertCard(page);
      const before=await relativePosition(page);
      await page.locator('#viewer').hover(); await page.mouse.wheel(0,90); await page.waitForTimeout(300);
      const after=await relativePosition(page);
      assert.ok(Math.abs(before.delta-after.delta)<2,'Card detached from source during scroll');
      await page.locator('#inline-close').click(); assert.equal(await page.locator('#inline-panel').count(),0);
      await marker.click(); await assertCard(page);
      await page.getByRole('button',{name:'查看教材位置',exact:true}).click();
      for (const zoom of ['#zoom-out','#zoom-in']) {
        await page.locator(zoom).click(); await page.waitForTimeout(500);
        const match=await page.locator(`.inline-marker[data-item-id="${item.id}"]`).first().evaluate(b=>{
          const p=b.closest('.page').getBoundingClientRect(),r=b.getBoundingClientRect(); return {left:r.left,right:r.right,pageLeft:p.left,pageRight:p.right};
        });
        assert.ok(match.left>=match.pageLeft && match.right<=match.pageRight,'Marker escaped PDF');
        await assertCard(page);
      }
      if(item.kind==='recall') {
        await page.getByRole('button',{name:'查看思路',exact:true}).click();
        await page.locator('.inline-text[data-field="reference_thought"]').waitFor();
        await page.locator('#inline-panel').scrollIntoViewIfNeeded();
        await page.screenshot({path:'test-results/inline-recall.png',fullPage:true});
        await page.getByRole('button',{name:'先跳过',exact:true}).click();
        await marker.click(); assert.equal(await page.locator('.inline-text[data-field="reference_thought"]').count(),0);
      }
    }
    await page.setViewportSize({width:1000,height:850}); await page.waitForTimeout(500);
    await page.locator('#inline-panel').scrollIntoViewIfNeeded();
    if(process.env.READER_COLOR_CAPTURE) await page.screenshot({path:`test-results/reader-colors-${process.env.READER_COLOR_CAPTURE}-inline.png`});
    const panelBounds=await page.locator('#inline-panel').boundingBox();
    assert.ok(panelBounds.x+panelBounds.width<=1001, 'Teaching panel overflows narrow viewport');
    const closeBounds=await page.locator('#inline-close').boundingBox();
    assert.ok(closeBounds.x+closeBounds.width<=1000,'Teaching close control is unreachable');
    await page.getByRole('button',{name:'继续问 Assistant',exact:true}).click();
    await page.locator('#assistant-draft-text').waitFor();
    assert.ok((await page.locator('#assistant-draft-text').innerText()).length>0);
    await page.locator('#assistant-close').click();
    await page.locator('#inline-panel').scrollIntoViewIfNeeded();
    const selectedText=page.locator('.inline-text').first(); const rect=await selectedText.boundingBox();
    await page.mouse.move(rect.x+3,rect.y+12); await page.mouse.down(); await page.mouse.move(rect.x+180,rect.y+12,{steps:12}); await page.mouse.up();
    await page.mouse.click(rect.x+60,rect.y+12,{button:'right'});
    await page.locator('#selection-actions #ask-selection').click();
    const [answerResponse] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/assistant/ask') && r.request().method()==='POST'),page.locator('#assistant-start').click()]);
    const request=answerResponse.request().postDataJSON();
    const bubble=page.locator('.assistant-answer-bubble').first();
    await bubble.waitFor({timeout:30000});
    const target=await bubble.evaluate(node=>({root_id:node.dataset.rootId,node_id:node.dataset.nodeId||null}));
    const assistant=await page.evaluate(async ({request,target}) => (await (await fetch('/api/assistant/focus', {
      method:'POST',headers:{'Content-Type':'application/json','X-Assistant-View':'current'},
      body:JSON.stringify({reader_session_id:request.reader_session_id,...target}),
    })).json()).assistant,{request,target});
    assert.equal(assistant.roots.length,1); assert.equal(assistant.roots[0].created_from.kind,'INLINE_GUIDANCE');
    assert.equal(assistant.roots[0].created_from.teaching_lineage.asset_id,first.published.id);
    await page.locator('.assistant-answer-bubble').first().waitFor({timeout:30000});
    await assertCard(page);
    assert.ok(await page.locator('#inline-panel').isVisible());
    assert.ok(await page.locator('.page canvas').count());
    await page.locator('#inline-panel').scrollIntoViewIfNeeded();
    await mkdir('test-results',{recursive:true}); await page.screenshot({path:'test-results/inline-dock.png',fullPage:true});
    await page.locator('#assistant-close').click();
    await page.screenshot({path:'test-results/inline-narrow.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.waitForTimeout(500); await page.locator('#inline-panel').scrollIntoViewIfNeeded();
    await page.screenshot({path:'test-results/inline-margin.png',fullPage:true});
    await navigateSection(page,ready);
    await page.locator('#inline-open').click(); assert.equal(await page.locator(`.inline-marker[data-section-id="${ready.outline_node_id}"]`).count(),0);
    await page.locator('#inline-open').click(); await page.locator('.inline-marker').first().waitFor();
    await openGuide(page,ready);
    assert.equal(await page.locator('#guide-regenerate').isVisible(), true);
    await page.locator('#guide-close').click();
    await navigateSection(page,ready); await page.locator('#inline-open').click();
    await page.locator('#back-to-library').click();
    await stop(); running=await start({...loopback,GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1'});
    await page.goto(running.url); await openBook(page); await navigateSection(page,ready);
    assert.equal((await get(page,base(ready))).published.id,first.published.id);
    assert.equal(await page.locator('#inline-open').getAttribute('aria-pressed'),'false');
    await page.locator('#inline-open').click();
    await page.locator('#inline-more').click();
    assert.deepEqual(await page.locator('#inline-menu button').allTextContents(),['重新生成']);
    await page.locator('#inline-generate').press('Escape');
    assert.equal(await page.locator('#inline-menu').isVisible(),false);
    await page.locator('#inline-more').press('Enter');
    await page.screenshot({path:'test-results/inline-entry-menu.png'});
    await Promise.all([page.waitForResponse(r=>r.url().endsWith('/inline-teaching/regenerate') && r.request().method()==='POST'),page.locator('#inline-generate').click()]);
    const failed=await settled(page,base(ready)); assert.equal(failed.task.state,'FAILED'); assert.equal(failed.published.id,first.published.id);
    await page.waitForFunction(()=>document.querySelector('#inline-open').textContent.includes('重试'));
    assert.equal(await page.locator('#inline-more').isVisible(),false);
    await stop(); running=await start(loopback); await page.goto(running.url); await openBook(page);
    await navigateSection(page,ready);
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/inline-teaching/retry') && r.request().method()==='POST'), page.locator('#inline-open').click()]); const replacement=await settled(page,base(ready));
    assert.equal(replacement.published.version,2);
    await navigateSection(page,noKp); await Promise.all([page.waitForResponse(r => /inline-teaching\/(generate|regenerate)$/.test(r.url()) && r.request().method()==='POST'), page.locator('#inline-open').click()]);
    const independent=await settled(page,base(noKp)); assert.ok(independent.published,JSON.stringify(independent.task));
    const verified=spawnSync('python',['tests-e2e/inline_verify.py',dataDir,rev],{windowsHide:true,encoding:'utf8'});
    assert.equal(verified.status,0,verified.stdout+verified.stderr);
    await mkdir('test-results',{recursive:true}); await page.screenshot({path:'test-results/inline-teaching.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',pages:348,dataDir,first:first.published.id,replacement:replacement.published.id,payloadCount:payloads.length,live}));
} finally { if(browser) await browser.close(); await stop(); await new Promise(r=>provider.close(r)); }
async function get(page, url) { return page.evaluate(async url => { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }, url); }
async function openBook(page) {
  await page.locator('.book-card').filter({ hasText: '348 个 PDF 页面' }).getByRole('button',{name:'打开',exact:true}).click();
  await page.locator('.overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
}
async function openGuide(page, section) {
  if (!(await page.locator('#outline-panel').isVisible())) await page.locator('#outline-toggle').click();
  const row = page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
  if (!(await row.isVisible())) await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
  await row.locator('.outline-target').click();
  await page.locator('#outline-toggle').click();
  await page.locator(`.section-guide-entry[data-section-id="${section.outline_node_id}"]`).click();
  await page.locator('#guide-title').filter({ hasText: section.title }).waitFor();
}
async function settled(page, url) {
  for (let i = 0; i < 1200; i++) {
    const result = await get(page, url);
    if (['PUBLISHED', 'FAILED'].includes(result.task?.state)) return result;
    await page.waitForTimeout(500);
  }
  throw new Error('Inline Teaching did not settle');
}
async function start(extra) {
  const child = spawn("python", ["tests-e2e/guide_runner.py", "--no-open", "--port", "0", "--data-dir", dataDir], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extra },
  });
  let output = "", errors = "";
  child.stderr.on("data", (v) => { errors += v; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(output + errors)), 30_000);
    child.stdout.on("data", (v) => { output += v; const match = output.match(/READY (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.on("exit", () => { clearTimeout(timeout); reject(new Error(errors || output)); });
  });
  return { child, url };
}
async function stop() {
  if (!running || running.child.exitCode !== null) return;
  const child = running.child;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}


async function assertCard(page) {
  await page.locator('#inline-panel').waitFor();
  const card=await page.locator('#inline-panel').evaluate(e=>{
    const r=e.getBoundingClientRect(),p=e.closest('.page').getBoundingClientRect();
    const hits=[...e.closest('.page').querySelectorAll('.ocr-line,.learning-marker,.section-guide-entry')].filter(n=>{
      const b=n.getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;
    });
    return {width:r.width,left:r.left,right:p.right,hits:hits.length};
  });
  assert.equal(await page.locator('#inline-panel').count(),1);
  assert.ok(card.width>=280&&card.width<=360,'Card width');
  assert.ok(card.left>=card.right,'Card covers PDF');assert.equal(card.hits,0);
  const markers=await page.locator('.inline-marker').evaluateAll(nodes=>nodes.map(e=>{
    const r=e.getBoundingClientRect(),p=e.closest('.page').getBoundingClientRect();
    const hits=[...e.closest('.page').querySelectorAll('.ocr-line,.learning-marker,.section-guide-entry')].filter(n=>{
      const b=n.getBoundingClientRect();return r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top;
    });return {inside:r.left>=p.left&&r.right<=p.right,hits:hits.length};
  }));
  assert.ok(markers.every(m=>m.inside&&m.hits===0),'Marker overlaps text/control');
}
async function relativePosition(page) {
  return page.locator('#inline-panel').evaluate(e=>{
    const r=e.getBoundingClientRect(),m=e.closest('.page').querySelector('.inline-marker[aria-expanded="true"]').getBoundingClientRect();
    return {delta:r.top-m.top};
  });
}

async function toolbarControl(page, selector) {
  if(!await page.locator(selector).isVisible()) await page.locator('.reader-more>summary').click();
  return page.locator(selector);
}

async function navigateSection(page, section) {
  if (!(await page.locator('#outline-panel').isVisible())) await page.locator('#outline-toggle').click();
  const row = page.locator(`li[data-node-id="${section.outline_node_id}"] > .outline-row`);
  if (!(await row.isVisible())) await page.locator(`li[data-node-id="${section.parent_id}"] > .outline-row .outline-disclosure`).click();
  await row.locator('.outline-target').click();
  await page.locator('#outline-toggle').click();
  await page.locator('#viewer').hover();
  const height=await page.locator(`.page[data-index="${section.start_page}"]`).evaluate(e=>e.getBoundingClientRect().height);
  await page.mouse.wheel(0,height*section.start_y+12);
  await page.waitForFunction(id=>document.querySelector('#inline-open').dataset.sectionId===id, section.outline_node_id).catch(async e=>{console.log('Section diagnostic',section,await page.locator('#inline-open').evaluate(b=>({id:b.dataset.sectionId,title:b.title,page:document.querySelector('#page-number').value}))); throw e;});
  await page.waitForFunction(()=>!document.querySelector('#inline-open').title.includes('正在读取'));
}
