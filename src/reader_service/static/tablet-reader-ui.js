import { createTabletToolRail } from './tablet-tool-rail.js';
import { INK_PALETTE } from './tablet-ink-store.js';

// Presentation only: original Reader controls retain their IDs and handlers.
export function installTabletReaderUI(reader, {section = () => null, openGuide = () => {}, layout = update => update(), inkAction = () => {}} = {}) {
  const find = id => document.getElementById(id);
  const toolbar = reader.querySelector('.toolbar');
  const tools = document.createElement('nav');
  tools.id = 'tablet-reader-tools'; tools.className = 'tablet-reader-tools'; tools.setAttribute('aria-label', '阅读工具');
  const icons = {
    directory:'<path d="M4 5h16M4 12h16M4 19h16"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    notes:'<path d="M5 3h14v12l-5 6H5zM14 21v-6h5M8 8h8M8 12h5"/>',
    region:'<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M9 12h6m-3-3v6"/>',
    knowledge:'<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="6" cy="20" r="2"/><path d="m7 7 3 3m4-1 3-2m-7 7-3 4"/>',
    guide:'<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v15"/>',
    teaching:'<path d="M5 5h14M5 19h14M12 8l1.3 2.7L16 12l-2.7 1.3L12 16l-1.3-2.7L8 12l2.7-1.3z"/>',
    ai:'<path d="M4 4h16v12H9l-5 4zM8 9h8M8 12h5"/>',
    pen:'<path d="m4 20 4-1 13-13-3-3L5 16zM15 6l3 3"/>',
    eraser:'<path d="m4 14 9-10 8 7-9 10H9zM9 9l8 7M12 21h9"/>',
    undo:'<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    redo:'<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>',
    color:'<circle cx="12" cy="12" r="8"/>',
    width:'<path d="M4 6h16M4 12h16M4 19h16"/>',
    exit:'<path d="m5 12 4 4L20 5M5 21h15"/>',
    test:'<path d="M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 15h8"/>',
  };
  function label(id, text, icon) {
    const button = find(id), badge = button.querySelector('.marks-count');
    button.replaceChildren();
    const name = document.createElement('span'); name.className = 'tablet-tool-label'; name.textContent = text;
    button.append(name); if (badge) button.append(badge);
    button.setAttribute('aria-label', text);
    if (icon) decorate(button, icon);
  }
  function decorate(button, icon) {
    // A pseudo-element survives textContent updates from the shared task UI.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[icon]}</svg>`;
    button.style.setProperty('--tablet-tool-icon', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  label('outline-toggle', '目录', 'directory'); label('search-toggle', '搜索', 'search');
  label('marks-toggle', '笔记', 'notes'); label('visual-select-toggle', '框选', 'region');
  decorate(find('reader-kp-action'), 'knowledge'); decorate(find('inline-open'), 'teaching');
  decorate(find('assistant-toggle'), 'ai');
  const guide = document.createElement('button'); guide.id = 'tablet-guide-open'; guide.type = 'button';
  guide.textContent = '导读'; guide.setAttribute('aria-controls', 'guide-panel'); decorate(guide, 'guide');
  guide.addEventListener('click', () => openGuide());
  const syncContext = () => {
    const current = section(), open = !find('guide-panel').hidden;
    guide.disabled = !current && !open; guide.setAttribute('aria-expanded', String(open));
    guide.title = current ? `本节导读 · ${current.title}` : '请先进入已确定范围的小节';
  };
  reader.append(guide);
  const inkToggle = document.createElement('button'); inkToggle.id = 'tablet-ink-toggle'; inkToggle.type = 'button';
  inkToggle.textContent = '批注'; decorate(inkToggle, 'pen');
  inkToggle.title = '进入手写批注；阅读模式仍可用笔选字';
  inkToggle.addEventListener('click', () => inkAction('enabled', true));
  reader.append(inkToggle);
  for (const [name, ids] of [
    ['导航', ['outline-toggle','search-toggle']],
    ['学习工具', ['reader-kp-action','tablet-guide-open','inline-open']],
    ['原文标注', ['marks-toggle','visual-select-toggle','tablet-ink-toggle']],
  ]) {
    const group = document.createElement('div'); group.className = 'tablet-tool-group';
    group.setAttribute('role','group'); group.setAttribute('aria-label', name);
    for (const id of ids) group.append(find(id)); tools.append(group);
  }
  const ai = document.createElement('div'); ai.className = 'tablet-ai-slot';
  ai.append(find('assistant-toggle')); tools.append(ai); reader.append(tools);
  const inkTools = document.createElement('div'); inkTools.className = 'tablet-ink-tools'; inkTools.hidden = true;
  inkTools.setAttribute('role','group'); inkTools.setAttribute('aria-label','手写批注');
  const inkButton = (id, text, icon, action) => {
    const button = document.createElement('button'); button.id = `tablet-ink-${id}`; button.type = 'button';
    button.textContent = text; decorate(button,icon); button.addEventListener('click',action); inkTools.append(button); return button;
  };
  const pen = inkButton('pen','写字','pen',() => inkAction('tool','pen'));
  const eraser = inkButton('eraser','整笔擦','eraser',() => inkAction('tool','eraser'));
  const color = inkButton('color','颜色','color',() => showChoices('color'));
  const width = inkButton('width','中笔','width',() => showChoices('width'));
  const undo = inkButton('undo','撤销','undo',() => inkAction('undo'));
  const redo = inkButton('redo','重做','redo',() => inkAction('redo'));
  inkButton('test','笔测试','test',() => window.open('/tablet-pen-check.html','_blank','noopener'));
  inkButton('exit','完成','exit',() => inkAction('enabled',false)).title = '退出手写，恢复笔选字';
  tools.append(inkTools);
  const choices = document.createElement('div'); choices.className = 'tablet-ink-choices'; choices.hidden = true;
  choices.id = 'tablet-ink-choices';
  choices.setAttribute('role','group'); reader.append(choices);
  for (const button of [color,width]) {
    button.setAttribute('aria-controls',choices.id); button.setAttribute('aria-expanded','false');
  }
  let inkState = {enabled:false,color:'#252923',width:.0025};
  function hideChoices() {
    choices.hidden = true;
    color.setAttribute('aria-expanded','false'); width.setAttribute('aria-expanded','false');
  }
  function showChoices(kind) {
    if (!choices.hidden && choices.dataset.kind === kind) {hideChoices(); return;}
    hideChoices(); choices.dataset.kind = kind;
    choices.replaceChildren(); choices.hidden = false; choices.setAttribute('aria-label',kind === 'color' ? '笔迹颜色' : '笔迹粗细');
    (kind === 'color' ? color : width).setAttribute('aria-expanded','true');
    const heading = document.createElement('span'); heading.className = 'tablet-ink-choice-title';
    heading.textContent = kind === 'color' ? '笔迹颜色' : '笔迹粗细'; choices.append(heading);
    const values = kind === 'color' ? INK_PALETTE.map(item => [item.name,item.color])
      : [['细笔',.0013],['中笔',.0025],['粗笔',.0045]];
    for (const [text,value] of values) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.setAttribute('aria-pressed', String(inkState[kind] === value));
      button.dataset.value = String(value);
      if (kind === 'color') button.style.setProperty('--ink-color',value);
      button.addEventListener('click',() => {inkAction(kind,value); hideChoices();}); choices.append(button);
    }
    const bounds = (kind === 'color' ? color : width).getBoundingClientRect(), parent = reader.getBoundingClientRect();
    choices.style.top = `${Math.max(8,Math.min(bounds.top-parent.top, parent.height-choices.offsetHeight-12))}px`;
    choices.querySelector('button').focus({preventScroll:true});
  }
  document.addEventListener('pointerdown',event => {
    if (!choices.contains(event.target) && event.target !== color && event.target !== width) hideChoices();
  }, true);
  document.addEventListener('keydown',event => {if (event.key === 'Escape') hideChoices();});
  const save = document.createElement('div'); save.className = 'tablet-ink-save'; save.hidden = true;
  const saveStatus = document.createElement('span'); saveStatus.id = 'tablet-ink-save-status'; saveStatus.setAttribute('role','status');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '重试'; retry.hidden = true;
  retry.addEventListener('click',() => inkAction('retry')); save.append(saveStatus,retry); reader.append(save);
  reader.querySelector('.reader-controls').append(reader.querySelector('.zoom-control'));
  const reveal = document.createElement('button'); reveal.id = 'tablet-tools-reveal'; reveal.type = 'button';
  reveal.textContent = '工具'; reveal.title = '显示或收起阅读工具'; reveal.setAttribute('aria-controls', tools.id);
  reader.querySelector('.reader-controls').append(reveal);
  const menu = find('reading-display-menu');
  const zoom = document.createElement('div'); zoom.className = 'tablet-zoom-stepper';
  const caption = document.createElement('span'); caption.textContent = '缩放';
  zoom.append(caption, find('zoom-out'), find('zoom-in')); menu.prepend(zoom);
  const management = document.createElement('div'); management.className = 'tablet-reading-details';
  for (const id of ['printed-page-edit','preparation-status']) management.append(find(id));
  menu.append(management);
  // Keep legacy reopening state private; the rail opens the current section.
  find('reader-more-menu').append(find('guide-reopen'));
  find('reader-more').hidden = true;
  find('reading-portrait')?.closest('label')?.remove();
  reader.append(find('inline-status'));
  reader.querySelector('.inline-toolbar').hidden = true;
  syncContext();
  new MutationObserver(syncContext).observe(find('guide-panel'), {attributes:true, attributeFilter:['hidden']});
  const idle = createTabletToolRail({reader, tools, toggle:reveal, layout});
  function syncInk(value) {
    const modeChanged = inkState.enabled !== value.enabled;
    inkState = value; inkTools.hidden = !value.enabled;
    for (const node of tools.children) if (node !== inkTools) node.hidden = value.enabled;
    pen.setAttribute('aria-pressed',String(value.tool === 'pen'));
    eraser.setAttribute('aria-pressed',String(value.tool === 'eraser'));
    const colorName = INK_PALETTE.find(item => item.color === value.color)?.name || '黑色';
    color.style.setProperty('--ink-color', value.color);
    color.setAttribute('aria-label', `选择笔迹颜色，当前${colorName}`); color.title = `选择笔迹颜色 · 当前${colorName}`;
    width.textContent = value.width <= .0013 ? '细笔' : value.width >= .0045 ? '粗笔' : '中笔';
    undo.disabled = !value.canUndo; redo.disabled = !value.canRedo;
    reveal.textContent = value.enabled ? '手写' : '工具';
    reveal.dataset.ink = value.error ? 'error' : value.pending ? 'pending' : value.enabled ? 'ready' : '';
    reveal.setAttribute('aria-label',value.enabled ? '显示或收起手写工具' : '显示或收起阅读工具');
    save.hidden = !value.enabled && !value.pending && !value.error;
    save.dataset.state = value.error ? 'error' : value.pending ? 'pending' : 'saved';
    saveStatus.textContent = value.error ? `${value.pending ? '笔迹待保存 · ' : ''}${value.error}` : value.drawing ? '手写中' : value.pending
      ? (value.saving ? `正在保存 · ${value.pending}` : `待保存 · ${value.pending}`) : '笔迹已保存';
    retry.hidden = !value.error && !(value.pending && !value.saving);
    if (modeChanged) {hideChoices(); idle.refresh();}
  }
  return {tools, syncContext, syncInk, refresh:idle.refresh};
}
