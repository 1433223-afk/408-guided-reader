import { placeInline } from "./inline-placement.js";

const labels = { lead_in: "为什么这里重要", bridge: "接着这样看", warning: "这里注意", connection: "和前面连起来看", recall: "先想一想" };

export function createInlineUI({ state, api, goToPage, readingAnchor, layout, explain, contextMenu, hideContextMenu }) {
  const reader = document.getElementById("reader"), viewer = document.getElementById("viewer");
  const controls = document.createElement("div"); controls.className = "inline-toolbar";
  controls.innerHTML = `<button id="inline-open" type="button" aria-pressed="false" aria-describedby="inline-status">✦ 行间教学</button><button id="inline-more" type="button" aria-label="行间教学更多操作" aria-expanded="false" aria-controls="inline-menu" hidden>···</button><span id="inline-status" class="sr-only" role="status"></span>`;
  document.getElementById("guide-reopen").after(controls);
  const toggle = controls.querySelector("#inline-open"), more = controls.querySelector("#inline-more");
  const menu = document.createElement("aside"); menu.id = "inline-menu"; menu.hidden = true;
  menu.setAttribute("aria-label", "行间教学管理");
  menu.innerHTML = `<button id="inline-generate" type="button">重新生成</button>`;
  reader.append(menu);
  const panel = document.createElement("aside");
  panel.id = "inline-panel"; panel.hidden = true; panel.setAttribute("aria-label", "行间教学批注");
  panel.innerHTML = `<button id="inline-close" type="button" aria-label="关闭 Guidance">×</button><div id="inline-content"></div>`;
  const status = controls.querySelector("#inline-status"), content = panel.querySelector("#inline-content");
  const generate = menu.querySelector("#inline-generate");
  let menuOwner = null;
  let revision = null, epoch = 0, selected = null, active = null, timer = 0;
  const activating = new Set();
  const cache = new Map(), loading = new Map(), intents = new Map(), pending = new Set(), visible = new Map();
  const requestErrors = new Map();
  let repaintFrame = 0;
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
    epoch++; revision = state.revision?.id || null; selected = active = null;
    clearTimeout(timer); cancelAnimationFrame(repaintFrame); repaintFrame = 0;
    cache.clear(); loading.clear(); intents.clear(); pending.clear(); visible.clear(); requestErrors.clear(); activating.clear();
    close(false); closeMenu();
  }
  function sync() {
    if (revision !== state.revision?.id) reset();
    for (const index of state.rendered) renderPage(index);
    refresh();
  }
  function close(repaintPages = true) {
    hideContextMenu(); active = null; panel.hidden = true; panel.remove();
    content.replaceChildren(); content.dataset.identity = "";
    if (reader.classList.contains("inline-open")) layout(() => reader.classList.remove("inline-open"));
    if (repaintPages) repaint();
  }
  function currentSection() {
    const point = readingAnchor();
    return state.outlineNodes.find(n => n.kind === "SECTION" && n.resolution_state === "RESOLVED" && point
      && (n.start_page < point.pageIndex || n.start_page === point.pageIndex && n.start_y <= point.normalizedY)
      && (n.end_page > point.pageIndex || n.end_page === point.pageIndex && n.end_y > point.normalizedY))?.outline_node_id;
  }
  function closeMenu() { menu.hidden = true; menuOwner = null; more.setAttribute("aria-expanded", "false"); }
  function open(id, itemId) {
    closeMenu(); selected = id; active = itemId;
    refresh();
    if (!reader.classList.contains("inline-open")) layout(() => reader.classList.add("inline-open"));
    repaintActive();
  }
  toggle.onclick = async () => {
    const id = currentSection(), stamp = epoch;
    if (!id || activating.has(id) || pending.has(id)) return;
    activating.add(id); refresh();
    try {
      await load(id);
      if (stamp !== epoch || id !== currentSection()) return;
      const snapshot = cache.get(id), task = snapshot?.task;
      if (!snapshot || ["DRAFT", "IN_REVIEW", "REJECTED"].includes(task?.state)) return;
      if (task?.state === "FAILED") {
        await send(task.terminal ? (snapshot.published ? "regenerate" : "generate") : "retry", id);
      } else if (snapshot.published) {
        visibility(id, !on(id));
        if (!on(id) && selected === id) close();
        repaint();
      } else await send("generate", id);
    } finally { if (stamp === epoch) { activating.delete(id); refresh(); } }
  };
  more.onclick = () => {
    if (!menu.hidden) { closeMenu(); return; }
    refresh();
    if (more.hidden) return;
    menuOwner = currentSection(); menu.hidden = false;
    const bounds = more.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${bounds.bottom + 6}px`;
    more.setAttribute("aria-expanded", "true"); generate.focus();
  };
  panel.querySelector("#inline-close").onclick = () => {
    const marker = document.querySelector(`.inline-marker[data-item-id="${active}"][data-section-id="${selected}"]`);
    close(); marker?.focus({ preventScroll: true });
  };
  reader.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!menu.hidden) { e.preventDefault(); closeMenu(); more.focus(); }
    else if (!panel.hidden) { e.preventDefault(); panel.querySelector("#inline-close").click(); }
  });
  document.addEventListener("pointerdown", e => {
    if (!menu.hidden && !menu.contains(e.target) && !controls.contains(e.target)) closeMenu();
    if (!panel.hidden && !panel.contains(e.target)
        && !e.target.closest(".inline-marker, #selection-actions")) close();
  });
  controls.parentElement.addEventListener("scroll", closeMenu, {passive:true});
  window.addEventListener("resize", closeMenu);
  generate.onclick = () => {
    const id = menuOwner;
    if (!id || id !== currentSection() || more.hidden || generate.disabled) { closeMenu(); return; }
    closeMenu(); toggle.focus(); send("regenerate", id);
  };
  function refresh() {
    const id = currentSection(), node = state.outlineNodes.find(n => n.outline_node_id === id);
    const snapshot = cache.get(id), task = snapshot?.task, pub = snapshot?.published;
    const busy = ["DRAFT", "IN_REVIEW", "REJECTED"].includes(task?.state);
    const waiting = pending.has(id) || activating.has(id);
    toggle.disabled = !id || busy || waiting;
    toggle.setAttribute("aria-pressed", String(Boolean(id && pub && on(id))));
    toggle.setAttribute("aria-busy", String(busy || waiting));
    toggle.classList.toggle("ai-progress", busy || waiting);
    toggle.dataset.sectionId = id || "";
    toggle.textContent = busy ? (task.stage === "REVIEW" ? "✦ 审查中…" : "✦ 生成中…")
      : waiting ? "✦ 处理中…" : task?.state === "FAILED" || requestErrors.has(id) ? "✦ 行间教学 · 重试" : "✦ 行间教学";
    const ready = Boolean(pub) && !busy && !waiting && task?.state !== "FAILED" && !requestErrors.has(id);
    more.hidden = !ready;
    more.title = `${node?.title || "当前节"} · 更多操作`;
    generate.disabled = !ready;
    if (!ready || menuOwner !== id) {
      const focused = menu.contains(document.activeElement);
      closeMenu();
      if (focused) toggle.focus({preventScroll:true});
    }
    status.textContent = !id ? "当前位置不在已确定范围的节内，原 PDF 仍可阅读。" : !snapshot ? "正在读取已发布教学…"
      : busy ? (task.stage === "REVIEW" ? "正在独立审查，原 PDF 和已发布提示仍可使用。" : "正在生成少量提示，可继续阅读。")
      : task?.state === "FAILED" ? (task.terminal ? "本次未通过审查，点击以新版本重新生成。" : "本次生成或审查失败，点击重试当前阶段。") + (pub ? " 原教学仍保留。" : "")
      : pub?.no_intervention ? "已通过独立审查：本节暂不需要额外提示。"
      : pub ? (on(id) ? "已开启，点击关闭本节行间教学。" : "已关闭，点击开启本节行间教学。")
      : "点击为当前节生成提示，原 PDF 始终可用。";
    if (pub?.stale) status.textContent += " 来源已有更新，可重新生成。";
    if (pub?.omitted_count) status.textContent += ` ${pub.omitted_count} 个位置无法可靠确认，已隐藏。`;
    if (requestErrors.has(id)) status.textContent += ` ${requestErrors.get(id)}`;
    toggle.title = `${node?.title || "行间教学"}：${status.textContent}`;
    const selectedPub = cache.get(selected)?.published;
    const item = on(selected) && selectedPub?.content.items.find(i => i.id === active && selectedPub.sources[i.target_id]?.available);
    const identity = item ? `${selectedPub.id}:${item.id}` : "";
    if (content.dataset.identity === identity) return;
    content.dataset.identity = identity; content.replaceChildren();
    if (!item) { if (active) close(); return; }
    const title = document.createElement("strong"); title.textContent = labels[item.kind]; content.append(title);
    function text(field) {
      const p = document.createElement("p"); p.className = "inline-text"; p.dataset.field = field;
      p.textContent = item[field]; content.insertBefore(p, content.querySelector(".inline-actions")); return p;
    }
    text("text");
    if (item.kind === "recall") {
      text("prompt");
      const reveal = document.createElement("button"); reveal.type = "button"; reveal.textContent = "查看思路";
      reveal.onclick = () => { text("reference_thought"); reveal.remove(); };
      const skip = document.createElement("button"); skip.type = "button"; skip.textContent = "先跳过";
      skip.onclick = close;
      content.append(reveal, skip);
    }
    const ask = document.createElement("button"); ask.type = "button"; ask.className = "inline-assistant-action"; ask.textContent = "继续问AI";
    ask.onclick = () => explain(item.text, { source_kind: "INLINE_GUIDANCE", section_id: selected,
      asset_id: selectedPub.id, item_id: item.id, field: "text", start_offset: 0, end_offset: Array.from(item.text).length });
    const actions = document.createElement("div"); actions.className = "inline-actions";
    actions.append(ask); content.append(actions);
  }
  async function load(id, force = false) {
    if (!id || !revision) return;
    if (!force && cache.has(id)) return;
    if (loading.has(id)) return loading.get(id);
    const stamp = epoch;
    const work = (async () => {
      try {
        const snapshot = await api(base(id));
        if (stamp !== epoch) return;
        cache.set(id, snapshot); requestErrors.delete(id); repaint(); refresh(); schedule();
      } catch (e) { if (stamp === epoch) { requestErrors.set(id, e.message); refresh(); } }
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
  async function send(action, id) {
    const stamp = epoch;
    if (!id || pending.has(id) || ["DRAFT", "IN_REVIEW", "REJECTED"].includes(cache.get(id)?.task?.state)) return;
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
  function repaintActive() {
    const published = cache.get(selected)?.published;
    const item = published?.content.items.find(candidate => candidate.id === active);
    const index = item && published.sources[item.target_id]?.pdf_page_index;
    if (Number.isInteger(index)) renderPage(index);
  }
  function scheduleRepaint() {
    if (repaintFrame) return;
    repaintFrame = requestAnimationFrame(() => { repaintFrame = 0; repaint(); });
  }
  function renderPage(index) {
    if (revision !== state.revision?.id) { reset(); return; }
    const page = document.querySelector(`.page[data-index="${index}"]`);
    if (!page) return;
    const existing = new Map([...page.querySelectorAll(".inline-marker")].map(b => [`${b.dataset.assetId}:${b.dataset.itemId}`, b]));
    const occupied = [], bounds = page.getBoundingClientRect(), viewport = viewer.getBoundingClientRect();
    // Wait for the real OCR overlay before certifying blank page margins.
    const overlay = page.querySelector(".text-overlay");
    const obstacles = [...page.querySelectorAll(".learning-marker,.learning-marker-content,.section-guide-entry,.ocr-line")].map(e => e.getBoundingClientRect());
    let attached = false;
    for (const section of sections(index)) {
      const id = section.outline_node_id; load(id);
      const pub = cache.get(id)?.published;
      if (!pub || !on(id) || !overlay) continue;
      for (const item of pub.content.items) {
        const target = pub.sources[item.target_id];
        if (target?.pdf_page_index !== index) continue;
        if (target.available && active === item.id && selected === id) {
          if (panel.parentElement !== page) page.append(panel);
          panel.hidden = false;
          panel.style.top = `${Math.max(0, Math.min(target.quad.reduce((sum, p) => sum + p[1], 0) / 4 * bounds.height - 12, bounds.height - panel.offsetHeight - 8))}px`;
          attached = true;
        }
        const placement = placeInline(target, bounds, viewport, obstacles, occupied);
        if (!placement) continue;
        occupied.push(placement);
        const identity = `${pub.id}:${item.id}`;
        const b = existing.get(identity) || document.createElement("button"); existing.delete(identity);
        b.type = "button"; b.className = "inline-marker";
        b.dataset.itemId = item.id; b.dataset.assetId = pub.id; b.dataset.sectionId = id;
        b.textContent = "✦"; b.setAttribute("aria-label", `${labels[item.kind]} · ${section.title}`);
        b.setAttribute("aria-expanded", String(active === item.id && selected === id)); b.setAttribute("aria-controls", "inline-panel");
        b.style.top = `${placement.y * 100}%`; b.style.left = `${placement.left - bounds.left}px`;
        b.onclick = () => open(id, item.id);
        if (b.parentElement !== page) page.append(b);
      }
    }
    for (const b of existing.values()) b.remove();
    if (panel.parentElement === page && !attached) { panel.hidden = true; panel.remove(); }
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
  new ResizeObserver(scheduleRepaint).observe(viewer);
  new ResizeObserver(() => { if (active) scheduleRepaint(); }).observe(panel);
  viewer.addEventListener("scroll", () => {
    const id = currentSection();
    refresh(); load(id);
    repaint();
  }, { passive: true });
  reader.addEventListener("toggle", repaint, true);
  return { sync, renderPage, reset, close };
}
