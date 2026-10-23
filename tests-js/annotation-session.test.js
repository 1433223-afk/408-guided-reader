import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../src/reader_service/static/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const functions = ['saveAssistantTurn', 'upsertAnnotation', 'refreshAnnotationPage', 'pollSavedExplanationReview',
  'retrySavedExplanationReview', 'deleteAnnotation', 'saveAnnotation', 'openBook'];
const source = functions.map(name => app.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]+?\\n}\\n`))[0]).join('\n');
const selection = pageIndex => ({pageIndex, resolved: [{}], anchor: {lineOrdinal: 1, boundary: 0}, focus: {lineOrdinal: 1, boundary: 2}});

function fixture() {
  const state = {revision: {id: 'same-book'}, generation: 1, currentPage: 2, selection: selection(2),
    readerSessionId: 'reader-1', annotationData: new Map(), assistantReviewPolls: new Map(),
    assistantSaveIntents: new Map(), assistantSavedTurns: new Map(), pageProxies: new Map(),
    assistantScrollPositions: new Map(), assistantChildRequests: new Map()};
  const elements = Object.fromEntries(['save-highlight', 'save-note', 'reader-title', 'library-home', 'reader',
    'page-total', 'page-number', 'zoom-value'].map(name => [name, {disabled: false}]));
  elements.pages = {replaceChildren() {}};
  const pending = [], messages = [], timers = [];
  const calls = {render: 0, marks: 0, workspace: 0, cleared: 0};
  const context = vm.createContext({state, elements, crypto: {randomUUID: () => 'intent'},
    window: {confirm: () => true}, selectedHighlightStyle: () => 'YELLOW', trimPageDataCaches() {},
    api(path, options) {return new Promise((resolve, reject) => pending.push({path, options, resolve, reject}));},
    assistantTurnKey: (root, node, turn) => `${root}:${node}:${turn}`,
    renderAnnotations() {calls.render++;}, updateMarksPanel() {calls.marks++;},
    renderAssistantWorkspace() {calls.workspace++;}, clearSelection() {calls.cleared++; state.selection = null;},
    announce(message) {messages.push(message);},
    setTimeout(callback) {timers.push(callback); return timers.length;}, clearTimeout() {},
    firstPagePreviewRequest: null, visualSelection: {cancel() {}}, launchToken: '',
    cancelRenders() {}, closePreparationStream() {}, resetPractice() {}, applyDirectoryMode() {},
    emptyAssistantState: () => ({}), clearAssistantReviewPolls() {state.assistantReviewPolls.clear();},
    renderLibrary() {}, buildPlaceholders() {}, resetAssistantPanel() {}, master: {reset() {}},
    applyRestoredPosition() {}, showFirstPagePreview() {}, pdfSession: {open: async () => null},
  });
  vm.runInContext(source, context);
  const annotation = {id: 'saved', pdf_page_index: 2, verification_state: 'PENDING'};
  const button = {dataset: {rootId: 'root', turnId: 'turn'}, disabled: false};
  const reopen = async (sameBook = true) => {
    state.book = null;
    state.pdf = null;
    await context.openBook({id: sameBook ? 'book' : 'another-book', title: '教材', active_revision: {
      id: sameBook ? 'same-book' : 'another-book', page_count: 50, byte_size: 1024, position: {zoom: 1}}});
    state.selection = selection(9);
    state.annotationData = new Map([[2, [annotation]]]);
  };
  return {state, elements, pending, messages, timers, calls, context, annotation, button, reopen};
}

for (const name of ['saveAnnotation', 'deleteAnnotation', 'saveAssistantTurn', 'retrySavedExplanationReview']) {
  const begin = f => name === 'saveAnnotation' ? f.context[name]('note')
    : name === 'saveAssistantTurn' ? f.context[name](f.button)
      : f.context[name](f.annotation, f.button);

  test(`${name}: an old successful write cannot mutate a reopened Reader or its selection`, async () => {
    for (const sameBook of [true, false]) {
      const f = fixture(), operation = begin(f);
      assert.equal(f.pending.length, 1);
      await f.reopen(sameBook);
      const currentSelection = f.state.selection, annotations = f.state.annotationData.get(2);
      f.pending[0].resolve({annotation: f.annotation});
      await operation;
      assert.equal(f.state.selection, currentSelection);
      assert.equal(f.state.annotationData.get(2), annotations);
      assert.equal(annotations.length, 1);
      assert.equal(f.state.assistantSavedTurns.size, 0);
      assert.equal(f.state.assistantReviewPolls.size, 0);
      assert.equal(f.messages.length, 0);
      assert.deepEqual(f.calls, {render: 0, marks: 0, workspace: 0, cleared: 0});
      assert.equal(f.elements['save-highlight'].disabled, false);
      assert.equal(f.elements['save-note'].disabled, false);
    }
  });

  test(`${name}: an old failure is quiet after the real Reader reset restores save controls`, async () => {
    const f = fixture(), operation = begin(f);
    await f.reopen();
    f.pending[0].reject(Error('old request failed'));
    await operation;
    assert.equal(f.messages.length, 0);
    assert.equal(f.elements['save-highlight'].disabled, false);
    assert.equal(f.elements['save-note'].disabled, false);
    if (name !== 'deleteAnnotation') assert.equal(f.button.disabled, name !== 'saveAnnotation');
  });
}

for (const failed of [false, true]) {
  test(`reopening restores shared save controls, and an old ${failed ? 'failed' : 'successful'} save cannot unlock a new save`, async () => {
    const f = fixture(), oldSave = f.context.saveAnnotation('old note');
    assert.equal(f.elements['save-highlight'].disabled, true);
    assert.equal(f.elements['save-note'].disabled, true);
    await f.reopen();
    assert.equal(f.elements['save-highlight'].disabled, false);
    assert.equal(f.elements['save-note'].disabled, false);
    const newSave = f.context.saveAnnotation('new note');
    if (failed) f.pending[0].reject(Error('old save failed'));
    else f.pending[0].resolve({annotation: f.annotation});
    await oldSave;
    assert.equal(f.elements['save-highlight'].disabled, true);
    assert.equal(f.elements['save-note'].disabled, true);
    assert.equal(f.state.selection.pageIndex, 9);
    assert.equal(f.messages.length, 0);
    f.pending[1].resolve({annotation: {id: 'new-note', pdf_page_index: 9}});
    await newSave;
    assert.equal(f.state.annotationData.get(9)[0].id, 'new-note');
    assert.equal(f.elements['save-highlight'].disabled, false);
    assert.equal(f.elements['save-note'].disabled, false);
  });
}

test('opening an already active Reader does not unlock an in-flight save', async () => {
  const f = fixture();
  f.state.book = {id: 'active-book'};
  f.state.pdf = {};
  const saving = f.context.saveAnnotation('note');
  await f.context.openBook({id: 'active-book'});
  assert.equal(f.state.generation, 1);
  assert.equal(f.elements['save-highlight'].disabled, true);
  assert.equal(f.elements['save-note'].disabled, true);
  f.pending[0].resolve({annotation: f.annotation}); await saving;
  assert.equal(f.elements['save-highlight'].disabled, false);
});

test('current-session highlight creation and deletion still update saved marks normally', async () => {
  const f = fixture();
  const save = f.context.saveAnnotation('note');
  f.pending[0].resolve({annotation: f.annotation}); await save;
  assert.equal(f.state.annotationData.get(2)[0].id, 'saved');
  assert.equal(f.state.selection, null);
  assert.equal(f.elements['save-highlight'].disabled, false);
  const remove = f.context.deleteAnnotation(f.annotation);
  f.pending[1].resolve({}); await remove;
  assert.equal(f.state.annotationData.get(2).length, 0);
  assert.equal(f.calls.render, 2);
  assert.equal(f.messages.length, 2);
});

test('current-session Assistant saves and review retry retain their normal path', async () => {
  const f = fixture(), save = f.context.saveAssistantTurn(f.button);
  f.pending[0].resolve({annotation: f.annotation}); await save;
  assert.equal(f.state.assistantSavedTurns.size, 1);
  assert.equal(f.state.annotationData.get(2)[0].id, 'saved');
  assert.equal(f.state.assistantReviewPolls.size, 1);
  assert.equal(f.calls.workspace, 1);
  const retry = f.context.retrySavedExplanationReview(f.annotation, {disabled: false});
  f.pending[1].resolve({}); await retry;
  assert.equal(f.timers.length, 2);
});

for (const failed of [false, true]) {
  test(`review polling cannot restart after a Reader reopens while its refresh ${failed ? 'fails' : 'finishes'}`, async () => {
    const f = fixture();
    f.context.pollSavedExplanationReview('saved', 2, 0);
    const polling = f.timers[0]();
    assert.equal(f.pending.length, 1);
    await f.reopen();
    if (failed) f.pending[0].reject(Error('old refresh failed'));
    else f.pending[0].resolve({annotations: [f.annotation]});
    await polling;
    assert.equal(f.timers.length, 1);
    assert.equal(f.state.assistantReviewPolls.size, 0);
    assert.equal(f.calls.render, 0);
  });
}

test('a queued review poll cannot read into a reopened session, while an active session can continue polling', async () => {
  const old = fixture();
  old.context.pollSavedExplanationReview('saved', 2, 0);
  await old.reopen();
  old.context.pollSavedExplanationReview('saved', 2, 0);
  const currentTimer = old.state.assistantReviewPolls.get('saved');
  await old.timers[0]();
  assert.equal(old.pending.length, 0);
  assert.equal(old.state.assistantReviewPolls.get('saved'), currentTimer);
  const current = fixture();
  current.context.pollSavedExplanationReview('saved', 2, 0);
  const polling = current.timers[0]();
  current.pending[0].resolve({annotations: [current.annotation]}); await polling;
  assert.equal(current.timers.length, 2);
  assert.equal(current.state.assistantReviewPolls.size, 1);
});
