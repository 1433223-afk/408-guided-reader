import {createId} from './id.js';
import {createTabletInkStore, INK_COLORS} from './tablet-ink-store.js';

const SVG = 'http://www.w3.org/2000/svg';
const clamp = value => Math.max(0,Math.min(1,value));
const rounded = value => Math.round(value * 1e5) / 1e5;
const revisionId = value => typeof value === 'string' ? value : value?.id;

export function inkPoint(event, bounds) {
  if (!bounds.width || !bounds.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  return [rounded(clamp((event.clientX - bounds.left) / bounds.width)),
    rounded(clamp((event.clientY - bounds.top) / bounds.height)),
    Math.round((Number.isFinite(event.pressure) && event.pressure > 0 ? clamp(event.pressure) : .5)*1000)/1000];
}

function distanceToSegment(x, y, a, b, width, height) {
  const ax = a[0] * width, ay = a[1] * height, bx = b[0] * width, by = b[1] * height;
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy))) : 0;
  return Math.hypot(x-ax-t*dx,y-ay-t*dy);
}

export function nearestInkStroke(strokes, point, bounds, radius = 12) {
  let nearest = null, best = Infinity;
  const x = point[0] * bounds.width, y = point[1] * bounds.height;
  for (const stroke of strokes) {
    let distance = Infinity;
    for (let i=0; i<stroke.points.length; i++) distance = Math.min(distance,
      distanceToSegment(x,y,stroke.points[Math.max(0,i-1)],stroke.points[i],bounds.width,bounds.height));
    if (distance <= radius + stroke.width * bounds.width / 2 && distance < best) {best = distance; nearest = stroke;}
  }
  return nearest;
}

