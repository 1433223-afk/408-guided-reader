import * as pdfjsLib from "/vendor/pdf.mjs";
import {
  lineBounds, nearestCellBoundary, nearestLine, resolveSelection, resolvedText,
  selectionPresentationQuads,
} from "/selection.js";
import { renderAssistantAnswer, renderedSelectionToRaw } from "/assistant-render.js";
import { createMasterUI } from "/master-ui.js";
import { createGuideUI } from "/guide-ui.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";

const elements = Object.fromEntries(
  ["library-home", "library-empty", "import-input", "book-list", "book-count", "reader", "reader-title", "viewer", "pages", "page-number", "page-total", "previous-page", "next-page", "zoom-out", "zoom-in", "zoom-value", "preparation-status", "printed-page-edit", "printed-page-label", "outline-toggle", "outline-panel", "outline-close", "outline-status", "outline-tree", "outline-empty", "knowledge-toggle", "knowledge-panel", "knowledge-close", "knowledge-title", "knowledge-status", "knowledge-prepare", "knowledge-map", "knowledge-empty", "status", "back-to-library", "search-toggle", "search-panel", "search-close", "search-form", "search-query", "search-coverage", "search-results", "search-empty", "marks-toggle", "marks-count", "marks-panel", "marks-page", "marks-list", "marks-empty", "marks-close", "assistant-toggle", "assistant-panel", "assistant-resize-handle", "assistant-expand", "assistant-title", "assistant-model", "assistant-model-lock", "assistant-close", "assistant-context-bar", "assistant-root-switcher", "assistant-back", "assistant-depth", "assistant-close-root", "assistant-breadcrumb", "assistant-children", "assistant-child-list", "assistant-scope", "assistant-first-turn", "assistant-draft-text", "assistant-start", "assistant-readiness", "assistant-turns", "assistant-empty", "assistant-follow-up", "assistant-question", "assistant-send", "assistant-answer-actions", "assistant-ask-deeper", "selection-actions", "copy-selection", "ask-selection", "save-highlight", "add-note", "cancel-selection", "note-editor", "annotation-note", "save-note"]
    .map((id) => [id, document.getElementById(id)]),
);

const query = new URLSearchParams(location.search);
const launchToken = query.get("token") || sessionStorage.getItem("reader-token") || "";
if (launchToken) {
  sessionStorage.setItem("reader-token", launchToken);
  if (query.has("token")) history.replaceState(null, "", location.pathname);
}

const state = {
  books: [], book: null, revision: null, pdf: null, zoom: 1,
  currentPage: 0, generation: 0, renderTasks: new Map(), rendered: new Set(),
  scrollFrame: 0, saveTimer: 0, resizeTimer: 0, priorityTimer: 0,
  preparation: new Map(), overlayData: new Map(), eventSource: null,
  annotationData: new Map(), guideSelection: null, selection: null, selecting: false, selectionMenuPoint: null,
  searchRequest: 0, searchMatch: null,
  outlineRequest: 0, outlineNodes: [], pageLabels: new Map(), mapTimer: 0,
  knowledgeRequest: 0, knowledgeChapterId: null, knowledgeMap: null,
  knowledgePollTimer: 0,
  readerSessionId: null, assistantConfigured: false, assistantCooling: false,
  assistantActiveProvider: "deepseek", assistantModelSelectionInitialized: false,
  assistantStatusAvailable: false, assistantOffReason: null,
  assistantState: { version: 0, roots: [], focused_ref: null, current: null },
  assistantDraft: null, assistantAnswerSelection: null, assistantProviderStatuses: [],
  assistantSaveIntents: new Map(), assistantSavedTurns: new Map(),
  assistantReviewPolls: new Map(),
  assistantPending: false, assistantStatusTimer: 0,
  assistantScrollPositions: new Map(), assistantChildRequests: new Map(),
  assistantDockWidth: 410, assistantDockWidthBeforeExpanded: 410,
  assistantExpanded: false, assistantResizeAnchor: null,
};

const master = createMasterUI({ api, revision: () => state.revision?.id,
  pages: elements.pages, dock: elements["assistant-panel"],
  openDock: (open) => open ? openAssistantPanel() : setAssistantPanelOpen(false),
  goToPage, announce, relayout: () => relayoutPages() });

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const ASSISTANT_PROVIDER_LABELS = {
  deepseek: "DeepSeek", zhipu: "Zhipu", openrouter: "OpenRouter",
};
const ASSISTANT_DOCK_MIN_WIDTH = 320;
const ASSISTANT_DOCK_MAX_WIDTH = 760;
const ASSISTANT_READER_MIN_WIDTH = 280;

const guide = createGuideUI({ state, api, goToPage,
  hideContextMenu: hideSelectionActions,
  contextMenu: (x, y, text, explain) => {
    hideSelectionActions();
    state.selection = null;
    document.querySelectorAll(".selection-quad").forEach(node => node.remove());
    state.guideSelection = { text, explain };
    syncAskEligibility(); showSelectionActions(x, y);
  },
  layout: change => { const anchor = captureZoomAnchor(); change(); if (state.revision) relayoutPages(anchor); },
  closeDock: () => setAssistantPanelOpen(false, { relayout: false }),
  explain: (selectedText, request) => {
  if (!state.readerSessionId || state.assistantPending) return;
  state.assistantDraft = { readerSessionId: state.readerSessionId, revisionId: state.revision.id, selectedText, request };
  openAssistantPanel(); renderAssistantDraft(); refreshAssistantStatus();
} });

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "X-Reader-Token": launchToken, ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({ error: `请求失败（${response.status}）` }));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败（${response.status}）`);
    error.code = payload.code || `HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function announce(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
  elements.status.classList.add("visible");
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => elements.status.classList.remove("visible"), error ? 6000 : 2800);
}

async function loadBooks() {
  const payload = await api("/api/books");
  state.books = payload.books;
  elements["book-count"].textContent = String(state.books.length);
  renderLibrary();
  elements["library-empty"].hidden = state.books.length > 0;
}

