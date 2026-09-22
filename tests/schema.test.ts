import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonLoose, validateChatAnswer, validateExplanation } from '@/shared/schema';
import { ClariError } from '@/shared/errors';
import { MemoryStore } from '@/services/storage-service';
import { runMigrations } from '@/services/migrations';
import { DEFAULT_SETTINGS } from '@/shared/defaults';
import { DEFAULT_BACKEND_URL } from '@/shared/constants';
import type { Settings } from '@/types';

/** A KeyValueStore preloaded with the state an existing install would hold. */
async function storeWith(entries: Record<string, unknown>): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.set(entries);
  return store;
}

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

test('an install still holding the old localhost default is moved to the hosted service', async () => {
  const store = await storeWith({
    'clariword.schemaVersion': 1,
    'clariword.settings': { ...DEFAULT_SETTINGS, aiMode: 'mock', backendUrl: 'http://localhost:8787' },
  });

  await runMigrations(store);

  const settings = await store.get<Settings>('clariword.settings');
  assert.equal(settings?.backendUrl, DEFAULT_BACKEND_URL);
  assert.equal(settings?.aiMode, 'backend');
});

test('a backend URL the user chose themselves is left alone', async () => {
  const chosen = 'https://my-own-server.example.com';
  const store = await storeWith({
    'clariword.schemaVersion': 1,
    'clariword.settings': { ...DEFAULT_SETTINGS, aiMode: 'backend', backendUrl: chosen },
  });

  await runMigrations(store);

  const settings = await store.get<Settings>('clariword.settings');
  assert.equal(settings?.backendUrl, chosen, 'a deliberate choice must survive the migration');
});

test('installs on the old 1200-character limit are brought down to 900', async () => {
  const store = await storeWith({
    'clariword.schemaVersion': 2,
    'clariword.settings': { ...DEFAULT_SETTINGS, maxSelectionChars: 1200 },
  });

  await runMigrations(store);

  const settings = await store.get<Settings>('clariword.settings');
  assert.equal(settings?.maxSelectionChars, 900);
});

test('a selection limit the user chose themselves is left alone', async () => {
  const store = await storeWith({
    'clariword.schemaVersion': 2,
    'clariword.settings': { ...DEFAULT_SETTINGS, maxSelectionChars: 2500 },
  });

  await runMigrations(store);

  const settings = await store.get<Settings>('clariword.settings');
  assert.equal(settings?.maxSelectionChars, 2500, 'a deliberate choice must survive');
});
