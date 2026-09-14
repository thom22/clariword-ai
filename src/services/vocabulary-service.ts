import { MAX_ENCOUNTERS, STORAGE_KEYS } from '@/shared/constants';
import { createReviewState } from '@/shared/defaults';
import { displayTerm, domainOf, normalizeTerm, normalizeWhitespace, stableId, truncate } from '@/shared/text';
import { localStore, WriteQueue, type KeyValueStore } from '@/services/storage-service';
import type { VocabularyQuery } from '@/shared/messaging';
import type {
  Encounter,
  Explanation,
  LearningStatus,
  NewVocabularyInput,
  ReviewQuestion,
  ReviewState,
  VocabularyEntry,
} from '@/types';

type Collection = Record<string, VocabularyEntry>;

const STATUS_ORDER: LearningStatus[] = ['new', 'learning', 'familiar', 'mastered'];

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Pull the fields the dashboard needs out of whichever explanation shape arrived. */
export function summariseExplanation(explanation: Explanation | null): {
  definition: string;
  contextualMeaning: string;
  example: string;
  ipa: string;
  phonetic: string;
  partOfSpeech: string;
  synonyms: string[];
  tone: string;
  register: string;
} {
  const empty = {
    definition: '',
    contextualMeaning: '',
    example: '',
    ipa: '',
    phonetic: '',
    partOfSpeech: '',
    synonyms: [] as string[],
    tone: '',
    register: '',
  };
  if (!explanation) return empty;

  switch (explanation.type) {
    case 'word':
      return {
        definition: explanation.simpleMeaning,
        contextualMeaning: explanation.contextualMeaning,
        example: explanation.example,
        ipa: explanation.ipa,
        phonetic: explanation.phonetic,
        partOfSpeech: explanation.partOfSpeech,
        synonyms: explanation.synonyms,
        tone: explanation.tone,
        register: explanation.register,
      };
    case 'phrase':
      return {
        ...empty,
        definition: explanation.meaning,
        contextualMeaning: explanation.contextualMeaning,
        example: explanation.example,
        synonyms: explanation.alternatives,
        tone: explanation.tone,
        register: explanation.register,
        partOfSpeech: explanation.figurative ? 'idiom' : 'phrase',
      };
    case 'sentence':
      return {
        ...empty,
        definition: explanation.simpleMeaning,
        contextualMeaning: explanation.authorMeaning,
        example: explanation.simplifiedRewrite,
        tone: explanation.tone,
        register: explanation.register,
        partOfSpeech: 'sentence',
      };
    case 'passage':
      return {
        ...empty,
        definition: explanation.summary,
        contextualMeaning: explanation.simpleMeaning,
        example: explanation.simplifiedRewrite,
        tone: explanation.tone,
        register: explanation.register,
        partOfSpeech: 'passage',
      };
  }
}

export function buildEntry(input: NewVocabularyInput, now = Date.now()): VocabularyEntry {
  const { context, kind, explanation, saveSourcePage } = input;
  const term = displayTerm(context.selectedText);
  const normalized = normalizeTerm(term);
  const summary = summariseExplanation(explanation);
  const source = saveSourcePage
    ? { title: context.pageTitle, url: context.pageUrl, domain: context.pageDomain || domainOf(context.pageUrl) }
    : null;

  return {
    id: stableId(`${kind}:${normalized}`),
    term,
    normalized,
    kind,
    selectedText: normalizeWhitespace(context.selectedText),
    definition: summary.definition,
    contextualMeaning: summary.contextualMeaning,
    originalSentence: truncate(context.sentence, 600),
    exampleSentence: summary.example,
    ipa: summary.ipa,
    phonetic: summary.phonetic,
    partOfSpeech: summary.partOfSpeech,
    synonyms: summary.synonyms,
    tone: summary.tone,
    register: summary.register,
    source,
    createdAt: now,
    updatedAt: now,
    encounterCount: 1,
    encounters: [buildEncounter(input, now)],
    favorite: false,
    status: 'new',
    review: createReviewState(now),
    explanation,
    notes: '',
    tags: [],
  };
}