function renderLibrary() {
  const cards = state.books.map((book) => {
    const active = book.status === "ACTIVE" && book.active_revision;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `book-card${state.book?.id === book.id ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "book-card-title";
    title.textContent = book.title;
    const meta = document.createElement("span");
    meta.className = "book-card-meta";
    const pages = document.createElement("span");
    pages.textContent = active ? `${book.active_revision.page_count} 个 PDF 页面` : "删除未完成";
    const actions = document.createElement("span");
    actions.className = "book-actions";
    if (active) {
      const revision = document.createElement("button");
      revision.type = "button";
      revision.className = "book-action";
      revision.textContent = book.revision_count > 1 ? `${book.revision_count} 个版本 · 添加` : "添加新版本";
      revision.title = "为本书导入另一份 PDF，作为不可变的新版本";
      revision.addEventListener("click", (event) => {
        event.stopPropagation();
        chooseRevision(book);
      });
      actions.append(revision);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "book-action danger";
    remove.textContent = active ? "删除" : "重试删除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeBook(book);
    });
    actions.append(remove);
    meta.append(pages, actions);
    card.append(title, meta);
    if (active) card.addEventListener("click", () => openBook(book));
    return card;
  });
  elements["book-list"].replaceChildren(...cards);
}

function chooseRevision(book) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.addEventListener("change", () => input.files[0] && importPdf(input.files[0], book.id));
  input.click();
}

async function importPdf(file, bookId = null) {
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    announce("请选择 PDF 文件。", true);
    return;
  }
  announce(bookId ? "正在验证新来源版本……" : "正在验证并导入 PDF……");
  const parameters = new URLSearchParams();
  if (bookId) parameters.set("book_id", bookId);
  try {
    const result = await api(`/api/books?${parameters}`, {
      method: "POST",
      headers: { "X-File-Name": encodeURIComponent(file.name), "Content-Type": "application/pdf" },
      body: file,
    });
    state.book = null;
    await loadBooks();
    const refreshed = state.books.find((book) => book.id === result.book.id) || result.book;
    await openBook(refreshed);
    announce(result.duplicate ? "书库中已有这份文件，没有重复导入。" : (bookId ? "已添加新来源版本。" : "PDF 已导入，可以开始阅读。"));
  } catch (_error) {
    announce("导入失败，请检查 PDF 后重试。", true);
  } finally {
    elements["import-input"].value = "";
  }
}

async function removeBook(book) {
  const confirmed = window.confirm(`删除《${book.title}》？\n\n这会永久删除本应用中保存的 PDF 版本、阅读位置、学习地图、高亮和笔记，且无法撤销。`);
  if (!confirmed) return;
  try {
    await api(`/api/books/${book.id}`, { method: "DELETE" });
    if (state.book?.id === book.id) state.book = null;
    await loadBooks();
    announce("已删除教材、阅读位置、学习地图、高亮和笔记。");
  } catch (_error) {
    if (state.book?.id === book.id) state.book = null;
    await loadBooks();
    announce("删除未完成，请重试。", true);
  }
}

async function openBook(book) {
  if (state.book?.id === book.id && state.pdf) return;
  state.generation += 1;
  const generation = state.generation;
  cancelRenders();
  closePreparationStream();
  state.book = book;
  state.revision = book.active_revision;
  state.readerSessionId = crypto.randomUUID();
  state.assistantState = emptyAssistantState();
  state.assistantDraft = null;
  state.assistantAnswerSelection = null;
  state.assistantSaveIntents.clear();
  state.assistantSavedTurns.clear();
  clearAssistantReviewPolls();
  clearTimeout(state.knowledgePollTimer);
  state.knowledgeChapterId = null;
  state.knowledgeMap = null;
  state.annotationData.clear();
  state.assistantScrollPositions.clear();
  state.assistantChildRequests.clear();
  state.zoom = state.revision.position.zoom || 1;
  state.currentPage = state.revision.position.pdf_page_index || 0;
  state.pdf = null;
  elements["reader-title"].textContent = book.title;
  elements["library-home"].hidden = true;
  elements.reader.hidden = false;
  elements["page-total"].textContent = `/ ${state.revision.page_count}`;
  elements["page-number"].max = String(state.revision.page_count);
  elements["zoom-value"].textContent = `${Math.round(state.zoom * 100)}%`;
  renderLibrary();
  elements.pages.replaceChildren();
  buildPlaceholders();
  resetAssistantPanel();
  master.reset();
  master.refreshEntries().catch((error) => announce(error.message, true));
  refreshAssistantStatus();
  try {
    const loading = pdfjsLib.getDocument({
      url: `/api/revisions/${state.revision.id}/pdf`,
      httpHeaders: { "X-Reader-Token": launchToken },
      withCredentials: true,
    });
    const pdf = await loading.promise;
    if (generation !== state.generation) return;
    if (pdf.numPages !== state.revision.page_count) throw new Error("保存的 PDF 元数据与来源文件不再一致");
    await nextFrame();
    if (generation !== state.generation) return;
    applyRestoredPosition();
    state.pdf = pdf;
    scheduleViewportUpdate();
    await startPreparation();
    await loadBookMap();
  } catch (_error) {
    announce("无法打开这份 PDF，请重试。", true);
  }
}

function closeReader() {
  guide.close();
  state.generation += 1;
  cancelRenders();
  closePreparationStream();
  clearSelection();
  clearSearchMatch();
  state.book = null;
  state.revision = null;
  master.reset();
  state.pdf = null;
  state.readerSessionId = null;
  state.assistantState = emptyAssistantState();
  state.assistantDraft = null;
  state.assistantAnswerSelection = null;
  state.assistantSaveIntents.clear();
  state.assistantSavedTurns.clear();
  clearAssistantReviewPolls();
  state.annotationData.clear();
  clearTimeout(state.knowledgePollTimer);
  state.knowledgeChapterId = null;
  state.knowledgeMap = null;
  state.assistantScrollPositions.clear();
  state.assistantChildRequests.clear();
  elements.reader.hidden = true;
  elements["marks-panel"].hidden = true;
  elements["search-panel"].hidden = true;
  elements["outline-panel"].hidden = true;
  elements["knowledge-panel"].hidden = true;
  setAssistantPanelOpen(false, { relayout: false });
  elements["outline-toggle"].setAttribute("aria-expanded", "false");
  elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
  elements["search-toggle"].setAttribute("aria-expanded", "false");
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
  elements["library-home"].hidden = false;
  elements.pages.replaceChildren();
  state.outlineRequest += 1;
  state.outlineNodes = [];
  state.knowledgeRequest += 1;
  state.pageLabels.clear();
  clearTimeout(state.mapTimer);
  clearTimeout(state.assistantStatusTimer);
  renderLibrary();
}

async function returnToLibrary() {
  await savePosition();
  try {
    await clearAssistantSession();
  } catch (_error) {
    announce("临时 AI 对话未能清除，请重试关闭 Reader。", true);
    return;
  }
  closeReader();
}

function displayedRatio(geometry) {
  const [x0, y0, x1, y1] = geometry.media_box;
  const width = x1 - x0;
  const height = y1 - y0;
  return geometry.rotation % 180 === 0 ? height / width : width / height;
}

function pageWidth() {
  const gutter = elements.pages.classList.contains("has-learning-controls") ? 176 : 0;
  return Math.max(240, Math.min(920, elements.viewer.clientWidth - 72 - gutter)) * state.zoom;
}

function snappedPageSize(ratio) {
  const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  const targetWidth = pageWidth();
  const width = alignedCssDimension(targetWidth, pixelRatio);
  const height = alignedCssDimension(width.css * ratio, pixelRatio);
  return {
    pixelRatio,
    backingWidth: width.backing,
    backingHeight: height.backing,
    cssWidth: width.css,
    cssHeight: height.css,
  };
}

function alignedCssDimension(target, pixelRatio) {
  const center = Math.round(target * 64);
  let exact = null;
  let closest = null;
  for (let offset = -512; offset <= 512; offset += 1) {
    const css = (center + offset) / 64;
    const physical = css * pixelRatio;
    const backing = Math.round(physical);
    const pixelError = Math.abs(physical - backing);
    const distance = Math.abs(css - target);
    const candidate = { css, backing, distance, pixelError };
    if (pixelError <= 1e-7 && (!exact || distance < exact.distance)) exact = candidate;
    if (!closest || pixelError < closest.pixelError - 1e-9 || (
      Math.abs(pixelError - closest.pixelError) <= 1e-9 && distance < closest.distance
    )) closest = candidate;
  }
  return exact || closest;
}

function applyPageSize(wrapper, size) {
  wrapper.style.width = `${size.cssWidth}px`;
  wrapper.style.height = `${size.cssHeight}px`;
  const gutter = elements.pages.classList.contains("has-learning-controls") ? 176 : 0;
  const fits = size.cssWidth <= elements.viewer.clientWidth - 64 - gutter;
  const naturalLeft = fits ? (elements.viewer.clientWidth - gutter - size.cssWidth) / 2 : 32;
  const alignedLeft = alignedCssDimension(naturalLeft, size.pixelRatio).css;
  wrapper.style.marginLeft = `${Math.max(0, alignedLeft - 32)}px`;
  wrapper.style.marginRight = "0";
}

function buildPlaceholders() {
  const pages = state.revision.page_geometry.map((geometry, index) => {
    const size = snappedPageSize(displayedRatio(geometry));
    const page = document.createElement("article");
    page.className = "page";
    page.dataset.index = String(index);
    page.dataset.page = String(index + 1);
    applyPageSize(page, size);
    return page;
  });
  elements.pages.replaceChildren(...pages);
}

function applyRestoredPosition() {
  const page = elements.pages.children[state.currentPage];
  if (!page) return;
  const offset = state.revision.position.normalized_offset || 0;
  elements.viewer.scrollTop = snapScroll(page.offsetTop + page.offsetHeight * offset);
  setCurrentPage(state.currentPage);
}

function scheduleViewportUpdate() {
  if (state.scrollFrame) return;
  state.scrollFrame = requestAnimationFrame(() => {
    state.scrollFrame = 0;
    updateViewport();
  });
}

function updateViewport() {
  if (!state.pdf) return;
  const top = elements.viewer.scrollTop;
  const bottom = top + elements.viewer.clientHeight;
  let first = null;
  let last = 0;
  let bestIndex = 0;
  let bestDistance = Infinity;
  const viewportCenter = top + elements.viewer.clientHeight / 2;
  for (const page of elements.pages.children) {
    const index = Number(page.dataset.index);
    const pageTop = page.offsetTop;
    const pageBottom = pageTop + page.offsetHeight + parseFloat(page.style.marginBottom || "20");
    if (pageBottom >= top && first === null) first = index;
    if (pageTop <= bottom) last = index;
    const distance = Math.abs((pageTop + pageBottom) / 2 - viewportCenter);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  }
  setCurrentPage(bestIndex);
  const keepStart = Math.max(0, (first ?? 0) - 2);
  const keepEnd = Math.min(state.pdf.numPages - 1, last + 2);
  for (let index = keepStart; index <= keepEnd; index += 1) renderPage(index);
  for (const index of [...state.rendered]) {
    if (index < keepStart || index > keepEnd) clearPage(index);
  }
  scheduleSave();
  schedulePreparationPriority(keepStart, keepEnd);
}

async function renderPage(index) {
  if (!state.pdf || state.rendered.has(index) || state.renderTasks.has(index)) return;
  const generation = state.generation;
  const wrapper = elements.pages.children[index];
  wrapper.classList.add("loading");
  try {
    const page = await state.pdf.getPage(index + 1);
    if (generation !== state.generation) return;
    const base = page.getViewport({ scale: 1 });
    const size = snappedPageSize(base.height / base.width);
    const viewport = page.getViewport({ scale: size.backingWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = size.backingWidth;
    canvas.height = size.backingHeight;
    canvas.style.width = `${size.cssWidth}px`;
    canvas.style.height = `${size.cssHeight}px`;
    canvas.dataset.outputScaleX = String(size.pixelRatio);
    canvas.dataset.outputScaleY = String(size.pixelRatio);
    applyPageSize(wrapper, size);
    wrapper.replaceChildren(canvas);
    const canvasContext = canvas.getContext("2d", { alpha: false });
    canvasContext.imageSmoothingEnabled = true;
    canvasContext.imageSmoothingQuality = "high";
    const task = page.render({
      canvasContext,
      viewport,
      transform: [
        canvas.width / viewport.width,
        0,
        0,
        canvas.height / viewport.height,
        0,
        0,
      ],
    });
    state.renderTasks.set(index, task);
    await task.promise;
    if (generation === state.generation) {
      state.rendered.add(index);
      master.renderPage(index);
      renderGuideEntries(index);
      syncPagePreparationUi(index);
      ensureOverlay(index);
    }
  } catch (error) {
    if (error?.name !== "RenderingCancelledException") announce(`第 ${index + 1} 页无法显示，请重试。`, true);
  } finally {
    state.renderTasks.delete(index);
    wrapper?.classList.remove("loading");
  }
}

function clearPage(index) {
  const task = state.renderTasks.get(index);
  if (task) task.cancel();
  state.renderTasks.delete(index);
  state.rendered.delete(index);
  const wrapper = elements.pages.children[index];
  if (wrapper) wrapper.replaceChildren();
  if (state.selection?.pageIndex === index) clearSelection();
}

function cancelRenders() {
  for (const task of state.renderTasks.values()) task.cancel();
  state.renderTasks.clear();
  state.rendered.clear();
}

function setCurrentPage(index) {
  state.currentPage = Math.max(0, Math.min(index, (state.revision?.page_count || 1) - 1));
  elements["page-number"].value = String(state.currentPage + 1);
  updateMarksPanel();
  updatePrintedPageLabel();
}

function goToPage(index, offset = 0) {
  const bounded = Math.max(0, Math.min(index, state.revision.page_count - 1));
  const page = elements.pages.children[bounded];
  elements.viewer.scrollTop = snapScroll(page.offsetTop + page.offsetHeight * offset);
  setCurrentPage(bounded);
  scheduleViewportUpdate();
  scheduleSave();
}

function setZoom(value, anchor = captureZoomAnchor()) {
  const newZoom = Math.max(0.5, Math.min(4, Math.round(value * 100) / 100));
  if (newZoom === state.zoom || !state.revision) return;
  state.zoom = newZoom;
  elements["zoom-value"].textContent = `${Math.round(state.zoom * 100)}%`;
  relayoutPages(anchor);
}

function adjacentZoom(direction) {
  const tolerance = 0.001;
  if (direction > 0) return ZOOM_LEVELS.find((level) => level > state.zoom + tolerance) ?? 4;
  return [...ZOOM_LEVELS].reverse().find((level) => level < state.zoom - tolerance) ?? 0.5;
}

function relayoutPages(anchor = captureZoomAnchor()) {
  if (!state.revision) return;
  cancelRenders();
  [...elements.pages.children].forEach((wrapper, index) => {
    const size = snappedPageSize(displayedRatio(state.revision.page_geometry[index]));
    wrapper.replaceChildren();
    applyPageSize(wrapper, size);
  });
  // Before PDF restoration, placeholders are layout only, not a reading position.
  if (state.pdf) restoreZoomAnchor(anchor);
  scheduleViewportUpdate();
  scheduleSave();
}

function captureZoomAnchor(clientX, clientY) {
  if (!state.revision || !elements.pages.children.length) return null;
  const viewerRect = elements.viewer.getBoundingClientRect();
  const x = clientX ?? (viewerRect.left + viewerRect.width / 2);
  const y = clientY ?? (viewerRect.top + viewerRect.height / 2);
  let bestPage = null;
  let bestDistance = Infinity;
  for (const page of elements.pages.children) {
    const rect = page.getBoundingClientRect();
    const distanceY = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (distanceY < bestDistance) {
      bestDistance = distanceY;
      bestPage = page;
    }
  }
  if (!bestPage) return null;
  const pageRect = bestPage.getBoundingClientRect();
  return {
    pageIndex: Number(bestPage.dataset.index),
    normalizedX: Math.max(0, Math.min(1, (x - pageRect.left) / pageRect.width)),
    normalizedY: Math.max(0, Math.min(1, (y - pageRect.top) / pageRect.height)),
    viewportX: x - viewerRect.left,
    viewportY: y - viewerRect.top,
  };
}

function restoreZoomAnchor(anchor) {
  if (!anchor) return;
  const page = elements.pages.children[anchor.pageIndex];
  if (!page) return;
  const viewerRect = elements.viewer.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  const pointX = pageRect.left + anchor.normalizedX * pageRect.width;
  const pointY = pageRect.top + anchor.normalizedY * pageRect.height;
  elements.viewer.scrollLeft = snapScroll(
    elements.viewer.scrollLeft + pointX - (viewerRect.left + anchor.viewportX),
  );
  elements.viewer.scrollTop = snapScroll(
    elements.viewer.scrollTop + pointY - (viewerRect.top + anchor.viewportY),
  );
  setCurrentPage(anchor.pageIndex);
}

function snapScroll(value) {
  const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
  return alignedCssDimension(value, pixelRatio).css;
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(savePosition, 350);
}

async function savePosition() {
  if (!state.revision || !state.pdf) return;
  const page = elements.pages.children[state.currentPage];
  if (!page) return;
  const normalizedOffset = currentNormalizedOffset(page);
  try {
    await api(`/api/revisions/${state.revision.id}/position`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_page_index: state.currentPage, normalized_offset: normalizedOffset, zoom: state.zoom }),
    });
    state.revision.position = { pdf_page_index: state.currentPage, normalized_offset: normalizedOffset, zoom: state.zoom };
  } catch (error) {
    announce("阅读位置未保存，请稍后重试。", true);
  }
}

function savePositionKeepalive() {
  if (!state.revision || !state.pdf) return;
  const page = elements.pages.children[state.currentPage];
  if (!page) return;
  fetch(`/api/revisions/${state.revision.id}/position`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "X-Reader-Token": launchToken, "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_page_index: state.currentPage, normalized_offset: currentNormalizedOffset(page), zoom: state.zoom }),
    keepalive: true,
  }).catch(() => {});
}

function currentNormalizedOffset(page) {
  return Math.max(0, Math.min(1, (elements.viewer.scrollTop - page.offsetTop) / page.offsetHeight));
}

async function startPreparation() {
  if (!state.revision) return;
  const revisionId = state.revision.id;
  try {
    await api(`/api/revisions/${revisionId}/preparation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_page: state.currentPage, visible_pages: [state.currentPage] }),
    });
  } catch (error) {
    elements["preparation-status"].textContent = "文字不可用";
    elements["preparation-status"].className = "preparation-status failed";
    return;
  }
  if (state.revision?.id !== revisionId) return;
  const stream = new EventSource(`/api/revisions/${revisionId}/preparation/events`, { withCredentials: true });
  state.eventSource = stream;
  stream.addEventListener("pages", (event) => {
    if (state.revision?.id !== revisionId) return;
    const payload = JSON.parse(event.data);
    applyPreparationStatuses(payload.pages);
  });
  stream.onerror = () => {
    // EventSource reconnects after the bounded server stream closes. Reading and
    // already-prepared overlays remain independent of stream availability.
    if (state.eventSource === stream) updatePreparationLabel();
  };
}

function closePreparationStream() {
  state.eventSource?.close();
  state.eventSource = null;
  state.preparation.clear();
  state.overlayData.clear();
  state.annotationData.clear();
  clearTimeout(state.priorityTimer);
  elements["preparation-status"].textContent = "正在准备文字…";
  elements["preparation-status"].className = "preparation-status";
}

function applyPreparationStatuses(pages) {
  for (const page of pages) {
    const previous = state.preparation.get(page.pdf_page_index);
    state.preparation.set(page.pdf_page_index, page);
    const wrapper = elements.pages.children[page.pdf_page_index];
    if (wrapper) {
      wrapper.dataset.preparation = page.status;
      syncPagePreparationUi(page.pdf_page_index);
    }
    if (page.status === "READY" && previous?.status !== "READY") ensureOverlay(page.pdf_page_index);
  }
  updatePreparationLabel();
}

function coverageText(coverage) {
  const failed = coverage.statuses.FAILED || 0;
  if (coverage.complete) return `已检索全书 ${coverage.total_pages} 页`;
  const suffix = failed ? `，其中 ${failed} 页准备失败` : "";
  return `已检索 ${coverage.ready_pages} / ${coverage.total_pages} 页，其余页面仍在准备${suffix}`;
}

async function loadBookMap() {
  const revisionId = state.revision?.id;
  if (!revisionId) return;
  const request = ++state.outlineRequest;
  elements["outline-status"].textContent = "正在读取教材目录…";
  try {
    const outline = await api(`/api/revisions/${revisionId}/outline`);
    const labels = outline.page_labels;
    if (request !== state.outlineRequest || state.revision?.id !== revisionId) return;
    state.outlineNodes = outline.nodes;
    for (const index of state.rendered) renderGuideEntries(index);
    state.pageLabels = new Map(labels.labels.map((row) => [row.pdf_page_index, row]));
    renderOutline(outline);
    updatePrintedPageLabel();
  } catch (_error) {
    if (request !== state.outlineRequest) return;
    elements["outline-status"].textContent = "目录暂时不可用，可以稍后重试。";
    elements["outline-empty"].hidden = false;
    updatePrintedPageLabel();
  }
}

