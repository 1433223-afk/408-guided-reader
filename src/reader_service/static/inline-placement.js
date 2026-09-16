// Only use the existing page margins at the authoritative source y.
// OCR and learning-control collisions cause omission, never a different text anchor.
export function placeInline(target, page, viewport, obstacles, occupied = []) {
  if (!target?.available || !Array.isArray(target.quad) || target.quad.length !== 4
      || target.quad.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))
      || !Number.isFinite(page.width) || page.width < 48) return null;
  const y = target.quad.reduce((sum, p) => sum + p[1], 0) / 4;
  const inset = Math.max(6, page.width * .03);
  for (const left of [page.left + page.width - inset - 24, page.left + inset]) {
    const rect = { left, top: page.top + y * page.height - 12, width: 24, height: 24 };
    rect.right = rect.left + 24; rect.bottom = rect.top + 24;
    if (rect.left < page.left || rect.right > page.left + page.width || rect.top < page.top || rect.bottom > page.bottom) continue;
    if ([...obstacles, ...occupied].some(b => rect.left < b.right + 4 && rect.right > b.left - 4 && rect.top < b.bottom + 4 && rect.bottom > b.top - 4)) continue;
    return { ...rect, y };
  }
  return null;
}
