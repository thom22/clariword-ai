import { DEFAULT_BACKEND_URL, SCHEMA_VERSION } from '@/shared/constants';
import type { ReviewState, Settings } from '@/types';

/**
 * Defaults are privacy-forward and work with no setup: the hosted backend is
 * preconfigured so a fresh install works immediately, and page metadata stays
 * off until the user opts in.
 */
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  autoHelper: true,
  helperMode: 'icon',
  explanationLevel: 'intermediate',
  accent: 'american',
  theme: 'system',
  autoPlayPronunciation: false,
  saveSourcePage: true,
  sendNeighbouringContext: true,
  sendPageMetadata: false,
  aiMode: 'backend',
  backendUrl: DEFAULT_BACKEND_URL,
  backendToken: '',
  maxSelectionChars: 900,
  ttsRate: 0.95,
  ttsVoiceUri: '',
  disabledDomains: [],
  schemaVersion: SCHEMA_VERSION,
};

export function createReviewState(now = Date.now()): ReviewState {
  return {
    due: now,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
    lastResult: null,
    correctCount: 0,
    incorrectCount: 0,
  };
}

/** Merge stored settings over defaults, dropping unknown / malformed keys. */
export function coerceSettings(stored: unknown): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== 'object' || stored === null) return result;
  const input = stored as Record<string, unknown>;

  const booleans = [
    'enabled', 'autoHelper', 'autoPlayPronunciation', 'saveSourcePage',
    'sendNeighbouringContext', 'sendPageMetadata',
  ] as const;
  for (const key of booleans) {
    if (typeof input[key] === 'boolean') result[key] = input[key] as boolean;
  }

  if (input.helperMode === 'icon' || input.helperMode === 'toolbar') result.helperMode = input.helperMode;
  if (input.explanationLevel === 'beginner' || input.explanationLevel === 'intermediate' || input.explanationLevel === 'advanced') {
    result.explanationLevel = input.explanationLevel;
  }
  if (input.accent === 'american' || input.accent === 'british') result.accent = input.accent;
  if (input.theme === 'light' || input.theme === 'dark' || input.theme === 'system') result.theme = input.theme;
  if (input.aiMode === 'mock' || input.aiMode === 'backend') result.aiMode = input.aiMode;

  if (typeof input.backendUrl === 'string') result.backendUrl = input.backendUrl.trim();
  if (typeof input.backendToken === 'string') result.backendToken = input.backendToken.trim();
  if (typeof input.ttsVoiceUri === 'string') result.ttsVoiceUri = input.ttsVoiceUri;

  if (typeof input.maxSelectionChars === 'number' && Number.isFinite(input.maxSelectionChars)) {
    result.maxSelectionChars = Math.min(4000, Math.max(120, Math.round(input.maxSelectionChars)));
  }
  if (typeof input.ttsRate === 'number' && Number.isFinite(input.ttsRate)) {
    result.ttsRate = Math.min(1.6, Math.max(0.5, input.ttsRate));
  }
  if (Array.isArray(input.disabledDomains)) {
    result.disabledDomains = input.disabledDomains
      .filter((d): d is string => typeof d === 'string')
      .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
      .filter(Boolean)
      .slice(0, 500);
  }
  return result;
}
