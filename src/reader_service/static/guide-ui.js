import { renderAssistantAnswer, renderedSelectionToRaw } from "./assistant-render.js";

const GUIDE_DOCK_DEFAULT_WIDTH = 410;
const GUIDE_DOCK_MIN_WIDTH = 320;
const GUIDE_DOCK_MAX_WIDTH = 760;
const GUIDE_READER_MIN_WIDTH = 280;

export function createGuideUI({ state, api, streamGuide, goToPage, explain, layout, closeDock, setDockWidth, dockWidth, contextMenu, hideContextMenu }) {
  const panel = document.createElement("aside");
  panel.id = "guide-panel";
  panel.className = "guide-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "本节导读");
  panel.innerHTML = `<div id="guide-divider" role="separator" tabindex="0" aria-label="导读宽度" aria-orientation="vertical" aria-controls="guide-panel"></div>
    <div class="guide-heading"><strong id="guide-title">本节导读</strong><div class="guide-tools"><button id="guide-regenerate" type="button" hidden>重新生成</button><button id="guide-close" type="button" aria-label="收起导读">×</button></div></div>
    <div class="guide-meta"><p id="guide-status" role="status"></p><button id="guide-status-retry" type="button" hidden>重试</button></div>
    <div id="guide-scroll"><div id="guide-empty-state" class="guide-empty-state" hidden><p id="guide-empty-copy"></p><button id="guide-primary-action" type="button" hidden></button></div><section id="guide-draft" class="guide-draft" hidden><p id="guide-draft-label" class="guide-draft-label"></p><details id="guide-reasoning" class="guide-reasoning" hidden><summary id="guide-reasoning-label"></summary><div id="guide-reasoning-text"></div></details><div id="guide-draft-text" class="guide-draft-text"></div></section><p id="guide-published-label" class="guide-published-label" hidden>当前已发布版本</p><div id="guide-content"></div></div>`;
  document.getElementById("reader").append(panel);
  const title = panel.querySelector("#guide-title");
  const status = panel.querySelector("#guide-status");
  const statusRetry = panel.querySelector('#guide-status-retry');
  const emptyState = panel.querySelector('#guide-empty-state');
  const emptyCopy = panel.querySelector('#guide-empty-copy');
  const primaryAction = panel.querySelector('#guide-primary-action');
  const regenerate = panel.querySelector('#guide-regenerate');
  statusRetry.onclick = () => send(snapshot?.task?.terminal ? 'regenerate' : 'retry');
  primaryAction.onclick = () => send(primaryAction.dataset.action);
  regenerate.onclick = () => send('regenerate');
  const content = panel.querySelector("#guide-content");
  const draftSurface = panel.querySelector("#guide-draft");
  const draftLabel = panel.querySelector("#guide-draft-label");
  const reasoningSurface = panel.querySelector("#guide-reasoning");
  const reasoningLabel = panel.querySelector("#guide-reasoning-label");
  const reasoningContent = panel.querySelector("#guide-reasoning-text");
  const draftContent = panel.querySelector("#guide-draft-text");
  const publishedLabel = panel.querySelector("#guide-published-label");
  let sectionId = null, revisionId = null, snapshot = null, timer = 0, epoch = 0, pending = false;
  let renderedId = null, intent = null;
  let draftText = "", draftReasoning = "", draftProvider = null, draftStage = null;
  let reasoningWasActive = false, draftFrame = 0, streamAssetId = null, streamController = null;
  const reader = document.getElementById("reader"), scroll = panel.querySelector("#guide-scroll");
  const divider = panel.querySelector("#guide-divider");
  const reopen = document.createElement("button");
  reopen.id = "guide-reopen"; reopen.className = "toolbar-button";
  reopen.textContent = "导读"; reopen.title = "重新打开上次阅读的导读"; reopen.hidden = true;
  document.getElementById("outline-toggle").after(reopen);
  const positions = new Map();
  let width = 0, dragging = false;
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
    const min = Math.min(GUIDE_DOCK_MIN_WIDTH, Math.max(240, available - 24));
    const max = Math.max(min, Math.min(GUIDE_DOCK_MAX_WIDTH, available - GUIDE_READER_MIN_WIDTH));
    return { min, max };
  }
  function setWidth(value) {
    const saved = readingPosition(), { min, max } = limits();
    width = Math.round(Math.max(min, Math.min(max, value)));
    layout(() => setDockWidth ? setDockWidth(width) : reader.style.setProperty("--guide-width", `${width}px`));
    divider.setAttribute("aria-valuemin", String(Math.round(min)));
    divider.setAttribute("aria-valuemax", String(Math.round(max)));
    divider.setAttribute("aria-valuenow", String(width));
    restorePosition(saved);
  }
  function recenterCurrentPage() {
    const viewer = document.getElementById('viewer');
    const pageIndex = Math.max(0, Number(document.getElementById('page-number')?.value || 1) - 1);
    requestAnimationFrame(() => {
      const page = document.querySelector(`.page[data-index="${pageIndex}"]`);
      if (!page || !panel.hidden) return;
      const viewerRect = viewer.getBoundingClientRect(), pageRect = page.getBoundingClientRect();
      const delta = (pageRect.left + pageRect.right - viewerRect.left - viewerRect.right) / 2;
      if (Math.abs(delta) > .5) viewer.scrollLeft += delta;
    });
  }
  function close(collapsed = false, recenter = false) {
    suspended = false;
    if (panel.hidden && reopen.hidden) return;
    hideContextMenu(); savePosition(); clearTimeout(timer); stopDraftStream(); epoch++;
    layout(() => { panel.hidden = true; reader.classList.remove("guide-open"); });
    reopen.hidden = !collapsed;
    if (recenter) recenterCurrentPage();
  }
  panel.querySelector("#guide-close").onclick = () => close(true, true);
  reopen.onclick = () => open(sectionId);
  divider.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); dragging = true; panel.classList.add("resizing"); divider.setPointerCapture(event.pointerId);
  };
  divider.onpointermove = event => {
    if (!dragging) return;
    setWidth(reader.getBoundingClientRect().right - event.clientX);
  };
  const finishDrag = () => { dragging = false; panel.classList.remove("resizing"); savePosition(); };
  divider.onpointerup = finishDrag; divider.onpointercancel = finishDrag; divider.onlostpointercapture = finishDrag;
  divider.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Enter') { close(true, true); reopen.focus(); return; }
    const { min, max } = limits();
    setWidth(event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? 24 : -24));
  };
  window.addEventListener("resize", () => { if (!panel.hidden) setWidth(width); });
  function base() { return `/api/revisions/${revisionId}/sections/${sectionId}/guide`; }
  function clearDraft() {
    draftText = ""; draftReasoning = ""; draftProvider = null; draftStage = null; reasoningWasActive = false;
    if (draftFrame) cancelAnimationFrame(draftFrame);
    draftFrame = 0; draftContent.replaceChildren(); reasoningContent.textContent = "";
    reasoningSurface.hidden = true; reasoningSurface.open = false;
    draftSurface.hidden = true; publishedLabel.hidden = true;
  }
  function paintDraft() {
    draftFrame = 0;
    const hasReasoning = Boolean(draftReasoning), visible = hasReasoning || Boolean(draftText);
    draftSurface.hidden = !visible;
    publishedLabel.hidden = !visible || !snapshot?.published;
    if (!visible) { draftContent.replaceChildren(); reasoningContent.textContent = ""; return; }
    draftLabel.textContent = draftStage === "review" ? "生成草稿 · 审查中"
      : draftStage === "revising" ? "生成草稿 · 修订中"
      : draftStage === "reasoning" ? "生成草稿 · 思考中" : "生成草稿 · 尚未发布";
    reasoningSurface.hidden = !hasReasoning;
    if (hasReasoning) {
      const name = draftProvider === "deepseek" ? "DeepSeek" : "模型";
      reasoningLabel.textContent = draftStage === "reasoning" ? `${name} 正在思考…` : `${name} 思考过程`;
      reasoningContent.textContent = draftReasoning;
      if (draftStage === "reasoning" && !reasoningWasActive) reasoningSurface.open = true;
      if (draftStage !== "reasoning" && reasoningWasActive) reasoningSurface.open = false;
    }
    reasoningWasActive = draftStage === "reasoning";
    renderAssistantAnswer(draftContent, draftText);
  }
  function scheduleDraftPaint() {
    if (!draftFrame) draftFrame = requestAnimationFrame(paintDraft);
  }
  function stopDraftStream() {
    streamController?.abort(); streamController = null; streamAssetId = null;
  }
  function startDraftStream(assetId) {
    if (!assetId || streamAssetId === assetId || typeof streamGuide !== "function") return;
    stopDraftStream(); streamAssetId = assetId;
    const controller = new AbortController(); streamController = controller;
    const stamp = epoch;
    streamGuide(`${base()}/events?asset_id=${encodeURIComponent(assetId)}`, { signal: controller.signal }, event => {
      if (stamp !== epoch || controller.signal.aborted) return;
      if (event.type === "draft") {
        draftText = event.text || ""; draftReasoning = event.reasoning || "";
        draftProvider = event.provider || null; draftStage = event.stage || "generating";
        scheduleDraftPaint(); render();
      } else if (event.type === "complete") {
        clearDraft(); stopDraftStream(); load();
      } else if (event.type === "error") {
        clearDraft(); stopDraftStream(); load();
      }
    }).catch(error => {
      if (controller.signal.aborted || stamp !== epoch) return;
      stopDraftStream(); clearDraft(); status.textContent = error.message; load();
    });
  }
  function render() {
    title.textContent = `${snapshot.section.title} · 导读`;
    const task = snapshot.task, published = snapshot.published;
    const busy = task && ["DRAFT", "REJECTED", "IN_REVIEW"].includes(task.state);
    statusRetry.hidden = task?.state !== 'FAILED' || !published; statusRetry.disabled = pending;
    statusRetry.textContent = task?.terminal ? '重新生成' : '重试';
    status.classList.toggle("ai-progress", Boolean(busy || pending));
    status.textContent = pending ? "准备中…" : draftStage === "review" ? "生成草稿 · 审查中"
      : draftStage === "revising" ? "审查意见已返回，正在修订草稿…"
      : draftStage === "reasoning" ? "生成草稿 · 正在思考…"
      : draftStage === "generating" ? "生成草稿 · 正文持续生成中…"
      : draftStage === "preparing" ? "准备导读…" : busy ? (task.stage === "REVIEW" ? "正在独立审查…" : "正在生成导读…")
      : task?.state === "FAILED" ? (task.terminal ? "导读未通过审查，已停止本次生成。" : "本次导读生成或审查失败，可重试当前阶段。")
      : published ? "已通过独立审查。" : "按需生成本节简明导读，教材阅读始终可用。";
    if (published?.stale) status.textContent += " 教材依赖已变化，保留原导读，可重新生成。";
    if (task?.state === "FAILED" && task.failure_detail) status.textContent += ` ${task.failure_detail}`;
    if (published && task?.state === "FAILED") status.textContent += " 原导读仍可使用。";
    status.title = status.textContent;
    if (task?.state === "FAILED" && published) {
      status.textContent = task.terminal ? "本次导读未通过审查，原导读仍可阅读。" : "本次生成失败，原导读仍可阅读。点击重试。";
      status.setAttribute("aria-label", status.title);
    } else status.removeAttribute("aria-label");
    regenerate.hidden = !published || Boolean(busy) || task?.state === 'FAILED';
    regenerate.disabled = pending;
    emptyState.hidden = Boolean(published || draftText || draftReasoning);
    primaryAction.hidden = true;
    primaryAction.disabled = pending || Boolean(busy);
    emptyState.classList.toggle('busy', Boolean(pending || busy));
    if (!published) {
      if (pending) emptyCopy.textContent = '正在准备本节导读…';
      else if (busy) emptyCopy.textContent = task.stage === 'REVIEW' || task.state === 'IN_REVIEW'
        ? '正在独立审查本节导读…' : task.state === 'REJECTED'
          ? '审查意见已返回，正在修订导读…' : '正在生成本节导读…';
      else if (task?.state === 'FAILED') {
        emptyCopy.textContent = task.terminal
          ? '本节导读未通过审查，可以重新生成。'
          : '本次生成或审查失败，可以从失败阶段重试。';
        primaryAction.hidden = false;
        primaryAction.dataset.action = task.terminal ? 'regenerate' : 'retry';
        primaryAction.textContent = task.terminal ? '重新生成本节导读' : '重试生成';
      } else {
        emptyCopy.textContent = '生成并审查一份本节阅读导读。生成期间 PDF 始终可读。';
        primaryAction.hidden = false;
        primaryAction.dataset.action = 'generate';
        primaryAction.textContent = '生成本节导读';
      }
    }
    if (busy && task?.id) startDraftStream(task.id);
    // Polling must not destroy a live native selection or the old published Guide.
    if (renderedId !== (published?.id || null)) {
      renderedId = published?.id || null;
      content.replaceChildren();
      for (const module of published?.content.modules || []) {
        const block = document.createElement("section"), heading = document.createElement("h3"), text = document.createElement("div");
        heading.textContent = module.title;
        renderAssistantAnswer(text, module.text);
        text.dataset.moduleId = module.id;
        text.className = "guide-text";
        // Storage fragments need no second heading when the article already supplies one.
        if (!text.firstElementChild?.matches("h1,h2,h3,h4,h5,h6")) block.append(heading);
        block.append(text);
        const references = document.createElement("div"); references.className = "guide-references";
        const sourceId = module.source_ids.find(id => published.sources[id]?.available) || module.source_ids[0];
        const source = published.sources[sourceId], b = document.createElement("button");
        b.type = "button"; b.className = "guide-source";
        b.textContent = "查看教材位置";
        b.title = source?.available ? `查看教材 · PDF ${source.pdf_page_index + 1}` : "来源位置待核实";
        b.setAttribute("aria-label", `${module.title} · ${b.title}`);
        b.disabled = !source?.available;
        b.onclick = async () => {
            const stamp = epoch;
            try {
              const fresh = await api(base());
              if (stamp !== epoch) return;
              const verified = fresh.published?.id === published.id && fresh.published.sources[sourceId];
              if (!verified?.available) { status.textContent = "该教材位置已变化，请重新生成导读。"; return; }
              goToPage(verified.pdf_page_index, verified.y);
              savePosition();
            } catch (error) { status.textContent = error.message; }
        };
        references.append(b);
        block.append(references);
        content.append(block);
      }
      restorePosition(positions.get(locationKey()));
    }
    if (busy && !panel.hidden) { clearTimeout(timer); timer = setTimeout(load, 700); }
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
      if (snapshot.task?.id) startDraftStream(snapshot.task.id);
    } catch (error) {
      if (stamp === epoch) { pending = false; render(); status.textContent = error.message; }
      return;
    } finally { if (stamp === epoch) pending = false; }
    if (stamp === epoch) render();
  }
  scroll.addEventListener("scroll", hideContextMenu, { passive: true });
  content.addEventListener("contextmenu", event => {
    const selected = window.getSelection();
    hideContextMenu();
    if (!selected || selected.isCollapsed || selected.rangeCount !== 1) return;
    const range = selected.getRangeAt(0);
    const parent = range.startContainer.parentElement?.closest(".guide-text");
    if (!parent || !parent.contains(range.endContainer)) return;
    const mapped = renderedSelectionToRaw(range, parent);
    if (!mapped || mapped.blocked) return;
    const start = mapped.startOffset, end = mapped.endOffset;
    const module = snapshot.published.content.modules.find(m => m.id === parent.dataset.moduleId);
    // The server validates offsets against stored Markdown, not rendered DOM text.
    const rawSelection = Array.from(module.text).slice(start, end).join("");
    const rects = [...range.getClientRects()];
    if ((event.clientX || event.clientY) && !rects.some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)) return;
    event.preventDefault();
    const selection = { source_kind: "READING_GUIDE", section_id: sectionId, asset_id: snapshot.published.id,
      module_id: parent.dataset.moduleId, start_offset: start, end_offset: end };
    const rect = rects[0];
    contextMenu(event.clientX || rect?.left || 0, event.clientY || rect?.bottom || 0,
      mapped.selectedText, () => {
        suspend(); explain(mapped.selectedText, selection);
      });
  });
  let suspended = false, suspendedScroll = 0;
  function suspend() {
    if (panel.hidden) return;
    savePosition();
    suspendedScroll = scroll.scrollTop;
    suspended = true;
    hideContextMenu();
    panel.hidden = true; reader.classList.remove("guide-open");
    reopen.hidden = false;
  }
  async function open(id) {
    if (suspended && id === sectionId && revisionId === state.revision.id) {
      closeDock(); reopen.hidden = true; suspended = false;
      panel.hidden = false; reader.classList.add("guide-open");
      setWidth(dockWidth?.() || width || GUIDE_DOCK_DEFAULT_WIDTH);
      scroll.scrollTop = suspendedScroll;
      clearTimeout(timer); timer = setTimeout(load, 700);
      return;
    }
    suspended = false;
    close(); sectionId = id; revisionId = state.revision.id; snapshot = null; renderedId = null; pending = false;
    content.replaceChildren(); intent = null;
    clearDraft();
    regenerate.hidden = true; emptyState.hidden = true;
    closeDock(); reopen.hidden = true;
    layout(() => { panel.hidden = false; reader.classList.add("guide-open"); });
    setWidth(dockWidth?.() || width || GUIDE_DOCK_DEFAULT_WIDTH);
    status.textContent = "正在读取导读…";
    for (const id of ["outline-panel", "knowledge-panel", "search-panel", "marks-panel"]) document.getElementById(id).hidden = true;
    await load();
  }
  return { close, open, suspend };
}
