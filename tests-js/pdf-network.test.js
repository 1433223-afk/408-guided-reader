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
    assert.equal(fetch(input,options),response);
    const [url,init]=calls.at(-1);assert.equal(url,input);
    assert.equal(init.cache,'no-store');assert.equal(init.signal,signal);
    assert.equal(init.headers,options.headers);assert.equal(init.credentials,'include');
    assert.equal(options.cache,undefined);
  }
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
