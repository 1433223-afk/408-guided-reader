// Real Chromium + an isolated Reader Core on the assigned private LAN address.
// Controlled broken response bodies and browser offline mode do not diagnose a
// previous Y900 incident; they verify recovery without refresh or mutation replay.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const root=process.cwd(), token=randomBytes(32).toString('hex');
const privateAddress=value=>/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const addresses=Object.entries(os.networkInterfaces()).flatMap(([name,values])=>(values||[]).map(value=>({name,...value})))
  .filter(value=>value.family==='IPv4'&&!value.internal&&privateAddress(value.address));
const address=process.env.READER_TEST_LAN||addresses.find(value=>/wlan|wi-?fi/i.test(value.name))?.address||addresses[0]?.address;
assert.ok(privateAddress(address),'An assigned private LAN IPv4 is required');
const temporary=await mkdtemp(path.join(os.tmpdir(),'reader-connection-'));
const artifacts=path.resolve('test-results/tablet-connection-recovery'); await mkdir(artifacts,{recursive:true});
const python=String.raw`
import base64,json,os
from pathlib import Path
from urllib.parse import urlparse
from reader_service.library import LibraryService
from reader_service.storage import ManagedPaths
from reader_service.server import ReaderServer,handler_factory
library=LibraryService(ManagedPaths(Path(os.environ['READER_CONNECTION_ROOT'])))
base=handler_factory(library,os.environ['READER_CONNECTION_TOKEN'],tablet_lan=True)
class Handler(base):
    counts={}
    def do_GET(self):
        route=urlparse(self.path).path
        if route=='/tablet-connection.js':
            if not self._authorized():return
            body=Path('src/reader_service/static/tablet-connection.js').read_bytes()
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        if route in ('/api/test-json-body','/api/test-png-body'):
            if not self._authorized():return
            self.counts[route]=self.counts.get(route,0)+1
            png=route.endswith('png-body')
            body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=') if png else b'{"recovered":true}'
            broken=self.counts[route]==1
            self.send_response(200);self.send_header('Content-Type','image/png' if png else 'application/json');self.send_header('Content-Length',str(len(body)+100 if broken else len(body)));self.end_headers()
            self.wfile.write(body[:3] if broken else body);self.wfile.flush()
            self.close_connection=True
            return
        return super().do_GET()
server=ReaderServer((os.environ['READER_CONNECTION_LAN'],0),Handler)
print('TEST_READY '+str(server.server_port),flush=True)
server.serve_forever()
`;
const server=spawn(process.env.READER_PYTHON||'python',['-u','-c',python],{cwd:root,windowsHide:true,
  env:{...process.env,PYTHONPATH:path.join(root,'src'),PYTHONIOENCODING:'utf-8',READER_CONNECTION_ROOT:temporary,
    READER_CONNECTION_TOKEN:token,READER_CONNECTION_LAN:address},stdio:['ignore','pipe','pipe']});
let browser, context, output='', errors='';
server.stdout.on('data',value=>output+=String(value).replaceAll(token,'[credential]'));
server.stderr.on('data',value=>errors+=String(value).replaceAll(token,'[credential]'));
try {
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Isolated Reader did not start')),15000);
    const check=()=>{const match=output.match(/TEST_READY (\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}
      else if(server.exitCode!==null){clearTimeout(timer);reject(new Error('Isolated Reader exited'));}else setTimeout(check,40);};check();});
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  context=await browser.newContext({viewport:{width:1200,height:800},hasTouch:true});
  const page=await context.newPage();
  await page.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.goto(`http://${address}:${port}/?tablet=1&token=${token}`);
  await page.evaluate(async credential=>{
    const {createTabletConnection}=await import('/tablet-connection.js');
    window.events=[];window.recoveredBooks=0;window.createConnection=createTabletConnection;
    window.connection=createTabletConnection({headers:{'X-Reader-Token':credential},retryDelay:20,recoveryDelays:[50,100],
      onState:event=>window.events.push(event.state),onRecovered:async()=>{if(window.testingOffline){await window.connection.json('/api/books');window.recoveredBooks++;}}});
    await window.connection.json('/api/books');
  },token);
  const body=await page.evaluate(async()=>{
    const json=await window.connection.json('/api/test-json-body');
    const page=await window.connection.page('/api/test-png-body');
    return {json,bytes:(await page.blob()).size};
  });
  assert.equal(body.json.recovered,true); assert.ok(body.bytes>50);
  await page.evaluate(()=>{window.events=[];window.testingOffline=true;});
  await context.setOffline(true);
  const offline=await page.evaluate(async()=>{
    const errors=[];
    for(const [route,options] of [['/api/books',{}],['/api/no-such-mutation',{method:'POST',body:'{}'}]]) {
      try{await window.connection.json(route,options);}catch(error){errors.push(error.code);}
    }
    return {errors,diagnostics:window.connection.diagnostics()};
  });
  assert.equal(offline.errors.length,2);
  const writeEvents=offline.diagnostics.filter(event=>event.method==='POST');
  assert.equal(writeEvents.length,1,'A failed mutation is attempted exactly once');
  await context.setOffline(false);
  await page.waitForFunction(()=>window.recoveredBooks===1&&window.connection.state==='connected');
  const recovered=await page.evaluate(()=>({events:window.events,diagnostics:window.connection.diagnostics(),books:window.recoveredBooks}));
  assert.deepEqual(recovered.events,['reconnecting','connected']);
  assert.equal(recovered.diagnostics.filter(event=>event.method==='POST').length,1);
  assert.ok(recovered.diagnostics.some(event=>event.route==='/api/health'&&event.status===200));
  await context.clearCookies();
  const unauthorized=await page.evaluate(async()=>{
    window.connection.dispose();
    window.invalidConnection=window.createConnection({headers:{'X-Reader-Token':'invalid'},recoveryDelays:[20]});
    try{await window.invalidConnection.json('/api/books');}catch(error){return {status:error.status,message:error.message,state:window.invalidConnection.state};}
  });
  assert.equal(unauthorized.status,401); assert.equal(unauthorized.state,'unauthorized'); assert.match(unauthorized.message,/本次连接页/);
  await page.waitForTimeout(80);
  const invalidEvents=await page.evaluate(()=>{const events=window.invalidConnection.diagnostics();window.invalidConnection.dispose();return events;});
  assert.equal(invalidEvents.at(-1).status,401);
  const result={address,tests:{json_body_recovers:body.json.recovered,png_body_recovers:body.bytes>50,
    offline_recovers_without_refresh:recovered.books===1,mutation_attempts:writeEvents.length,auth_401_requires_launch_page:true},
    events:recovered.events,diagnostics:recovered.diagnostics,model_calls:0,source_library_writes:0};
  assert.equal(JSON.stringify(result).includes(token),false);
  await writeFile(path.join(artifacts,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({ok:true,tests:result.tests,artifacts:'test-results/tablet-connection-recovery/result.json'}));
} catch(error) {
  console.error(String(error.stack||error).replaceAll(token,'[credential]'));
  if(errors) console.error(errors.slice(-1000));
  process.exitCode=1;
} finally {
  await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));
  await rm(temporary,{recursive:true,force:true});
}
