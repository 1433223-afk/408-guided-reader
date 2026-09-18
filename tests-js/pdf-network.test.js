import assert from 'node:assert/strict';
import test from 'node:test';
import {pdfFetchWithoutCache} from '../src/reader_service/static/pdf-network.js';

test('PDF cache bypass preserves URL, credentials, headers, cancellation and response',async()=>{
  const response=Promise.resolve({status:206});const calls=[];
  const fetch=pdfFetchWithoutCache((...args)=>{calls.push(args);return response;},'https://reader.test');
  const signal=new AbortController().signal;
  for(const input of ['/api/revisions/rev/pdf',new URL('https://reader.test/api/revisions/rev/pdf'),
      new Request('https://reader.test/api/revisions/rev/pdf',{credentials:'include',signal})]){
    const options={credentials:'include',headers:{Range:'bytes=0-65535'},signal};
    assert.equal(await fetch(input,options),await response);
    const [url,init]=calls.at(-1);assert.equal(url,input);
    assert.equal(init.cache,'no-store');assert.equal(init.signal,signal);
    assert.equal(init.headers,options.headers);assert.equal(init.credentials,'include');
    assert.equal(options.cache,undefined);
  }
});

test('large Range bursts admit eight at a time without blocking other requests',async()=>{
  let active=0,peak=0;const releases=[];const calls=[];
  const response={status:206,url:'https://reader.test/api/revisions/rev/pdf'};
  const fetch=pdfFetchWithoutCache((input,init)=>{
    calls.push([input,init]);
    if(!new Headers(init?.headers).has('Range'))return Promise.resolve(response);
    peak=Math.max(peak,++active);
    return new Promise(resolve=>releases.push(()=>{active--;resolve(response);}));
  },'https://reader.test');
  const pending=Array.from({length:312},()=>fetch('/api/revisions/rev/pdf',{headers:{Range:'bytes=0-65535'}}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,8);
  assert.equal(await fetch('/api/health'),response);
  assert.equal(await fetch('/api/revisions/rev/pdf'),response); // Full-stream probe must not queue.
  for(let completed=0;completed<312;){
    for(const release of releases.splice(0)){release();completed++;}
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.ok((await Promise.all(pending)).every(value=>value===response));
  assert.equal(peak,8);
});

test('queued cancellation never reaches fetch and failures release admission slots',async()=>{
  const releases=[];const calls=[];
  const fetch=pdfFetchWithoutCache((input)=>{
    calls.push(input);
    return new Promise((resolve,reject)=>releases.push({resolve,reject}));
  },'https://reader.test');
  const url='https://reader.test/api/revisions/rev/pdf';
  const options={headers:{Range:'bytes=0-65535'}};
  const running=Array.from({length:8},()=>fetch(url,options).catch(error=>error));
  const controller=new AbortController();
  const queued=fetch(new Request(url,{...options,signal:controller.signal}));
  const rejection=assert.rejects(queued,{name:'AbortError'});
  controller.abort();await rejection;
  const next=fetch(url,options);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,8);
  releases[0].reject(new Error('network failure'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,9);
  for(const release of releases)release.resolve('ok');
  await Promise.all(running);assert.equal(await next,'ok');
  const aborted=fetch(url,{...options,signal:controller.signal});
  await assert.rejects(aborted,{name:'AbortError'});
  assert.equal(calls.length,9);
});

test('other API, static, external and non-GET requests are delegated unchanged',()=>{
  const calls=[];const fetch=pdfFetchWithoutCache((...args)=>calls.push(args),'https://reader.test');
  for(const [input,init] of [
    ['/api/books',undefined],['/vendor/pdf.worker.mjs',undefined],
    ['https://elsewhere.test/api/revisions/rev/pdf',{credentials:'omit'}],
    ['/api/revisions/rev/pdf',{method:'POST'}],
    [new Request('https://reader.test/api/revisions/rev/pdf',{method:'POST'}),undefined],
  ]){fetch(input,init);assert.equal(calls.at(-1)[0],input);assert.equal(calls.at(-1)[1],init);}
});
