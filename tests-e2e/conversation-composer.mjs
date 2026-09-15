import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdtemp, rm, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error('Set READER_DATA_DIR to a prepared library with a retained Master thread');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-composer-'));
const dataDir = path.join(temporary, 'data');
await cp(source, dataDir, {recursive:true});
let browser;
const service = spawn('python', ['-m','reader_service','--no-open','--port','0','--data-dir',dataDir],
  {windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env,
    GUIDED_READER_DEEPSEEK_API_KEY:'test-key', GUIDED_READER_DEEPSEEK_ENDPOINT:'http://127.0.0.1:9/chat',
    GUIDED_READER_ZHIPU_DISABLED:'1', GUIDED_READER_OPENROUTER_DISABLED:'1'}});
try {
  const url = await new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>reject(new Error('Service startup timed out')),30000);
    let output=''; service.stdout.on('data', chunk => { output+=chunk; const match=output.match(/READY (http:\/\/\S+)/); if(match){clearTimeout(timeout);resolve(match[1]);} });
    service.on('exit', code => {clearTimeout(timeout);reject(new Error(`Service exited ${code}`));});
  });
  browser=await chromium.launch({executablePath:process.env.READER_CHROMIUM || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[]; page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.goto(url);
  await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  const data=await page.evaluate(async()=>{
    const books=await (await fetch('/api/books')).json(); const book=books.books.find(b=>b.active_revision?.page_count===348);
    const revision=book.active_revision.id;
    const all=await (await fetch(`/api/revisions/${revision}/learning`)).json();
    for(const chapterId of new Set(all.points.map(point=>point.chapter_outline_node_id))) {
      const learning=await (await fetch(`/api/revisions/${revision}/learning?chapter_id=${chapterId}`)).json();
      if(learning.topics.length>1) {
        const point=learning.points.find(candidate=>candidate.knowledge_point_id===learning.topics[0].scope_id);
        if(point) return {revision,point,learning};
      }
    }
    throw new Error('A chapter with retained Master conversations is required');
  });
  const point=data.point;
  assert.ok(point, 'A retained Master thread is required');
  await page.locator('#page-number').fill(String(point.display_end_page+1));
  await page.locator('#page-number').press('Enter');
  const marker=page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`).filter({hasText:point.title}).first();
  // Delayed PDF mounting can replace the marker; reopen using real pointer actions.
  for(let attempt=0;attempt<3;attempt++) {
    try {
      if(!await marker.evaluate(el=>el.open)) await marker.locator('summary').click();
      await page.getByRole('button',{name:'继续 Master 对话',exact:true}).filter({visible:true}).click({timeout:3000});
      break;
    } catch(error) { if(attempt===2) throw error; }
  }
  await page.locator('#master-form').waitFor({state:'visible'});
  await page.locator('#master-more').click();
  assert.equal(await page.locator('#master-confirm').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#master-confirm').isHidden(),true);
  const compactHeight=await page.locator('#master-question').evaluate(el=>el.getBoundingClientRect().height);
  await page.locator('#master-question').fill(Array(12).fill('输入框随内容增长').join('\n'));
  assert.ok(await page.locator('#master-question').evaluate(el=>el.getBoundingClientRect().height)>compactHeight);
  await page.locator('#master-question').fill('');
  assert.equal(await page.locator('#master-question').evaluate(el=>el.getBoundingClientRect().height),compactHeight);
  assert.equal(await page.locator('#master-mode').isHidden(),true);
  assert.equal(await page.locator('#master-mode').inputValue(),'Fast');
  assert.equal(await page.locator('#master-provider-choice-trigger').textContent(),'DeepSeek');
  assert.equal(await page.locator('#master-reasoning-choice-trigger').textContent(),'快速');
  await page.locator('#master-reasoning-choice-trigger').click();
  await page.locator('#master-reasoning-choice-options [data-value="Deep"]').click();
  assert.equal(await page.locator('#master-reasoning').inputValue(),'Deep');
  await page.locator('#master-more').click();
  await page.locator('#master-mode').selectOption('Deep');
  assert.equal(await page.locator('#master-mode').inputValue(),'Deep');
  await page.locator('#master-mode').selectOption('Fast');
  assert.equal(await page.locator('#master-mode').inputValue(),'Fast');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.master-actions-popover').isHidden(),true);
  await page.locator('#master-more').click();
  await page.locator('#master-mode').selectOption('Standard');
  await page.keyboard.press('Escape');
  const captured=[];
  await page.route('**/learning/*/send', async route=>{
    captured.push(route.request().postDataJSON());
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试暂不可用，草稿保留'})});
  });
  await page.locator('#master-question').fill('请解释这个概念');
  await page.locator('#master-send').click();
  await page.locator('#master-status').filter({hasText:'测试暂不可用'}).waitFor();
  assert.equal(captured[0].review_mode,'Standard');
  assert.equal(captured[0].provider,'deepseek');
  assert.equal(captured[0].reasoning_mode,'Deep');
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  const typography=await page.evaluate(()=>Object.fromEntries(['master-question','assistant-question'].map(id=>{
    const s=getComputedStyle(document.getElementById(id)); return [id,{family:s.fontFamily,size:s.fontSize,line:s.lineHeight}];
  })));
  assert.deepEqual(typography['master-question'],typography['assistant-question']);
  assert.equal(typography['master-question'].size,'15px');
  await page.locator('#master-more').click();
  const positions=await page.evaluate(()=>{
    const menu=document.querySelector('.master-actions-popover').getBoundingClientRect();
    return {onscreen:menu.top>=0&&menu.bottom<=innerHeight&&menu.right<=innerWidth};
  });
  assert.deepEqual(positions,{onscreen:true});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/master-composer-polish.png'});
  await page.keyboard.press('Escape');
  await page.locator('.dock-tabs button').first().click();
  await page.locator('.dock-tabs button').nth(1).click();
  assert.equal(await page.locator('#master-mode').inputValue(),'Standard');
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  assert.deepEqual(errors,[]);
  const question=page.locator('#master-question');
  await question.focus();
  await question.evaluate(el=>{el.setSelectionRange(2,7);el.__masterMorphIdentity='same-composer';});
  const topicBeforeMorph=await page.locator('#master-topic-list [aria-current="true"]').getAttribute('data-topic-id');
  await page.screenshot({path:'test-results/master-morph-before.png'});
  const expandStarted=Date.now();
  await page.locator('#master-expand').click();
  await page.waitForFunction(()=>document.querySelector('#reader').dataset.masterMorphPhase==='expanding');
  await page.waitForFunction(()=>!document.querySelector('#reader').dataset.masterMorphPhase);
  const expandElapsed=Date.now()-expandStarted;
  assert.ok(expandElapsed>=180&&expandElapsed<700,`Master expand morph took ${expandElapsed}ms`);
  assert.equal(await question.evaluate(el=>el.__masterMorphIdentity),'same-composer');
  assert.equal(await question.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await question.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,7]);
  assert.equal(await question.inputValue(),'请解释这个概念');
  assert.equal(await page.locator('#master-topic-list [aria-current="true"]').getAttribute('data-topic-id'),topicBeforeMorph);
  await page.screenshot({path:'test-results/master-morph-after.png'});
  await page.locator('#master-topic-list button').first().waitFor();
  assert.ok(await page.locator('#master-topic-list button').count()>1);
  assert.equal(await page.locator('#master-topic-sidebar > strong').textContent(),'本章对话');
  assert.equal(await page.locator('#master-topic-sidebar').getAttribute('aria-label'),'当前章节 Master 对话');
  assert.equal(await page.locator('#master-topic-sidebar [role="treeitem"]').count(),0);
  const initialTopic=await page.locator('#master-topic-list [aria-current="true"]').getAttribute('data-topic-id');
  const navigationWrites=[];
  const observe=request=>{if(request.method()!=='GET') navigationWrites.push(request.url());};
  page.on('request',observe);
  const otherId=await page.evaluate(async({topics,revision,initial})=>{
    for(const topic of topics.filter(t=>t.id!==initial)) {
      const snapshot=await (await fetch(`/api/revisions/${revision}/learning/${topic.scope_id}`)).json();
      if(snapshot.messages.some(m=>m.topic_id===topic.id && m.role==='assistant' && m.state==='COMPLETE')) return topic.id;
    }
  },{topics:data.learning.topics,revision:data.revision,initial:initialTopic});
  assert.ok(otherId,'A retained answer is required for review and ruler checks');
  let reviewState='TECHNICAL_FAILURE';
  const reviewFixture=async route=>{
    const response=await route.fetch(); const body=await response.json();
    const answer=body.messages?.find(message=>message.topic_id===otherId && message.role==='assistant');
    if(answer) { answer.review_state=reviewState; answer.detail='测试审查暂不可用'; }
    await route.fulfill({response,json:body});
  };
  await page.route('**/learning/*',reviewFixture);
  const otherScope=data.learning.topics.find(topic=>topic.id===otherId).scope_id;
  const snapshotResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith(`/learning/${otherScope}`));
  await page.locator(`#master-topic-list [data-topic-id="${otherId}"]`).click();
  const snapshot=await (await snapshotResponse).json();
  await page.locator(`#master-topic-list [data-topic-id="${otherId}"][aria-current="true"]`).waitFor();
  assert.deepEqual(await page.locator('#master-history .master-message').evaluateAll(items=>items.map(item=>item.dataset.messageId)),snapshot.messages.filter(message=>message.topic_id===otherId).map(message=>message.id));
  assert.equal(await page.getByText('测试审查暂不可用',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'审查详情',exact:true}).count(),0);
  assert.equal(await page.locator('#master-history').getByRole('button',{name:'重试',exact:true}).isVisible(),true);
  const answerActions=page.locator('.master-actions-popover');
  await page.locator('#master-history').getByRole('button',{name:'回答更多操作',exact:true}).first().click();
  assert.equal(await answerActions.getByRole('button',{name:'收入学习记忆',exact:true}).isVisible(),true);
  assert.equal(await page.locator('#master-confirm').isHidden(),true);
  await page.screenshot({path:'test-results/master-answer-more.png'});
  await page.keyboard.press('Escape');
  assert.equal(await answerActions.isHidden(),true);
  await page.unroute('**/learning/*',reviewFixture);
  if(snapshot.topics.find(topic=>topic.id===otherId).state==='RESOLVED') {
    assert.equal(await page.locator('#master-form').isHidden(),true);
    assert.equal(await page.locator('#master-confirm').isHidden(),true);
  }
  await page.screenshot({path:'test-results/master-topics-history.png'});
  await page.locator('#master-expand').click();
  await page.waitForFunction(()=>document.querySelector('#reader').dataset.masterMorphPhase==='restoring');
  await page.waitForFunction(()=>!document.querySelector('#reader').dataset.masterMorphPhase);
  assert.equal(await page.locator('#master-history .assistant-answer-bubble').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#master-workspace').getByRole('button',{name:'仍不清楚',exact:true}).count(),0);
  assert.equal(await page.locator('.master-lifetime').count(),0);
  await page.screenshot({path:'test-results/master-morph-before.png'});
  await page.screenshot({path:'test-results/master-narrow-quiet.png'});
  await page.locator('#master-expand').click();
  await page.waitForFunction(()=>document.querySelector('#reader').dataset.masterMorphPhase==='expanding');
  await page.waitForFunction(()=>!document.querySelector('#reader').dataset.masterMorphPhase);
  await page.screenshot({path:'test-results/master-morph-after.png'});
  const rail=page.locator('#master-workspace .message-rail');
  assert.equal(await rail.locator('button').count(),snapshot.messages.filter(message=>message.topic_id===otherId && message.role==='user').length);
  await rail.locator('button').first().hover();
  await page.locator('#master-history-preview').waitFor({state:'visible'});
  await page.screenshot({path:'test-results/master-message-rail.png',animations:'disabled'});
  await rail.locator('button').first().focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  assert.ok(await page.evaluate(()=>{
    const history=document.querySelector('#master-history');
    const target=[...history.querySelectorAll('.assistant-question-bubble')].at(-1);
    const bounds=history.getBoundingClientRect(), targetBounds=target.getBoundingClientRect();
    return targetBounds.top>=bounds.top && targetBounds.top<bounds.bottom;
  }), 'Message rail must bring the selected question into view');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#master-history-preview').isHidden(),true);
  assert.equal(await page.locator('#master-history .assistant-answer-bubble').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#master-question').evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
  const resolvedId=data.learning.topics.find(topic=>topic.state==='RESOLVED')?.id;
  assert.ok(resolvedId,'Retained resolved Topic required');
  await page.locator(`#master-topic-list [data-topic-id="${resolvedId}"]`).click();
  await page.locator(`#master-topic-list [data-topic-id="${resolvedId}"][aria-current="true"]`).waitFor();
  assert.equal(await page.locator('#master-form').isHidden(),true);
  assert.equal(await page.locator('#master-confirm').isHidden(),true);
  assert.equal(await page.locator('#master-resume-topic').isVisible(),true);
  await page.locator(`#master-topic-list [data-topic-id="${initialTopic}"]`).click();
  await page.locator(`#master-topic-list [data-topic-id="${initialTopic}"][aria-current="true"]`).waitFor();
  page.off('request',observe); assert.deepEqual(navigationWrites,[]);
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  if(await page.locator('#master-resume-topic').isVisible()) await page.locator('#master-resume-topic').click();
  await page.screenshot({path:'test-results/master-topics-workspace.png'});
  // Exercise relocated actions at the HTTP boundary without changing retained user data.
  const confirmations=[];
  await page.route('**/learning/*/confirm',async route=>{
    confirmations.push(route.request().postDataJSON());
    await route.fulfill({status:503,json:{error:'测试确认暂不可用'}});
  });
  await page.locator('#master-more').click();
  await page.locator('#master-confirm').click();
  await page.waitForFunction(()=>document.querySelector('#master-status').textContent.includes('测试确认暂不可用'));
  assert.equal(confirmations[0].topic_id,initialTopic);
  await page.keyboard.press('Escape');
  for(const state of ['FAIL','PASS']) {
    reviewState=state;
    await page.route('**/learning/*',reviewFixture);
    await page.locator(`#master-topic-list [data-topic-id="${otherId}"]`).click();
    await page.locator(`#master-topic-list [data-topic-id="${otherId}"][aria-current="true"]`).waitFor();
    const answer=snapshot.messages.find(m=>m.topic_id===otherId && m.role==='assistant');
    const row=page.locator(`#master-history [data-message-id="${answer.id}"]`);
    const actions=row.locator('.master-answer-actions');
    assert.equal(await actions.innerText(),state==='PASS'?'…':'内容审查未通过 ·\n重试\n…');
    assert.equal(await row.getByText('测试审查暂不可用',{exact:true}).count(),0);
    if(state==='PASS') {
      const collected=[];
      await page.route('**/revisions/*/memory',async route=>{
        collected.push(route.request().postDataJSON());
        await route.fulfill({status:503,json:{error:'测试收录暂不可用'}});
      });
      await row.getByRole('button',{name:'回答更多操作'}).click();
      await answerActions.getByRole('button',{name:'收入学习记忆',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('.master-actions-popover .memory-source-control').disabled);
      assert.deepEqual(collected,[{source_kind:'MASTER',source_id:answer.id}]);
      await page.keyboard.press('Escape');
    }
    await page.unroute('**/learning/*',reviewFixture);
    await page.locator(`#master-topic-list [data-topic-id="${initialTopic}"]`).click();
    await page.locator(`#master-topic-list [data-topic-id="${initialTopic}"][aria-current="true"]`).waitFor();
  }
  // Layout-only long-content fixture; never persisted or sent to a provider.
  await page.locator('#master-history').evaluate(history => {
    const message=document.createElement('article'); message.className='master-message';
    for(let i=0;i<60;i++) { const p=document.createElement('p'); p.textContent=`滚动布局验证 ${i+1}：长内容应在工作区右侧滚动，正文保持居中。`; message.append(p); }
    history.append(message); history.scrollTop=80;
  });
  const dockWidth=await page.locator('#assistant-resize-handle').getAttribute('aria-valuenow').then(Number);
  assert.equal(await page.locator('#reader').evaluate(el=>el.classList.contains('assistant-expanded')),true);
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#master-history').evaluate(el=>Math.round(el.getBoundingClientRect().right)),1440);
  assert.ok(await page.locator('#master-history').evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.locator('#master-history').hover(); await page.mouse.wheel(0,500);
  await page.waitForFunction(()=>document.querySelector('#master-history').scrollTop>80);
  await page.screenshot({path:'test-results/master-expanded-edge-scroll.png'});
  await page.locator('.dock-tabs button').first().click();
  assert.equal(await page.locator('#assistant-expand').getAttribute('aria-pressed'),'true');
  await page.locator('.dock-tabs button').nth(1).click();
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  const continuityBeforeRestore=await page.evaluate(()=>{
    const history=document.querySelector('#master-history');
    const sidebar=document.querySelector('#master-topic-sidebar');
    const question=document.querySelector('#master-question');
    sidebar.scrollTop=Math.min(48,sidebar.scrollHeight-sidebar.clientHeight);
    question.focus({preventScroll:true}); question.setSelectionRange(3,8);
    return {history:history.scrollTop,sidebar:sidebar.scrollTop,topic:document.querySelector('#master-topic-list [aria-current="true"]')?.dataset.topicId};
  });
  await page.locator('#master-expand').click();
  await page.waitForFunction(()=>document.querySelector('#reader').dataset.masterMorphPhase==='restoring');
  await page.waitForFunction(()=>!document.querySelector('#reader').dataset.masterMorphPhase);
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#assistant-panel').evaluate(el=>el.getBoundingClientRect().width),dockWidth);
  assert.equal(await page.locator('#master-question').inputValue(),'请解释这个概念');
  assert.equal(await question.evaluate(el=>el.__masterMorphIdentity),'same-composer');
  assert.equal(await question.evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(await question.evaluate(el=>[el.selectionStart,el.selectionEnd]),[3,7]);
  assert.ok(Math.abs(await page.locator('#master-history').evaluate(el=>el.scrollTop)-continuityBeforeRestore.history)<=1);
  assert.equal(await page.locator('#master-topic-list [aria-current="true"]').getAttribute('data-topic-id'),continuityBeforeRestore.topic);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#master-expand').click();
  assert.equal(await page.locator('#reader').getAttribute('data-master-morph-phase'),null);
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'true');
  assert.ok(Math.abs(await page.locator('#master-topic-sidebar').evaluate(el=>el.scrollTop)-continuityBeforeRestore.sidebar)<=1);
  await page.locator('#master-expand').click();
  assert.equal(await page.locator('#reader').getAttribute('data-master-morph-phase'),null);
  assert.equal(await page.locator('#master-expand').getAttribute('aria-pressed'),'false');
  console.log(JSON.stringify({status:'PASS',typography,reviewModes:'Fast/Standard/Deep',sendMode:'Standard',failureDraftPreserved:true,masterMorph:{expandElapsed,workspace:220,sidebarDelay:96,sidebarReveal:124,restoreWorkspaceDelay:36,restoreWorkspace:184},externalProviderCalls:0}));
} finally {
  if(browser) await browser.close();
  service.kill(); await new Promise(resolve=>service.exitCode!==null?resolve():service.once('exit',resolve));
  await rm(temporary,{recursive:true,force:true});
}
