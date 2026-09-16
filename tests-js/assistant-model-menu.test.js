import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('model menu keyboard selection forwards one original change and respects lock',async()=>{
  const browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<label class="assistant-model"><select id="model"><option value="deepseek">DeepSeek · deepseek-flash</option><option value="zhipu">Zhipu · GLM-5.3-Flash</option><option value="openrouter">OpenRouter · google/gemini-3.8-flash</option></select></label>');
    await page.addScriptTag({content:fs.readFileSync(new URL('../src/reader_service/static/screens.js',import.meta.url),'utf8').replaceAll('export ','')});
    await page.evaluate(()=>{window.changes=0;const select=document.querySelector('select');select.addEventListener('change',()=>window.changes++);window.menu=createAssistantModelMenu(select);});
    const trigger=page.locator('#assistant-model-trigger');
    await trigger.focus();await trigger.press('ArrowDown');
    await page.locator('[role="option"]').first().press('End');
    await page.locator('[role="option"]').last().press('Enter');
    assert.equal(await page.locator('select').inputValue(),'openrouter');
    assert.equal(await page.evaluate(()=>window.changes),1);
    await trigger.click();await page.locator('[aria-selected="true"]').press('Escape');
    assert.equal(await page.locator('[role="listbox"]').isHidden(),true);
    assert.equal(await page.evaluate(()=>window.changes),1);
    await page.evaluate(()=>{document.querySelector('select').disabled=true;window.menu.sync();});
    assert.equal(await trigger.isDisabled(),false);
    await trigger.click();
    assert.equal(await page.locator('[role="listbox"]').isVisible(),true);
    assert.equal(await page.locator('[role="option"]:disabled').count(),3);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[role="listbox"]').isHidden(),true);
    assert.equal(await page.evaluate(()=>window.changes),1);
  } finally {await browser.close();}
});