function buildEncounter(input: NewVocabularyInput, now: number): Encounter {
  const { context, saveSourcePage } = input;
  return {
    at: now,
    title: saveSourcePage ? context.pageTitle : '',
    url: saveSourcePage ? context.pageUrl : '',
    domain: context.pageDomain || domainOf(context.pageUrl),
    sentence: truncate(context.sentence, 400),
  };
}

/**
 * Fold a fresh sighting into an existing entry: bump the counter, remember
 * where it happened, and fill in any detail the first save was missing.
 */
export function mergeEncounter(
  existing: VocabularyEntry,
  input: NewVocabularyInput,
  now = Date.now(),
): VocabularyEntry {
  const encounter = buildEncounter(input, now);
  const summary = summariseExplanation(input.explanation);
  const sameSentenceRecently = existing.encounters.some(
    (e) => e.sentence === encounter.sentence && now - e.at < 60_000,
  );

  const encounters = sameSentenceRecently
    ? existing.encounters
    : [encounter, ...existing.encounters].slice(0, MAX_ENCOUNTERS);

  return {
    ...existing,
    updatedAt: now,
    encounterCount: sameSentenceRecently ? existing.encounterCount : existing.encounterCount + 1,
    encounters,
    definition: existing.definition || summary.definition,
    contextualMeaning: existing.contextualMeaning || summary.contextualMeaning,
    exampleSentence: existing.exampleSentence || summary.example,
    ipa: existing.ipa || summary.ipa,
    phonetic: existing.phonetic || summary.phonetic,
    partOfSpeech: existing.partOfSpeech || summary.partOfSpeech,
    synonyms: existing.synonyms.length ? existing.synonyms : summary.synonyms,
    tone: existing.tone || summary.tone,
    register: existing.register || summary.register,
    explanation: existing.explanation ?? input.explanation,
    source: existing.source ?? (input.saveSourcePage
      ? { title: input.context.pageTitle, url: input.context.pageUrl, domain: encounter.domain }
      : null),
  };
}

/**
 * SM-2, trimmed to what a vocabulary quiz needs. Phase 1 only shows "due now";
 * the scheduler is already here so spaced repetition is a UI change, not a
 * data migration.
 */
export function scheduleNextReview(state: ReviewState, correct: boolean, now = Date.now()): ReviewState {
  const day = 86_400_000;
  if (!correct) {
    return {
      ...state,
      repetitions: 0,
      lapses: state.lapses + 1,
      intervalDays: 1,
      ease: Math.max(1.3, state.ease - 0.2),
      due: now + day,
      lastReviewedAt: now,
      lastResult: 'incorrect',
      incorrectCount: state.incorrectCount + 1,
    };
  }

  const repetitions = state.repetitions + 1;
  const intervalDays =
    repetitions === 1 ? 1 : repetitions === 2 ? 3 : Math.round(Math.max(1, state.intervalDays) * state.ease);
  const ease = Math.min(2.8, state.ease + 0.06);

  return {
    ...state,
    repetitions,
    intervalDays,
    ease,
    due: now + intervalDays * day,
    lastReviewedAt: now,
    lastResult: 'correct',
    correctCount: state.correctCount + 1,
  };
}

/** Learning status advances with successful reviews; the user can override it. */
export function deriveStatus(entry: VocabularyEntry): LearningStatus {
  const { repetitions, correctCount, lapses } = entry.review;
  if (repetitions >= 4 && correctCount >= 4 && lapses === 0) return 'mastered';
  if (repetitions >= 2 && correctCount >= 2) return 'familiar';
  if (repetitions >= 1 || entry.encounterCount >= 2) return 'learning';
  return 'new';
}

