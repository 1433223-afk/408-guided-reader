import * as pdfjsLib from "/vendor/pdf.mjs";
import {
  lineBounds, nearestCellBoundary, nearestLine, resolveSelection, resolvedText,
} from "/selection.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";

const elements = Object.fromEntries(
  ["library-home", "library-empty", "import-input", "book-list", "book-count", "reader", "reader-title", "viewer", "pages", "page-number", "page-total", "previous-page", "next-page", "zoom-out", "zoom-in", "zoom-value", "preparation-status", "status", "back-to-library"]
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
  selection: null, selecting: false,
};

const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "X-Reader-Token": launchToken, ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
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
    pages.textContent = active ? `${book.active_revision.page_count} PDF pages` : "Removal incomplete";
    const actions = document.createElement("span");
    actions.className = "book-actions";
    if (active) {
      const revision = document.createElement("button");
      revision.type = "button";
      revision.className = "book-action";
      revision.textContent = book.revision_count > 1 ? `${book.revision_count} revisions · add` : "new revision";
      revision.title = "Import a different PDF as a new immutable revision of this book";
      revision.addEventListener("click", (event) => {
        event.stopPropagation();
        chooseRevision(book);
      });
      actions.append(revision);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "book-action danger";
    remove.textContent = active ? "remove" : "retry removal";
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
    announce("Choose a PDF file.", true);
    return;
  }
  announce(bookId ? "Validating the new source revision…" : "Validating and importing the PDF…");
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
    announce(result.duplicate ? "Already in your library — nothing was duplicated." : (bookId ? "New source revision added." : "PDF imported. Ready to read."));
  } catch (error) {
    announce(error.message, true);
  } finally {
    elements["import-input"].value = "";
  }
}

async function removeBook(book) {
  const confirmed = window.confirm(`Remove “${book.title}”?\n\nThis permanently deletes its saved PDF revisions and reading position from this app. This cannot be undone.`);
  if (!confirmed) return;
  try {
    await api(`/api/books/${book.id}`, { method: "DELETE" });
    if (state.book?.id === book.id) state.book = null;
    await loadBooks();
    announce("Book and its saved reading position removed.");
  } catch (error) {
    if (state.book?.id === book.id) state.book = null;
    await loadBooks();
    announce(error.message, true);
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
    if (pdf.numPages !== state.revision.page_count) throw new Error("Stored PDF metadata no longer matches the source file");
    await nextFrame();
    applyRestoredPosition();
    scheduleViewportUpdate();
    startPreparation();
  } catch (error) {
    announce(`Could not open this PDF: ${error.message}`, true);
  }
}

function closeReader() {
  state.generation += 1;
  cancelRenders();
  closePreparationStream();
  clearSelection();
  state.book = null;
  state.revision = null;
  state.pdf = null;
  elements.reader.hidden = true;
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
    if (error?.name !== "RenderingCancelledException") announce(`Page ${index + 1} could not render: ${error.message}`, true);
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
}

function goToPage(index, offset = 0) {
  const bounded = Math.max(0, Math.min(index, state.revision.page_count - 1));
  const page = elements.pages.children[bounded];
  elements.viewer.scrollTop = snapScroll(page.offsetTop + page.offsetHeight * offset);
  setCurrentPage(bounded);
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
    announce(`Reading position was not saved: ${error.message}`, true);
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
    elements["preparation-status"].textContent = "Text unavailable";
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
  clearTimeout(state.priorityTimer);
  elements["preparation-status"].textContent = "Preparing text…";
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

function syncPagePreparationUi(index) {
  const wrapper = elements.pages.children[index];
  if (!wrapper) return;
  wrapper.querySelector(".preparation-retry")?.remove();
  if (state.preparation.get(index)?.status !== "FAILED" || !wrapper.querySelector("canvas")) return;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "preparation-retry";
  retry.textContent = "Text preparation failed · Retry";
  retry.addEventListener("click", async (event) => {
    event.stopPropagation();
    retry.disabled = true;
    retry.textContent = "Retry queued…";
    try {
      await api(`/api/revisions/${state.revision.id}/preparation/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_page_index: index }),
      });
    } catch (error) {
      retry.disabled = false;
      retry.textContent = "Text preparation failed · Retry";
      announce(error.message, true);
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
    output.textContent = "Preparing text…";
    output.className = "preparation-status";
  } else if (ready + failed === pages.length) {
    output.textContent = failed ? `${ready} ready · ${failed} failed` : "Text ready";
    output.className = `preparation-status ${failed ? "failed" : "ready"}`;
  } else {
    output.textContent = `${ready} / ${pages.length} selectable`;
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
  if (!wrapper.querySelector("canvas") || wrapper.querySelector(".text-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "text-overlay";
  overlay.setAttribute("aria-label", `Selectable text for PDF page ${index + 1}`);
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
  overlay.addEventListener("contextmenu", preserveTextSelectionForContextMenu);
  wrapper.append(overlay);
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
}

function renderSelection() {
  if (!state.selection) return;
  document.querySelectorAll(".selection-quad").forEach((node) => node.remove());
  const data = state.overlayData.get(state.selection.pageIndex);
  state.selection.resolved = resolveSelection(data.lines, state.selection.anchor, state.selection.focus);
  const overlay = elements.pages.children[state.selection.pageIndex]?.querySelector(".text-overlay");
  if (!overlay) return;
  for (const range of state.selection.resolved) {
    for (const quad of range.quads) {
      const xs = quad.map(([x]) => x);
      const ys = quad.map(([, y]) => y);
      const marker = document.createElement("span");
      marker.className = "selection-quad";
      marker.style.cssText = `left:${Math.min(...xs) * 100}%;top:${Math.min(...ys) * 100}%;width:${(Math.max(...xs) - Math.min(...xs)) * 100}%;height:${(Math.max(...ys) - Math.min(...ys)) * 100}%`;
      overlay.append(marker);
    }
  }
  syncNativeSelection(overlay);
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

function preserveTextSelectionForContextMenu(event) {
  if (!state.selection?.resolved.length) return;
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
  if (inside) syncNativeSelection(overlay);
}

function clearSelection() {
  document.querySelectorAll(".selection-quad").forEach((node) => node.remove());
  window.getSelection()?.removeAllRanges();
  state.selection = null;
  state.selecting = false;
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
elements.viewer.addEventListener("pointerdown", () => elements.viewer.focus({ preventScroll: true }));
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
  announce("Selected text copied.");
});
window.addEventListener("resize", () => {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(relayoutPages, 120);
});
document.addEventListener("visibilitychange", () => document.hidden && savePosition());
window.addEventListener("pagehide", savePositionKeepalive);

loadBooks().catch((error) => announce(error.message, true));