function renderGuideEntries(index) {
  const page = elements.pages.children[index];
  if (!page) return;
  page.querySelectorAll(".section-guide-entry").forEach(button => button.remove());
  for (const node of state.outlineNodes) {
    if (node.kind !== "SECTION" || node.resolution_state !== "RESOLVED"
        || node.start_page !== index || !Number.isFinite(node.start_y)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-guide-entry";
    button.dataset.sectionId = node.outline_node_id;
    button.style.top = `${node.start_y * 100}%`;
    button.textContent = "导读 ›";
    button.setAttribute("aria-label", `${node.title} · 导读`);
    button.addEventListener("click", () => guide.open(node.outline_node_id));
    page.append(button);
  }
}

function renderOutline(payload) {
  const expanded = new Set([...elements["outline-tree"].querySelectorAll('.outline-target[aria-expanded="true"]')]
    .map((button) => button.closest("li").dataset.nodeId));
  const nodes = payload.nodes || [];
  const children = new Map();
  for (const node of nodes) {
    const key = node.parent_id || "ROOT";
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(node);
  }
  for (const values of children.values()) {
    values.sort((a, b) => a.order_index - b.order_index);
  }

  function branch(values, depth) {
    const list = document.createElement("ul");
    list.className = `outline-level outline-level-${depth}`;
    for (const node of values) {
      const item = document.createElement("li");
      item.dataset.nodeId = node.outline_node_id;
      const row = document.createElement("div");
      row.className = "outline-row";
      const descendants = children.get(node.outline_node_id) || [];
      const disclosure = document.createElement("button");
      disclosure.type = "button";
      disclosure.className = "outline-disclosure";
      disclosure.textContent = descendants.length ? "▸" : "";
      disclosure.disabled = !descendants.length;
      disclosure.setAttribute("aria-label", descendants.length ? "展开此目录项" : "没有下级目录");

      const target = document.createElement("button");
      target.type = "button";
      target.className = "outline-target";
      target.disabled = node.start_page === null && !descendants.length;
      if (descendants.length) target.setAttribute("aria-expanded", "false");
      const title = document.createElement("span");
      title.textContent = node.title;
      const meta = document.createElement("small");
      meta.textContent = node.start_page === null
        ? (node.printed_label_hint ? `印刷页 ${node.printed_label_hint} · 位置未知` : "位置未知")
        : (node.printed_label_hint ? `印刷页 ${node.printed_label_hint}` : `PDF 第 ${node.start_page + 1} 页`);
      target.append(title, meta);
      let toggleDescendants = null;
      if (node.start_page !== null || descendants.length) {
        target.addEventListener("click", () => {
          selectKnowledgeChapterForNode(node);
          toggleDescendants?.();
          if (node.start_page !== null) {
            goToPage(node.start_page);
            elements.viewer.focus({ preventScroll: true });
          }
        });
      }
      row.append(disclosure, target);
      if (node.kind === "CHAPTER") {
        const map = document.createElement("button");
        map.type = "button";
        map.className = "outline-map-action";
        map.textContent = "学习地图";
        map.addEventListener("click", (event) => {
          event.stopPropagation();
          openKnowledgePanel(node.outline_node_id);
        });
        row.append(map);
      }
      item.append(row);
      if (descendants.length) {
        const nested = branch(descendants, depth + 1);
        nested.hidden = true;
        toggleDescendants = () => {
          const opening = nested.hidden;
          nested.hidden = !opening;
          disclosure.textContent = opening ? "▾" : "▸";
          disclosure.setAttribute("aria-label", opening ? "折叠此目录项" : "展开此目录项");
          target.setAttribute("aria-expanded", String(opening));
        };
        disclosure.addEventListener("click", toggleDescendants);
        item.append(nested);
        if (expanded.has(node.outline_node_id)) toggleDescendants();
      }
      list.append(item);
    }
    return list;
  }

  const roots = children.get("ROOT") || [];
  const otherRoots = roots.filter(isAuxiliaryOutlineRoot);
  const mainRoots = roots.filter((node) => !isAuxiliaryOutlineRoot(node));
  const main = branch(mainRoots, 0);
  if (otherRoots.length) main.append(makeAuxiliaryOutlineGroup(otherRoots, branch));
  elements["outline-tree"].replaceChildren(main);
  elements["outline-empty"].hidden = nodes.length > 0;
  if (payload.identity_conflict) {
    elements["outline-status"].textContent = "检测到目录结构变化，已保留原有稳定目录，未自动覆盖。";
  } else if (nodes.length) {
    const source = payload.evidence_source === "BOOKMARK" ? "PDF 内嵌书签" : "教材目录页";
    elements["outline-status"].textContent = `依据：${source} · ${nodes.length} 项`;
  } else if (payload.waiting_for_toc_completion) {
    elements["outline-status"].textContent = "已发现目录页，正在等待连续目录页准备完成。";
  } else {
    elements["outline-status"].textContent = "未发现可用的 PDF 书签或已准备目录页。";
  }
}

function selectKnowledgeChapterForNode(node) {
  let current = node;
  const byId = new Map(state.outlineNodes.map((value) => [value.outline_node_id, value]));
  while (current && current.kind !== "CHAPTER") current = byId.get(current.parent_id);
  if (current?.kind === "CHAPTER") state.knowledgeChapterId = current.outline_node_id;
}

function chapterForCurrentPage() {
  const chapters = state.outlineNodes
    .filter((node) => node.kind === "CHAPTER" && node.parent_id === null && node.start_page !== null)
    .sort((a, b) => a.order_index - b.order_index);
  return chapters.filter((node) => node.start_page <= state.currentPage).at(-1) || chapters[0] || null;
}

async function openKnowledgePanel(chapterId = null) {
  const chapter = state.outlineNodes.find((node) => node.outline_node_id === chapterId)
    || chapterForCurrentPage();
  if (!chapter) {
    announce("教材目录中还没有可准备的章节。", true);
    return;
  }
  state.knowledgeChapterId = chapter.outline_node_id;
  elements["knowledge-panel"].hidden = false;
  elements["knowledge-toggle"].setAttribute("aria-expanded", "true");
  elements["outline-panel"].hidden = true;
  elements["outline-toggle"].setAttribute("aria-expanded", "false");
  elements["search-panel"].hidden = true;
  elements["search-toggle"].setAttribute("aria-expanded", "false");
  elements["marks-panel"].hidden = true;
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
  setAssistantPanelOpen(false);
  await loadKnowledgeMap();
}

async function loadKnowledgeMap() {
  const revisionId = state.revision?.id;
  const chapterId = state.knowledgeChapterId;
  if (!revisionId || !chapterId) return;
  const request = ++state.knowledgeRequest;
  clearTimeout(state.knowledgePollTimer);
  try {
    const payload = await api(`/api/revisions/${revisionId}/chapters/${chapterId}/knowledge-map`);
    if (request !== state.knowledgeRequest || state.revision?.id !== revisionId
        || state.knowledgeChapterId !== chapterId) return;
    state.knowledgeMap = payload;
    await master.refreshEntries();
    renderKnowledgeMap(payload);
    if (payload.status === "PREPARING" || payload.regeneration_state === "RUNNING") {
      state.knowledgePollTimer = setTimeout(loadKnowledgeMap, 700);
    }
  } catch (_error) {
    if (request !== state.knowledgeRequest) return;
    elements["knowledge-status"].textContent = "学习地图状态暂时无法读取，阅读不受影响。";
    elements["knowledge-prepare"].hidden = true;
  }
}

function renderKnowledgeMap(payload) {
  elements["knowledge-title"].textContent = payload.chapter_title || "章节学习地图";
  elements["knowledge-map"].replaceChildren();
  elements["knowledge-empty"].hidden = payload.status === "READY";
  const replacementRunning = payload.status === "READY" && payload.regeneration_state === "RUNNING";
  elements["knowledge-prepare"].hidden = payload.status === "PREPARING";
  elements["knowledge-prepare"].disabled = payload.status === "PREPARING" || replacementRunning
    || (payload.status === "READY" && !payload.regeneration_allowed);
  const stages = {
    QUEUED: "等待开始",
    RESOLVING_SOURCE: "正在解析本章来源范围",
    GENERATING: "正在按小节生成知识点",
    REVIEWING: "正在进行整章结构审查",
    VALIDATING: "正在校验整章学习地图",
    PUBLISHING: "正在整体发布学习地图",
  };
  if (payload.status === "NOT_PREPARED") {
    elements["knowledge-status"].textContent = "本章学习地图尚未准备；PDF 阅读和现有工具可继续使用。";
    elements["knowledge-empty"].textContent = "尚未准备这个章节的学习地图。";
    elements["knowledge-prepare"].textContent = "准备本章学习地图";
    return;
  }
  if (payload.status === "PREPARING") {
    const stage = stages[payload.prepare_stage] || "正在准备本章学习地图";
    const total = Number(payload.sections_total) || 0;
    const completed = Math.min(Number(payload.sections_completed) || 0, total);
    const progress = total > 0 ? `；已完成 ${completed}/${total} 个小节` : "";
    elements["knowledge-status"].textContent = `${stage}${progress}；地图会在整章通过后一次出现。`;
    elements["knowledge-empty"].textContent = "准备期间不会显示部分草稿。";
    return;
  }
  if (payload.status === "FAILED") {
    const stage = payload.failure_stage ? `（${payload.failure_stage} / ${payload.failure_code || "失败"}）` : "";
    elements["knowledge-status"].textContent = `本章学习地图准备失败${stage}；PDF 阅读和现有工具不受影响。`;
    elements["knowledge-empty"].textContent = "没有发布任何部分草稿，可以明确重试。";
    elements["knowledge-prepare"].textContent = "重试准备";
    return;
  }
  const route = `${payload.generator_provider} / ${payload.generator_model} → ${payload.reviewer_provider} / ${payload.reviewer_model}`;
  let replacementStatus = "";
  if (replacementRunning) {
    const total = Number(payload.sections_total) || 0;
    const completed = Math.min(Number(payload.sections_completed) || 0, total);
    const progress = total > 0 ? `，已完成 ${completed}/${total} 个小节` : "";
    replacementStatus = `；${stages[payload.prepare_stage] || "正在重新生成"}${progress}，当前地图继续可用`;
    elements["knowledge-prepare"].textContent = "正在重新生成知识点";
  } else if (payload.regeneration_state === "FAILED") {
    replacementStatus = `；上次重新生成失败（${payload.regeneration_failure_stage || "准备"} / ${payload.regeneration_failure_code || "失败"}），旧地图保持不变`;
    elements["knowledge-prepare"].textContent = "重试重新生成知识点";
  } else {
    elements["knowledge-prepare"].textContent = "重新生成知识点";
  }
  if (payload.regeneration_block_code === "CHAPTER_PERMANENTLY_LOCKED") {
    replacementStatus = "；已有学习状态，本章学习地图已永久冻结";
    elements["knowledge-prepare"].textContent = "本章已永久冻结";
  } else if (payload.regeneration_block_code === "CHAPTER_HAS_USER_ASSETS") {
    replacementStatus = "；已有用户内容关联知识点，不能重新生成";
    elements["knowledge-prepare"].textContent = "当前不能重新生成";
  }
  elements["knowledge-status"].textContent = `结构版本 ${payload.structure_version} · ${payload.knowledge_points.length} 个知识点 · ${route}${replacementStatus}`;
  const groups = new Map();
  for (const point of payload.knowledge_points) {
    if (!groups.has(point.primary_section_id)) groups.set(point.primary_section_id, []);
    groups.get(point.primary_section_id).push(point);
  }
  const rendered = [];
  for (const points of groups.values()) {
    const section = document.createElement("section");
    section.className = "knowledge-section";
    const title = document.createElement("h3");
    title.textContent = points[0].primary_section_title;
    const list = document.createElement("ol");
    for (const point of points) {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = point.title;
      const definition = document.createElement("p");
      definition.textContent = point.one_sentence_definition;
      const source = document.createElement("button");
      source.type = "button";
      source.textContent = `回到教材 · PDF 第 ${point.start_page + 1} 页`;
      source.addEventListener("click", () => {
        goToPage(point.start_page, point.start_y);
        elements.viewer.focus({ preventScroll: true });
      });
      item.append(heading, definition, source);
      master.decorateKnowledgeItem(item, point);
      list.append(item);
    }
    section.append(title, list);
    rendered.push(section);
  }
  elements["knowledge-map"].replaceChildren(...rendered);
}

async function prepareKnowledgeMap() {
  if (!state.revision || !state.knowledgeChapterId) return;
  elements["knowledge-prepare"].disabled = true;
  try {
    const action = state.knowledgeMap?.status === "READY" ? "regenerate" : "prepare";
    const payload = await api(`/api/revisions/${state.revision.id}/chapters/${state.knowledgeChapterId}/knowledge-map/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    state.knowledgeMap = payload.chapter_map;
    renderKnowledgeMap(payload.chapter_map);
    clearTimeout(state.knowledgePollTimer);
    state.knowledgePollTimer = setTimeout(loadKnowledgeMap, 350);
  } catch (error) {
    elements["knowledge-status"].textContent = `${error.message || "学习地图请求未能启动"}；当前地图与阅读不受影响。`;
    elements["knowledge-prepare"].disabled = false;
  }
}

function isAuxiliaryOutlineRoot(node) {
  const title = node.title.normalize("NFKC").replace(/[\s·•:：—_\-]/g, "");
  return /^(?:封面|扉页|版权页|版权信息|本书配套资源介绍|配套资源介绍|前言|序言|序|致读者|王道训练营|目录|目次|参考文献|参考资料|索引|后记|附录.*)$/.test(title);
}

function makeAuxiliaryOutlineGroup(nodes, branch) {
  const item = document.createElement("li");
  item.className = "outline-other-group";
  item.dataset.outlineGroup = "other";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "outline-other-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `<span aria-hidden="true">▸</span><strong>其他内容</strong><small>${nodes.length} 项</small>`;
  const nested = branch(nodes, 1);
  nested.hidden = true;
  toggle.addEventListener("click", () => {
    const opening = nested.hidden;
    nested.hidden = !opening;
    toggle.querySelector("span").textContent = opening ? "▾" : "▸";
    toggle.setAttribute("aria-expanded", String(opening));
  });
  item.append(toggle, nested);
  return item;
}

function updatePrintedPageLabel() {
  const row = state.pageLabels.get(state.currentPage);
  elements["printed-page-label"].textContent = row?.printed_label
    ? `印刷页 ${row.printed_label}`
    : "印刷页未知";
  elements["printed-page-edit"].title = row?.method === "MANUAL"
    ? "本页使用手工印刷页码；点击修改"
    : "设置本页印刷页码";
}

async function editPrintedPageLabel() {
  if (!state.revision) return;
  const current = state.pageLabels.get(state.currentPage)?.printed_label || "";
  const value = window.prompt(`设置 PDF 第 ${state.currentPage + 1} 页对应的印刷页码`, current);
  if (value === null) return;
  const printedLabel = value.trim();
  if (!printedLabel) {
    announce("印刷页码不能为空；未知页会保持“印刷页未知”。", true);
    return;
  }
  try {
    await api(`/api/revisions/${state.revision.id}/page-labels/${state.currentPage}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printed_label: printedLabel }),
    });
    await loadBookMap();
    announce("本页印刷页码已手工保存。");
  } catch (_error) {
    announce("印刷页码未保存，请重试。", true);
  }
}

