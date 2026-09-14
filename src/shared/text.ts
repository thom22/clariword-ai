import { PHRASE_MAX_WORDS, SENTENCE_MAX_WORDS } from '@/shared/constants';
import type { SelectionKind } from '@/types';

/** Collapse runs of whitespace (including the NBSPs sites love) into spaces. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lowercased, punctuation-free key used to de-duplicate vocabulary entries. */
export function normalizeTerm(input: string): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '')
    .replace(/[.,;:!?"()[\]{}]/g, '');
}

export function wordCount(input: string): number {
  const trimmed = normalizeWhitespace(input);
  if (!trimmed) return 0;
  return trimmed.split(' ').filter(Boolean).length;
}

/**
 * Decide which explanation shape the selection needs.
 *
 * The distinction matters: a single word wants a contextual definition, a short
 * run of words wants to be read as a unit (idioms), and anything with sentence
 * punctuation wants a breakdown rather than a pile of definitions.
 */
export function classifySelection(raw: string): SelectionKind {
  const text = normalizeWhitespace(raw);
  const words = wordCount(text);
  if (words === 0) return 'word';
  if (words === 1) return 'word';

  // Sentence-ending punctuation *inside* the selection means multiple sentences.
  const internalTerminators = (text.slice(0, -1).match(/[.!?](\s|$)/g) ?? []).length;
  if (internalTerminators >= 1 || words > SENTENCE_MAX_WORDS) return 'passage';

  const endsLikeSentence = /[.!?]["')\]]?$/.test(text);
  const startsCapitalised = /^[A-ZÀ-Þ]/.test(text);
  if (endsLikeSentence && startsCapitalised) return 'sentence';
  if (words <= PHRASE_MAX_WORDS) return 'phrase';
  return 'sentence';
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e',
  'fig', 'al', 'inc', 'ltd', 'co', 'approx', 'no', 'vol', 'pp',
]);

/**
 * Split text into sentences. Deliberately small and dependency-free: it only
 * has to be good enough to pick the sentence around a selection.
 */
export function splitSentences(input: string): string[] {
  const text = normalizeWhitespace(input);
  if (!text) return [];
  const out: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '.' && char !== '!' && char !== '?') continue;

    // Consume runs like "?!" or "..."
    let end = i;
    while (end + 1 < text.length && '.!?'.includes(text[end + 1] as string)) end += 1;

    let after = end + 1;
    // Closing quotes/brackets belong to the sentence that is ending.
    let closedQuote = false;
    while (after < text.length && `"')]’”`.includes(text[after] as string)) {
      closedQuote = true;
      after += 1;
    }

    const next = text[after];
    if (next !== undefined && next !== ' ') {
      i = end;
      continue;
    }
    // “Stop!” she said. — a quotation inside a sentence is not a break, which
    // a lower-case word after the closing quote reliably signals.
    if (closedQuote && /^\s+\p{Ll}/u.test(text.slice(after))) {
      i = end;
      continue;
    }

    const candidate = text.slice(start, after);
    const lastToken = candidate.split(' ').pop() ?? '';
    const bare = lastToken.replace(/[^\p{L}.]/gu, '').replace(/\.$/, '').toLowerCase();
    const isAbbrev = char === '.' && (ABBREVIATIONS.has(bare) || /^\p{Lu}$/u.test(lastToken.replace('.', '')));
    // "1. " in a numbered list, or a decimal, is not a sentence break.
    const isEnumeration = char === '.' && /\d$/.test(candidate.slice(0, -1));

    if (!isAbbrev && !isEnumeration) {
      out.push(candidate.trim());
      start = after + 1;
    }
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

export interface SentenceNeighbourhood {
  sentence: string;
  previous: string;
  next: string;
}

/**
 * Find the sentence containing `selection` within `haystack`, plus its
 * neighbours. Falls back gracefully when the selection spans sentences.
 */
export function findSentenceAround(haystack: string, selection: string): SentenceNeighbourhood {
  const text = normalizeWhitespace(haystack);
  const needle = normalizeWhitespace(selection);
  const sentences = splitSentences(text);
  if (sentences.length === 0) return { sentence: needle, previous: '', next: '' };

  let index = sentences.findIndex((s) => s.includes(needle));

  if (index === -1 && needle) {
    // The selection may straddle a boundary; use the first sentence that shares
    // a meaningful chunk of its head.
    const head = needle.slice(0, Math.min(24, needle.length));
    index = sentences.findIndex((s) => s.includes(head));
  }
  if (index === -1) {
    const lower = needle.toLowerCase();
    index = sentences.findIndex((s) => s.toLowerCase().includes(lower));
  }
  if (index === -1) return { sentence: needle || (sentences[0] ?? ''), previous: '', next: '' };

  return {
    sentence: sentences[index] ?? needle,
    previous: index > 0 ? sentences[index - 1] ?? '' : '',
    next: index < sentences.length - 1 ? sentences[index + 1] ?? '' : '',
  };
}

/** Truncate on a word boundary, appending an ellipsis when text was dropped. */
export function truncate(input: string, maxChars: number): string {
  const text = normalizeWhitespace(input);
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Split a reader-friendly respelling ("os-TEN-suh-blee") into syllables and
 * report which one carries primary stress (the ALL-CAPS one).
 */
export function parsePhonetic(phonetic: string): { syllables: string[]; stressIndex: number } {
  const cleaned = normalizeWhitespace(phonetic).replace(/[‐-―]/g, '-');
  const syllables = cleaned.split(/[-·]/).map((s) => s.trim()).filter(Boolean);
  if (syllables.length === 0) return { syllables: [], stressIndex: -1 };
  const stressIndex = syllables.findIndex((s) => /^[A-Z]{2,}$/.test(s) || (/^[A-Z]+$/.test(s) && s.length >= 1));
  return { syllables, stressIndex };
}

/** Stable, short, dependency-free hash. Used for vocabulary entry ids. */
export function stableId(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(36);
}

/** Title-ish display form for a term without destroying acronyms. */
export function displayTerm(raw: string): string {
  const text = normalizeWhitespace(raw);
  return text.replace(/^[^\p{L}\p{N}"'‘“]+/u, '').replace(/[^\p{L}\p{N}%)"'’”.!?]+$/u, '');
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** YYYY-MM-DD in the *local* timezone (stats are a human, local-day notion). */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const diff = now - timestamp;
  const day = 86_400_000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 2 * day) return 'yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
