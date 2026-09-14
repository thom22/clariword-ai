import { Errors } from '@/shared/errors';
import { normalizeWhitespace } from '@/shared/text';
import type {
  Confidence,
  Explanation,
  KeyVocabularyItem,
  PassageExplanation,
  PhraseExplanation,
  Segment,
  SentenceExplanation,
  WordExplanation,
} from '@/types';

/**
 * Validation for anything that came from a model.
 *
 * Rules of the house:
 *  - Required fields must be present and non-empty, or the payload is rejected.
 *  - Optional/decorative fields are coerced to safe defaults rather than
 *    failing the whole response, so one missing synonym never blanks the card.
 *  - Every string is length-capped: a runaway generation must not be able to
 *    blow up the injected card.
 */

const MAX_FIELD = 1200;
const MAX_LIST = 12;

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = MAX_FIELD): string {
  if (typeof value !== 'string') return '';
  const text = normalizeWhitespace(value);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function requiredStr(value: unknown, field: string, max = MAX_FIELD): string {
  const text = str(value, max);
  if (!text) throw Errors.invalidResponse(`missing or empty field "${field}"`);
  return text;
}

function strList(value: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v, 240)).filter(Boolean).slice(0, max);
}

function confidence(value: unknown): Confidence {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function segments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({ text: str(item.text, 300), meaning: str(item.meaning, 600) }))
    .filter((s) => s.text && s.meaning)
    .slice(0, 20);
}

function keyVocabulary(value: unknown): KeyVocabularyItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): KeyVocabularyItem | null => {
      if (typeof item === 'string') {
        const word = str(item, 80);
        return word ? { word, gloss: '' } : null;
      }
      if (!isObject(item)) return null;
      const word = str(item.word, 80);
      if (!word) return null;
      const entry: KeyVocabularyItem = { word, gloss: str(item.gloss, 240) };
      const ipa = str(item.ipa, 80);
      if (ipa) entry.ipa = ipa;
      return entry;
    })
    .filter((item): item is KeyVocabularyItem => item !== null)
    .slice(0, MAX_LIST);
}

/** Normalise IPA to the slash-wrapped form readers expect. */
function normalizeIpa(value: unknown): string {
  const raw = str(value, 120).replace(/^[/[]|[/\]]$/g, '').trim();
  return raw ? `/${raw}/` : '';
}

function validateWord(raw: Raw): WordExplanation {
  return {
    type: 'word',
    word: requiredStr(raw.word, 'word', 120),
    ipa: normalizeIpa(raw.ipa),
    phonetic: str(raw.phonetic, 120),
    partOfSpeech: str(raw.partOfSpeech, 60),
    contextualMeaning: requiredStr(raw.contextualMeaning, 'contextualMeaning'),
    simpleMeaning: str(raw.simpleMeaning) || str(raw.contextualMeaning),
    authorIntent: str(raw.authorIntent),
    tone: str(raw.tone, 120),
    register: str(raw.register, 120),
    synonyms: strList(raw.synonyms, 8),
    naturalAlternative: str(raw.naturalAlternative, 120),
    example: str(raw.example),
    sentenceExplanation: str(raw.sentenceExplanation),
    confidence: confidence(raw.confidence),
    ...(str(raw.ambiguityNote) ? { ambiguityNote: str(raw.ambiguityNote) } : {}),
  };
}

function validateSentence(raw: Raw): SentenceExplanation {
  return {
    type: 'sentence',
    simpleMeaning: requiredStr(raw.simpleMeaning, 'simpleMeaning'),
    authorMeaning: str(raw.authorMeaning),
    tone: str(raw.tone, 120),
    register: str(raw.register, 120),
    simplifiedRewrite: str(raw.simplifiedRewrite),
    segments: segments(raw.segments),
    keyVocabulary: keyVocabulary(raw.keyVocabulary),
    confidence: confidence(raw.confidence),
    ...(str(raw.grammarNote) ? { grammarNote: str(raw.grammarNote) } : {}),
  };
}

function validatePhrase(raw: Raw): PhraseExplanation {
  return {
    type: 'phrase',
    phrase: requiredStr(raw.phrase, 'phrase', 200),
    meaning: requiredStr(raw.meaning, 'meaning'),
    contextualMeaning: str(raw.contextualMeaning) || str(raw.meaning),
    figurative: bool(raw.figurative, false),
    register: str(raw.register, 120),
    tone: str(raw.tone, 120),
    example: str(raw.example),
    alternatives: strList(raw.alternatives, 8),
    keyVocabulary: keyVocabulary(raw.keyVocabulary),
    confidence: confidence(raw.confidence),
    ...(str(raw.literalMeaning) ? { literalMeaning: str(raw.literalMeaning) } : {}),
  };
}

function validatePassage(raw: Raw): PassageExplanation {
  return {
    type: 'passage',
    summary: requiredStr(raw.summary ?? raw.simpleMeaning, 'summary'),
    simpleMeaning: str(raw.simpleMeaning) || str(raw.summary),
    tone: str(raw.tone, 120),
    register: str(raw.register, 120),
    keyPoints: strList(raw.keyPoints, 8),
    segments: segments(raw.segments),
    keyVocabulary: keyVocabulary(raw.keyVocabulary),
    simplifiedRewrite: str(raw.simplifiedRewrite, 2000),
    confidence: confidence(raw.confidence),
  };
}

/** Throws ClariError('INVALID_RESPONSE') rather than returning junk. */
export function validateExplanation(value: unknown): Explanation {
  if (!isObject(value)) throw Errors.invalidResponse('response was not a JSON object');
  switch (value.type) {
    case 'word':
      return validateWord(value);
    case 'sentence':
      return validateSentence(value);
    case 'phrase':
      return validatePhrase(value);
    case 'passage':
      return validatePassage(value);
    default:
      throw Errors.invalidResponse(`unknown explanation type "${String(value.type)}"`);
  }
}

/**
 * Parse JSON that a model may have wrapped in prose or a ``` fence.
 * Returns `undefined` rather than throwing so callers can decide.
 */
export function parseJsonLoose(input: string): unknown {
  const trimmed = input.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const parsed = tryParse(fence[1].trim());
    if (parsed !== undefined) return parsed;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) return tryParse(trimmed.slice(first, last + 1));
  return undefined;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Validate a chat answer: plain prose, length-capped, never empty. */
export function validateChatAnswer(value: unknown): string {
  const raw = isObject(value) ? value.answer : value;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw Errors.invalidResponse('chat response had no answer');
  return text.length > 4000 ? `${text.slice(0, 4000).trimEnd()}…` : text;
}