async function runSearch() {
  const revisionId = state.revision?.id;
  if (!revisionId) return;
  const request = ++state.searchRequest;
  const queryText = elements["search-query"].value.trim();
  clearSearchMatch();
  elements["search-coverage"].textContent = "正在读取搜索范围…";
  elements["search-empty"].textContent = queryText ? "正在搜索…" : "输入关键词以搜索已准备页面。";
  elements["search-empty"].hidden = false;
  elements["search-results"].replaceChildren();
  try {
    const payload = await api(`/api/revisions/${revisionId}/search?q=${encodeURIComponent(queryText)}`);
    if (request !== state.searchRequest || state.revision?.id !== revisionId) return;
    elements["search-coverage"].textContent = coverageText(payload.coverage);
    const rows = payload.results.map((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const page = document.createElement("strong");
      page.textContent = `PDF 第 ${result.pdf_page_index + 1} 页`;
      const snippet = document.createElement("span");
      snippet.textContent = result.snippet;
      button.append(page, snippet);
      button.addEventListener("click", () => activateSearchResult(result));
      return button;
    });
    elements["search-results"].replaceChildren(...rows);
    elements["search-empty"].hidden = rows.length > 0;
    if (!rows.length) {
      elements["search-empty"].textContent = queryText ? "在当前已检索页面中没有找到结果。" : "输入关键词以搜索已准备页面。";
    }
    if (payload.truncated) announce("结果较多，当前显示前 100 个匹配页面。");
  } catch (_error) {
    if (request !== state.searchRequest) return;
    elements["search-coverage"].textContent = "暂时无法读取搜索范围";
    elements["search-empty"].textContent = "搜索失败，请稍后重试。";
  }
}

function clearSearchMatch() {
  document.querySelectorAll(".search-match-quad").forEach((node) => node.remove());
  state.searchMatch = null;
}

function activateSearchResult(result) {
  clearSearchMatch();
  state.searchMatch = {
    pageIndex: result.pdf_page_index,
    ranges: result.match_ranges || [],
    focusPending: true,
  };
  goToPage(result.pdf_page_index);
  renderSearchMatch(
    result.pdf_page_index,
    elements.pages.children[result.pdf_page_index]?.querySelector(".text-overlay"),
  );
}

function renderSearchMatch(index, overlay = elements.pages.children[index]?.querySelector(".text-overlay")) {
  const match = state.searchMatch;
  const data = state.overlayData.get(index);
  if (!overlay || !data || match?.pageIndex !== index) return;
  overlay.querySelectorAll(".search-match-quad").forEach((node) => node.remove());
  const resolved = match.ranges.flatMap((range) => resolveSelection(
    data.lines,
    { lineOrdinal: range.line_ordinal, boundary: range.cell_start },
    { lineOrdinal: range.line_ordinal, boundary: range.cell_end },
  ));
  let firstMarker = null;
  for (const quad of selectionPresentationQuads(resolved)) {
    const xs = quad.map(([x]) => x);
    const ys = quad.map(([, y]) => y);
    const marker = document.createElement("span");
    marker.className = "search-match-quad";
    marker.style.cssText = `left:${Math.min(...xs) * 100}%;top:${Math.min(...ys) * 100}%;width:${(Math.max(...xs) - Math.min(...xs)) * 100}%;height:${(Math.max(...ys) - Math.min(...ys)) * 100}%`;
    overlay.append(marker);
    firstMarker ||= marker;
  }
  if (firstMarker && match.focusPending) {
    match.focusPending = false;
    requestAnimationFrame(() => firstMarker.isConnected && firstMarker.scrollIntoView({ block: "center", inline: "nearest" }));
  }
}

function syncPagePreparationUi(index) {
  const wrapper = elements.pages.children[index];
  if (!wrapper) return;
  wrapper.querySelector(".preparation-retry")?.remove();
  if (state.preparation.get(index)?.status !== "FAILED" || !wrapper.querySelector("canvas")) return;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "preparation-retry";
  retry.textContent = "文字准备失败 · 重试";
  retry.addEventListener("click", async (event) => {
    event.stopPropagation();
    retry.disabled = true;
    retry.textContent = "已加入重试队列……";
    try {
      await api(`/api/revisions/${state.revision.id}/preparation/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_page_index: index }),
      });
    } catch (_error) {
      retry.disabled = false;
      retry.textContent = "文字准备失败 · 重试";
      announce("重试未能加入队列，请稍后再试。", true);
    }
  });
  wrapper.append(retry);
}

function updatePreparationLabel() {
  const pages = [...state.preparation.values()];
  const ready = pages.filter((page) => page.status === "READY").length;
  const failed = pages.filter((page) => page.status === "FAILED").length;
  const output = elements["preparation-status"];
  if (!pages.length) {
    output.textContent = "正在准备文字…";
    output.className = "preparation-status";
  } else if (ready + failed === pages.length) {
    output.textContent = failed ? `${ready} 页就绪 · ${failed} 页失败` : "文字已就绪";
    output.className = `preparation-status ${failed ? "failed" : "ready"}`;
  } else {
    output.textContent = `${ready} / ${pages.length} 页可选择`;
    output.className = "preparation-status";
  }
}

function schedulePreparationPriority(first, last) {
  if (!state.revision) return;
  clearTimeout(state.priorityTimer);
  const revisionId = state.revision.id;
  state.priorityTimer = setTimeout(() => {
    if (state.revision?.id !== revisionId) return;
    const visiblePages = [];
    for (let index = first; index <= last; index += 1) visiblePages.push(index);
    api(`/api/revisions/${revisionId}/preparation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_page: state.currentPage, visible_pages: visiblePages }),
    }).catch(() => {});
  }, 180);
}

async function refreshAssistantStatus() {
  clearTimeout(state.assistantStatusTimer);
  try {
    const status = await api("/api/assistant/status");
    state.assistantStatusAvailable = true;
    state.assistantProviderStatuses = Array.isArray(status.providers) ? status.providers : [];
    if (!state.assistantModelSelectionInitialized) {
      state.assistantActiveProvider = status.active_provider || status.provider || "deepseek";
      state.assistantModelSelectionInitialized = true;
    }
    applySelectedProviderStatus();
    if (state.assistantCooling) {
      state.assistantStatusTimer = setTimeout(
        refreshAssistantStatus,
        Math.max(1000, (Number(status.retry_after_seconds || 1) + 0.25) * 1000),
      );
    }
  } catch (_error) {
    state.assistantStatusAvailable = false;
    state.assistantConfigured = false;
    state.assistantCooling = false;
    state.assistantOffReason = "STATUS_UNAVAILABLE";
    state.assistantProviderStatuses = [];
    syncModelSelector();
    syncAskEligibility();
  }
}

function selectedProviderStatus() {
  return state.assistantProviderStatuses.find(
    (provider) => provider.provider === state.assistantActiveProvider
  ) || null;
}

function providerSelectable(provider) {
  return Boolean(
    provider
    && Object.hasOwn(ASSISTANT_PROVIDER_LABELS, provider.provider)
    && provider.configuration_valid
    && provider.ai_off_reason !== "DEVELOPMENT_DISABLED"
  );
}

function syncModelSelector() {
  for (const option of elements["assistant-model"].options) {
    const status = state.assistantProviderStatuses.find(
      (provider) => provider.provider === option.value
    );
    if (status?.model) {
      option.textContent = `${ASSISTANT_PROVIDER_LABELS[option.value]} · ${status.model}`;
    }
  }
  elements["assistant-model"].value = state.assistantActiveProvider;
  const rootLocked = Boolean(state.assistantState.current) && !state.assistantDraft;
  elements["assistant-model"].disabled = rootLocked || state.assistantPending;
  elements["assistant-model-lock"].hidden = !rootLocked;
  elements["assistant-model"].title = rootLocked
    ? "当前解释树已固定使用此模型；从教材新选区开始时可重新选择"
    : "选择下一条新解释使用的模型";
  syncFirstTurnEligibility();
}

function applySelectedProviderStatus() {
  const selected = selectedProviderStatus();
  state.assistantConfigured = Boolean(selected?.configured);
  state.assistantCooling = Boolean(selected?.cooling);
  state.assistantOffReason = selected?.ai_off_reason || null;
  syncModelSelector();
  syncAskEligibility();
}

function selectedProviderUnavailableMessage(selected) {
  const label = ASSISTANT_PROVIDER_LABELS[selected?.provider] || "所选模型";
  if (!selected) return "当前服务没有返回所选模型的状态；请刷新 Reader 后重试。";
  if (!selected.configuration_valid) {
    if (!selected.endpoint_valid) return `${label} 的 endpoint 配置无效；Reader 其余功能不受影响。`;
    if (!selected.model_valid) return `${label} 的 model 配置无效；Reader 其余功能不受影响。`;
    return `${label} 的 provider 配置无效；Reader 其余功能不受影响。`;
  }
  if (selected.ai_off_reason === "DEVELOPMENT_DISABLED") {
    return `${label} 已在当前开发配置中关闭；请选择其他可用模型。`;
  }
  if (selected.cooling || selected.ai_off_reason === "COOLING") {
    const seconds = Math.max(1, Number(selected.retry_after_seconds || 1));
    return `${label} 连续失败，正在短暂冷却（约 ${seconds} 秒）；不会切换到其他模型。`;
  }
  if (!selected.credential_available) {
    const target = selected.credential_target ? `“${selected.credential_target}”` : "对应 target";
    if (selected.credential_reason === "CREDENTIAL_READ_FAILED") {
      return `无法读取 ${label} 的 Windows 凭据 ${target}；请检查当前 Core Service 的 Windows 用户身份。`;
    }
    if (selected.credential_reason === "CREDENTIAL_EMPTY") {
      return `${label} 的 Windows 凭据 ${target} 为空；请重新配置该凭据。`;
    }
    return `未找到 ${label} 的 Windows 凭据 ${target}；请在保存该凭据的 Windows 用户下启动 Core Service。`;
  }
  return `${label} 当前不可调用；Reader 其余功能不受影响。`;
}

function syncAskEligibility() {
  const hasSelection = Boolean(
    (state.selection?.resolved.length || state.guideSelection) && state.revision?.id && state.readerSessionId
  );
  const anyProviderSelectable = state.assistantProviderStatuses.some(providerSelectable);
  const ask = elements["ask-selection"];
  ask.disabled = !hasSelection || !state.assistantStatusAvailable
    || !anyProviderSelectable || state.assistantPending;
  if (!hasSelection) {
    ask.title = "请先选择当前教材页中的文字";
  } else if (!state.assistantStatusAvailable) {
    ask.title = "AI 状态接口不可用；请重启 Core Service 后重试";
  } else if (!anyProviderSelectable) {
    ask.title = "Assistant 当前已关闭或没有有效模型配置；Reader 其余功能不受影响";
  } else {
    ask.title = "在 Assistant 中选择模型后发送";
  }
  ask.setAttribute("aria-disabled", String(ask.disabled));
  syncFirstTurnEligibility();
}

function syncFirstTurnEligibility() {
  if (!elements["assistant-start"]) return;
  const selected = selectedProviderStatus();
  const callable = Boolean(selected?.configured && !selected.cooling);
  const start = elements["assistant-start"];
  start.disabled = !state.assistantDraft || !callable || state.assistantPending;
  start.setAttribute("aria-disabled", String(start.disabled));
  start.title = state.assistantPending
    ? "正在发送首条请求"
    : callable
      ? `使用 ${state.assistantActiveProvider} 发送首条请求`
      : selectedProviderUnavailableMessage(selected);
  const readiness = elements["assistant-readiness"];
  readiness.hidden = !state.assistantDraft || callable;
  readiness.textContent = readiness.hidden ? "" : selectedProviderUnavailableMessage(selected);
}

function emptyAssistantState() {
  return { version: 0, roots: [], focused_ref: null, current: null };
}

function assistantLocationKey(rootId, nodeId = null) {
  return `${rootId}:${nodeId || "root"}`;
}

function assistantTurnKey(rootId, nodeId, turnId) {
  return `${assistantLocationKey(rootId, nodeId)}:${turnId}`;
}

function clearAssistantReviewPolls() {
  for (const timer of state.assistantReviewPolls.values()) clearTimeout(timer);
  state.assistantReviewPolls.clear();
}

function rememberAssistantScroll() {
  const current = state.assistantState.current;
  if (!current) return;
  state.assistantScrollPositions.set(
    assistantLocationKey(current.root_id, current.node_id),
    elements["assistant-turns"].scrollTop,
  );
}

function forgetAssistantScroll(rootId, removedNodeIds = null) {
  if (removedNodeIds === null) {
    for (const key of state.assistantScrollPositions.keys()) {
      if (key.startsWith(`${rootId}:`)) state.assistantScrollPositions.delete(key);
    }
    return;
  }
  for (const nodeId of removedNodeIds) {
    state.assistantScrollPositions.delete(assistantLocationKey(rootId, nodeId));
  }
}

function assistantDockLimits() {
  const minimum = Math.min(ASSISTANT_DOCK_MIN_WIDTH, Math.max(240, window.innerWidth - 24));
  const maximum = Math.max(
    minimum,
    Math.min(ASSISTANT_DOCK_MAX_WIDTH, window.innerWidth - ASSISTANT_READER_MIN_WIDTH),
  );
  return { minimum, maximum };
}

