import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('let marksPanelSnapshot = null;'), app.indexOf('async function deleteAnnotation('));

function fixture() {
  const counts = {created: 0, answers: 0, replacements: 0};
  class Element {
    hidden = false;
    children = [];
    dataset = {};
    classList = {add() {}};
    append(...nodes) { this.children.push(...nodes); }
    setAttribute() {}
    addEventListener() {}
    replaceChildren(...nodes) { counts.replacements++; this.children = nodes; }
  }
  const elements = Object.fromEntries(['marks-panel', 'marks-count', 'marks-toggle', 'marks-page', 'marks-list', 'marks-empty']
    .map(id => [id, new Element()]));
  elements['marks-panel'].hidden = true;
  const annotation = {id: 'saved', source_kind: 'AI_SAVED', highlight_style: 'yellow', verification_state: 'PASS',
    pdf_page_index: 0, quote: '教材原文', body: '一份包含公式与段落的回答', provenance: {concept_path: ['A', 'B']}};
  const state = {generation: 1, currentPage: 0, revision: {id: 'revision'}, annotationData: new Map([[0, [annotation]]])};
  const context = vm.createContext({elements, state,
    document: {createElement() { counts.created++; return new Element(); }},
    memory: {control() { return new Element(); }}, renderAssistantAnswer(node, body) { counts.answers++; node.textContent = body; },
    goToPage() {}, retrySavedExplanationReview() {}, deleteAnnotation() {},
  });
  vm.runInContext(source, context);
  return {state, elements, counts, annotation, update: () => context.updateMarksPanel()};
}

test('scrolling with Notes closed updates the badge without building hidden saved answers', () => {
  const f = fixture();
  for (let frame = 0; frame < 120; frame++) f.update();
  assert.equal(f.elements['marks-count'].textContent, '1');
  assert.equal(f.elements['marks-count'].hidden, false);
  assert.deepEqual(f.counts, {created: 0, answers: 0, replacements: 0});
  f.elements['marks-panel'].hidden = false;
  f.update();
  assert.equal(f.elements['marks-list'].children.length, 1);
  assert.equal(f.counts.answers, 1);
});

test('same-page scroll preserves the visible saved answer and its controls', () => {
  const f = fixture();
  f.elements['marks-panel'].hidden = false;
  f.update();
  const card = f.elements['marks-list'].children[0];
  const first = {...f.counts};
  for (let frame = 0; frame < 120; frame++) f.update();
  assert.equal(f.elements['marks-list'].children[0], card);
  assert.deepEqual(f.counts, first);
  assert.equal(f.counts.answers, 1);
  assert.equal(f.counts.replacements, 1);
});

test('annotation updates, empty pages, and reopening the same book refresh Notes', () => {
  const f = fixture();
  f.elements['marks-panel'].hidden = false;
  f.update();
  const initialCard = f.elements['marks-list'].children[0];
  f.state.annotationData.set(0, [{...f.annotation, body: '已更新的解释'}]);
  f.update();
  assert.notEqual(f.elements['marks-list'].children[0], initialCard);
  assert.equal(f.counts.answers, 2);
  f.state.currentPage = 1;
  f.update();
  assert.equal(f.elements['marks-count'].hidden, true);
  assert.equal(f.elements['marks-page'].textContent, '2');
  assert.equal(f.elements['marks-list'].children.length, 0);
  assert.equal(f.elements['marks-empty'].hidden, false);
  f.state.currentPage = 0;
  f.update();
  const beforeReopen = f.elements['marks-list'].children[0];
  f.state.generation++;
  f.update();
  assert.notEqual(f.elements['marks-list'].children[0], beforeReopen);
  assert.equal(f.counts.answers, 4);
  f.state.annotationData.set(0, []);
  f.update();
  assert.equal(f.elements['marks-list'].children.length, 0);
  assert.equal(f.elements['marks-count'].textContent, '0');
});
