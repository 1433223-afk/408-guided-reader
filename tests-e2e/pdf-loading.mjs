import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {readFile, mkdir, mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:https';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright-core';

// The data must be an isolated restored real fixture, never the user's live library.
const data = process.env.READER_BETA_FIXTURE;
if (!data) throw new Error('READER_BETA_FIXTURE must point to an isolated restored real library');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'reader-beta-ui-'));
const cert = spawnSync('python', ['-c', `
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
root=Path(sys.argv[1]); key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.now(timezone.utc)-timedelta(minutes=1)).not_valid_after(datetime.now(timezone.utc)+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost')]),False).sign(key,hashes.SHA256())
(root/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
(root/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
`, scratch], {windowsHide:true, encoding:'utf8'});
assert.equal(cert.status, 0, cert.stderr);
const child = spawn('python', ['tests-e2e/beta-fixture.py', '--profile','beta','--no-open','--port','0',
  '--data-dir',path.resolve(data),'--credential-dir',path.join(scratch,'credentials'),'--public-origin','https://localhost'],
  {windowsHide:true, env:{...process.env,PYTHONPATH:path.resolve('src'),PYTHONUTF8:'1'}, stdio:['pipe','pipe','pipe']});
let logs = ''; child.stderr.on('data', v => {logs+=v;});
// A fixture-only constructor wrapper prints the ephemeral backend port.
let browser, proxy;
try {
  // Discover the actual listener using a fixture-only stdout wrapper below.
  const port = await new Promise((resolve,reject) => {
    let output=''; const timer=setTimeout(()=>reject(new Error('Beta fixture did not start: '+logs)),30000);
    child.stdout.on('data',chunk=>{output+=chunk; const match=output.match(/FIXTURE_PORT (\d+)/); if(match){clearTimeout(timer);resolve(Number(match[1]));}});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('Fixture exited '+code+': '+logs));});
  });
  proxy = createServer({key:await readFile(path.join(scratch,'key.pem')),cert:await readFile(path.join(scratch,'cert.pem'))},(req,res)=>{
    if(req.headers.authorization!=='Basic '+Buffer.from('fixture:fixture').toString('base64')){
      res.writeHead(401,{'WWW-Authenticate':'Basic realm="fixture"'});res.end();return;
    }
    const headers={...req.headers,host:'localhost','x-forwarded-proto':'https'};
    delete headers.authorization;
    const upstream=http.request({host:'127.0.0.1',port,path:req.url,method:req.method,headers},reply=>{
        res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
      });
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(443,'127.0.0.1',resolve);});
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const context=await browser.newContext({ignoreHTTPSErrors:true,httpCredentials:{username:'fixture',password:'fixture'},viewport:{width:1440,height:1000}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const network=await context.newCDPSession(page);await network.send('Network.enable');
  const pdfIds=new Set();let pdfReceived=0;
  network.on('Network.requestWillBeSent',e=>{if(/\/api\/revisions\/[^/]+\/pdf$/.test(new URL(e.request.url).pathname))pdfIds.add(e.requestId);});
  network.on('Network.dataReceived',e=>{if(pdfIds.has(e.requestId))pdfReceived+=e.dataLength;});
  if(process.env.PDF_PREFETCH_BASELINE==='1') await page.route('**/app.js',async route=>{
    const response=await route.fetch();const body=(await response.text()).replace('...(isBeta ? { disableStream: true, disableAutoFetch: true } : {})','...{}');
    await route.fulfill({response,body});
  });
  await page.goto('https://localhost');
  console.log(JSON.stringify(await page.evaluate(()=>({profile:document.documentElement.dataset.profile}))));

  const samples=[];let ranges=0;let bytes=0;
  page.on('response',async r=>{if(/\/api\/revisions\/[^/]+\/pdf$/.test(new URL(r.url()).pathname)){ranges++; if(r.status()===206)bytes+=Number(r.headers()['content-length']||0);}});
  for(let i=0;i<3;i++){
    const start=Date.now(),initialRanges=ranges,initialBytes=bytes,initialReceived=pdfReceived;
    await page.locator('.book-card .book-open').first().click();
    if(await page.locator('#book-overview').isVisible())await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('.page:not(.loading) canvas').first().waitFor({timeout:30000});
    const openMs=Date.now()-start;
    const firstPaintRanges=ranges-initialRanges;
    await page.waitForTimeout(2000);
    const openRanges=ranges-initialRanges,openRangeBytes=bytes-initialBytes,openReceived=pdfReceived-initialReceived;
    if(i===0){
      await page.locator('#page-number').fill('200');await page.locator('#page-number').press('Enter');
      await page.locator('.page[data-page="200"]:not(.loading) canvas').waitFor({timeout:30000});
      await page.locator('.page[data-page="200"] .text-overlay').waitFor({timeout:30000});
      const line=page.locator('.page[data-page="200"] .ocr-line').filter({hasText:/.{8}/}).first();await line.scrollIntoViewIfNeeded();const box=await line.boundingBox();
      await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height/2,{steps:8});await page.mouse.up();
      await page.locator('.page[data-page="200"] .selection-quad').first().waitFor({state:'visible'});
      assert.ok(await page.evaluate(()=>window.getSelection().toString().length>0));
    }
    await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor({state:'visible'});
    const cleanup=Date.now();while(page.workers().length&&Date.now()-cleanup<5000)await page.waitForTimeout(100);
    assert.equal(page.workers().length,0,'PDF worker leaked after closing');
    samples.push({cycle:i,openMs,firstPaintRanges,openRanges,openRangeBytes,openReceived,workersClosed:page.workers().length});console.log(JSON.stringify(samples.at(-1)));
  }
  // Close while the network response is pending; an aborted old load must not show an error.
  await page.route('**/api/revisions/*/pdf',async route=>{await new Promise(r=>setTimeout(r,1500));await route.continue().catch(()=>{});});
  await page.locator('.book-card .book-open').first().click();
  if(await page.locator('#book-overview').isVisible())await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('#back-to-library').click();await page.locator('#library-home').waitFor({state:'visible'});
  await page.waitForTimeout(2000);assert.equal(page.workers().length,0);
  assert.equal(await page.getByText('无法打开这份 PDF，请重试。',{exact:true}).isVisible(),false);
  assert.deepEqual(errors,[]);
  await (await import('node:fs/promises')).writeFile('test-results/pdf-beta-loading-'+(process.env.PDF_PREFETCH_BASELINE==='1'?'prefetch-baseline':'after')+'.json',JSON.stringify({samples,errors,pendingClose:'PASS',farPageOcrSelection:'PASS'},null,2));
  console.log('BETA_PDF_LOADING_PASS');
} catch(error) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({path:'test-results/pdf-beta-loading-failure.png'});
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve=>proxy?proxy.close(resolve):resolve());
  if(child.exitCode===null){child.stdin.end('\n');await new Promise(resolve=>{const timer=setTimeout(resolve,15000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