function applyAssistantDockWidth(width) {
  const { minimum, maximum } = assistantDockLimits();
  state.assistantDockWidth = Math.round(Math.max(minimum, Math.min(maximum, width)));
  elements.reader.style.setProperty("--assistant-dock-width", `${state.assistantDockWidth}px`);
  elements["assistant-resize-handle"].setAttribute("aria-valuemin", String(minimum));
  elements["assistant-resize-handle"].setAttribute("aria-valuemax", String(maximum));
  elements["assistant-resize-handle"].setAttribute("aria-valuenow", String(state.assistantDockWidth));
}

function renderAssistantViewportMode() {
  const expanded = state.assistantExpanded && !elements["assistant-panel"].hidden;
  elements.reader.classList.toggle("assistant-expanded", expanded);
  elements["assistant-expand"].setAttribute("aria-pressed", String(expanded));
  elements["assistant-expand"].textContent = expanded ? "还原" : "展开";
  elements["assistant-expand"].setAttribute(
    "aria-label", expanded ? "还原临时解释面板" : "展开临时解释面板",
  );
  elements["assistant-expand"].title = expanded ? "还原临时解释面板" : "展开临时解释面板";
}

function setAssistantExpanded(expanded) {
  if (elements["assistant-panel"].hidden && expanded) return;
  if (expanded === state.assistantExpanded) return;
  if (expanded) state.assistantDockWidthBeforeExpanded = state.assistantDockWidth;
  state.assistantExpanded = expanded;
  if (!expanded) applyAssistantDockWidth(state.assistantDockWidthBeforeExpanded);
  renderAssistantViewportMode();
  hideAssistantAnswerActions(true);
}

function setAssistantPanelOpen(open, { focusViewer = false, relayout = true } = {}) {
  if (open) guide.close();
  const wasOpen = !elements["assistant-panel"].hidden;
  const anchor = relayout && wasOpen !== open ? captureZoomAnchor() : null;
  if (!open && state.assistantExpanded) setAssistantExpanded(false);
  elements["assistant-panel"].hidden = !open;
  elements.reader.classList.toggle("assistant-dock-open", open);
  elements["assistant-toggle"].setAttribute("aria-expanded", String(open));
  renderAssistantViewportMode();
  hideAssistantAnswerActions(true);
  if (focusViewer) elements.viewer.focus({ preventScroll: true });
  if (anchor && state.revision) requestAnimationFrame(() => relayoutPages(anchor));
}

function updateAssistantDockFromPointer(clientX) {
  applyAssistantDockWidth(window.innerWidth - clientX);
}

function beginAssistantResize(event) {
  if (event.button !== 0 || state.assistantExpanded) return;
  event.preventDefault();
  event.stopPropagation();
  state.assistantResizeAnchor = captureZoomAnchor();
  elements["assistant-panel"].classList.add("resizing");
  elements["assistant-resize-handle"].setPointerCapture(event.pointerId);
  updateAssistantDockFromPointer(event.clientX);
  hideSelectionActions();
  hideAssistantAnswerActions(true);
}

function continueAssistantResize(event) {
  if (!elements["assistant-panel"].classList.contains("resizing")) return;
  event.preventDefault();
  updateAssistantDockFromPointer(event.clientX);
}

function finishAssistantResize(event) {
  if (!elements["assistant-panel"].classList.contains("resizing")) return;
  event.preventDefault();
  updateAssistantDockFromPointer(event.clientX);
  elements["assistant-panel"].classList.remove("resizing");
  if (elements["assistant-resize-handle"].hasPointerCapture(event.pointerId)) {
    elements["assistant-resize-handle"].releasePointerCapture(event.pointerId);
  }
  const anchor = state.assistantResizeAnchor;
  state.assistantResizeAnchor = null;
  if (anchor && state.revision) relayoutPages(anchor);
}

function resetAssistantPanel() {
  elements["assistant-title"].textContent = "问 AI";
  elements["assistant-scope"].textContent = state.assistantConfigured
    ? "等待教材选区" : "当前 AI provider 未配置，Reader 其余功能仍可使用";
  elements["assistant-turns"].replaceChildren();
  elements["assistant-empty"].hidden = false;
  elements["assistant-empty"].textContent = "在原始 PDF 中选择文字，右键选择「问 AI」。";
  elements["assistant-first-turn"].hidden = true;
  elements["assistant-follow-up"].hidden = true;
  elements["assistant-context-bar"].hidden = true;
  elements["assistant-breadcrumb"].hidden = true;
  elements["assistant-children"].hidden = true;
  elements["assistant-child-list"].replaceChildren();
  elements["assistant-question"].value = "";
  state.assistantPending = false;
  state.assistantState = emptyAssistantState();
  state.assistantDraft = null;
  state.assistantScrollPositions.clear();
  state.assistantChildRequests.clear();
  renderAssistantNavigation(null);
  hideAssistantAnswerActions();
  syncModelSelector();
}

function openAssistantPanel() {
  master.selectAssistant();
  setAssistantPanelOpen(true);
  elements["search-panel"].hidden = true;
  elements["marks-panel"].hidden = true;
  elements["knowledge-panel"].hidden = true;
  elements["search-toggle"].setAttribute("aria-expanded", "false");
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
  elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
  state.searchRequest += 1;
  clearSearchMatch();
}

function assistantScopeText(scope) {
  if (scope.kind === "SECTION") {
    return [scope.chapter_title, scope.section_title].filter(Boolean).join(" · ");
  }
  const chapter = scope.chapter_title ? ` · 已安全确定 ${scope.chapter_title}` : "";
  return `PDF 第 ${scope.pdf_page_index + 1} 页范围${chapter}`;
}

function applyAssistantState(nextState) {
  if (!nextState || !Array.isArray(nextState.roots)) return;
  if (Number(nextState.version || 0) < Number(state.assistantState.version || 0)) return;
  state.assistantState = nextState;
  if (nextState.current?.provider) state.assistantActiveProvider = nextState.current.provider;
  renderAssistantWorkspace();
}

function renderAssistantNavigation(current) {
  const roots = state.assistantState.roots || [];
  elements["assistant-context-bar"].hidden = roots.length === 0;
  elements["assistant-root-switcher"].replaceChildren(...roots.map((root) => {
    const option = document.createElement("option");
    option.value = root.root_id;
    option.textContent = root.label;
    return option;
  }));
  if (state.assistantState.focused_ref?.root_id) {
    elements["assistant-root-switcher"].value = state.assistantState.focused_ref.root_id;
  }
  elements["assistant-back"].hidden = !current?.parent_ref;
  elements["assistant-depth"].textContent = current ? `${current.depth}/5` : "";
  elements["assistant-close-root"].disabled = !current;
  elements["assistant-close-root"].textContent = current?.depth > 1
    ? "关闭本层解释" : "关闭此主题";
  const semanticPath = (current?.breadcrumb || []).slice(1);
  const crumbs = semanticPath.flatMap((crumb, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = crumb.label;
    button.title = crumb.label;
    button.dataset.rootId = crumb.root_id;
    button.dataset.nodeId = crumb.node_id || "";
    button.disabled = index === semanticPath.length - 1;
    const separator = document.createElement("span");
    separator.textContent = "›";
    separator.setAttribute("aria-hidden", "true");
    return [separator, button];
  });
  elements["assistant-breadcrumb"].replaceChildren(...crumbs);
  elements["assistant-breadcrumb"].hidden = crumbs.length === 0;

  const children = current?.children || [];
  elements["assistant-child-list"].replaceChildren(...children.map((child) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = child.label;
    button.title = child.error ? `${child.label}（生成失败）` : child.label;
    button.dataset.rootId = current.root_id;
    button.dataset.nodeId = child.node_id;
    if (child.pending) button.setAttribute("aria-busy", "true");
    return button;
  }));
  elements["assistant-children"].hidden = children.length === 0;
}

function renderAssistantWorkspace() {
  hideAssistantAnswerActions();
  if (state.assistantDraft) {
    renderAssistantDraft();
    return;
  }
  const current = state.assistantState.current;
  renderAssistantNavigation(current);
  elements["assistant-title"].textContent = current?.label || "问 AI";
  elements["assistant-first-turn"].hidden = true;
  if (!current) {
    elements["assistant-scope"].textContent = state.assistantConfigured
      ? "等待教材选区" : "当前 AI provider 未配置，Reader 其余功能仍可使用";
    elements["assistant-turns"].replaceChildren();
    elements["assistant-empty"].textContent = "在原始 PDF 中选择文字，右键选择「问 AI」。";
    elements["assistant-empty"].hidden = false;
    elements["assistant-follow-up"].hidden = true;
    syncModelSelector();
    return;
  }
  elements["assistant-scope"].textContent = assistantScopeText(current.scope);
  const turns = current.turns.map((turn, index) => {
    const article = document.createElement("article");
    article.className = "assistant-turn";
    const question = document.createElement("p");
    question.className = "assistant-question-bubble";
    question.textContent = turn.question;
    const answer = document.createElement("div");
    answer.className = "assistant-answer-bubble";
    renderAssistantAnswer(answer, turn.answer);
    const leadingHeading = answer.firstElementChild;
    if (leadingHeading?.matches("h1, h2, h3")
        && leadingHeading.textContent.trim() === turn.question.trim()) {
      leadingHeading.classList.add("assistant-repeated-heading");
    }
    if (index === current.turns.length - 1) {
      answer.dataset.rootId = current.root_id;
      answer.dataset.nodeId = current.node_id || "";
      answer.dataset.turnId = turn.turn_id;
      answer.dataset.currentAnswer = "true";
      if (current.depth >= 5) answer.title = "已到第 5 层；可在下方继续追问";
    }
    const turnActions = document.createElement("div");
    turnActions.className = "assistant-turn-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "assistant-save-note";
    save.dataset.rootId = current.root_id;
    save.dataset.nodeId = current.node_id || "";
    save.dataset.turnId = turn.turn_id;
    const saveKey = assistantTurnKey(current.root_id, current.node_id, turn.turn_id);
    const saved = state.assistantSavedTurns.has(saveKey);
    save.textContent = saved ? "已保存" : "保存到笔记";
    save.disabled = saved;
    save.hidden = state.assistantState.roots.find((root) => root.root_id === current.root_id)?.created_from.kind === "READING_GUIDE";
    turnActions.append(save);
    article.append(question, answer, turnActions);
    return article;
  });
  if (current.pending) {
    const pending = document.createElement("div");
    pending.className = "assistant-pending";
    pending.textContent = `正在解释“${current.label}”……`;
    turns.push(pending);
  } else if (current.error) {
    const error = document.createElement("div");
    error.className = "assistant-error";
    error.textContent = current.error;
    turns.push(error);
  }
  elements["assistant-turns"].replaceChildren(...turns);
  elements["assistant-empty"].hidden = turns.length > 0;
  elements["assistant-follow-up"].hidden = current.pending || current.turns.length === 0;
  syncModelSelector();
  const locationKey = assistantLocationKey(current.root_id, current.node_id);
  const savedScroll = state.assistantScrollPositions.get(locationKey);
  requestAnimationFrame(() => {
    elements["assistant-turns"].scrollTop = savedScroll ?? elements["assistant-turns"].scrollHeight;
  });
}

function renderAssistantConversation(conversation) {
  // Compatibility shim for stale callers during the transition to Root/Node state.
  applyAssistantState(conversation);
}

function renderAssistantDraft() {
  const draft = state.assistantDraft;
  if (!draft) {
    elements["assistant-first-turn"].hidden = true;
    return;
  }
  elements["assistant-title"].textContent = "问 AI";
  elements["assistant-scope"].textContent = draft.request.source_kind === "READING_GUIDE"
    ? "准备解释导读选区" : `准备解释 PDF 第 ${draft.request.pdf_page_index + 1} 页选区`;
  elements["assistant-draft-text"].textContent = draft.selectedText;
  elements["assistant-first-turn"].hidden = false;
  elements["assistant-follow-up"].hidden = true;
  renderAssistantNavigation(state.assistantState.current);
  elements["assistant-turns"].replaceChildren();
  elements["assistant-empty"].textContent = state.assistantState.roots.length
    ? "已有解释仍保留；发送后会新增一个主题。" : "";
  elements["assistant-empty"].hidden = !state.assistantState.roots.length;
  syncModelSelector();
}

function showAssistantPending(question) {
  const pending = document.createElement("div");
  pending.className = "assistant-pending";
  pending.textContent = `正在解释「${question}」…`;
  elements["assistant-turns"].append(pending);
  elements["assistant-empty"].hidden = true;
}

function showAssistantError(error) {
  elements["assistant-turns"].querySelectorAll(".assistant-pending").forEach((node) => node.remove());
  const message = document.createElement("div");
  message.className = "assistant-error";
  message.textContent = error.message || "AI 解释失败，请稍后再试。";
  elements["assistant-turns"].append(message);
}

function stageAssistantSelection() {
  if (state.guideSelection) {
    const { explain } = state.guideSelection;
    hideSelectionActions(); explain(); return;
  }
  const selection = state.selection;
  const revisionId = state.revision?.id;
  const readerSessionId = state.readerSessionId;
  const selectedText = resolvedText(selection?.resolved || []).trim();
  if (!selection?.resolved.length || !selectedText || !revisionId || !readerSessionId || state.assistantPending) return;
  state.assistantDraft = {
    readerSessionId,
    revisionId,
    selectedText,
    request: {
      pdf_page_index: selection.pageIndex,
      start: { line_ordinal: selection.anchor.lineOrdinal, boundary: selection.anchor.boundary },
      end: { line_ordinal: selection.focus.lineOrdinal, boundary: selection.focus.boundary },
    },
  };
  openAssistantPanel();
  renderAssistantDraft();
  refreshAssistantStatus();
  clearSelection();
}