// Ink is independent of OCR and the PDF canvas. Its DOM may be virtualized;
// the normalized strokes and the durable FIFO outbox never live in that DOM.
export function createTabletInk({reader, viewer, pages, api, getRevision,
  getPageIndex = () => Math.max(0, Number(reader.ownerDocument.getElementById('page-number')?.value || 1)-1),
  onState = () => {}, beforeContact = () => {}, allowMouse = false,
  store: suppliedStore, makeId = createId,
  windowTarget = reader.ownerDocument.defaultView, documentTarget = reader.ownerDocument} = {}) {
  const store = suppliedStore || createTabletInkStore({api, windowTarget, documentTarget});
  const removers = [], history = [], redoHistory = [], drafts = new Map(), localWrites = new Set(), pageErrors = new Map();
  let enabled = false, tool = 'pen', color = INK_COLORS[0], width = .0025, owner = null;
  let current = null, frame = null, destroyed = false, generation = 0, localError = null;
  const listen = (target, type, callback, options) => {
    target.addEventListener(type,callback,options);
    removers.push(() => target.removeEventListener(type,callback,options));
  };
  const notify = () => {
    if (destroyed) return;
    const state = store.getState(), page = getPageIndex();
    onState({enabled,tool,color,width,pending:Math.max(state.pending,localWrites.size,drafts.size),saving:state.saving || localWrites.size > 0,
      error:state.error || localError || pageErrors.get(`${current}:${page}`) || null,
      drawing:Boolean(owner),canUndo:history.some(item => item.revision === current && item.page === page),
      canRedo:redoHistory.some(item => item.revision === current && item.page === page)});
  };
  const wrapperFor = index => pages.children[index];
  function strokesFor(index, revision = current) {
    const values = new Map(store.getPage(revision,index).map(stroke => [stroke.id,stroke]));
    for (const draft of drafts.values()) if (draft.revision === revision && draft.stroke.page_index === index) {
      if (draft.deleted) values.delete(draft.stroke.id); else values.set(draft.stroke.id,draft.stroke);
    }
    if (owner?.revision === revision && owner.page === index && owner.stroke) values.set(owner.stroke.id,owner.stroke);
    return [...values.values()];
  }
  function paintPage(index) {
    if (!current || destroyed) return;
    const wrapper = wrapperFor(index), canvas = wrapper?.querySelector('canvas');
    if (!canvas) return;
    let layer = wrapper.querySelector('.tablet-ink-layer');
    if (layer?.dataset.revision !== current) {layer?.remove(); layer = null;}
    if (!layer) {
      layer = documentTarget.createElementNS(SVG,'svg'); layer.classList.add('tablet-ink-layer');
      layer.dataset.revision = current; layer.setAttribute('aria-hidden','true');
      layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:3;pointer-events:none;overflow:hidden';
      wrapper.append(layer);
    }
    const geometry = canvas.getBoundingClientRect();
    const ratio = geometry.width > 0 ? geometry.height / geometry.width : canvas.height / canvas.width;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    // The viewBox has the page's aspect ratio: uniform ink width scales with
    // the PDF, rather than stretching a square normalized coordinate system.
    layer.setAttribute('viewBox',`0 0 1000 ${1000*ratio}`);
    const existing = new Map([...layer.children].map(path => [path.dataset.strokeId,path]));
    for (const stroke of strokesFor(index)) {
      const path = existing.get(stroke.id) || documentTarget.createElementNS(SVG,'path'); existing.delete(stroke.id);
      const coordinates = stroke.points.map(point => [point[0]*1000,point[1]*ratio*1000]);
      let d = coordinates.map(([x,y],i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
      if (coordinates.length === 1) d += ` l.001 0`;
      if (path.getAttribute('d') !== d) path.setAttribute('d',d);
      path.dataset.strokeId = stroke.id;
      path.setAttribute('fill','none'); path.setAttribute('stroke',stroke.color);
      path.setAttribute('stroke-width',String(stroke.width*1000));
      path.setAttribute('stroke-linecap','round'); path.setAttribute('stroke-linejoin','round');
      if (path.parentElement !== layer) layer.append(path);
    }
    for (const path of existing.values()) path.remove();
  }
  function paintMounted() {
    for (let index=0;index<pages.children.length;index++) if (pages.children[index].querySelector('canvas')) paintPage(index);
  }
  function schedulePaint() {
    if (frame !== null || destroyed) return;
    frame = windowTarget.requestAnimationFrame(() => {frame = null; paintMounted();});
  }
  const unsubscribe = store.subscribe(change => {
    if (change.revision === current && Number.isInteger(change.page)) paintPage(change.page);
    notify();
  });
  function queue(action, stroke, revision) {
    const key = `${revision}:${stroke.id}`;
    const draft = {stroke,revision,deleted:action === 'delete'};
    drafts.set(key,draft); schedulePaint();
    const work = store.enqueue({revision_id:revision,page_index:stroke.page_index,
      action,stroke_id:stroke.id,stroke}).then(() => {if (drafts.get(key) === draft) drafts.delete(key); localError = null;}, error => {
      localError = error?.message || '笔迹尚未保存，请保留此页面并重试。';
    }).finally(() => {localWrites.delete(work); if (revision === current) paintPage(stroke.page_index); notify();});
    localWrites.add(work); return work;
  }
  function newStroke(page, first) {
    return {id:makeId(),page_index:page,color,width,coordinate_version:1,points:[first]};
  }
  function take(event) {
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation?.(); event.stopPropagation();
  }
  function release(completed) {
    try {if (viewer.hasPointerCapture(completed.pointerId)) viewer.releasePointerCapture(completed.pointerId);} catch (_) { /* Already released. */ }
  }
  function commitSegment(contact) {
    if (!contact.stroke?.points.length) return;
    const stroke = contact.stroke;
    contact.actions.push({action:'put',stroke}); queue('put',stroke,contact.revision); contact.stroke = null;
  }
  function finish() {
    const completed = owner;
    owner = null;
    if (completed) {
      commitSegment(completed); release(completed);
      if (completed.actions.length) {
        history.push({revision:completed.revision,page:completed.page,actions:completed.actions});
        redoHistory.length = 0;
      }
      paintPage(completed.page); notify();
    }
    return Promise.all([...localWrites]).then(() => {});
  }
  function record(event) {
    if (!owner || owner.tool !== 'pen') return;
    const sample = inkPoint(event,owner.bounds);
    if (!sample) return;
    const previous = owner.stroke?.points.at(-1);
    if (previous && previous.every((value,index) => value === sample[index])) return;
    if (owner.stroke.points.length >= 1500) {
      const last = owner.stroke.points.at(-1); commitSegment(owner);
      owner.stroke = newStroke(owner.page,last);
    }
    owner.stroke.points.push(sample);
  }
  function erase(event) {
    if (!owner || owner.tool !== 'eraser') return;
    const point = inkPoint(event,owner.bounds);
    if (!point) return;
    const stroke = nearestInkStroke(strokesFor(owner.page,owner.revision)
      .filter(item => !owner.erased.has(item.id)),point,owner.bounds);
    if (!stroke) return;
    owner.erased.add(stroke.id); owner.actions.push({action:'delete',stroke}); queue('delete',stroke,owner.revision);
  }
  function start(event) {
    if (!enabled || owner || destroyed || event.isPrimary === false
        || !(event.pointerType === 'pen' || allowMouse && event.pointerType === 'mouse')
        || event.button !== 0 || !(event.buttons & 1)) return;
    const revision = revisionId(getRevision());
    if (!revision) return;
    if (revision !== current) openRevision();
    if (event.target.closest?.('button,input,textarea,select,a,summary,[role="button"]')) return;
    const wrapper = event.target.closest?.('.page');
    if (!wrapper || !pages.contains(wrapper)) return;
    const page = Number(wrapper.dataset.index), canvas = wrapper.querySelector('canvas');
    if (!Number.isInteger(page) || !canvas) return;
    // Cancelling an in-progress touch pinch can remove its CSS preview transform.
    // Measure only afterwards, so the first ink sample uses the settled PDF.
    beforeContact();
    const bounds = canvas.getBoundingClientRect(), point = inkPoint(event,bounds);
    if (!point || event.clientX < bounds.left || event.clientX > bounds.left+bounds.width
        || event.clientY < bounds.top || event.clientY > bounds.top+bounds.height) return;
    owner = {revision,page,bounds,pointerId:event.pointerId,tool,actions:[],erased:new Set(),
      stroke:tool === 'pen' ? newStroke(page,point) : null};
    take(event);
    try {viewer.setPointerCapture(event.pointerId);} catch (_) {finish(); return;}
    if (tool === 'eraser') erase(event);
    schedulePaint(); notify();
  }
  function move(event) {
    if (!owner || event.pointerId !== owner.pointerId) return;
    take(event);
    if (!(event.buttons & 1)) return;
    let samples;
    try {samples = event.getCoalescedEvents?.();} catch (_) { /* LAN HTTP may not expose this optional API. */ }
    for (const sample of samples?.length ? samples : [event]) {
      if (owner.tool === 'pen') record(sample); else erase(sample);
    }
    // Some implementations omit the dispatching event from coalesced samples.
    if (samples?.length) {if (owner.tool === 'pen') record(event); else erase(event);}
    schedulePaint();
  }
  function end(event) {
    if (!owner || event.pointerId !== owner.pointerId) return;
    take(event);
    if (event.type === 'pointerup') {
      if (owner.tool === 'pen') record(event); else erase(event);
    }
    finish(); // Cancellation keeps the actual samples already collected.
  }
  function touch(event) {if (owner) take(event);}
  for (const [type,handler] of [['pointerdown',start],['pointermove',move],['pointerup',end],
    ['pointercancel',end],['lostpointercapture',end]]) listen(viewer,type,handler,true);
  listen(viewer,'touchstart',touch,{capture:true,passive:false});
  listen(viewer,'touchmove',touch,{capture:true,passive:false});
  listen(windowTarget,'blur',finish); listen(windowTarget,'orientationchange',finish);
  listen(documentTarget,'visibilitychange',() => {if (documentTarget.hidden) finish();});

  function mountPage(index) {
    if (destroyed) return;
    const revision = revisionId(getRevision());
    if (!revision) return;
    if (revision !== current) openRevision();
    paintPage(index);
    const stamp = generation;
    store.loadPage(revision,index).then(() => {
      if (stamp !== generation || revision !== current || destroyed) return;
      pageErrors.delete(`${revision}:${index}`); paintPage(index); notify();
    }).catch(failure => {
      if (stamp !== generation || revision !== current || destroyed) return;
      pageErrors.set(`${revision}:${index}`,failure?.message || '本页笔迹读取失败，请重试。'); notify();
    });
  }
  function openRevision(value = getRevision()) {
    const next = revisionId(value);
    if (next === current) {notify(); return;}
    finish(); current = next || null; generation++; history.length = redoHistory.length = 0; localError = null;
    notify();
  }
  function setEnabled(value) {
    finish(); enabled = Boolean(value);
    reader.classList.toggle('tablet-ink-enabled',enabled); notify();
  }
  function undoRedo(redo) {
    finish();
    const source = redo ? redoHistory : history, target = redo ? history : redoHistory, page = getPageIndex();
    const index = source.findLastIndex(item => item.revision === current && item.page === page);
    if (index < 0) return Promise.resolve();
    const [item] = source.splice(index,1); target.push(item);
    const actions = redo ? item.actions : [...item.actions].reverse();
    const pending = actions.map(action => queue(redo ? (action.action === 'put' ? 'restore' : 'delete')
      : (action.action === 'put' ? 'delete' : 'restore'),action.stroke,item.revision));
    notify(); return Promise.all(pending).then(() => {});
  }
  openRevision();
  return {
    get enabled() {return enabled;}, get drawing() {return Boolean(owner);},
    get tool() {return tool;}, get color() {return color;}, get width() {return width;},
    setEnabled,
    setTool(value) {finish(); if (!['pen','eraser','erase'].includes(value)) throw new Error('未知批注工具。');
      tool = value === 'erase' ? 'eraser' : value; notify();},
    setColor(value) {if (!INK_COLORS.includes(value)) throw new Error('未知笔迹颜色。'); color = value; notify();},
    setWidth(value) {if (!Number.isFinite(value) || value < .0003 || value > .02) throw new Error('笔迹粗细超出范围。'); width = value; notify();},
    mountPage, openRevision, finish,
    sync() {openRevision(); for (let index=0;index<pages.children.length;index++) {
      if (pages.children[index].querySelector('canvas')) mountPage(index);
    } notify();},
    reset() {finish(); enabled = false; reader.classList.remove('tablet-ink-enabled'); current = null; generation++;
      history.length = redoHistory.length = 0; notify();},
    undo:() => undoRedo(false), redo:() => undoRedo(true),
    async hasPending() {await finish(); return store.hasPending();},
    async retry() {localError = null; await store.retry(); const page = getPageIndex();
      if (current) {await store.loadPage(current,page,{force:true}); pageErrors.delete(`${current}:${page}`); paintPage(page);} notify();},
    getPageStrokes:index => strokesFor(index),
    destroy() {finish(); destroyed = true; generation++; unsubscribe();
      if (frame !== null) windowTarget.cancelAnimationFrame(frame);
      removers.forEach(remove => remove());
      // Keep the durable FIFO alive: returning to the library must not discard
      // or abandon operations that are already queued for this computer.
    },
  };
}
