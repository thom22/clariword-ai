import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonLoose, validateChatAnswer, validateExplanation } from '@/shared/schema';
import { ClariError } from '@/shared/errors';

const validWord = {
  type: 'word',
  word: 'ostensibly',
  ipa: 'ɑːˈstɛnsəbli',
  phonetic: 'os-TEN-suh-blee',
  partOfSpeech: 'adverb',
  contextualMeaning: 'Appears true but may not be.',
  simpleMeaning: 'Apparently.',
  authorIntent: 'The wording suggests doubt.',
  tone: 'Formal',
  synonyms: ['apparently', 'seemingly'],
  example: 'It was ostensibly free.',
};

test('a well-formed word payload survives validation', () => {
  const result = validateExplanation(validWord);
  assert.equal(result.type, 'word');
  if (result.type !== 'word') return;
  assert.equal(result.word, 'ostensibly');
  assert.equal(result.ipa, '/ɑːˈstɛnsəbli/', 'IPA is normalised to slash form');
  assert.deepEqual(result.synonyms, ['apparently', 'seemingly']);
  assert.equal(result.confidence, 'medium', 'missing confidence defaults rather than failing');
});

test('missing required fields are rejected, not rendered', () => {
  assert.throws(() => validateExplanation({ ...validWord, contextualMeaning: '' }), (error: unknown) => {
    assert.ok(error instanceof ClariError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
  assert.throws(() => validateExplanation({ type: 'nonsense' }), ClariError);
  assert.throws(() => validateExplanation('not an object'), ClariError);
});

test('decorative fields are coerced rather than fatal', () => {
  const result = validateExplanation({ ...validWord, synonyms: 'not an array', tone: 42 });
  if (result.type !== 'word') throw new Error('wrong type');
  assert.deepEqual(result.synonyms, []);
  assert.equal(result.tone, '');
});

test('runaway generations are length-capped', () => {
  const result = validateExplanation({ ...validWord, contextualMeaning: 'x'.repeat(5000) });
  if (result.type !== 'word') throw new Error('wrong type');
  assert.ok(result.contextualMeaning.length <= 1201, result.contextualMeaning.length.toString());
});

test('sentence payloads keep only well-formed segments', () => {
  const result = validateExplanation({
    type: 'sentence',
    simpleMeaning: 'It looks practical.',
    segments: [
      { text: 'The approach', meaning: 'the way it is done' },
      { text: 'missing meaning' },
      'garbage',
    ],
    keyVocabulary: ['belies', { word: 'pragmatic', gloss: 'practical' }],
  });
  if (result.type !== 'sentence') throw new Error('wrong type');
  assert.equal(result.segments.length, 1);
  assert.equal(result.keyVocabulary.length, 2);
  assert.equal(result.keyVocabulary[1]?.gloss, 'practical');
});

test('parseJsonLoose survives fenced and chatty model output', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! Here you go: {"a":1} hope that helps'), { a: 1 });
  assert.equal(parseJsonLoose('no json here'), undefined);
});

test('chat answers must not be empty', () => {
  assert.equal(validateChatAnswer({ answer: ' hello ' }), 'hello');
  assert.equal(validateChatAnswer('plain string'), 'plain string');
  assert.throws(() => validateChatAnswer({ answer: '' }), ClariError);
});
