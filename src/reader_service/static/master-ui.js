import { renderAssistantAnswer } from "/assistant-render.js";
import { createComposerChoice, createMessageRail } from "/screens.js";

const STATUS = { UNCONFIRMED: "待确认", NOT_FULLY_CLEAR: "未完全清楚", UNDERSTOOD: "已弄懂", AVAILABLE: "本节待确认", ANSWERED_CLEAR: "本节都清楚了", ANSWERED_HAS_UNCLEAR: "本节还有未完全清楚的地方" };

export function createMasterUI({ api, stream, revision, chapter, pages, dock, openDock, goToPage, announce, memoryControl, toggleExpanded }) {
  document.addEventListener("pointerdown", event => {
    for (const marker of pages.querySelectorAll(".kp-learning-marker[open]")) {
      if (!marker.contains(event.target)) marker.open = false;
    }
  });
  let entries = { points: [], sections: [] };
  let current = null;
  let poll = 0;
  let generation = 0;
  let sendIntent = null;
  let selectedTopicId = null;
  let composingNew = false;
  let canConfirm = false;
  let menuMessageId = null;
  let providerStatuses = [];
  let providerSelectionInitialized = false;
  let answerProvider = 'deepseek';
  let activeStream = null;
  let streamView = null;
  let providerReadinessMessage = '';
  let entriesChapterId = undefined;
  const topicDrafts = new Map();
  const recentReasoning = new Map();
  const tabs = document.createElement("nav");
  tabs.className = "dock-tabs";
  tabs.setAttribute("aria-label", "AI 工作区");
  const assistantTab = button("解释 Assistant", () => select(false));
  const masterTab = button("学习 Master", () => select(true));
  const close = button("收起", () => { actionsPopover.hidePopover(); openDock(false); });
  const expand = button("展开", () => toggleExpanded());
  expand.id = 'master-expand'; expand.setAttribute('aria-pressed', 'false');
  expand.setAttribute('aria-label', '展开 Master 工作区');
  tabs.append(assistantTab, masterTab, expand, close);
  dock.prepend(tabs);
  const panel = document.createElement("section");
  panel.id = "master-workspace";
  panel.hidden = true;
  panel.innerHTML = `<h2 id="master-title">学习 Master</h2>
    <p id="master-status" role="status">从教材知识点打开持久对话。</p>
    <div id="master-history" aria-live="polite"></div>
    <form id="master-form" hidden>
      <label for="master-question" class="sr-only">向 Master 提问</label>
      <textarea id="master-question" maxlength="2000" rows="3" placeholder="这个知识点哪里还没完全懂？"></textarea>
      <div class="master-composer-actions">
        <div class="assistant-model-control">
          <label class="assistant-model"><span class="sr-only">回答模型</span><select id="master-provider" aria-label="回答模型"><option value="deepseek">DeepSeek · deepseek-flash</option><option value="zhipu">智谱 · GLM-5.3-Flash</option><option value="openrouter">OpenRouter · Gemini 3.8 Flash</option></select></label>
          <label class="assistant-model"><span class="sr-only">回答推理</span><select id="master-reasoning" aria-label="回答推理"><option value="Quick" selected>快速</option><option value="Deep">深度</option></select></label>
        </div>
        <button id="master-send" type="submit">发送</button>
      </div>
    </form>
    <button id="master-confirm" type="button" hidden>已弄懂</button>`;
  dock.append(panel);
  const el = (id) => panel.querySelector(`#master-${id}`);
  const conversation = document.createElement('div'); conversation.className='master-conversation';
  conversation.append(...panel.children);
  const sidebar = document.createElement('nav'); sidebar.id='master-topic-sidebar'; sidebar.setAttribute('aria-label','当前章节 Master 对话');
  const topicHeading=document.createElement('strong'); topicHeading.textContent='本章对话';
  const topicList=document.createElement('div'); topicList.id='master-topic-list';
  sidebar.append(topicHeading, topicList); panel.append(sidebar, conversation);
  const resume=button('继续提问', () => {
    selectedTopicId=current?.topics[0]?.id || null;
    composingNew=true; render(); el('question').focus();
  });
  resume.id='master-resume-topic'; resume.hidden=true; el('form').before(resume);
  const topicActions = document.createElement('div'); topicActions.className='master-topic-actions';
  topicActions.append(el('title')); conversation.prepend(topicActions);
  createMessageRail(el('history'));
  const actionsPopover=document.createElement('div'); actionsPopover.className='master-actions-popover';
  actionsPopover.setAttribute('popover','auto'); actionsPopover.setAttribute('role','dialog');
  actionsPopover.setAttribute('aria-label','更多操作');
  const reviewSettings=document.createElement('label'); reviewSettings.className='master-review-setting';
  reviewSettings.innerHTML='<span>回答后审查</span><select id="master-mode" aria-label="回答后审查"><option value="Fast" selected>快速 · 不调用独立审查</option><option value="Standard">标准 · 学术与客观正确性</option><option value="Deep">深入 · 推理与教学有效性</option></select>';
  const memorySlot=document.createElement('div');
  actionsPopover.append(reviewSettings,el('confirm'),memorySlot); panel.append(actionsPopover);
  const composerMore=button('…',()=>showActions(null,composerMore));
  composerMore.id='master-more'; composerMore.setAttribute('aria-label','当前主题更多操作');
  composerMore.setAttribute('aria-haspopup','dialog'); el('send').before(composerMore);
  function showActions(message, trigger) {
    menuMessageId=message?.id || null;
    reviewSettings.hidden=Boolean(message);
    el('confirm').hidden=Boolean(message) || !canConfirm;
    memorySlot.replaceChildren();
    if(message) memorySlot.append(memoryControl(revision(),'MASTER',message.id));
    actionsPopover.showPopover();
    const rect=trigger.getBoundingClientRect();
    actionsPopover.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-actionsPopover.offsetWidth-8))}px`;
    actionsPopover.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-actionsPopover.offsetHeight-8))}px`;
    actionsPopover.querySelector('button:not([hidden])')?.focus();
  }
  const providerChoice=createComposerChoice(el('provider'), {id:'master-provider-choice', label:'回答模型',
    names:{deepseek:'DeepSeek', zhipu:'GLM-5.3', openrouter:'Gemini 3.8'}});
  const reasoningChoice=createComposerChoice(el('reasoning'), {id:'master-reasoning-choice', label:'回答推理',
    names:{Quick:'快速', Deep:'深度'}});
  const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });
  const scopeId = (point) => point.scope_id || point.knowledge_point_id || point.outline_node_id;
  const base = (id = current && scopeId(current.point)) => `/api/revisions/${revision()}/learning/${id}`;

  async function refreshMasterStatus() {
    try {
      const status=await api('/api/learning/status');
      providerStatuses=Array.isArray(status.providers) ? status.providers : [];
      if(!providerSelectionInitialized) {
        answerProvider=status.answer_provider || 'deepseek';
        providerSelectionInitialized=true;
      }
    } catch(_error) {
      providerStatuses=[];
    }
    syncComposer();
  }

  function selectedProviderStatus() {
    return providerStatuses.find(item=>item.provider===answerProvider) || null;
  }

  function providerReady(status) {
    return Boolean(status?.configured
      && status.configuration_valid
      && status.credential_available
      && !status.cooling
      && !status.ai_off_reason
      && status.failure_state==='READY');
  }

  function providerUnavailableMessage(status) {
    if (betaUnavailable(status)) return betaUnavailable(status);
    const label={deepseek:'DeepSeek',zhipu:'智谱 GLM',openrouter:'OpenRouter'}[answerProvider] || '所选模型';
    if(!status) return `${label} 的状态暂不可用；请稍后重试。`;
    if(!status.configuration_valid) return `${label} 的 provider 配置无效；Reader 其余功能不受影响。`;
    if(status.cooling) return `${label} 正在短暂冷却；不会改用其他模型。`;
    if(status.ai_off_reason==='DEVELOPMENT_DISABLED') return `${label} 当前已停用；不会影响其他模型。`;
    if(!status.credential_available) return `${label} 尚未配置可读取的凭据；不会影响其他模型。`;
    return `${label} 当前不可调用；不会自动切换模型。`;
  }

  function syncComposer() {
    for(const option of el('provider').options) {
      const status=providerStatuses.find(item=>item.provider===option.value);
      if(status?.model) option.textContent=`${{deepseek:'DeepSeek',zhipu:'智谱',openrouter:'OpenRouter'}[option.value]} · ${status.model}`;
    }
    el('provider').value=answerProvider;
    const pending=Boolean(current?.messages.some(m=>m.role==='user' && m.state==='PENDING'));
    const unanswered=Boolean(current?.messages.some(
      m=>m.role==='user' && (m.state==='PENDING' || m.state==='FAILED')
    ));
    const busy=Boolean(activeStream) || pending;
    el('provider').disabled=busy;
    el('reasoning').disabled=busy;
    const status=selectedProviderStatus();
    const ready=providerReady(status);
    el('send').disabled=busy || unanswered || !ready;
    el('send').title=unanswered && !pending
      ? '请先重试上一条未完成的问题'
      : ready ? '发送给当前所选模型' : providerUnavailableMessage(status);
    providerChoice.sync(); reasoningChoice.sync();
    if(current && !busy && !ready && !el('form').hidden) {
      const message=providerUnavailableMessage(status);
      if(!el('status').textContent || el('status').textContent===providerReadinessMessage) {
        el('status').textContent=message;
        providerReadinessMessage=message;
      }
    } else if(providerReadinessMessage && el('status').textContent===providerReadinessMessage) {
      el('status').textContent='';
      providerReadinessMessage='';
    }
  }

  el('provider').addEventListener('change',()=>{answerProvider=el('provider').value;syncComposer();});

  function select(master) {
    if(!master) actionsPopover.hidePopover();
    dock.classList.toggle("master-active", master);
    panel.hidden = !master;
    assistantTab.setAttribute("aria-pressed", String(!master));
    masterTab.setAttribute("aria-pressed", String(master));
    if(master) { if(current) render(); refreshMasterStatus(); }
  }
  function renderTopicList() {
    topicList.replaceChildren(...(entries.topics || []).map(topic => {
      const item=button('', () => open({scope_id:topic.scope_id,title:topic.scope_title}, false, topic.id));
      item.dataset.topicId=topic.id; item.title=`${topic.scope_title} · ${topic.label}`;
      item.setAttribute('aria-current',String(topic.id===selectedTopicId && !composingNew));
      const title=document.createElement('span'); title.textContent=topic.label;
      const detail=document.createElement('small'); detail.textContent=`${topic.scope_title} · ${topic.state==='ACTIVE'?'未完全清楚':'已解决'}`;
      item.append(title,detail); return item;
    }));
    if(!topicList.children.length) { const empty=document.createElement('p'); empty.textContent='本章还没有 Master 对话'; topicList.append(empty); }
  }
  function button(text, action) {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = text;
    control.addEventListener("click", action);
    return control;
  }
  async function refreshEntries() {
    const owner = revision();
    if (!owner) return;
    const chapterId = chapter?.() || null;
    const query = chapterId ? `?chapter_id=${encodeURIComponent(chapterId)}` : '';
    const result = await api(`/api/revisions/${owner}/learning${query}`);
    if (owner !== revision() || chapterId !== (chapter?.() || null)) return;
    entriesChapterId = chapterId;
    entries = result;
    renderTopicList();
    const hasControls = entries.points.length > 0;
    if (pages.classList.contains("has-learning-controls") !== hasControls) {
      pages.classList.toggle("has-learning-controls", hasControls);
    }
    for (const label of document.querySelectorAll("[data-learning-status]")) {
      const point = entries.points.find((p) => p.knowledge_point_id === label.dataset.learningStatus);
      if (point) label.textContent = STATUS[point.status];
    }
    for (const page of pages.children) if (page.querySelector("canvas")) renderPage(Number(page.dataset.index));
  }
  async function open(point, unclear = false, topicId = null) {
    actionsPopover.hidePopover(); memorySlot.replaceChildren(); canConfirm=false; composerMore.hidden=true;
    if(current) topicDrafts.set(scopeId(current.point), {text:el('question').value,scroll:el('history').scrollTop,intent:sendIntent});
    const request = ++generation;
    clearTimeout(poll);
    current = null;
    el("form").hidden = true;
    el("confirm").hidden = true;
    el("history").replaceChildren();
    el("title").textContent = point.title;
    openDock(true);
    select(true);
    el("status").textContent = "正在读取已保存的对话…";
    el("status").classList.remove("ai-progress");
    try {
      const result = unclear ? await post(base(scopeId(point)) + "/open") : await api(base(scopeId(point)));
      if (request !== generation) return;
      current = result;
      selectedTopicId=topicId || current.topics.find(t=>t.state==='ACTIVE')?.id || current.topics.at(-1)?.id || null;
      composingNew=false;
      sendIntent = topicDrafts.get(scopeId(current.point))?.intent || null;
      el("question").value = topicDrafts.get(scopeId(current.point))?.text || '';
      render();
      el('history').scrollTop=topicDrafts.get(scopeId(current.point))?.scroll || 0;
      await refreshEntries();
      await refreshMasterStatus();
    } catch (error) { if (request === generation) el("status").textContent = error.message; }
  }
  function render() {
    el("title").textContent = current.point.title;
    const active = current.topics.find((t) => t.state === "ACTIVE");
    const expanded=dock.closest('.reader').classList.contains('assistant-expanded');
    if(!selectedTopicId && !composingNew) selectedTopicId=active?.id || current.topics.at(-1)?.id || null;
    const historical=expanded && !composingNew && selectedTopicId && current.topics.find(t=>t.id===selectedTopicId)?.state!=='ACTIVE';
    renderTopicList();
    el("status").textContent = '';
    const reviewing = current.messages.some(m => m.review_state === "PENDING");
    const generating = current.messages.some(m => m.state === "PENDING");
    el("status").classList.toggle("ai-progress", reviewing || generating);
    if (generating) el("status").textContent = '正在回答…';
    const history = el("history");
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    const visibleMessages=expanded ? current.messages.filter(message=>message.topic_id===selectedTopicId) : current.messages;
    const rendered = visibleMessages.map((message) => {
      const row = document.createElement("article");
      row.dataset.messageId = message.id;
      row.className = "master-message";
      const content = document.createElement("div");
      content.className = message.role === "user" ? "assistant-question-bubble" : "assistant-answer-bubble";
      if (message.role === "user") content.textContent = message.content;
      else renderAssistantAnswer(content, message.content);
      const reasoning=recentReasoning.get(message.id);
      if(reasoning && message.role==='assistant') row.append(reasoningBlock(reasoning));
      row.append(content);
      const metadata = document.createElement("p");
      metadata.className = "master-message-status";
      metadata.textContent = message.role === "user"
        ? ({ PENDING: "正在回答…", FAILED: "发送未完成", COMPLETE: "" }[message.state]) : '';
      const actions=document.createElement('div'); actions.className='master-answer-actions';
      if(message.role==='assistant') {
        const status=document.createElement('span');
        status.textContent=message.review_state==='TECHNICAL_FAILURE' ? '审查暂未完成 ·' : message.review_state==='FAIL' ? '内容审查未通过 ·' : '';
        if(status.textContent) actions.append(status);
        if(message.state==='COMPLETE') {
          const more=button('…',()=>showActions(message,more));
          more.setAttribute('aria-label','回答更多操作'); more.setAttribute('aria-haspopup','dialog'); actions.append(more);
        }
      } else {
        if(metadata.textContent) row.append(metadata);
        if(message.detail) { const detail=document.createElement('p'); detail.textContent=message.detail; row.append(detail); }
      }
      if (message.state === "FAILED" || ["FAIL", "TECHNICAL_FAILURE"].includes(message.review_state)) {
        actions.insertBefore(button(message.role === "user" ? "重试发送" : "重试", () => runMasterStream("retry", { message_id: message.id })),actions.querySelector('button'));
      }
      if(actions.childNodes.length) row.append(actions);
      return row;
    });
    if(streamView) rendered.push(renderStreamView());
    history.replaceChildren(...rendered);
    if (nearBottom) history.scrollTop = history.scrollHeight;
    el("form").hidden = Boolean(historical);
    resume.hidden=!historical;
    resume.textContent=active ? '回到当前话题继续提问' : '继续提问';
    // A second question must not overtake an unanswered durable question.
    el("send").disabled = current.messages.some((m) => m.role === "user" && ["PENDING", "FAILED"].includes(m.state));
    canConfirm = Boolean(active) && !historical && !composingNew;
    composerMore.hidden=el('form').hidden;
    el("confirm").hidden = !canConfirm || Boolean(menuMessageId);
    if(!canConfirm && !menuMessageId) actionsPopover.hidePopover();
    el("confirm").textContent = current.point.scope_kind === "SECTION" ? "都清楚了" : "已弄懂";
    el("question").placeholder = current.point.scope_kind === "SECTION" ? "这一节哪些地方还没完全懂？" : "这个知识点哪里还没完全懂？";
    clearTimeout(poll);
    if (!activeStream && current.messages.some((m) => m.state === "PENDING" || m.review_state === "PENDING")) {
      const request = generation;
      const url = base();
      poll = setTimeout(async () => {
        try {
          const result = await api(url);
          if (request !== generation) return;
          current = result;
          render();
        } catch (error) { if (request === generation) el("status").textContent = `${error.message}；重新打开可恢复对话。`; }
      }, 600);
    }
    syncComposer();
  }

  function reasoningBlock(text, streaming=false) {
    const details=document.createElement('details'); details.className='master-reasoning'; details.open=streaming;
    const summary=document.createElement('summary'); summary.textContent=streaming ? '正在思考' : '思考过程';
    const content=document.createElement('div'); content.className='master-reasoning-content'; content.textContent=text;
    details.append(summary,content); return details;
  }

  function renderStreamView() {
    const row=document.createElement('article'); row.className='master-message master-stream-message';
    row.dataset.masterStream='true';
    if(streamView.reasoning) row.append(reasoningBlock(streamView.reasoning,true));
    const answer=document.createElement('div'); answer.className='assistant-answer-bubble assistant-answer-streaming';
    answer.dataset.masterStreamAnswer='true'; answer.textContent=streamView.answer;
    if(!streamView.answer) answer.hidden=true;
    row.append(answer); return row;
  }

  function appendStreamDelta(kind, content) {
    if(!streamView || !content) return;
    streamView[kind]+=content;
    const history=el('history');
    let row=history.querySelector('[data-master-stream="true"]');
    if(!row) { row=renderStreamView(); history.append(row); }
    if(kind==='answer') {
      const answer=row.querySelector('[data-master-stream-answer="true"]');
      answer.hidden=false; answer.append(document.createTextNode(content));
    } else {
      let block=row.querySelector('.master-reasoning');
      if(!block) { block=reasoningBlock('',true); row.prepend(block); }
      block.querySelector('.master-reasoning-content').append(document.createTextNode(content));
    }
    history.scrollTop=history.scrollHeight;
  }

  async function runMasterStream(action, payload) {
    const request=generation;
    const controller=new AbortController(); activeStream=controller; streamView=null; syncComposer();
    el('status').textContent='准备回答…'; el('status').classList.add('ai-progress');
    let completed=null;
    try {
      await stream(`${base()}/${action}`,payload,event=>{
        if(request!==generation) return;
        if(event.type==='stage' && event.learning) {
          current=event.learning; streamView={answer:'',reasoning:''}; sendIntent=null; el('question').value=''; render();
        } else if(event.type==='stage' && event.stage==='reviewing') {
          el('status').textContent='正在审查回答…';
        } else if(event.type==='delta') appendStreamDelta('answer',event.content);
        else if(event.type==='reasoning_delta') appendStreamDelta('reasoning',event.content);
        else if(event.type==='complete') completed=event;
      },controller.signal);
      if(request!==generation) return;
      if(!completed) throw new Error('Master 流式回答未正常完成；问题已保留，可以重试。');
      if(streamView?.reasoning && completed.answer_message_id) recentReasoning.set(completed.answer_message_id,streamView.reasoning);
      current=completed.learning; streamView=null; render(); await refreshEntries();
    } catch(error) {
      if(error.name==='AbortError' || request!==generation) return;
      streamView=null;
      try { current=await api(base()); render(); } catch(_refreshError) { /* retain the visible durable state */ }
      el('status').classList.remove('ai-progress'); el('status').textContent=`${error.message}；问题已保留，可重试。`;
    } finally {
      if(activeStream===controller) activeStream=null;
      syncComposer();
    }
  }
  async function act(action, payload) {
    const request = generation;
    try {
      const result = await post(base() + `/${action}`, payload);
      if (request !== generation) return;
      current = result;
      render();
      await refreshEntries();
    } catch (error) { if (request === generation) el("status").textContent = error.message; }
  }
  el("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = el("question").value.trim();
    if (!question || el("send").disabled) return;
    const mode = el("mode").value;
    const reasoningMode=el('reasoning').value;
    if (!sendIntent || sendIntent.question !== question || sendIntent.review_mode !== mode
        || sendIntent.provider !== answerProvider || sendIntent.reasoning_mode !== reasoningMode) {
      sendIntent = { intent_id: crypto.randomUUID(), question, review_mode: mode,
        provider:answerProvider, reasoning_mode:reasoningMode };
    }
    await runMasterStream('send',sendIntent);
  });
  el("confirm").addEventListener("click", () => {
    const topic = current?.topics.find((t) => t.state === "ACTIVE");
    if (topic) act("confirm", { topic_id: topic.id });
  });
  async function confirmSection(section, output) {
    try {
      const result = await post(base(section.outline_node_id) + "/confirm-section");
      const label = section.kind === "SUBSECTION" ? "本小节" : "本节";
      const message = `已确认 ${result.changed} 个待确认知识点。${result.unclear ? `${label}仍有未完全清楚的知识点：${result.unclear} 个。` : `${label}知识点已全部确认。`}`;
      output.textContent = message;
      announce(message);
      await refreshEntries();
    } catch (error) {
      output.textContent = error.message;
      const footer = output.closest(".learning-footer");
      if (footer?.parentElement) footer.parentElement.style.marginBottom = `${footer.offsetHeight + 24}px`;
    }
  }
  async function clearWholeSection(section, output) {
    try {
      const result = await post(base(section.outline_node_id) + "/check-section");
      if (current && scopeId(current.point) === section.outline_node_id) {
        current = result;
        render();
      }
      announce("本节知识点已全部确认；此前的不清楚记录已保留。");
      await refreshEntries();
    } catch (error) {
      output.textContent = error.message;
      const footer = output.closest(".learning-footer");
      if (footer?.parentElement) footer.parentElement.style.marginBottom = `${footer.offsetHeight + 24}px`;
    }
  }
  async function understandPoint(point, control) {
    control.disabled = true;
    control.textContent = "确认中…";
    try {
      await post(base(scopeId(point)) + "/understand");
      announce("已确认这个知识点。");
      await refreshEntries();
    } catch (error) {
      control.disabled = false;
      control.textContent = "我已清楚";
      announce(error.message, true);
    }
  }
  function renderPage(index) {
    const page = pages.children[index];
    if (!page) return;
    page.querySelectorAll(".learning-marker, .learning-footer").forEach((n) => n.remove());
    const groups = new Map();
    for (const point of entries.points.filter((p) => p.display_end_page === index)) {
      const key = point.display_end_y;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    }
    for (const [y, points] of groups) {
      const marker = document.createElement("details");
      marker.className = "learning-marker kp-learning-marker";
      marker.dataset.sourceY = String(y);
      const summary = document.createElement("summary");
      summary.textContent = "学习";
      summary.title = "知识点 · 学习";
      summary.setAttribute("aria-label", "知识点 · 学习");
      marker.append(summary);
      const popover = document.createElement("div");
      popover.className = "learning-marker-content";
      for (const point of points) {
        const title = document.createElement("p");
        title.textContent = `${point.title} · ${STATUS[point.status]}`;
        popover.append(title, button("这里没完全懂", () => open(point, true)));
        if (point.thread_id) {
          popover.append(button("继续 Master 对话", () => open(point)));
        } else if (point.status === "UNCONFIRMED") {
          popover.append(button("我已清楚", (event) => understandPoint(point, event.currentTarget)));
        }
      }
      marker.append(popover);
      marker.addEventListener("toggle", () => {
        if (marker.open) for (const other of pages.querySelectorAll(".kp-learning-marker[open]")) {
          if (other !== marker) other.open = false;
        }
      });
      marker.addEventListener("keydown", event => {
        if (event.key === "Escape") { marker.open = false; summary.focus(); }
      });
      page.append(marker);
    }
    const footer = document.createElement("div");
    footer.className = "learning-footer";
    for (const section of [...entries.sections].sort((a, b) => a.end_page - b.end_page
      || a.end_y - b.end_y || Number(b.kind === "SUBSECTION") - Number(a.kind === "SUBSECTION"))) {
      const points = entries.points.filter((p) => section.knowledge_point_ids.includes(p.knowledge_point_id));
      if (!points.length) continue;
      const lastPoint = points.reduce((last, point) => point.display_end_page > last.display_end_page
        || (point.display_end_page === last.display_end_page && point.display_end_y > last.display_end_y) ? point : last);
      if (lastPoint.display_end_page !== index) continue;
      const subsection = section.kind === "SUBSECTION";
      const label = subsection ? "本小节" : "本节";
      const marker = document.createElement("section");
      marker.className = `learning-batch-card ${subsection ? "subsection" : "section"}-learning-marker`;
      marker.dataset.outlineNodeId = section.outline_node_id;
      marker.setAttribute("aria-label", `${label}收尾 · ${section.title}`);
      const title = document.createElement("h3");
      title.textContent = `${label}收尾 · ${section.title}`;
      const stats = document.createElement("p");
      stats.className = "learning-batch-stats";
      const unclear = points.filter((p) => p.status === "NOT_FULLY_CLEAR").length;
      const understood = points.filter((p) => p.status === "UNDERSTOOD").length;
      stats.textContent = `${label}共 ${points.length} 个知识点 · 已确认 ${understood} 个 · 未完全清楚 ${unclear} 个`;
      const hint = document.createElement("p");
      hint.className = "learning-batch-hint";
      hint.textContent = subsection ? "仅确认未标记为“没完全懂”的知识点" : "都清楚了将确认本节全部知识点，保留此前的学习记录。";
      const output = document.createElement("p");
      output.className = "learning-batch-result";
      output.setAttribute("role", "status");
      if (subsection) {
        marker.append(title, stats, button("确认本小节", () => confirmSection(section, output)), hint, output);
      } else {
        const state = document.createElement("p");
        state.className = "learning-batch-stats";
        state.textContent = STATUS[section.status];
        marker.append(title, stats, state, button("都清楚了", () => clearWholeSection(section, output)),
          button("还有些地方不完全清楚", () => open(section, true)));
        if (section.thread_id) marker.append(button("继续本节 Master 对话", () => open(section)));
        marker.append(hint, output);
      }
      footer.append(marker);
    }
    if (footer.children.length) page.append(footer);
    page.style.marginBottom = `${footer.children.length ? footer.offsetHeight + 24 : 20}px`;
    const markers = [...page.querySelectorAll(".learning-marker")]
      .sort((a, b) => Number(a.dataset.sourceY) - Number(b.dataset.sourceY));
    const layout = () => {
      let nextTop = Infinity;
      for (const marker of [...markers].reverse()) {
        const bottom = Math.min(Number(marker.dataset.sourceY) * page.clientHeight, nextTop - 6);
        const top = bottom - marker.offsetHeight;
        marker.style.top = `${top}px`;
        nextTop = top;
      }
      page.style.marginTop = `${Math.max(20, 20 - nextTop)}px`;
    };
    markers.forEach((marker) => marker.addEventListener("toggle", layout));
    layout();
  }
  function decorateKnowledgeItem(item, point) {
    const saved = entries.points.find((p) => p.knowledge_point_id === point.knowledge_point_id);
    const status = document.createElement("p");
    status.dataset.learningStatus = point.knowledge_point_id;
    status.textContent = STATUS[saved?.status || "UNCONFIRMED"];
    item.append(status, button("这里没完全懂", () => { goToPage(point.end_page, point.end_y); open(point, true); }));
    if (saved?.thread_id) item.append(button("继续 Master 对话", () => open(point)));
  }
  function reset() {
    activeStream?.abort(); activeStream=null; streamView=null; recentReasoning.clear();
    actionsPopover.hidePopover();
    ++generation;
    clearTimeout(poll);
    current = null;
    selectedTopicId=null; composingNew=false; topicDrafts.clear();
    canConfirm=false; composerMore.hidden=true; memorySlot.replaceChildren(); menuMessageId=null;
    entries = { points: [], sections: [], topics: [] };
    entriesChapterId = undefined;
    if (pages.classList.contains("has-learning-controls")) {
      pages.classList.remove("has-learning-controls");
    }
    sendIntent = null;
    select(false);
    el("title").textContent = "学习 Master";
    el("history").replaceChildren();
    el("status").textContent = "从教材知识点打开持久对话。";
    el("form").hidden = true;
    el("confirm").hidden = true;
    resume.hidden=true; renderTopicList();
  }
  return { refreshEntries, renderPage, decorateKnowledgeItem, reset, viewportChanged: () => {
      if(current) render();
      if(entriesChapterId !== (chapter?.() || null)) refreshEntries().catch(error => announce(error.message, true));
    }, selectAssistant: () => select(false),
    openMemory: async (scope, messageId) => {
      await open({ scope_id: scope, title: 'Master 学习上下文' });
      const message=current?.messages.find(m=>m.id===messageId);
      if(message) { selectedTopicId=message.topic_id; composingNew=false; render(); }
      const row = [...el('history').children].find(node => node.dataset.messageId === messageId);
      if (row) { row.scrollIntoView({ block: 'center' }); row.tabIndex = -1; row.focus({ preventScroll: true }); }
    } };
}
import {betaUnavailable} from "/beta-ui.js";
