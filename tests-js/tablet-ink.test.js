import test from 'node:test';
import assert from 'node:assert/strict';
import {createTabletInk,inkPoint,nearestInkStroke} from '../src/reader_service/static/tablet-ink.js';
import {createTabletInkStore} from '../src/reader_service/static/tablet-ink-store.js';

const REVISION='00000000-0000-4000-8000-000000000001';
const copy=value=>JSON.parse(JSON.stringify(value));
const tick=async()=>{for(let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve));};
class Element {
  constructor(tag='div') {this.tag=tag;this.children=[];this.dataset={};this.attributes=new Map();this.classes=new Set();
    this.style={cssText:''};this.handlers=new Map();this.parentElement=null;
    this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),remove:name=>this.classes.delete(name),
      toggle:(name,value)=>{if(value) this.classes.add(name);else this.classes.delete(name);}};}
  addEventListener(type,fn) {if(!this.handlers.has(type)) this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn) {this.handlers.get(type)?.delete(fn);}
  emit(type,detail={}) {const event={type,cancelable:true,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=true;},...detail};
    for(const fn of this.handlers.get(type)||[]) fn(event);return event;}
  append(child) {child.remove();child.parentElement=this;this.children.push(child);}
  remove() {if(this.parentElement) this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  contains(child) {return child===this||this.children.some(node=>node.contains(child));}
  matches(selector) {return selector.split(',').some(item=>item.startsWith('.')?this.classes.has(item.slice(1)):item===this.tag);}
  closest(selector) {return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelector(selector) {for(const child of this.children) {if(child.matches(selector)) return child;const nested=child.querySelector(selector);if(nested) return nested;}return null;}
  getAttribute(name) {return this.attributes.get(name)||null;}
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  getBoundingClientRect() {return this.bounds||{left:100,top:10,width:500,height:700};}
}
function fixture({offline=false}={}) {
  const windowTarget=new Element(),documentTarget=new Element();
  const frames=new Map();let frame=0,id=20,sequence=0;
  windowTarget.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};
  windowTarget.cancelAnimationFrame=id=>frames.delete(id);
  documentTarget.defaultView=windowTarget;documentTarget.createElementNS=(_,tag)=>new Element(tag);
  documentTarget.getElementById=()=>({value:'1'});
  const reader=new Element(),viewer=new Element(),pages=new Element(),page=new Element(),canvas=new Element('canvas');
  reader.ownerDocument=documentTarget;reader.append(viewer);viewer.append(pages);pages.append(page);page.append(canvas);
  page.classList.add('page');page.dataset.index='0';canvas.width=1000;canvas.height=1400;
  const captures=new Set();viewer.setPointerCapture=id=>captures.add(id);viewer.hasPointerCapture=id=>captures.has(id);
  viewer.releasePointerCapture=id=>{captures.delete(id);viewer.emit('lostpointercapture',{pointerId:id});};
  const operations=new Map(),states=new Map(),backend=new Map(),calls=[];let broken=offline;
  const persistence={async load(){return{operations:copy([...operations.values()]),states:copy([...states.values()])};},
    async append(op,state){const key=++sequence;operations.set(key,{...copy(op),sequence:key});states.set(state.key,copy(state));return key;},
    async acknowledge(key,state){operations.delete(key);if(state&&states.get(state.key)?.operation_id===state.operation_id) states.set(state.key,copy(state));},
    async forget(values){for(const state of values) if(states.get(state.key)?.version===state.version) states.delete(state.key);}};
  const api=async(path,options)=>{
    if(!options) return{strokes:[...backend.values()].filter(item=>!item.deleted).map(item=>item.stroke)};
    const body=JSON.parse(options.body);calls.push(body);if(broken) throw new Error('offline');
    if(body.action==='put'&&!backend.has(body.stroke_id)) backend.set(body.stroke_id,{stroke:{...body.stroke,id:body.stroke_id},deleted:false});
    const item=backend.get(body.stroke_id);if(body.action==='delete') item.deleted=true;if(body.action==='restore') item.deleted=false;
    return{operation_id:body.operation_id,stroke_id:body.stroke_id,deleted:item.deleted,stroke:item.stroke};
  };
  const store=createTabletInkStore({api,persistence,windowTarget,documentTarget});let state,before=0,observer=()=>{},contactHook=()=>{};
  const ink=createTabletInk({reader,viewer,pages,api,getRevision:()=>({id:REVISION}),getPageIndex:()=>0,
    store,windowTarget,documentTarget,onState:value=>{state=value;observer(value);},beforeContact:()=>{before++;contactHook();},
    makeId:()=>`00000000-0000-4000-8000-${String(id++).padStart(12,'0')}`});
  const emit=(type,detail={})=>viewer.emit(type,{pointerType:'pen',pointerId:7,isPrimary:true,button:0,buttons:1,
    clientX:150,clientY:150,pressure:.5,target:canvas,...detail});
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
  return{reader,viewer,pages,page,canvas,windowTarget,documentTarget,ink,store,emit,flush,calls,operations,backend,persistence,
    get state(){return state;},get before(){return before;},online(){broken=false;},
    observe(fn){observer=fn;},
    onContact(fn){contactHook=fn;},
    destroy(){ink.destroy();store.destroy();}};
}

