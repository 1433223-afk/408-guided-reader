// The host preserves the reading anchor while the rail changes available width.
export function createTabletToolRail({reader, tools, toggle, idleMs = 6000, layout = update => update()}) {
  const doc = reader.ownerDocument, view = doc.defaultView;
  const surfaces = '#outline-panel,#search-panel,#marks-panel,#guide-panel,#knowledge-panel,'
    + '#reader-kp-list,#inline-panel,#inline-menu,#reading-display-menu,#assistant-panel,'
    + '#selection-actions,#assistant-answer-actions,#note-editor,#visual-select-hint,'
    + '#assistant-region-dialog[open],.kp-learning-marker[open],.learning-scope-marker[open]';
  const pointers = new Set(), removers = [];
  let timer = null, hidden = false, destroyed = false, wasReaderHidden = reader.hidden;
  let inputMethod = 'keyboard', initializing = true;
  const listen = (target, type, callback, options) => {
    target.addEventListener(type, callback, options);
    removers.push(() => target.removeEventListener(type, callback, options));
  };
  function shown(node) {
    if (!node?.isConnected || node.closest('[hidden]')) return false;
    const style = view.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
  }
  function selectionActive() {
    if (reader.querySelector('#viewer.visual-selecting,.selection-quad')) return true;
    const selection = doc.getSelection();
    return Boolean(selection && !selection.isCollapsed
      && (reader.contains(selection.anchorNode) || reader.contains(selection.focusNode)));
  }
  function busy() {
    if (pointers.size || reader.classList.contains('tablet-ink-drawing') || selectionActive()) return true;
    if (shown(reader.querySelector('.tablet-ink-choices'))) return true;
    if ([...doc.querySelectorAll(surfaces)].some(shown)) return true;
    const active = doc.activeElement;
    if (!reader.contains(active) && !active.closest('#selection-actions')) return false;
    if (active.matches('input,textarea,select') || active.isContentEditable) return true;
    // Android often leaves a tapped button focused. That is not keyboard focus.
    return inputMethod !== 'pointer' && tools.contains(active) && active.matches(':focus-visible');
  }
  function clearTimer() {
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
  }
  function setHidden(value, reflow = true) {
    const changed = hidden !== value;
    const update = () => {
      hidden = value;
      if (hidden && tools.contains(doc.activeElement)) toggle.focus({preventScroll:true});
      reader.classList.toggle('tablet-tools-hidden', hidden);
      tools.inert = hidden;
      tools.setAttribute('aria-hidden', String(hidden));
      toggle.setAttribute('aria-expanded', String(!hidden));
    };
    if (changed && reflow && !reader.hidden) layout(update);
    else update();
  }
  function schedule() {
    clearTimer();
    if (destroyed || reader.hidden || hidden) return;
    timer = view.setTimeout(() => {
      timer = null;
      if (destroyed || reader.hidden || hidden) return;
      if (busy()) schedule();
      else setHidden(true);
    }, idleMs);
  }
  function refresh() {
    if (destroyed) return;
    clearTimer();
    const rootChanged = wasReaderHidden !== reader.hidden;
    wasReaderHidden = reader.hidden;
    if (reader.hidden) pointers.clear();
    setHidden(reader.hidden, !initializing && !rootChanged);
    schedule();
  }
  const toolbar = reader.querySelector('.toolbar');
  const inControls = target => tools.contains(target) || toolbar?.contains(target);
  listen(toggle, 'click', () => {
    if (reader.hidden || selectionActive()) return;
    setHidden(!hidden);
    schedule();
  });
  listen(reader, 'pointerdown', event => {
    inputMethod = 'pointer';
    pointers.add(event.pointerId);
    if (inControls(event.target)) schedule();
  }, {capture:true, passive:true});
  const release = event => pointers.delete(event.pointerId);
  listen(doc, 'pointerup', release, {capture:true, passive:true});
  listen(doc, 'pointercancel', release, {capture:true, passive:true});
  listen(reader, 'keydown', event => {
    if (!['Shift','Control','Alt','Meta'].includes(event.key)) inputMethod = 'keyboard';
    if (inControls(event.target)) schedule();
  }, true);
  listen(reader, 'click', event => { if (inControls(event.target)) schedule(); });
  listen(reader, 'input', event => { if (inControls(event.target)) schedule(); });
  listen(reader, 'focusin', schedule);
  listen(reader, 'focusout', schedule);
  listen(doc, 'selectionchange', () => { if (!hidden) schedule(); });
  listen(view, 'blur', () => { pointers.clear(); });
  const observer = new view.MutationObserver(records => {
    if (reader.hidden !== wasReaderHidden) { refresh(); return; }
    // Streamed AI text and PDF page insertion must not keep an idle rail alive.
    // New transient surfaces are queried again when the timer expires.
    if (records.some(record => {
      const target = record.target;
      if (record.oldValue === target.getAttribute(record.attributeName)) return false;
      if (target === reader && record.attributeName === 'class') {
        const withoutRail = value => (value || '').split(/\s+/).filter(name => name && name !== 'tablet-tools-hidden').sort().join(' ');
        return withoutRail(record.oldValue) !== withoutRail(reader.className);
      }
      return target.matches(surfaces + ',#viewer,#visual-select-toggle');
    })) schedule();
  });
  observer.observe(reader, {subtree:true, attributes:true, attributeOldValue:true,
    attributeFilter:['hidden','class','open','aria-expanded','aria-pressed']});
  const selectionActions = doc.getElementById('selection-actions');
  if (selectionActions) observer.observe(selectionActions, {subtree:true, attributes:true, attributeOldValue:true,
    attributeFilter:['hidden','class','aria-expanded']});
  refresh();
  initializing = false;
  return {
    refresh,
    get hidden() { return hidden; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimer(); observer.disconnect(); pointers.clear();
      removers.forEach(remove => remove());
      setHidden(false, false);
    },
  };
}
