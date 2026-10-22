// Reuse the full-reader's disposable real-book fixture. No model is available.
// This exercises the actual Reader UI, not a standalone transport demo.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';
import {tabletDiagnosticRoute} from '../src/reader_service/static/tablet-connection.js';

const root=process.cwd(), token=randomBytes(32).toString('hex');
const redact=value=>String(value).replaceAll(token,'[credential]');
const fixtureSource=await readFile('tests-e2e/tablet-full-reader.mjs','utf8');
const python=fixtureSource.match(/const python = String.raw`([\s\S]*?)`;/)?.[1];
assert.ok(python,'The shared full-reader snapshot fixture must be available');
const address=process.env.READER_TEST_LAN||Object.entries(os.networkInterfaces()).flatMap(([name,entries])=>(entries||[]).map(entry=>({name,...entry})))
  .find(entry=>/wlan|wi-?fi/i.test(entry.name)&&entry.family==='IPv4'&&!entry.internal)?.address;
assert.match(address||'',/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
const temporary=await mkdtemp(path.join(os.tmpdir(),'reader-connection-ui-'));
const artifacts=path.resolve('test-results/tablet-reader-connection-recovery');await mkdir(artifacts,{recursive:true});
const core=spawn(process.env.READER_PYTHON||'python',['-u','-c',python],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,PYTHONPATH:path.join(root,'src'),PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1',
    GUIDED_READER_MASTER_PROVIDER:'deepseek',GUIDED_READER_GUIDE_PROVIDER:'deepseek',GUIDED_READER_SYSTEM_PROVIDER:'deepseek',GUIDED_READER_REVIEW_PROVIDER:'zhipu',
    READER_FULL_ROOT:temporary,READER_FULL_LAN:address,READER_FULL_TOKEN:token}});
