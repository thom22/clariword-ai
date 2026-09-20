import type { ClariErrorCode, ClariErrorShape } from '@/types';

/**
 * One error type for the whole extension. Everything the user could see gets a
 * human message and, where possible, a concrete next step.
 */
export class ClariError extends Error implements ClariErrorShape {
  readonly code: ClariErrorCode;
  readonly hint?: string;
  readonly retryable: boolean;

  constructor(code: ClariErrorCode, message: string, options: { hint?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ClariError';
    this.code = code;
    this.hint = options.hint;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): ClariErrorShape {
    return { code: this.code, message: this.message, hint: this.hint, retryable: this.retryable };
  }

  static from(value: unknown): ClariError {
    if (value instanceof ClariError) return value;
    if (isErrorShape(value)) {
      return new ClariError(value.code, value.message, { hint: value.hint, retryable: value.retryable });
    }
    if (value instanceof Error) {
      if (value.name === 'AbortError') {
        return new ClariError('ABORTED', 'Request cancelled.', { retryable: true });
      }
      return new ClariError('UNKNOWN', value.message || 'Something went wrong.', { retryable: true });
    }
    return new ClariError('UNKNOWN', 'Something went wrong.', { retryable: true });
  }
}

function isErrorShape(value: unknown): value is ClariErrorShape {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ClariErrorShape).code === 'string' &&
    typeof (value as ClariErrorShape).message === 'string'
  );
}

/** Ready-made errors, so wording stays consistent wherever they are thrown. */
export const Errors = {
  offline: () =>
    new ClariError('OFFLINE', 'You appear to be offline.', {
      hint: 'Reconnect and try again — saved vocabulary still works offline.',
      retryable: true,
    }),
  backendUnreachable: (url: string) =>
    new ClariError('BACKEND_UNREACHABLE', `Could not reach the ClariWord backend at ${url}.`, {
      hint: 'The ClariWord service could not be reached. Check your internet connection and try again.',
      retryable: true,
    }),
  backendError: (status: number, detail?: string) =>
    new ClariError('BACKEND_ERROR', `The backend returned an error (${status}).${detail ? ` ${detail}` : ''}`, {
      hint: 'The ClariWord service had a problem. Please try again in a moment.',
      retryable: status >= 500,
    }),
  rateLimited: (retryAfterSeconds?: number) =>
    new ClariError(
      'RATE_LIMITED',
      retryAfterSeconds
        ? `Too many requests. Try again in about ${retryAfterSeconds}s.`
        : 'Too many requests right now.',
      { hint: 'ClariWord limits lookups to protect your backend quota.', retryable: true },
    ),
  invalidResponse: (detail: string) =>
    new ClariError('INVALID_RESPONSE', 'The AI response was not in the expected format.', {
      hint: __DEV__ ? detail : 'Try again — if it keeps happening, check the backend prompt.',
      retryable: true,
    }),
  selectionTooLong: (chars: number, max: number) =>
    new ClariError('SELECTION_TOO_LONG', `That selection is ${chars.toLocaleString()} characters.`, {
      hint: `ClariWord explains up to ${max.toLocaleString()} characters at a time. Try selecting a sentence or paragraph.`,
    }),
  emptySelection: () =>
    new ClariError('EMPTY_SELECTION', 'Select some text first.', {
      hint: 'Highlight a word, phrase or sentence on the page.',
    }),
  unsupportedPage: () =>
    new ClariError('UNSUPPORTED_PAGE', 'ClariWord cannot run on this page.', {
      hint: 'Chrome blocks extensions on internal pages like chrome:// and the Web Store.',
    }),
  notConfigured: () =>
    new ClariError('NOT_CONFIGURED', 'No AI backend is configured yet.', {
      hint: 'The ClariWord service is not reachable right now. Please try again.',
    }),
  speechUnavailable: () =>
    new ClariError('SPEECH_UNAVAILABLE', 'Speech is not available in this browser.', {
      hint: 'Your system may have no installed English voices.',
    }),
  micDenied: () =>
    new ClariError('MIC_DENIED', 'Microphone access was denied.', {
      hint: 'Allow the microphone for this extension to record your pronunciation.',
    }),
  scoringUnavailable: () =>
    new ClariError('SCORING_UNAVAILABLE', 'Pronunciation scoring needs a speech backend.', {
      hint: 'Configure a speech endpoint in Settings, or use the clearly-labelled dev simulator.',
    }),
};
