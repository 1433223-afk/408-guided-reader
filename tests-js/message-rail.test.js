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
    await ticks.first().hover();
    assert.ok(Number(await ticks.first().evaluate(el=>el.style.getPropertyValue('--tick-scale')))>1);
    assert.ok(Number(await ticks.nth(1).evaluate(el=>el.style.getPropertyValue('--tick-scale')))>1);
    await ticks.first().focus();
    assert.match(await page.locator('#history-preview').textContent(),/为什么/);
    assert.match(await page.locator('#history-preview').textContent(),/解释一/);
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#history').scrollTop>500);
    await page.waitForFunction(()=>document.querySelectorAll('.message-rail button')[1].getAttribute('aria-current')==='true');
    assert.equal(await page.evaluate(()=>scrollY),0);
    await page.keyboard.press('Home');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#history-preview').isHidden(),true);
    await page.evaluate(()=>document.querySelector('#history').replaceChildren());
    await page.waitForFunction(()=>document.querySelector('.message-rail').hidden);
    assert.equal(await ticks.count(),0);
    assert.equal(await page.locator('#history-preview').isHidden(),true);
  } finally { await browser.close(); }
});
