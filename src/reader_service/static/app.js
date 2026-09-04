import * as pdfjsLib from "/vendor/pdf.mjs";
import {
  lineBounds, nearestCellBoundary, nearestLine, resolveSelection, resolvedText,
  selectionPresentationQuads,
} from "/selection.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";

const elements = Object.fromEntries(
  ["library-home", "library-empty", "import-input", "book-list", "book-count", "reader", "reader-title", "viewer", "pages", "page-number", "page-total", "previous-page", "next-page", "zoom-out", "zoom-in", "zoom-value", "preparation-status", "status", "back-to-library", "search-toggle", "search-panel", "search-close", "search-form", "search-query", "search-coverage", "search-results", "search-empty", "marks-toggle", "marks-count", "marks-panel", "marks-page", "marks-list", "marks-empty", "marks-close", "selection-actions", "copy-selection", "save-highlight", "add-note", "cancel-selection", "note-editor", "annotation-note", "save-note"]
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
  annotationData: new Map(), selection: null, selecting: false, selectionMenuPoint: null,
  searchRequest: 0, searchMatch: null,
};

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "X-Reader-Token": launchToken, ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({ error: `请求失败（${response.status}）` }));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
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
  const confirmed = window.confirm(`删除《${book.title}》？\n\n这会永久删除本应用中保存的 PDF 版本、阅读位置、高亮和笔记，且无法撤销。`);
  if (!confirmed) return;
  try {
    await api(`/api/books/${book.id}`, { method: "DELETE" });
    if (state.book?.id === book.id) state.book = null;
    await loadBooks();
    announce("已删除教材、阅读位置、高亮和笔记。");
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
  try {
    const loading = pdfjsLib.getDocument({
      url: `/api/revisions/${state.revision.id}/pdf`,
      httpHeaders: { "X-Reader-Token": launchToken },
      withCredentials: true,
    });
    const pdf = await loading.promise;
    if (generation !== state.generation) return;
    state.pdf = pdf;
    if (pdf.numPages !== state.revision.page_count) throw new Error("保存的 PDF 元数据与来源文件不再一致");
    await nextFrame();
    applyRestoredPosition();
    scheduleViewportUpdate();
    startPreparation();
  } catch (_error) {
    announce("无法打开这份 PDF，请重试。", true);
  }
}

function closeReader() {
  state.generation += 1;
  cancelRenders();
  closePreparationStream();
  clearSelection();
  clearSearchMatch();
  state.book = null;
  state.revision = null;
  state.pdf = null;
  elements.reader.hidden = true;
  elements["marks-panel"].hidden = true;
  elements["search-panel"].hidden = true;
  elements["search-toggle"].setAttribute("aria-expanded", "false");
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
  elements["library-home"].hidden = false;
  elements.pages.replaceChildren();
  renderLibrary();
}

async function returnToLibrary() {
  await savePosition();
  closeReader();
}

function displayedRatio(geometry) {
  const [x0, y0, x1, y1] = geometry.media_box;
  const width = x1 - x0;
  const height = y1 - y0;
  return geometry.rotation % 180 === 0 ? height / width : width / height;
}

function pageWidth() {
  return Math.max(240, Math.min(920, elements.viewer.clientWidth - 72)) * state.zoom;
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
  const fits = size.cssWidth <= elements.viewer.clientWidth - 64;
  const naturalLeft = fits ? (elements.viewer.clientWidth - size.cssWidth) / 2 : 32;
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
    const pageBottom = pageTop + page.offsetHeight;
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
  restoreZoomAnchor(anchor);
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
  if (!state.revision) return;
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
  if (!state.revision) return;
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
      const payload = await api(`/api/revisions/${revisionId}/annotations?page=${index}`);
      if (state.revision?.id !== revisionId) return;
      annotations = payload.annotations;
      state.annotationData.set(index, annotations);
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
  if (!window.confirm("删除这条标记及其笔记？")) return;
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
  state.selectionMenuPoint = { x: clientX, y: clientY };
  elements["selection-actions"].hidden = false;
  positionSelectionActions();
}

function positionSelectionActions() {
  if (!state.selection?.resolved.length || !state.selectionMenuPoint
      || elements["selection-actions"].hidden) return;
  const point = state.selectionMenuPoint;
  const menu = elements["selection-actions"];
  requestAnimationFrame(() => {
    if (menu.hidden || !state.selection) return;
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
  const text = resolvedText(state.selection?.resolved || []);
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
elements["search-toggle"].addEventListener("click", () => {
  const opening = elements["search-panel"].hidden;
  elements["search-panel"].hidden = !opening;
  elements["search-toggle"].setAttribute("aria-expanded", String(opening));
  if (opening) {
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
elements["marks-toggle"].addEventListener("click", () => {
  const opening = elements["marks-panel"].hidden;
  elements["marks-panel"].hidden = !opening;
  elements["marks-toggle"].setAttribute("aria-expanded", String(opening));
  if (opening) {
    elements["search-panel"].hidden = true;
    elements["search-toggle"].setAttribute("aria-expanded", "false");
    state.searchRequest += 1;
    clearSearchMatch();
  }
  updateMarksPanel();
});
elements["marks-close"].addEventListener("click", () => {
  elements["marks-panel"].hidden = true;
  elements["marks-toggle"].setAttribute("aria-expanded", "false");
});
elements["copy-selection"].addEventListener("click", copySelection);
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
  const text = resolvedText(state.selection?.resolved || []);
  if (!text) return;
  event.preventDefault();
  event.clipboardData.setData("text/plain", text);
  announce("已复制所选文字。");
});
document.addEventListener("pointerdown", (event) => {
  if (!elements["selection-actions"].hidden
      && !elements["selection-actions"].contains(event.target)) hideSelectionActions();
}, true);
window.addEventListener("resize", () => {
  positionSelectionActions();
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(relayoutPages, 120);
});
document.addEventListener("visibilitychange", () => document.hidden && savePosition());
window.addEventListener("pagehide", savePositionKeepalive);

loadBooks().catch(() => announce("书库加载失败，请刷新后重试。", true));
