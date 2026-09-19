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
      const distance=position===null ? Infinity : Math.abs(i-position);
      button.style.setProperty('--tick-scale',String((position===null ? 14 : Math.max(4,26-distance*7))/26));
      button.toggleAttribute('data-emphasis', i===(position===null ? active : Math.round(position)));
    });
  }
  function dismiss() { preview.hidden = true; buttons.forEach(b => b.removeAttribute('aria-describedby')); emphasize(null); }
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
    if(preview.hidden) emphasize(null);
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
export const GUIDE_MARK = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 20.5V5.5C7 3 11.5 1.5 14 3.5C15.5 4.7 14.8 7.5 14.4 9M3.5 20.5C8 17.3 12 18 18 21"/><path d="M6 13.8C11 10 13.5 18.2 19 13.5"/><circle cx="21" cy="11.5" r="1.5" fill="currentColor" stroke="none"/></svg>`;
export function header(active, home, memory, extra) {
  const h = node('header', '', 'home-toolbar');
  const brand = node('div', '', 'brand'); const mark=node('span', '', 'brand-mark');mark.innerHTML=GUIDE_MARK;mark.setAttribute('aria-hidden','true');brand.append(mark, node('strong', 'Guided Reader'));
  const nav = node('nav', '', 'space-navigation'); nav.setAttribute('aria-label', '学习空间');
  for (const [label, run, key] of [['学习空间', home, 'home'], ['学习记忆', memory, 'memory']]) {
    const b = action(label, run); if (key === active) b.setAttribute('aria-current', 'page'); nav.append(b);
  }
  h.append(brand, nav); if (extra) h.append(extra); return h;
}
// Presentation-only extension seam. A future upload owner can supply its resolved local URL;
// this component neither uploads nor persists assets or changes Book identity.
export const BOOK_COVER_FAMILY = Object.freeze({
  coa: {color:'#304d40', label:'COA'}, ds: {color:'#637e90', label:'DS'},
  os: {color:'#596778', label:'OS'}, cn: {color:'#355e66', label:'CN'},
  grid: {color:'#718278', label:''}, node: {color:'#788b99', label:''},
  layer: {color:'#667866', label:''}, flow: {color:'#727c90', label:''},
  block: {color:'#827d70', label:''}, signal: {color:'#557b7b', label:''},
});
// Optional book.cover = {variant, userCoverUrl}; presentation metadata only, no schema write.
export function resolveBookCoverVariant(book, requested = book.cover?.variant) {
  if (Object.hasOwn(BOOK_COVER_FAMILY, requested)) return requested;
  if (requested === 'fallback') return 'layer'; // Earlier presentation callers remain valid.
  const title = book.title || '';
  for (const [variant, pattern] of [
    ['coa', /计算机组成|computer organization/i], ['ds', /数据结构|data structures?/i],
    ['os', /操作系统|operating systems?/i], ['cn', /计算机网络|computer networks?/i],
  ]) if (pattern.test(title)) return variant;
  // Stable book identity, independent of list order, recency, and thumbnail size.
  let hash = 0;
  for (const character of String(book.id || title)) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return ['grid','node','layer','flow','block','signal'][hash % 6];
}
export function createBookCover(book, className = '', {
  userCoverUrl = book.cover?.userCoverUrl ?? null, defaultVariant = book.cover?.variant,
  density = className.split(/\s+/).includes('book-spine') ? 'small' : 'large',
} = {}) {
  const variant = resolveBookCoverVariant(book, defaultVariant);
  const source = ['coa','ds','os','cn'].includes(variant) ? 'system' : 'fallback';
  const cover = node('div', '', `book-cover ${className}`);
  cover.dataset.coverVariant = variant;
  cover.dataset.coverDensity = density === 'small' ? 'small' : 'large';
  cover.dataset.coverSource = source;
  cover.setAttribute('aria-hidden', 'true');
  const patterns = {
    coa: `<rect x="20" y="38" width="35" height="35" fill="#91a99a"/>
      <rect x="59" y="38" width="21" height="59" fill="#668471"/>
      <rect x="20" y="77" width="35" height="20" fill="#c3cec0"/>
      <path d="M20 108h60M43 108v14M69 108v14" stroke="#91a99a" stroke-width="1"/>
      <rect x="20" y="119" width="11" height="5" fill="#668471"/>`,
    ds: `<path d="M20 40h60M20 60h60M20 80h60M20 100h60M20 120h60M20 40v80M40 40v80M60 40v80M80 40v80" stroke="#b5c8c8" stroke-opacity=".22" stroke-width=".7"/>
      <path d="M40 45v25M40 70H23v27M40 70h30v27M70 97v20" fill="none" stroke="#d9e2d9" stroke-width="1.5"/>
      <g fill="#d9e2d9"><circle cx="40" cy="45" r="5"/><circle cx="40" cy="70" r="4"/><circle cx="23" cy="97" r="5"/><circle cx="70" cy="97" r="5"/><circle cx="70" cy="117" r="3"/></g>`,
    os: `<g fill="#bbc7d0"><rect x="20" y="40" width="60" height="13"/><rect x="20" y="66" width="39" height="13" opacity=".8"/><rect x="20" y="92" width="49" height="13" opacity=".6"/></g>
      <path d="M80 59v59H20M65 72h15M75 98h5" fill="none" stroke="#d8dedf" stroke-width="1.5"/>
      <path d="m25 114-5 4 5 4" fill="none" stroke="#d8dedf"/>`,
    cn: `<path d="M22 47 50 65 77 42M50 65 25 105 78 112 50 65M22 47v58M77 42l1 70" fill="none" stroke="#b2cbd0" stroke-width="1.3"/>
      <g fill="#d2dedd"><rect x="17" y="42" width="10" height="10"/><rect x="72" y="37" width="10" height="10"/><circle cx="50" cy="65" r="7"/><circle cx="25" cy="105" r="5"/><circle cx="78" cy="112" r="5"/></g>`,
    grid: `<path d="M21 42h58v76H21zM21 61h58M21 80h58M21 99h58M40 42v76M60 42v76" fill="none" stroke="#ccd5c9" stroke-width="1"/>
      <rect x="41" y="62" width="18" height="17" fill="#c4d0c0"/><rect x="61" y="100" width="17" height="17" fill="#a4b8a6"/>`,
    node: `<path d="m23 80 28-34 28 34-28 34zM23 80h56M51 46v68" fill="none" stroke="#cdd8de" stroke-width="1.2"/>
      <g fill="#dde4e2"><circle cx="51" cy="46" r="6"/><circle cx="23" cy="80" r="5"/><circle cx="79" cy="80" r="5"/><circle cx="51" cy="114" r="6"/><circle cx="51" cy="80" r="3"/></g>`,
    layer: `<path d="M20 44h44v64H20z" fill="#b8c4b4"/>
      <path d="M32 56h44v64H32z" fill="#8fa18e"/>
      <path d="M44 68h36v52H44z" fill="#d6dccd"/>
      <path d="M51 79h22M51 86h22M51 93h14" stroke="#81927f" stroke-width="1"/>`,
    flow: `<path d="M22 45h27v31h29v39M22 65h14v31h29v19" fill="none" stroke="#d4d9e0" stroke-width="2"/>
      <path d="m73 110 5 5 5-5m-23 0 5 5 5-5" fill="none" stroke="#d4d9e0" stroke-width="1.5"/>
      <g fill="#b1bbcf"><rect x="18" y="41" width="8" height="8"/><rect x="18" y="61" width="8" height="8"/><rect x="45" y="72" width="8" height="8"/></g>`,
    block: `<rect x="20" y="43" width="36" height="36" fill="#d5d2c5"/><rect x="60" y="43" width="20" height="20" fill="#b5b6a7"/>
      <rect x="20" y="83" width="20" height="34" fill="#b5b6a7"/><rect x="44" y="83" width="36" height="34" fill="#c5c6b8"/><path d="M60 68h20v11H60z" fill="#9da99e"/>`,
    signal: `<path d="M20 116h60" stroke="#adc8c5" stroke-opacity=".5"/>
      <path d="M20 83h9V57h10v45h11V42h10v53h10V70h10" fill="none" stroke="#d3e0da" stroke-width="2"/>
      <path d="M20 126h13m5 0h22m5 0h15" stroke="#a9c6bf" stroke-width="2"/>`,
  };
  // Dedicated small artwork: same identity, fewer details at 40–60 px.
  patterns.node = `<path d="M50 80V43m0 37 30-18M50 80l23 31M50 80l-23 31M50 80 20 62" stroke="#cdd8de" stroke-width="2"/>
    <g fill="#dde4e2"><circle cx="50" cy="80" r="12"/><circle cx="50" cy="43" r="5"/><circle cx="80" cy="62" r="5"/><circle cx="73" cy="111" r="5"/><circle cx="27" cy="111" r="5"/><circle cx="20" cy="62" r="5"/></g>`;
  patterns.block = `<path d="M20 91h20v24H20zM40 67h20v48H40zM60 43h20v72H60z" fill="#d5d2c5"/>
    <path d="M40 91h20m0-24h20M60 91h20" stroke="#827d70" stroke-width="3"/>`;
  const smallPatterns = {
    coa: `<path d="M19 38h36v38H19z" fill="#91a99a"/><path d="M60 38h22v65H60z" fill="#668471"/><path d="M19 82h36v21H19z" fill="#c3cec0"/>`,
    ds: `<path d="M50 43v30H23v35m27-35h27v35" fill="none" stroke="#d9e2d9" stroke-width="3"/><g fill="#d9e2d9"><circle cx="50" cy="43" r="8"/><circle cx="23" cy="108" r="7"/><circle cx="77" cy="108" r="7"/></g>`,
    os: `<g fill="#bbc7d0"><path d="M19 40h62v17H19zM19 68h43v17H19zM19 96h53v17H19z"/></g><path d="M81 66v57H19" fill="none" stroke="#d8dedf" stroke-width="2"/>`,
    cn: `<path d="m23 45 54 12-14 54-40-14zM23 45l40 66" fill="none" stroke="#b2cbd0" stroke-width="3"/><g fill="#d2dedd"><path d="M16 38h14v14H16zM70 50h14v14H70zM56 104h14v14H56zM16 90h14v14H16z"/></g>`,
    grid: `<path d="M20 43h60v72H20zM20 67h60M20 91h60M50 43v72" fill="none" stroke="#ccd5c9" stroke-width="2"/><path d="M52 69h26v20H52z" fill="#c4d0c0"/>`,
    node: `<path d="M50 80V43m0 37-27 30m27-30 27 30" stroke="#cdd8de" stroke-width="3"/><g fill="#dde4e2"><circle cx="50" cy="80" r="14"/><circle cx="50" cy="43" r="7"/><circle cx="23" cy="110" r="7"/><circle cx="77" cy="110" r="7"/></g>`,
    layer: `<path d="M19 40h42v62H19z" fill="#b8c4b4"/><path d="M31 53h43v62H31z" fill="#8fa18e"/><path d="M44 66h38v52H44z" fill="#d6dccd"/>`,
    flow: `<path d="M20 43h29v34h30v37m-9-9 9 9 9-9" fill="none" stroke="#d4d9e0" stroke-width="3"/><path d="M14 37h12v12H14zM43 71h12v12H43z" fill="#b1bbcf"/>`,
    block: `<path d="M19 91h21v24H19zM40 67h21v48H40zM61 43h21v72H61z" fill="#d5d2c5"/>`,
    signal: `<path d="M18 94h16V56h17v55h16V39h15" fill="none" stroke="#d3e0da" stroke-width="3"/>`,
  };
  const {color:background, label} = BOOK_COVER_FAMILY[variant];
  cover.innerHTML = `<svg viewBox="0 0 100 144" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <rect width="100" height="144" fill="#edece2"/>
    <rect x="5" y="5" width="90" height="134" fill="${background}"/>
    <path d="M13 5v134" stroke="#eceee1" stroke-opacity=".12"/>
    <text x="20" y="24" fill="#d4dfd2" font-size="8" letter-spacing="1.6">${label}</text>
    ${density === 'small' ? smallPatterns[variant] : patterns[variant]}</svg>`;
  if (userCoverUrl) {
    // Only already-resolved local assets: no third-party image request from a book title.
    try {
      const url = new URL(userCoverUrl, location.href);
      if (url.origin === location.origin && ['http:', 'https:', 'blob:'].includes(url.protocol)) {
        const image = document.createElement('img'); image.alt = ''; image.decoding = 'async';
        image.onload = () => { cover.dataset.coverSource = 'user'; };
        image.onerror = () => { image.remove(); cover.dataset.coverSource = source; };
        image.src = url.href; cover.append(image);
      }
    } catch { /* Keep the system/fallback illustration available. */ }
  }
  return cover;
}

