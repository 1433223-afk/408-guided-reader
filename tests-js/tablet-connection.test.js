import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as sleep} from 'node:timers/promises';
import {createTabletConnection, tabletDiagnosticRoute} from '../src/reader_service/static/tablet-connection.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function create(t, options = {}) {
  const connection = createTabletConnection({storage:null, window:null, retryDelay:0, recoveryDelays:[10000], ...options});
  t.after(() => connection.dispose());
  return connection;
}

test('local Core remains connected in airplane mode and can recover without internet', async t => {
  const surface = new EventTarget();
  surface.navigator = {onLine:false};
  const states = [];
  let available = true;
  const connection = create(t, {local:true, window:surface, recoveryDelays:[5],
    onState:event => states.push(event.state), fetch:async () => {
      if (!available) throw new TypeError('local Core restarting');
      return json({books:[]});
    }});
  surface.dispatchEvent(new Event('offline'));
  assert.equal(connection.state, 'connected');
  assert.deepEqual(await connection.json('/api/books'), {books:[]});
  available = false;
  await assert.rejects(connection.json('/api/books'), /本机 Reader/);
  available = true;
  await sleep(35);
  assert.equal(connection.state, 'connected');
  assert.deepEqual(states, ['reconnecting', 'connected']);
});

test('local authentication error directs the user to the app rather than a computer', async t => {
  const connection = create(t, {local:true, fetch:async () => json({error:'private detail'},401)});
  await assert.rejects(connection.json('/api/books'), error => error.status === 401
    && /应用菜单/.test(error.message) && !/电脑/.test(error.message));
});

test('read recovers once, preserving auth, without replaying a mutation', async t => {
  const calls = [], states = [];
  const connection = create(t, {headers:{'X-Reader-Token':'private'}, onState: event => states.push(event.state),
    fetch: async (path, options) => {calls.push({path,options}); if (calls.length === 1) throw new TypeError('Failed to fetch'); return json({ok:true});}});
  assert.deepEqual(await connection.json('/api/books'), {ok:true});
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers['X-Reader-Token'], 'private');
  assert.deepEqual(states, ['reconnecting','connected']);
  const failedWrites = [];
  const writeConnection = create(t, {fetch: async (path,options) => {failedWrites.push(options.method); throw new TypeError('network');}});
  await assert.rejects(writeConnection.json('/api/knowledge/generate', {method:'POST',body:'private content'}), /连接暂时中断/);
  assert.deepEqual(failedWrites, ['POST']);
});

test('a 200 response interrupted while reading JSON is retried instead of returned as success', async t => {
  let attempts = 0;
  const connection = create(t, {fetch: async () => ++attempts === 1 ?
    {ok:true,status:200,json:async () => {throw new TypeError('body stream interrupted');}} : json({books:[]})});
  assert.deepEqual(await connection.json('/api/books'), {books:[]});
  assert.equal(attempts, 2);
});

test('long mutations preserve their original deadline and are never replayed', async t => {
  let calls=0;
  const connection=create(t,{timeout:5,fetch:async(_path,options)=>{
    calls++;await sleep(25);assert.equal(options.signal.aborted,false);return json({accepted:true});
  }});
  assert.deepEqual(await connection.json('/api/assistant/ask',{method:'POST'}),{accepted:true});
  assert.equal(calls,1);
});

test('complete PNG body is recovered before returning the immutable page response', async t => {
  let attempts = 0;
  const connection = create(t, {fetch: async () => ++attempts === 1 ?
    {ok:true,status:200,blob:async () => {throw new TypeError('body stream interrupted');}} :
    new Response(new Blob(['original page'], {type:'image/png'}), {headers:{'X-Reader-Image-Width':'400'}})});
  const response = await connection.page('/api/revisions/private-id/page-image?page=10&width=400');
  assert.equal(await (await response.blob()).text(), 'original page');
  assert.equal(response.headers.get('X-Reader-Image-Width'), '400');
  assert.equal(attempts, 2);
});

test('401 stops recovery and clearly requests a current launch address', async t => {
  let calls = 0;
  const connection = create(t, {recoveryDelays:[1], fetch: async () => {calls++; return json({error:'internal authentication detail'},401);}});
  await assert.rejects(connection.json('/api/books'), error => error.status === 401 && /本次连接页/.test(error.message));
  await assert.rejects(connection.json('/api/learning/status'), error => error.status === 401);
  await sleep(20);
  assert.equal(calls,1); assert.equal(connection.state,'unauthorized');
});

