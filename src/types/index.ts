/**
 * ClariWord AI — shared domain types.
 *
 * Every module (content script, service worker, extension pages, tests) speaks
 * these types. Nothing here imports a Chrome API, so this file is also safe to
 * load in Node for unit tests.
 */

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export type ExplanationLevel = 'beginner' | 'intermediate' | 'advanced';
export type Accent = 'american' | 'british';
export type ThemePreference = 'light' | 'dark' | 'system';
/** What appears after the user highlights text. */
export type HelperMode = 'icon' | 'toolbar';
export type AiMode = 'mock' | 'backend';

export interface Settings {
  /** Master switch. When false the content script does nothing at all. */
  enabled: boolean;
  /** Show the floating helper automatically after a selection. */
  autoHelper: boolean;
  helperMode: HelperMode;
  explanationLevel: ExplanationLevel;
  accent: Accent;
  theme: ThemePreference;
  /** Speak the word as soon as an explanation arrives. */
  autoPlayPronunciation: boolean;
  /** Store page title + URL alongside saved vocabulary. */
  saveSourcePage: boolean;
  /** Send the neighbouring sentences so the AI can disambiguate. */
  sendNeighbouringContext: boolean;
  /** Send page title + domain (helps with jargon: "bank" on a finance site). */
  sendPageMetadata: boolean;
  aiMode: AiMode;
  backendUrl: string;
  /** Optional bearer token for a self-hosted backend. Never a provider key. */
  backendToken: string;
  /** Selections longer than this are refused with a friendly message. */
  maxSelectionChars: number;
  ttsRate: number;
  ttsVoiceUri: string;
  /** Domains where ClariWord stays silent. */
  disabledDomains: string[];
  schemaVersion: number;
}

/* ------------------------------------------------------------------ */
/* Selection + context                                                 */
/* ------------------------------------------------------------------ */

export type SelectionKind = 'word' | 'phrase' | 'sentence' | 'passage';

/** The minimum text ClariWord sends anywhere. Built by context-extractor.ts. */
export interface PageContext {
  selectedText: string;
  /** The sentence that contains the selection (may equal selectedText). */
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  pageTitle: string;
  pageUrl: string;
  pageDomain: string;
}

export interface ExplainRequest {
  context: PageContext;
  kind: SelectionKind;
  explanationLevel: ExplanationLevel;
  accent: Accent;
  /** Focus a specific facet, driven by the quick-action buttons. */
  intent?: ExplainIntent;
}

export type ExplainIntent =
  | 'explain'
  | 'simplify'
  | 'grammar'
  | 'examples'
  | 'why-this-word'
  | 'key-vocabulary';

/* ------------------------------------------------------------------ */
/* Structured AI output                                                */
/* ------------------------------------------------------------------ */

export type Confidence = 'high' | 'medium' | 'low';

export interface WordExplanation {
  type: 'word';
  word: string;
  /** International Phonetic Alphabet, wrapped in slashes. */
  ipa: string;
  /** Reader-friendly respelling, stressed syllable in CAPS: os-TEN-suh-blee */
  phonetic: string;
  partOfSpeech: string;
  /** What it means *in this sentence* — shown before the generic meaning. */
  contextualMeaning: string;
  /** The plain-English, dictionary-ish meaning. */
  simpleMeaning: string;
  /** What the wording suggests about the author's purpose. */
  authorIntent: string;
  tone: string;
  register: string;
  synonyms: string[];
  /** A word the reader already knows that would fit here. */
  naturalAlternative: string;
  example: string;
  /** Plain restatement of the sentence the word appeared in. */
  sentenceExplanation: string;
  confidence: Confidence;
  /** Present when the selection genuinely has more than one reading here. */
  ambiguityNote?: string;
}

export interface Segment {
  text: string;
  meaning: string;
}

export interface KeyVocabularyItem {
  word: string;
  gloss: string;
  ipa?: string;
}

export interface SentenceExplanation {
  type: 'sentence';
  simpleMeaning: string;
  authorMeaning: string;
  tone: string;
  register: string;
  simplifiedRewrite: string;
  segments: Segment[];
  keyVocabulary: KeyVocabularyItem[];
  grammarNote?: string;
  confidence: Confidence;
}

export interface PhraseExplanation {
  type: 'phrase';
  phrase: string;
  meaning: string;
  contextualMeaning: string;
  /** Only for idioms, where the literal reading is informative. */
  literalMeaning?: string;
  figurative: boolean;
  register: string;
  tone: string;
  example: string;
  alternatives: string[];
  keyVocabulary: KeyVocabularyItem[];
  confidence: Confidence;
}

