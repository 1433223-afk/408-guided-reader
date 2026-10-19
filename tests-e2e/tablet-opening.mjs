// Real HTTP opening benchmark on a disposable LAN snapshot. No model or OCR
// worker exists. Desktop Chrome + artificial throttling is not Android evidence.
// Run: node tests-e2e/tablet-opening.mjs
// Optional: READER_TEST_LAN, READER_OPENING_SOURCE, READER_OPENING_BOOK,
// READER_CHROMIUM, READER_PYTHON and READER_OPENING_LABEL. Results are ignored
// under test-results/; a label preserves earlier comparison artifacts.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {access, mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const privateAddress = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  (values || []).map(value => ({name, ...value}))).filter(value =>
  value.family === 'IPv4' && !value.internal && privateAddress(value.address));
const address = process.env.READER_TEST_LAN || interfaces.find(value => /wlan|wi-?fi/i.test(value.name))?.address || interfaces[0]?.address;
assert.ok(address && privateAddress(address), 'Set READER_TEST_LAN to an assigned RFC1918 IPv4');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-opening-'));
const outputLabel = process.env.READER_OPENING_LABEL || '';
assert.ok(!outputLabel || /^[A-Za-z0-9_-]+$/.test(outputLabel), 'Output label must contain only letters, digits, hyphens or underscores');
const artifacts = path.resolve('test-results/tablet-opening',outputLabel || '.');
await mkdir(artifacts, {recursive:true});
const token = randomBytes(32).toString('hex');
const redact = value => String(value).replaceAll(token, '[credential]');
const exists = file => access(file).then(() => true, () => false);
const python = String.raw`
import json, os
from pathlib import Path
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.foundation import FoundationRepository, FoundationService, PageLabelRepository, PageLabelService
from reader_service.jobs import JobRepository
from reader_service.library import LibraryService
from reader_service.learning.repository import LearningRepository
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import prepare_demo, list_source_books
source = Path(os.environ.get('READER_OPENING_SOURCE', os.environ.get('READER_PEN_SOURCE', str(Path(os.environ['LOCALAPPDATA']) / '408GuidedReaderAndroidTabletDemo'))))
books = list_source_books(source)
selected = os.environ.get('READER_OPENING_BOOK') or next((b['id'] for b in books if b['page_count'] == 348 and b['byte_size'] > 100_000_000), None)
if not selected:
    raise RuntimeError('An existing 348-page cached-OCR textbook is required')
destination = Path(os.environ['READER_OPENING_ROOT']) / 'snapshot'
prepare_demo(source, destination, [selected])
library = LibraryService(ManagedPaths(destination))
book = library.list_books()[0]
revision = book['active_revision']
assert revision['page_count'] == 348
library.save_position(revision['id'], 19, .2, 1)
with library.database.connect() as c:
    ready = c.execute("SELECT COUNT(*) FROM ocr_pages WHERE book_source_revision_id=? AND status='READY'", (revision['id'],)).fetchone()[0]
assert ready == 348, 'Fixture must already contain all OCR pages'
def no_ocr():
    raise AssertionError('Opening benchmark must not invoke OCR')
foundation = FoundationService(library, FoundationRepository(library.database), no_ocr)
labels = PageLabelService(library, PageLabelRepository(library.database))
outline = OutlineService(library, OutlineRepository(library.database), labels)
outline.bootstrap = outline.stored_snapshot
annotations = AnnotationService(foundation, AnnotationRepository(library.database))
class CachedPreparation:
    def __init__(self):
        self.foundation = foundation
        self.jobs = JobRepository(library.database)
    def schedule_revision(self, *args, **kwargs):
        return None
class CachedLearning:
    repository = LearningRepository(library.database)
    runtime = None
    def status(self):
        return {'answer_provider':'deepseek','review_provider':'zhipu','providers':[]}
    def snapshot(self, revision_id, scope_id):
        return self.repository.snapshot(revision_id, scope_id)
cache = library.paths.temp_root() / 'tablet-pdf-index-v1' / (revision['blob_sha256'] + '.tail')
assert not cache.exists(), 'The disposable fixture must start with no compact-tail cache'
server = ReaderServer((os.environ['READER_OPENING_LAN'], 0), handler_factory(
    library, os.environ['READER_OPENING_TOKEN'], tablet_lan=True,
    preparation=CachedPreparation(), outline=outline, annotations=annotations, learning=CachedLearning()))
print('OPENING_FIXTURE ' + json.dumps({'port':server.server_port, 'revision':revision['id'],
    'pages':revision['page_count'], 'pdf_bytes':revision['byte_size'], 'ocr_ready':ready,
    'cache_path':str(cache)}), flush=True)
server.serve_forever()
`;
const core = spawn(process.env.READER_PYTHON || 'python', ['-u','-c',python], {
  cwd:process.cwd(), windowsHide:true, stdio:['ignore','pipe','pipe'],
  env:{...process.env, PYTHONPATH:path.join(process.cwd(),'src'), PYTHONIOENCODING:'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED:'1', GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1',
    READER_OPENING_ROOT:temporary, READER_OPENING_LAN:address, READER_OPENING_TOKEN:token},
});
let stdout = '', stderr = '', browser, currentPage;
core.stdout.on('data', value => {stdout += value.toString();});
core.stderr.on('data', value => {stderr += value.toString();});
const ready = new Promise((resolve,reject) => {
  const timeout = setTimeout(() => reject(new Error('Temporary opening Core did not start')),60000);
  const check = () => {
    const match = stdout.match(/^OPENING_FIXTURE (.+)$/m);
    if (match) {clearTimeout(timeout); resolve(JSON.parse(match[1]));}
  };
  core.stdout.on('data',check);
  core.once('error',error => {clearTimeout(timeout); reject(error);});
  core.once('exit',code => {clearTimeout(timeout); reject(new Error(`Temporary Core exited (${code}): ${redact(stderr)}`));});
});

