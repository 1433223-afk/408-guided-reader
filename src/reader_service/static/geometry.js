function validateBox(mediaBox) {
  if (!Array.isArray(mediaBox) || mediaBox.length !== 4) {
    throw new TypeError("mediaBox must be [x0, y0, x1, y1]");
  }
  const [x0, y0, x1, y1] = mediaBox.map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
    throw new RangeError("mediaBox must have positive finite width and height");
  }
  return [x0, y0, x1, y1];
}

// Visible pages always keep their full resolution; only speculative neighbours
// consume the remaining pixel budget (independent of CSS zoom and monitor DPI).
export function pageRenderWindow(first, last, count, pixelsPerPage, budget = 24_000_000) {
  const spare = Math.max(0, Math.floor(budget / Math.max(1, pixelsPerPage)) - (last - first + 1));
  const before = Math.min(2, Math.floor(spare / 2));
  const after = Math.min(2, spare - before);
  return {start: Math.max(0, first - before), end: Math.min(count - 1, last + after)};
}

export function pageRenderPlan({first, last, focus, start, end, rendered}) {
  const nearestFirst = (a, b) => Math.abs(a - focus) - Math.abs(b - focus);
  const visible = Array.from({length:last - first + 1}, (_, offset) => first + offset).sort(nearestFirst);
  const preload = visible.every(index => rendered.has(index))
    ? Array.from({length:end - start + 1}, (_, offset) => start + offset)
      .filter(index => index < first || index > last).sort(nearestFirst)
    : [];
  return {visible, preload};
}

// Page positions remain in document order, including any in-flow learning
// footer. Read current DOM bounds on demand rather than maintaining a stale index.
export function pageViewportRange(count, getBounds, top, bottom) {
  if (!count) return {first:null,last:0,bestIndex:0};
  const bounds = new Map();
  const read = index => {
    if (!bounds.has(index)) bounds.set(index, getBounds(index));
    return bounds.get(index);
  };
  const lowerBound = predicate => {
    let low = 0, high = count;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (predicate(read(middle))) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const first = lowerBound(page => page.bottom >= top);
  const last = Math.max(0, lowerBound(page => page.top > bottom) - 1);
  const center = (top + bottom) / 2;
  let bestIndex = Math.min(count - 1, lowerBound(page => (page.top + page.bottom) / 2 >= center));
  if (bestIndex > 0) {
    const before = read(bestIndex - 1), current = read(bestIndex);
    if (Math.abs((before.top + before.bottom) / 2 - center)
        <= Math.abs((current.top + current.bottom) / 2 - center)) bestIndex -= 1;
  }
  return {first:first === count ? null : first,last,bestIndex};
}

function rotationOf(rotation) {
  const value = ((Number(rotation) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(value)) {
    throw new RangeError("rotation must be a multiple of 90 degrees");
  }
  return value;
}

export function pdfPointToNormalized(point, mediaBox, rotation = 0) {
  const [x0, y0, x1, y1] = validateBox(mediaBox);
  const x = Number(point.x);
  const y = Number(point.y);
  const width = x1 - x0;
  const height = y1 - y0;
  switch (rotationOf(rotation)) {
    case 0:
      return { x: (x - x0) / width, y: (y1 - y) / height };
    case 90:
      return { x: (y - y0) / height, y: (x - x0) / width };
    case 180:
      return { x: (x1 - x) / width, y: (y - y0) / height };
    case 270:
      return { x: (y1 - y) / height, y: (x1 - x) / width };
  }
}

export function normalizedPointToPdf(point, mediaBox, rotation = 0) {
  const [x0, y0, x1, y1] = validateBox(mediaBox);
  const x = Number(point.x);
  const y = Number(point.y);
  const width = x1 - x0;
  const height = y1 - y0;
  switch (rotationOf(rotation)) {
    case 0:
      return { x: x0 + x * width, y: y1 - y * height };
    case 90:
      return { x: x0 + y * width, y: y0 + x * height };
    case 180:
      return { x: x1 - x * width, y: y0 + y * height };
    case 270:
      return { x: x1 - y * width, y: y1 - x * height };
  }
}

export function pdfRectToNormalized(rect, mediaBox, rotation = 0) {
  const corners = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x0, y: rect.y1 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 },
  ].map((point) => pdfPointToNormalized(point, mediaBox, rotation));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function normalizedRectToPdf(rect, mediaBox, rotation = 0) {
  const corners = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x0, y: rect.y1 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 },
  ].map((point) => normalizedPointToPdf(point, mediaBox, rotation));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
