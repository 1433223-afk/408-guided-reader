// Full-reader reuse smoke with original textbook/OCR/published learning assets.
// All writes belong to a disposable snapshot. No OCR, model or matching worker
// is allowed. Desktop Chrome touch emulation is not physical Android evidence.
// Run only after the Tablet presentation changes are ready:
//   node tests-e2e/tablet-full-reader.mjs
// Optional READER_FULL_SOURCE, READER_FULL_BOOK, READER_TEST_LAN,
// READER_CHROMIUM, READER_PYTHON. Outputs are ignored under test-results/.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const privateAddress = value => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
const candidates = Object.entries(os.networkInterfaces()).flatMap(([name, values]) =>
  (values || []).map(value => ({name, ...value}))).filter(value => value.family === 'IPv4' && !value.internal && privateAddress(value.address));
const address = process.env.READER_TEST_LAN || candidates.find(value => /wlan|wi-?fi/i.test(value.name))?.address || candidates[0]?.address;
assert.ok(address && privateAddress(address), 'Set READER_TEST_LAN to an assigned RFC1918 IPv4');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-full-'));
const artifacts = path.resolve('test-results/tablet-full-reader');
await mkdir(artifacts, {recursive: true});
const token = randomBytes(32).toString('hex');
const redact = value => String(value).replaceAll(token, '[credential]');
const python = String.raw`
import json,os,re
from pathlib import Path
from urllib.parse import urlparse
from reader_service.annotation import AnnotationRepository,AnnotationService
from reader_service.assistant import AssistantContextBuilder,AssistantService
from reader_service.foundation import FoundationRepository,FoundationService,PageLabelRepository,PageLabelService
from reader_service.jobs import JobRepository
from reader_service.knowledge import KnowledgeRepository,KnowledgeService
from reader_service.learning.service import LearningService
from reader_service.library import LibraryService
from reader_service.outline import OutlineRepository,OutlineService
from reader_service.practice_knowledge import PracticeKnowledgeService
from reader_service.practice_prototype import PracticePrototype
from reader_service.server import ReaderServer,handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_demo import prepare_demo,list_source_books
from reader_service.teaching.service import TeachingService

source=Path(os.environ.get('READER_FULL_SOURCE',str(Path(os.environ['LOCALAPPDATA'])/'408GuidedReaderAndroidTabletDemo')))
books=list_source_books(source)
book_id=os.environ.get('READER_FULL_BOOK') or next(b['id'] for b in books if b['page_count']==348)
destination=Path(os.environ['READER_FULL_ROOT'])/'snapshot'
prepare_demo(source,destination,[book_id])
library=LibraryService(ManagedPaths(destination));book=library.list_books()[0];revision=book['active_revision'];rid=revision['id']
checks={'model_calls':0,'blocked_requests':[]}
def blocked(*args,**kwargs):
    checks['model_calls']+=1
    raise AssertionError('This smoke must never invoke a model')
class NoModelRuntime:
    active_provider='deepseek'
    def configured_providers(self):return ('deepseek','zhipu')
    def preferred_provider(self):return 'deepseek'
    def reviewer_provider(self,*args):return 'zhipu'
    def supports_images(self,*args,**kwargs):return True
    def status(self):
        # Expose only the capability status needed to open the draft UI. This
        # is a test stub, not evidence of credentials or successful providers;
        # no model client exists and every completion method hard-fails.
        providers=[{'provider':name,'model':model,'configured':True,'configuration_valid':True,
          'credential_available':True,'supports_images':True,'ai_off_reason':None,
          'failure_state':None,'cooling':False} for name,model in [('deepseek','deepseek-v4-pro'),('zhipu','glm-5.3')]]
        return {**providers[0],'active_provider':'deepseek','providers':providers,'bakeoff_enabled':False}
    def __getattr__(self,name):
        if name.startswith(('complete','stream','compare')):return blocked
        raise AttributeError(name)
runtime=NoModelRuntime()
def no_ocr():raise AssertionError('This smoke must use already prepared OCR')
foundation=FoundationService(library,FoundationRepository(library.database),no_ocr)
labels=PageLabelService(library,PageLabelRepository(library.database))
outline=OutlineService(library,OutlineRepository(library.database),labels);outline.bootstrap=outline.stored_snapshot
annotations=AnnotationService(foundation,AnnotationRepository(library.database))
learning=LearningService(library.database,foundation,runtime)
knowledge=KnowledgeService(library,foundation,outline,KnowledgeRepository(library.database),runtime,
    generator_provider='deepseek',reviewer_provider='zhipu')
teaching=TeachingService(library.database,runtime)
assistant=AssistantService(AssistantContextBuilder(foundation,outline),runtime)
class CachedPreparation:
    def __init__(self):self.foundation=foundation;self.jobs=JobRepository(library.database)
    def schedule_revision(self,*args,**kwargs):return None
# The browser may request existing Practice/KP links. Read the copied snapshot;
# do not queue the normal matching thread even though its runtime is disabled.
PracticeKnowledgeService.request=lambda self,revision,payload:self.snapshot(revision,payload['section_id'])
with library.database.connect() as c:
    assert c.execute("SELECT COUNT(*) FROM ocr_pages WHERE book_source_revision_id=? AND status='READY'",(rid,)).fetchone()[0]==revision['page_count']
    assert c.execute('SELECT COUNT(*) FROM outline_nodes WHERE book_source_revision_id=?',(rid,)).fetchone()[0]>0
    sections=[dict(row) for row in c.execute('''SELECT n.* FROM outline_nodes n JOIN section_guides g
      ON g.section_node_id=n.outline_node_id AND g.book_source_revision_id=n.book_source_revision_id
      JOIN section_inline_teaching i ON i.section_node_id=n.outline_node_id AND i.book_source_revision_id=n.book_source_revision_id
      WHERE n.book_source_revision_id=? AND n.resolution_state='RESOLVED' ORDER BY n.start_page,n.start_y''',(rid,))]
    # Curation and favorites are reset only inside this newly created snapshot.
    c.execute('DELETE FROM learning_memory')
    c.execute('UPDATE practice_prototype_state SET favorite=0 WHERE book_source_revision_id=?',(rid,))
chosen=None
for section in sections:
    guide=teaching.snapshot(rid,section['outline_node_id']);inline=teaching.inline.snapshot(rid,section['outline_node_id'])
    if guide['published'] and inline['published']:
        targets=[{'item_id':item['id'],**inline['published']['sources'][item['target_id']]}
          for item in inline['published']['content']['items']
          if inline['published']['sources'].get(item['target_id'],{}).get('available')]
        if targets:chosen={'section':section,'guide_id':guide['published']['id'],'inline_id':inline['published']['id'],'inline_targets':targets};break
assert chosen,'Select a source with current published Guide and Inline anchors'
entries=learning.repository.entries(rid)
point=None;message=None
for candidate in entries['points']:
    if not candidate.get('thread_id'):continue
    view=learning.snapshot(rid,candidate['knowledge_point_id'])
    complete=[m for m in view['messages'] if m['role']=='assistant' and m['state']=='COMPLETE']
    if complete:point=candidate;message=complete[0];break
assert point and message,'A genuine completed durable Master answer is required'
practice=PracticePrototype(library.database);catalog=practice.catalog(rid)
assert catalog and catalog[0]['questions'],'Prepared official-answer Practice fixture required'
exercise=catalog[0];question=exercise['questions'][0]
practice.set_position(rid,exercise['id'],question['number'])
library.save_position(rid,19,.2,1)
fixture={'book_id':book['id'],'revision_id':rid,'page_count':revision['page_count'],**chosen,
  'master_point':point,'master_message_id':message['id'],
  'practice':{'section_id':exercise['id'],'title':exercise['title'],'entry_page':exercise['entryPage'],
    'entry_top':exercise['entryTop'],'question':question}}
base=handler_factory(library,os.environ['READER_FULL_TOKEN'],tablet_lan=True,preparation=CachedPreparation(),
  outline=outline,annotations=annotations,learning=learning,knowledge=knowledge,teaching=teaching,assistant=assistant)
class Handler(base):
    def do_GET(self):
        if urlparse(self.path).path=='/__full-reader_checks':
            if self._authorized():self._json(200,checks)
            return
        super().do_GET()
    def do_POST(self):
        route=urlparse(self.path).path
        generated=(re.search(r'/(guide|inline-teaching)/(generate|regenerate|retry)$',route)
          or re.search(r'/knowledge-map/(prepare|regenerate)$',route)
          or re.search(r'/learning/[^/]+/(send|retry|review)$',route)
          or re.search(r'/assistant/(ask|follow-up|child|retry-child|bake-off|save)$',route)
          or re.search(r'/practice-prototype/(hint|review)(/|$)',route))
        if generated:
            checks['blocked_requests'].append(route)
            self._json(503,{'error':'Model generation is prohibited in this smoke'});return
        super().do_POST()
server=ReaderServer((os.environ['READER_FULL_LAN'],0),Handler)
print('FULL_READER '+json.dumps({'port':server.server_port,**fixture},ensure_ascii=False),flush=True)
server.serve_forever()
`;
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, PYTHONPATH: path.join(process.cwd(), 'src'), PYTHONIOENCODING: 'utf-8',
    GUIDED_READER_DEEPSEEK_DISABLED: '1', GUIDED_READER_ZHIPU_DISABLED: '1', GUIDED_READER_OPENROUTER_DISABLED: '1',
    GUIDED_READER_MASTER_PROVIDER: 'deepseek', GUIDED_READER_GUIDE_PROVIDER: 'deepseek', GUIDED_READER_SYSTEM_PROVIDER: 'deepseek',
    GUIDED_READER_REVIEW_PROVIDER: 'zhipu', READER_FULL_ROOT: temporary, READER_FULL_LAN: address, READER_FULL_TOKEN: token},
});
let output = '', serviceErrors = '', browser, page;
core.stdout.on('data', value => {output += value.toString();});
core.stderr.on('data', value => {serviceErrors += value.toString();});
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Full Reader snapshot did not start: ' + redact(serviceErrors))), 90000);
  const check = () => {const match = output.match(/^FULL_READER (.+)$/m); if (match) {clearTimeout(timeout); resolve(JSON.parse(match[1]));}};
  core.stdout.on('data', check);
  core.once('error', error => {clearTimeout(timeout); reject(error);});
  core.once('exit', code => {clearTimeout(timeout); reject(new Error(`Temporary Core exited (${code}): ${redact(serviceErrors)}`));});
});
const results = [], pageErrors = [], writes = [], practiceLoads=[];
const trackedPractice=new Map();let practiceSequence=0;
let fixture;
try {
  fixture = await ready;
  browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context = await browser.newContext({viewport: {width:1200,height:800}, screen: {width:1200,height:800},
    deviceScaleFactor:1.5, isMobile:true, hasTouch:true});
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {if (!['GET','HEAD'].includes(request.method())) writes.push({method:request.method(),path:new URL(request.url()).pathname});});
  page.on('request',request=>{
    const url=new URL(request.url());
    if(request.method()==='GET'&&/\/practice-prototype(?:\/catalog)?$/.test(url.pathname)) {
      const id=++practiceSequence;trackedPractice.set(request,id);
      practiceLoads.push({event:'request',id,path:url.pathname,time:Date.now()});
    }
  });
  page.on('response',response=>{
    const id=trackedPractice.get(response.request());
    if(id)practiceLoads.push({event:'response',id,status:response.status(),time:Date.now()});
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {type,
    touchPoints:points.map(([x,y,id=1]) => ({x,y,id,radiusX:2,radiusY:2,force:1}))});
  const json = endpoint => page.evaluate(async endpoint => {
    const response = await fetch(endpoint); if (!response.ok) throw new Error(`${endpoint}: ${response.status}`); return response.json();
  }, endpoint);
  async function shot(name) {
    if(await page.locator('#reader').isVisible()) {
      await page.waitForFunction(()=>{
        const index=Number(document.getElementById('page-number').value)-1;
        const wrapper=document.querySelector(`.page[data-index="${index}"]`);
        return wrapper?.querySelector('canvas')&&!wrapper.classList.contains('loading');
      });
    }
    await page.screenshot({path:path.join(artifacts,name+'.png')});console.log('Captured '+name);
  }
  async function tool(selector) {
    if (!await page.locator(selector).isVisible()) await page.locator('#reader-more-toggle').tap();
    await page.locator(selector).tap();
    if (await page.locator('#reader-more').evaluate(node => node.classList.contains('open'))) await page.locator('#reader-more-toggle').tap();
  }
  async function go(index, y = .15) {
    await page.locator('#page-number').fill(String(index+1)); await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${index}"] .text-overlay`).waitFor({timeout:45000});
    // A real reader tap releases the app's page-navigation pin before this
    // setup scroll. Otherwise the app correctly restores the page-number Y=0.
    await page.locator('#viewer').tap({position:{x:50,y:30}});
    await page.locator(`.page[data-index="${index}"]`).evaluate((node,y) => {
      const viewer=document.getElementById('viewer'); viewer.scrollTop=node.offsetTop+node.offsetHeight*y;
    }, y);
    await page.waitForTimeout(200);
    await page.waitForFunction(index => document.querySelector(`.page[data-index="${index}"] canvas`)
      && !document.querySelector(`.page[data-index="${index}"]`).classList.contains('loading'), index);
  }
  async function closeAI() {
    if (await page.locator('#assistant-panel').isHidden()) return;
    const close=page.locator('.dock-tabs').getByRole('button',{name:'收起',exact:true});
    if (await close.isVisible()) await close.tap(); else await page.locator('#assistant-close').tap();
  }
  async function holdText(index) {
    const candidate=await page.evaluate(async ({rid,index}) => {
      const data=(await (await fetch(`/api/revisions/${rid}/overlay?page=${index}`)).json()).page;
      const overlay=document.querySelector(`.page[data-index="${index}"] .text-overlay`).getBoundingClientRect();
      const view=document.getElementById('viewer').getBoundingClientRect();
      for (const line of data.lines) {
        if(line.cells.length<8)continue;
        const y=overlay.top+line.quad.reduce((sum,point)=>sum+point[1],0)/4*overlay.height;
        const cell=line.cells[4],x=overlay.left+(cell[0]+cell[1])/2*overlay.width;
        if(x>Math.max(view.left+20,0)&&x<Math.min(view.right-20,innerWidth)&&y>view.top+60&&y<view.bottom-100)return{x,y};
      }
      return null;
    }, {rid:fixture.revision_id,index});
    assert.ok(candidate,'A genuine visible OCR cell is required');
    await touch('touchStart',[[candidate.x,candidate.y]]);await page.waitForTimeout(550);await touch('touchEnd',[]);
    await page.locator('#selection-actions').waitFor({state:'visible'});
  }
  async function openMemory(mode='body') {
    await page.locator('#back-to-library').tap();
    await page.locator('#library-home .space-navigation').getByRole('button',{name:'学习记忆',exact:true}).tap();
    await page.locator(`.memory-book-open[data-book-id="${fixture.book_id}"]`).tap();
    if (mode==='practice') {
      await page.locator('#memory-book-view [data-memory-mode="practice"]').tap();
      await page.locator(`.memory-book-open[data-book-id="${fixture.book_id}"]`).tap();
    }
    await page.locator('.memory-item-open').first().tap();
    await page.waitForFunction(() => document.getElementById('memory-detail').getAttribute('aria-busy')==='false');
  }
  await page.goto(`http://${address}:${fixture.port}/?tablet=1&token=${token}`);
  await page.locator(`.book-card .book-open`).first().tap();
  await page.locator('.overview-book-heading .primary-action').tap();
  await go(19,.2);
  assert.equal(await page.evaluate(() => isSecureContext),false);

  // Reader KP and already-published chapter structure are the original owner.
  const section=fixture.section;
  await go(section.start_page,Math.min(.9,section.start_y+.025));
  await page.waitForFunction(() => !document.getElementById('reader-kp-action').hidden && /知识点/.test(document.getElementById('reader-kp-action').textContent));
  await tool('#reader-kp-action');
  await page.locator('#reader-kp-list .reader-kp-row').first().waitFor({state:'visible'});
  await shot('landscape-kp');
  await page.locator('#reader-kp-list').getByRole('button',{name:'关闭',exact:true}).tap();
  results.push('Existing published KP list');

  // Guide and Inline use real published, reviewed assets from the same section.
  const guideEntry=page.locator(`.page[data-index="${section.start_page}"] .section-guide-entry[data-section-id="${section.outline_node_id}"]`);
  await guideEntry.tap();
  await page.locator('#guide-content .guide-text').first().waitFor({state:'visible'});
  assert.ok((await page.locator('#guide-content').innerText()).trim().length>30);
  await shot('landscape-guide');
  await page.locator('#guide-close').tap();
  await go(Math.min(section.end_page,section.start_page+1),.05);
  await page.waitForFunction(() => !document.getElementById('inline-open').disabled);
  await tool('#inline-open');
  let inlineOpened=false;
  for(const target of fixture.inline_targets.slice(0,8)) {
    const ys=target.quad.map(point=>point[1]);
    await go(target.pdf_page_index,Math.max(0,Math.min(.8,Math.min(...ys)-.15)));
    const marker=page.locator(`.page[data-index="${target.pdf_page_index}"] .inline-marker[data-item-id="${target.item_id}"]`);
    if(await marker.count()) {await marker.tap();inlineOpened=true;break;}
  }
  assert.equal(inlineOpened,true,'At least one real Inline source must have a visible marker');
  await page.locator('#inline-content .inline-text').first().waitFor({state:'visible'});
  await shot('landscape-inline');
  await page.locator('#inline-close').tap();
  results.push('Published Guide and Inline, without generating');

  // Finger selection opens the existing Assistant draft; no send is pressed.
  await go(19,.2);await holdText(19);await page.locator('#ask-selection').tap();
  await page.locator('#assistant-first-turn').waitFor({state:'visible'});
  assert.ok((await page.locator('#assistant-draft-text').innerText()).trim());
  await shot('landscape-assistant-draft');await closeAI();
  await go(19,.2);await holdText(19);await page.locator('#add-note').tap();
  const note='Tablet full-reader isolated note '+Date.now();
  await page.locator('#annotation-note').fill(note);
  const saved=page.waitForResponse(response => response.request().method()==='POST' && /\/annotations$/.test(new URL(response.url()).pathname));
  await page.locator('#save-note').tap();
  const savedBody=await (await saved).json();assert.equal(savedBody.annotation.body,note);
  await tool('#marks-toggle');await page.locator('#marks-list').getByText(note,{exact:true}).waitFor();
  await shot('landscape-note');await page.locator('#marks-close').tap();
  results.push('Touch Assistant draft and durable Note');

  // Open an authentic durable Master thread and curate its existing answer.
  const point=fixture.master_point;
  await go(point.display_end_page,Math.max(0,Math.min(.8,point.display_end_y-.3)));
  await page.waitForLoadState('networkidle');
  const marker=page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`).filter({hasText:point.title}).first();
  await marker.locator('summary').tap();
  await marker.getByRole('button',{name:'继续 Master 对话',exact:true}).first().tap();
  const masterMessage=page.locator(`#master-history [data-message-id="${fixture.master_message_id}"]`);
  await masterMessage.waitFor({state:'visible'});
  await masterMessage.getByRole('button',{name:'回答更多操作',exact:true}).tap();
  await page.locator('.master-actions-popover').getByRole('button',{name:'收入学习记忆',exact:true}).tap();
  await page.locator('.master-actions-popover').getByRole('button',{name:'已收入学习记忆',exact:true}).waitFor();
  await page.locator('#master-title').tap();
  await shot('landscape-master');await closeAI();
  await openMemory();
  const curated=(await json('/api/memory')).items.find(item=>item.source_id===fixture.master_message_id);
  assert.ok(curated,'The original Master answer must be durably curated');
  assert.equal(await page.locator('#memory-detail').getAttribute('data-detail-id'),curated.id);
  assert.ok((await page.locator('#memory-detail').innerText()).includes('Master'));
  await shot('landscape-memory');
  await page.locator('#memory-detail').getByRole('button',{name:'返回来源',exact:true}).tap();
  await page.locator(`#master-history [data-message-id="${fixture.master_message_id}"]`).waitFor({state:'visible'});
  await closeAI();
  results.push('Existing Master conversation, Memory curation and source navigation');

  await go(19,.2);await page.locator('#viewer').focus();
  const before=await page.locator('#page-number').inputValue();
  await page.setViewportSize({width:800,height:1200});
  await page.waitForFunction(() => document.getElementById('reader').classList.contains('portrait-mode'));
  await page.waitForFunction(before=>document.getElementById('page-number').value===before,before);
  assert.equal(await page.locator('#page-number').inputValue(),before);
  await shot('portrait-reading');

  // Original Practice solves on the paper, judges from its stored official
  // answer, and uses the existing favorite-backed learning record.
  const exercise=fixture.practice,q=exercise.question;
  const records=await json(`/api/revisions/${fixture.revision_id}/practice-prototype`);
  const attempts=records.questions.find(value=>value.number===q.number)?.attempt_count||0;
  await go(exercise.entry_page,Math.max(0,exercise.entry_top-.15));
  await page.locator(`.page[data-index="${exercise.entry_page}"] .practice-entry`).first().tap();
  await page.locator('#practice-panel').waitFor({state:'visible'});
  const choice=page.locator(`.page[data-index="${q.page}"] .practice-choice-area[data-choice="${q.answer}"]`).first();
  const other=page.locator(`.page[data-index="${q.page}"] .practice-choice-area:not([data-choice="${q.answer}"])`).first();
  async function choicePoint(marker) {
    await marker.scrollIntoViewIfNeeded();
    const box=await marker.boundingBox();assert.ok(box);
    return {x:box.x+box.width/2,y:box.y+box.height/2};
  }
  // These paper overlays intentionally ignore pointer events; actual touch or
  // pen coordinates must land on the existing OCR overlay beneath them.
  let target=await choicePoint(other);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',buttons:1,clickCount:1,pointerType:'pen',force:.6});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  assert.equal(await other.evaluate(node=>node.classList.contains('selected')),true,'Pen tap selects a Practice choice');
  assert.equal(await page.locator('#selection-actions').isVisible(),false,'Pen Practice tap must not select body text');
  target=await choicePoint(choice);await page.touchscreen.tap(target.x,target.y);
  assert.equal(await choice.evaluate(node=>node.classList.contains('selected')),true,'Finger tap selects the official choice');
  target=await choicePoint(choice);
  await touch('touchStart',[[target.x,target.y]]);
  for(let step=1;step<=6;step++) {await touch('touchMove',[[target.x,target.y-80*step/6]]);await page.waitForTimeout(20);}
  await touch('touchEnd',[]);await page.waitForTimeout(300);
  const afterScroll=await json(`/api/revisions/${fixture.revision_id}/practice-prototype`);
  assert.equal(afterScroll.questions.find(value=>value.number===q.number)?.attempt_count||0,attempts,'Finger scrolling across a selected option must not submit');
  const attempt=page.waitForResponse(response=>/\/practice-prototype\/attempt$/.test(new URL(response.url()).pathname));
  target=await choicePoint(choice);await page.touchscreen.tap(target.x,target.y);
  const result=await (await attempt).json();
  assert.equal(result.question.last_correct,true);assert.equal(result.question.attempt_count,attempts+1);
  await page.locator('#practice-favorite').tap();
  await page.waitForFunction(() => document.getElementById('practice-favorite').getAttribute('aria-pressed')==='true');
  await shot('portrait-practice');await page.locator('#practice-close').tap();
  await openMemory('practice');
  assert.ok((await page.locator('#memory-detail').innerText()).includes('原题'));
  await shot('portrait-practice-memory');
  await page.locator('#memory-detail').getByRole('button',{name:'回到原题',exact:true}).tap();
  await page.locator('#practice-panel').waitFor({state:'visible'});
  await page.locator('#practice-close').tap();
  results.push('Pen and finger Practice selection, scroll guard, repeat-tap official judgment, favorite and learning-record navigation');

  // Finger Visual Region confirms a real server crop, then stops at the draft.
  await go(19,.2);await tool('#visual-select-toggle');
  await page.evaluate(()=>{
    window.__fullRegionEvents=[];
    for(const type of ['pointerdown','pointerup','pointercancel','click','touchstart','touchend']) {
      document.addEventListener(type,event=>{
        const target=event.target;
        if(!target.closest?.('#viewer,#visual-select-hint'))return;
        const button=document.querySelector('[data-region-confirm]'),box=button.getBoundingClientRect();
        const entry={type: event.type,target:target.tagName+'#'+(target.id||target.className),
          confirm:Boolean(target.closest('[data-region-confirm]')),trusted:event.isTrusted,
          pointer:event.pointerType,pointer_id:event.pointerId,
          touches:event.touches&&Array.from(event.touches,touch=>touch.identifier),
          changed_touches:event.changedTouches&&Array.from(event.changedTouches,touch=>touch.identifier),
          disabled:button.disabled,button_rect:[box.x,box.y,box.width,box.height],
          center_target:document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)?.outerHTML.slice(0,180),
          captured:document.getElementById('viewer').hasPointerCapture(event.pointerId||1),
          prevented:event.defaultPrevented,loading:document.querySelector('.page[data-index="19"]')?.classList.contains('loading')};
        window.__fullRegionEvents.push(entry);
        setTimeout(()=>{entry.prevented_after=event.defaultPrevented;entry.target_connected=target.isConnected;},0);
      },true);
    }
  });
  const region=await page.locator('.page[data-index="19"] canvas').evaluate(canvas=>{
    const box=canvas.getBoundingClientRect(),view=document.getElementById('viewer').getBoundingClientRect();
    const left=Math.max(box.left+box.width*.2,view.left+30),top=Math.max(box.top+box.height*.2,view.top+70);
    return {x:left,y:top,right:Math.min(left+150,box.right-30,view.right-30),bottom:Math.min(top+120,box.bottom-30,view.bottom-70)};
  });
  assert.ok(region.right>region.x+20&&region.bottom>region.y+20);
  await touch('touchStart',[[region.x,region.y]]);
  for(let step=1;step<=5;step++) {await touch('touchMove',[[region.x+(region.right-region.x)*step/5,region.y+(region.bottom-region.y)*step/5]]);await page.waitForTimeout(25);}
  await touch('touchEnd',[]);
  await page.locator('[data-region-confirm]').tap();
  await page.locator('#assistant-region-question-label').waitFor({state:'visible'});
  await page.waitForFunction(() => document.getElementById('assistant-region-image').naturalWidth>0
    && !document.querySelector('#assistant-first-turn').textContent.includes('正在准备'));
  assert.equal(await page.locator('.visual-region-outline').count(),0);
  assert.equal(writes.filter(request=>request.method==='POST'&&/\/visual-region$/.test(request.path)).length,1,
    'The immediate first finger confirmation must prepare exactly one original-PDF crop');
  await shot('portrait-visual-draft');await closeAI();
  results.push('Finger Visual Region and original-PDF crop draft, no AI send');

  await tool('#search-toggle');await page.locator('#search-query').fill('计算机');
  await page.locator('#search-query').press('Enter');
  await page.locator('#search-results .search-result').first().waitFor({state:'visible'});
  await page.locator('#search-results .search-result').first().tap();
  if(await page.locator('#search-close').isVisible())await page.locator('#search-close').tap();
  if(!await page.locator('#zoom-value').isVisible())await page.locator('#reader-more-toggle').tap();
  await page.locator('#zoom-value').fill('120%');await page.locator('#zoom-value').press('Enter');
  await page.locator('#viewer').focus();
  assert.equal(await page.locator('#zoom-value').inputValue(),'120%');
  await page.locator('#outline-toggle').tap();
  await page.locator('#outline-tree .outline-target').first().waitFor({state:'visible'});
  await shot('portrait-directory');await page.locator('#outline-close').tap();
  results.push('Search, zoom, portrait rotation and Directory');

  // The same temporary Core also serves the unchanged default Desktop route.
  // Its manual portrait preference must stay independent of Tablet auto mode.
  const desktopContext=await browser.newContext({viewport:{width:1200,height:800}});
  const desktop=await desktopContext.newPage();
  desktop.on('pageerror',error=>pageErrors.push('Desktop: '+error.message));
  await desktop.goto(`http://${address}:${fixture.port}/?token=${token}`);
  await desktop.locator('.book-card .book-open').first().click();
  await desktop.locator('.overview-book-heading .primary-action').click();
  async function desktopRendered() {
    await desktop.waitForFunction(()=>{
      const index=Number(document.getElementById('page-number').value)-1;
      const wrapper=document.querySelector(`.page[data-index="${index}"]`);
      return wrapper?.querySelector('canvas')&&!wrapper.classList.contains('loading');
    },null,{timeout:45000});
  }
  await desktopRendered();
  assert.equal(await desktop.locator('html').evaluate(node=>node.classList.contains('tablet')),false);
  assert.equal(await desktop.locator('#reader').evaluate(node=>node.classList.contains('portrait-mode')),false);
  await desktop.screenshot({path:path.join(artifacts,'desktop-normal.png')});
  await desktop.locator('#reading-display-toggle').click();
  await desktop.locator('#reading-portrait').check();
  await desktop.waitForFunction(()=>document.getElementById('reader').classList.contains('portrait-mode'));
  await desktop.locator('#viewer').click({position:{x:50,y:30}});
  await desktopRendered();
  await desktop.screenshot({path:path.join(artifacts,'desktop-manual-portrait.png')});
  await desktop.locator('#reading-display-toggle').click();
  await desktop.locator('#reading-portrait').uncheck();
  assert.equal(await desktop.locator('#reader').evaluate(node=>node.classList.contains('portrait-mode')),false);
  await desktopContext.close();
  results.push('Same-Core Desktop normal and manual portrait remain independent of Tablet');

  const checks=await json('/__full-reader_checks');
  assert.equal(checks.model_calls,0);assert.deepEqual(checks.blocked_requests,[]);
  assert.deepEqual(pageErrors,[]);
  const report={passed:true,device:'Desktop Chrome touch emulation; physical Android still needs acceptance',
    browser:browser.version(),
    scope:'Full Reader',
    model_scope:'Draft UI capability status is a stub; actual providers and model replies are not exercised',
    viewports:['1200x800','800x1200'],source:{pages:fixture.page_count,guide_asset:fixture.guide_id,inline_asset:fixture.inline_id},
    results,checks,page_errors:pageErrors,writes,practice_loads:practiceLoads};
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify(report,null,2));
  await rm(path.join(artifacts,'failure.json'),{force:true});
  await rm(path.join(artifacts,'failure.png'),{force:true});
  console.log(JSON.stringify(report,null,2));
} catch(error) {
  if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});
  const ui=page?await page.evaluate(()=>({memory_status:document.getElementById('memory-status')?.textContent,
    status:document.getElementById('status')?.textContent,reader_hidden:document.getElementById('reader')?.hidden,
    practice_hidden:document.getElementById('practice-panel')?.hidden,region_events:window.__fullRegionEvents})).catch(()=>null):null;
  const checks=page?await page.evaluate(async()=>await(await fetch('/__full-reader_checks')).json()).catch(()=>null):null;
  await writeFile(path.join(artifacts,'failure.json'),JSON.stringify({error:redact(error.stack||error),completed:results,ui,checks,page_errors:pageErrors,service_errors:redact(serviceErrors),writes,practice_loads:practiceLoads},null,2));
  throw new Error(redact(error.stack||error));
} finally {
  await browser?.close();core.kill();
  await new Promise(resolve=>{if(core.exitCode!==null)return resolve();core.once('exit',resolve);setTimeout(resolve,5000);});
  assert.equal(path.dirname(temporary),path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('reader-tablet-full-'));
  await rm(temporary,{recursive:true,force:true});
}
