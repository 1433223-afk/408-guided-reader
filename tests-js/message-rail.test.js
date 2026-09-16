import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('message ruler previews plain text, navigates locally by keyboard and drops departed messages', async () => {
  const browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page=await browser.newPage({reducedMotion:'reduce'});
    await page.setContent('<style>#history{height:180px;overflow:auto}.assistant-answer-bubble{height:600px}.message-rail-preview{position:absolute}</style><div id="history"><p class="assistant-question-bubble">为什么？</p><div class="assistant-answer-bubble">解释一</div><p class="assistant-question-bubble">再简单点</p><div class="assistant-answer-bubble">解释二</div></div>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replace(/export /g,'')});
    await page.evaluate(()=>createMessageRail(document.querySelector('#history')));
    const ticks=page.locator('.message-rail button');
    assert.equal(await ticks.count(),2);
    await page.waitForFunction(()=>document.querySelector('.message-tick').hasAttribute('aria-current'));
    assert.equal(await page.locator('.message-tick[data-emphasis][aria-current="true"]').count(),1);
    assert.deepEqual(await ticks.evaluateAll(items=>items.map(el=>Number(el.style.getPropertyValue('--tick-scale')))),[14/26,14/26]);
    await ticks.first().hover();
    assert.equal(Number(await ticks.first().evaluate(el=>el.style.getPropertyValue('--tick-scale'))),1);
    assert.ok(Number(await ticks.nth(1).evaluate(el=>el.style.getPropertyValue('--tick-scale')))<1);
    await ticks.first().focus();
    assert.match(await page.locator('#history-preview').textContent(),/为什么/);
    assert.match(await page.locator('#history-preview').textContent(),/解释一/);
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#history').scrollTop>500);
    await page.waitForFunction(()=>document.querySelectorAll('.message-rail button')[1].getAttribute('aria-current')==='true');
    assert.equal(await page.locator('.message-tick[data-emphasis][aria-current="true"]').count(),1);
    assert.equal(await page.evaluate(()=>scrollY),0);
    await page.keyboard.press('Home');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-preview').isHidden(),true);
    assert.deepEqual(await ticks.evaluateAll(items=>items.map(el=>Number(el.style.getPropertyValue('--tick-scale')))),[14/26,14/26]);
    await page.evaluate(()=>{
      const history=document.querySelector('#history');
      history.replaceChildren();
      for(let i=0;i<20;i++) {
        const q=document.createElement('p'); q.className='assistant-question-bubble'; q.textContent=`问题 ${i+1}`;
        const a=document.createElement('div'); a.className='assistant-answer-bubble'; a.textContent=`回答 ${i+1}`;
        history.append(q,a);
      }
    });
    await page.waitForFunction(()=>document.querySelectorAll('.message-tick').length===20);
    await ticks.nth(8).focus();
    const lengths=await ticks.evaluateAll(items=>items.map(item=>Number(item.style.getPropertyValue('--tick-scale'))));
    assert.equal(lengths[8],1);
    assert.ok(lengths[7]>lengths[6] && lengths[6]>lengths[5]);
    assert.equal(lengths[7],lengths[9]);
    assert.equal(lengths[0],4/26);
    assert.equal(await page.locator('.message-tick[data-emphasis]').count(),1);
    await page.evaluate(()=>document.querySelector('#history').replaceChildren());
    await page.waitForFunction(()=>document.querySelector('.message-rail').hidden);
    assert.equal(await ticks.count(),0);
    assert.equal(await page.locator('#history-preview').isHidden(),true);
  } finally { await browser.close(); }
});
