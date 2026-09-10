import { renderAssistantAnswer } from "/assistant-render.js";

const STATUS = { UNCONFIRMED: "待确认", NOT_FULLY_CLEAR: "未完全清楚", UNDERSTOOD: "已弄懂" };
const REVIEW = { NOT_REQUESTED: "快速 · 未独立审查", PENDING: "审查中", PASS: "审查通过", FAIL: "审查未通过", TECHNICAL_FAILURE: "审查技术失败" };

export function createMasterUI({ api, revision, pages, dock, openDock, goToPage, announce }) {
  let entries = { points: [], sections: [] };
  let current = null;
  let poll = 0;
  let generation = 0;
  let sendIntent = null;
  const tabs = document.createElement("nav");
  tabs.className = "dock-tabs";
  tabs.setAttribute("aria-label", "AI 工作区");
  const assistantTab = button("解释 Assistant", () => select(false));
  const masterTab = button("学习 Master", () => select(true));
  const close = button("收起", () => openDock(false));
  tabs.append(assistantTab, masterTab, close);
  dock.prepend(tabs);
  const panel = document.createElement("section");
  panel.id = "master-workspace";
  panel.hidden = true;
  panel.innerHTML = `<h2 id="master-title">学习 Master</h2>
    <p id="master-status" role="status">从教材知识点打开持久对话。</p>
    <div id="master-history" aria-live="polite"></div>
    <form id="master-form" hidden>
      <label>审查强度 <select id="master-mode"><option value="Fast">快速</option><option value="Standard" selected>标准</option><option value="Deep">深入</option></select></label>
      <label for="master-question" class="sr-only">向 Master 提问</label>
      <textarea id="master-question" maxlength="2000" rows="3" placeholder="这个知识点哪里还没完全懂？"></textarea>
      <button id="master-send" type="submit">发送</button>
    </form>
    <button id="master-confirm" type="button" hidden>已经弄懂</button>
    <p class="master-lifetime">对话自动保存；收起或重启不会改变理解状态。</p>`;
  dock.append(panel);
  const el = (id) => panel.querySelector(`#master-${id}`);
  const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });
  const base = (id = current?.point.knowledge_point_id) => `/api/revisions/${revision()}/learning/${id}`;

  function select(master) {
    dock.classList.toggle("master-active", master);
    panel.hidden = !master;
    assistantTab.setAttribute("aria-pressed", String(!master));
    masterTab.setAttribute("aria-pressed", String(master));
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
    for (const label of document.querySelectorAll("[data-learning-status]")) {
      const point = entries.points.find((p) => p.knowledge_point_id === label.dataset.learningStatus);
      if (point) label.textContent = STATUS[point.status];
    }
    for (const page of pages.children) if (page.querySelector("canvas")) renderPage(Number(page.dataset.index));
  }
  async function open(point, unclear = false) {
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
    try {
      const result = unclear ? await post(base(point.knowledge_point_id) + "/open") : await api(base(point.knowledge_point_id));
      if (request !== generation) return;
      current = result;
      sendIntent = null;
      el("question").value = "";
      render();
      await refreshEntries();
    } catch (error) { if (request === generation) el("status").textContent = error.message; }
  }
  function render() {
    el("title").textContent = current.point.title;
    const active = current.topics.find((t) => t.state === "ACTIVE");
    el("status").textContent = `${STATUS[current.status]} · ${active ? "当前话题待解决" : "当前没有未解决话题"}`;
    const history = el("history");
    const nearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 80;
    const rendered = current.messages.map((message) => {
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
    el("form").hidden = false;
    // A second question must not overtake an unanswered durable question.
    el("send").disabled = current.messages.some((m) => m.role === "user" && ["PENDING", "FAILED"].includes(m.state));
    el("confirm").hidden = !active;
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
    const request = generation;
    try {
      const result = await post(base() + "/send", sendIntent);
      if (request !== generation) return;
      current = result;
      sendIntent = null;
      el("question").value = "";
      render();
    } catch (error) {
      if (request === generation) { el("status").textContent = `${error.message}；再次发送会复用本次问题。`; el("send").disabled = false; }
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
    } catch (error) { output.textContent = error.message; }
  }
  function renderPage(index) {
    const page = pages.children[index];
    if (!page) return;
    page.querySelectorAll(".learning-marker").forEach((n) => n.remove());
    const groups = new Map();
    for (const point of entries.points.filter((p) => p.end_page === index)) {
      const key = point.end_y;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(point);
    }
    for (const [y, points] of groups) {
      const marker = document.createElement("details");
      marker.className = "learning-marker kp-learning-marker";
      marker.style.top = `${Math.min(y, .94) * 100}%`;
      const summary = document.createElement("summary");
      summary.textContent = "知识点 · 学习";
      marker.append(summary);
      for (const point of points) {
        const title = document.createElement("p");
        title.textContent = `${point.title} · ${STATUS[point.status]}`;
        marker.append(title, button("这里没完全懂", () => open(point, true)));
        if (point.thread_id) marker.append(button("继续 Master 对话", () => open(point)));
      }
      page.append(marker);
    }
    for (const section of entries.sections.filter((s) => s.end_page === index)) {
      const points = entries.points.filter((p) => section.knowledge_point_ids.includes(p.knowledge_point_id));
      if (!points.length) continue;
      const subsection = section.kind === "SUBSECTION";
      const label = subsection ? "本小节" : "本节";
      const marker = document.createElement("details");
      marker.className = `learning-marker ${subsection ? "subsection" : "section"}-learning-marker`;
      marker.dataset.outlineNodeId = section.outline_node_id;
      marker.style.top = `${Math.min(section.end_y, .98) * 100}%`;
      const summary = document.createElement("summary");
      summary.textContent = `${label}确认`;
      const title = document.createElement("p");
      title.textContent = section.title;
      const output = document.createElement("p");
      output.setAttribute("role", "status");
      const unclear = points.filter((p) => p.status === "NOT_FULLY_CLEAR").length;
      output.textContent = unclear ? `${label}仍有未完全清楚的知识点：${unclear} 个` : `仅确认${label}待确认的知识点`;
      marker.append(summary, title, button(subsection ? "一键确认本小节 KP" : "一键确认本节全部 KP", () => confirmSection(section, output)), output);
      page.append(marker);
    }
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
    entries = { points: [], sections: [] };
    sendIntent = null;
    select(false);
    el("title").textContent = "学习 Master";
    el("history").replaceChildren();
    el("status").textContent = "从教材知识点打开持久对话。";
    el("form").hidden = true;
    el("confirm").hidden = true;
  }
  return { refreshEntries, renderPage, decorateKnowledgeItem, reset, selectAssistant: () => select(false) };
}
