import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {chromium} from 'playwright-core';

test('selection shades only the original page outside the crop and clears on cancel', async () => {
  const browser = await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:800,height:700}});
    const css = fs.readFileSync(new URL('../src/reader_service/static/styles.css',import.meta.url),'utf8');
    const source = fs.readFileSync(new URL('../src/reader_service/static/visual-selection.js',import.meta.url),'utf8').replaceAll('export ', '');
    await page.setContent(`<style>${css}
      #bar{height:40px;background:rgb(246,245,238)}
      #viewer{width:800px;height:660px}.page{width:400px;overflow:visible}
      .page canvas{width:400px;height:240px}.footer{height:40px;background:rgb(240,238,230)}
    </style><header id="bar"><button id="toggle">框选</button></header>
    <div id="viewer" class="viewer" tabindex="0">
      <div class="page" data-index="0"><canvas width="400" height="240"></canvas><div class="footer"></div></div>
      <div class="page" data-index="1"><canvas width="400" height="240"></canvas></div>
    </div><div id="hint" class="visual-select-hint" hidden><button data-region-confirm>解释</button><button data-region-cancel>取消</button></div>`);
    await page.addScriptTag({content:source});
    await page.evaluate(() => {
      for(const canvas of document.querySelectorAll('canvas')) {
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,400,240);
      }
      window.ui=createVisualSelection({viewer:document.querySelector('#viewer'),toggle:document.querySelector('#toggle'),hint:document.querySelector('#hint'),enabled:()=>true,onEnter:()=>{},onSelect:()=>{}});
    });
    const first = await page.locator('canvas').first().boundingBox();
    const second = await page.locator('canvas').last().boundingBox();
    const footer = await page.locator('.footer').boundingBox();
    const samples = [
      [first.x+200,first.y+120], [first.x+40,first.y+40],
      [second.x+200,second.y+120], [footer.x+200,footer.y+20], [700,20],
    ];
    async function pixels() {
      const png=(await page.screenshot()).toString('base64');
      return page.evaluate(async ({png,samples}) => {
        const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        return samples.map(([x,y]) => [...ctx.getImageData(x,y,1,1).data]);
      },{png,samples});
    }
    const before=await pixels();
    await page.locator('#toggle').click();
    await page.mouse.move(first.x+100,first.y+60);await page.mouse.down();
    await page.mouse.move(first.x+300,first.y+180);await page.mouse.up();
    const shaded=await pixels();
    assert.deepEqual(shaded[0],before[0],'selected PDF pixels stay unchanged');
    assert.notDeepEqual(shaded[1],before[1],'outside the selection is visibly dimmed');
    assert.ok(shaded[1].slice(0,3).every(channel => channel >= 220),'shade stays light');
    assert.deepEqual(shaded.slice(2),before.slice(2),'other page, learning footer and toolbar stay unchanged');
    assert.deepEqual(await page.locator('canvas').first().evaluate(el=>[...el.getContext('2d').getImageData(40,40,1,1).data]),before[1],'source canvas is not modified');
    // Expanding the crop must reveal formerly dimmed pixels immediately.
    await page.mouse.move(first.x+100,first.y+60);await page.mouse.down();
    await page.mouse.move(first.x+20,first.y+20);await page.mouse.up();
    assert.deepEqual((await pixels())[1],before[1]);
    await page.locator('[data-region-cancel]').click();
    assert.deepEqual(await pixels(),before,'cancel restores the original Reader surfaces');
  } finally { await browser.close(); }
});