test('reading mode never consumes pen or finger input; writing ignores fingers and mouse',async()=>{
  const f=fixture();await f.store.ready;
  assert.equal(f.emit('pointerdown').defaultPrevented,false);assert.equal(f.before,0);
  assert.equal(f.viewer.emit('touchstart').defaultPrevented,false);
  f.ink.setEnabled(true);
  assert.equal(f.emit('pointerdown',{pointerType:'touch'}).defaultPrevented,false);
  assert.equal(f.emit('pointerdown',{pointerType:'mouse'}).defaultPrevented,false);
  const down=f.emit('pointerdown');assert.equal(down.defaultPrevented,true);assert.equal(f.ink.drawing,true);
  assert.equal(f.viewer.emit('touchstart').defaultPrevented,true);
  f.emit('pointerup',{buttons:0});assert.ok(f.state.pending>0,'pointerup must not report saved before the local append runs');
  await tick();assert.equal(f.ink.drawing,false);
  assert.equal(f.viewer.emit('touchstart').defaultPrevented,false);
  assert.equal(f.before,1);assert.equal(f.calls.length,1);f.destroy();
});

test('coalesced points are retained, cancellation saves a partial stroke, and SVG survives a PDF remount',async()=>{
  const f=fixture();await f.store.ready;f.ink.setEnabled(true);f.emit('pointerdown');
  f.emit('pointermove',{clientX:220,clientY:220,getCoalescedEvents:()=>[
    {clientX:180,clientY:180,pressure:.45678},{clientX:200,clientY:200,pressure:.7}]});
  f.emit('pointercancel');await tick();f.flush();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].stroke.points.length,4);
  assert.equal(f.calls[0].stroke.points[1][2],.457);
  const first=f.page.querySelector('.tablet-ink-layer');assert.ok(first);assert.equal(first.children.length,1);
  assert.equal(first.getAttribute('viewBox'),'0 0 1000 1400');
  f.page.children.forEach(child=>{child.parentElement=null;});f.page.children=[];f.page.append(f.canvas);
  f.ink.mountPage(0);await tick();assert.equal(f.page.querySelector('.tablet-ink-layer').children.length,1);
  assert.equal(f.page.querySelector('canvas'),f.canvas);f.destroy();
});

test('cancelling a touch pinch before the pen starts cannot anchor ink to the removed preview transform',async()=>{
  const f=fixture();await f.store.ready;f.ink.setEnabled(true);
  f.canvas.bounds={left:0,top:0,width:1000,height:1400};
  f.onContact(()=>{f.canvas.bounds={left:100,top:10,width:500,height:700};});
  f.emit('pointerdown');f.emit('pointerup',{buttons:0});await tick();
  assert.deepEqual(f.calls[0].stroke.points[0],[.1,.2,.5]);f.destroy();
});

