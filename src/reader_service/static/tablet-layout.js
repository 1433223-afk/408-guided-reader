// Opt-in tablet presentation. CSS pixels follow Android's browser viewport;
// physical display resolution is deliberately never used for control sizing.
export function createTabletLayout({reader, viewer, panel, closeDirectory, captureAnchor, restoreAnchor, onResize}) {
  const root = document.documentElement;
  const scrim = document.getElementById('tablet-directory-scrim');
  let anchor = null, frame = 0, settle = 0, lastWidth = 0;
  function remember() {
    if (!reader.hidden && !frame) frame = requestAnimationFrame(() => {
      frame = 0;
      anchor = reader.hidden ? null : captureAnchor();
    });
  }
  function resize() {
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
    const saved = anchor;
    clearTimeout(settle);
    settle = setTimeout(() => {
      onResize();
      if (saved) restoreAnchor({...saved, viewportY: 1});
      remember();
    }, 150);
  }
  const syncDirectory = () => {
    scrim.hidden = panel.hidden || reader.hidden;
    if (reader.hidden) {anchor = null; clearTimeout(settle);}
  };
  new MutationObserver(syncDirectory).observe(panel, {attributes:true, attributeFilter:['hidden']});
  new MutationObserver(syncDirectory).observe(reader, {attributes:true, attributeFilter:['hidden']});
  scrim.addEventListener('click', () => closeDirectory({focusViewer:true}));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) closeDirectory({focusViewer:true});
  });
  viewer.addEventListener('scroll', remember, {passive:true});
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('scroll', resize);
  let viewerWidth = viewer.clientWidth;
  new ResizeObserver(() => {
    if (viewer.clientWidth === viewerWidth) return;
    viewerWidth = viewer.clientWidth;
    resize();
  }).observe(viewer);
  // Do not carry the desktop's manually saved portrait preference into tablet mode.
  reader.classList.remove('portrait-mode', 'portrait-directory-pinned');
  document.getElementById('assistant-empty').textContent = '长按原文，选择「问 AI」。';
  document.querySelector('.local-note').textContent = '教材与学习数据保存在开发电脑';
  resize(); syncDirectory();
  return {remember};
}
