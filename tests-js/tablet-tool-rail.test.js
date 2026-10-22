import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

const script = fs.readFileSync(new URL('../src/reader_service/static/tablet-tool-rail.js', import.meta.url), 'utf8').replace('export ', '');
const panelIds = ['outline-panel','search-panel','marks-panel','guide-panel','knowledge-panel',
  'reader-kp-list','inline-menu','reading-display-menu','assistant-panel'];

test('tablet tool rail idle handling uses the real browser focus, selection and DOM', async t => {
  const browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true});
  async function fixture({withLayout = false} = {}) {
    const page = await browser.newPage({hasTouch:true});
    await page.setContent(`<style>[hidden]{display:none!important}#viewer{width:600px;height:400px}</style>
      <section id="reader"><header class="toolbar"><button id="toggle">工具</button>
      <button id="page-next">下一页</button><input id="page-number" type="number"></header>
      <nav id="rail"><button id="tool">目录</button></nav>
      <main id="viewer" tabindex="0"><p id="text">原书文字用于选区验证</p></main>
      ${panelIds.map(id => `<aside id="${id}" hidden></aside>`).join('')}</section>
      <div id="selection-actions" hidden><input id="note"></div>`);
    await page.evaluate(() => {
      // A clock replaces timers only; focus, observers and selections stay native.
      let now = 0, id = 0;
      const timers = new Map();
      window.setTimeout = (callback, delay = 0) => {timers.set(++id, {at:now + delay, callback}); return id;};
      window.clearTimeout = id => timers.delete(id);
      window.clock = {tick(ms) {
        const end = now + ms;
        while (true) {
          const due = [...timers].filter(([, task]) => task.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
          if (!due) break;
          now = due[1].at; timers.delete(due[0]); due[1].callback();
        }
        now = end;
      }, pending:() => timers.size};
    });
    await page.addScriptTag({content:script});
    await page.evaluate(withLayout => {
      window.layoutCalls = 0;
      window.rail = createTabletToolRail({reader:document.querySelector('#reader'),
        tools:document.querySelector('#rail'), toggle:document.querySelector('#toggle'),
        ...(withLayout ? {layout:update=>{window.layoutCalls++; update();}} : {})});
    }, withLayout);
    return page;
  }
  const hidden = page => page.evaluate(() => window.rail.hidden);
  const tick = (page, ms) => page.evaluate(ms => window.clock.tick(ms), ms);
  try {
    await t.test('default layout hides accessibly and only explicit toggle reveals', async () => {
      const page = await fixture();
      try {
        const geometry = () => page.locator('#viewer').evaluate(node => [node.clientWidth, node.clientHeight, node.getAttribute('style')]);
        const before = await geometry();
        await tick(page, 5999); assert.equal(await hidden(page), false);
        await tick(page, 1); assert.equal(await hidden(page), true);
        assert.deepEqual(await geometry(), before);
        assert.deepEqual(await page.evaluate(() => [document.querySelector('#rail').inert,
          document.querySelector('#rail').getAttribute('aria-hidden'), document.querySelector('#toggle').getAttribute('aria-expanded')]), [true,'true','false']);
        await page.locator('#viewer').click();
        await page.locator('#viewer').dispatchEvent('scroll');
        assert.equal(await hidden(page), true);
        await page.locator('#toggle').click();
        assert.equal(await hidden(page), false);
        await tick(page, 5000);
        await page.locator('#page-next').click();
        await tick(page, 5999); assert.equal(await hidden(page), false);
        await tick(page, 1); assert.equal(await hidden(page), true);
        await page.locator('#toggle').click();
        await page.locator('#toggle').click();
        assert.equal(await hidden(page), true);
      } finally {await page.close();}
    });
    await t.test('host layout runs once per real visible rail change, excluding initialization and root visibility', async () => {
      const page = await fixture({withLayout:true});
      try {
        const calls = () => page.evaluate(() => window.layoutCalls);
        assert.equal(await calls(),0);
        await tick(page,6000); assert.equal(await hidden(page),true); assert.equal(await calls(),1);
        await page.evaluate(() => window.rail.refresh());
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
        await page.evaluate(() => window.rail.refresh());
        assert.equal(await calls(),2,'no layout for an unchanged rail');
        await page.evaluate(() => {document.querySelector('#reader').hidden = true;});
        assert.equal(await hidden(page),true); assert.equal(await calls(),2);
        await page.evaluate(() => {document.querySelector('#reader').hidden = false;});
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
      } finally {await page.close();}
    });
    await t.test('manual rail switching is allowed with AI open but waits for region and text selections', async () => {
      const page = await fixture({withLayout:true});
      try {
        const calls = () => page.evaluate(() => window.layoutCalls);
        await page.evaluate(() => {document.querySelector('#assistant-panel').hidden = false;});
        await page.locator('#toggle').click();
        assert.equal(await hidden(page),true); assert.equal(await calls(),1);
        await page.locator('#toggle').click();
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
        await page.evaluate(() => document.querySelector('#viewer').classList.add('visual-selecting'));
        await page.locator('#toggle').click();
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
        await page.evaluate(() => {
          document.querySelector('#viewer').classList.remove('visual-selecting');
          const quad = document.createElement('span'); quad.className = 'selection-quad';
          document.querySelector('#viewer').append(quad);
        });
        await page.locator('#toggle').dispatchEvent('click');
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
        await page.evaluate(() => {
          document.querySelector('.selection-quad').remove();
          const range = document.createRange(); range.selectNodeContents(document.querySelector('#text'));
          getSelection().addRange(range);
        });
        await page.locator('#toggle').dispatchEvent('click');
        assert.equal(await hidden(page),false); assert.equal(await calls(),2);
        await page.evaluate(() => getSelection().removeAllRanges());
        await page.locator('#toggle').click();
        assert.equal(await hidden(page),true); assert.equal(await calls(),3);
      } finally {await page.close();}
    });
    await t.test('background polls repeating unchanged hidden and class attributes do not postpone idle', async () => {
      const page = await fixture();
      try {
        await page.evaluate(() => {
          const hint = document.createElement('div'); hint.id = 'visual-select-hint'; hint.hidden = true;
          document.querySelector('#reader').append(hint);
          for (const id of ['inline-menu','visual-select-hint','selection-actions']) document.getElementById(id).className = 'steady';
          window.rail.refresh();
        });
        for (let elapsed = 1000; elapsed <= 8000; elapsed += 1000) {
          await tick(page, 1000);
          await page.evaluate(() => {
            // Shared Inline refresh writes these even when already hidden.
            for (const id of ['inline-menu','visual-select-hint','selection-actions']) {
              const surface = document.getElementById(id);
              surface.hidden = true; surface.className = 'steady';
            }
          });
          assert.equal(await hidden(page), elapsed >= 6000, `idle at ${elapsed} ms`);
        }
      } finally {await page.close();}
    });
    await t.test('open learning surfaces protect idle; dynamic inline card is checked at expiry', async () => {
      const page = await fixture();
      try {
        for (const id of [...panelIds, 'selection-actions']) {
          await page.evaluate(id => {window.rail.refresh(); document.getElementById(id).hidden = false;}, id);
          await tick(page, 12000); assert.equal(await hidden(page), false, id);
          await page.evaluate(id => {document.getElementById(id).hidden = true;}, id);
          await tick(page, 6000); assert.equal(await hidden(page), true, `${id} closed`);
        }
        await page.evaluate(() => {window.rail.refresh();});
        await tick(page, 5000);
        await page.evaluate(() => {const card = document.createElement('aside'); card.id = 'inline-panel'; document.querySelector('#reader').append(card);});
        await tick(page, 1000); assert.equal(await hidden(page), false);
        await page.evaluate(() => document.querySelector('#inline-panel').remove());
        await tick(page, 6000); assert.equal(await hidden(page), true);
        for (const className of ['kp-learning-marker', 'learning-scope-marker']) {
          await page.evaluate(className => {
            window.rail.refresh();
            const marker = document.createElement('details'); marker.className = className;
            marker.innerHTML = '<summary>知识点确认</summary><p>学习状态</p>'; marker.open = true;
            document.querySelector('#viewer').append(marker);
          }, className);
          await tick(page, 12000); assert.equal(await hidden(page), false, `${className} open`);
          await page.evaluate(className => {document.querySelector(`.${className}`).open = false;}, className);
          await tick(page, 6000); assert.equal(await hidden(page), true, `${className} closed`);
        }
        await page.evaluate(() => window.rail.refresh());
        await tick(page, 5000);
        await page.evaluate(() => document.querySelector('#viewer').append(document.createElement('p')));
        await tick(page, 1000); assert.equal(await hidden(page), true, 'page/stream child insertion does not reset idle');
      } finally {await page.close();}
    });
    await t.test('selection, region mode and a contacting pointer defer hiding without taking gestures', async () => {
      const page = await fixture();
      try {
        await page.evaluate(() => {const selection = getSelection(), range = document.createRange();
          range.selectNodeContents(document.querySelector('#text')); selection.addRange(range);});
        await tick(page, 12000); assert.equal(await hidden(page), false);
        await page.evaluate(() => getSelection().removeAllRanges());
        await tick(page, 6000); assert.equal(await hidden(page), true);
        await page.evaluate(() => {window.rail.refresh(); document.querySelector('#viewer').classList.add('visual-selecting');});
        await tick(page, 6000); assert.equal(await hidden(page), false);
        await page.evaluate(() => document.querySelector('#viewer').classList.remove('visual-selecting'));
        await tick(page, 6000); assert.equal(await hidden(page), true);
        await page.evaluate(() => window.rail.refresh());
        const accepted = await page.locator('#viewer').evaluate(node => node.dispatchEvent(new PointerEvent('pointerdown',
          {bubbles:true, cancelable:true, pointerId:9, pointerType:'pen'})));
        assert.equal(accepted, true, 'no preventDefault on PDF pointerdown');
        await tick(page, 6000); assert.equal(await hidden(page), false);
        await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', {pointerId:9})));
        await tick(page, 6000); assert.equal(await hidden(page), true);
      } finally {await page.close();}
    });
    await t.test('keyboard/input focus is protected, ordinary touch focus expires, refresh and destroy clean up', async () => {
      const page = await fixture();
      try {
        await page.keyboard.press('Tab');
        await page.locator('#tool').focus();
        await tick(page, 12000); assert.equal(await hidden(page), false);
        await page.locator('#tool').tap();
        await tick(page, 6000); assert.equal(await hidden(page), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'toggle');
        await page.evaluate(() => window.rail.refresh());
        await page.locator('#page-number').focus();
        await tick(page, 12000); assert.equal(await hidden(page), false);
        await page.locator('#page-number').blur();
        await tick(page, 6000); assert.equal(await hidden(page), true);
        await page.evaluate(() => {document.querySelector('#reader').hidden = true;});
        assert.equal(await page.evaluate(() => window.clock.pending()), 0);
        await page.evaluate(() => {document.querySelector('#reader').hidden = false;});
        assert.equal(await hidden(page), false);
        await tick(page, 5000);
        await page.evaluate(() => window.rail.refresh());
        await tick(page, 5999); assert.equal(await hidden(page), false);
        await page.evaluate(() => window.rail.destroy());
        assert.equal(await page.evaluate(() => window.clock.pending()), 0);
        await page.locator('#toggle').click(); await tick(page, 12000);
        assert.equal(await hidden(page), false);
        assert.equal(await page.locator('#rail').evaluate(node => node.inert), false);
      } finally {await page.close();}
    });
  } finally {await browser.close();}
});
