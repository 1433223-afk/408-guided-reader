import { renderAssistantAnswer } from '/assistant-render.js';

const REVIEW = { NOT_REQUESTED: '未独立审查', PENDING: '待 AI 审查', PASS: '通过有界 AI 审查', FAIL: 'AI 审查未通过', TECHNICAL_FAILURE: 'AI 审查技术失败' };

export function createMemoryUI({ api, announce, returnToSource }) {
  let items = [];
  let loading = null;
  let version = 0;
  const controls = new Set();
  const dialog = document.createElement('dialog');
  dialog.id = 'learning-memory';
  dialog.setAttribute('aria-labelledby', 'memory-title');
  dialog.innerHTML = `<header><h2 id="memory-title">学习记忆</h2><button type="button" id="memory-close">关闭</button></header>
    <p>仅收录你明确选择的回答。收录不代表教材事实、审查通过或已经掌握；移出不删除原内容。</p>
    <div class="memory-filters"><label>教材 <select id="memory-book"></select></label><label>Section <select id="memory-section"></select></label><label>知识点 <select id="memory-kp"></select></label><button id="memory-refresh" type="button">刷新</button></div>
    <p id="memory-status" role="status"></p><div id="memory-list"></div><div id="memory-detail" hidden></div>`;
  document.body.append(dialog);
  const el = id => dialog.querySelector(`#memory-${id}`);
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
      entry.node.textContent = entry.item ? '移出学习记忆' : '收入学习记忆';
    }
  }
  async function refresh() {
    if (!loading) loading = api('/api/memory').then(result => { items = result.items; updateControls(); }).finally(() => { loading = null; });
    await loading;
  }
  function control(revision, kind, id) {
    const entry = { revision, kind, id, item: null };
    const node = button('收入学习记忆', async () => {
      // Bind intent to the affordance actually clicked. A lost POST response or
      // another tab's collection must never turn a collect retry into deletion.
      const removal = entry.item;
      node.disabled = true;
      try {
        if (removal) await api(base(removal), { method: 'DELETE' });
        else await api(`/api/revisions/${revision}/memory`, { method: 'POST', body: JSON.stringify({ source_kind: kind, source_id: id }) });
        await refresh();
        announce(removal ? '已移出学习记忆，原内容保留。' : '已收入学习记忆。');
      } catch (error) { announce(error.message, true); }
      finally { node.disabled = false; }
    });
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
      card.append(text('strong', item.source_kind === 'MASTER' ? 'Master 回答' : 'Assistant · 已保存笔记'));
      card.append(text('p', source.question || source.provenance?.answer_question || source.provenance?.child_focus || source.provenance?.root_focus || '原问题未记录'));
      card.append(text('p', REVIEW[source.review_state || source.verification_state] || '审查状态未知'));
      card.append(button('查看原回答', () => detail(item)));
      return card;
    }));
  }
  async function detail(item) {
    const request = ++version;
    try {
      item = (await api(base(item))).item;
      if (request !== version || !dialog.open) return;
      const s = item.source;
      const panel = el('detail'); panel.replaceChildren(); el('list').hidden = true; panel.hidden = false;
      panel.append(button('返回列表', () => { ++version; render(); }));
      panel.append(text('h3', item.source_kind === 'MASTER' ? 'Master 原回答' : 'Assistant 已保存解释'));
      panel.append(text('p', `${item.book_title} / ${item.section?.title || '未关联 Section'} / ${item.knowledge_point?.title || '未关联知识点'}`));
      panel.append(text('p', `审查：${REVIEW[s.review_state || s.verification_state] || '未知'}。这不是掌握证明。`));
      if (s.detail || s.review_summary) panel.append(text('p', s.detail || s.review_summary));
      const reviewer = s.reviewer_provider || s.review_provider;
      if (reviewer) panel.append(text('p', `审查模型：${reviewer} / ${s.reviewer_model || s.review_model || '未记录'}`));
      if (s.review_failure_kind || s.review_code) panel.append(text('p', `审查失败信息：${s.review_failure_kind || ''} ${s.review_code || ''}`));
      panel.append(text('h4', '原问题 / 解释焦点'));
      panel.append(text('p', s.question || s.provenance?.answer_question || s.provenance?.child_focus || s.provenance?.root_focus || '原问题未记录', 'memory-question'));
      if (item.source_kind === 'AI_SAVED') {
        panel.append(text('h4', '教材来源（SOURCE）'), text('p', `PDF 第 ${s.pdf_page_index + 1} 页 · ${s.anchor_state === 'OK' ? '原始锚点' : '锚点需检查'}`), text('blockquote', s.quote));
        panel.append(text('h4', '解释路径（PROVENANCE）'), text('p', (s.provenance?.concept_path || []).join(' › ')));
      } else {
        panel.append(text('p', `原话题：${s.topic?.state === 'RESOLVED' ? '已解决' : s.topic?.state === 'ACTIVE' ? '待解决' : '状态未记录'} · 回答时间：${new Date(s.created_at).toLocaleString('zh-CN')}`));
        panel.append(text('p', '来源为持久 Master 学习上下文；没有精确 PDF 选区锚点。'));
        if (s.provider) panel.append(text('p', `回答模型：${s.provider} / ${s.model}`));
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
        try { const fresh = (await api(base(item))).item; dialog.close(); await returnToSource(fresh); }
        catch (error) { if (!dialog.open) dialog.showModal(); el('status').textContent = error.message; }
      }));
      panel.append(button('移出学习记忆', async () => {
        try { await api(base(item), { method: 'DELETE' }); await refresh(); render(); announce('已移出，原内容保留。'); }
        catch (error) { el('status').textContent = error.message; }
      }));
    } catch (error) { el('status').textContent = error.message; }
  }
  async function open() {
    dialog.showModal(); el('status').textContent = '正在读取学习记忆…';
    try { await refresh(); render(); } catch (error) { el('status').textContent = error.message; }
  }
  el('close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { ++version; });
  el('refresh').onclick = async () => { ++version; try { await refresh(); render(); } catch (error) { el('status').textContent = error.message; } };
  for (const id of ['book', 'section', 'kp']) el(id).onchange = () => { ++version; render(); };
  for (const host of [document.querySelector('.home-toolbar'), document.querySelector('.reader-controls')]) {
    const entry = button('学习记忆', open); entry.className = 'memory-open'; host.append(entry);
  }
  return { control, refresh };
}
