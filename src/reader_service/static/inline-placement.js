// The teaching gutter is outside the PDF media box. Never shift a target to
// another line to make it fit; insufficient room means omission.
export function placeInline(target, page, viewport, obstacles, occupied = []) {
  if (!target?.available || !Array.isArray(target.quad) || target.quad.length !== 4
      || target.quad.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))) return null;
  const y = target.quad.reduce((sum, p) => sum + p[1], 0) / 4;
  const rect = { left: page.left - 28, top: page.top + y * page.height - 12, width: 24, height: 24 };
  rect.right = rect.left + rect.width; rect.bottom = rect.top + rect.height;
  if (rect.left < viewport.left || rect.right > viewport.right || rect.top < page.top || rect.bottom > page.bottom) return null;
  if ([...obstacles, ...occupied].some(b => rect.left < b.right + 4 && rect.right > b.left - 4 && rect.top < b.bottom + 4 && rect.bottom > b.top - 4)) return null;
  return { ...rect, y };
}
