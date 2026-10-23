import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
const directorySource = app.slice(app.indexOf('let directoryActiveSnapshot = null;'), app.indexOf('function openDirectory()'));
const preparationSource = app.slice(app.indexOf('function updatePreparationLabel()'), app.indexOf('function schedulePreparationPriority('));

function directoryFixture() {
  const counts = {queries: 0, classes: 0, aria: 0, reveals: []};
  const makeTarget = id => ({id, isConnected: true, current: false,
    closest: () => ({dataset: {nodeId: id}}),
    classList: {toggle() { counts.classes++; }},
    setAttribute() { counts.aria++; this.current = true; },
    removeAttribute() { counts.aria++; this.current = false; },
    scrollIntoView(options) { counts.reveals.push({id, block: options.block}); },
  });
  let targets = ['5.4.1', '5.4.2', '5.4.3'].map(makeTarget);
  const tree = {contains: target => targets.includes(target), querySelectorAll() { counts.queries++; return targets; }};
  const state = {generation: 1, currentOutlineId: '5.4.2', learningChapterId: '5'};
  const context = vm.createContext({state, elements: {'outline-tree': tree}});
  vm.runInContext(directorySource, context);
  return {state, counts, context, sync: options => context.syncDirectoryActive(options),
    targets: () => targets,
    rebuild() { targets.forEach(target => { target.isConnected = false; }); targets = targets.map(target => makeTarget(target.id)); },
  };
}

test('unchanged directory identity avoids scanning and scrolling the tree on every frame', () => {
  const f = directoryFixture();
  for (let frame = 0; frame < 120; frame++) f.sync();
  assert.equal(f.counts.queries, 1);
  assert.equal(f.counts.classes, 3);
  assert.equal(f.counts.aria, 3);
  assert.deepEqual(f.counts.reveals, [{id: '5.4.2', block: 'nearest'}]);
  assert.equal(f.targets()[1].current, true);
});

test('same-page subsection identity changes and explicit directory reveal still update', () => {
  const f = directoryFixture();
  f.sync();
  f.state.currentOutlineId = '5.4.3';
  f.sync();
  assert.equal(f.targets()[1].current, false);
  assert.equal(f.targets()[2].current, true);
  f.sync({reveal: true});
  assert.equal(f.counts.queries, 3);
  assert.deepEqual(f.counts.reveals.at(-1), {id: '5.4.3', block: 'center'});
});

test('rebuilding the directory or reopening a book invalidates an identical active id', () => {
  const f = directoryFixture();
  f.sync();
  f.rebuild();
  f.sync();
  assert.equal(f.targets()[1].current, true);
  assert.equal(f.counts.queries, 2);
  f.state.generation++;
  f.sync();
  assert.equal(f.counts.queries, 3);
});

