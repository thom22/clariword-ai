import { MOCK_PHRASES, MOCK_SENTENCES, MOCK_WORDS, type MockWordEntry } from '@/services/mock-lexicon';
import { normalizeTerm, normalizeWhitespace, splitSentences, truncate } from '@/shared/text';
import type {
  ChatRequest,
  Explanation,
  ExplainRequest,
  ExplanationLevel,
  KeyVocabularyItem,
  PassageExplanation,
  PhraseExplanation,
  Segment,
  SentenceExplanation,
  WordExplanation,
} from '@/types';

/**
 * Demo mode.
 *
 * Curated entries in mock-lexicon.ts are real lexicography. Anything outside
 * that list gets a structurally complete response whose text says plainly that
 * it is placeholder — demo mode must never pass invented definitions off as
 * knowledge.
 */

const DEMO_PREFIX = 'Demo mode —';

function demoNote(subject: string): string {
  return `${DEMO_PREFIX} ClariWord has no offline entry for ${subject}. Live explanations will return once the service is reachable again.`;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

function restateSentence(sentence: string, word: string): string {
  const clean = normalizeWhitespace(sentence);
  if (!clean || normalizeTerm(clean) === normalizeTerm(word)) return '';
  const curated = MOCK_SENTENCES[normalizeTerm(clean)];
  if (curated) return curated.authorMeaning;
  return `In this sentence — “${truncate(clean, 180)}” — the word is doing the job described above.`;
}

function applyWordLevel(entry: MockWordEntry, level: ExplanationLevel): {
  contextualMeaning: string;
  simpleMeaning: string;
  authorIntent: string;
  register: string;
} {
  switch (level) {
    case 'beginner':
      return {
        contextualMeaning: entry.beginnerMeaning,
        simpleMeaning: entry.beginnerMeaning,
        authorIntent: '',
        register: '',
      };
    case 'advanced':
      return {
        contextualMeaning: entry.contextualMeaning,
        simpleMeaning: entry.simpleMeaning,
        authorIntent: entry.authorIntent,
        register: entry.register,
      };
    case 'intermediate':
    default:
      return {
        contextualMeaning: entry.contextualMeaning,
        simpleMeaning: entry.simpleMeaning,
        authorIntent: entry.authorIntent,
        register: entry.register,
      };
  }
}

function mockWord(request: ExplainRequest): WordExplanation {
  const raw = normalizeWhitespace(request.context.selectedText);
  const key = normalizeTerm(raw);
  const entry = MOCK_WORDS[key];

  if (!entry) {
    return {
      type: 'word',
      word: raw,
      ipa: '',
      phonetic: '',
      partOfSpeech: '',
      contextualMeaning: demoNote(`“${raw}”`),
      simpleMeaning: 'Placeholder — no offline definition available.',
      authorIntent: '',
      tone: '',
      register: '',
      synonyms: [],
      naturalAlternative: '',
      example: '',
      sentenceExplanation: restateSentence(request.context.sentence, raw),
      confidence: 'low',
      ambiguityNote: `Try one of the built-in demo words: ${Object.keys(MOCK_WORDS).slice(0, 6).join(', ')}.`,
    };
  }

  const levelled = applyWordLevel(entry, request.explanationLevel);
  return {
    type: 'word',
    word: entry.word,
    ipa: entry.ipa[request.accent],
    phonetic: entry.phonetic,
    partOfSpeech: entry.partOfSpeech,
    contextualMeaning: levelled.contextualMeaning,
    simpleMeaning: levelled.simpleMeaning,
    authorIntent: levelled.authorIntent,
    tone: entry.tone,
    register: levelled.register,
    synonyms: request.explanationLevel === 'beginner' ? entry.synonyms.slice(0, 2) : entry.synonyms,
    naturalAlternative: entry.naturalAlternative,
    example: entry.example,
    sentenceExplanation: restateSentence(request.context.sentence, entry.word),
    confidence: 'high',
  };
}

/* ------------------------------------------------------------------ */
/* Phrases                                                             */
/* ------------------------------------------------------------------ */

function mockPhrase(request: ExplainRequest): PhraseExplanation {
  const raw = normalizeWhitespace(request.context.selectedText);
  const entry = MOCK_PHRASES[normalizeTerm(raw)];
  if (entry) return { type: 'phrase', ...entry };

  return {
    type: 'phrase',
    phrase: raw,
    meaning: demoNote(`the phrase “${truncate(raw, 80)}”`),
    contextualMeaning: 'Placeholder — no offline entry for this phrase.',
    figurative: false,
    register: '',
    tone: '',
    example: '',
    alternatives: [],
    keyVocabulary: vocabularyFrom(raw),
    confidence: 'low',
  };
}

/* ------------------------------------------------------------------ */
/* Sentences + passages                                                */
/* ------------------------------------------------------------------ */

/** Any curated word appearing in the text becomes a real vocabulary hint. */
function vocabularyFrom(text: string): KeyVocabularyItem[] {
  const tokens = normalizeWhitespace(text).toLowerCase().split(/[^a-z'-]+/).filter(Boolean);
  const seen = new Set<string>();
  const out: KeyVocabularyItem[] = [];
  for (const token of tokens) {
    const entry = MOCK_WORDS[token];
    if (!entry || seen.has(token)) continue;
    seen.add(token);
    out.push({ word: entry.word, gloss: entry.simpleMeaning, ipa: entry.ipa.american });
    if (out.length >= 6) break;
  }
  return out;
}

/** Split a sentence into clause-sized chunks for the breakdown view. */
export function splitClauses(sentence: string): string[] {
  const text = normalizeWhitespace(sentence);
  if (!text) return [];
  const parts = text
    .split(/(?<=,)\s+|\s+(?=(?:but|although|though|because|while|whereas|which|that|and yet)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(0, 6) : [text];
}

function mockSentence(request: ExplainRequest): SentenceExplanation {
  const raw = normalizeWhitespace(request.context.selectedText);
  const curated = MOCK_SENTENCES[normalizeTerm(raw)];
  if (curated) {
    const base: SentenceExplanation = { type: 'sentence', ...curated };
    if (request.explanationLevel !== 'advanced') delete base.grammarNote;
    return base;
  }

  const segments: Segment[] = splitClauses(raw).map((text) => ({
    text,
    meaning: 'Placeholder — clause-by-clause meaning needs the AI backend.',
  }));

  return {
    type: 'sentence',
    simpleMeaning: demoNote('this sentence'),
    authorMeaning: '',
    tone: '',
    register: '',
    simplifiedRewrite: '',
    segments,
    keyVocabulary: vocabularyFrom(raw),
    confidence: 'low',
  };
}

function mockPassage(request: ExplainRequest): PassageExplanation {
  const raw = normalizeWhitespace(request.context.selectedText);
  const sentences = splitSentences(raw);
  return {
    type: 'passage',
    summary: demoNote('this passage'),
    simpleMeaning: '',
    tone: '',
    register: '',
    keyPoints: [],
    segments: sentences.slice(0, 6).map((text) => ({
      text: truncate(text, 200),
      meaning: 'Placeholder — sentence-by-sentence meaning needs the AI backend.',
    })),
    keyVocabulary: vocabularyFrom(raw),
    simplifiedRewrite: '',
    confidence: 'low',
  };
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export function createMockExplanation(request: ExplainRequest): Explanation {
  switch (request.kind) {
    case 'word':
      return mockWord(request);
    case 'phrase':
      return mockPhrase(request);
    case 'sentence':
      return mockSentence(request);
    case 'passage':
      return mockPassage(request);
  }
}

/** Deterministic, honest answers for the follow-up chat while in demo mode. */
export function createMockChatAnswer(request: ChatRequest): string {
  const question = request.question.toLowerCase();
  const selected = normalizeWhitespace(request.context.selectedText);
  const entry = MOCK_WORDS[normalizeTerm(selected)];

  if (entry) {
    if (/pronounc|say it|sound/.test(question)) {
      return `Say it as ${entry.phonetic} — the capitalised syllable takes the stress. IPA: ${entry.ipa.american} (US) / ${entry.ipa.british} (UK).`;
    }
    if (/formal|casual|conversation|everyday/.test(question)) {
      return `“${entry.word}” sits in ${entry.register.toLowerCase() || 'general'} English. In conversation most people would say “${entry.naturalAlternative}” instead.`;
    }
    if (/example/.test(question)) {
      return `Here is one: “${entry.example}”`;
    }
    if (/differen|versus|vs\b|compare/.test(question)) {
      return `The closest everyday word is “${entry.naturalAlternative}”. ${entry.authorIntent}`;
    }
    if (/beginner|simple|simpler|eli5/.test(question)) {
      return entry.beginnerMeaning;
    }
    if (/why/.test(question)) {
      return entry.authorIntent || entry.contextualMeaning;
    }
    return `${entry.contextualMeaning}\n\n${DEMO_PREFIX} follow-up answers are limited to the built-in entry for “${entry.word}”. Connect a backend for a real conversation.`;
  }

  return `${DEMO_PREFIX} follow-up questions need the ClariWord service, which is not reachable right now. Please try again in a moment.`;
}

/** Small, deterministic delay so loading states are visible while developing. */
export function mockLatencyMs(request: ExplainRequest): number {
  const base = request.kind === 'word' ? 260 : 420;
  return base + (normalizeTerm(request.context.selectedText).length % 7) * 20;
}
