import * as pdfjsLib from "/vendor/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.mjs";

const elements = Object.fromEntries(
  ["library-home", "library-empty", "import-input", "book-list", "book-count", "reader", "reader-title", "viewer", "pages", "page-number", "page-total", "previous-page", "next-page", "zoom-out", "zoom-in", "zoom-value", "status", "back-to-library"]
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
  scrollFrame: 0, saveTimer: 0, resizeTimer: 0,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
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
    });
    const pdf = await loading.promise;
    if (generation !== state.generation) return;
    state.pdf = pdf;
    if (pdf.numPages !== state.revision.page_count) throw new Error("Stored PDF metadata no longer matches the source file");
    await nextFrame();
    applyRestoredPosition();
    scheduleViewportUpdate();
  } catch (error) {
    announce(`Could not open this PDF: ${error.message}`, true);
  }
}

function closeReader() {
  state.generation += 1;
  cancelRenders();
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

function buildPlaceholders() {
  const width = pageWidth();
  const pages = state.revision.page_geometry.map((geometry, index) => {
    const page = document.createElement("article");
    page.className = "page";
    page.dataset.index = String(index);
    page.dataset.page = String(index + 1);
    page.style.width = `${width}px`;
    page.style.height = `${width * displayedRatio(geometry)}px`;
    return page;
  });
  elements.pages.replaceChildren(...pages);
}

function applyRestoredPosition() {
  const page = elements.pages.children[state.currentPage];
  if (!page) return;
  const offset = state.revision.position.normalized_offset || 0;
  elements.viewer.scrollTop = page.offsetTop + page.offsetHeight * offset;
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
    const cssWidth = pageWidth();
    const cssScale = cssWidth / base.width;
    const viewport = page.getViewport({ scale: cssScale });
    const pixelRatio = Math.max(window.devicePixelRatio || 1, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width * pixelRatio);
    canvas.height = Math.ceil(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const outputScaleX = canvas.width / viewport.width;
    const outputScaleY = canvas.height / viewport.height;
    canvas.dataset.outputScaleX = String(outputScaleX);
    canvas.dataset.outputScaleY = String(outputScaleY);
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.replaceChildren(canvas);
    const task = page.render({
      canvasContext: canvas.getContext("2d", { alpha: false }),
      viewport,
      transform: [outputScaleX, 0, 0, outputScaleY, 0, 0],
    });
    state.renderTasks.set(index, task);
    await task.promise;
    if (generation === state.generation) state.rendered.add(index);
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
  elements.viewer.scrollTop = page.offsetTop + page.offsetHeight * offset;
  setCurrentPage(bounded);
  scheduleSave();
}

function setZoom(value, anchor = captureZoomAnchor()) {
  const newZoom = Math.max(0.5, Math.min(4, Math.round(value * 10) / 10));
  if (newZoom === state.zoom || !state.revision) return;
  state.zoom = newZoom;
  elements["zoom-value"].textContent = `${Math.round(state.zoom * 100)}%`;
  relayoutPages(anchor);
}

function relayoutPages(anchor = captureZoomAnchor()) {
  if (!state.revision) return;
  cancelRenders();
  const width = pageWidth();
  [...elements.pages.children].forEach((wrapper, index) => {
    wrapper.replaceChildren();
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${width * displayedRatio(state.revision.page_geometry[index])}px`;
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
  elements.viewer.scrollLeft += pointX - (viewerRect.left + anchor.viewportX);
  elements.viewer.scrollTop += pointY - (viewerRect.top + anchor.viewportY);
  setCurrentPage(anchor.pageIndex);
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
    headers: { "X-Reader-Token": launchToken, "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_page_index: state.currentPage, normalized_offset: currentNormalizedOffset(page), zoom: state.zoom }),
    keepalive: true,
  }).catch(() => {});
}

function currentNormalizedOffset(page) {
  return Math.max(0, Math.min(1, (elements.viewer.scrollTop - page.offsetTop) / page.offsetHeight));
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
elements["zoom-out"].addEventListener("click", () => setZoom(state.zoom - 0.1));
elements["zoom-in"].addEventListener("click", () => setZoom(state.zoom + 0.1));
elements["back-to-library"].addEventListener("click", returnToLibrary);
elements.viewer.addEventListener("pointerdown", () => elements.viewer.focus({ preventScroll: true }));
elements.viewer.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 0.1 : -0.1;
  setZoom(state.zoom + direction, captureZoomAnchor(event.clientX, event.clientY));
}, { passive: false });
elements.viewer.addEventListener("keydown", (event) => {
  if (!event.ctrlKey) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setZoom(state.zoom + 0.1);
  } else if (event.key === "-") {
    event.preventDefault();
    setZoom(state.zoom - 0.1);
  }
});
window.addEventListener("resize", () => {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(relayoutPages, 120);
});
document.addEventListener("visibilitychange", () => document.hidden && savePosition());
window.addEventListener("pagehide", savePositionKeepalive);

if (!launchToken) announce("Open the tokenized URL printed by the Core Service.", true);
else loadBooks().catch((error) => announce(error.message, true));
