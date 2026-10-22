// Display-only fitting: preserve the entire PDF and all normalized source coordinates.
export function rasterInkBounds({data, width, height}) {
  let left = width, right = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] > 0 && Math.min(data[i], data[i + 1], data[i + 2]) < 245) {
      left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  return right < left ? null : [left / width, (right + 1) / width];
}

export function contentHorizontalBounds(image, lines = []) {
  const ink = rasterInkBounds(image);
  const xs = lines.flatMap(line => line.quad.map(([x]) => x));
  // Use the union, including marginal text and diagrams absent from OCR. A
  // noisy/colored scan may keep the full width; prefer that over hiding content.
  const left = Math.min(ink?.[0] ?? 1, ...xs);
  const right = Math.max(ink?.[1] ?? 0, ...xs);
  if (right <= left) return null;
  return [Math.max(0, left - .02), Math.min(1, right + .02)];
}

export function canvasContentBounds(canvas, lines) {
  const sample = document.createElement('canvas');
  sample.width = Math.min(512, canvas.width);
  sample.height = Math.max(1, Math.round(canvas.height * sample.width / canvas.width));
  const context = sample.getContext('2d', {willReadFrequently:true});
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  return contentHorizontalBounds(context.getImageData(0, 0, sample.width, sample.height), lines);
}

export function parseZoomPercent(text) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]) / 100;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function createZoomEditor({input, getZoom, applyZoom, viewer}) {
  let editing = false;
  const restore = () => {input.value = `${Math.round(getZoom() * 100)}%`;};
  function finish(apply) {
    if (!editing) return;
    editing = false;
    const value = parseZoomPercent(input.value);
    if (apply && value !== null) applyZoom(value);
    restore();
  }
  input.addEventListener('focus', () => {editing = true; input.select();});
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    finish(event.key === 'Enter');
    viewer.focus({preventScroll:true});
  });
  restore();
}

export function createReadingDisplay({reader, zoomButton, applyFit}) {
  const menu = document.getElementById('reading-display-menu');
  const paper = document.getElementById('reading-paper');
  const preferenceKey = 'guided-reader-soft-paper';
  try {paper.checked = localStorage.getItem(preferenceKey) === '1';} catch (_) { /* optional preference */ }
  const paint = () => reader.classList.toggle('soft-paper', paper.checked);
  paint();
  function close() {
    menu.hidden = true;
    zoomButton.setAttribute('aria-expanded', 'false');
  }
  zoomButton.addEventListener('click', () => {
    if (!menu.hidden) {close(); return;}
    menu.hidden = false;
    zoomButton.setAttribute('aria-expanded', 'true');
    const rect = zoomButton.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.querySelector('button').focus({preventScroll:true});
  });
  menu.addEventListener('click', event => {
    const fit = event.target.closest('[data-reading-fit]');
    if (!fit) return;
    applyFit(fit.dataset.readingFit);
    close();
  });
  paper.addEventListener('change', () => {
    paint();
    try {localStorage.setItem(preferenceKey, paper.checked ? '1' : '0');} catch (_) { /* optional preference */ }
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target) && !zoomButton.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (menu.hidden || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation();
    close(); zoomButton.focus({preventScroll:true});
  }, true);
  window.addEventListener('resize', close);
  return {close};
}

export function createPortraitLayout({reader, openDirectory, closeDirectory, onChange, available, automatic = false, hover = true}) {
  const toggle = document.getElementById('reading-portrait');
  const edge = document.getElementById('portrait-directory-edge');
  const pin = document.getElementById('portrait-directory-pin');
  const panel = document.getElementById('outline-panel');
  const key = 'guided-reader-portrait';
  let opening, closing, hovered = false, keyboard = false;
  if (!automatic) {
    try {toggle.checked = localStorage.getItem(key) === '1';} catch (_) { /* optional preference */ }
  }
  const clear = () => {clearTimeout(opening); clearTimeout(closing);};
  const sync = () => {edge.hidden = pin.hidden = !toggle.checked;};
  function unpin() {
    clear();
    reader.classList.remove('portrait-directory-pinned');
    pin.textContent = '固定'; pin.setAttribute('aria-pressed','false');
  }
  function leave() {
    if (!hover) return;
    clear();
    closing = setTimeout(() => {
      if (toggle.checked && !hovered && !reader.classList.contains('portrait-directory-pinned')
          && !(keyboard && panel.contains(document.activeElement))) closeDirectory();
    }, 400);
  }
  function enter() {
    if (!hover) return;
    clear(); hovered = true;
    opening = setTimeout(() => {if (toggle.checked && available()) openDirectory();}, 180);
  }
  toggle.addEventListener('change', () => {
    clear(); onChange(toggle.checked); unpin(); sync();
    if (!automatic) {
      try {localStorage.setItem(key,toggle.checked ? '1' : '0');} catch (_) { /* optional preference */ }
    }
  });
  edge.addEventListener('pointerenter', enter);
  edge.addEventListener('pointerleave', () => {hovered = false; leave();});
  edge.addEventListener('click', () => {clear(); if (available()) openDirectory();});
  panel.addEventListener('pointerenter', () => {clear(); hovered = true;});
  panel.addEventListener('pointerleave', () => {hovered = false; leave();});
  panel.addEventListener('focusout', leave);
  document.addEventListener('keydown', event => {if (event.key === 'Tab') keyboard = true;});
  document.addEventListener('pointerdown', () => {keyboard = false;});
  pin.addEventListener('click', () => {
    clear();
    const pinned = !reader.classList.contains('portrait-directory-pinned');
    // Capture/restore PDF position around the column change in the existing app.
    onChange(toggle.checked, pinned);
    pin.textContent = pinned ? '取消固定' : '固定';
    pin.setAttribute('aria-pressed',String(pinned));
    if (!pinned && !hovered) leave();
  });
  sync();
  return {enabled:() => toggle.checked, directoryClosed:unpin, setEnabled(value) {
    if (toggle.checked === value) return;
    clear(); unpin(); toggle.checked = value; onChange(value); sync();
  }};
}
