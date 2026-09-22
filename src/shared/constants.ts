/** Cross-cutting constants. Keep values here, not scattered through modules. */

export const APP_NAME = 'ClariWord AI';
export const TAGLINE = 'Understand what you read. Remember what you learn.';
export const SHORT_DESCRIPTION = 'Your AI reading and vocabulary companion.';

/** Bumped whenever the stored shape changes; see shared/migrations.ts. */
export const SCHEMA_VERSION = 3;

export const STORAGE_KEYS = {
  settings: 'clariword.settings',
  vocabularyIndex: 'clariword.vocab.index',
  vocabularyItem: 'clariword.vocab.item.',
  stats: 'clariword.stats',
  schemaVersion: 'clariword.schemaVersion',
} as const;

/** Selections beyond this are refused outright, whatever the user setting. */
export const HARD_MAX_SELECTION_CHARS = 4000;
/** Neighbouring-sentence context is trimmed to this before leaving the page. */
export const MAX_CONTEXT_SENTENCE_CHARS = 400;
/** How many past encounters we keep per vocabulary entry. */
export const MAX_ENCOUNTERS = 25;
/** Follow-up chat turns sent back to the model. */
export const MAX_CHAT_HISTORY = 12;

/** Word-count thresholds that decide which explanation shape to ask for. */
export const PHRASE_MAX_WORDS = 6;
export const SENTENCE_MAX_WORDS = 60;

export const DEFAULT_BACKEND_URL = 'https://clariword-ai-production.up.railway.app';

export const BRAND = {
  accent: '#0E7C66',
  accentStrong: '#0A5F4E',
  accentSoft: '#E4F1ED',
} as const;

/** DOM id of the injected shadow host. Deliberately unusual. */
export const HOST_ELEMENT_ID = 'clariword-ai-root-7f3a';

export const CONTEXT_MENU_IDS = {
  root: 'clariword-root',
  explain: 'clariword-explain',
  simplify: 'clariword-simplify',
  pronounce: 'clariword-pronounce',
  save: 'clariword-save',
} as const;