async function sendAssistantFirstTurn() {
  const draft = state.assistantDraft;
  if (!draft || state.assistantPending || !state.assistantConfigured || state.assistantCooling) return;
  state.assistantPending = true;
  syncModelSelector();
  showAssistantPending(draft.selectedText);
  try {
    const payload = await api(`/api/revisions/${draft.revisionId}/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_session_id: draft.readerSessionId,
        provider: state.assistantActiveProvider,
        source_kind: "ORIGINAL_PDF",
        ...draft.request,
      }),
    });
    if (state.readerSessionId !== draft.readerSessionId) return;
    state.assistantDraft = null;
    applyAssistantState(payload.assistant);
  } catch (error) {
    if (state.readerSessionId === draft.readerSessionId
        && error.code !== "ASSISTANT_REQUEST_CANCELLED") showAssistantError(error);
    if (error.code?.startsWith("AI_")) {
      await refreshAssistantStatus();
    }
  } finally {
    state.assistantPending = false;
    syncModelSelector();
  }
}

async function sendAssistantFollowUp() {
  const question = elements["assistant-question"].value.trim();
  const current = state.assistantState.current;
  const readerSessionId = state.readerSessionId;
  if (!question || !current || !readerSessionId || state.assistantPending) return;
  state.assistantPending = true;
  elements["assistant-send"].disabled = true;
  showAssistantPending(question);
  try {
    const payload = await api("/api/assistant/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_session_id: readerSessionId,
        root_id: current.root_id,
        node_id: current.node_id,
        question,
      }),
    });
    if (state.readerSessionId !== readerSessionId) return;
    elements["assistant-question"].value = "";
    applyAssistantState(payload.assistant);
  } catch (error) {
    const stillBound = state.assistantState.current?.root_id === current.root_id
      && state.assistantState.current?.node_id === current.node_id;
    if (state.readerSessionId === readerSessionId && stillBound
        && error.code !== "ASSISTANT_REQUEST_CANCELLED") showAssistantError(error);
    if (error.code?.startsWith("AI_")) {
      await refreshAssistantStatus();
    }
  } finally {
    state.assistantPending = false;
    elements["assistant-send"].disabled = false;
  }
}

async function clearAssistantSession({ keepalive = false } = {}) {
  const readerSessionId = state.readerSessionId;
  if (!readerSessionId) return;
  await api("/api/assistant/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reader_session_id: readerSessionId }),
    keepalive,
  });
  state.assistantState = emptyAssistantState();
  resetAssistantPanel();
}

async function focusAssistant(rootId, nodeId = null) {
  const readerSessionId = state.readerSessionId;
  if (!readerSessionId || !rootId) return;
  rememberAssistantScroll();
  state.assistantDraft = null;
  hideAssistantAnswerActions(true);
  try {
    const payload = await api("/api/assistant/focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reader_session_id: readerSessionId, root_id: rootId, node_id: nodeId }),
    });
    if (state.readerSessionId === readerSessionId) applyAssistantState(payload.assistant);
  } catch (error) {
    if (state.readerSessionId === readerSessionId) showAssistantError(error);
  }
}

function optimisticChildState(childSelection, nodeId) {
  const nextState = structuredClone(state.assistantState);
  const parent = nextState.current;
  const root = nextState.roots.find((candidate) => candidate.root_id === childSelection.rootId);
  if (!parent || !root) return false;
  const parentRef = { root_id: childSelection.rootId, node_id: childSelection.nodeId };
  const node = {
    node_id: nodeId,
    parent_ref: parentRef,
    depth: parent.depth + 1,
    label: childSelection.selectedText,
    active_child_id: null,
    child_pending: false,
    pending: true,
    error: null,
    turns: [],
  };
  root.nodes.push(node);
  root.focused_node_id = nodeId;
  if (childSelection.nodeId) {
    const parentNode = root.nodes.find((candidate) => candidate.node_id === childSelection.nodeId);
    if (parentNode) {
      parentNode.active_child_id = nodeId;
      parentNode.child_pending = true;
    }
  } else {
    root.active_child_id = nodeId;
    root.child_pending = true;
  }
  nextState.focused_ref = { root_id: childSelection.rootId, node_id: nodeId };
  nextState.current = {
    ...node,
    root_id: childSelection.rootId,
    provider: parent.provider,
    model: parent.model,
    scope: parent.scope,
    children: [],
    breadcrumb: [
      ...(parent.breadcrumb || []),
      { root_id: childSelection.rootId, node_id: nodeId, depth: node.depth, label: node.label },
    ],
  };
  state.assistantState = nextState;
  renderAssistantWorkspace();
  return true;
}

function markOptimisticChildError(rootId, nodeId, message) {
  const root = state.assistantState.roots.find((candidate) => candidate.root_id === rootId);
  const node = root?.nodes.find((candidate) => candidate.node_id === nodeId);
  if (!node) return;
  node.pending = false;
  node.error = message || "AI 解释失败，请稍后再试。";
  const parent = node.parent_ref.node_id
    ? root.nodes.find((candidate) => candidate.node_id === node.parent_ref.node_id)
    : root;
  if (parent) parent.child_pending = false;
  if (state.assistantState.current?.node_id === nodeId) {
    state.assistantState.current.pending = false;
    state.assistantState.current.error = node.error;
    renderAssistantWorkspace();
  }
}

function assistantSubtreeIds(root, nodeId) {
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of root?.nodes || []) {
      if (!removed.has(node.node_id) && removed.has(node.parent_ref?.node_id)) {
        removed.add(node.node_id);
        changed = true;
      }
    }
  }
  return removed;
}

async function closeFocusedAssistantLevel() {
  const current = state.assistantState.current;
  const readerSessionId = state.readerSessionId;
  if (!current || !readerSessionId) return;
  rememberAssistantScroll();
  hideAssistantAnswerActions(true);
  const closingChild = current.depth > 1;
  const root = state.assistantState.roots.find((candidate) => candidate.root_id === current.root_id);
  const removedNodeIds = closingChild ? assistantSubtreeIds(root, current.node_id) : null;
  try {
    const payload = await api(closingChild ? "/api/assistant/close-child" : "/api/assistant/close-root", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_session_id: readerSessionId,
        root_id: current.root_id,
        ...(closingChild ? { node_id: current.node_id } : {}),
      }),
    });
    if (state.readerSessionId === readerSessionId) {
      forgetAssistantScroll(current.root_id, removedNodeIds);
      applyAssistantState(payload.assistant);
    }
  } catch (error) {
    if (state.readerSessionId === readerSessionId) showAssistantError(error);
  }
}

function captureAssistantAnswerSelection() {
  hideAssistantAnswerActions();
  const current = state.assistantState.current;
  const selection = window.getSelection();
  if (!current || !selection || selection.isCollapsed || selection.rangeCount !== 1
      || current.depth >= 5 || current.child_pending || current.pending
      || state.assistantPending) return;
  const range = selection.getRangeAt(0);
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer : range.endContainer.parentElement;
  const startBubble = startElement?.closest(".assistant-answer-bubble");
  const endBubble = endElement?.closest(".assistant-answer-bubble");
  if (!startBubble || startBubble !== endBubble || startBubble.dataset.currentAnswer !== "true") return;
  const mapped = renderedSelectionToRaw(range, startBubble);
  if (mapped?.blocked) {
    announce(mapped.reason, true);
    return;
  }
  if (!mapped) {
    announce("这段渲染内容暂时无法精确对应原回答，请选择普通正文文字。", true);
    return;
  }
  state.assistantAnswerSelection = {
    rootId: startBubble.dataset.rootId,
    nodeId: startBubble.dataset.nodeId || null,
    turnId: startBubble.dataset.turnId,
    startOffset: mapped.startOffset,
    endOffset: mapped.endOffset,
    sourceSpans: mapped.sourceSpans,
    selectedText: mapped.selectedText,
  };
  const rect = range.getBoundingClientRect();
  const action = elements["assistant-answer-actions"];
  action.hidden = false;
  const box = action.getBoundingClientRect();
  action.style.left = `${Math.max(6, Math.min(innerWidth - box.width - 6, rect.left))}px`;
  action.style.top = `${Math.max(72, rect.top - box.height - 7)}px`;
}

function hideAssistantAnswerActions(clearNativeSelection = false) {
  elements["assistant-answer-actions"].hidden = true;
  state.assistantAnswerSelection = null;
  if (clearNativeSelection) window.getSelection()?.removeAllRanges();
}

async function sendAssistantChild() {
  const childSelection = state.assistantAnswerSelection;
  const readerSessionId = state.readerSessionId;
  if (!childSelection || !readerSessionId || state.assistantPending) return;
  const requestKey = assistantLocationKey(childSelection.rootId, childSelection.nodeId);
  if (state.assistantChildRequests.has(requestKey)) return;
  const nodeId = crypto.randomUUID();
  rememberAssistantScroll();
  hideAssistantAnswerActions(true);
  if (!optimisticChildState(childSelection, nodeId)) return;
  state.assistantChildRequests.set(requestKey, nodeId);
  try {
    const payload = await api("/api/assistant/child", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_session_id: readerSessionId,
        root_id: childSelection.rootId,
        parent_node_id: childSelection.nodeId,
        turn_id: childSelection.turnId,
        start_offset: childSelection.startOffset,
        end_offset: childSelection.endOffset,
        source_spans: childSelection.sourceSpans,
        node_id: nodeId,
      }),
    });
    if (state.readerSessionId === readerSessionId) applyAssistantState(payload.assistant);
  } catch (error) {
    if (state.readerSessionId === readerSessionId
        && error.code !== "ASSISTANT_REQUEST_CANCELLED") {
      markOptimisticChildError(childSelection.rootId, nodeId, error.message);
    }
    if (error.code?.startsWith("AI_")) await refreshAssistantStatus();
  } finally {
    state.assistantChildRequests.delete(requestKey);
    syncModelSelector();
  }
}

async function saveAssistantTurn(button) {
  if (button.disabled || button.dataset.saving === "true") return;
  const readerSessionId = state.readerSessionId;
  const revisionId = state.revision?.id;
  const rootId = button.dataset.rootId;
  const nodeId = button.dataset.nodeId || null;
  const turnId = button.dataset.turnId;
  if (!readerSessionId || !revisionId || !rootId || !turnId) return;
  const turnKey = assistantTurnKey(rootId, nodeId, turnId);
  const saveIntentId = state.assistantSaveIntents.get(turnKey) || crypto.randomUUID();
  state.assistantSaveIntents.set(turnKey, saveIntentId);
  button.dataset.saving = "true";
  button.disabled = true;
  button.textContent = "正在保存…";
  try {
    const payload = await api(`/api/revisions/${revisionId}/assistant/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reader_session_id: readerSessionId,
        root_id: rootId,
        node_id: nodeId,
        turn_id: turnId,
        save_intent_id: saveIntentId,
      }),
    });
    if (state.revision?.id !== revisionId) return;
    state.assistantSavedTurns.set(turnKey, payload.annotation.id);
    upsertAnnotation(payload.annotation);
    renderAnnotations(payload.annotation.pdf_page_index);
    updateMarksPanel();
    renderAssistantWorkspace();
    announce("已保存到笔记；AI 审查会随后更新状态。");
    pollSavedExplanationReview(payload.annotation.id, payload.annotation.pdf_page_index, 0);
  } catch (error) {
    if (state.revision?.id !== revisionId) return;
    button.disabled = false;
    button.textContent = "重试保存到笔记";
    announce(`保存失败：${error.message || "请稍后重试。"}`, true);
  } finally {
    delete button.dataset.saving;
  }
}

function upsertAnnotation(annotation) {
  const pageIndex = annotation.pdf_page_index;
  const values = state.annotationData.get(pageIndex) || [];
  const existing = values.findIndex((value) => value.id === annotation.id);
  const next = [...values];
  if (existing >= 0) next[existing] = annotation;
  else next.push(annotation);
  state.annotationData.set(pageIndex, next);
}

async function refreshAnnotationPage(pageIndex) {
  const revisionId = state.revision?.id;
  if (!revisionId) return [];
  const payload = await api(`/api/revisions/${revisionId}/annotations?page=${pageIndex}`);
  if (state.revision?.id !== revisionId) return [];
  state.annotationData.set(pageIndex, payload.annotations);
  renderAnnotations(pageIndex);
  if (pageIndex === state.currentPage) updateMarksPanel();
  return payload.annotations;
}

function pollSavedExplanationReview(annotationId, pageIndex, attempt) {
  const delays = [450, 900, 1800, 3600, 7200, 15000, 30000, 60000];
  const previous = state.assistantReviewPolls.get(annotationId);
  if (previous) clearTimeout(previous);
  if (attempt >= delays.length) {
    state.assistantReviewPolls.delete(annotationId);
    return;
  }
  const revisionId = state.revision?.id;
  const timer = setTimeout(async () => {
    state.assistantReviewPolls.delete(annotationId);
    if (!revisionId || state.revision?.id !== revisionId) return;
    try {
      const values = await refreshAnnotationPage(pageIndex);
      const annotation = values.find((value) => value.id === annotationId);
      if (annotation?.verification_state === "PENDING") {
        pollSavedExplanationReview(annotationId, pageIndex, attempt + 1);
      }
    } catch (_error) {
      pollSavedExplanationReview(annotationId, pageIndex, attempt + 1);
    }
  }, delays[attempt]);
  state.assistantReviewPolls.set(annotationId, timer);
}

async function retrySavedExplanationReview(annotation, button) {
  const revisionId = state.revision?.id;
  if (!revisionId || button.disabled) return;
  button.disabled = true;
  button.textContent = "正在重试…";
  try {
    await api(`/api/revisions/${revisionId}/annotations/${annotation.id}/review`, {
      method: "POST",
    });
    if (state.revision?.id !== revisionId) return;
    announce("已重新提交 AI 审查；已保存内容不受影响。");
    pollSavedExplanationReview(annotation.id, annotation.pdf_page_index, 0);
  } catch (error) {
    if (state.revision?.id === revisionId) {
      button.disabled = false;
      button.textContent = "重试 AI 审查";
      announce(error.message || "AI 审查未能重试。", true);
    }
  }
}

