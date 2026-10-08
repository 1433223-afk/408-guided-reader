import test from 'node:test';
import assert from 'node:assert/strict';
import {PRACTICE_BOOK_SHA256, PRACTICE_QUESTIONS, PRACTICE_QUESTIONS_524, PRACTICE_SECTIONS,
  replacePracticeSections, practiceQuestionForPage, practiceChoiceAt, practiceGuideForPage, practiceSourceRegions} from '../src/reader_service/static/practice-fixture.js';

test('one cross-page Exercise keeps four choices on their source pages', () => {
  const question = PRACTICE_QUESTIONS_524.find(item => item.number === 109);
  assert.deepEqual(question.regions.map(region => region.page), [227, 228]);
  assert.equal(practiceChoiceAt(practiceQuestionForPage(227, question), .3, .894), 'A');
  assert.equal(practiceChoiceAt(practiceQuestionForPage(227, question), .3, .914), 'B');
  assert.equal(practiceChoiceAt(practiceQuestionForPage(228, question), .3, .109), 'C');
  assert.equal(practiceChoiceAt(practiceQuestionForPage(228, question), .3, .129), 'D');
  assert.equal(practiceQuestionForPage(229, question), null);
  assert.equal(practiceChoiceAt(practiceQuestionForPage(227, question), .3, .109), null);
});

test('existing single-page Exercise still uses the same hit regions', () => {
  const question = PRACTICE_QUESTIONS[0];
  assert.equal(practiceChoiceAt(practiceQuestionForPage(19, question), .3, .774), 'A');
  assert.equal(practiceQuestionForPage(20, question), null);
});

test('prompt-only first page and table continuation both retain the current Exercise guide', () => {
  const question = {page: 28, promptY: .9042,
    sourceRegions: [{page: 28, top: .9042, bottom: .9189}, {page: 29, top: .1018, bottom: .2303}],
    regions: [{page: 29, options: [{choice: 'A', rect: [.18, .2132, .27, .2313]}]}]};
  assert.equal(practiceQuestionForPage(28, question), null);
  assert.deepEqual(practiceGuideForPage(28, question), {top: .9042, bottom: .9189, label: '当前'});
  assert.deepEqual(practiceGuideForPage(29, question), {top: .1018, bottom: .2313, label: '续'});
  assert.equal(practiceGuideForPage(30, question), null);
  assert.equal(practiceChoiceAt(practiceQuestionForPage(28, question), .2, .91), null);
  assert.equal(practiceSourceRegions(question).length, 2, 'cross-page notice includes prompt-only pages');
});

test('middle text pages and diagrams after all options remain part of the same Exercise', () => {
  const question = {page: 8, promptY: .7,
    sourceRegions: [{page: 8, top: .7, bottom: .9}, {page: 9, top: .1, bottom: .8}, {page: 10, top: .1, bottom: .6}],
    regions: [{page: 8, options: [...'ABCD'].map(choice => ({choice, rect: [.2, .8, .4, .9]}))}]};
  assert.equal(practiceSourceRegions(question).length, 3);
  for (const [index, source] of question.sourceRegions.entries()) {
    const guide = practiceGuideForPage(source.page, question);
    assert.deepEqual(guide, {top: source.top, bottom: source.bottom, label: index ? '续' : '当前'});
  }
  assert.equal(practiceQuestionForPage(9, question), null);
  assert.equal(practiceQuestionForPage(10, question), null);
  assert.equal(practiceChoiceAt(practiceQuestionForPage(10, question), .3, .2), null);
});

test('legacy fixture coverage retains first page and split option pages', () => {
  const question = PRACTICE_QUESTIONS_524.find(item => item.number === 109);
  assert.deepEqual(practiceSourceRegions(question).map(region => region.page), [227, 228]);
  assert.equal(practiceGuideForPage(227, question).label, '当前');
  assert.equal(practiceGuideForPage(228, question).label, '续');
});

test('saved demo questions remain locatable while generated OCR is partial', () => {
  try {
    replacePracticeSections([{id: '126', title: '1.2.6', entryPage: 19, entryTop: .7,
      questions: [{number: 2, label: 2, page: 19, regions: []}]},
    {id: 'other', title: 'other', entryPage: 26, entryTop: .3, questions: [{number: 999, label: 1}]}], PRACTICE_BOOK_SHA256);
    assert.equal(PRACTICE_SECTIONS.find(section => section.id === '126').questions.length, 16);
    assert.ok(PRACTICE_SECTIONS.some(section => section.id === '524'));
    assert.ok(PRACTICE_SECTIONS.some(section => section.id === 'other'));
  } finally {
    replacePracticeSections(null);
  }
});

test('another book receives only its generated sections', () => {
  try {
    replacePracticeSections([{id: 'new', title: 'new', entryPage: 2, questions: []}], 'f'.repeat(64));
    assert.deepEqual(PRACTICE_SECTIONS.map(section => section.id), ['new']);
  } finally {
    replacePracticeSections(null);
  }
});
