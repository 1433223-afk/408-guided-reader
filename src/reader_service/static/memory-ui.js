import { renderAssistantAnswer } from '/assistant-render.js';

const REVIEW = { NOT_REQUESTED: '未独立审查', PENDING: '待 AI 审查', PASS: '通过有界 AI 审查', FAIL: 'AI 审查未通过', TECHNICAL_FAILURE: 'AI 审查技术失败' };

export function createMemoryUI({ api, announce, returnToSource, enterView = () => {}, leaveView = () => {} }) {
  let items = [];
  let loading = null;
  let version = 0;
  const controls = new Set();
  const view = document.createElement('section');
  view.id = 'learning-memory'; view.hidden = true;
  view.setAttribute('aria-labelledby', 'memory-title');
  view.innerHTML = `<header class="home-toolbar"><div class="brand"><div class="brand-mark" aria-hidden="true">408</div><div><strong>Guided Reader</strong><span>始终阅读原始 PDF。</span></div></div><button type="button" id="memory-close">← 书库</button></header>
    <main class="memory-page-content"><div class="memory-heading"><p class="eyebrow">保留有用的回答，回到当时的学习。</p><h1 id="memory-title" tabindex="-1">学习记忆</h1></div>
    <p class="memory-intro">这里汇集你主动收入的 Master 回答和已保存的 Assistant 解释。</p>
    <div class="memory-collection"><p class="memory-boundary">收录不代表教材事实、审查通过或已经掌握；移出不删除原内容。</p>
    <div class="memory-filters"><label>教材 <select id="memory-book"></select></label><label>Section <select id="memory-section"></select></label><label>知识点 <select id="memory-kp"></select></label><button id="memory-refresh" type="button">刷新</button></div>
    <p id="memory-status" role="status"></p><div id="memory-list"></div><div id="memory-detail" hidden></div></div></main>`;
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
    el('detail').hidden = true; el('list').hidden = false;
    options(el('book'), items.map(i => [i.book_id, i.book_title]), '全部教材');
    let shown = items.filter(i => !el('book').value || i.book_id === el('book').value);
    options(el('section'), shown.map(i => [i.section?.id || 'unassociated', i.section?.title || '未关联 Section']), '全部 Section');
    shown = shown.filter(i => !el('section').value || (i.section?.id || 'unassociated') === el('section').value);
    options(el('kp'), shown.map(i => [i.knowledge_point?.id || 'unassociated', i.knowledge_point?.title || '未关联知识点']), '全部知识点');
    shown = shown.filter(i => !el('kp').value || (i.knowledge_point?.id || 'unassociated') === el('kp').value);
    el('status').textContent = shown.length ? `${shown.length} 条学习记忆` : '暂无收录。可从已完成的 Master 回答或已保存的 AI 笔记收入学习记忆。';
    el('list').replaceChildren(...shown.map(item => {
      const card = document.createElement('article'); card.className = 'memory-card'; card.dataset.memoryId = item.id;
      const source = item.source;
      card.append(text('p', `${item.book_title} / ${item.section?.title || '未关联 Section'} / ${item.knowledge_point?.title || '未关联知识点'}`, 'memory-meta'));
      card.append(text('strong', item.source_kind === 'MASTER' ? 'Master 回答' : 'Assistant · 已保存笔记', `memory-source-label memory-source-${item.source_kind.toLowerCase()}`));
      card.append(text('p', source.question || source.provenance?.answer_question || source.provenance?.child_focus || source.provenance?.root_focus || '原问题未记录', 'memory-card-question'));
      const review = source.review_state || source.verification_state;
      card.append(text('p', REVIEW[review] || '审查状态未知', `memory-trust mark-verification-${review?.toLowerCase()}`));
      card.append(button('查看原回答', () => detail(item)));
      return card;
    }));
  }
  async function detail(item) {
    const request = ++version;
    try {
      item = (await api(base(item))).item;
      if (request !== version || view.hidden) return;
      const s = item.source;
      const panel = el('detail'); panel.replaceChildren(); el('list').hidden = true; panel.hidden = false;
      panel.append(button('返回列表', () => { ++version; render(); }));
      panel.append(text('h3', item.source_kind === 'MASTER' ? 'Master 原回答' : 'Assistant 已保存解释'));
      panel.append(text('p', `${item.book_title} / ${item.section?.title || '未关联 Section'} / ${item.knowledge_point?.title || '未关联知识点'}`, 'memory-meta'));
      const review = s.review_state || s.verification_state;
      panel.append(text('p', `审查：${REVIEW[review] || '未知'}。这不是掌握证明。`, `memory-trust mark-verification-${review?.toLowerCase()}`));
      if (s.detail || s.review_summary) panel.append(text('p', s.detail || s.review_summary, 'memory-review-summary'));
      const reviewer = s.reviewer_provider || s.review_provider;
      if (reviewer) panel.append(text('p', `审查模型：${reviewer} / ${s.reviewer_model || s.review_model || '未记录'}`, 'memory-meta'));
      if (s.review_failure_kind || s.review_code) panel.append(text('p', `审查失败信息：${s.review_failure_kind || ''} ${s.review_code || ''}`, 'memory-meta'));
      panel.append(text('h4', '原问题 / 解释焦点'));
      panel.append(text('p', s.question || s.provenance?.answer_question || s.provenance?.child_focus || s.provenance?.root_focus || '原问题未记录', 'memory-question'));
      if (item.source_kind === 'AI_SAVED') {
        panel.append(text('h4', '教材来源（SOURCE）'), text('p', `PDF 第 ${s.pdf_page_index + 1} 页 · ${s.anchor_state === 'OK' ? '原始锚点' : '锚点需检查'}`), text('blockquote', s.quote));
        panel.append(text('h4', '解释路径（PROVENANCE）'), text('p', (s.provenance?.concept_path || []).join(' › ')));
      } else {
        panel.append(text('p', `原话题：${s.topic?.state === 'RESOLVED' ? '已解决' : s.topic?.state === 'ACTIVE' ? '待解决' : '状态未记录'} · 回答时间：${new Date(s.created_at).toLocaleString('zh-CN')}`, 'memory-meta'));
        panel.append(text('p', '来源为持久 Master 学习上下文；没有精确 PDF 选区锚点。', 'memory-meta'));
        if (s.provider) panel.append(text('p', `回答模型：${s.provider} / ${s.model}`, 'memory-meta'));
      }
      panel.append(text('h4', 'AI 正文（AI CONTENT）'));
      const answer = document.createElement('div'); answer.className = 'memory-answer assistant-answer-bubble';
      const original = item.source_kind === 'MASTER' ? s.content : s.body;
      renderAssistantAnswer(answer, original); panel.append(answer);
      const fullText = document.createElement('details');
      fullText.className = 'memory-original';
      fullText.append(text('summary', '查看完整原文（含 Markdown 标记）'), text('pre', original));
      panel.append(fullText);
      panel.append(button(item.source_kind === 'MASTER' ? '回到 Master 上下文' : '回到笔记 / PDF 来源', async () => {
        try { const fresh = (await api(base(item))).item; close(false); await returnToSource(fresh); }
        catch (error) { enterView(); view.hidden = false; el('status').textContent = error.message; }
      }));
      panel.append(button('移出学习记忆', async () => {
        try { await api(base(item), { method: 'DELETE' }); await refresh(); render(); announce('已移出，原内容保留。'); }
        catch (error) { el('status').textContent = error.message; }
      }));
    } catch (error) { el('status').textContent = error.message; }
  }
  async function open() {
    const request = ++version;
    el('list').replaceChildren(); el('detail').hidden = true;
    enterView(); view.hidden = false; view.scrollTop = 0;
    el('title').focus(); el('status').textContent = '正在读取学习记忆…';
    try { await refresh(); if (request === version && !view.hidden) render(); }
    catch (error) { if (request === version) el('status').textContent = error.message; }
  }
  function close(focus = true) {
    ++version; view.hidden = true; leaveView();
    if (focus) entry.focus();
  }
  el('close').onclick = () => close();
  el('refresh').onclick = async () => { ++version; try { await refresh(); render(); } catch (error) { el('status').textContent = error.message; } };
  for (const id of ['book', 'section', 'kp']) el(id).onchange = () => { ++version; render(); };
  const entry = button('学习记忆', open); entry.className = 'memory-open';
  document.querySelector('.home-toolbar').append(entry);
  return { control, refresh };
}
