// Navigation metadata only. Conversations remain owned by the service.
export function createAssistantNavigator(panel, focus) {
  const body = document.createElement('div'); body.className = 'assistant-workspace-body';
  const sidebar = document.createElement('nav'); sidebar.className = 'assistant-topic-sidebar';
  sidebar.setAttribute('aria-label', '解释主题');
  const title = document.createElement('strong'); title.textContent = '解释主题';
  const tree = document.createElement('div'); tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', '解释主题层级'); sidebar.append(title, tree);
  const main = document.createElement('div'); main.className = 'assistant-conversation';
  for (const id of ['assistant-context-bar','assistant-children','assistant-scope','assistant-first-turn','assistant-turns','assistant-empty','assistant-follow-up']) main.append(document.getElementById(id));
  body.append(sidebar, main); panel.append(body);
  const trigger = document.createElement('button'); trigger.type = 'button';
  trigger.id = 'assistant-topic-trigger'; trigger.setAttribute('aria-expanded', 'false');
  panel.querySelector('.assistant-heading-title').append(trigger);
  const collapsed = new Set();
  let snapshot;
  function close() { body.classList.remove('topics-open'); trigger.setAttribute('aria-expanded','false'); }
  trigger.onclick = () => { const open = body.classList.toggle('topics-open'); trigger.setAttribute('aria-expanded', String(open)); };
  document.addEventListener('pointerdown', e => { if (!sidebar.contains(e.target) && !trigger.contains(e.target)) close(); });
  tree.onkeydown = e => {
    const rows = [...tree.querySelectorAll('[role=treeitem]')]; const i = rows.indexOf(document.activeElement);
    let next;
    if (e.key === 'ArrowDown') next = Math.min(i + 1, rows.length - 1);
    if (e.key === 'ArrowUp') next = Math.max(i - 1, 0);
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = rows.length - 1;
    if (next !== undefined) { e.preventDefault(); rows[next]?.focus(); }
    if (e.key === 'Escape' && !panel.closest('.assistant-expanded')) { close(); trigger.focus(); }
    if (['ArrowLeft','ArrowRight'].includes(e.key) && i >= 0) {
      e.preventDefault(); const row = rows[i]; const key = row.dataset.key;
      if (row.hasAttribute('aria-expanded') && (e.key === 'ArrowLeft') !== collapsed.has(key)) {
        if (e.key === 'ArrowLeft') collapsed.add(key); else collapsed.delete(key);
        render(snapshot, false); [...tree.querySelectorAll('[role=treeitem]')].find(r => r.dataset.key === key)?.focus();
      } else if (e.key === 'ArrowRight') rows[i + 1]?.focus();
      else rows.slice(0, i).reverse().find(r => Number(r.getAttribute('aria-level')) < Number(row.getAttribute('aria-level')))?.focus();
    }
  };
  function render(state, reveal = true) {
    const focusedKey = tree.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const liveKeys = new Set((state.roots || []).flatMap(root =>
      [`${root.root_id}:`, ...(root.nodes || []).map(node => `${root.root_id}:${node.node_id}`)]));
    for (const key of collapsed) if (!liveKeys.has(key)) collapsed.delete(key);
    snapshot = state;
    const current = state.current;
    trigger.textContent = current?.label || '解释主题'; trigger.title = current?.label || '解释主题';
    if (reveal) for (const crumb of current?.breadcrumb || []) collapsed.delete(`${crumb.root_id}:${crumb.node_id || ''}`);
    const fragment = document.createDocumentFragment();
    function row(root, node, depth) {
      const id = node?.node_id || ''; const key = `${root.root_id}:${id}`;
      const children = (root.nodes || []).filter(n => (n.parent_ref?.node_id || '') === id);
      const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role','treeitem');
      item.dataset.rootId = root.root_id; item.dataset.nodeId = id; item.dataset.key = key;
      item.setAttribute('aria-level', String(depth));
      const selected = current?.root_id === root.root_id && (current.node_id || '') === id;
      item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
      if(children.length) item.setAttribute('aria-expanded', String(!collapsed.has(key)));
      item.style.paddingInlineStart = `${12 + (depth - 1) * 24}px`;
      item.style.setProperty('--branch-inset', `${12 + (depth - 2) * 24 + 5}px`);
      const caret = document.createElement('span'); caret.textContent = children.length ? collapsed.has(key) ? '+' : '−' : '·'; caret.setAttribute('aria-hidden','true');
      const label = document.createElement('span'); label.textContent = node?.label || root.label;
      item.title = label.textContent; item.append(caret, label);
      if(node?.pending) item.setAttribute('aria-busy','true');
      item.onclick = e => {
        if(e.target === caret && children.length) { collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key); render(state, false); }
        else { close(); if (!panel.closest('.assistant-expanded')) trigger.focus(); focus(root.root_id, id || null); }
      };
      fragment.append(item);
      if (!collapsed.has(key)) children.forEach(child => row(root, child, depth + 1));
    }
    (state.roots || []).forEach(root => row(root, null, 1)); tree.replaceChildren(fragment);
    if (!tree.querySelector('[tabindex="0"]')) tree.firstElementChild?.setAttribute('tabindex','0');
    if (focusedKey) [...tree.querySelectorAll('[role=treeitem]')].find(item => item.dataset.key === focusedKey)?.focus();
  }
  return {render};
}
