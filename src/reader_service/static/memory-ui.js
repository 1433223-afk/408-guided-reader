import {header, action} from "/screens.js";
import { renderAssistantAnswer } from '/assistant-render.js';

const REVIEW = { NOT_REQUESTED: '未独立审查', PENDING: '待 AI 审查', PASS: '通过有界 AI 审查', FAIL: 'AI 审查未通过', TECHNICAL_FAILURE: 'AI 审查技术失败' };

export function createMemoryUI({ api, announce, returnToSource, enterView = () => {}, leaveView = () => {}, home = () => {}, resume = () => {} }) {
  let items = [];
  let loading = null;
  let version = 0, selectedId = null;
  const controls = new Set();
  const view = document.createElement('section');
  view.id = 'learning-memory'; view.hidden = true;
  view.setAttribute('aria-labelledby', 'memory-title');
  view.innerHTML = `<main class="memory-page-content"><div class="memory-heading"><div><p class="eyebrow">LEARNING MEMORY</p><h1 id="memory-title" tabindex="-1">学习记忆</h1></div><div><button id="memory-find" type="button" aria-expanded="false">查找</button><button id="memory-filter-toggle" type="button" aria-expanded="false">筛选</button></div></div>
    <p class="memory-intro">你主动留下的重要解释与学习结论。这里不会自动替你建立学习画像。</p>
    <div class="memory-collection"><div class="memory-filters" hidden><label>教材 <select id="memory-book"></select></label><label>小节 <select id="memory-section"></select></label><label>知识点 <select id="memory-kp"></select></label><label>查找 <input id="memory-query" type="search"></label><button id="memory-refresh" type="button">刷新</button></div>
    <p id="memory-status" role="status"></p><div id="memory-list"></div><div id="memory-detail" hidden></div></div></main>`;
  const returnButton = action('回到阅读', async () => { close(false); await resume(); }); returnButton.id = 'memory-close';
  view.prepend(header('memory', () => {close(false); home();}, () => {}, returnButton));
  document.body.append(view);
  const el = id => view.querySelector(`#memory-${id}`);
  const button = (text, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    node.addEventListener('click', action); return node;
  };
  const text = (tag, value, className = '') => {
    const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
  };
  const base = item => `/api/revisions/${item.book_source_revision_id}/memory/${item.id}`;
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
      // Reader is collect-only. Lost responses retry the same POST; management
      // belongs exclusively to the independent Library-level view.
      if (entry.item) return;
      node.disabled = true;
      try {
        await api(`/api/revisions/${revision}/memory`, { method: 'POST', body: JSON.stringify({ source_kind: kind, source_id: id }) });
        await refresh();
        announce('已收入学习记忆。');
      } catch (error) { announce(error.message, true); }
      finally { node.disabled = Boolean(entry.item); }
    });
    node.className = 'memory-source-control';
    entry.node = node; controls.add(entry);
    queueMicrotask(() => refresh().catch(error => announce(error.message, true)));
    return node;
  }
  function options(select, rows, label) {
    const previous = select.value;
    select.replaceChildren(new Option(label, ''));
    const unique = new Map(rows);
    for (const [id, title] of unique) select.add(new Option(title, id));
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  }
  function render() {
    ++version;
    el('list').hidden = false;
    options(el('book'), items.map(i => [i.book_id, i.book_title]), '全部教材');
    let shown = items.filter(i => !el('book').value || i.book_id === el('book').value);
    options(el('section'), shown.map(i => [i.section?.id || 'unassociated', i.section?.title || '未关联 Section']), '全部 Section');
    shown = shown.filter(i => !el('section').value || (i.section?.id || 'unassociated') === el('section').value);
    options(el('kp'), shown.map(i => [i.knowledge_point?.id || 'unassociated', i.knowledge_point?.title || '未关联知识点']), '全部知识点');
    shown = shown.filter(i => !el('kp').value || (i.knowledge_point?.id || 'unassociated') === el('kp').value);
    const query = el('query').value.trim().toLocaleLowerCase();
    if(query) shown = shown.filter(i => JSON.stringify([i.book_title,i.section?.title,i.knowledge_point?.title,i.source.question,i.source.body,i.source.content]).toLocaleLowerCase().includes(query));
    el('status').textContent = shown.length ? '' : '暂无收录。可从已完成的 Master 回答或已保存的 AI 笔记收入学习记忆。';
    el('list').replaceChildren(...shown.map(item => {
      const card = document.createElement('article'); card.className = `memory-card${item.id === selectedId ? ' selected' : ''}`; card.dataset.memoryId = item.id;
      const source = item.source;
      card.append(text('p', `${item.book_title} / ${item.section?.title || '未关联 Section'} / ${item.knowledge_point?.title || '未关联知识点'}`, 'memory-meta'));
      card.append(text('strong', item.source_kind === 'MASTER' ? 'Master 回答' : 'Assistant · 已保存笔记', `memory-source-label memory-source-${item.source_kind.toLowerCase()}`));
      card.append(text('p', source.question || source.provenance?.answer_question || source.provenance?.child_focus || source.provenance?.root_focus || '原问题未记录', 'memory-card-question'));
      const review = source.review_state || source.verification_state;
      card.append(text('p', REVIEW[review] || '审查状态未知', `memory-trust mark-verification-${review?.toLowerCase()}`));
      card.append(button('查看原回答', () => detail(item)));
      return card;
    }));
    if(shown.length) { const chosen = shown.find(i => i.id === selectedId) || shown[0]; detail(chosen, false); } else el('detail').hidden = true;
  }
  async function detail(item, focus = true) {
    const request = ++version;
    const pendingPanel = el('detail');
    pendingPanel.replaceChildren(text('p', '正在读取原回答…', 'memory-meta'));
    pendingPanel.hidden = false;
    pendingPanel.removeAttribute('data-detail-id');
    pendingPanel.setAttribute('aria-busy', 'true');
    try {
      item = (await api(base(item))).item;
      if(request !== version || view.hidden) return;
      selectedId = item.id;
      view.querySelectorAll('.memory-card').forEach(n => n.classList.toggle('selected', n.dataset.memoryId === selectedId));
      const s = item.source, panel = el('detail'); panel.replaceChildren(); panel.hidden = false; el('list').hidden = false;
      panel.dataset.detailId = item.id;
      panel.setAttribute('aria-busy', 'false');
      const title = s.question || s.provenance?.answer_question || s.provenance?.child_focus || s.provenance?.root_focus || item.knowledge_point?.title || '收录的解释';
      const head = text('div', '', 'memory-detail-header'), identity = text('div');
      identity.append(text('small', item.source_kind === 'MASTER' ? 'Master 学习记录' : '收录的解释'), text('h2', title), text('small', `收录于 ${new Date(item.created_at).toLocaleString('zh-CN')}`, 'memory-meta'));
      const sourceReturn = button(item.source_kind === 'MASTER' ? '回到 Master 上下文' : '回到笔记 / PDF 来源', async () => {
        sourceReturn.disabled = true;
        try { const fresh = (await api(base(item))).item; if(request !== version || view.hidden) return; close(false); await returnToSource(fresh); }
        catch(error) { enterView(); view.hidden = false; el('status').textContent = error.message; }
        finally { sourceReturn.disabled = false; }
      });
      head.append(identity, sourceReturn); panel.append(head);
      const body = text('div', '', 'memory-detail-body'); panel.append(body);
      const source = text('div', '', 'memory-source-block');
      source.append(text('p', '来自教材', 'memory-meta'), text('p', `${item.book_title} · ${item.section?.title || '未关联小节'}`));
      if(item.source_kind === 'AI_SAVED') {
        source.append(text('small', `PDF ${s.pdf_page_index + 1} · ${s.anchor_state === 'OK' ? '原始锚点' : '锚点需检查'}`), text('blockquote', s.quote));
        if(s.provenance?.root_focus) source.append(text('p', `当时在理解：${s.provenance.root_focus}`, 'memory-meta'));
        if(s.provenance?.child_focus) source.append(text('p', `具体问题：${s.provenance.child_focus}`, 'memory-meta'));
      } else source.append(text('p', `当前话题：${s.topic?.state === 'RESOLVED' ? '已解决' : '待解决'} · 历史回答保留`, 'memory-meta'));
      body.append(source);
      const original = item.source_kind === 'MASTER' ? s.content : s.body;
      const answer = text('div', '', 'memory-answer assistant-answer-bubble'); renderAssistantAnswer(answer, original); body.append(answer);
      const review = s.review_state || s.verification_state;
      const provenance = text('details', '', 'memory-original memory-provenance');
      provenance.append(text('summary', `${REVIEW[review] || '审查状态未知'} · 查看来源与审查详情`), text('p', '独立审查结果，不代表教材权威或绝对正确，也不代表已经掌握。', 'memory-meta'));
      if(s.detail || s.review_summary) provenance.append(text('p', s.detail || s.review_summary));
      if(s.reviewer_provider || s.review_provider) provenance.append(text('p', `审查模型：${s.reviewer_provider || s.review_provider} · ${s.reviewer_model || s.review_model || '未记录'}`, 'memory-meta'));
      if(s.review_failure_kind || s.review_code) provenance.append(text('p', `审查失败信息：${s.review_failure_kind || ''} ${s.review_code || ''}`));
      if(item.source_kind === 'AI_SAVED') provenance.append(text('p', `解释路径：${(s.provenance?.concept_path || []).join(' › ')}`, 'memory-meta'));
      else provenance.append(text('p', '来源为持久 Master 学习上下文；没有精确 PDF 选区锚点。', 'memory-meta'));
      body.append(provenance);
      const full = text('details', '', 'memory-original'); full.append(text('summary', '查看完整原文（含 Markdown 标记）'), text('pre', original)); body.append(full);
      const remove = button('移出学习记忆', async () => {
        remove.disabled = true;
        try { await api(base(item), {method:'DELETE'}); selectedId = null; await refresh(); render(); announce('已移出，原内容保留。'); }
        catch(error) { el('status').textContent = error.message; remove.disabled = false; }
      });
      body.append(remove);
      if(focus) { head.tabIndex = -1; head.focus({preventScroll:true}); }
    } catch(error) { if(request === version && !view.hidden) { pendingPanel.setAttribute('aria-busy', 'false'); pendingPanel.replaceChildren(text('p', error.message), button('重试读取', () => detail(item, focus))); } }
  }
  async function open() {
    const request = ++version;
    view.classList.remove('memory-reading');
    el('list').replaceChildren(); el('detail').hidden = true;
    enterView(); view.hidden = false;
    el('title').focus(); el('status').textContent = '正在读取学习记忆…';
    try { await refresh(); if (request === version && !view.hidden) render(); }
    catch (error) { if (request === version) el('status').textContent = error.message; }
  }
  function close(focus = true) {
    ++version; view.hidden = true; leaveView();
    if (focus) entry.focus();
  }
  for(const id of ['find','filter-toggle']) el(id).onclick = () => { const filters = view.querySelector('.memory-filters'); filters.hidden = !filters.hidden; el(id).setAttribute('aria-expanded', String(!filters.hidden)); if(!filters.hidden) el(id === 'find' ? 'query' : 'book').focus(); };
  el('query').oninput = () => render();
  el('refresh').onclick = async () => { ++version; try { await refresh(); render(); } catch (error) { el('status').textContent = error.message; } };
  for (const id of ['book', 'section', 'kp']) el(id).onchange = () => { ++version; render(); };
  const entry = button('学习记忆', open); entry.className = 'memory-open';
  document.querySelector('.home-toolbar').append(entry);
  return { control, refresh, open, close };
}