let structureDetailId = 0;
export function createStructureLifecycle(p, run) {
  const ready = p.status === 'READY', updating = ready && p.regeneration_state === 'RUNNING';
  const failed = p.status === 'FAILED' || (ready && p.regeneration_state === 'FAILED');
  const root = node('div', '', 'structure-lifecycle');
  const trigger = label => {
    const button = action(label, run, 'structure-action');
    button.disabled = ready && (!p.regeneration_allowed || updating);
    return button;
  };
  if(ready) {
    const menu = node('details', '', 'structure-menu');
    const summary = node('summary', '···'); summary.setAttribute('aria-label', '学习结构更多操作');
    menu.append(summary, trigger('重新生成'));
    if(!p.regeneration_allowed) menu.append(node('p', '已有学习记录，暂不能重新生成。', 'muted'));
    root.append(menu);
  }
  if(p.status === 'NOT_PREPARED') root.append(node('p', '尚未生成本章学习结构'), trigger('生成学习结构'));
  if(p.status === 'PREPARING' || updating) {
    const progress = node('div', '', 'structure-progress'); progress.setAttribute('role', 'status');
    const steps = [['RESOLVING_SOURCE','来源准备'],['GENERATING','生成知识点'],['REVIEWING','独立审查'],['VALIDATING','校验'],['PUBLISHING','发布']];
    const current = steps.findIndex(([key])=>key===p.prepare_stage);
    const label = current < 0 ? (p.prepare_stage === 'QUEUED' ? '等待开始' : '准备中') : steps[current][1];
    const headline = node('p', `${updating ? '正在更新学习结构' : '正在生成学习结构'} · ${label}`, 'structure-progress-title');
    headline.append(node('span', '…', 'structure-working')); progress.append(headline);
    const list = node('ol', '', 'structure-steps');
    steps.forEach(([,text],i)=>{
      const item = node('li', `${i < current ? '✓ ' : ''}${text}`);
      if(i===current) item.setAttribute('aria-current','step');
      if(i<current) item.className='completed'; list.append(item);
    }); progress.append(list);
    if(Number.isInteger(p.sections_total) && p.sections_total>0 && Number.isInteger(p.sections_completed)) progress.append(node('p', `${p.sections_completed} / ${p.sections_total} 小节`, 'muted'));
    if(updating) progress.append(node('p', '仍可使用现有学习结构。', 'muted'));
    root.append(progress);
  }
  if(failed) {
    const failure = node('div', '', 'structure-failure');
    failure.append(node('p', ready ? '学习结构更新失败' : '学习结构生成失败'), trigger('重试'));
    if(ready) failure.append(node('p', '现有学习结构仍可使用。', 'muted'));
    const code = ready ? p.regeneration_failure_code : p.failure_code;
    if(ready && code) { const details=node('details', '', 'structure-technical');details.append(node('summary','技术详情'),node('p',code));failure.append(details); }
    if(!ready) {
      const button=node('button', '技术详情', 'structure-technical-trigger');button.type='button';
      const popup=node('div', '', 'structure-error-popover');popup.popover='auto';
      popup.id=`structure-error-${++structureDetailId}`;popup.setAttribute('role','dialog');popup.setAttribute('aria-label','技术详情');
      button.setAttribute('aria-controls',popup.id);button.setAttribute('aria-expanded','false');button.setAttribute('aria-haspopup','dialog');
      popup.append(node('p', `错误代码：${code || '未提供'}`));
      if(p.generator_provider) popup.append(node('p', `生成服务：${p.generator_provider}`));
      if(p.reviewer_provider) popup.append(node('p', `审查服务：${p.reviewer_provider}`));
      button.onclick=()=>{
        const rect=button.getBoundingClientRect();popup.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-296))}px`;
        popup.style.top=`${Math.max(8,Math.min(rect.bottom+6,innerHeight-160))}px`;
        popup.togglePopover({source:button});
      };
      popup.addEventListener('toggle',()=>button.setAttribute('aria-expanded',String(popup.matches(':popover-open'))));
      failure.append(button,popup);
    }
    root.append(failure);
  }
  return root;
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
      let value = await api(`/api/revisions/${book.active_revision.id}/outline?stored=1`);
      if (!value.evidence_source) value = await api(`/api/revisions/${book.active_revision.id}/outline`);
      if (stamp !== epoch) return; nodes = value.nodes;
      const context = await api(`/api/revisions/${book.active_revision.id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`).catch(() => null);
      if(stamp !== epoch) return;
      if(context?.chapter) position.textContent = `当前阅读：${context.chapter.title} · PDF ${p.pdf_page_index + 1}`;
      currentSection = context?.section?.outline_node_id;
      selectedChapter ||= context?.chapter?.outline_node_id || nodes.find(n => n.kind === 'CHAPTER' && !isAuxiliary(n))?.outline_node_id;
      renderRail(); await loadMap();
    } catch(error) { if(stamp === epoch) localError(rail, error, () => open(book)); }
  }
  function renderRail() {
    rail.replaceChildren(node('p', '章节', 'muted'));
    const ordered = [];
    function visit(parent) {
      for(const n of nodes.filter(n => n.parent_id === parent).sort((a,b) => a.order_index-b.order_index)) {
        ordered.push(n); visit(n.outline_node_id);
      }
    }
    visit(null);
    for(const n of ordered.filter(n => n.kind === 'CHAPTER' && !isAuxiliary(n))) {
      const parent = nodes.find(p => p.outline_node_id === n.parent_id);
      if(parent && !rail.querySelector(`[data-part-id="${parent.outline_node_id}"]`)) {
        const heading = node('p', parent.title, 'muted');
        heading.dataset.partId = parent.outline_node_id; rail.append(heading);
      }
      const b = action('', async () => { selectedChapter = n.outline_node_id; chapters.set(selectedBook.id, selectedChapter); renderRail(); await loadMap(); }, 'chapter-row');
      b.append(node('span', n.title), node('small', n.start_page == null ? '位置待确认' : `PDF ${n.start_page + 1}`));
      b.setAttribute('aria-current', String(n.outline_node_id === selectedChapter)); rail.append(b);
    }
    const other = nodes.filter(n => !n.parent_id && (n.kind !== 'CHAPTER' || isAuxiliary(n))
      && !nodes.some(c => c.parent_id === n.outline_node_id && c.kind === 'CHAPTER'));
    if(other.length) { const d = node('details'); d.append(node('summary', '其他内容')); for(const n of other) d.append(source(n, `${n.title}${n.start_page == null ? '' : ` · PDF ${n.start_page + 1}`}`)); rail.append(d); }
    if(!nodes.length) rail.append(node('p', '目录尚未就绪，仍可打开 PDF。', 'muted'), action('刷新目录', () => open(selectedBook)));
  }
  function source(n, label = '进入教材 ↗') {
    const b = action(label, () => read(selectedBook, {page: n.start_page, y: n.start_y ?? 0}), 'source-action');
    b.disabled = n.start_page == null; if(b.disabled) b.textContent = `${label} · 页码待核实`; return b;
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
    if(p.needs_review) h.append(node('p', '目录已校正：原知识点和学习内容已保留，来源范围需重新核验。', 'muted'));
    if(p.status === 'READY') { const meta=node('div'); meta.append(node('p', `${p.knowledge_points.length} 个知识点`, 'muted')); const counts=learning?.chapter_counts?.[selectedChapter]; if(counts) meta.append(node('p', `${counts.UNDERSTOOD} 已理解 · ${counts.NOT_FULLY_CLEAR} 仍不清楚 · ${counts.UNCONFIRMED} 待确认`, 'muted')); h.append(meta); } map.append(h);
    map.append(createStructureLifecycle(p, async () => {
      try { await api(`/api/revisions/${selectedBook.active_revision.id}/chapters/${selectedChapter}/knowledge-map/${p.status === 'READY' ? 'regenerate' : 'prepare'}`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); await loadMap(); }
      catch(e) { announce(e.message, true); }
    }));
    const sections = nodes.filter(n => n.kind === 'SECTION' && n.parent_id === selectedChapter);
    for(const section of sections) {
      const region = node('details', '', 'overview-section'); region.open = section.outline_node_id === currentSection; region.dataset.sectionId = section.outline_node_id;
      const head = node('summary', '', 'section-heading'); const text=node('div'); text.append(node('h3', section.title)); const counts=learning?.section_counts?.[section.outline_node_id]; if(counts) text.append(node('p', `${counts.UNDERSTOOD} 已理解 · ${counts.NOT_FULLY_CLEAR} 仍不清楚 · ${counts.UNCONFIRMED} 待确认`, 'muted')); if(reading.some(r=>r.outline_node_id===section.outline_node_id && r.reading_reached_end_at && ['NOT_APPLICABLE_YET','AVAILABLE'].includes(r.mastery_check_state))) text.append(node('p','已阅读 · 待确认','muted')); head.append(text, source(section)); region.append(head);
      for(const kp of p.status === 'READY' ? p.knowledge_points.filter(k => k.primary_section_id === section.outline_node_id) : []) {
        const row = node('div', '', 'overview-kp'); const current = learning?.points.find(k => k.knowledge_point_id === kp.knowledge_point_id);
        row.dataset.kpId = kp.knowledge_point_id;
        const desc = node('div', '', 'overview-kp-content');
        const heading = node('div', '', 'overview-kp-heading'); heading.append(node('strong', kp.title));
        const state = node('span', current ? ({UNDERSTOOD:'已理解',NOT_FULLY_CLEAR:'仍不清楚',UNCONFIRMED:'待确认'}[current.status]) : '状态暂不可用', `kp-state ${current?.status || ''}`);
        heading.append(state); desc.append(heading, node('p', kp.one_sentence_definition, 'muted'));
        const target = source(kp, `PDF ${kp.start_page + 1} ↗`); row.append(desc, target); region.append(row);
      }
      map.append(region);
    }
  }
  async function library(books) {
    const list = document.getElementById('book-list'); list.replaceChildren();
    for(const book of books) {
      const r = book.active_revision, row = node('article', '', 'book-card');
      const cover = createBookCover(book, 'book-spine');
      const info = node('div', '', 'book-info'); info.append(node('h2', book.title, 'book-card-title'), node('p', r ? `${r.page_count} 个 PDF 页面 · ${r.position.updated_at ? `上次读到 PDF ${r.position.pdf_page_index + 1}` : '尚未开始学习'}` : '删除未完成', 'book-card-meta'));
      row.append(cover, info);
      if(r) {
        const openBook = action('打开 →', () => open(book), 'book-open');
        openBook.setAttribute('aria-label', `打开教材 ${book.title}`); row.append(openBook);
      }
      const more = node('details', '', 'book-more'); const summary = node('summary', '···'); summary.setAttribute('aria-label', `${book.title} 更多操作`); more.append(summary);
      const menu = node('div', '', 'book-more-actions');
      if(r) menu.append(action('查看全书结构', () => open(book)), action('添加新版本', () => revision(book)));
      menu.append(action(r ? '删除教材' : '重试删除', () => remove(book), 'book-remove')); more.append(menu);
      more.addEventListener('keydown', event => { if(event.key === 'Escape') { more.open = false; summary.focus(); } });
      row.append(more); list.append(row);
    }
    const recent = books.filter(b => b.active_revision?.position.updated_at).sort((a,b) => b.active_revision.position.updated_at.localeCompare(a.active_revision.position.updated_at))[0];
    const block = document.getElementById('home-continue'); block.replaceChildren(); block.hidden = !recent;
    if(!recent) return;
    const r = recent.active_revision, p = r.position;
    block.append(node('p', 'CONTINUE　继续学习', 'eyebrow'));
    const row = node('div', '', 'continue-row'), info = node('div', '', 'continue-info');
    const section = node('p', '', 'continue-section');
    const h = node('h1', '继续阅读教材', 'continue-location');
    const status = node('div', '', 'continue-progress'); status.setAttribute('aria-live', 'polite');
    info.append(node('p', recent.title, 'continue-book'), section, h,
      node('p', `PDF ${p.pdf_page_index+1} / ${r.page_count}`, 'continue-position'), status);
    const resume = action('继续学习 →', () => read(recent), 'primary-action');
    resume.setAttribute('aria-label', `继续学习 ${recent.title}，PDF ${p.pdf_page_index+1}`);
    const links = node('div', '', 'continue-actions');
    links.append(resume, action('查看全书结构', () => open(recent), 'continue-overview'));
    row.append(createBookCover(recent, 'continue-cover'), info, links);
    block.append(row);
    status.append(node('p', '正在读取学习状态…', 'continue-stats'));
    try {
      const c = await api(`/api/revisions/${r.id}/reading-context?page=${p.pdf_page_index}&y=${p.normalized_offset}`);
      if(!h.isConnected) return;
      h.textContent = c.subsection?.title || c.section?.title || c.chapter?.title || '继续阅读教材';
      section.textContent = c.subsection ? (c.section?.title || c.chapter?.title || '') : (c.section ? c.chapter?.title || '' : '');
      section.hidden = !section.textContent;
      status.replaceChildren();
      const counts = c.learning_counts;
      const total = counts ? counts.UNDERSTOOD + counts.NOT_FULLY_CLEAR + counts.UNCONFIRMED : 0;
      if(total) {
        status.append(node('p', `本章 ${counts.UNDERSTOOD + counts.NOT_FULLY_CLEAR} / ${total} 已确认 · ${counts.NOT_FULLY_CLEAR} 个仍需理解`, 'continue-stats'));
        const strip = node('div', '', 'continue-progress-strip');
        strip.setAttribute('role', 'img');
        strip.setAttribute('aria-label', `本章：${counts.UNDERSTOOD} 已理解，${counts.NOT_FULLY_CLEAR} 仍需理解，${counts.UNCONFIRMED} 未确认`);
        for(const key of ['UNDERSTOOD', 'NOT_FULLY_CLEAR', 'UNCONFIRMED']) {
          const segment = node('span', '', key.toLowerCase());
          segment.style.flexGrow = String(counts[key]); strip.append(segment);
        }
        status.append(strip);
      } else status.append(node('p', '学习状态待确认 · 可继续阅读', 'continue-stats'));
    } catch {
      if(status.isConnected) status.replaceChildren(node('p', '学习状态暂不可用 · 可继续阅读', 'continue-stats'));
    }
  }
  return {open, close, library, overview};
}

// Current-chapter preparation only; the full map remains owned by Book Overview.
export function createChapterEntry({api, revision, openOverview, published, goToPage, closePeers = () => {}, outlineSnapshot = () => []}) {
  const entry = document.createElement('button');
  entry.id = 'reader-kp-action'; entry.type = 'button'; entry.hidden = true;
  document.getElementById('outline-toggle').after(entry);
  const panel = node('section', '', 'reader-kp-list'); panel.id = 'reader-kp-list'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '本章知识点'); panel.tabIndex = -1;
  (document.getElementById('reader') || document.body).append(panel);
  entry.setAttribute('aria-controls', panel.id); entry.setAttribute('aria-expanded', 'false');
  let listEpoch = 0;
  const listPositions = new Map();
  function closeList(focus = false) { if (!panel.hidden) listPositions.set(chapter, panel.querySelector(".reader-kp-body")?.scrollTop || 0); ++listEpoch; panel.hidden = true; document.getElementById("reader")?.classList.remove("knowledge-dock-open"); entry.setAttribute('aria-expanded', 'false'); if(focus) entry.focus(); }
  panel.addEventListener('keydown', e => { if(e.key === 'Escape') { e.stopPropagation(); closeList(true); } });
  async function openList() {
    const stamp = epoch, request = ++listEpoch, targetChapter = chapter;
    const points = snapshot.knowledge_points;
    closePeers();
    document.getElementById("reader").classList.add("knowledge-dock-open");
    panel.replaceChildren(); panel.hidden = false; entry.setAttribute('aria-expanded', 'true');
    const heading = node('div', '', 'reader-kp-heading');
    heading.append(node('strong', snapshot.chapter_title || '本章知识点'), action('关闭', () => closeList(true)));
    const body = node('div', '', 'reader-kp-body'); body.append(node('p', '读取知识点状态…', 'muted'));
    panel.append(heading, body, action('查看完整学习结构 ↗', () => { closeList(); return openOverview(targetChapter); }, 'reader-kp-footer'));
    panel.focus();
    const nodes = outlineSnapshot();
    body.replaceChildren();
    const statusLabels = new Map();
    const ids = [...new Set([...nodes.filter(n => n.kind === 'SECTION' && n.parent_id === targetChapter).map(n => n.outline_node_id), ...points.map(p => p.primary_section_id)])];
    for(const id of ids) {
      const group = points.filter(p => p.primary_section_id === id); if(!group.length) continue;
      const region = node('section'); region.dataset.sectionId = id;
      region.append(node('h3', nodes.find(n => n.outline_node_id === id)?.title || '小节标题暂不可用'));
      for(const kp of group) {
        const row = node('div', '', 'reader-kp-row'); row.dataset.kpId = kp.knowledge_point_id;
        const statusLabel = node('small', '状态读取中', 'kp-state');
        statusLabels.set(kp.knowledge_point_id, statusLabel);
        const info = node('div'); info.append(node('span', kp.title), statusLabel);
        row.append(info);
        if(Number.isInteger(kp.start_page) && kp.start_page >= 0 && Number.isFinite(kp.start_y)) {
          row.append(action(`PDF ${kp.start_page + 1} ↗`, () => { closeList(); goToPage(kp.start_page, kp.start_y); }, 'source-action'));
        } else row.append(node('small', '来源暂不可用', 'muted'));
        region.append(row);
      }
      body.append(region);
    }
    if(!points.length) body.append(node('p', '本章暂无已发布知识点', 'muted'));
    body.scrollTop = listPositions.get(targetChapter) || 0;
    try {
      const learning = await api(`/api/revisions/${owner}/learning`);
      if(stamp !== epoch || request !== listEpoch) return;
      for (const [id, label] of statusLabels) {
        const status = learning.points?.find(p => p.knowledge_point_id === id)?.status;
        label.textContent = {UNDERSTOOD:'已理解',NOT_FULLY_CLEAR:'仍不清楚',UNCONFIRMED:'待确认'}[status] || '状态暂不可用';
      }
    } catch (_error) {
      if(stamp !== epoch || request !== listEpoch) return;
      for (const label of statusLabels.values()) label.textContent = '状态暂不可用';
    }
  }
  let owner = null, chapter = null, section = null, snapshot = null, epoch = 0, timer, pending = false, error = null, loading = false;
  const stages = {QUEUED:'等待开始',RESOLVING_SOURCE:'来源准备中',GENERATING:'生成中',REVIEWING:'审查中',VALIDATING:'校验中',PUBLISHING:'发布中'};
  const base = () => `/api/revisions/${owner}/chapters/${chapter}/knowledge-map`;
  function reset() { ++epoch; closeList(); clearTimeout(timer); owner = chapter = snapshot = null; pending = loading = false; error = null; entry.hidden = true; }
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
      : snapshot?.status === 'FAILED' ? (snapshot.failure_code === 'semantic_window_source_limit' ? '上次小节容量受限 · 重试' : '生成失败 · 重试') : snapshot ? '＋ 生成本章知识点' : 'KP · 读取中';
    const failureReason = snapshot?.failure_code === 'semantic_window_source_limit'
      ? '上次准备因小节容量限制失败；调整容量后可点击重试本章，不会生成全书知识点。' : null;
    entry.title = error || failureReason || (snapshot?.status === 'READY' ? '查看本章知识点与学习状态'
      : `${snapshot?.chapter_title || '当前章'}：${entry.textContent}，PDF 阅读不受影响`);
  }
  async function load() {
    if (loading) return;
    loading = true;
    clearTimeout(timer); const stamp = epoch;
    try {
      const value = await api(base());
      if (stamp !== epoch) return;
      const newlyReady = snapshot?.status !== 'READY' && value.status === 'READY';
      snapshot = value; error = null; render();
      if (newlyReady) published();
      timer = setTimeout(load, value.status === 'PREPARING' || value.regeneration_state === 'RUNNING' ? 700 : 5000);
    } catch(e) { if (stamp === epoch) {error = '知识点状态读取失败，请重试（不会生成内容）'; render();} }
    finally { if (stamp === epoch) loading = false; }
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
  return {sync, reset, close: closeList};
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
