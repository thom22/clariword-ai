import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '@/services/storage-service';
import {
  buildEntry,
  buildReviewQuestions,
  deriveStatus,
  filterEntries,
  mergeEncounter,
  scheduleNextReview,
  sortEntries,
  summariseExplanation,
  VocabularyRepository,
} from '@/services/vocabulary-service';
import { createReviewState } from '@/shared/defaults';
import type { NewVocabularyInput, VocabularyEntry, WordExplanation } from '@/types';

const explanation: WordExplanation = {
  type: 'word',
  word: 'ostensibly',
  ipa: '/ɑːˈstɛnsəbli/',
  phonetic: 'os-TEN-suh-blee',
  partOfSpeech: 'adverb',
  contextualMeaning: 'Appears true but may not be.',
  simpleMeaning: 'Apparently, but perhaps not actually.',
  authorIntent: 'The wording suggests doubt.',
  tone: 'Formal',
  register: 'Journalistic',
  synonyms: ['apparently'],
  naturalAlternative: 'apparently',
  example: 'It was ostensibly free.',
  sentenceExplanation: 'The policy looks practical.',
  confidence: 'high',
};

function input(overrides: Partial<NewVocabularyInput['context']> = {}): NewVocabularyInput {
  return {
    context: {
      selectedText: 'ostensibly',
      sentence: "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
      previousSentence: '',
      nextSentence: '',
      pageTitle: 'Why AI Regulation Is Becoming More Complicated',
      pageUrl: 'https://example.com/article',
      pageDomain: 'example.com',
      ...overrides,
    },
    kind: 'word',
    explanation,
    saveSourcePage: true,
  };
}

test('buildEntry captures the word and where it was met', () => {
  const entry = buildEntry(input(), 1_000);
  assert.equal(entry.term, 'ostensibly');
  assert.equal(entry.normalized, 'ostensibly');
  assert.equal(entry.definition, 'Apparently, but perhaps not actually.');
  assert.equal(entry.contextualMeaning, 'Appears true but may not be.');
  assert.match(entry.originalSentence, /belies a deeper ideological shift/);
  assert.equal(entry.source?.domain, 'example.com');
  assert.equal(entry.encounterCount, 1);
  assert.equal(entry.status, 'new');
});

test('saveSourcePage:false keeps the page out of storage', () => {
  const entry = buildEntry({ ...input(), saveSourcePage: false });
  assert.equal(entry.source, null);
  assert.equal(entry.encounters[0]?.url, '');
  assert.ok(entry.originalSentence, 'the sentence itself is still the memory hook');
});

test('summariseExplanation handles every explanation shape', () => {
  assert.equal(summariseExplanation(null).definition, '');
  assert.equal(
    summariseExplanation({
      type: 'phrase',
      phrase: 'move the goalposts',
      meaning: 'change the rules midway',
      contextualMeaning: 'here: unfairly',
      figurative: true,
      register: 'informal',
      tone: 'critical',
      example: 'again!',
      alternatives: ['shift the criteria'],
      keyVocabulary: [],
      confidence: 'high',
    }).partOfSpeech,
    'idiom',
  );
});

test('the same word met again bumps the counter instead of duplicating', () => {
  const first = buildEntry(input(), 1_000);
  const second = mergeEncounter(first, input({ sentence: 'A different sentence entirely.' }), 200_000);
  assert.equal(second.id, first.id);
  assert.equal(second.encounterCount, 2);
  assert.equal(second.encounters.length, 2);
  assert.equal(second.encounters[0]?.sentence, 'A different sentence entirely.');
});

test('the same sighting twice in a minute is not double counted', () => {
  const first = buildEntry(input(), 1_000);
  const again = mergeEncounter(first, input(), 5_000);
  assert.equal(again.encounterCount, 1);
});

test('review scheduling lengthens on success and resets on failure', () => {
  const start = createReviewState(0);
  const first = scheduleNextReview(start, true, 0);
  assert.equal(first.repetitions, 1);
  assert.equal(first.intervalDays, 1);
  const second = scheduleNextReview(first, true, 0);
  assert.equal(second.intervalDays, 3);
  const third = scheduleNextReview(second, true, 0);
  assert.ok(third.intervalDays > 3);

  const lapsed = scheduleNextReview(third, false, 0);
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.intervalDays, 1);
  assert.equal(lapsed.lapses, 1);
  assert.ok(lapsed.ease < third.ease);
});

