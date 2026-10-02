// Coordinates belong to the displayed PDF page, never the browser viewport.
export function normalizedRegion(start, end) {
  const clamp = value => Math.max(0, Math.min(1, value));
  return [clamp(Math.min(start.x, end.x)), clamp(Math.min(start.y, end.y)),
    clamp(Math.max(start.x, end.x)), clamp(Math.max(start.y, end.y))];
}

export function createVisualSelection({viewer, toggle, hint, enabled, onSelect, onEnter}) {
  let active = false, drag = null, selected = null;
  const confirmButton = hint.querySelector('[data-region-confirm]');
  const cancelButton = hint.querySelector('[data-region-cancel]');
  const edges = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function syncHint() {
    hint.hidden = !active || !selected || Boolean(drag);
    confirmButton.hidden = !selected;
    confirmButton.disabled = Boolean(drag);
    if (hint.hidden) return;
    const canvas = viewer.querySelector(`.page[data-index="${selected.pageIndex}"]`)?.querySelector('canvas');
    if (!canvas?.isConnected) { hint.hidden = true; return; }
    const page = canvas.getBoundingClientRect(), view = viewer.getBoundingClientRect();
    const [x0, y0, x1, y1] = selected.rect;
    const left = page.left + x0 * page.width, right = page.left + x1 * page.width;
    const top = page.top + y0 * page.height, bottom = page.top + y1 * page.height;
    if (!page.width || !page.height || right <= view.left || left >= view.left + view.width
        || bottom <= view.top || top >= view.top + view.height) { hint.hidden = true; return; }
    const width = hint.offsetWidth, height = hint.offsetHeight, gap = 10;
    const minY = view.top + gap, maxY = view.top + view.height - height - gap;
    const below = bottom + gap;
    const above = top - height - gap;
    hint.style.left = `${clamp(right - width, view.left + gap, view.left + view.width - width - gap)}px`;
    hint.style.top = `${clamp(below <= maxY ? below : above >= minY ? above : bottom - height - gap, minY, maxY)}px`;
  }

  function render() {
    viewer.querySelectorAll('.visual-region-outline').forEach(node => node.remove());
    syncHint();
    const region = drag || selected;
    if (!active || !region) return;
    const page = viewer.querySelector(`.page[data-index="${region.pageIndex}"]`);
    const canvas = page?.querySelector('canvas');
    if (!canvas) return;
    const rect = region.rect;
    const outline = document.createElement('div');
    outline.className = 'visual-region-outline';
    outline.setAttribute('aria-hidden', 'true');
    outline.style.cssText = `left:${canvas.offsetLeft + rect[0] * canvas.clientWidth}px;top:${canvas.offsetTop + rect[1] * canvas.clientHeight}px;width:${(rect[2] - rect[0]) * canvas.clientWidth}px;height:${(rect[3] - rect[1]) * canvas.clientHeight}px`;
    if (!drag || drag.action !== 'draw') {
      for (const edge of edges) {
        const handle = document.createElement('span');
        handle.className = 'visual-region-handle';
        handle.dataset.regionHandle = edge;
        outline.append(handle);
      }
    }
    page.append(outline);
  }

  function setActive(value) {
    active = value;
    viewer.classList.toggle('visual-selecting', value);
    toggle.setAttribute('aria-pressed', String(value));
    toggle.title = value ? '退出框选' : '框选区域解释';
    syncHint();
  }

  function release() {
    const pointerId = drag?.pointerId;
    drag = null;
    viewer.style.cursor = '';
    if (pointerId !== undefined && viewer.hasPointerCapture(pointerId)) viewer.releasePointerCapture(pointerId);
  }

  function cancel() {
    release();
    selected = null;
    setActive(false);
    render();
  }

  function confirm() {
    if (!active || !selected || drag || !enabled()) return;
    const canvas = viewer.querySelector(`.page[data-index="${selected.pageIndex}"]`)?.querySelector('canvas');
    if (!canvas?.isConnected || !canvas.clientWidth || !canvas.clientHeight) { cancel(); return; }
    const result = {pageIndex: selected.pageIndex, rect: [...selected.rect]};
    // End the temporary interaction before preparing the crop or opening the dock.
    cancel();
    onSelect(result);
  }

  function updateDrag(event) {
    const end = point(event, drag.canvas);
    if (drag.action === 'draw') {
      drag.rect = normalizedRegion(drag.start, end);
      return;
    }
    const [left, top, right, bottom] = drag.original;
    const dx = end.x - drag.start.x, dy = end.y - drag.start.y;
    if (drag.action === 'move') {
      const x = clamp(dx, -left, 1 - right), y = clamp(dy, -top, 1 - bottom);
      drag.rect = [left + x, top + y, right + x, bottom + y];
      return;
    }
    const minWidth = 10 / drag.canvas.clientWidth, minHeight = 10 / drag.canvas.clientHeight;
    drag.rect = [
      drag.action.includes('w') ? clamp(left + dx, 0, right - minWidth) : left,
      drag.action.includes('n') ? clamp(top + dy, 0, bottom - minHeight) : top,
      drag.action.includes('e') ? clamp(right + dx, left + minWidth, 1) : right,
      drag.action.includes('s') ? clamp(bottom + dy, top + minHeight, 1) : bottom,
    ];
  }

  function point(event, canvas) {
    const bounds = canvas.getBoundingClientRect();
    return {x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height};
  }

  function dragIsCurrent() {
    if (!drag) return false;
    const page = viewer.querySelector(`.page[data-index="${drag.pageIndex}"]`);
    const bounds = drag.canvas.getBoundingClientRect();
    return drag.canvas.isConnected && page?.querySelector('canvas') === drag.canvas
      && bounds.width > 0 && bounds.height > 0;
  }

  toggle.addEventListener('click', () => {
    if (active) { cancel(); viewer.focus({preventScroll: true}); return; }
    if (!enabled()) return;
    selected = null;
    render();
    onEnter();
    setActive(true);
    viewer.focus({preventScroll: true});
  });
  confirmButton.addEventListener('click', confirm);
  cancelButton.addEventListener('click', () => { cancel(); viewer.focus({preventScroll: true}); });
  viewer.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    const page = event.target.closest('.page');
    const canvas = page?.querySelector('canvas');
    if (!canvas) return;
    const start = point(event, canvas);
    const handle = event.target.closest('[data-region-handle]');
    const inside = event.target.closest('.visual-region-outline');
    const editing = selected?.pageIndex === Number(page.dataset.index) && inside;
    if (!editing && (start.x < 0 || start.x > 1 || start.y < 0 || start.y > 1)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = editing ? handle?.dataset.regionHandle || 'move' : 'draw';
    const original = editing ? [...selected.rect] : null;
    if (!editing) selected = null;
    drag = {pageIndex: Number(page.dataset.index), canvas, start, action, original,
      rect: original || normalizedRegion(start, start), pointerId: event.pointerId};
    viewer.style.cursor = action === 'draw' ? 'crosshair' : action === 'move' ? 'move' : `${action}-resize`;
    viewer.setPointerCapture(event.pointerId);
    render();
  }, true);
  viewer.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!dragIsCurrent()) { cancel(); return; }
    updateDrag(event);
    render();
  }, true);
  viewer.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!dragIsCurrent()) { cancel(); return; }
    updateDrag(event);
    const rect = drag.rect;
    const pageIndex = drag.pageIndex;
    const usable = drag.action !== 'draw' || ((rect[2] - rect[0]) * drag.canvas.clientWidth >= 10
      && (rect[3] - rect[1]) * drag.canvas.clientHeight >= 10);
    release();
    if (!usable) { render(); return; }
    selected = {pageIndex, rect};
    render();
  }, true);
  viewer.addEventListener('pointercancel', () => { if (drag) cancel(); }, true);
  viewer.addEventListener('lostpointercapture', () => { if (drag) cancel(); });
  viewer.addEventListener('scroll', syncHint, {passive: true});
  window.addEventListener('blur', () => { if (active) cancel(); });
  viewer.addEventListener('contextmenu', event => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
  }, true);
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      viewer.focus({preventScroll: true});
    } else if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey
      && (viewer.contains(event.target) || event.target === toggle || event.target === confirmButton)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) confirm();
    }
  }, true);
  // A layout change midway through a drag cancels it instead of changing its crop.
  new ResizeObserver(() => { if (drag) cancel(); else render(); }).observe(viewer);
  return {render, cancel, get active() {return active;}};
}
