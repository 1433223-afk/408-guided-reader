export function createGuideUI({ state, api, goToPage, explain, layout, closeDock }) {
  const panel = document.createElement("aside");
  panel.id = "guide-panel";
  panel.className = "guide-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "本节导读");
  panel.innerHTML = `<div id="guide-divider" role="separator" tabindex="0" aria-label="导读宽度" aria-orientation="vertical" aria-controls="guide-panel"></div>
    <div class="guide-heading"><strong id="guide-title">本节导读</strong><button id="guide-expand" type="button">展开导读</button><button id="guide-close" type="button">收起</button></div>
    <div class="guide-meta"><p id="guide-status" role="status"></p><div id="guide-actions"></div></div>
    <div id="guide-scroll"><div id="guide-content"></div></div>
    <button id="guide-explain" type="button" hidden>解释所选导读</button>`;
  document.getElementById("reader").append(panel);
  const title = panel.querySelector("#guide-title");
  const status = panel.querySelector("#guide-status");
  const actions = panel.querySelector("#guide-actions");
  const content = panel.querySelector("#guide-content");
  const explainButton = panel.querySelector("#guide-explain");
  let sectionId = null, revisionId = null, snapshot = null, timer = 0, epoch = 0, pending = false;
  let selection = null, renderedId = null, intent = null;
  const reader = document.getElementById("reader"), scroll = panel.querySelector("#guide-scroll");
  const divider = panel.querySelector("#guide-divider"), expand = panel.querySelector("#guide-expand");
  const reopen = document.createElement("button");
  reopen.id = "guide-reopen"; reopen.textContent = "展开导读"; reopen.hidden = true; reader.append(reopen);
  const positions = new Map();
  let width = 0, normalWidth = 0, expanded = false, dragging = false;
  const locationKey = () => `${revisionId}:${sectionId}:${renderedId}`;
  function readingPosition() {
    const top = scroll.getBoundingClientRect().top;
    const texts = [...content.querySelectorAll(".guide-text")];
    const item = texts.find(t => t.getBoundingClientRect().bottom > top);
    if (!item) return { scroll: scroll.scrollTop };
    const rect = item.getBoundingClientRect();
    return { id: item.dataset.moduleId, fraction: Math.max(0, (top - rect.top) / rect.height),
      gap: Math.max(0, rect.top - top), scroll: scroll.scrollTop };
  }
  function restorePosition(saved) {
    if (!saved) return;
    const item = [...content.querySelectorAll(".guide-text")].find(t => t.dataset.moduleId === saved.id);
    if (!item) { scroll.scrollTop = saved.scroll; return; }
    const rect = item.getBoundingClientRect();
    scroll.scrollTop += rect.top - scroll.getBoundingClientRect().top + rect.height * saved.fraction - saved.gap;
  }
  function savePosition() { if (renderedId && !panel.hidden) positions.set(locationKey(), readingPosition()); }
  function limits() {
    const available = reader.clientWidth;
    return { min: Math.min(360, available * .45), max: Math.max(available * .45, available - Math.min(320, available * .4)) };
  }
  function setWidth(value) {
    const saved = readingPosition(), { min, max } = limits();
    width = Math.round(Math.max(min, Math.min(max, value)));
    layout(() => reader.style.setProperty("--guide-width", `${width}px`));
    divider.setAttribute("aria-valuemin", String(Math.round(min)));
    divider.setAttribute("aria-valuemax", String(Math.round(max)));
    divider.setAttribute("aria-valuenow", String(width));
    restorePosition(saved);
  }
  function setExpanded(value) {
    if (value === expanded) return;
    if (value) normalWidth = width;
    expanded = value;
    expand.textContent = value ? "恢复双栏" : "展开导读";
    expand.setAttribute("aria-pressed", String(value));
    setWidth(value ? reader.clientWidth * .65 : normalWidth);
  }
  function close(collapsed = false) {
    if (panel.hidden && reopen.hidden) return;
    savePosition(); clearTimeout(timer); epoch++;
    layout(() => { panel.hidden = true; reader.classList.remove("guide-open"); });
    reopen.hidden = !collapsed;
  }
  panel.querySelector("#guide-close").onclick = () => close(true);
  reopen.onclick = () => open(sectionId);
  expand.onclick = () => setExpanded(!expanded);
  divider.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); dragging = true; divider.setPointerCapture(event.pointerId);
  };
  divider.onpointermove = event => {
    if (!dragging) return;
    setWidth(reader.getBoundingClientRect().right - event.clientX);
    if (!expanded) normalWidth = width;
  };
  const finishDrag = () => { dragging = false; savePosition(); };
  divider.onpointerup = finishDrag; divider.onpointercancel = finishDrag; divider.onlostpointercapture = finishDrag;
  divider.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') { close(true); reopen.focus(); return; }
    const { min, max } = limits();
    setWidth(event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? 24 : -24));
    if (!expanded) normalWidth = width;
  };
  window.addEventListener("resize", () => { if (!panel.hidden) setWidth(expanded ? reader.clientWidth * .65 : width); });
  function base() { return `/api/revisions/${revisionId}/sections/${sectionId}/guide`; }
  function button(label, action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.disabled = pending; b.onclick = () => send(action); actions.append(b);
  }
  function render() {
    title.textContent = `${snapshot.section.title} · 导读`;
    const task = snapshot.task, published = snapshot.published;
    const busy = task && ["DRAFT", "REJECTED", "IN_REVIEW"].includes(task.state);
    status.textContent = busy ? (task.stage === "REVIEW" ? "正在独立审查…" : "正在生成导读…")
      : task?.state === "FAILED" ? (task.terminal ? "导读未通过审查，已停止本次生成。" : "本次导读生成或审查失败，可重试当前阶段。")
      : published ? "已通过独立审查。" : "按需生成本节简明导读，教材阅读始终可用。";
    if (published?.stale) status.textContent += " 教材依赖已变化，保留原导读，可重新生成。";
    if (task?.state === "FAILED" && task.failure_detail) status.textContent += ` ${task.failure_detail}`;
    if (published && task?.state === "FAILED") status.textContent += " 原导读仍可使用。";
    actions.replaceChildren();
    if (!busy) {
      if (task?.state === "FAILED" && !task.terminal) button("重试", "retry");
      button(published ? "重新生成" : "生成本节导读", published || task?.terminal ? "regenerate" : "generate");
    }
    // Polling must not destroy a live native selection or the old published Guide.
    if (renderedId !== (published?.id || null)) {
      renderedId = published?.id || null;
      content.replaceChildren();
      for (const module of published?.content.modules || []) {
        const block = document.createElement("section"), heading = document.createElement("h3"), text = document.createElement("p");
        heading.textContent = module.title;
        text.textContent = module.text;
        text.dataset.moduleId = module.id;
        text.className = "guide-text";
        block.append(heading, text);
        const references = document.createElement("div"); references.className = "guide-references";
        for (const [i, sourceId] of module.source_ids.entries()) {
          const source = published.sources[sourceId], b = document.createElement("button");
          b.type = "button"; b.className = "guide-source";
          b.textContent = `[${i + 1}]`;
          b.title = source.available ? `查看教材 · PDF ${source.pdf_page_index + 1}` : "来源位置待核实";
          b.setAttribute("aria-label", `${module.title} · 来源 ${i + 1} · ${b.title}`);
          b.disabled = !source.available;
          b.onclick = async () => {
            const stamp = epoch;
            try {
              const fresh = await api(base());
              if (stamp !== epoch) return;
              const verified = fresh.published?.id === published.id && fresh.published.sources[sourceId];
              if (!verified?.available) { status.textContent = "该教材位置已变化，请重新生成导读。"; return; }
              if (expanded) setExpanded(false);
              goToPage(verified.pdf_page_index, verified.y);
              savePosition();
            } catch (error) { status.textContent = error.message; }
          };
          references.append(b);
        }
        block.append(references);
        content.append(block);
      }
      restorePosition(positions.get(locationKey()));
    }
    if (busy && !panel.hidden) timer = setTimeout(load, 700);
  }
  async function load() {
    const stamp = epoch;
    try {
      const value = await api(base());
      if (stamp !== epoch || state.revision?.id !== revisionId) return;
      snapshot = value; render();
    } catch (error) { if (stamp === epoch) status.textContent = error.message; }
  }
  async function send(action) {
    if (pending) return;
    pending = true; render();
    const stamp = epoch;
    if (!intent || intent.action !== action) intent = { action, id: crypto.randomUUID() };
    try {
      const result = await api(`${base()}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "retry" ? { asset_id: snapshot.task.id } : { intent_id: intent.id }) });
      if (stamp !== epoch) return;
      intent = null; snapshot = result;
    } catch (error) {
      if (stamp === epoch) { pending = false; render(); status.textContent = error.message; }
      return;
    } finally { if (stamp === epoch) pending = false; }
    if (stamp === epoch) render();
  }
  content.addEventListener("mouseup", () => {
    const selected = window.getSelection();
    selection = null; explainButton.hidden = true;
    if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return;
    const range = selected.getRangeAt(0);
    const parent = range.startContainer.parentElement?.closest(".guide-text");
    if (!parent || !parent.contains(range.endContainer)) return;
    const prefix = document.createRange(); prefix.selectNodeContents(parent); prefix.setEnd(range.startContainer, range.startOffset);
    // Server Python offsets count Unicode code points, not JavaScript UTF-16 units.
    const start = Array.from(prefix.toString()).length, end = start + Array.from(range.toString()).length;
    selection = { source_kind: "READING_GUIDE", section_id: sectionId, asset_id: snapshot.published.id,
      module_id: parent.dataset.moduleId, start_offset: start, end_offset: end, text: range.toString() };
    explainButton.hidden = false;
  });
  explainButton.onmousedown = (event) => event.preventDefault();
  explainButton.onclick = () => { if (selection) { const { text, ...request } = selection; close(); explain(text, request); } };
  async function open(id) {
    close(); sectionId = id; revisionId = state.revision.id; snapshot = null; renderedId = null; pending = false;
    content.replaceChildren(); actions.replaceChildren(); explainButton.hidden = true; intent = null;
    closeDock(); reopen.hidden = true;
    layout(() => { panel.hidden = false; reader.classList.add("guide-open"); });
    setWidth(width || reader.clientWidth * .45);
    status.textContent = "正在读取导读…";
    for (const id of ["outline-panel", "knowledge-panel", "search-panel", "marks-panel"]) document.getElementById(id).hidden = true;
    await load();
  }
  return { close, open };
}
