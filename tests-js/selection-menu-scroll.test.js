import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('let selectionMenuAnchor = null;'), app.indexOf('function syncNativeSelection('));

function fixture() {
  const rect = {left: 285.78125, top: 563.28125, width: 164.5, height: 22.609375};
  let available = true, reads = 0;
  const marker = {getBoundingClientRect() { reads++; return {...rect}; }};
  const colors = {hidden: true};
  const menu = {hidden: true, offsetWidth: 300, offsetHeight: 70,
    style: {removeProperty() {}}, querySelector: () => colors};
  const button = () => ({hidden: false, setAttribute() {}});
  const elements = {'selection-actions': menu, 'save-highlight': button(), 'add-note': button(), 'cancel-selection': button(),
    'note-editor': {hidden: true}, 'annotation-note': {value: ''},
    pages: {children: Array.from({length: 20}, () => ({querySelector: () => available ? marker : null}))}};
  const state = {selection: {pageIndex: 19, resolved: [{}]}, guideSelection: null, selectionMenuPoint: null};
  const frames = [];
  const context = vm.createContext({state, elements, selectionActionsDismissal: null,
    window: {innerWidth: 1440, innerHeight: 1000},
    requestAnimationFrame: callback => frames.push(callback),
    document: {querySelector: () => ({checked: false})}});
  vm.runInContext(source, context);
  return {state, elements, rect, menu, colors, frames,
    show: () => context.showSelectionActions(400, 580), scroll: () => context.handleSelectionMenuScroll(),
    detach() { available = false; }, reads: () => reads};
}

test('late layout offset changes preserve the menu when selected words stay at the same visual position', () => {
  const f = fixture();
  f.show();
  f.colors.hidden = false;
  f.elements['note-editor'].hidden = false;
  f.elements['annotation-note'].value = '未保存的笔记';
  for (let offset = 0; offset < 3; offset++) f.scroll();
  assert.equal(f.menu.hidden, false);
  assert.equal(f.colors.hidden, false);
  assert.equal(f.elements['note-editor'].hidden, false);
  assert.equal(f.elements['annotation-note'].value, '未保存的笔记');
});

test('actual vertical or horizontal reading movement and scale changes still dismiss the menu', () => {
  for (const change of [f => { f.rect.top -= 20; }, f => { f.rect.left -= 20; },
    f => { f.rect.width += 10; }, f => { f.rect.height += 2; }]) {
    const f = fixture();
    f.show();
    const selection = f.state.selection;
    change(f);
    f.scroll();
    assert.equal(f.menu.hidden, true);
    assert.equal(f.state.selection, selection, 'scroll dismisses actions without deleting the original selection');
    assert.equal(f.state.selectionMenuPoint, null);
  }
});

test('a removed source or different selection cannot keep a stale menu visible', () => {
  for (const change of [f => f.detach(), f => { f.state.selection = null; },
    f => { f.state.selection = {...f.state.selection}; }]) {
    const f = fixture();
    f.show();
    change(f);
    f.scroll();
    assert.equal(f.menu.hidden, true);
  }
});

test('non-PDF source actions retain their existing scroll dismissal behavior', () => {
  const f = fixture();
  f.state.selection = null;
  f.state.guideSelection = {text: '来自导读或回答的选区'};
  f.show();
  f.scroll();
  assert.equal(f.menu.hidden, true);
  assert.equal(f.state.guideSelection, null);
});

test('closed menus do no geometry work and reopening captures a fresh visual source', () => {
  const f = fixture();
  f.scroll();
  assert.equal(f.reads(), 0);
  f.show();
  f.rect.top -= 100;
  f.scroll();
  assert.equal(f.menu.hidden, true);
  f.show();
  f.scroll();
  assert.equal(f.menu.hidden, false);
});
