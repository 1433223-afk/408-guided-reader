import { renderAssistantAnswer } from "/assistant-render.js";
import { createComposerChoice } from "/screens.js";

const STATUS = { UNCONFIRMED: "待确认", NOT_FULLY_CLEAR: "未完全清楚", UNDERSTOOD: "已弄懂", AVAILABLE: "本节待确认", ANSWERED_CLEAR: "本节都清楚了", ANSWERED_HAS_UNCLEAR: "本节还有未完全清楚的地方" };
const REVIEW = { NOT_REQUESTED: "快速 · 未独立审查", PENDING: "审查中", PASS: "审查通过", FAIL: "审查未通过", TECHNICAL_FAILURE: "审查技术失败" };

export function createMasterUI({ api, revision, pages, dock, openDock, goToPage, announce, relayout, memoryControl, toggleExpanded }) {
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
  const topicDrafts = new Map();
  const tabs = document.createElement("nav");
  tabs.className = "dock-tabs";
  tabs.setAttribute("aria-label", "AI 工作区");
  const assistantTab = button("解释 Assistant", () => select(false));
  const masterTab = button("学习 Master", () => select(true));
  const close = button("收起", () => openDock(false));
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
          <label class="assistant-model"><span class="sr-only">审查强度</span><select id="master-mode" aria-label="审查强度"><option value="Fast">快速 · 通常不做独立审查</option><option value="Standard" selected>标准 · 检查学术与客观正确性</option><option value="Deep">深入 · 同时检查推理与教学有效性</option></select></label>
        </div>
        <button id="master-send" type="submit">发送</button>
      </div>
    </form>
    <button id="master-confirm" type="button" hidden>已经弄懂</button>
    <p class="master-lifetime">对话自动保存；收起或重启不会改变理解状态。</p>`;
  dock.append(panel);
  const el = (id) => panel.querySelector(`#master-${id}`);
  const conversation = document.createElement('div'); conversation.className='master-conversation';
  conversation.append(...panel.children);
  const sidebar = document.createElement('nav'); sidebar.id='master-topic-sidebar'; sidebar.setAttribute('aria-label','本书 Master 主题');
  const topicHeading=document.createElement('strong'); topicHeading.textContent='本书主题';
  const topicList=document.createElement('div'); topicList.id='master-topic-list';
  sidebar.append(topicHeading, topicList); panel.append(sidebar, conversation);
  const resume=button('继续提问', () => {
    selectedTopicId=current?.topics.find(t=>t.state==='ACTIVE')?.id || null;
    composingNew=!selectedTopicId; render(); el('question').focus();
  });
  resume.id='master-resume-topic'; resume.hidden=true; el('form').before(resume);
  createComposerChoice(el('mode'), {id:'master-review', label:'审查强度',
    names:{Fast:'快速', Standard:'标准', Deep:'深入'}});
  const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });
  const scopeId = (point) => point.scope_id || point.knowledge_point_id || point.outline_node_id;
  const base = (id = current && scopeId(current.point)) => `/api/revisions/${revision()}/learning/${id}`;

  function select(master) {
    dock.classList.toggle("master-active", master);
    panel.hidden = !master;
    assistantTab.setAttribute("aria-pressed", String(!master));
    masterTab.setAttribute("aria-pressed", String(master));
    if(master && current) render();
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
    if(!topicList.children.length) { const empty=document.createElement('p'); empty.textContent='还没有 Master 话题'; topicList.append(empty); }
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
    const result = await api(`/api/revisions/${owner}/learning`);
    if (owner !== revision()) return;
    entries = result;
    renderTopicList();
    const hasControls = entries.points.length > 0;
    if (pages.classList.contains("has-learning-controls") !== hasControls) {
      pages.classList.toggle("has-learning-controls", hasControls);
      relayout();
    }
    for (const label of document.querySelectorAll("[data-learning-status]")) {
      const point = entries.points.find((p) => p.knowledge_point_id === label.dataset.learningStatus);
      if (point) label.textContent = STATUS[point.status];
    }
    for (const page of pages.children) if (page.querySelector("canvas")) renderPage(Number(page.dataset.index));
  }
  async function open(point, unclear = false, topicId = null) {
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
    } catch (error) { if (request === generation) el("status").textContent = error.message; }
  }
  function render() {
    el("title").textContent = current.point.title;
    const active = current.topics.find((t) => t.state === "ACTIVE");
    const expanded=dock.closest('.reader').classList.contains('assistant-expanded');
    if(!selectedTopicId && !composingNew) selectedTopicId=active?.id || current.topics.at(-1)?.id || null;
    const historical=expanded && !composingNew && selectedTopicId && current.topics.find(t=>t.id===selectedTopicId)?.state!=='ACTIVE';
    renderTopicList();
    el("status").textContent = `${STATUS[current.status]} · ${active ? "当前话题待解决" : "当前没有未解决话题"}`;
    if(historical) el('status').textContent='已解决的话题 · 历史记录';
    if(expanded && composingNew) el('status').textContent='继续提问将开启新一轮话题，已有历史保留。';
    const reviewing = current.messages.some(m => m.review_state === "PENDING");
    const generating = current.messages.some(m => m.state === "PENDING");
    el("status").classList.toggle("ai-progress", reviewing || generating);
    if (reviewing || generating) el("status").textContent += reviewing ? " · 审查中" : " · 生成中";
    const history = el("history");
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    const visibleMessages=expanded ? current.messages.filter(message=>!composingNew && message.topic_id===selectedTopicId) : current.messages;
    const rendered = visibleMessages.map((message) => {
      const row = document.createElement("article");
      row.dataset.messageId = message.id;
      row.className = "master-message";
      const content = document.createElement("div");
      content.className = message.role === "user" ? "assistant-question-bubble" : "assistant-answer-bubble";
      if (message.role === "user") content.textContent = message.content;
      else renderAssistantAnswer(content, message.content);
      row.append(content);
      const metadata = document.createElement("p");
      metadata.className = "master-message-status";
      metadata.textContent = message.role === "user"
        ? ({ PENDING: "问题已保存 · 正在回答", FAILED: "发送未完成 · 问题已保留", COMPLETE: "" }[message.state])
        : `${message.provider} · ${message.model} · ${REVIEW[message.review_state]}${message.reviewer_provider ? ` · ${message.reviewer_provider} / ${message.reviewer_model}` : ""}`;
      row.append(metadata);
      if (message.role === 'assistant' && message.state === 'COMPLETE') {
        row.append(memoryControl(revision(), 'MASTER', message.id));
      }
      if (message.detail) {
        const detail = document.createElement("p");
        detail.className = "master-message-status";
        detail.textContent = message.detail;
        if (message.role === "assistant" && message.review_state === "PASS") {
          const disclosure = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = "审查说明";
          disclosure.append(summary, detail);
          row.append(disclosure);
        } else row.append(detail);
      }
      if (message.state === "FAILED" || ["FAIL", "TECHNICAL_FAILURE"].includes(message.review_state)) {
        row.append(button(message.role === "user" ? "重试发送" : "重试审查", () => act("retry", { message_id: message.id })));
      }
      return row;
    });
    history.replaceChildren(...rendered);
    if (nearBottom) history.scrollTop = history.scrollHeight;
    el("form").hidden = Boolean(historical);
    resume.hidden=!historical;
    resume.textContent=active ? '回到当前话题继续提问' : '继续提问（新话题）';
    // A second question must not overtake an unanswered durable question.
    el("send").disabled = current.messages.some((m) => m.role === "user" && ["PENDING", "FAILED"].includes(m.state));
    el("confirm").hidden = !active || Boolean(historical) || composingNew;
    el("confirm").textContent = current.point.scope_kind === "SECTION" ? "都清楚了" : "已经弄懂";
    el("question").placeholder = current.point.scope_kind === "SECTION" ? "这一节哪些地方还没完全懂？" : "这个知识点哪里还没完全懂？";
    clearTimeout(poll);
    if (current.messages.some((m) => m.state === "PENDING" || m.review_state === "PENDING")) {
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
    if (!sendIntent || sendIntent.question !== question || sendIntent.review_mode !== mode) {
      sendIntent = { intent_id: crypto.randomUUID(), question, review_mode: mode };
    }
    el("send").disabled = true;
    el("status").textContent = "准备发送…"; el("status").classList.add("ai-progress");
    const request = generation;
    try {
      const result = await post(base() + "/send", sendIntent);
      if (request !== generation) return;
      current = result;
      selectedTopicId=current.topics.find(t=>t.state==='ACTIVE')?.id || selectedTopicId;
      composingNew=false;
      sendIntent = null;
      el("question").value = "";
      render();
      await refreshEntries();
    } catch (error) {
      if (request === generation) { el("status").classList.remove("ai-progress"); el("status").textContent = `${error.message}；再次发送会复用本次问题。`; el("send").disabled = false; }
    }
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
        if (point.thread_id) popover.append(button("继续 Master 对话", () => open(point)));
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
    ++generation;
    clearTimeout(poll);
    current = null;
    selectedTopicId=null; composingNew=false; topicDrafts.clear();
    entries = { points: [], sections: [] };
    if (pages.classList.contains("has-learning-controls")) {
      pages.classList.remove("has-learning-controls");
      relayout();
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
  return { refreshEntries, renderPage, decorateKnowledgeItem, reset, viewportChanged: () => { if(current) render(); }, selectAssistant: () => select(false),
    openMemory: async (scope, messageId) => {
      await open({ scope_id: scope, title: 'Master 学习上下文' });
      const message=current?.messages.find(m=>m.id===messageId);
      if(message) { selectedTopicId=message.topic_id; composingNew=false; render(); }
      const row = [...el('history').children].find(node => node.dataset.messageId === messageId);
      if (row) { row.scrollIntoView({ block: 'center' }); row.tabIndex = -1; row.focus({ preventScroll: true }); }
    } };
}