async function ensureOverlay(index) {
  if (state.preparation.get(index)?.status !== "READY") return;
  const revisionId = state.revision?.id;
  if (!revisionId) return;
  const wrapper = elements.pages.children[index];
  if (!wrapper?.querySelector("canvas") || wrapper.querySelector(".text-overlay")) return;
  let data = state.overlayData.get(index);
  if (!data) {
    try {
      const payload = await api(`/api/revisions/${revisionId}/overlay?page=${index}`);
      if (payload.page.status !== "READY" || state.revision?.id !== revisionId) return;
      data = payload.page;
      state.overlayData.set(index, data);
    } catch (_error) {
      return;
    }
  }
  let annotations = state.annotationData.get(index);
  if (!annotations) {
    try {
      annotations = await refreshAnnotationPage(index);
      if (state.revision?.id !== revisionId) return;
    } catch (_error) {
      // A marks-list failure must not take away R2's selectable text overlay.
      annotations = [];
    }
  }
  if (!wrapper.querySelector("canvas") || wrapper.querySelector(".text-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "text-overlay";
  overlay.setAttribute("aria-label", `PDF 第 ${index + 1} 页可选择文字`);
  overlay.dataset.pageIndex = String(index);
  for (const line of data.lines) {
    const bounds = lineBounds(line);
    const marker = document.createElement("span");
    marker.className = "ocr-line";
    marker.dataset.lineOrdinal = String(line.line_ordinal);
    marker.style.cssText = `left:${bounds.x0 * 100}%;top:${bounds.y0 * 100}%;width:${(bounds.x1 - bounds.x0) * 100}%;height:${(bounds.y1 - bounds.y0) * 100}%`;
    marker.textContent = line.text;
    marker.setAttribute("aria-hidden", "true");
    overlay.append(marker);
  }
  overlay.addEventListener("pointerdown", beginSelection);
  overlay.addEventListener("pointermove", extendSelection);
  overlay.addEventListener("pointerup", finishSelection);
  overlay.addEventListener("pointercancel", finishSelection);
  overlay.addEventListener("contextmenu", openSelectionContextMenu);
  wrapper.append(overlay);
  renderAnnotations(index, overlay);
  renderSearchMatch(index, overlay);
  if (index === state.currentPage) updateMarksPanel();
}

function renderAnnotations(index, overlay = elements.pages.children[index]?.querySelector(".text-overlay")) {
  if (!overlay) return;
  overlay.querySelectorAll(".annotation-quad").forEach((node) => node.remove());
  for (const annotation of state.annotationData.get(index) || []) {
    for (const quad of annotation.quads) {
      const xs = quad.map(([x]) => x);
      const ys = quad.map(([, y]) => y);
      const marker = document.createElement("span");
      marker.className = `annotation-quad annotation-style-${annotation.highlight_style.toLowerCase()}`;
      marker.dataset.annotationId = annotation.id;
      marker.style.cssText = `left:${Math.min(...xs) * 100}%;top:${Math.min(...ys) * 100}%;width:${(Math.max(...xs) - Math.min(...xs)) * 100}%;height:${(Math.max(...ys) - Math.min(...ys)) * 100}%`;
      overlay.append(marker);
    }
  }
}

function updateMarksPanel() {
  const values = state.annotationData.get(state.currentPage) || [];
  elements["marks-count"].textContent = String(values.length);
  elements["marks-count"].hidden = values.length === 0;
  elements["marks-toggle"].setAttribute(
    "aria-label", `本页标记${values.length ? `（${values.length}）` : ""}`,
  );
  elements["marks-page"].textContent = String(state.currentPage + 1);
  const cards = values.map((annotation) => {
    const card = document.createElement("article");
    card.className = `mark-card annotation-style-${annotation.highlight_style.toLowerCase()}`;
    if (annotation.source_kind === "AI_SAVED") {
      card.classList.add("mark-card-ai-saved");
      const heading = document.createElement("div");
      heading.className = "mark-ai-heading";
      const badge = document.createElement("strong");
      badge.textContent = "AI 保存的解释";
      const verification = document.createElement("span");
      verification.className = `mark-verification mark-verification-${annotation.verification_state.toLowerCase()}`;
      verification.textContent = ({
        PENDING: "待 AI 审查",
        PASS: "已通过 AI 审查",
        FAIL: "AI 审查未通过",
        TECHNICAL_FAILURE: "暂时无法审查 · 可重试",
      })[annotation.verification_state] || "审查状态未知";
      heading.append(badge, verification);
      card.append(heading);

      const source = document.createElement("section");
      source.className = "mark-ai-section";
      const sourceLabel = document.createElement("strong");
      sourceLabel.textContent = "教材来源（SOURCE）";
      const sourceLocation = document.createElement("button");
      sourceLocation.type = "button";
      sourceLocation.className = "mark-source-location";
      sourceLocation.textContent = `PDF 第 ${annotation.pdf_page_index + 1} 页`;
      sourceLocation.addEventListener("click", () => goToPage(annotation.pdf_page_index));
      const quote = document.createElement("q");
      quote.className = "mark-quote";
      quote.textContent = annotation.quote;
      source.append(sourceLabel, sourceLocation, quote);
      card.append(source);

      const provenance = document.createElement("section");
      provenance.className = "mark-ai-section";
      const provenanceLabel = document.createElement("strong");
      provenanceLabel.textContent = "解释路径（PROVENANCE）";
      const path = document.createElement("p");
      path.className = "mark-provenance";
      path.textContent = (annotation.provenance?.concept_path || []).join(" › ");
      provenance.append(provenanceLabel, path);
      if (annotation.provenance?.answer_question
          && annotation.provenance.answer_question !== annotation.provenance.child_focus
          && annotation.provenance.answer_question !== annotation.provenance.root_focus) {
        const question = document.createElement("p");
        question.className = "mark-provenance-question";
        question.textContent = `当时的问题：${annotation.provenance.answer_question}`;
        provenance.append(question);
      }
      card.append(provenance);

      const content = document.createElement("section");
      content.className = "mark-ai-section";
      const contentLabel = document.createElement("strong");
      contentLabel.textContent = "AI 正文（AI CONTENT）";
      const answer = document.createElement("div");
      answer.className = "mark-ai-content assistant-answer-bubble";
      renderAssistantAnswer(answer, annotation.body);
      content.append(contentLabel, answer);
      card.append(content);

      if (annotation.review_summary) {
        const summary = document.createElement("p");
        summary.className = "mark-review-summary";
        summary.textContent = annotation.review_summary;
        card.append(summary);
      }
      if (annotation.review_provider && annotation.review_model) {
        const reviewer = document.createElement("small");
        reviewer.className = "mark-reviewer";
        reviewer.textContent = `审查模型：${annotation.review_provider} · ${annotation.review_model}`;
        card.append(reviewer);
      }
      if (["PENDING", "TECHNICAL_FAILURE"].includes(annotation.verification_state)) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "mark-review-retry";
        retry.textContent = annotation.verification_state === "PENDING"
          ? "重新提交 AI 审查" : "重试 AI 审查";
        retry.addEventListener("click", () => retrySavedExplanationReview(annotation, retry));
        card.append(retry);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "mark-remove";
      remove.textContent = "删除这条 AI 笔记";
      remove.addEventListener("click", () => deleteAnnotation(annotation));
      card.append(remove);
      return card;
    }
    const quote = document.createElement("p");
    quote.className = "mark-quote";
    quote.textContent = annotation.quote;
    card.append(quote);
    if (annotation.body) {
      const note = document.createElement("p");
      note.className = "mark-note";
      note.textContent = annotation.body;
      card.append(note);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mark-remove";
    remove.textContent = "删除标记";
    remove.addEventListener("click", () => deleteAnnotation(annotation));
    card.append(remove);
    return card;
  });
  elements["marks-list"].replaceChildren(...cards);
  elements["marks-empty"].hidden = values.length > 0;
}

async function deleteAnnotation(annotation) {
  const question = annotation.source_kind === "AI_SAVED"
    ? "删除这条已保存的 AI 笔记？" : "删除这条标记及其笔记？";
  if (!window.confirm(question)) return;
  const revisionId = state.revision?.id;
  if (!revisionId) return;
  try {
    await api(`/api/revisions/${revisionId}/annotations/${annotation.id}`, { method: "DELETE" });
    const pageIndex = annotation.pdf_page_index;
    state.annotationData.set(
      pageIndex,
      (state.annotationData.get(pageIndex) || []).filter((value) => value.id !== annotation.id),
    );
    renderAnnotations(pageIndex);
    updateMarksPanel();
    announce("标记已删除。");
  } catch (_error) {
    announce("标记未删除，请稍后重试。", true);
  }
}

function selectionPoint(event, overlay) {
  const index = Number(overlay.dataset.pageIndex);
  const data = state.overlayData.get(index);
  if (!data?.lines.length) return null;
  const rect = overlay.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  const line = nearestLine(data.lines, x, y);
  return { pageIndex: index, lineOrdinal: line.line_ordinal, boundary: nearestCellBoundary(line, x) };
}

function beginSelection(event) {
  if (event.button !== 0) return;
  const point = selectionPoint(event, event.currentTarget);
  if (!point) return;
  event.preventDefault();
  clearSelection();
  state.selection = { pageIndex: point.pageIndex, anchor: point, focus: point, resolved: [] };
  state.selecting = true;
  event.currentTarget.setPointerCapture(event.pointerId);
  elements.viewer.focus({ preventScroll: true });
}

function extendSelection(event) {
  if (!state.selecting || state.selection?.pageIndex !== Number(event.currentTarget.dataset.pageIndex)) return;
  const point = selectionPoint(event, event.currentTarget);
  if (!point) return;
  state.selection.focus = point;
  renderSelection();
}

function finishSelection(event) {
  if (!state.selecting) return;
  extendSelection(event);
  state.selecting = false;
  hideSelectionActions();
}

function renderSelection() {
  if (!state.selection) return;
  document.querySelectorAll(".selection-quad").forEach((node) => node.remove());
  const data = state.overlayData.get(state.selection.pageIndex);
  state.selection.resolved = resolveSelection(data.lines, state.selection.anchor, state.selection.focus);
  syncAskEligibility();
  const overlay = elements.pages.children[state.selection.pageIndex]?.querySelector(".text-overlay");
  if (!overlay) return;
  for (const quad of selectionPresentationQuads(state.selection.resolved)) {
    const xs = quad.map(([x]) => x);
    const ys = quad.map(([, y]) => y);
    const marker = document.createElement("span");
    marker.className = "selection-quad";
    marker.style.cssText = `left:${Math.min(...xs) * 100}%;top:${Math.min(...ys) * 100}%;width:${(Math.max(...xs) - Math.min(...xs)) * 100}%;height:${(Math.max(...ys) - Math.min(...ys)) * 100}%`;
    overlay.append(marker);
  }
  syncNativeSelection(overlay);
  hideSelectionActions();
}

function showSelectionActions(clientX, clientY) {
  for (const id of ["save-highlight", "add-note"]) elements[id].hidden = Boolean(state.guideSelection);
  elements["selection-actions"].querySelector(".highlight-styles").hidden = Boolean(state.guideSelection);
  state.selectionMenuPoint = { x: clientX, y: clientY };
  elements["selection-actions"].hidden = false;
  positionSelectionActions();
}

function positionSelectionActions() {
  if (!(state.selection?.resolved.length || state.guideSelection) || !state.selectionMenuPoint
      || elements["selection-actions"].hidden) return;
  const point = state.selectionMenuPoint;
  const menu = elements["selection-actions"];
  requestAnimationFrame(() => {
    if (menu.hidden || !(state.selection || state.guideSelection)) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const below = point.y + 5;
    const above = point.y - height - 5;
    const top = below + height <= window.innerHeight - 8 ? below : above;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, point.x + 5))}px`;
    menu.style.top = `${Math.max(76, Math.min(window.innerHeight - height - 8, top))}px`;
  });
}

function hideSelectionActions() {
  state.guideSelection = null;
  elements["selection-actions"].hidden = true;
  elements["note-editor"].hidden = true;
  elements["add-note"].setAttribute("aria-expanded", "false");
  elements["annotation-note"].value = "";
  document.querySelector('input[name="highlight-style"][value="YELLOW"]').checked = true;
  state.selectionMenuPoint = null;
}

function syncNativeSelection(overlay) {
  const nativeSelection = window.getSelection();
  nativeSelection.removeAllRanges();
  if (!state.selection?.resolved.length) return;
  const first = state.selection.resolved[0];
  const last = state.selection.resolved.at(-1);
  const start = overlay.querySelector(`.ocr-line[data-line-ordinal="${first.line_ordinal}"]`)?.firstChild;
  const end = overlay.querySelector(`.ocr-line[data-line-ordinal="${last.line_ordinal}"]`)?.firstChild;
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(start, first.char_start);
  range.setEnd(end, last.char_end);
  nativeSelection.addRange(range);
}

function openSelectionContextMenu(event) {
  if (!state.selection?.resolved.length
      || state.selection.pageIndex !== Number(event.currentTarget.dataset.pageIndex)) {
    hideSelectionActions();
    return;
  }
  const overlay = event.currentTarget;
  const rect = overlay.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const inside = state.selection.resolved.some((range) => range.quads.some((quad) => {
    const xs = quad.map(([value]) => value);
    const ys = quad.map(([, value]) => value);
    return x >= Math.min(...xs) && x <= Math.max(...xs)
      && y >= Math.min(...ys) && y <= Math.max(...ys);
  }));
  if (!inside) {
    hideSelectionActions();
    return;
  }
  syncNativeSelection(overlay);
  event.preventDefault();
  showSelectionActions(event.clientX, event.clientY);
}

function clearSelection() {
  document.querySelectorAll(".selection-quad").forEach((node) => node.remove());
  window.getSelection()?.removeAllRanges();
  state.selection = null;
  state.selecting = false;
  syncAskEligibility();
  hideSelectionActions();
}

function selectedHighlightStyle() {
  return document.querySelector('input[name="highlight-style"]:checked')?.value || "YELLOW";
}

async function saveAnnotation(body = null) {
  const selection = state.selection;
  const revisionId = state.revision?.id;
  if (!selection?.resolved.length || !revisionId) return;
  elements["save-highlight"].disabled = true;
  elements["save-note"].disabled = true;
  try {
    const payload = await api(`/api/revisions/${revisionId}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdf_page_index: selection.pageIndex,
        start: {
          line_ordinal: selection.anchor.lineOrdinal,
          boundary: selection.anchor.boundary,
        },
        end: {
          line_ordinal: selection.focus.lineOrdinal,
          boundary: selection.focus.boundary,
        },
        body,
        highlight_style: selectedHighlightStyle(),
      }),
    });
    if (state.revision?.id !== revisionId) return;
    const values = state.annotationData.get(selection.pageIndex) || [];
    state.annotationData.set(selection.pageIndex, [...values, payload.annotation]);
    const pageIndex = selection.pageIndex;
    clearSelection();
    renderAnnotations(pageIndex);
    updateMarksPanel();
    announce(payload.annotation.body ? "笔记已保存。" : "高亮已保存。");
  } catch (_error) {
    announce("标记未保存，请稍后重试。", true);
  } finally {
    elements["save-highlight"].disabled = false;
    elements["save-note"].disabled = false;
  }
}

