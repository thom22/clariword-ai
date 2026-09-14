import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySelection,
  findSentenceAround,
  normalizeTerm,
  normalizeWhitespace,
  parsePhonetic,
  splitSentences,
  stableId,
  truncate,
  wordCount,
} from '@/shared/text';

test('normalizeWhitespace collapses the whitespace real pages contain', () => {
  assert.equal(normalizeWhitespace('  the   policy s  '), 'the policy s');
  assert.equal(normalizeWhitespace('a\n\nb\tc'), 'a b c');
});

test('normalizeTerm produces a stable de-duplication key', () => {
  assert.equal(normalizeTerm('Ostensibly,'), 'ostensibly');
  assert.equal(normalizeTerm('  “pragmatic”  '), 'pragmatic');
  assert.equal(normalizeTerm("don't"), "don't");
  assert.equal(normalizeTerm('Ostensibly'), normalizeTerm('ostensibly.'));
});

test('classifySelection distinguishes words, phrases, sentences and passages', () => {
  assert.equal(classifySelection('ostensibly'), 'word');
  assert.equal(classifySelection('move the goalposts'), 'phrase');
  assert.equal(
    classifySelection("The policy's ostensibly pragmatic approach belies a deeper ideological shift."),
    'sentence',
  );
  assert.equal(classifySelection('One sentence here. And a second one follows.'), 'passage');
  assert.equal(classifySelection(`${'word '.repeat(70)}`.trim()), 'passage');
});

test('wordCount ignores padding', () => {
  assert.equal(wordCount('  a  b   c '), 3);
  assert.equal(wordCount(''), 0);
});

test('splitSentences keeps abbreviations and decimals intact', () => {
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  assert.deepEqual(splitSentences('Dr. Smith arrived. He was late.'), ['Dr. Smith arrived.', 'He was late.']);
  assert.deepEqual(splitSentences('It cost 3.5 million. Really.'), ['It cost 3.5 million.', 'Really.']);
  assert.deepEqual(splitSentences('“Stop!” she said. Then silence.'), ['“Stop!” she said.', 'Then silence.']);
});

test('findSentenceAround returns the sentence plus its neighbours', () => {
  const paragraph =
    'Ministers announced the change. The policy is ostensibly pragmatic. Critics disagreed loudly.';
  const found = findSentenceAround(paragraph, 'ostensibly');
  assert.equal(found.sentence, 'The policy is ostensibly pragmatic.');
  assert.equal(found.previous, 'Ministers announced the change.');
  assert.equal(found.next, 'Critics disagreed loudly.');
});

test('findSentenceAround degrades gracefully when the selection is not found', () => {
  const found = findSentenceAround('Some text here.', 'absent');
  assert.equal(typeof found.sentence, 'string');
  assert.equal(found.previous, '');
});

test('parsePhonetic finds the stressed syllable', () => {
  assert.deepEqual(parsePhonetic('os-TEN-suh-blee'), {
    syllables: ['os', 'TEN', 'suh', 'blee'],
    stressIndex: 1,
  });
  assert.deepEqual(parsePhonetic(''), { syllables: [], stressIndex: -1 });
});

test('truncate cuts on a word boundary', () => {
  assert.equal(truncate('the quick brown fox jumps', 12), 'the quick…');
  assert.equal(truncate('short', 40), 'short');
});

test('stableId is deterministic and differs per input', () => {
  assert.equal(stableId('ostensibly'), stableId('ostensibly'));
  assert.notEqual(stableId('ostensibly'), stableId('pragmatic'));
});
