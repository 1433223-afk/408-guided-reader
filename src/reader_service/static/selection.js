export function lineBounds(line) {
  const xs = line.quad.map(([x]) => x);
  const ys = line.quad.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function axisDistance(value, start, end) {
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

export function selectableBounds(line) {
  const bounds = lineBounds(line);
  if (!line.cells.length) return bounds;
  return {
    ...bounds,
    x0: Math.min(...line.cells.map((cell) => cell[0])),
    x1: Math.max(...line.cells.map((cell) => cell[1])),
  };
}

export function nearestLine(lines, normalizedX, normalizedY) {
  let best = null;
  let distance = Infinity;
  for (const line of lines) {
    const bounds = selectableBounds(line);
    const dx = axisDistance(normalizedX, bounds.x0, bounds.x1);
    const dy = axisDistance(normalizedY, bounds.y0, bounds.y1);
    const candidate = (dx * dx) + (dy * dy);
    if (candidate < distance) { distance = candidate; best = line; }
  }
  return best;
}

export function nearestCellBoundary(line, normalizedX) {
  if (!line.cells.length) return 0;
  const boundaries = [line.cells[0][0]];
  for (let index = 1; index < line.cells.length; index += 1) {
    boundaries.push((line.cells[index - 1][1] + line.cells[index][0]) / 2);
  }
  boundaries.push(line.cells.at(-1)[1]);
  let best = 0;
  for (let index = 1; index < boundaries.length; index += 1) {
    if (Math.abs(boundaries[index] - normalizedX) < Math.abs(boundaries[best] - normalizedX)) best = index;
  }
  return best;
}

export function selectionRanges(lines, anchor, focus) {
  if (!anchor || !focus || !lines.length) return [];
  let start = anchor;
  let end = focus;
  if (start.lineOrdinal > end.lineOrdinal || (
    start.lineOrdinal === end.lineOrdinal && start.boundary > end.boundary
  )) [start, end] = [end, start];
  const ranges = [];
  for (const line of lines) {
    if (line.line_ordinal < start.lineOrdinal || line.line_ordinal > end.lineOrdinal) continue;
    const cellStart = line.line_ordinal === start.lineOrdinal ? start.boundary : 0;
    const cellEnd = line.line_ordinal === end.lineOrdinal ? end.boundary : line.cells.length;
    if (cellEnd > cellStart) ranges.push({ line, cellStart, cellEnd });
  }
  return ranges;
}

export function resolveSelection(lines, anchor, focus) {
  return selectionRanges(lines, anchor, focus).map(({ line, cellStart, cellEnd }) => {
    const selected = line.cells.slice(cellStart, cellEnd);
    const start = selected[0][2];
    const end = selected.at(-1)[3];
    const bounds = lineBounds(line);
    const x0 = Math.min(...selected.map((cell) => cell[0]));
    const x1 = Math.max(...selected.map((cell) => cell[1]));
    return {
      line_ordinal: line.line_ordinal,
      cell_start: cellStart,
      cell_end: cellEnd,
      char_start: start,
      char_end: end,
      text: line.text.slice(start, end),
      quads: [[[x0, bounds.y0], [x1, bounds.y0], [x1, bounds.y1], [x0, bounds.y1]]],
    };
  });
}

export function resolvedText(resolved) {
  return resolved.map((range) => range.text).join("\n");
}
