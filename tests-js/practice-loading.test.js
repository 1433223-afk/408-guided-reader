import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functions = ['resetPractice', 'savePracticePosition', 'loadPracticeRecords'];
const source = functions.map(name => app.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]+?\\n}\\n`))[0]).join('\n');
const tick = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
};
const section = (number = 101, id = 'section') => ({id, questions: [{number}]});

function fixture() {
  const requests = [], sections = [], messages = [], applied = [];
  const calls = {rail: 0, pages: 0};
  let currentNumber = 101;
  const state = {generation: 1, revision: {id: 'same-book', blob_sha256: 'source'}, zoom: 1, rendered: new Set(),
    practice: {restoreZoom: null}};
  const context = vm.createContext({state, practicePositionSave: Promise.resolve(),
    practiceKnowledge: {stop() {}}, master: {leavePracticeReview() {}},
    elements: {reader: {classList: {remove() {}}}, 'practice-panel': {}, 'practice-hint': {},
      pages: {querySelectorAll: () => []}},
    replacePracticeSections(rows) { sections.splice(0, sections.length, ...(rows || [])); applied.push(rows); },
    practiceCurrentQuestion: () => ({number: currentNumber}),
    api(path, options = {}) { const pending = deferred(); requests.push({path, options, ...pending}); return pending.promise; },
    updatePracticeRail() { calls.rail++; }, renderPracticePages() { calls.pages++; },
    announce(message) { messages.push(message); },
  });
  vm.runInContext(source, context);
  context.resetPractice();
  applied.length = 0;
  const catalogs = () => requests.filter(request => request.path.endsWith('/catalog'));
  const records = () => requests.filter(request => request.path.endsWith('/practice-prototype'));
  const writes = () => requests.filter(request => request.options.method === 'POST');
  return {state, context, requests, sections, messages, applied, calls, catalogs, records, writes,
    load: options => context.loadPracticeRecords(options),
    current(number) { currentNumber = number; },
    reply(index, {catalog = [section()], questions = [], positions = {section: 101}} = {}) {
      catalogs()[index].resolve({sections: catalog});
      records()[index].resolve({questions, positions});
    },
    reopen(sameBook = true) {
      state.generation++;
      context.resetPractice();
      state.revision = {id: sameBook ? 'same-book' : 'another-book', blob_sha256: sameBook ? 'source' : 'another-source'};
    },
  };
}

test('concurrent background and explicit Practice callers share completion after both responses apply', async () => {
  const f = fixture();
  const first = f.load(), second = f.load();
  assert.equal(first, second);
  let completed = false;
  first.then(() => { completed = true; });
  await tick();
  assert.equal(f.catalogs().length, 1);
  assert.equal(f.records().length, 1);
  f.catalogs()[0].resolve({sections: [section()]});
  await tick();
  assert.equal(completed, false);
  assert.equal(f.state.practice.catalogReady, false);
  f.records()[0].resolve({questions: [{number: 101, favorite: true}], positions: {section: 101}});
  await first;
  assert.equal(completed, true);
  assert.equal(f.state.practice.catalogReady, true);
  assert.equal(f.sections[0].questions[0].number, 101);
  assert.equal(f.state.practice.records.get(101).favorite, true);
  assert.equal(f.state.practice.positions.get('section'), 101);
  assert.equal(f.calls.rail, 1);
  assert.equal(f.calls.pages, 1);
  assert.equal(f.state.practice.catalogLoading, null);
});

test('old responses and finally handlers cannot publish into a reopened or different book', async () => {
  for (const sameBook of [true, false]) {
    const f = fixture(), oldPractice = f.state.practice, old = f.load();
    await tick();
    f.reopen(sameBook);
    const current = f.load();
    await tick();
    f.reply(0, {catalog: [section(999)], positions: {section: 999}});
    await old;
    assert.equal(f.state.practice.catalogReady, false);
    assert.equal(f.sections.length, 0);
    assert.equal(f.state.practice.catalogLoading, current);
    assert.equal(oldPractice.catalogLoading, null);
    f.reply(1, {catalog: [section(202)], positions: {section: 202}});
    await current;
    assert.equal(f.sections[0].questions[0].number, 202);
    assert.equal(f.state.practice.positions.get('section'), 202);
  }
});

test('a later completed load refreshes saved records instead of treating catalogReady as a permanent cache', async () => {
  const f = fixture(), first = f.load();
  await tick();
  f.reply(0, {questions: [{number: 101, favorite: false}]});
  await first;
  const next = f.load();
  assert.notEqual(next, first);
  await tick();
  assert.equal(f.catalogs().length, 2);
  f.reply(1, {questions: [{number: 101, favorite: true}]});
  await next;
  assert.equal(f.state.practice.records.get(101).favorite, true);
});

test('an OCR completion refresh joins the owner and prevents an older empty catalog from resolving callers', async () => {
  const f = fixture(), first = f.load();
  let completed = false;
  first.then(() => { completed = true; });
  await tick();
  const forced = f.load({refresh: true});
  assert.equal(forced, first);
  f.reply(0, {catalog: [], positions: {}});
  await tick();
  assert.equal(completed, false);
  assert.equal(f.state.practice.catalogReady, false);
  assert.equal(f.applied.length, 0);
  assert.equal(f.catalogs().length, 2);
  f.reply(1);
  await forced;
  assert.equal(completed, true);
  assert.equal(f.sections.length, 1);
  assert.equal(f.applied.length, 1);
});

test('a READY preparation snapshot refreshes a catalog read started before the final OCR page was published', async () => {
  const f = fixture(), loading = f.load();
  f.context.elements['preparation-status'] = {};
  f.context.clearTimeout = () => {};
  f.context.applyPreparationStatuses = () => {};
  const preparation = ['preparationFinished', 'startPreparation'].map(name =>
    app.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]+?\\n}\\n`))[0]).join('\n');
  vm.runInContext(preparation, f.context);
  await tick();
  const checking = f.context.startPreparation(false);
  f.requests.find(request => request.path.endsWith('/preparation')).resolve({pages: [{status: 'READY'}]});
  await checking;
  f.reply(0, {catalog: [], positions: {}});
  await tick();
  assert.equal(f.state.practice.catalogReady, false);
  assert.equal(f.applied.length, 0);
  assert.equal(f.catalogs().length, 2);
  f.reply(1);
  await loading;
  assert.equal(f.sections.length, 1);
});

