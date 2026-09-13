// Reversible view state only. Source targets and learning state come from their owners.
// A view-only ruler over the currently mounted conversation; never fetches history.
export function createMessageRail(scroller) {
  const shell = document.createElement('div'); shell.className = 'message-scroll-shell';
  scroller.before(shell); shell.append(scroller);
  const rail = document.createElement('nav'); rail.className = 'message-rail';
  rail.setAttribute('aria-label', '当前会话消息定位');
  const preview = document.createElement('div'); preview.className = 'message-rail-preview';
  preview.id = `${scroller.id}-preview`; preview.setAttribute('role', 'tooltip'); preview.hidden = true;
  shell.append(rail, preview);
  let messages = [], buttons = [], frame = 0, leaveTimer = 0, active = 0;
  function emphasize(position) {
    buttons.forEach((button,i) => {
      const distance=Math.abs(i-position);
      button.style.setProperty('--tick-scale',String(Math.max(4,26-distance*7)/26));
      button.toggleAttribute('data-emphasis', i===Math.round(position));
    });
  }
  function dismiss() { preview.hidden = true; buttons.forEach(b => b.removeAttribute('aria-describedby')); emphasize(active); }
  function show(index) {
    clearTimeout(leaveTimer);
    const message = messages[index]; if (!message) return;
    dismiss();
    const title = document.createElement('strong'); title.textContent = message.question.textContent.trim().slice(0, 100) || '提问';
    const text = document.createElement('p'); text.textContent = message.answer?.textContent.trim().slice(0, 240) || '等待回答';
    preview.replaceChildren(title, text); preview.hidden = false;
    emphasize(index);
    buttons[index].setAttribute('aria-describedby', preview.id);
    const bounds = buttons[index].getBoundingClientRect();
    const y = bounds.top + bounds.height/2 - shell.getBoundingClientRect().top - preview.offsetHeight/2;
    preview.style.top = `${Math.max(0, Math.min(y, shell.clientHeight - preview.offsetHeight))}px`;
  }
  function update() {
    frame = 0;
    if (!scroller.clientHeight || !messages.length) return;
    const top = scroller.getBoundingClientRect().top + 32;
    active = 0;
    messages.forEach((message, i) => { if (message.question.getBoundingClientRect().top <= top) active = i; });
    buttons.forEach((button, i) => { button.setAttribute('aria-current', String(i === active)); });
    if(preview.hidden) emphasize(active);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(update); }
  function rebuild() {
    const focused = buttons.indexOf(document.activeElement);
    dismiss();
    preview.replaceChildren();
    const bubbles = [...scroller.querySelectorAll('.assistant-question-bubble, .assistant-answer-bubble')];
    messages = [];
    for (const bubble of bubbles) {
      if (bubble.matches('.assistant-question-bubble')) messages.push({question:bubble,answer:null});
      else if(messages.length) messages.at(-1).answer=bubble;
    }
    buttons = messages.map((message, i) => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'message-tick question-tick';
      button.setAttribute('aria-label', `第 ${i + 1} 轮对话：${message.question.textContent.trim().slice(0, 60)}`);
      button.tabIndex = i === Math.max(0, focused) ? 0 : -1;
      button.onpointerenter = () => show(i); button.onfocus = () => show(i);
      button.onclick = () => {
        const top = message.question.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
        scroller.scrollTo({top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
        dismiss();
      };
      return button;
    });
    rail.replaceChildren(...buttons); rail.hidden = !buttons.length;
    if (focused >= 0) buttons[Math.min(focused, buttons.length - 1)]?.focus();
    schedule();
  }
  rail.onkeydown = event => {
    const i = buttons.indexOf(document.activeElement);
    const next = {ArrowDown: Math.min(i + 1, buttons.length - 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: buttons.length - 1}[event.key];
    if (next !== undefined) { event.preventDefault(); buttons.forEach((b, n) => { b.tabIndex = n === next ? 0 : -1; }); buttons[next]?.focus(); }
  };
  rail.onpointermove = event => {
    if(!buttons.length) return;
    const first=buttons[0].getBoundingClientRect();
    emphasize(Math.max(0,Math.min(buttons.length-1,(event.clientY-first.top-first.height/2)/first.height)));
  };
  shell.addEventListener('keydown', e => { if (e.key === 'Escape') dismiss(); });
  shell.addEventListener('pointerleave', dismiss);
  rail.addEventListener('pointerleave', () => { leaveTimer = setTimeout(dismiss, 120); });
  preview.addEventListener('pointerenter', () => clearTimeout(leaveTimer));
  preview.addEventListener('pointerleave', dismiss);
  rail.addEventListener('focusout', e => { if (!rail.contains(e.relatedTarget)) dismiss(); });
  scroller.addEventListener('scroll', () => { dismiss(); schedule(); }, {passive: true});
  new MutationObserver(rebuild).observe(scroller, {childList: true, subtree: true, characterData: true});
  new ResizeObserver(() => { dismiss(); schedule(); }).observe(scroller);
  rebuild();
}

export const node = (tag, text = '', className = '') => {
  const n = document.createElement(tag); n.textContent = text; n.className = className; return n;
};
export const action = (label, run, className = '') => {
  const n = node('button', label, className); n.type = 'button';
  let failure;
  n.onclick = async () => {
    n.disabled = true; failure?.remove();
    try { await run(); }
    catch(error) { failure = node('p', error.message || '操作失败，请重试。', 'local-error'); failure.setAttribute('role','alert'); n.after(failure); }
    finally { n.disabled = false; }
  }; return n;
};
export function header(active, home, memory, extra) {
  const h = node('header', '', 'home-toolbar');
  const brand = node('div', '', 'brand'); brand.append(node('span', '408', 'brand-mark'), node('strong', 'Guided Reader'));
  const nav = node('nav', '', 'space-navigation'); nav.setAttribute('aria-label', '学习空间');
  for (const [label, run, key] of [['学习空间', home, 'home'], ['学习记忆', memory, 'memory']]) {
    const b = action(label, run); if (key === active) b.setAttribute('aria-current', 'page'); nav.append(b);
  }
  h.append(brand, nav); if (extra) h.append(extra); return h;
}
export function createScreens({api, home, memory, read, remove, revision, announce, isAuxiliary}) {
  const overview = node('section', '', 'book-overview'); overview.id = 'book-overview'; overview.hidden = true;
  let selectedBook = null, selectedChapter = null, epoch = 0, timer, nodes = [], learning = null, currentSection = null, reading = [];
  const chapters = new Map();
  const importAction = () => action('＋ 导入教材', () => document.getElementById('import-input').click(), 'primary-action');
  overview.append(header('home', home, memory, importAction()));
  const content = node('main', '', 'overview-content');
  const back = action('← 学习空间', home, 'overview-back');
  const title = node('h1'), position = node('p', '', 'muted'), resume = action('继续 PDF →', () => read(selectedBook), 'primary-action');
  const bookHead = node('div', '', 'overview-book-heading');
  const identity = node('div'); identity.append(node('p', 'BOOK OVERVIEW　教材总览', 'eyebrow'), title, position);
  bookHead.append(identity, resume);
  const body = node('div', '', 'overview-body'), rail = node('nav', '', 'chapter-rail'), map = node('div', '', 'overview-map');
  rail.setAttribute('aria-label', '教材章节'); body.append(rail, map); content.append(back, bookHead, body); overview.append(content); document.body.append(overview);
  function close() { overview.hidden = true; ++epoch; clearTimeout(timer); }
  function localError(target, error, retry) { target.replaceChildren(node('p', error.message || String(error), 'local-error'), action('重试', retry)); }
  async function open(book, chapterId) {
    selectedBook = book; selectedChapter = chapterId || chapters.get(book.id); ++epoch; clearTimeout(timer);
    document.getElementById('library-home').hidden = true; document.getElementById('reader').hidden = true;
    overview.hidden = false; title.textContent = book.title; title.tabIndex = -1; title.focus();
    const p = book.active_revision.position; resume.textContent = p.updated_at ? `继续 PDF ${p.pdf_page_index + 1} →` : '打开 PDF →';
    position.textContent = p.updated_at ? `上次读到 PDF ${p.pdf_page_index + 1} / ${book.active_revision.page_count}` : '尚未开始阅读';
    rail.replaceChildren(node('p', '正在读取章节…')); map.replaceChildren();
    const stamp = epoch;
    learning = null;
    api(`/api/revisions/${book.active_revision.id}/learning`).then(value => { if(stamp === epoch) learning = value; }).catch(() => {});
    try {
      const value = await api(`/api/revisions/${book.active_revision.id}/outline`);
      if (stamp !== epoch) return; nodes = value.nodes;
      const context = await api(`/api/revisions/${book.active_revision.id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`).catch(() => null);
      if(stamp !== epoch) return;
      if(context?.chapter) position.textContent = `当前阅读：${context.chapter.title} · PDF ${p.pdf_page_index + 1}`;
      currentSection = context?.section?.outline_node_id;
      selectedChapter ||= context?.chapter?.outline_node_id || nodes.find(n => n.kind === 'CHAPTER')?.outline_node_id;
      renderRail(); await loadMap();
    } catch(error) { if(stamp === epoch) localError(rail, error, () => open(book)); }
  }
  function renderRail() {
    rail.replaceChildren(node('p', '章节', 'muted'));
    for(const n of nodes.filter(n => n.kind === 'CHAPTER' && !isAuxiliary(n))) {
      const b = action('', async () => { selectedChapter = n.outline_node_id; chapters.set(selectedBook.id, selectedChapter); renderRail(); await loadMap(); }, 'chapter-row');
      b.append(node('span', n.title), node('small', n.start_page == null ? '位置待确认' : `PDF ${n.start_page + 1}`));
      b.setAttribute('aria-current', String(n.outline_node_id === selectedChapter)); rail.append(b);
    }
    const other = nodes.filter(n => !n.parent_id && (n.kind !== 'CHAPTER' || isAuxiliary(n)));
    if(other.length) { const d = node('details'); d.append(node('summary', '其他内容')); for(const n of other) d.append(source(n, n.title)); rail.append(d); }
    if(!nodes.length) rail.append(node('p', '目录尚未就绪，仍可打开 PDF。', 'muted'), action('刷新目录', () => open(selectedBook)));
  }
  function source(n, label = '进入教材 ↗') {
    const b = action(label, () => read(selectedBook, {page: n.start_page, y: n.start_y ?? 0}), 'source-action');
    b.disabled = n.start_page == null || ('resolution_state' in n && n.resolution_state !== 'RESOLVED'); if(b.disabled) b.textContent = '来源位置待确认'; return b;
  }
  async function loadMap(refresh = false) {
    clearTimeout(timer); const stamp = ++epoch, chapterId = selectedChapter;
    const chapter = nodes.find(n => n.outline_node_id === chapterId); if(!chapter) return;
    const expanded = refresh ? new Map([...map.querySelectorAll('.overview-section')].map(n => [n.dataset.sectionId,n.open])) : null;
    if(!refresh) map.replaceChildren(node('h2', chapter.title), node('p', '正在读取本章学习结构…', 'muted'));
    try {
      const payload = await api(`/api/revisions/${selectedBook.active_revision.id}/chapters/${chapterId}/knowledge-map`);
      const states = await api(`/api/revisions/${selectedBook.active_revision.id}/learning`).catch(() => null);
      reading = (await api(`/api/revisions/${selectedBook.active_revision.id}/section-reading`).catch(() => ({sections:[]}))).sections;
      if(stamp !== epoch || overview.hidden) return; learning = states;
      renderMap(payload, chapter);
      if(expanded) map.querySelectorAll('.overview-section').forEach(n => { if(expanded.has(n.dataset.sectionId)) n.open = expanded.get(n.dataset.sectionId); });
      if(payload.status === 'PREPARING' || payload.regeneration_state === 'RUNNING') timer = setTimeout(() => loadMap(true), 1400);
    } catch(error) { if(stamp === epoch) localError(map, error, loadMap); }
  }
  function renderMap(p, chapter) {
    map.replaceChildren(); const h = node('div', '', 'chapter-heading'); h.append(node('h2', chapter.title));
    if(p.status === 'READY') { const meta=node('div'); meta.append(node('p', `${p.knowledge_points.length} 个知识点`, 'muted')); const counts=learning?.chapter_counts?.[selectedChapter]; if(counts) meta.append(node('p', `${counts.UNDERSTOOD} 已理解 · ${counts.NOT_FULLY_CLEAR} 仍不清楚 · ${counts.UNCONFIRMED} 待确认`, 'muted')); h.append(meta); } map.append(h);
    const phase = {QUEUED:'等待开始',RESOLVING_SOURCE:'来源准备中',GENERATING:'生成中',REVIEWING:'审查中',VALIDATING:'校验中',PUBLISHING:'发布中'}[p.prepare_stage] || '准备中';
    const status = {NOT_PREPARED:'本章学习结构尚未准备', PREPARING:`${phase} · ${p.sections_completed || 0}/${p.sections_total || '—'} 小节`, FAILED:`本章准备失败 · ${p.failure_code || ''}`} [p.status];
    if(status) map.append(node('p', status, p.status === 'FAILED' ? 'local-error' : p.status === 'PREPARING' ? 'muted ai-progress' : 'muted'));
    if(p.regeneration_state === 'RUNNING' || p.regeneration_state === 'FAILED') map.append(node('p', p.regeneration_state === 'RUNNING' ? `${phase}，当前已发布地图仍可使用。` : '重新生成失败，保留当前已发布地图。', p.regeneration_state === 'RUNNING' ? 'muted ai-progress' : 'muted'));
    if(p.status !== 'PREPARING') {
      const controls = node('details', '', 'map-options'); controls.append(node('summary', p.status === 'READY' ? '学习结构选项' : '准备学习结构'));
      const b = action(p.status === 'READY' ? '重新生成本章知识点' : p.status === 'FAILED' ? '重试准备' : '准备本章学习地图', async () => {
        try { await api(`/api/revisions/${selectedBook.active_revision.id}/chapters/${selectedChapter}/knowledge-map/${p.status === 'READY' ? 'regenerate' : 'prepare'}`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); await loadMap(); }
        catch(e) { announce(e.message, true); }
      }); b.disabled = p.status === 'READY' && (!p.regeneration_allowed || p.regeneration_state === 'RUNNING'); controls.append(b);
      if(b.disabled) controls.append(node('p', '已有学习状态或关联内容，当前地图受保护。', 'muted')); map.append(controls);
    }
    const sections = nodes.filter(n => n.kind === 'SECTION' && n.parent_id === selectedChapter);
    for(const section of sections) {
      const region = node('details', '', 'overview-section'); region.open = section.outline_node_id === currentSection; region.dataset.sectionId = section.outline_node_id;
      const head = node('summary', '', 'section-heading'); const text=node('div'); text.append(node('h3', section.title)); const counts=learning?.section_counts?.[section.outline_node_id]; if(counts) text.append(node('p', `${counts.UNDERSTOOD} 已理解 · ${counts.NOT_FULLY_CLEAR} 仍不清楚 · ${counts.UNCONFIRMED} 待确认`, 'muted')); if(reading.some(r=>r.outline_node_id===section.outline_node_id && r.reading_reached_end_at && ['NOT_APPLICABLE_YET','AVAILABLE'].includes(r.mastery_check_state))) text.append(node('p','已阅读 · 待确认','muted')); head.append(text, source(section)); region.append(head);
      for(const kp of p.status === 'READY' ? p.knowledge_points.filter(k => k.primary_section_id === section.outline_node_id) : []) {
        const row = node('div', '', 'overview-kp'); const current = learning?.points.find(k => k.knowledge_point_id === kp.knowledge_point_id);
        row.dataset.kpId = kp.knowledge_point_id;
        const desc = node('div'); desc.append(node('strong', kp.title), node('p', kp.one_sentence_definition, 'muted'));
        const state = node('span', current ? ({UNDERSTOOD:'已理解',NOT_FULLY_CLEAR:'仍不清楚',UNCONFIRMED:'待确认'}[current.status]) : '状态暂不可用', `kp-state ${current?.status || ''}`);
        const target = source(kp, `PDF ${kp.start_page + 1} ↗`); row.append(state, desc, target); region.append(row);
      }
      map.append(region);
    }
  }
  async function library(books) {
    const list = document.getElementById('book-list'); list.replaceChildren();
    for(const book of books) {
      const r = book.active_revision, row = node('article', '', 'book-card');
      const cover = node('div', book.title.replace(/^\d+/, '').slice(0, 4), 'book-spine');
      const info = node('div', '', 'book-info'); info.append(node('h2', book.title, 'book-card-title'), node('p', r ? `${r.page_count} 个 PDF 页面 · ${r.position.updated_at ? `上次读到 PDF ${r.position.pdf_page_index + 1}` : '尚未开始学习'}` : '删除未完成', 'book-card-meta'));
      row.append(cover, info);
      if(r) row.append(action('打开', () => open(book), 'book-open'));
      if(r) {
        const availability = node('p', 'PDF 可阅读', 'book-card-meta'); info.append(availability);
        api(`/api/revisions/${r.id}/preparation`).then(value => {
          if(!availability.isConnected) return;
          const ready = value.pages.filter(p => p.status === 'READY').length;
          availability.textContent = ready === r.page_count ? 'PDF 与文字层可用' : `PDF 可阅读 · 文字层已准备 ${ready} / ${r.page_count} 页`;
        }).catch(() => { if(availability.isConnected) availability.textContent = 'PDF 可阅读 · 文字准备状态暂不可用'; });
      }
      const more = node('details', '', 'book-more'); const summary = node('summary', '···'); summary.setAttribute('aria-label', `${book.title} 更多操作`); more.append(summary);
      if(r) more.append(action('添加新版本', () => revision(book))); more.append(action(r ? '删除教材' : '重试删除', () => remove(book))); row.append(more); list.append(row);
    }
    const recent = books.filter(b => b.active_revision?.position.updated_at).sort((a,b) => b.active_revision.position.updated_at.localeCompare(a.active_revision.position.updated_at))[0];
    const block = document.getElementById('home-continue'); block.replaceChildren(); block.hidden = !recent;
    if(!recent) return;
    const r = recent.active_revision, p = r.position;
    block.append(node('p', 'CONTINUE　继续学习', 'eyebrow'));
    const row = node('div', '', 'continue-row'), info = node('div', '', 'continue-info');
    info.append(node('p', recent.title, 'muted')); const h = node('h1', `继续阅读教材`); info.append(h, node('p', `PDF ${p.pdf_page_index+1} / ${r.page_count} · ${Math.round(p.zoom*100)}%`, 'muted'));
    const links = node('div', '', 'continue-actions'); links.append(action('继续学习 →', () => read(recent), 'primary-action'), action('查看全书结构', () => open(recent)));
    row.append(node('div', recent.title.replace(/^\d+/, ''), 'continue-cover'), info, links); block.append(row);
    try { const c = await api(`/api/revisions/${r.id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`); if(h.isConnected) { h.textContent = c.section?.title || c.chapter?.title || '继续阅读教材'; const counts=c.learning_counts; if(counts) info.append(node('p', `${counts.UNDERSTOOD} 已理解　·　${counts.NOT_FULLY_CLEAR} 仍不清楚　·　${counts.UNCONFIRMED} 待确认`, 'continue-stats')); } } catch { /* PDF resume remains independent. */ }
  }
  return {open, close, library, overview};
}

// Current-chapter preparation only; the full map remains owned by Book Overview.
export function createChapterEntry({api, revision, openOverview, published, goToPage}) {
  const entry = document.createElement('button');
  entry.id = 'reader-kp-action'; entry.type = 'button'; entry.hidden = true;
  document.getElementById('outline-toggle').after(entry);
  const panel = node('section', '', 'reader-kp-list'); panel.id = 'reader-kp-list'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '本章知识点'); panel.tabIndex = -1;
  (document.getElementById('reader') || document.body).append(panel);
  entry.setAttribute('aria-controls', panel.id); entry.setAttribute('aria-expanded', 'false');
  let listEpoch = 0;
  function closeList(focus = false) { ++listEpoch; panel.hidden = true; entry.setAttribute('aria-expanded', 'false'); if(focus) entry.focus(); }
  panel.addEventListener('keydown', e => { if(e.key === 'Escape') { e.stopPropagation(); closeList(true); } });
  async function openList() {
    const stamp = epoch, request = ++listEpoch, targetChapter = chapter;
    const points = snapshot.knowledge_points;
    panel.replaceChildren(); panel.hidden = false; entry.setAttribute('aria-expanded', 'true');
    const heading = node('div', '', 'reader-kp-heading');
    heading.append(node('strong', snapshot.chapter_title || '本章知识点'), action('关闭', () => closeList(true)));
    const body = node('div', '', 'reader-kp-body'); body.append(node('p', '读取知识点状态…', 'muted'));
    panel.append(heading, body, action('查看完整学习结构 ↗', () => { closeList(); return openOverview(targetChapter); }, 'reader-kp-footer'));
    panel.focus();
    const [outline, learning] = await Promise.allSettled([api(`/api/revisions/${owner}/outline`), api(`/api/revisions/${owner}/learning`)]);
    if(stamp !== epoch || request !== listEpoch) return;
    body.replaceChildren();
    const nodes = outline.status === 'fulfilled' ? outline.value.nodes : [];
    const states = learning.status === 'fulfilled' ? learning.value.points : [];
    const ids = [...new Set([...nodes.filter(n => n.kind === 'SECTION' && n.parent_id === targetChapter).map(n => n.outline_node_id), ...points.map(p => p.primary_section_id)])];
    for(const id of ids) {
      const group = points.filter(p => p.primary_section_id === id); if(!group.length) continue;
      const region = node('section'); region.dataset.sectionId = id;
      region.append(node('h3', nodes.find(n => n.outline_node_id === id)?.title || '小节标题暂不可用'));
      for(const kp of group) {
        const row = node('div', '', 'reader-kp-row'); row.dataset.kpId = kp.knowledge_point_id;
        const status = states?.find(p => p.knowledge_point_id === kp.knowledge_point_id)?.status;
        const stateText = {UNDERSTOOD:'已理解',NOT_FULLY_CLEAR:'仍不清楚',UNCONFIRMED:'待确认'}[status] || '状态暂不可用';
        const info = node('div'); info.append(node('span', kp.title), node('small', stateText, 'kp-state'));
        row.append(info);
        if(Number.isInteger(kp.start_page) && kp.start_page >= 0 && Number.isFinite(kp.start_y)) {
          row.append(action(`PDF ${kp.start_page + 1} ↗`, () => { closeList(); goToPage(kp.start_page, kp.start_y); }, 'source-action'));
        } else row.append(node('small', '来源暂不可用', 'muted'));
        region.append(row);
      }
      body.append(region);
    }
    if(!points.length) body.append(node('p', '本章暂无已发布知识点', 'muted'));
  }
  let owner = null, chapter = null, section = null, snapshot = null, epoch = 0, timer, pending = false, error = null;
  const stages = {QUEUED:'等待开始',RESOLVING_SOURCE:'来源准备中',GENERATING:'生成中',REVIEWING:'审查中',VALIDATING:'校验中',PUBLISHING:'发布中'};
  const base = () => `/api/revisions/${owner}/chapters/${chapter}/knowledge-map`;
  function reset() { ++epoch; closeList(); clearTimeout(timer); owner = chapter = snapshot = null; pending = false; error = null; entry.hidden = true; }
  function sync(id, sectionId) {
    if (owner === revision() && chapter === id) { if(section !== sectionId) {section = sectionId; render();} return; }
    reset(); owner = revision(); chapter = id; section = sectionId;
    if (owner && chapter) { entry.hidden = false; render(); load(); }
  }
  function render() {
    const busy = snapshot?.status === 'PREPARING' || snapshot?.regeneration_state === 'RUNNING';
    entry.disabled = pending || busy;
    entry.classList.toggle('ai-progress', pending || busy);
    entry.setAttribute('aria-busy', String(pending || busy));
    entry.dataset.status = snapshot?.status || 'LOADING';
    const count = snapshot?.sections_total ? ` ${snapshot.sections_completed || 0}/${snapshot.sections_total}` : '';
    entry.textContent = pending ? 'KP · 准备中' : error ? 'KP · 重试'
      : busy ? `KP · ${stages[snapshot.prepare_stage] || '准备中'}${count}`
      : snapshot?.status === 'READY' ? `${snapshot.knowledge_points.length} 个知识点`
      : snapshot?.status === 'FAILED' ? (snapshot.failure_code === 'semantic_window_source_limit' ? '小节内容超出处理容量' : '生成失败 · 重试') : snapshot ? '＋ 生成本章知识点' : 'KP · 读取中';
    const failureReason = snapshot?.failure_code === 'semantic_window_source_limit'
      ? '当前小节原文超过单次处理容量；重复重试无法解决，需调整处理容量。' : null;
    entry.title = error || failureReason || (snapshot?.status === 'READY' ? '查看本章知识点与学习状态'
      : `${snapshot?.chapter_title || '当前章'}：${entry.textContent}，PDF 阅读不受影响`);
  }
  async function load() {
    clearTimeout(timer); const stamp = epoch;
    try {
      const value = await api(base());
      if (stamp !== epoch) return;
      const newlyReady = snapshot?.status !== 'READY' && value.status === 'READY';
      snapshot = value; error = null; render();
      if (newlyReady) published();
      timer = setTimeout(load, value.status === 'PREPARING' || value.regeneration_state === 'RUNNING' ? 700 : 5000);
    } catch(e) { if (stamp === epoch) {error = e.message; render();} }
  }
  entry.onclick = async () => {
    if (pending || !chapter || !owner || entry.disabled) return;
    if (!snapshot || error) { await load(); return; }
    if (snapshot.status === 'READY') { if(panel.hidden) await openList(); else closeList(); return; }
    const stamp = epoch; pending = true; error = null; clearTimeout(timer); render();
    try {
      const result = await api(`${base()}/prepare`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if (stamp !== epoch) return;
      snapshot = result.chapter_map;
    } catch(e) { if (stamp === epoch) error = e.message; }
    finally { if (stamp === epoch) {pending = false; render(); if(!error) load();} }
  };
  return {sync, reset};
}


// Visual adapter only: the original select remains the value/change/disabled owner.
export function createAssistantModelMenu(select) {
  return createComposerChoice(select, {id:'assistant-model', label:'当前 AI 模型',
    names:{deepseek:'DeepSeek',zhipu:'GLM-5.3',openrouter:'Gemini 3.8'}});
}

export function createComposerChoice(select, {id, label, names}) {
  const wrapper = node('div', '', 'assistant-model-menu');
  const trigger = node('button', '', 'composer-choice-trigger'); trigger.type = 'button'; trigger.id = `${id}-trigger`;
  trigger.setAttribute('aria-label', label); trigger.setAttribute('aria-haspopup', 'listbox');
  const list = node('div', '', 'assistant-model-options'); list.id = `${id}-options`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', label); list.hidden = true;
  list.tabIndex = -1;
  trigger.setAttribute('aria-controls', list.id); trigger.setAttribute('aria-expanded', 'false');
  wrapper.append(trigger, list); select.closest('.assistant-model').after(wrapper);
  select.closest('.assistant-model').hidden = true;
  function close(restore = false) { list.hidden = true; trigger.setAttribute('aria-expanded','false'); if(restore) trigger.focus(); }
  function sync() {
    trigger.textContent = names[select.value] || label;
    trigger.disabled = false; trigger.title = select.title;
    list.replaceChildren(...[...select.options].map(option => {
      const item = node('button', option.textContent); item.type = 'button'; item.tabIndex = -1;
      item.setAttribute('role','option'); item.setAttribute('aria-selected',String(option.selected));
      item.disabled = option.disabled || select.disabled; item.dataset.value = option.value;
      item.onclick = () => {
        if(select.disabled || option.disabled) {close(); return;}
        select.value = option.value; close(true);
        select.dispatchEvent(new Event('change', {bubbles:true}));
      };
      return item;
    }));
  }
  function open() {
    sync(); list.style.transform = ''; list.hidden = false; trigger.setAttribute('aria-expanded','true');
    if (select.disabled) list.append(node('small', select.title || '当前会话已锁定模型'));
    const bounds = list.getBoundingClientRect();
    list.style.transform = `translateX(${Math.max(8 - bounds.left, Math.min(0, window.innerWidth - 8 - bounds.right))}px)`;
    (list.querySelector('[aria-selected="true"]:not(:disabled)') || list.querySelector('button:not(:disabled)') || list).focus();
  }
  trigger.onclick = () => list.hidden ? open() : close();
  trigger.onkeydown = e => { if(['ArrowDown','ArrowUp'].includes(e.key)) {e.preventDefault();open();} };
  list.onkeydown = e => {
    if(e.key === 'Escape') {e.preventDefault();e.stopPropagation();close(true);return;}
    if(e.key === 'Tab') {close(true);return;}
    const items = [...list.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let next;
    if(e.key === 'ArrowDown') next=(index+1)%items.length;
    if(e.key === 'ArrowUp') next=(index-1+items.length)%items.length;
    if(e.key === 'Home') next=0;
    if(e.key === 'End') next=items.length-1;
    if(next !== undefined) {e.preventDefault();items[next]?.focus();}
  };
  document.addEventListener('pointerdown', e => { if(!wrapper.contains(e.target)) close(); });
  select.addEventListener('change', sync);
  sync(); return {sync};
}