test('status advances with successful reviews', () => {
  let entry = buildEntry(input(), 1_000);
  assert.equal(deriveStatus(entry), 'new');
  entry = { ...entry, review: scheduleNextReview(entry.review, true, 0) };
  assert.equal(deriveStatus(entry), 'learning');
  for (let i = 0; i < 3; i += 1) entry = { ...entry, review: scheduleNextReview(entry.review, true, 0) };
  assert.equal(deriveStatus(entry), 'mastered');
});

test('filtering and sorting drive the dashboard collections', () => {
  const a = { ...buildEntry(input(), 1_000), status: 'new' as const, encounterCount: 1 };
  const b = { ...buildEntry(input({ selectedText: 'pragmatic' }), 2_000), status: 'mastered' as const, encounterCount: 5, favorite: true };
  const entries: VocabularyEntry[] = [a, b];

  assert.equal(filterEntries(entries, { status: 'mastered' }).length, 1);
  assert.equal(filterEntries(entries, { status: 'favorites' }).length, 1);
  assert.equal(filterEntries(entries, { search: 'ideological' }).length, 2, 'search covers the saved sentence');
  assert.equal(sortEntries(entries, 'encounters')[0]?.normalized, 'pragmatic');
  assert.equal(sortEntries(entries, 'recent')[0]?.normalized, 'pragmatic');
});

test('review questions always contain the right answer exactly once', () => {
  const entries = ['ostensibly', 'pragmatic', 'belies', 'ubiquitous'].map((word, index) => ({
    ...buildEntry(input({ selectedText: word }), 1_000 + index),
    definition: `meaning of ${word}`,
  }));
  const questions = buildReviewQuestions(entries, 4, () => 0.42);

  assert.equal(questions.length, 4);
  for (const question of questions) {
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices).size, 4, 'no duplicate options');
    assert.ok(question.correctIndex >= 0 && question.correctIndex < 4);
    assert.ok(question.originalSentence.length > 0, 'the original sentence comes back with the question');
  }
});

test('review questions still work when only one word is saved', () => {
  const entries = [{ ...buildEntry(input(), 1_000), definition: 'apparently' }];
  const [question] = buildReviewQuestions(entries, 5, () => 0.1);
  assert.ok(question);
  assert.equal(question?.choices.length, 4);
  assert.equal(question?.choices[question.correctIndex], 'apparently');
});

test('the repository de-duplicates, updates and deletes', async () => {
  const repository = new VocabularyRepository(new MemoryStore());

  const first = await repository.save(input(), 1_000);
  assert.equal(first.created, true);

  const second = await repository.save(input({ sentence: 'Seen somewhere else entirely.' }), 500_000);
  assert.equal(second.created, false, 'the same word is merged, not duplicated');
  assert.equal(second.entry.encounterCount, 2);
  assert.equal((await repository.all()).length, 1);

  const found = await repository.findByText('Ostensibly,');
  assert.equal(found?.id, first.entry.id, 'lookup is punctuation- and case-insensitive');

  await repository.update(first.entry.id, { favorite: true });
  assert.equal((await repository.get(first.entry.id))?.favorite, true);

  const reviewed = await repository.recordReview(first.entry.id, true, 1_000);
  assert.equal(reviewed?.review.repetitions, 1);
  assert.ok((reviewed?.review.due ?? 0) > 1_000, 'a correct answer pushes the next review out');

  assert.equal(await repository.remove(first.entry.id), true);
  assert.equal((await repository.all()).length, 0);
});

test('recordEncounter only counts words the user actually saved', async () => {
  const repository = new VocabularyRepository(new MemoryStore());
  assert.equal(await repository.recordEncounter(input()), null);

  await repository.save(input(), 1_000);
  const bumped = await repository.recordEncounter(input({ sentence: 'Elsewhere.' }), 900_000);
  assert.equal(bumped?.encounterCount, 2);
});

test('due() skips mastered words', async () => {
  const repository = new VocabularyRepository(new MemoryStore());
  const saved = await repository.save(input(), 1_000);
  assert.equal((await repository.due(2_000)).length, 1);
  await repository.update(saved.entry.id, { status: 'mastered' });
  assert.equal((await repository.due(2_000)).length, 0);
});