test('network recovery probes only authenticated health and notifies once', async t => {
  let available = false, recovered = 0;
  const paths = [], states = [];
  const connection = create(t, {headers:{'X-Reader-Token':'private'}, recoveryDelays:[5], onRecovered:()=>recovered++,
    onState:event=>states.push(event.state), fetch:async (path,options) => {
      paths.push(path); assert.equal(options.headers['X-Reader-Token'],'private');
      if (!available) throw new TypeError('offline'); return json({status:'ok'});
    }});
  await assert.rejects(connection.json('/api/revisions/private/overlay?page=10'));
  available = true;
  await sleep(35);
  assert.equal(connection.state,'connected'); assert.equal(recovered,1);
  assert.deepEqual(states,['reconnecting','connected']);
  assert.equal(paths.at(-1),'/api/health');
  assert.equal(paths.filter(value=>value.includes('overlay')).length,2);
});

test('late old success cannot announce recovery, and a stale failure cannot undo a fresh probe', async t => {
  const oldSuccess=deferred(),oldFailure=deferred(),states=[];
  let recovered=0,health=0;
  const surface=new EventTarget();surface.navigator={onLine:true};
  const connection=create(t,{window:surface,onState:event=>states.push(event.state),onRecovered:()=>recovered++,fetch:async path=>{
    if(path==='/old-success')return oldSuccess.promise;
    if(path==='/old-failure')return oldFailure.promise;
    if(path==='/api/health'){health++;return json({status:'ok'});}
    return json({ok:true});
  }});
  const success=connection.json('/old-success');
  const failure=connection.json('/old-failure',{method:'POST'});
  surface.navigator.onLine=false;surface.dispatchEvent(new Event('offline'));
  oldSuccess.resolve(json({old:true}));await success;
  assert.equal(connection.state,'reconnecting');assert.equal(recovered,0);
  surface.navigator.onLine=true;surface.dispatchEvent(new Event('online'));
  await sleep(15);assert.equal(connection.state,'connected');assert.equal(health,1);assert.equal(recovered,1);
  oldFailure.reject(new TypeError('old transport failed'));await assert.rejects(failure);
  assert.equal(connection.state,'connected');assert.deepEqual(states,['reconnecting','connected']);
});

test('caller cancellation never starts recovery, and deadline surfaces as a connection timeout', async t => {
  const pendingFetch = (_path,options) => new Promise((_yes,no) => {
    if (options.signal.aborted) no(options.signal.reason || new DOMException('aborted','AbortError'));
    else options.signal.addEventListener('abort',()=>no(options.signal.reason || new DOMException('aborted','AbortError')), {once:true});
  });
  const cancelled = create(t, {fetch:pendingFetch});
  const controller = new AbortController();
  const read = cancelled.page('/api/revisions/id/page-image',{signal:controller.signal}); controller.abort();
  await assert.rejects(read,error=>error.name==='AbortError'); assert.equal(cancelled.state,'connected');
  const timeout = create(t, {fetch:pendingFetch,timeout:5});
  await assert.rejects(timeout.json('/api/books'),error=>error.code==='CONNECTION_TIMEOUT');
  assert.equal(timeout.state,'reconnecting');
});

test('503 retries a GET once, but domain errors do not create a network recovery loop', async t => {
  let calls=0;
  const connection=create(t,{fetch:async()=>{calls++;return json({error:'service unavailable'},503);}});
  await assert.rejects(connection.json('/api/learning/status'),error=>error.status===503);
  assert.equal(calls,2); assert.equal(connection.state,'connected');
  assert.equal(connection.diagnostics().length,2);
});

test('diagnostics strip every query, ID, arbitrary error and body while bounding storage', async t => {
  let saved='';
  const connection=create(t,{storage:{getItem:()=>null,setItem:(_key,value)=>saved=value},
    fetch:async()=>json({error:'secret body'},400)});
  for(let index=0;index<65;index++) await assert.rejects(connection.json('/api/revisions/secret-book-id/overlay?token=secret-token&text=secret-text',
    {headers:{'X-Reader-Token':'secret-key'},body:'secret-content'}));
  assert.equal(connection.diagnostics().length,60);
  assert.equal(connection.diagnostics()[0].route,'/api/revisions/:id/overlay');
  assert.equal(/secret/.test(saved),false);
  assert.equal(tabletDiagnosticRoute('http://secret:secret@host/api/books/secret?token=secret'),'/api/books/:id');
});
