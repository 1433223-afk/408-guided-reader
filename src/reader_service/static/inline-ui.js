import { placeInline } from "./inline-placement.js";

const labels = { lead_in: "读前引导", bridge: "过渡", warning: "留意条件", connection: "联系", recall: "想一想" };

export function createInlineUI({ state, api, goToPage, readingAnchor, layout, explain, contextMenu, hideContextMenu }) {
  const reader = document.getElementById("reader"), viewer = document.getElementById("viewer");
  const toggle = document.createElement("button");
  toggle.id = "inline-open"; toggle.className = "outline-toggle"; toggle.textContent = "✦ 行间教学";
  toggle.setAttribute("aria-expanded", "false");
  document.getElementById("guide-reopen").after(toggle);
  const panel = document.createElement("aside");
  panel.id = "inline-panel"; panel.hidden = true; panel.setAttribute("aria-label", "行间教学");
  panel.innerHTML = `<div class="inline-controls"><select id="inline-section" aria-label="行间教学当前节"></select><label><input id="inline-enabled" type="checkbox">显示 ✦</label><button id="inline-generate" type="button">生成本节教学</button><button id="inline-retry" type="button" hidden>重试</button><button id="inline-close" type="button" aria-label="收起行间教学">×</button></div><p id="inline-status" role="status"></p><div id="inline-content"></div>`;
  reader.append(panel);
  const selector = panel.querySelector("select"), enabled = panel.querySelector("input"), status = panel.querySelector("#inline-status"), content = panel.querySelector("#inline-content");
  const generate = panel.querySelector("#inline-generate"), retry = panel.querySelector("#inline-retry");
  let revision = null, epoch = 0, selected = null, active = null, timer = 0;
  const cache = new Map(), loading = new Map(), intents = new Map(), pending = new Set(), visible = new Map();
  const requestErrors = new Map();
  const base = id => `/api/revisions/${revision}/sections/${id}/inline-teaching`;
  const key = id => `inline-teaching:${revision}:${id}`;
  const on = id => {
    if (!visible.has(id)) { try { visible.set(id, localStorage.getItem(key(id)) === "on"); } catch { visible.set(id, false); } }
    return visible.get(id);
  };
  function visibility(id, value) {
    visible.set(id, value);
    try { localStorage.setItem(key(id), value ? "on" : "off"); } catch { /* Local presentation remains usable. */ }
  }
  function reset() {
    close(); epoch++; revision = state.revision?.id || null; selected = active = null;
    clearTimeout(timer); cache.clear(); loading.clear(); intents.clear(); pending.clear(); visible.clear(); requestErrors.clear(); selector.replaceChildren();
  }
  function sync() {
    if (revision !== state.revision?.id) reset();
    const prior = selected;
    selector.replaceChildren();
    for (const node of state.outlineNodes.filter(n => n.kind === "SECTION" && n.resolution_state === "RESOLVED")) {
      const option = document.createElement("option"); option.value = node.outline_node_id; option.textContent = node.title; selector.append(option);
    }
    if (prior && [...selector.options].some(o => o.value === prior)) selector.value = prior;
    selected = selector.value || null;
    for (const index of state.rendered) renderPage(index);
    if (!panel.hidden) refresh();
  }
  function close() {
    hideContextMenu();
    toggle.setAttribute("aria-expanded", "false");
    if (!panel.hidden) layout(() => { panel.hidden = true; reader.classList.remove("inline-open"); });
  }
  function open(id, itemId = null) {
    sync();
    const point = readingAnchor();
    selected = id || state.outlineNodes.find(n => n.kind === "SECTION" && n.resolution_state === "RESOLVED" && point
      && (n.start_page < point.pageIndex || n.start_page === point.pageIndex && n.start_y <= point.normalizedY)
      && (n.end_page > point.pageIndex || n.end_page === point.pageIndex && n.end_y > point.normalizedY))?.outline_node_id || selected;
    selector.value = selected; active = itemId;
    toggle.setAttribute("aria-expanded", "true");
    layout(() => { panel.hidden = false; reader.classList.add("inline-open"); });
    refresh(); load(selected);
  }
  toggle.onclick = () => panel.hidden ? open() : close();
  panel.querySelector("#inline-close").onclick = close;
  selector.onchange = () => { selected = selector.value; active = null; refresh(); load(selected); };
  enabled.onchange = () => { if (selected) { visibility(selected, enabled.checked); if (!enabled.checked) active = null; repaint(); refresh(); } };
  generate.onclick = () => send(cache.get(selected)?.published ? "regenerate" : "generate");
  retry.onclick = () => send("retry");
  function refresh() {
    const snapshot = cache.get(selected), task = snapshot?.task, pub = snapshot?.published;
    const busy = task && ["DRAFT", "IN_REVIEW", "REJECTED"].includes(task.state);
    enabled.checked = on(selected); enabled.disabled = !selected;
    // The published pointer determines whether this action is generate or replace.
    generate.disabled = !selected || !snapshot || Boolean(busy) || pending.has(selected);
    generate.textContent = pub ? "重新生成本节教学" : "生成本节教学";
    retry.hidden = task?.state !== "FAILED" || Boolean(task?.terminal); retry.disabled = pending.has(selected);
    status.textContent = !selected ? "本书暂没有已确定范围的节，原 PDF 仍可阅读。" : !snapshot ? "正在读取已发布教学…"
      : busy ? (task.stage === "REVIEW" ? "正在独立审查，原 PDF 和已发布提示仍可使用。" : "正在生成少量提示，可继续阅读。")
      : task?.state === "FAILED" ? (task.terminal ? "本次未通过审查，已停止；可重新生成。" : "本次生成或审查失败，可重试当前阶段。") + (pub ? " 原教学仍可使用。" : "")
      : pub?.no_intervention ? "已通过独立审查：本节暂不需要额外提示。"
      : pub ? "已通过独立审查；点击页旁 ✦ 阅读。" : "按需为本节生成稀疏提示，原 PDF 始终可用。";
    if (pub?.stale) status.textContent += " 来源已有更新，可重新生成。";
    if (pub?.omitted_count) status.textContent += ` ${pub.omitted_count} 个位置无法可靠确认，已隐藏。`;
    if (requestErrors.has(selected)) status.textContent += ` ${requestErrors.get(selected)}`;
    const item = on(selected) && pub?.content.items.find(i => i.id === active);
    const identity = item ? `${pub.id}:${item.id}` : "";
    if (content.dataset.identity === identity) return;
    content.dataset.identity = identity; content.replaceChildren();
    if (!item) return;
    const title = document.createElement("strong"); title.textContent = labels[item.kind]; content.append(title);
    function text(field) {
      const p = document.createElement("p"); p.className = "inline-text"; p.dataset.field = field;
      p.textContent = item[field]; content.append(p); return p;
    }
    text("text");
    if (item.kind === "recall") {
      text("prompt");
      const reveal = document.createElement("button"); reveal.type = "button"; reveal.textContent = "想好后查看参考思路";
      reveal.onclick = () => { text("reference_thought"); reveal.remove(); };
      const skip = document.createElement("button"); skip.type = "button"; skip.textContent = "先跳过";
      skip.onclick = () => { active = null; refresh(); };
      content.append(reveal, skip);
    }
    const jump = document.createElement("button"); jump.type = "button"; jump.textContent = "查看教材位置";
    jump.onclick = async () => {
      const id = selected, stamp = epoch;
      await load(id, true);
      if (stamp !== epoch || id !== selected) return;
      const fresh = cache.get(id)?.published;
      const source = fresh?.id === pub.id && fresh.content.items.some(i => i.id === item.id) && fresh.sources[item.target_id];
      if (!source?.available) { active = null; refresh(); status.textContent = "教材位置已变化，未跳转。"; return; }
      goToPage(source.pdf_page_index, Math.min(...source.quad.map(p => p[1])));
    };
    content.append(jump);
  }
  async function load(id, force = false) {
    if (!id || !revision) return;
    if (loading.has(id)) return loading.get(id);
    if (!force && cache.has(id)) return;
    const stamp = epoch;
    const work = (async () => {
      try {
        const snapshot = await api(base(id));
        if (stamp !== epoch) return;
        cache.set(id, snapshot); repaint(); if (selected === id) refresh(); schedule();
      } catch (e) { if (stamp === epoch && selected === id) status.textContent = e.message; }
      finally { if (stamp === epoch) loading.delete(id); }
    })();
    loading.set(id, work); return work;
  }
  function schedule() {
    clearTimeout(timer);
    const jobs = [...cache].filter(([, s]) => ["DRAFT", "IN_REVIEW", "REJECTED"].includes(s.task?.state));
    // Refresh visible published anchors too, so a source change cannot leave a
    // cached marker indefinitely attached to newly processed page text.
    timer = setTimeout(() => {
      const ids = new Set(jobs.map(([id]) => id));
      for (const index of state.rendered) for (const n of sections(index)) ids.add(n.outline_node_id);
      for (const id of ids) load(id, true);
    }, jobs.length ? 800 : 5000);
  }
  async function send(action) {
    const id = selected, stamp = epoch;
    if (!id || pending.has(id)) return;
    pending.add(id); requestErrors.delete(id); refresh();
    if (!intents.has(id) || intents.get(id).action !== action) intents.set(id, { action, id: crypto.randomUUID() });
    try {
      const result = await api(`${base(id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "retry" ? { asset_id: cache.get(id).task.id } : { intent_id: intents.get(id).id }) });
      if (stamp !== epoch) return;
      intents.delete(id); cache.set(id, result); visibility(id, true); schedule();
    } catch (e) { if (stamp === epoch) requestErrors.set(id, e.message); }
    finally { if (stamp === epoch) { pending.delete(id); refresh(); repaint(); } }
  }
  function sections(index) { return state.outlineNodes.filter(n => n.kind === "SECTION" && n.resolution_state === "RESOLVED" && n.start_page <= index && n.end_page >= index); }
  function repaint() { for (const index of state.rendered) renderPage(index); }
  function renderPage(index) {
    if (revision !== state.revision?.id) { reset(); return; }
    const page = document.querySelector(`.page[data-index="${index}"]`);
    if (!page) return;
    page.querySelectorAll(".inline-marker").forEach(b => b.remove());
    const occupied = [], bounds = page.getBoundingClientRect(), viewport = viewer.getBoundingClientRect();
    const obstacles = [...page.querySelectorAll(".learning-marker,.learning-marker-content,.section-guide-entry")].map(e => e.getBoundingClientRect());
    for (const section of sections(index)) {
      const id = section.outline_node_id; load(id);
      const pub = cache.get(id)?.published;
      if (!pub || !on(id)) continue;
      for (const item of pub.content.items) {
        const target = pub.sources[item.target_id];
        if (target.pdf_page_index !== index) continue;
        const placement = placeInline(target, bounds, viewport, obstacles, occupied);
        if (!placement) continue;
        occupied.push(placement);
        const b = document.createElement("button"); b.type = "button"; b.className = "inline-marker";
        b.dataset.itemId = item.id; b.dataset.assetId = pub.id; b.dataset.sectionId = id;
        b.textContent = "✦"; b.setAttribute("aria-label", `${labels[item.kind]} · ${section.title}`);
        b.style.top = `${placement.y * 100}%`;
        b.onclick = async () => { await load(id, true); if (cache.get(id)?.published?.id === pub.id) open(id, item.id); };
        page.append(b);
      }
    }
  }
  content.addEventListener("contextmenu", event => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0), p = range.startContainer.parentElement?.closest(".inline-text");
    if (!p || !p.contains(range.endContainer)) return;
    const before = range.cloneRange(); before.selectNodeContents(p); before.setEnd(range.startContainer, range.startOffset);
    const start = Array.from(before.toString()).length, end = start + Array.from(range.toString()).length;
    if (start === end) return;
    event.preventDefault();
    const request = { source_kind: "INLINE_GUIDANCE", section_id: selected, asset_id: cache.get(selected).published.id,
      item_id: active, field: p.dataset.field, start_offset: start, end_offset: end };
    const text = range.toString();
    contextMenu(event.clientX, event.clientY, text, () => explain(text, request));
  });
  new ResizeObserver(repaint).observe(viewer);
  viewer.addEventListener("scroll", repaint, { passive: true });
  reader.addEventListener("toggle", repaint, true);
  return { sync, renderPage, reset, close };
}