test('a long contact splits below 64 KiB without losing samples and undoes/redoes as one session group',async()=>{
  const f=fixture();await f.store.ready;f.ink.setEnabled(true);f.emit('pointerdown');
  const samples=Array.from({length:1700},(_,i)=>({clientX:110+i%480,clientY:20+i%680,pressure:.54321}));
  f.emit('pointermove',{clientX:samples.at(-1).clientX,clientY:samples.at(-1).clientY,getCoalescedEvents:()=>samples});
  f.emit('pointerup',{buttons:0,clientX:samples.at(-1).clientX,clientY:samples.at(-1).clientY});await tick();
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].stroke.points.length,1500);
  assert.ok(f.calls[1].stroke.points.length>200);assert.equal(f.state.canUndo,true);
  for(const body of f.calls) assert.ok(Buffer.byteLength(JSON.stringify(body))<64*1024);
  await f.ink.undo();await tick();assert.equal(f.ink.getPageStrokes(0).length,0);assert.equal(f.state.canRedo,true);
  await f.ink.redo();await tick();assert.equal(f.ink.getPageStrokes(0).length,2);
  assert.deepEqual(f.calls.map(call=>call.action),['put','put','delete','delete','restore','restore']);f.destroy();
});

test('whole-stroke erasing has undo/redo and does not mutate the PDF canvas',async()=>{
  const f=fixture();await f.store.ready;f.ink.setEnabled(true);f.emit('pointerdown');
  f.emit('pointermove',{clientX:250,clientY:150});f.emit('pointerup',{buttons:0,clientX:250,clientY:150});await tick();
  f.ink.setTool('eraser');f.emit('pointerdown',{clientX:200,clientY:151});f.emit('pointerup',{buttons:0,clientX:200,clientY:151});await tick();
  assert.equal(f.ink.getPageStrokes(0).length,0);await f.ink.undo();await tick();assert.equal(f.ink.getPageStrokes(0).length,1);
  await f.ink.redo();await tick();assert.equal(f.ink.getPageStrokes(0).length,0);assert.equal(f.page.querySelector('canvas'),f.canvas);f.destroy();
});

test('an older PUT draft completion cannot clear a newer DELETE draft while local persistence is blocked',async()=>{
  const f=fixture();await f.store.ready;
  let releasePut,releaseDelete,appends=0;
  const putGate=new Promise(resolve=>{releasePut=resolve;}),deleteGate=new Promise(resolve=>{releaseDelete=resolve;});
  const append=f.persistence.append;
  f.persistence.append=async(...args)=>{await (++appends===1 ? putGate : deleteGate);return append(...args);};
  f.ink.setEnabled(true);f.emit('pointerdown');f.emit('pointerup',{buttons:0});
  const counts=[];f.observe(()=>counts.push(f.ink.getPageStrokes(0).length));
  const undone=f.ink.undo();assert.equal(f.ink.getPageStrokes(0).length,0);
  releasePut();await tick();assert.equal(appends,2);
  assert.ok(counts.every(count=>count===0),'the stroke must never flash back between PUT and DELETE appends');
  releaseDelete();await undone;await tick();assert.equal(f.ink.getPageStrokes(0).length,0);f.destroy();
});

test('returning to the library does not clear an offline draft; reconnect resumes the original operation',async()=>{
  const f=fixture({offline:true});await f.store.ready;f.ink.setEnabled(true);f.emit('pointerdown');
  f.emit('pointerup',{buttons:0});await tick();assert.equal(f.state.pending,1);assert.ok(f.state.error);
  const operation=f.calls[0].operation_id;f.ink.reset();assert.equal(f.ink.enabled,false);assert.equal(f.operations.size,1);
  assert.equal(await f.ink.hasPending(),true);
  f.online();await f.store.retry();await tick();assert.equal(f.operations.size,0);
  assert.equal(f.calls.at(-1).operation_id,operation);f.ink.openRevision();f.ink.mountPage(0);await tick();
  assert.equal(f.ink.getPageStrokes(0).length,1);assert.equal(await f.ink.hasPending(),false);f.destroy();
});

test('normalized coordinates and hit testing use original page bounds, independently of OCR',()=>{
  assert.deepEqual(inkPoint({clientX:250,clientY:350,pressure:.123456},{left:0,top:0,width:500,height:700}),[.5,.5,.123]);
  assert.equal(inkPoint({clientX:0,clientY:0},{left:0,top:0,width:0,height:0}),null);
  const stroke={id:'ink',width:.0025,points:[[0,0,.5],[1,1,.5]]};
  assert.equal(nearestInkStroke([stroke],[.5,.5],{width:500,height:700}),stroke);
  assert.equal(nearestInkStroke([stroke],[.1,.9],{width:500,height:700}),null);
});
