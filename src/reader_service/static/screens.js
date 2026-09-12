// Reversible view state only. Source targets and learning state come from their owners.
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
    const status = {NOT_PREPARED:'本章学习结构尚未准备', PREPARING:`正在准备本章学习结构 · ${p.sections_completed || 0}/${p.sections_total || '—'} 小节`, FAILED:`本章准备失败 · ${p.failure_code || ''}`} [p.status];
    if(status) map.append(node('p', status, p.status === 'FAILED' ? 'local-error' : 'muted'));
    if(p.regeneration_state === 'RUNNING' || p.regeneration_state === 'FAILED') map.append(node('p', p.regeneration_state === 'RUNNING' ? '正在重新生成，当前已发布地图仍可使用。' : '重新生成失败，保留当前已发布地图。', 'muted'));
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
