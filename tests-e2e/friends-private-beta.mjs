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
  await page.goto('https://localhost');
  await page.locator('#beta-key-settings').click();
  await page.locator('#beta-key-input').fill('fixture-invalid-key');
  await page.locator('#beta-key-submit').click();
  await page.getByText('Key 未通过验证或服务暂不可用，原有连接保持不变。',{exact:true}).waitFor();
  assert.equal(await page.locator('#beta-key-input').inputValue(),'');
  const canary='fixture-secret-canary-123';
  await page.locator('#beta-key-input').fill(canary);
  await page.locator('#beta-key-submit').click();
  await page.getByText('已连接 · DeepSeek',{exact:true}).waitFor();
  await page.locator('#beta-key-input').fill('fixture-replacement-key');
  await page.locator('#beta-key-submit').click();
  await page.waitForFunction(()=>document.querySelector('#beta-key-submit').disabled===false);
  assert.equal(await page.locator('#beta-key-input').inputValue(),'');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/beta-key-connected.png'});
  await page.locator('#beta-key-close').click();
  await page.locator('#beta-key-settings').click();
  await page.locator('#beta-key-disconnect').click();
  await page.getByText('尚未连接；不影响阅读教材和已保存内容。',{exact:true}).waitFor();
  await page.locator('#beta-key-close').click();
  const cookie=(await context.cookies()).find(c=>c.name==='__Host-reader_launch');
  assert.ok(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  assert.ok(!storage.includes(canary));
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  if(await page.locator('#book-overview').isVisible()) await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  const allProviders=await page.locator('select[id*="provider"] option').allTextContents();
  assert.ok(allProviders.every(value=>!(/Gemini|Zhipu|智谱|OpenRouter/i.test(value))));
  await page.locator('#page-number').fill('12');await page.locator('#page-number').press('Enter');
  await page.locator('#back-to-library').click();
  await page.locator('#library-home').waitFor({state:'visible'});
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  if(await page.locator('#book-overview').isVisible()) await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout:30000});
  await page.screenshot({path:'test-results/beta-restored-reader.png'});
  assert.deepEqual(errors,[]);
  assert.ok(!logs.includes(canary));
  console.log(JSON.stringify({result:'PASS',scope:'local HTTPS mock proxy, actual Beta UI and restored real PDF; no Caddy/Linux/live provider claim',errors}));
} finally {
  if(browser) await browser.close();
  if(proxy) await new Promise(resolve=>proxy.close(resolve));
  child.stdin.end('\n');
  const code=await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill();resolve('forced');},60000).unref();});
  assert.equal(code,0,'Beta graceful fixture stop failed: '+logs);
}