test('Practice waits for pending position writes before reading continuation state', async () => {
  const f = fixture();
  f.state.practice.sectionId = 'section';
  f.context.savePracticePosition();
  const loading = f.load();
  await tick();
  assert.equal(f.writes().length, 1);
  assert.equal(f.catalogs().length, 0);
  assert.equal(f.records().length, 0);
  f.writes()[0].resolve({});
  await tick();
  assert.equal(f.catalogs().length, 1);
  f.reply(0);
  await loading;
  assert.equal(f.state.practice.positions.get('section'), 101);
});

test('a position write added during a GET queues a fresh read before publishing or settling', async () => {
  const f = fixture(), loading = f.load();
  let completed = false;
  loading.then(() => { completed = true; });
  await tick();
  f.state.practice.sectionId = 'section';
  f.current(102);
  f.context.savePracticePosition();
  await tick();
  f.reply(0, {positions: {section: 101}});
  await tick();
  assert.equal(completed, false);
  assert.equal(f.applied.length, 0);
  assert.equal(f.catalogs().length, 1, 'the follow-up GET must wait for the new write');
  f.writes()[0].resolve({});
  await tick();
  assert.equal(f.catalogs().length, 2);
  f.reply(1, {positions: {section: 102}});
  await loading;
  assert.equal(f.state.practice.positions.get('section'), 102);
});

test('refreshing during an active exercise freezes its catalog and preserves the current question position', async () => {
  const f = fixture(), initial = f.load();
  await tick(); f.reply(0); await initial;
  const currentCatalog = f.sections[0];
  f.state.practice.active = true;
  f.state.practice.sectionId = 'section';
  f.current(102);
  const loading = f.load({refresh: true});
  await tick();
  f.reply(1, {catalog: [section(200)], positions: {section: 101}});
  await loading;
  assert.equal(f.sections[0], currentCatalog);
  assert.equal(f.state.practice.pendingCatalog[0].questions[0].number, 200);
  assert.equal(f.state.practice.positions.get('section'), 102);
});

test('failed loads release the shared owner for retry and old failures remain quiet after reopening', async () => {
  const f = fixture(), failed = f.load();
  await tick();
  f.catalogs()[0].reject(Error('temporary failure'));
  await failed;
  assert.equal(f.state.practice.catalogLoading, null);
  assert.equal(f.messages.length, 1);
  const retry = f.load();
  await tick(); f.reply(1); await retry;
  assert.equal(f.state.practice.catalogReady, true);

  const old = f.load(); await tick();
  f.reopen();
  const fresh = f.load(); await tick();
  f.catalogs()[2].reject(Error('old failure'));
  await old;
  assert.equal(f.messages.length, 1);
  assert.equal(f.state.practice.catalogLoading, fresh);
  f.reply(3); await fresh;
});

test('Memory return-to-Practice cannot resume after the awaited Reader opening was reset or closed', async () => {
  const start = app.indexOf('returnToPractice: async ');
  const end = app.indexOf('\n} });', start);
  assert.ok(start >= 0 && end > start);
  const callback = app.slice(start + 'returnToPractice: '.length, end + 2);
  for (const close of [false, true]) {
    const ready = deferred(), calls = [];
    const book = {id: 'book', active_revision: {id: 'revision'}};
    const state = {book, revision: book.active_revision, pdf: {}, practice: {active: false}};
    const context = vm.createContext({state, api: async () => ({books: [book]}),
      elements: {'library-home': {}, reader: {}}, loadPracticeRecords: () => ready.promise,
      PRACTICE_SECTIONS: [section(101)], enterPractice: () => calls.push('enter'),
      switchPracticeQuestion: () => calls.push('switch'), practiceQuestions: () => [{number: 101}],
      openPracticeReview: () => calls.push('review')});
    vm.runInContext(`globalThis.returnToPractice = ${callback}`, context);
    const returning = context.returnToPractice({book_id: 'book', book_source_revision_id: 'revision', source: {number: 101}}, true);
    await tick();
    if (close) state.pdf = null;
    else state.practice = {active: false};
    ready.resolve();
    await returning;
    assert.deepEqual(calls, []);
  }
});
