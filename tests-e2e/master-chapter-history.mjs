import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, rm, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source=process.env.READER_DATA_DIR;
if(!source) throw new Error('Set READER_DATA_DIR to the prepared 348-page library');
const temporary=await mkdtemp(path.join(os.tmpdir(),'reader-master-chapter-history-'));
const dataDir=path.join(temporary,'data');
await cp(source,dataDir,{recursive:true});
let browser;
const service=spawn('python',['-m','reader_service','--no-open','--port','0','--data-dir',dataDir],{
  windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    GUIDED_READER_DEEPSEEK_DISABLED:'1',GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'},
});
try {
  const url=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Service startup timed out')),30000);
    let output=''; service.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/READY (http:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    service.on('exit',code=>{clearTimeout(timeout);reject(new Error(`Service exited ${code}`));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(url);
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  const data=await page.evaluate(async()=>{
    const books=await (await fetch('/api/books')).json();
    const book=books.books.find(item=>item.active_revision?.page_count===348);
    const revision=book.active_revision.id;
    const outline=await (await fetch(`/api/revisions/${revision}/outline`)).json();
    const chapters=[];
    for(const node of outline.nodes.filter(node=>node.kind==='CHAPTER'&&Number.isInteger(node.start_page))) {
      const entries=await (await fetch(`/api/revisions/${revision}/learning?chapter_id=${node.outline_node_id}`)).json();
      chapters.push({id:node.outline_node_id,node,entries});
    }
    const withConversation=chapters.find(chapter=>chapter.entries.topics.some(topic=>topic.scope_kind==='KP'));
    const withoutConversation=chapters.find(chapter=>chapter.id!==withConversation?.id&&!chapter.entries.topics.length);
    if(!withConversation||!withoutConversation) throw new Error(`Chapters with and without Master history are required: ${JSON.stringify(chapters.map(chapter=>({id:chapter.id,title:chapter.node.title,topics:chapter.entries.topics.length,points:chapter.entries.points.length})))}`);
    const topic=withConversation.entries.topics.find(candidate=>candidate.scope_kind==='KP');
    const point=withConversation.entries.points.find(candidate=>candidate.knowledge_point_id===topic.scope_id);
    return {revision,withConversation,withoutConversation,topic,point};
  });

  async function goTo(pageIndex) {
    await page.locator('#page-number').fill(String(pageIndex+1));
    await page.locator('#page-number').press('Enter');
    await page.waitForFunction(pageNumber=>document.querySelector('#page-number')?.value===String(pageNumber),pageIndex+1);
  }

  await goTo(data.point.display_end_page);
  const marker=page.locator(`.page[data-index="${data.point.display_end_page}"] .kp-learning-marker`).filter({hasText:data.point.title}).first();
  for(let attempt=0;attempt<3;attempt+=1) {
    try {
      if(!await marker.evaluate(element=>element.open)) await marker.locator('summary').click();
      await marker.getByRole('button',{name:'继续 Master 对话',exact:true}).click({timeout:3000});
      break;
    } catch(error) { if(attempt===2) throw error; }
  }
  await page.locator('#master-form').waitFor({state:'visible'});
  await page.locator('#master-expand').click();
  await page.locator('#master-topic-sidebar').waitFor({state:'visible'});
  assert.equal(await page.locator('#master-topic-sidebar > strong').textContent(),'本章对话');
  assert.equal(await page.locator('#master-topic-sidebar').getAttribute('aria-label'),'当前章节 Master 对话');
  assert.deepEqual(
    await page.locator('#master-topic-list button').evaluateAll(items=>items.map(item=>item.dataset.topicId).sort()),
    data.withConversation.entries.topics.map(topic=>topic.id).sort(),
  );

  const writes=[];
  const observe=request=>{if(request.method()!=='GET'&&request.url().includes('/learning')) writes.push(request.url());};
  page.on('request',observe);
  await page.locator(`#master-topic-list [data-topic-id="${data.topic.id}"]`).click();
  await page.locator(`#master-topic-list [data-topic-id="${data.topic.id}"][aria-current="true"]`).waitFor();
  page.off('request',observe);
  assert.deepEqual(writes,[]);
  assert.equal(await page.locator('#master-topic-list').getByRole('button',{name:/新建/}).count(),0);

  await page.locator('#master-expand').click();
  await goTo(data.withoutConversation.node.start_page);
  await page.locator('#master-expand').click();
  await page.getByText('本章还没有 Master 对话',{exact:true}).waitFor();
  assert.equal(await page.locator('#master-topic-list button').count(),0);

  await page.locator('#master-expand').click();
  await goTo(data.point.display_end_page);
  await page.locator('#master-expand').click();
  await page.locator(`#master-topic-list [data-topic-id="${data.topic.id}"]`).waitFor();
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/master-chapter-history.png'});
  console.log(JSON.stringify({
    currentChapterOnly:true,completedConversationOnly:true,navigationWrites:writes.length,
    restoredTopic:data.topic.id,emptyChapterItems:0,
  }));
} finally {
  if(browser) await browser.close();
  service.kill();
  await rm(temporary,{recursive:true,force:true});
}