export interface PassageExplanation {
  type: 'passage';
  summary: string;
  simpleMeaning: string;
  tone: string;
  register: string;
  keyPoints: string[];
  segments: Segment[];
  keyVocabulary: KeyVocabularyItem[];
  simplifiedRewrite: string;
  confidence: Confidence;
}

export type Explanation =
  | WordExplanation
  | SentenceExplanation
  | PhraseExplanation
  | PassageExplanation;

export interface ExplainResponseMeta {
  source: AiMode;
  model?: string;
  /** Milliseconds spent in the AI call, for the dev console. */
  elapsedMs?: number;
  /** True when the payload came from the in-memory request cache. */
  cached?: boolean;
}

export interface ExplainResponse {
  explanation: Explanation;
  meta: ExplainResponseMeta;
}

/* ------------------------------------------------------------------ */
/* Follow-up chat                                                      */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

export interface ChatRequest {
  context: PageContext;
  explanation: Explanation | null;
  history: ChatMessage[];
  question: string;
  explanationLevel: ExplanationLevel;
  accent: Accent;
}

export interface ChatResponse {
  answer: string;
  meta: ExplainResponseMeta;
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export type LearningStatus = 'new' | 'learning' | 'familiar' | 'mastered';

export interface SourceRef {
  title: string;
  url: string;
  domain: string;
}

export interface Encounter {
  at: number;
  title: string;
  url: string;
  domain: string;
  sentence: string;
}

/** Spaced-repetition state. Phase 1 only reads `due`; SM-2 fields are ready. */
export interface ReviewState {
  /** Epoch ms when this entry should next be reviewed. */
  due: number;
  /** Days until the next review after a correct answer. */
  intervalDays: number;
  /** SM-2 ease factor. */
  ease: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: number | null;
  lastResult: 'correct' | 'incorrect' | null;
  correctCount: number;
  incorrectCount: number;
}

export interface VocabularyEntry {
  id: string;
  /** Display form, e.g. "ostensibly" or the full saved sentence. */
  term: string;
  /** Lowercased, punctuation-stripped key used for de-duplication. */
  normalized: string;
  kind: SelectionKind;
  /** Exactly what the user highlighted. */
  selectedText: string;
  definition: string;
  contextualMeaning: string;
  originalSentence: string;
  exampleSentence: string;
  ipa: string;
  phonetic: string;
  partOfSpeech: string;
  synonyms: string[];
  tone: string;
  register: string;
  source: SourceRef | null;
  createdAt: number;
  updatedAt: number;
  encounterCount: number;
  /** Most recent encounters, newest first, capped by MAX_ENCOUNTERS. */
  encounters: Encounter[];
  favorite: boolean;
  status: LearningStatus;
  review: ReviewState;
  /** Full structured payload so the detail view can re-render everything. */
  explanation: Explanation | null;
  notes: string;
  tags: string[];
}

export type NewVocabularyInput = {
  context: PageContext;
  kind: SelectionKind;
  explanation: Explanation | null;
  saveSourcePage: boolean;
};

/* ------------------------------------------------------------------ */
/* Stats + review                                                      */
/* ------------------------------------------------------------------ */

export interface DailyStats {
  /** ISO date in the user's local timezone: YYYY-MM-DD. */
  date: string;
  lookups: number;
  saves: number;
  reviewsAnswered: number;
  reviewsCorrect: number;
}

export interface StatsSummary {
  today: DailyStats;
  totalSaved: number;
  dueForReview: number;
  streakDays: number;
  byStatus: Record<LearningStatus, number>;
}

export interface ReviewQuestion {
  entryId: string;
  term: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  originalSentence: string;
  source: SourceRef | null;
}

/* ------------------------------------------------------------------ */
/* Pronunciation practice                                              */
/* ------------------------------------------------------------------ */

export interface PronunciationScore {
  /** 0–100. Only ever produced by a real scoring backend. */
  overall: number;
  stressCorrect: boolean;
  transcript: string;
  feedback: string;
  perSyllable: { syllable: string; score: number }[];
  /** True when the numbers came from the clearly-labelled dev simulator. */
  simulated: boolean;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type ClariErrorCode =
  | 'OFFLINE'
  | 'BACKEND_UNREACHABLE'
  | 'BACKEND_ERROR'
  | 'RATE_LIMITED'
  | 'INVALID_RESPONSE'
  | 'SELECTION_TOO_LONG'
  | 'EMPTY_SELECTION'
  | 'UNSUPPORTED_PAGE'
  | 'NOT_CONFIGURED'
  | 'SPEECH_UNAVAILABLE'
  | 'MIC_DENIED'
  | 'SCORING_UNAVAILABLE'
  | 'ABORTED'
  | 'UNKNOWN';

export interface ClariErrorShape {
  code: ClariErrorCode;
  message: string;
  /** A concrete next step the user can take, if there is one. */
  hint?: string;
  retryable: boolean;
}