export function sortEntries(entries: VocabularyEntry[], sort: VocabularyQuery['sort']): VocabularyEntry[] {
  const copy = [...entries];
  switch (sort) {
    case 'alphabetical':
      return copy.sort((a, b) => a.normalized.localeCompare(b.normalized));
    case 'encounters':
      return copy.sort((a, b) => b.encounterCount - a.encounterCount || b.updatedAt - a.updatedAt);
    case 'due':
      return copy.sort((a, b) => a.review.due - b.review.due);
    case 'recent':
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export function filterEntries(entries: VocabularyEntry[], query: VocabularyQuery): VocabularyEntry[] {
  const search = normalizeTerm(query.search ?? '');
  return entries.filter((entry) => {
    if (query.status === 'favorites' && !entry.favorite) return false;
    if (query.status && query.status !== 'all' && query.status !== 'favorites' && entry.status !== query.status) {
      return false;
    }
    if (!search) return true;
    const haystack = [
      entry.normalized,
      entry.definition,
      entry.contextualMeaning,
      entry.originalSentence,
      entry.source?.title ?? '',
      entry.synonyms.join(' '),
      entry.notes,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export class VocabularyRepository {
  private cache: Collection | null = null;
  private queue = new WriteQueue();

  constructor(private readonly store: KeyValueStore = localStore) {}

  private async load(): Promise<Collection> {
    if (this.cache) return this.cache;
    const stored = await this.store.get<Collection>(STORAGE_KEYS.vocabularyIndex);
    this.cache = isCollection(stored) ? stored : {};
    return this.cache;
  }

  private async persist(collection: Collection): Promise<void> {
    this.cache = collection;
    await this.store.set({ [STORAGE_KEYS.vocabularyIndex]: collection });
  }

  /** Drop the in-memory copy (used when another context wrote to storage). */
  invalidate(): void {
    this.cache = null;
  }

  async all(): Promise<VocabularyEntry[]> {
    return Object.values(await this.load());
  }

  async list(query: VocabularyQuery = {}): Promise<VocabularyEntry[]> {
    const entries = filterEntries(await this.all(), query);
    const sorted = sortEntries(entries, query.sort ?? 'recent');
    return query.limit ? sorted.slice(0, query.limit) : sorted;
  }

  async get(id: string): Promise<VocabularyEntry | null> {
    const collection = await this.load();
    return collection[id] ?? null;
  }

  async findByText(text: string, kind?: string): Promise<VocabularyEntry | null> {
    const normalized = normalizeTerm(text);
    if (!normalized) return null;
    const collection = await this.load();
    const matches = Object.values(collection).filter((e) => e.normalized === normalized);
    if (matches.length === 0) return null;
    return matches.find((e) => e.kind === kind) ?? matches[0] ?? null;
  }

  /** Save, or merge into an existing entry for the same term. */
  async save(input: NewVocabularyInput, now = Date.now()): Promise<{ entry: VocabularyEntry; created: boolean }> {
    return this.queue.run(async () => {
      const collection = { ...(await this.load()) };
      const candidate = buildEntry(input, now);
      const existing = collection[candidate.id];

      const entry = existing ? mergeEncounter(existing, input, now) : candidate;
      entry.status = entry.status === 'new' ? deriveStatus(entry) : entry.status;
      collection[entry.id] = entry;
      await this.persist(collection);
      return { entry, created: !existing };
    });
  }

  /** Count a sighting without adding the term to the saved list. */
  async recordEncounter(input: NewVocabularyInput, now = Date.now()): Promise<VocabularyEntry | null> {
    return this.queue.run(async () => {
      const collection = { ...(await this.load()) };
      const id = stableId(`${input.kind}:${normalizeTerm(displayTerm(input.context.selectedText))}`);
      const existing = collection[id];
      if (!existing) return null;
      const entry = mergeEncounter(existing, input, now);
      collection[id] = entry;
      await this.persist(collection);
      return entry;
    });
  }

  async update(id: string, patch: Partial<VocabularyEntry>): Promise<VocabularyEntry | null> {
    return this.queue.run(async () => {
      const collection = { ...(await this.load()) };
      const existing = collection[id];
      if (!existing) return null;
      const entry: VocabularyEntry = { ...existing, ...patch, id: existing.id, updatedAt: Date.now() };
      collection[id] = entry;
      await this.persist(collection);
      return entry;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.queue.run(async () => {
      const collection = { ...(await this.load()) };
      if (!collection[id]) return false;
      delete collection[id];
      await this.persist(collection);
      return true;
    });
  }

  async clear(): Promise<number> {
    return this.queue.run(async () => {
      const count = Object.keys(await this.load()).length;
      await this.persist({});
      return count;
    });
  }

  async countsByStatus(): Promise<Record<LearningStatus, number>> {
    const counts: Record<LearningStatus, number> = { new: 0, learning: 0, familiar: 0, mastered: 0 };
    for (const entry of await this.all()) {
      if (STATUS_ORDER.includes(entry.status)) counts[entry.status] += 1;
    }
    return counts;
  }

  async due(now = Date.now()): Promise<VocabularyEntry[]> {
    const entries = await this.all();
    return entries
      .filter((entry) => entry.status !== 'mastered' && entry.review.due <= now)
      .sort((a, b) => a.review.due - b.review.due);
  }

  /** Answer a review question and reschedule the entry. */
  async recordReview(id: string, correct: boolean, now = Date.now()): Promise<VocabularyEntry | null> {
    return this.queue.run(async () => {
      const collection = { ...(await this.load()) };
      const existing = collection[id];
      if (!existing) return null;
      const review = scheduleNextReview(existing.review, correct, now);
      const entry: VocabularyEntry = { ...existing, review, updatedAt: now };
      entry.status = deriveStatus(entry);
      collection[id] = entry;
      await this.persist(collection);
      return entry;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Review questions                                                    */
/* ------------------------------------------------------------------ */

const FALLBACK_DISTRACTORS = [
  'Completely and without exception',
  'Happening very slowly over time',
  'With absolute certainty',
  'In a friendly, informal way',
  'Relating to money or finance',
  'Repeated again and again',
  'Extremely small in size',
  'Done on purpose to cause harm',
];

/**
 * Build multiple-choice questions from saved entries. Distractors are other
 * users' saved definitions where possible so the wrong answers stay plausible.
 */
export function buildReviewQuestions(
  entries: VocabularyEntry[],
  limit = 10,
  random: () => number = Math.random,
): ReviewQuestion[] {
  const usable = entries.filter((entry) => entry.definition || entry.contextualMeaning);
  const pool = usable.map((entry) => entry.definition || entry.contextualMeaning);

  return usable.slice(0, limit).map((entry) => {
    const correct = entry.definition || entry.contextualMeaning;
    const others = pool.filter((text) => text !== correct);
    const distractors = shuffle(others, random).slice(0, 3);
    // Top up from the fixed pool by walking it once from a random offset —
    // never by sampling in a loop, which cannot terminate for a constant RNG.
    const offset = Math.floor(random() * FALLBACK_DISTRACTORS.length);
    for (let i = 0; i < FALLBACK_DISTRACTORS.length && distractors.length < 3; i += 1) {
      const candidate = FALLBACK_DISTRACTORS[(offset + i) % FALLBACK_DISTRACTORS.length] ?? '';
      if (candidate && candidate !== correct && !distractors.includes(candidate)) distractors.push(candidate);
    }
    const choices = shuffle([correct, ...distractors], random);
    return {
      entryId: entry.id,
      term: entry.term,
      prompt: entry.kind === 'word' ? `What does “${entry.term}” mean?` : `What does this mean?\n“${truncate(entry.term, 140)}”`,
      choices,
      correctIndex: choices.indexOf(correct),
      originalSentence: entry.originalSentence,
      source: entry.source,
    };
  });
}

function shuffle<T>(input: T[], random: () => number): T[] {
  const array = [...input];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = array[i] as T;
    const b = array[j] as T;
    array[i] = b;
    array[j] = a;
  }
  return array;
}

function isCollection(value: unknown): value is Collection {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const vocabularyRepository = new VocabularyRepository();