async function copySelection() {
  const text = state.guideSelection?.text || resolvedText(state.selection?.resolved || []);
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    hideSelectionActions();
    announce("已复制所选文字。");
  } catch (_error) {
    announce("所选文字未复制，请重试。", true);
  }
}

function moveSelectionFocus(key) {
  if (!state.selection) return;
  const data = state.overlayData.get(state.selection.pageIndex);
  const lines = data.lines;
  let lineIndex = lines.findIndex((line) => line.line_ordinal === state.selection.focus.lineOrdinal);
  let boundary = state.selection.focus.boundary;
  if (key === "ArrowLeft") boundary -= 1;
  if (key === "ArrowRight") boundary += 1;
  if (key === "ArrowUp") lineIndex -= 1;
  if (key === "ArrowDown") lineIndex += 1;
  lineIndex = Math.max(0, Math.min(lines.length - 1, lineIndex));
  boundary = Math.max(0, Math.min(lines[lineIndex].cells.length, boundary));
  state.selection.focus = {
    pageIndex: state.selection.pageIndex,
    lineOrdinal: lines[lineIndex].line_ordinal,
    boundary,
  };
  renderSelection();
}

function initializeKeyboardSelection() {
  const data = state.overlayData.get(state.currentPage);
  const firstLine = data?.lines.find((line) => line.cells.length);
  if (!firstLine) return false;
  const point = {
    pageIndex: state.currentPage,
    lineOrdinal: firstLine.line_ordinal,
    boundary: 0,
  };
  state.selection = {
    pageIndex: state.currentPage,
    anchor: point,
    focus: { ...point },
    resolved: [],
  };
  return true;
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

elements["import-input"].addEventListener("change", () => {
  const file = elements["import-input"].files[0];
  if (file) importPdf(file);
});
elements.viewer.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
elements["previous-page"].addEventListener("click", () => goToPage(state.currentPage - 1));
elements["next-page"].addEventListener("click", () => goToPage(state.currentPage + 1));
elements["page-number"].addEventListener("change", () => goToPage(Number(elements["page-number"].value) - 1));
elements["page-number"].addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    goToPage(Number(elements["page-number"].value) - 1);
    elements.viewer.focus();
  }
});
elements["zoom-out"].addEventListener("click", () => setZoom(adjacentZoom(-1)));
elements["zoom-in"].addEventListener("click", () => setZoom(adjacentZoom(1)));
elements["back-to-library"].addEventListener("click", returnToLibrary);
elements["printed-page-edit"].addEventListener("click", editPrintedPageLabel);
elements["outline-toggle"].addEventListener("click", async () => {
  const opening = elements["outline-panel"].hidden;
  elements["outline-panel"].hidden = !opening;
  elements["outline-toggle"].setAttribute("aria-expanded", String(opening));
  if (opening) {
    elements["search-panel"].hidden = true;
    elements["marks-panel"].hidden = true;
    elements["knowledge-panel"].hidden = true;
    elements["search-toggle"].setAttribute("aria-expanded", "false");
    elements["marks-toggle"].setAttribute("aria-expanded", "false");
    elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
    state.searchRequest += 1;
    clearSearchMatch();
    await loadBookMap();
  }
});
elements["outline-close"].addEventListener("click", () => {
  elements["outline-panel"].hidden = true;
  elements["outline-toggle"].setAttribute("aria-expanded", "false");
});
elements["knowledge-toggle"].addEventListener("click", () => {
  if (elements["knowledge-panel"].hidden) openKnowledgePanel(state.knowledgeChapterId);
  else {
    elements["knowledge-panel"].hidden = true;
    elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
    clearTimeout(state.knowledgePollTimer);
  }
});
elements["knowledge-close"].addEventListener("click", () => {
  elements["knowledge-panel"].hidden = true;
  elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
  clearTimeout(state.knowledgePollTimer);
});
elements["knowledge-prepare"].addEventListener("click", prepareKnowledgeMap);
elements["search-toggle"].addEventListener("click", () => {
  const opening = elements["search-panel"].hidden;
  elements["search-panel"].hidden = !opening;
  elements["search-toggle"].setAttribute("aria-expanded", String(opening));
  if (opening) {
    setAssistantPanelOpen(false);
    elements["outline-panel"].hidden = true;
    elements["outline-toggle"].setAttribute("aria-expanded", "false");
    elements["knowledge-panel"].hidden = true;
    elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
    elements["marks-panel"].hidden = true;
    elements["marks-toggle"].setAttribute("aria-expanded", "false");
    runSearch();
    elements["search-query"].focus({ preventScroll: true });
  } else {
    state.searchRequest += 1;
    clearSearchMatch();
  }
});
elements["search-close"].addEventListener("click", () => {
  elements["search-panel"].hidden = true;
  elements["search-toggle"].setAttribute("aria-expanded", "false");
  state.searchRequest += 1;
  clearSearchMatch();
});
elements["search-form"].addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
elements["search-query"].addEventListener("input", () => {
  if (!elements["search-query"].value.trim()) {
    state.searchRequest += 1;
    clearSearchMatch();
    elements["search-results"].replaceChildren();
    elements["search-empty"].textContent = "输入关键词以搜索已准备页面。";
    elements["search-empty"].hidden = false;
  }
});
elements["marks-toggle"].addEventListener("click", async () => {
  const opening = elements["marks-panel"].hidden;
  elements["marks-panel"].hidden = !opening;
  elements["marks-toggle"].setAttribute("aria-expanded", String(opening));
  if (opening) {
    setAssistantPanelOpen(false);
    elements["outline-panel"].hidden = true;
    elements["outline-toggle"].setAttribute("aria-expanded", "false");
    elements["knowledge-panel"].hidden = true;
    elements["knowledge-toggle"].setAttribute("aria-expanded", "false");
    elements["search-panel"].hidden = true;
    elements["search-toggle"].setAttribute("aria-expanded", "false");
    state.searchRequest += 1;
    clearSearchMatch();
    try {
      await refreshAnnotationPage(state.currentPage);
    } catch (_error) {
      announce("标记暂时无法刷新，请稍后重试。", true);
    }
  }
  updateMarksPanel();
});
elements["marks-close"].addEventListener("click", () => {
  elements["marks-panel"].hidden = true;
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
});
elements["copy-selection"].addEventListener("click", copySelection);
elements["ask-selection"].addEventListener("click", stageAssistantSelection);
elements["assistant-toggle"].addEventListener("click", () => {
  const opening = elements["assistant-panel"].hidden;
  if (opening) {
    openAssistantPanel();
  } else {
    setAssistantPanelOpen(false, { focusViewer: true });
  }
});
elements["assistant-expand"].addEventListener("click", () => {
  setAssistantExpanded(!state.assistantExpanded);
});
elements["assistant-resize-handle"].addEventListener("pointerdown", beginAssistantResize);
elements["assistant-resize-handle"].addEventListener("pointermove", continueAssistantResize);
elements["assistant-resize-handle"].addEventListener("pointerup", finishAssistantResize);
elements["assistant-resize-handle"].addEventListener("pointercancel", finishAssistantResize);
elements["assistant-resize-handle"].addEventListener("keydown", (event) => {
  if (state.assistantExpanded) return;
  const { minimum, maximum } = assistantDockLimits();
  let width = state.assistantDockWidth;
  if (event.key === "ArrowLeft") width += 16;
  else if (event.key === "ArrowRight") width -= 16;
  else if (event.key === "Home") width = minimum;
  else if (event.key === "End") width = maximum;
  else return;
  event.preventDefault();
  const anchor = captureZoomAnchor();
  applyAssistantDockWidth(width);
  if (anchor && state.revision) relayoutPages(anchor);
});
elements["assistant-model"].addEventListener("change", () => {
  if ((state.assistantState.current && !state.assistantDraft) || state.assistantPending) {
    syncModelSelector();
    return;
  }
  state.assistantActiveProvider = elements["assistant-model"].value;
  applySelectedProviderStatus();
  elements["assistant-turns"].querySelectorAll(".assistant-error").forEach((node) => node.remove());
  if (state.assistantDraft) renderAssistantDraft();
  else resetAssistantPanel();
  refreshAssistantStatus();
});
elements["assistant-first-turn"].addEventListener("submit", (event) => {
  event.preventDefault();
  sendAssistantFirstTurn();
});
elements["assistant-root-switcher"].addEventListener("change", () => {
  const rootId = elements["assistant-root-switcher"].value;
  const root = state.assistantState.roots.find((candidate) => candidate.root_id === rootId);
  focusAssistant(rootId, root?.focused_node_id || null);
});
elements["assistant-back"].addEventListener("click", () => {
  const parent = state.assistantState.current?.parent_ref;
  if (parent) focusAssistant(parent.root_id, parent.node_id);
});
elements["assistant-child-list"].addEventListener("click", (event) => {
  const button = event.target.closest("button[data-node-id]");
  if (button) focusAssistant(button.dataset.rootId, button.dataset.nodeId);
});
elements["assistant-breadcrumb"].addEventListener("click", (event) => {
  const button = event.target.closest("button[data-root-id]");
  if (button && !button.disabled) focusAssistant(button.dataset.rootId, button.dataset.nodeId || null);
});
elements["assistant-close-root"].addEventListener("click", closeFocusedAssistantLevel);
elements["assistant-close"].addEventListener("click", () => {
  setAssistantPanelOpen(false, { focusViewer: true });
});
elements["assistant-follow-up"].addEventListener("submit", (event) => {
  event.preventDefault();
  sendAssistantFollowUp();
});
elements["assistant-turns"].addEventListener("pointerup", () => {
  setTimeout(captureAssistantAnswerSelection, 0);
});
elements["assistant-turns"].addEventListener("contextmenu", (event) => {
  captureAssistantAnswerSelection();
  if (!elements["assistant-answer-actions"].hidden) event.preventDefault();
});
elements["assistant-turns"].addEventListener("click", (event) => {
  const save = event.target.closest(".assistant-save-note");
  if (save) saveAssistantTurn(save);
});
elements["assistant-ask-deeper"].addEventListener("click", sendAssistantChild);
elements["save-highlight"].addEventListener("click", () => saveAnnotation());
elements["add-note"].addEventListener("click", () => {
  const opening = elements["note-editor"].hidden;
  elements["note-editor"].hidden = !opening;
  elements["add-note"].setAttribute("aria-expanded", String(opening));
  positionSelectionActions();
  if (opening) elements["annotation-note"].focus({ preventScroll: true });
});
elements["note-editor"].addEventListener("submit", (event) => {
  event.preventDefault();
  saveAnnotation(elements["annotation-note"].value);
});
elements["cancel-selection"].addEventListener("click", clearSelection);
elements["selection-actions"].addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
    elements.viewer.focus({ preventScroll: true });
  }
});
elements.viewer.addEventListener("pointerdown", () => elements.viewer.focus({ preventScroll: true }));
elements.viewer.addEventListener("contextmenu", (event) => {
  if (!event.defaultPrevented) hideSelectionActions();
});
elements.viewer.addEventListener("scroll", hideSelectionActions, { passive: true });
elements.viewer.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  setZoom(adjacentZoom(direction), captureZoomAnchor(event.clientX, event.clientY));
}, { passive: false });
elements.viewer.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selection) {
    event.preventDefault();
    clearSelection();
    return;
  }
  if (event.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      && (state.selection || initializeKeyboardSelection())) {
    event.preventDefault();
    moveSelectionFocus(event.key);
    return;
  }
  if (!event.ctrlKey) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(adjacentZoom(1));
  } else if (event.key === "-") {
    event.preventDefault();
    setZoom(adjacentZoom(-1));
  }
});
document.addEventListener("copy", (event) => {
  const native = window.getSelection();
  if (native?.anchorNode?.parentElement?.closest(".guide-text")) return;
  const text = resolvedText(state.selection?.resolved || []);
  if (!text) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  announce("已复制所选文字。");
});
document.addEventListener("pointerdown", (event) => {
  if (!elements["selection-actions"].hidden
      && !elements["selection-actions"].contains(event.target)) hideSelectionActions();
  if (!elements["assistant-answer-actions"].hidden
      && !elements["assistant-answer-actions"].contains(event.target)
      && !event.target.closest(".assistant-answer-bubble")) hideAssistantAnswerActions();
}, true);
window.addEventListener("resize", () => {
  applyAssistantDockWidth(state.assistantDockWidth);
  positionSelectionActions();
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(relayoutPages, 120);
});
document.addEventListener("visibilitychange", () => document.hidden && savePosition());
window.addEventListener("pagehide", () => {
  savePositionKeepalive();
  clearAssistantSession({ keepalive: true }).catch(() => {});
});

applyAssistantDockWidth(state.assistantDockWidth);
renderAssistantViewportMode();
loadBooks().catch(() => announce("书库加载失败，请刷新后重试。", true));
