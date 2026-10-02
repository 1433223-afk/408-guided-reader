import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createPracticeKnowledge} from '../src/reader_service/static/practice-knowledge.js';

function fixture() {
  const calls = [], timers = [], changes = [];
  const ui = createPracticeKnowledge({
    api(path, options) {
      return new Promise((resolve, reject) => calls.push({path, options, resolve, reject}));
    },
    schedule(callback) {timers.push(callback); return callback;},
    cancel(callback) {const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1);},
    onChange() {changes.push(ui.point(9));},
  });
  return {ui, calls, timers, changes};
}

test('Practice starts without awaiting matching and polls only while pending', async () => {
  const f = fixture();
  assert.equal(f.ui.start('book', 'section'), undefined);
  assert.equal(f.ui.point(9), null);
  assert.equal(f.calls[0].options.method, 'POST');
  f.calls[0].resolve({section_id: 'section', matches: [], pending: true});
  await setImmediate();
  assert.equal(f.timers.length, 1);
  f.timers.shift()();
  assert.equal(f.calls[1].options.method, undefined);
  const point = {id: 'kp', title: 'Cache 与主存的地址映射', start_page: 10, start_y: .3};
  f.calls[1].resolve({section_id: 'section', matches: [{number: 9, knowledge_point: point},
    {number: 10, knowledge_point: null}], pending: false});
  await setImmediate();
  assert.deepEqual(f.ui.point(9), point);
  assert.equal(f.ui.point(10), null);
  assert.equal(f.timers.length, 0);
});

test('switching book or section cannot display an old request result', async () => {
  const f = fixture();
  f.ui.start('old-book', 'same-section');
  f.ui.start('new-book', 'same-section');
  assert.equal(f.calls[0].options.signal.aborted, true);
  f.calls[0].resolve({section_id: 'same-section', matches: [{number: 9,
    knowledge_point: {id: 'wrong-book'}}], pending: true});
  await setImmediate();
  assert.equal(f.ui.point(9), null);
  assert.equal(f.timers.length, 0);
  f.calls[1].resolve({section_id: 'same-section', matches: [], pending: false});
  await setImmediate();
  assert.equal(f.changes.length, 3);
});

test('failure stays silent, stops polling, and can retry on the next entry', async () => {
  const f = fixture();
  f.ui.start('book', 'section');
  f.calls[0].reject(new Error('provider unavailable'));
  await setImmediate();
  assert.equal(f.ui.point(9), null);
  assert.equal(f.changes.length, 1);
  assert.equal(f.timers.length, 0);
  f.ui.start('book', 'section');
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({section_id: 'section', matches: [{number: 9, knowledge_point: null}], pending: false});
  await setImmediate();
  assert.equal(f.ui.point(9), null);
  assert.equal(f.timers.length, 0);
});

test('leaving Practice cancels polling and ignores late results', async () => {
  const f = fixture();
  f.ui.start('book', 'section');
  f.calls[0].resolve({section_id: 'section', matches: [], pending: true});
  await setImmediate();
  f.timers.shift()();
  f.ui.stop();
  f.calls[1].resolve({section_id: 'section', matches: [{number: 9,
    knowledge_point: {id: 'late'}}], pending: true});
  await setImmediate();
  assert.equal(f.ui.point(9), null);
  assert.equal(f.timers.length, 0);
});

test('textbook round trip retains the current answer, hints and review state', () => {
  const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8');
  const sourceNavigation = app.slice(app.indexOf('function goToKnowledgeSource(point)'), app.indexOf('function updatePracticeRail()'));
  const questionNavigation = app.slice(app.indexOf('function showPracticeQuestion()'), app.indexOf('function switchPracticeQuestion(index)'));
  const answerActions = app.slice(app.indexOf('function selectPracticeChoice(choice)'), app.indexOf('let practicePointer'));
  const practice = {active: true, selected: 'B', result: null, index: 2, hints: ['已获得的提示'],
    reviewOpen: true, reviewTarget: 'B', onAnswerPage: false, onKnowledgePage: false};
  const state = {practice};
  const navigations = [];
  const context = vm.createContext({state, practiceKnowledge: {point: () => ({start_page: 8, start_y: .25})},
    practiceCurrentQuestion: () => ({number: 9, page: 20, promptY: .4}),
    elements: {viewer: {focus() {}}}, updatePracticeRail() {}, renderPracticePages() {},
    goToPage: (...args) => navigations.push(args), api() {throw Error('Must not submit while reading');}});
  vm.runInContext(sourceNavigation + questionNavigation + answerActions, context);
  context.showPracticeKnowledge();
  context.selectPracticeChoice('D');
  context.submitPracticeChoice();
  assert.equal(practice.onKnowledgePage, true);
  assert.equal(practice.selected, 'B');
  context.showPracticeQuestion();
  assert.equal(practice.onKnowledgePage, false);
  assert.equal(practice.index, 2);
  assert.deepEqual(practice.hints, ['已获得的提示']);
  assert.equal(practice.reviewOpen, true);
  assert.equal(practice.reviewTarget, 'B');
  practice.result = 'incorrect';
  context.showPracticeKnowledge();
  context.showPracticeQuestion();
  assert.equal(practice.result, 'incorrect');
  assert.deepEqual(navigations, [[8, .25], [20, .32], [8, .25], [20, .32]]);
});
