// Opt-in tablet presentation. CSS pixels follow Android's browser viewport;
// physical display resolution is deliberately never used for control sizing.
export function createTabletLayout({reader, viewer, panel, closeDirectory, captureAnchor, restoreAnchor, onResize}) {
  const root = document.documentElement;
  let anchor = null, resizeAnchor = null, frame = 0, settle = 0, lastWidth = 0, changing = false;
  let viewerWidth = viewer.clientWidth, viewerHeight = viewer.clientHeight;
  function remember() {
    if (!reader.hidden && !settle && !frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!settle) anchor = reader.hidden ? null : captureAnchor();
    });
  }
  function reflow(saved) {
    onResize(saved);
    if (saved) restoreAnchor({...saved, viewportY:1});
    anchor = reader.hidden ? null : captureAnchor();
    viewerWidth = viewer.clientWidth;
    viewerHeight = viewer.clientHeight;
  }
  // Workspace changes are synchronous: finish the final PDF geometry before a
  // directory destination is applied. A delayed resize must not undo that jump.
  function change(update) {
    if (changing) return update();
    const saved = resizeAnchor || captureAnchor();
    clearTimeout(settle); settle = 0; resizeAnchor = null;
    cancelAnimationFrame(frame); frame = 0;
    changing = true;
    try {update();} finally {changing = false; reflow(saved);}
  }
  function resize() {
    if (!settle) resizeAnchor = anchor;
    const keyboardFocus = document.activeElement?.matches('textarea,input:not([type=checkbox])');
    // Keep the presentation chosen before the IME reduces the visible height.
    if (!keyboardFocus || Math.abs(window.innerWidth - lastWidth) > 100) {
      const portrait = keyboardFocus && screen.orientation?.type
        ? screen.orientation.type.startsWith('portrait') : window.innerHeight > window.innerWidth;
      root.classList.toggle('tablet-portrait', portrait || window.innerWidth < 960);
    }
    lastWidth = window.innerWidth;
    const viewport = window.visualViewport;
    root.style.setProperty('--tablet-height', `${viewport?.height || window.innerHeight}px`);
    root.style.setProperty('--tablet-top', `${viewport?.offsetTop || 0}px`);
    clearTimeout(settle);
    settle = setTimeout(() => {
      const saved = resizeAnchor;
      settle = 0; resizeAnchor = null;
      reflow(saved);
    }, 150);
  }
  new MutationObserver(() => {
    if (reader.hidden) {
      anchor = null; resizeAnchor = null;
      clearTimeout(settle); settle = 0;
      cancelAnimationFrame(frame); frame = 0;
    }
  }).observe(reader, {attributes:true, attributeFilter:['hidden']});
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closeDirectory({focusViewer:true});
  });
  viewer.addEventListener('scroll', remember, {passive:true});
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  new ResizeObserver(() => {
    if (viewer.clientWidth === viewerWidth && viewer.clientHeight === viewerHeight) return;
    viewerWidth = viewer.clientWidth;
    viewerHeight = viewer.clientHeight;
    resize();
  }).observe(viewer);
  // Do not carry the desktop's manually saved portrait preference into tablet mode.
  reader.classList.remove('portrait-mode', 'portrait-directory-pinned');
  document.getElementById('assistant-empty').textContent = '长按原文，选择「问 AI」。';
  document.querySelector('.local-note').textContent = '教材与学习数据保存在开发电脑';
  resize();
  return {remember, change, navigated:() => {
    anchor = captureAnchor();
    if (settle) resizeAnchor = anchor;
  }};
}
