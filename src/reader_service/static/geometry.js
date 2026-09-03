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