test('real position derivation preserves same-page subsection boundaries and clicked landing identity', () => {
  const f = directoryFixture();
  const node = (id, kind, parent, depth, startPage, startY, endPage, endY) => ({outline_node_id: id,
    title: id, kind, parent_id: parent, depth, resolution_state: 'RESOLVED',
    start_page: startPage, start_y: startY, end_page: endPage, end_y: endY});
  const nodes = [node('5', 'CHAPTER', null, 0, 0, 0, 10, 1),
    node('5.4', 'SECTION', '5', 1, 4, 0, 6, 0),
    node('5.4.1', 'SUBSECTION', '5.4', 2, 5, .1, 5, .5),
    node('5.4.2', 'SUBSECTION', '5.4', 2, 5, .5, 6, 0)];
  Object.assign(f.state, {outlineNodes: nodes, outlineKinship: {byId: new Map(nodes.map(n => [n.outline_node_id, n])), spans: new Map()}});
  let point = {pageIndex: 5, normalizedY: .49};
  Object.assign(f.context, {captureZoomAnchor: () => point, chapterEntry: {sync() {}},
    master: {viewportChanged() {}}, expandDirectoryPath() {}});
  Object.assign(f.context.elements, {viewer: {getBoundingClientRect: () => ({top: 0})}, 'outline-panel': {hidden: false}});
  vm.runInContext(app.slice(app.indexOf('function outlineNavigationTarget('), app.indexOf('function updateViewport()'))
    + app.slice(app.indexOf('function isAuxiliaryOutlineRoot('), app.indexOf('function makeAuxiliaryOutlineGroup(')), f.context);
  f.context.renderReaderSectionHint();
  assert.equal(f.state.currentOutlineId, '5.4.1');
  point = {pageIndex: 5, normalizedY: .5};
  f.context.renderReaderSectionHint();
  assert.equal(f.state.currentOutlineId, '5.4.2');
  assert.equal(f.targets()[1].current, true);
  const queries = f.counts.queries;
  for (let frame = 0; frame < 120; frame++) f.context.renderReaderSectionHint();
  assert.equal(f.counts.queries, queries);
  f.state.navigationAnchorId = '5.4.2';
  f.state.pinnedLanding = {pageIndex: 5, normalizedY: .5};
  point = {pageIndex: 5, normalizedY: .499};
  f.context.renderReaderSectionHint();
  assert.equal(f.state.currentOutlineId, '5.4.2');
  f.state.pinnedLanding = null;
  f.context.renderReaderSectionHint();
  assert.equal(f.state.currentOutlineId, '5.4.1');
  assert.equal(f.targets()[0].current, true);
});

function preparationFixture(rows = []) {
  const counts = {text: 0, title: 0, classes: 0};
  let text = '', title = '', className = '';
  const output = {
    get textContent() { return text; }, set textContent(value) { counts.text++; text = value; },
    get title() { return title; }, set title(value) { counts.title++; title = value; },
    get className() { return className; }, set className(value) { counts.classes++; className = value; },
  };
  const state = {currentPage: 0, preparation: new Map(rows.map((status, index) => [index, {status}]))};
  const context = vm.createContext({state, elements: {'preparation-status': output}});
  vm.runInContext(preparationSource, context);
  return {state, output, counts, update: () => context.updatePreparationLabel()};
}

test('initial and unchanged page preparation labels do not repeat toolbar DOM writes', () => {
  const f = preparationFixture();
  f.update();
  assert.match(f.output.textContent, /读取已保存文字层/);
  const first = {...f.counts};
  for (let frame = 0; frame < 120; frame++) f.update();
  assert.deepEqual(f.counts, first);
  f.state.preparation.set(0, {status: 'READY'});
  f.update();
  assert.equal(f.output.textContent, '文字层已生成');
  const ready = {...f.counts};
  for (let frame = 0; frame < 120; frame++) f.update();
  assert.deepEqual(f.counts, ready);
});

test('current page and same-page OCR progress continue updating the preparation label', () => {
  const f = preparationFixture(['READY', 'PREPARING', 'NOT_PREPARED']);
  f.update();
  assert.match(f.output.textContent, /本页可选.*1\/3/);
  f.state.currentPage = 1;
  f.update();
  assert.match(f.output.textContent, /本页识别中.*1\/3/);
  f.state.preparation.set(1, {status: 'FAILED'});
  f.update();
  assert.match(f.output.textContent, /本页文字失败/);
  assert.match(f.output.className, /failed/);
  f.state.preparation.set(1, {status: 'READY'});
  f.update();
  assert.match(f.output.textContent, /本页可选.*2\/3/);
  assert.doesNotMatch(f.output.className, /failed/);
});

test('successful refresh restores a temporary failure message without changed page status', () => {
  const f = preparationFixture(['NOT_PREPARED']);
  f.update();
  const expected = {text: f.output.textContent, title: f.output.title, className: f.output.className};
  f.output.textContent = '文字状态读取失败，点击重试';
  f.output.className = 'preparation-status failed';
  f.update();
  assert.equal(f.output.textContent, expected.text);
  assert.equal(f.output.title, expected.title);
  assert.equal(f.output.className, expected.className);
});