let output='',stderr='',browser,page,result;
core.stdout.on('data',value=>output+=redact(value));core.stderr.on('data',value=>stderr+=redact(value));
const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Full-reader fixture startup timed out')),90000);
  const check=()=>{const found=output.match(/^FULL_READER (.+)$/m);if(found){clearTimeout(timer);resolve(JSON.parse(found[1]));}};
  core.stdout.on('data',check);core.once('error',error=>{clearTimeout(timer);reject(error);});
  core.once('exit',code=>{clearTimeout(timer);reject(new Error('Fixture exited '+code));});check();
});
try {
  const fixture=await ready;
  browser=await chromium.launch({headless:true,executablePath:process.env.READER_CHROMIUM||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1.5,isMobile:true,hasTouch:true});
  page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[], requests=[], failures=[], mutations=[];
  let phase='boot';
  page.on('pageerror',error=>errors.push(redact(error.message)));
  page.on('request',request=>{
    const url=new URL(request.url());if(!url.pathname.startsWith('/api/'))return;
    const record={phase,method:request.method(),route:tabletDiagnosticRoute(url.pathname),
      page:url.searchParams.get('page'),width:url.searchParams.get('width')};
    requests.push(record);if(!['GET','HEAD'].includes(request.method()))mutations.push(record);
  });
  page.on('requestfailed',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))failures.push({phase,error:request.failure()?.errorText,
    route:tabletDiagnosticRoute(request.url())});});
  await page.goto(`http://${address}:${fixture.port}/?tablet=1&token=${token}`);
  await page.locator('.book-card .book-open').first().tap();
  await page.locator('.overview-book-heading .primary-action').tap();
  const rendered=async index=>page.waitForFunction(index=>{
    const wrapper=document.querySelector(`.page[data-index="${index}"]`),canvas=wrapper?.querySelector('canvas');
    return canvas?.dataset.readerRenderer&&wrapper.querySelector('.ocr-line')&&canvas.dataset.readerPreview!=='true'&&!wrapper.classList.contains('loading');
  },index,{timeout:45000});
  await rendered(19);
  await page.locator('#outline-toggle').tap();await page.locator('#outline-tree .outline-target').first().waitFor({state:'visible'});
  const chapters=await page.locator('#outline-tree li[data-node-id]').evaluateAll(nodes=>nodes.map(node=>({
    id:node.dataset.nodeId,text:node.querySelector(':scope > .outline-row > .outline-target')?.textContent,
    page:node.querySelector(':scope > .outline-row > .outline-target')?.dataset.pageIndex,
  })));
  // Find a real, distant chapter from the stored authoritative outline.
  const nodes=await page.evaluate(async rid=>(await(await fetch(`/api/revisions/${rid}/outline?stored=1`)).json()),fixture.revision_id);
  const outline=nodes.nodes||nodes.outline?.nodes||nodes.outline_nodes||[];
  const far=outline.filter(node=>node.kind==='CHAPTER'&&Number.isInteger(node.start_page)&&node.start_page>100).at(-2);
  assert.ok(far,'A distant real chapter is required');
  await page.locator('#outline-close').tap();
  let injected=0;
  await context.route('**/page-image?*',async route=>{
    const url=new URL(route.request().url());
    if(phase==='single-failure'&&Number(url.searchParams.get('page'))===far.start_page&&injected===0){injected++;await route.abort('internetdisconnected');}
    else await route.continue();
  });
  phase='single-failure';
  await page.locator('#outline-toggle').tap();
  const target=page.locator(`li[data-node-id="${far.outline_node_id}"] > .outline-row > .outline-target`);
  await target.waitFor({state:'visible'});await target.tap();
  await rendered(far.start_page);
  assert.equal(injected,1);assert.equal(requests.filter(request=>request.phase==='single-failure'&&Number(request.page)===far.start_page&&request.route.endsWith('/page-image')).length>=2,true);
  await page.screenshot({path:path.join(artifacts,'read-recovered.png')});

  // With the browser genuinely offline, jump to a fresh page. Resuming Wi-Fi
  // must restore the original page and OCR without reloading the document.
  phase='offline';await context.setOffline(true);
  const offlinePage=120;
  await page.locator('#page-number').fill(String(offlinePage+1));await page.locator('#page-number').press('Enter');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reader-tablet-connection-diagnostics')||'[]').some(event=>event.status==='network'));
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.tablet-connection-notice[data-state="reconnecting"]').isVisible(),true,
    'Late old learning responses must not hide the actual offline notice');
  const pageIdentity=await page.evaluate(()=>performance.timeOrigin);
  phase='online';await context.setOffline(false);
  await rendered(offlinePage);
  assert.equal(await page.locator('.tablet-connection-notice').isHidden(),true);
  assert.equal(await page.evaluate(()=>performance.timeOrigin),pageIdentity,'Recovery must not refresh the window');
  const resumed=await page.locator(`.page[data-index="${offlinePage}"]`).evaluate(node=>({canvas:!!node.querySelector('canvas'),ocr:node.querySelectorAll('.ocr-line').length}));
  assert.ok(resumed.canvas&&resumed.ocr>0);
  await page.screenshot({path:path.join(artifacts,'offline-recovered.png')});
  const checks=await page.evaluate(()=>fetch('/__full-reader_checks').then(response=>response.json()));
  assert.equal(checks.model_calls,0);assert.deepEqual(checks.blocked_requests,[]);
  assert.deepEqual(errors,[]);

  // Controlled 401 simulates a restarted service rejecting an old launch
  // credential. Do not acquire another credential or turn this into a retry loop.
  let denied=0;phase='unauthorized';
  await context.route('**/api/**',async route=>{denied++;await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Missing or invalid launch token'})});});
  await page.locator('#page-number').fill('201');await page.locator('#page-number').press('Enter');
  await page.waitForFunction(()=>document.body.textContent.includes('本次连接页'));
  await page.waitForTimeout(700);const deniedAfterInitial=denied;
  await page.waitForTimeout(1800);
  assert.equal(denied,deniedAfterInitial,'A rejected launch credential must not cause a reconnect/auth loop');
  await page.screenshot({path:path.join(artifacts,'auth-expired.png')});
  const diagnostics=await page.evaluate(()=>JSON.parse(localStorage.getItem('reader-tablet-connection-diagnostics')||'[]'));
  result={passed:true,environment:'Real private LAN HTTP, 348-page textbook snapshot + original OCR and learning; Desktop Chrome touch emulation, not Y900 hardware',
    tests:{single_page_request_failure_recovers:true,offline_jump_recovers_without_refresh:true,ocr_restored:true,old_launch_401_stops_retries:true},
    source:{pages:fixture.page_count},model_calls:checks.model_calls,errors,requests,failures,mutations,diagnostics,outline_chapters_seen:chapters.length};
  console.log(JSON.stringify({passed:true,tests:result.tests,artifacts:'test-results/tablet-reader-connection-recovery'}));
} catch(error) {
  result={passed:false,error:redact(error.stack||error),service_errors:stderr,
    ui:await page?.evaluate(()=>({status:document.getElementById('status')?.textContent,
      current_page:document.getElementById('page-number')?.value,canvases:document.querySelectorAll('.page canvas').length})).catch(()=>null)};
  await page?.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});
  console.error(result.error);process.exitCode=1;
} finally {
  await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2));
  await browser?.close();core.kill();await new Promise(resolve=>core.exitCode!==null?resolve():core.once('exit',resolve));
  const actual=await realpath(temporary),parent=await realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);
  assert.ok(path.basename(actual).startsWith('reader-connection-ui-'));await rm(actual,{recursive:true,force:true});
}