async function networkObserver(browser, page) {
  const root = await browser.newBrowserCDPSession(), client = await page.context().newCDPSession(page);
  const rows = new Map(), data = [], workers = new Set(), dedupe = new Set(), workerErrors = [];
  let epochOffset = null, workerEvents = 0;
  const urlFields = value => {
    const url = new URL(value);
    return {path:url.pathname.replace(/\/api\/revisions\/[^/]+/, '/api/revisions/:id'),
      tablet:url.searchParams.get('tablet') === '1'};
  };
  function network(target, method, event) {
    if (method === 'Network.requestWillBeSent') {
      if (epochOffset === null) epochOffset = event.wallTime * 1000 - event.timestamp * 1000;
      const previous = rows.get(event.requestId) || {};
      rows.set(event.requestId, {...previous, ...urlFields(event.request.url), target,
        range:event.request.headers.Range || event.request.headers.range || null,
        started:event.timestamp * 1000 + epochOffset});
    } else if (method === 'Network.responseReceived') {
      const row = rows.get(event.requestId) || {...urlFields(event.response.url)};
      const headers = Object.fromEntries(Object.entries(event.response.headers).map(([key,value]) => [key.toLowerCase(),value]));
      Object.assign(row, {status:event.response.status, responseAt:event.timestamp * 1000 + epochOffset,
        view:headers['x-reader-pdf-view'] || null, serverTiming:headers['server-timing'] || null,
        contentLength:Number(headers['content-length'] || 0), contentRange:headers['content-range'] || null,
        cache:headers['cache-control'] || null, encoding:headers['content-encoding'] || 'identity'});
      rows.set(event.requestId,row);
    } else if (method === 'Network.dataReceived') {
      const key = `${event.requestId}/${event.timestamp}/${event.dataLength}/${event.encodedDataLength}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);
      data.push({id:event.requestId, at:event.timestamp * 1000 + epochOffset,
        decoded:event.dataLength, encoded:event.encodedDataLength});
      const row = rows.get(event.requestId);
      if (row) {
        row.decodedBodyBytes = (row.decodedBodyBytes || 0) + event.dataLength;
        row.encodedChunkBytes = (row.encodedChunkBytes || 0) + event.encodedDataLength;
      }
    } else if (method === 'Network.loadingFinished') {
      const row = rows.get(event.requestId);
      if (row) {
        // Dedicated-worker handoff can report both body+headers and a partial
        // headers-only finished event for the same request. Keep both rather
        // than overwriting the full observation with that last partial value.
        row.encodedFinishedObservations ||= [];
        if (!row.encodedFinishedObservations.includes(event.encodedDataLength))
          row.encodedFinishedObservations.push(event.encodedDataLength);
        row.encodedFinished = Math.max(row.encodedFinished || 0,event.encodedDataLength);
      }
    }
  }
  root.on('Target.targetCreated',async ({targetInfo}) => {
    if (targetInfo.type !== 'worker') return;
    try {
      const {sessionId} = await root.send('Target.attachToTarget',{targetId:targetInfo.targetId,flatten:false});
      workers.add(sessionId);
      await root.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Network.enable'})});
    } catch (error) {workerErrors.push(redact(error.message));}
  });
  root.on('Target.receivedMessageFromTarget',event => {
    if (!workers.has(event.sessionId)) return;
    const message = JSON.parse(event.message);
    if (message.method?.startsWith('Network.')) {workerEvents += 1; network('worker',message.method,message.params);}
  });
  await root.send('Target.setDiscoverTargets',{discover:true});
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions',{offline:false,latency:50,
    downloadThroughput:4*1024*1024,uploadThroughput:2*1024*1024,connectionType:'wifi'});
  for (const method of ['requestWillBeSent','responseReceived','dataReceived','loadingFinished'])
    client.on(`Network.${method}`,event => network('page',`Network.${method}`,event));
  return {
    snapshot(at = Infinity) {
      const pdf = [...rows.entries()].filter(([,row]) => row.path?.endsWith('/pdf') && (row.started || row.responseAt) <= at);
      const ids = new Set(pdf.map(([id]) => id));
      const bytes = data.filter(event => ids.has(event.id) && event.at <= at);
      return {pdf_requests:pdf.length, pdf_ranges:pdf.filter(([,row]) => row.range).length,
        pdf_body_bytes:bytes.reduce((sum,event) => sum + event.decoded,0),
        pdf_encoded_chunk_bytes:bytes.reduce((sum,event) => sum + event.encoded,0),
        full_stream_bytes:bytes.filter(event => !rows.get(event.id)?.range).reduce((sum,event) => sum + event.decoded,0)};
    },
    details:() => ({requests:[...rows.values()],worker_network_events:workerEvents,worker_errors:workerErrors}),
  };
}

const results = [];
let report;
try {
  const fixture = await ready;
  const base = `http://${address}:${fixture.port}`;
  for (let round = 1; round <= 2; round += 1) for (const mode of ['baseline','candidate']) {
    const name = `${round}-${mode}`, folder = path.join(artifacts,name);
    await mkdir(folder,{recursive:true});
    // Only the disposable snapshot is reset; the source library is never served.
    const reset = await fetch(`${base}/api/revisions/${fixture.revision}/position`,{method:'PUT',
      headers:{'X-Reader-Token':token,'Content-Type':'application/json'},
      body:JSON.stringify({pdf_page_index:19,normalized_offset:.2,zoom:1})});
    assert.equal(reset.status,200);
    const cacheBefore = await exists(fixture.cache_path);
    if (round === 1) assert.equal(cacheBefore,false,'Baseline must not prebuild the candidate index');
    browser = await chromium.launch({headless:true,executablePath:process.env.READER_CHROMIUM ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe'});
    const context = await browser.newContext({viewport:{width:1200,height:800},screen:{width:1200,height:800},
      deviceScaleFactor:1.5,isMobile:true,hasTouch:true});
    let rewrites = 0;
    // Both modes have the same route/cache conditions. Continue is real HTTP:
    // no PDF bytes are fabricated or fulfilled by the browser test harness.
    await context.route(/\/api\/revisions\/[^/]+\/pdf(?:\?.*)?$/,route => {
      const url = new URL(route.request().url());
      if (mode === 'baseline') {url.searchParams.delete('tablet'); rewrites += 1;}
      return route.continue({url:url.toString()});
    });
    await context.addInitScript(() => {
      const metric = window.__openingMetrics = {start:null,paint:null,text:null};
      const visible = node => {
        const view = document.getElementById('viewer')?.getBoundingClientRect(), box = node?.getBoundingClientRect();
        return view && box && box.width > 0 && box.height > 0 && box.bottom > view.top && box.top < view.bottom;
      };
      let scheduled = false;
      const measure = () => {
        scheduled = false;
        if (metric.start === null) return;
        const page = document.querySelector('.page[data-index="19"]');
        if (!page || page.classList.contains('loading') || !visible(page.querySelector('canvas'))) return;
        const now = performance.timeOrigin + performance.now();
        metric.paint ??= now;
        if ([...page.querySelectorAll('.text-overlay .ocr-line')].some(line => line.textContent.trim().length > 1 && visible(line)))
          metric.text ??= now;
      };
      const schedule = () => {if (!scheduled) {scheduled = true; requestAnimationFrame(measure);}};
      document.addEventListener('click',event => {
        if (event.target.closest('.book-card .book-open') && metric.start === null)
          metric.start = performance.timeOrigin + performance.now();
        schedule();
      },true);
      new MutationObserver(schedule).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','style']});
      window.addEventListener('resize',schedule);
    });
    const page = currentPage = await context.newPage(), errors = [], modelRequests = [];
    page.on('pageerror',error => errors.push(redact(error.message)));
    page.on('request',request => {
      if (request.method() === 'POST' && /\/api\/assistant\//.test(request.url())) modelRequests.push(new URL(request.url()).pathname);
    });
    const network = await networkObserver(browser,page);
    const navigationStart = performance.now();
    await page.goto(`${base}/?tablet=1&token=${token}`,{waitUntil:'domcontentloaded'});
    await page.locator('.book-card .book-open').waitFor();
    const libraryMs = Math.round(performance.now() - navigationStart);
    await page.locator('.book-card .book-open').tap();
    await page.locator('.overview-book-heading .primary-action').tap();
    await page.waitForFunction(() => window.__openingMetrics?.text !== null,{}, {timeout:90000});
    const metric = await page.evaluate(() => window.__openingMetrics);
    assert.ok(metric.start && metric.paint && metric.text);
    const pageNumber = await page.locator('#page-number').inputValue();
    assert.equal(pageNumber,'20','Every run restores the same page-20 anchor');
    await page.waitForTimeout(150); // Drain CDP callbacks, but use the recorded browser timestamps as byte cutoffs.
    const cacheAfter = await exists(fixture.cache_path), details = network.details();
    const pdfResponses = details.requests.filter(row => row.path?.endsWith('/pdf') && row.status);
    if (mode === 'candidate') {
      assert.ok(pdfResponses.some(row => row.tablet),'Candidate must request the real tablet URL');
      assert.ok(pdfResponses.length > 0 && pdfResponses.every(row => row.view === 'compact'),
        'Every candidate PDF response must use the compact tail, not source fallback');
      assert.equal(cacheAfter,true,'Successful candidate persists its disposable index cache');
    } else {
      assert.ok(rewrites > 0,'Baseline must rewrite only the request URL to the original PDF');
      assert.ok(pdfResponses.every(row => row.view !== 'compact'),'Baseline must stay on source PDF');
    }
    assert.deepEqual(errors,[]); assert.deepEqual(modelRequests,[]);
    const worker = details.requests.filter(row => row.path === '/vendor/pdf.worker.mjs');
    assert.ok(worker.some(row => row.status === 200 && row.contentLength > 0),'Capture real worker HTTP response');
    assert.ok(details.worker_network_events > 0,'Worker Network target must be observed');
    const result = {round,mode,browser:await browser.version(),library_ms:libraryMs,
      visible_paint_ms:Math.round(metric.paint - metric.start),visible_text_ms:Math.round(metric.text - metric.start),
      at_paint:network.snapshot(metric.paint),at_text:network.snapshot(metric.text),cache_before:cacheBefore,cache_after:cacheAfter,
      cold_candidate_generation:mode === 'candidate' && !cacheBefore,
      first_pdf_server_timing:pdfResponses[0]?.serverTiming || null, worker,
      worker_network_events:details.worker_network_events,worker_errors:details.worker_errors,
      pdf_response_views:[...new Set(pdfResponses.map(row => row.view))]};
    results.push(result);
    await writeFile(path.join(folder,'network.json'),JSON.stringify(details,null,2) + '\n');
    await writeFile(path.join(folder,'result.json'),JSON.stringify(result,null,2) + '\n');
    await page.screenshot({path:path.join(folder,'ready.png')});
    console.log(JSON.stringify({opening_run:result}));
    await browser.close(); browser = null; currentPage = null;
  }
  const comparisons = [1,2].map(round => {
    const baseline = results.find(result => result.round === round && result.mode === 'baseline');
    const candidate = results.find(result => result.round === round && result.mode === 'candidate');
    return {round,paint_improvement:1 - candidate.visible_paint_ms / baseline.visible_paint_ms,
      text_improvement:1 - candidate.visible_text_ms / baseline.visible_text_ms};
  });
  const targets = {expected_candidate_ms:2000,expected_improvement:.6,
    observed_candidate_paint_under_target:results.filter(result => result.mode === 'candidate').every(result => result.visible_paint_ms < 2000),
    observed_candidate_text_under_target:results.filter(result => result.mode === 'candidate').every(result => result.visible_text_ms < 2000),
    observed_paint_improvement_over_target:comparisons.every(result => result.paint_improvement > .6),
    observed_text_improvement_over_target:comparisons.every(result => result.text_improvement > .6)};
  report = {functional_result:'PASS',git_head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    environment:{browser:'fresh headless Chrome process per run',viewport:{width:1200,height:800,dpr:1.5},
      network:'actual same-PC LAN HTTP; CDP artificial 4MiB/s download, 2MiB/s upload, 50ms latency; not Android/RF evidence',
      fixture:{pages:fixture.pages,pdf_bytes:fixture.pdf_bytes,ocr_ready:fixture.ocr_ready,page:20,offset:.2,zoom:1},
      baseline:'Current Tablet flags and asset gzip/ETag policy, but real original PDF URL via route.continue; not the earlier uncompressed/default-options benchmark',
      candidate:'Current Tablet URL + real server compact tail; candidate round 1 includes initial index generation',
      cache:'Cold Chrome profile each run; same temporary Core across runs; first candidate index absent before request',
      metric:'Click book -> visible page-20 render complete and actual visible OCR line; bytes cut off by browser metric timestamps',
      bytes:'CDP dataReceived decoded PDF body bytes, including repeated ranges; PDF identity encoding. Compressed asset Content-Length, encodedChunkBytes and all loadingFinished observations are reported separately; partial worker handoff counters are not complete link traffic.',
      models:0,new_ocr:0},results,comparisons,targets};
  assert.equal(stderr.includes('Traceback'),false,'Temporary Core must not traceback');
} catch (error) {
  await currentPage?.screenshot({path:path.join(artifacts,'failure.png')}).catch(() => {});
  report = {functional_result:'FAIL',error:redact(error.stack || error),results};
  process.exitCode = 1;
} finally {
  await browser?.close();
  core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) resolve(); else core.once('exit',resolve);});
  await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(report,null,2) + '\n');
  await writeFile(path.join(artifacts,'core-stdout.log'),redact(stdout));
  await writeFile(path.join(artifacts,'core-stderr.log'),redact(stderr));
  const resolved = await realpath(temporary), tempRoot = await realpath(os.tmpdir());
  assert.equal(path.dirname(resolved),tempRoot,'Recursive cleanup is limited to this generated temporary directory');
  await rm(resolved,{recursive:true,force:true});
}
console.log(JSON.stringify({opening_summary:report,artifacts}));
