import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {cp, mkdir, mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source=process.env.READER_DATA_DIR;
if(!source) throw new Error('Set READER_DATA_DIR to the prepared 348-page Library');
const root=await mkdtemp(path.join(os.tmpdir(),'guided-reader-master-stream-'));
const dataDir=path.join(root,'data');
await cp(source,dataDir,{recursive:true});
const calls=[];
const reasoningCanary='REAL_PROVIDER_REASONING_STREAM_CANARY';
const provider=createServer(async(req,res)=>{
  const chunks=[]; for await(const chunk of req) chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks)); calls.push(body);
  assert.equal(body.stream,true);
  const answer='依据当前教材，这个概念需要先抓住定义，再比较它成立的条件。补充解释：可以用一个反例检查理解边界。';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(body.thinking?.type==='enabled') {
    res.write(`data: ${JSON.stringify({choices:[{delta:{reasoning_content:reasoningCanary},finish_reason:null}]})}\n\n`);
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  res.write(`data: ${JSON.stringify({choices:[{delta:{content:answer.slice(0,22)},finish_reason:null}]})}\n\n`);
  await new Promise(resolve=>setTimeout(resolve,180));
  res.write(`data: ${JSON.stringify({choices:[{delta:{content:answer.slice(22)},finish_reason:'stop'}]})}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));

const service=spawn('python',['-m','reader_service','--no-open','--port','0','--data-dir',dataDir],{
  windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
    GUIDED_READER_MASTER_PROVIDER:'deepseek',GUIDED_READER_REVIEW_PROVIDER:'zhipu',
    GUIDED_READER_DEEPSEEK_API_KEY:'loopback-key',
    GUIDED_READER_DEEPSEEK_ENDPOINT:`http://127.0.0.1:${provider.address().port}/chat/completions`,
    GUIDED_READER_ZHIPU_DISABLED:'1',GUIDED_READER_OPENROUTER_DISABLED:'1'},
});
let browser;
try {
  const url=await ready(service);
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const assistantRequests=[];
  page.on('request',request=>{
    if(request.url().endsWith('/assistant/ask') && request.method()==='POST') {
      assistantRequests.push(request.postDataJSON());
    }
  });
  await page.goto(url);
  const data=await page.evaluate(async()=>{
    const books=(await (await fetch('/api/books')).json()).books;
    const book=books.find(item=>item.active_revision?.page_count===348);
    const learning=await (await fetch(`/api/revisions/${book.active_revision.id}/learning`)).json();
    return {revision:book.active_revision.id,learning};
  });
  const point=data.learning.points.find(item=>item.thread_id);
  assert.ok(point,'A retained real Master thread is required');
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator('.page canvas').first().waitFor({timeout:30_000});
  await page.locator('#page-number').fill(String(point.display_end_page+1));
  await page.locator('#page-number').press('Enter');
  const marker=page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`).filter({hasText:point.title}).first();
  for(let attempt=0;attempt<4;attempt++) {
    try {
      if(!await marker.evaluate(element=>element.open)) await marker.locator('summary').click();
      await marker.getByRole('button',{name:'继续 Master 对话',exact:true}).click({timeout:4000});
      break;
    } catch(error) { if(attempt===3) throw error; }
  }
  await page.locator('#master-form').waitFor({state:'visible'});
  assert.equal(await page.locator('#master-provider').inputValue(),'deepseek');
  assert.equal(await page.locator('#master-reasoning').inputValue(),'Quick');
  assert.equal(await page.locator('#master-mode').inputValue(),'Fast');
  const before=await snapshot(page,data.revision,point.knowledge_point_id);

  await page.locator('#master-question').fill('请快速说明这个概念最关键的区别。');
  await page.locator('#master-send').click();
  await page.locator('.master-stream-message .assistant-answer-streaming').waitFor();
  const partial=await page.locator('.master-stream-message .assistant-answer-streaming').textContent();
  assert.ok(partial.length>0 && partial.length<45,'Quick answer must be visibly incremental');
  await messageCount(page,before.messages.length+2);

  await page.locator('#master-reasoning-choice-trigger').click();
  await page.locator('#master-reasoning-choice-options [data-value="Deep"]').click();
  await page.locator('#master-question').fill('请深入解释为什么这些成立条件不能忽略。');
  await page.locator('#master-send').click();
  await page.locator('.master-stream-message .master-reasoning-content').filter({hasText:reasoningCanary}).waitFor();
  await page.waitForFunction(()=>{
    const answer=document.querySelector('.master-stream-message .assistant-answer-streaming');
    return answer && !answer.hidden && answer.textContent.length>0;
  });
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/master-streaming-reasoning.png'});
  await messageCount(page,before.messages.length+4);

  const after=await snapshot(page,data.revision,point.knowledge_point_id);
  const added=after.messages.slice(before.messages.length);
  assert.deepEqual(added.filter(item=>item.role==='user').map(item=>[item.provider,item.model,item.reasoning_mode,item.review_mode]),[
    ['deepseek','deepseek-flash','Quick','Fast'],['deepseek','deepseek-flash','Deep','Fast'],
  ]);
  assert.deepEqual(added.filter(item=>item.role==='assistant').map(item=>[item.reasoning_mode,item.review_state]),[
    ['Quick','NOT_REQUESTED'],['Deep','NOT_REQUESTED'],
  ]);
  assert.equal(calls.length,2,'Fast Review must not invoke the reviewer');
  assert.deepEqual(calls[0].thinking,{type:'disabled'});
  assert.equal(calls[0].max_tokens,4096,'Quick keeps the provider default generation budget');
  assert.deepEqual(calls[1].thinking,{type:'enabled'});
  assert.equal(calls[1].max_tokens,12_288,'Deep gets a larger bounded reasoning + answer budget');
  assert.ok(!JSON.stringify(after).includes(reasoningCanary),'Reasoning text is transient, not persisted');

  await selectMasterPhrase(page,'成立的条件');
  assert.deepEqual(
    await page.locator('#selection-actions .selection-action-row button:visible').allTextContents(),
    ['复制','问 AI'],
  );
  await page.screenshot({path:'test-results/master-answer-selection-normal.png'});
  await page.locator('#copy-selection').focus();
  await page.keyboard.press('Escape');

  await page.locator('#master-expand').click();
  await page.locator('#reader.assistant-expanded').waitFor();
  await selectMasterPhrase(page,'反例检查理解边界');
  assert.deepEqual(
    await page.locator('#selection-actions .selection-action-row button:visible').allTextContents(),
    ['复制','问 AI'],
  );
  await page.screenshot({path:'test-results/master-answer-selection-expanded.png'});
  const callsBeforeAssistant=calls.length;
  const learningBeforeAssistant=await snapshot(page,data.revision,point.knowledge_point_id);
  await page.locator('#ask-selection').click();
  await page.locator('#assistant-first-turn').waitFor({state:'visible'});
  assert.equal(await page.locator('#assistant-draft-text').textContent(),'反例检查理解边界');
  assert.equal(await page.locator('#assistant-scope').textContent(),'正在解释：Master 回答选区');
  assert.equal(calls.length,callsBeforeAssistant,'opening the Master selection draft caused provider egress');
  await page.locator('#assistant-start').click();
  await page.locator('#assistant-turns .assistant-answer-bubble[data-current-answer="true"]').waitFor();
  assert.equal(calls.length,callsBeforeAssistant+1);
  assert.equal(assistantRequests.length,1);
  assert.equal(assistantRequests[0].source_kind,'MASTER_ANSWER');
  assert.equal(assistantRequests[0].master_message_id,added.filter(item=>item.role==='assistant').at(-1).id);
  assert.ok(assistantRequests[0].source_spans.length>=1);
  const masterSelectionTransport=calls.at(-1).messages.at(-1).content;
  assert.ok(masterSelectionTransport.startsWith('【当前解释焦点（用户所选）】\n反例检查理解边界\n'));
  assert.ok(masterSelectionTransport.includes('这段文字来自 Master 回答，不是教材原文'));
  assert.ok(!/MASTER_ANSWER|thread_id|topic_id|message_id|source_spans/.test(masterSelectionTransport));
  assert.deepEqual(await snapshot(page,data.revision,point.knowledge_point_id),learningBeforeAssistant);
  await page.getByRole('button',{name:'学习 Master',exact:true}).click();
  await page.locator('#master-history').waitFor({state:'visible'});

  await page.locator('#master-provider-choice-trigger').click();
  await page.locator('#master-provider-choice-options [data-value="zhipu"]').click();
  assert.equal(await page.locator('#master-send').isDisabled(),true);
  assert.ok((await page.locator('#master-status').textContent()).includes('智谱'));
  await page.locator('#master-provider-choice-trigger').click();
  await page.locator('#master-provider-choice-options [data-value="deepseek"]').click();
  assert.equal(await page.locator('#master-send').isEnabled(),true);
  assert.equal(await page.locator('#master-status').textContent(),'','ready provider must clear only the stale readiness message');
  await page.locator('#master-more').click();
  assert.equal(await page.locator('#master-mode').inputValue(),'Fast');
  assert.equal(await page.locator('#master-confirm').isVisible(),after.topics.some(topic=>topic.state==='ACTIVE'));
  await page.screenshot({path:'test-results/master-model-reasoning-review-menu.png'});

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',quickStreaming:true,deepStreaming:true,
    reasoningSeparated:true,reasoningPersisted:false,reviewDefault:'Fast',reviewCalls:0,
    masterSelection:true,masterSelectionSource:'MASTER_ANSWER',
    normalSelectionScreenshot:'test-results/master-answer-selection-normal.png',
    expandedSelectionScreenshot:'test-results/master-answer-selection-expanded.png',
    screenshot:'test-results/master-streaming-reasoning.png',menuScreenshot:'test-results/master-model-reasoning-review-menu.png'}));
} finally {
  if(browser) await browser.close();
  if(service.exitCode===null) {service.kill(); await new Promise(resolve=>service.once('exit',resolve));}
  await new Promise(resolve=>provider.close(resolve));
}

async function ready(child) {
  let output='',errors=''; child.stderr.on('data',value=>{errors+=value;});
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(output+errors||'Service startup timed out')),30_000);
    child.stdout.on('data',value=>{output+=value;const match=output.match(/READY (http:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    child.on('exit',()=>{clearTimeout(timeout);reject(new Error(errors||output));});
  });
}

async function snapshot(page,revision,scope) {
  return page.evaluate(async({revision,scope})=>(await (await fetch(`/api/revisions/${revision}/learning/${scope}`)).json()),{revision,scope});
}

async function messageCount(page,count) {
  await page.waitForFunction(count=>document.querySelectorAll('#master-history .master-message').length===count
    && !document.querySelector('#master-history .master-stream-message'),count,{timeout:30_000});
}

async function selectMasterPhrase(page,phrase) {
  const intercepted=await page.locator('#master-history .master-message .assistant-answer-bubble')
    .filter({hasText:phrase}).last().evaluate((bubble,selected)=>{
      const span=[...bubble.querySelectorAll('.assistant-source-text')]
        .find(candidate=>candidate.textContent.includes(selected));
      if(!span) throw new Error(`Master phrase is not source-mapped: ${selected}`);
      const node=span.firstChild;
      const start=node.data.indexOf(selected);
      const range=document.createRange(); range.setStart(node,start); range.setEnd(node,start+selected.length);
      const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const rect=range.getBoundingClientRect();
      const event=new MouseEvent('contextmenu',{
        bubbles:true,cancelable:true,button:2,
        clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,
      });
      bubble.dispatchEvent(event);
      return event.defaultPrevented;
    },phrase);
  assert.equal(intercepted,true,'Master answer right-click must be intercepted inside the selection');
  await page.locator('#selection-actions').waitFor({state:'visible'});
}
