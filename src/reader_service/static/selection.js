export function lineBounds(line) {
  const xs = line.quad.map(([x]) => x);
  const ys = line.quad.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function nearestLine(lines, normalizedY) {
  let best = null;
  let distance = Infinity;
  for (const line of lines) {
    const bounds = lineBounds(line);
    const candidate = normalizedY < bounds.y0 ? bounds.y0 - normalizedY
      : normalizedY > bounds.y1 ? normalizedY - bounds.y1 : 0;
    if (candidate < distance) { distance = candidate; best = line; }
  }
  return best;
}

export function nearestCellBoundary(line, normalizedX) {
  if (!line.cells.length) return 0;
  const boundaries = [line.cells[0][0], ...line.cells.map((cell) => cell[1])];
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
      text: line.text.slice(start, end),
      quads: [[[x0, bounds.y0], [x1, bounds.y0], [x1, bounds.y1], [x0, bounds.y1]]],
    };
  });
}

export function resolvedText(resolved) {
  return resolved.map((range) => range.text).join("\n");
}
