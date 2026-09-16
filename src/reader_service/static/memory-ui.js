import {header, action} from "/screens.js";
import { renderAssistantAnswer } from '/assistant-render.js';

const REVIEW = {
  PENDING: { text: '正在审查', tone: 'pending' },
  FAIL: { text: '内容需要核对', tone: 'failed' },
};

export function createMemoryUI({ api, announce, returnToSource, enterView = () => {}, leaveView = () => {}, home = () => {}, resume = () => {} }) {
  let items = [], loading = null;
  let pageEpoch = 0, detailEpoch = 0;
  let selectedBookId = null, selectedSectionId = null, selectedId = null;
  const outlines = new Map(), controls = new Set();
  const view = document.createElement('section');
  view.id = 'learning-memory'; view.hidden = true;
  view.setAttribute('aria-labelledby', 'memory-title');
  view.innerHTML = `<main class="memory-page-content">
    <section id="memory-library-view">
      <div class="memory-heading"><div><p class="eyebrow">LEARNING MEMORY</p><h1 id="memory-title" tabindex="-1">学习记忆</h1></div></div>
      <p id="memory-status" role="status"></p><div id="memory-book-list"></div>
    </section>
    <section id="memory-book-view" hidden>
      <div class="memory-book-heading">
        <button id="memory-back-books" type="button">← 学习记忆</button>
        <div><p class="eyebrow">BOOK MEMORY</p><h1 id="memory-book-title" tabindex="-1"></h1><p id="memory-book-count" class="muted"></p></div>
        <button id="memory-search-toggle" type="button" aria-expanded="false">查找</button>
      </div>
      <div id="memory-search" class="memory-search" hidden><label for="memory-query" class="sr-only">在当前教材中查找</label><input id="memory-query" type="search" placeholder="在当前教材中查找"></div>
      <div class="memory-browser">
        <nav id="memory-tree" aria-label="章节与小节"></nav>
        <section id="memory-items" aria-label="学习记忆条目"></section>
        <section id="memory-detail" aria-label="学习记忆正文" hidden></section>
      </div>
    </section>
  </main>`;
  const returnButton = action('回到阅读', async () => { close(false); await resume(); }); returnButton.id = 'memory-close';
  view.prepend(header('memory', () => {close(false); home();}, () => {}, returnButton));
  document.body.append(view);
  const el = id => view.querySelector(`#memory-${id}`);
  const button = (label, handler, className = '') => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className;
    node.addEventListener('click', handler); return node;
  };
  const text = (tag, value, className = '') => { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; };
  const base = item => `/api/revisions/${item.book_source_revision_id}/memory/${item.id}`;
  const sectionKey = item => item.section?.id || 'unassociated';
  const titleOf = item => item.source.question || item.source.provenance?.answer_question
    || item.source.provenance?.child_focus || item.source.provenance?.root_focus
    || item.knowledge_point?.title || '收录的解释';
  const bodyOf = item => item.source_kind === 'MASTER' ? item.source.content : item.source.body;
  const reviewState = item => item.source.review_state || item.source.verification_state;
  const reviewOf = item => REVIEW[reviewState(item)] || null;
  const hasTechnicalReviewFailure = item => reviewState(item) === 'TECHNICAL_FAILURE';
  function summaryOf(item) {
    const rendered = document.createElement('div'); renderAssistantAnswer(rendered, bodyOf(item) || '');
    const value = rendered.textContent.replace(/\s+/g, ' ').trim();
    return value.length > 82 ? `${value.slice(0, 82).trimEnd()}…` : value;
  }
  function sourceIdentity(item, includeSection = true) {
    const row = text('span', '', 'memory-source-line');
    row.append(text('span', item.source_kind === 'MASTER' ? 'Master' : 'Assistant', 'memory-kind'));
    const parts = [];
    if(includeSection && item.section?.title) parts.push(item.section.title);
    if(Number.isInteger(item.source.pdf_page_index)) parts.push(`PDF ${item.source.pdf_page_index + 1}`);
    if(parts.length) row.append(text('span', parts.join(' · ')));
    return row;
  }
  function updateControls() {
    for (const entry of controls) {
      if (!entry.node.isConnected) { controls.delete(entry); continue; }
      entry.item = items.find(i => i.source_kind === entry.kind && i.source_id === entry.id && i.book_source_revision_id === entry.revision);
      entry.node.textContent = entry.item ? '已收入学习记忆' : '收入学习记忆';
      entry.node.disabled = Boolean(entry.item);
      entry.node.title = entry.item ? '可在首页的学习记忆中查看和管理' : '';
    }
  }
  async function refresh() {
    if (!loading) loading = api('/api/memory').then(result => { items = result.items; updateControls(); }).finally(() => { loading = null; });
    await loading;
  }
  function control(revision, kind, id) {
    const entry = { revision, kind, id, item: null };
    const node = button('收入学习记忆', async () => {
      if (entry.item) return;
      node.disabled = true;
      try {
        await api(`/api/revisions/${revision}/memory`, { method: 'POST', body: JSON.stringify({ source_kind: kind, source_id: id }) });
        await refresh(); announce('已收入学习记忆。');
      } catch (error) { announce(error.message, true); }
      finally { node.disabled = Boolean(entry.item); }
    });
    node.className = 'memory-source-control'; entry.node = node; controls.add(entry);
    queueMicrotask(() => refresh().catch(error => announce(error.message, true)));
    return node;
  }
  function books() {
    const grouped = new Map();
    for(const item of items) {
      if(!grouped.has(item.book_id)) grouped.set(item.book_id, {id:item.book_id, title:item.book_title, items:[]});
      grouped.get(item.book_id).items.push(item);
    }
    return [...grouped.values()];
  }
  function showHome(focus = false) {
    ++pageEpoch; ++detailEpoch; selectedBookId = selectedSectionId = selectedId = null;
    view.setAttribute('aria-labelledby', 'memory-title');
    el('book-view').hidden = true; el('library-view').hidden = false;
    const rows = books(); el('status').textContent = rows.length ? '' : '还没有学习记忆。';
    el('book-list').replaceChildren(...rows.map(book => {
      const row = button('', () => openBook(book.id), 'memory-book-open'); row.dataset.bookId = book.id;
      const info = text('span', '', 'memory-book-info');
      info.append(text('strong', book.title), text('span', `${book.items.length} 条记忆`, 'muted'));
      row.append(info, text('span', '→', 'memory-book-arrow')); return row;
    }));
    if(focus) el('title').focus();
  }
  async function openBook(bookId, focus = true) {
    const bookItems = items.filter(item => item.book_id === bookId);
    if(!bookItems.length) { showHome(focus); return; }
    const request = ++pageEpoch; ++detailEpoch; selectedBookId = bookId; selectedId = null;
    view.setAttribute('aria-labelledby', 'memory-book-title');
    el('library-view').hidden = true; el('book-view').hidden = false;
    el('book-title').textContent = bookItems[0].book_title; el('book-count').textContent = `${bookItems.length} 条记忆`;
    el('tree').replaceChildren(text('p', '正在读取目录…', 'muted')); el('items').replaceChildren(); el('detail').hidden = true;
    el('query').value = ''; el('search').hidden = true; el('search-toggle').setAttribute('aria-expanded', 'false');
    const revision = bookItems[0].book_source_revision_id;
    if(!outlines.has(revision)) {
      try { outlines.set(revision, (await api(`/api/revisions/${revision}/outline`)).nodes || []); }
      catch { outlines.set(revision, []); }
    }
    if(request !== pageEpoch || view.hidden || selectedBookId !== bookId) return;
    const validSections = [...new Set(bookItems.map(sectionKey))];
    if(!validSections.includes(selectedSectionId)) selectedSectionId = validSections[0];
    renderBook(); if(focus) el('book-title').focus();
  }
  function sectionNavigation(bookItems, nodes) {
    const byId = new Map(nodes.map(node => [node.outline_node_id, node]));
    const sections = new Map();
    for(const item of bookItems) {
      const id = sectionKey(item);
      if(!sections.has(id)) sections.set(id, {id, title:item.section?.title || '未关联 Section', count:0, node:byId.get(id)});
      sections.get(id).count += 1;
    }
    const chapterOf = section => {
      let current = section.node;
      while(current && current.kind !== 'CHAPTER') current = byId.get(current.parent_id);
      return current || {outline_node_id:'unassociated', title:'未关联章节'};
    };
    const ordered = [...sections.values()].sort((a,b) => {
      const ap = a.node ? [a.node.start_page ?? Number.MAX_SAFE_INTEGER, a.node.start_y ?? 0] : [Number.MAX_SAFE_INTEGER,0];
      const bp = b.node ? [b.node.start_page ?? Number.MAX_SAFE_INTEGER, b.node.start_y ?? 0] : [Number.MAX_SAFE_INTEGER,0];
      return ap[0] - bp[0] || ap[1] - bp[1] || a.title.localeCompare(b.title, 'zh-CN');
    });
    const chapters = new Map();
    for(const section of ordered) {
      const chapter = chapterOf(section);
      if(!chapters.has(chapter.outline_node_id)) chapters.set(chapter.outline_node_id, {title:chapter.title, sections:[]});
      chapters.get(chapter.outline_node_id).sections.push(section);
    }
    return [...chapters.values()];
  }
  function matches(item, query) {
    if(!query) return true;
    return [titleOf(item), bodyOf(item), item.section?.title, item.knowledge_point?.title]
      .filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  }
  function renderBook() {
    const bookItems = items.filter(item => item.book_id === selectedBookId);
    if(!bookItems.length) { showHome(true); return; }
    const nodes = outlines.get(bookItems[0].book_source_revision_id) || [];
    const chapters = sectionNavigation(bookItems, nodes);
    el('tree').replaceChildren(...chapters.map(chapter => {
      const group = text('section', '', 'memory-chapter'); group.append(text('h2', chapter.title));
      for(const section of chapter.sections) {
        const control = button('', () => { selectedSectionId = section.id; selectedId = null; el('query').value = ''; closeSearch(); renderBook(); }, 'memory-section-open');
        control.dataset.sectionId = section.id; control.setAttribute('aria-current', String(section.id === selectedSectionId));
        control.append(text('span', section.title), text('small', String(section.count))); group.append(control);
      }
      return group;
    }));
    const query = el('query').value.trim().toLocaleLowerCase();
    const shown = bookItems.filter(item => query ? matches(item, query) : sectionKey(item) === selectedSectionId);
    renderItems(shown, query);
  }
  function renderItems(shown, query) {
    ++detailEpoch; selectedId = null; el('detail').hidden = true;
    const groups = new Map();
    for(const item of shown) {
      const unassigned = !item.knowledge_point;
      const key = unassigned ? `unassigned:${sectionKey(item)}` : item.knowledge_point.id;
      if(!groups.has(key)) groups.set(key, {
        id:key,
        title:unassigned ? '未归属知识点' : item.knowledge_point.title,
        sectionTitle:item.section?.title || '未关联 Section',
        unassigned,
        items:[],
      });
      groups.get(key).items.push(item);
    }
    const content = [];
    if(query) content.push(text('p', shown.length ? `${shown.length} 条结果` : '没有找到相关记忆', 'memory-result-count'));
    for(const group of groups.values()) {
      const section = text('section', '', `memory-kp-group${group.unassigned ? ' memory-unassigned-group' : ''}`);
      section.dataset.kpId = group.id;
      section.append(text('h2', query && group.unassigned ? `${group.sectionTitle} · ${group.title}` : group.title));
      for(const item of group.items) {
        const row = button('', () => detail(item), 'memory-item-open'); row.dataset.memoryId = item.id;
        row.append(text('strong', titleOf(item)), text('span', summaryOf(item), 'memory-card-summary'));
        const meta = sourceIdentity(item, Boolean(query));
        const review = reviewOf(item); if(review) meta.append(text('span', review.text, `memory-review-status ${review.tone}`));
        row.append(meta); section.append(row);
      }
      content.push(section);
    }
    if(!query && !shown.length) content.push(text('p', '这个小节暂无学习记忆。', 'muted'));
    el('items').replaceChildren(...content);
  }
  async function detail(item, focus = true) {
    const request = ++detailEpoch; selectedId = item.id;
    view.querySelectorAll('.memory-item-open').forEach(node => node.classList.toggle('selected', node.dataset.memoryId === selectedId));
    const panel = el('detail'); panel.replaceChildren(text('p', '正在读取…', 'muted')); panel.hidden = false;
    panel.removeAttribute('data-detail-id'); panel.setAttribute('aria-busy', 'true');
    try {
      item = (await api(base(item))).item;
      if(request !== detailEpoch || view.hidden) return;
      panel.replaceChildren(); panel.dataset.detailId = item.id; panel.setAttribute('aria-busy', 'false');
      const head = text('div', '', 'memory-detail-header'), identity = text('div');
      identity.append(text('h2', titleOf(item)), sourceIdentity(item));
      const sourceReturn = button('返回来源', async () => {
        sourceReturn.disabled = true;
        try { const fresh = (await api(base(item))).item; if(request !== detailEpoch || view.hidden) return; close(false); await returnToSource(fresh); }
        catch(error) { enterView(); view.hidden = false; el('status').textContent = error.message; }
        finally { sourceReturn.disabled = false; }
      });
      const remove = button('移出学习记忆', async () => {
        remove.disabled = true;
        try {
          await api(base(item), {method:'DELETE'}); selectedId = null; await refresh();
          if(items.some(entry => entry.book_id === selectedBookId)) {
            const available = items.filter(entry => entry.book_id === selectedBookId).map(sectionKey);
            if(!available.includes(selectedSectionId)) selectedSectionId = available[0];
            renderBook();
          } else showHome(true);
          announce('已移出，原内容保留。');
        } catch(error) { el('status').textContent = error.message; remove.disabled = false; }
      });
      const more = text('details', '', 'memory-more');
      const trigger = text('summary', '···'); trigger.setAttribute('aria-label', '更多操作');
      const menu = text('div', '', 'memory-more-menu');
      if(hasTechnicalReviewFailure(item)) menu.append(text('p', '审查暂不可用', 'memory-technical-review'));
      menu.append(remove); more.append(trigger, menu);
      const actions = text('div', '', 'memory-detail-actions'); actions.append(sourceReturn, more);
      head.append(identity, actions); panel.append(head);
      const body = text('div', '', 'memory-detail-body');
      const review = reviewOf(item); if(review) body.append(text('p', review.text, `memory-review-status ${review.tone}`));
      const answer = text('div', '', 'memory-answer assistant-answer-bubble'); renderAssistantAnswer(answer, bodyOf(item));
      body.append(answer); panel.append(body);
      if(focus) { head.tabIndex = -1; head.focus({preventScroll:true}); }
    } catch(error) {
      if(request === detailEpoch && !view.hidden) {
        panel.setAttribute('aria-busy', 'false'); panel.replaceChildren(text('p', error.message), button('重试读取', () => detail(item, focus)));
      }
    }
  }
  function closeSearch() { el('search').hidden = true; el('search-toggle').setAttribute('aria-expanded', 'false'); }
  async function open() {
    const request = ++pageEpoch; ++detailEpoch; enterView(); view.hidden = false; el('status').textContent = '正在读取…';
    try { await refresh(); if(request === pageEpoch && !view.hidden) showHome(true); }
    catch (error) { if(request === pageEpoch) el('status').textContent = error.message; }
  }
  function close(focus = true) { ++pageEpoch; ++detailEpoch; view.hidden = true; leaveView(); if (focus) entry.focus(); }
  el('back-books').onclick = () => showHome(true);
  el('search-toggle').onclick = () => {
    const opening = el('search').hidden;
    el('search').hidden = !opening; el('search-toggle').setAttribute('aria-expanded', String(opening));
    if(opening) el('query').focus(); else { el('query').value = ''; renderBook(); }
  };
  el('query').oninput = () => renderBook();
  el('query').onkeydown = event => {
    if(event.key === 'Escape') { event.preventDefault(); el('query').value = ''; closeSearch(); renderBook(); el('search-toggle').focus(); }
  };
  const entry = button('学习记忆', open); entry.className = 'memory-open';
  document.querySelector('.home-toolbar').append(entry);
  return { control, refresh, open, close };
}
