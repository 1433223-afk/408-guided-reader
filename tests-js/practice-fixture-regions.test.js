import test from 'node:test';
import assert from 'node:assert/strict';
import {PRACTICE_QUESTIONS, PRACTICE_QUESTIONS_524, PRACTICE_SECTIONS,
  replacePracticeSections, practiceQuestionForPage, practiceChoiceAt} from '../src/reader_service/static/practice-fixture.js';

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

test('saved demo questions remain locatable while generated OCR is partial', () => {
  try {
    replacePracticeSections([{id: '126', title: '1.2.6', entryPage: 19, entryTop: .7,
      questions: [{number: 2, label: 2, page: 19, regions: []}]},
    {id: 'other', title: 'other', entryPage: 26, entryTop: .3, questions: [{number: 999, label: 1}]}]);
    assert.equal(PRACTICE_SECTIONS.find(section => section.id === '126').questions.length, 16);
    assert.ok(PRACTICE_SECTIONS.some(section => section.id === '524'));
    assert.ok(PRACTICE_SECTIONS.some(section => section.id === 'other'));
  } finally {
    replacePracticeSections(null);
  }
});
