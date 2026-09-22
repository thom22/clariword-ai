import { ClariError } from '@/shared/errors';
import type {
  ChatRequest,
  ChatResponse,
  ClariErrorShape,
  ExplainIntent,
  ExplainRequest,
  ExplainResponse,
  LearningStatus,
  NewVocabularyInput,
  ReviewQuestion,
  Settings,
  StatsSummary,
  VocabularyEntry,
} from '@/types';

/* ------------------------------------------------------------------ */
/* Protocol                                                            */
/* ------------------------------------------------------------------ */

export interface VocabularyQuery {
  search?: string;
  status?: LearningStatus | 'all' | 'favorites';
  sort?: 'recent' | 'alphabetical' | 'encounters' | 'due';
  limit?: number;
}

export interface SaveResult {
  entry: VocabularyEntry;
  /** False when an existing entry was updated instead of a new one created. */
  created: boolean;
}

export interface TermStatus {
  saved: boolean;
  entryId: string | null;
  encounterCount: number;
}

export interface ReviewAnswer {
  entryId: string;
  correct: boolean;
}

/** Messages sent to the service worker. */
export interface MessageMap {
  EXPLAIN: { request: ExplainRequest; response: ExplainResponse };
  CHAT: { request: ChatRequest; response: ChatResponse };
  GET_SETTINGS: { request: undefined; response: Settings };
  UPDATE_SETTINGS: { request: Partial<Settings>; response: Settings };
  GET_STATS: { request: undefined; response: StatsSummary };
  SAVE_ENTRY: { request: NewVocabularyInput; response: SaveResult };
  LIST_VOCABULARY: { request: VocabularyQuery; response: VocabularyEntry[] };
  GET_ENTRY: { request: { id: string }; response: VocabularyEntry | null };
  UPDATE_ENTRY: { request: { id: string; patch: Partial<VocabularyEntry> }; response: VocabularyEntry | null };
  DELETE_ENTRY: { request: { id: string }; response: { deleted: boolean } };
  CLEAR_VOCABULARY: { request: undefined; response: { deleted: number } };
  TERM_STATUS: { request: { text: string }; response: TermStatus };
  RECORD_ENCOUNTER: { request: NewVocabularyInput; response: TermStatus };
  GET_REVIEW_QUEUE: { request: { limit?: number }; response: ReviewQuestion[] };
  SUBMIT_REVIEW: { request: ReviewAnswer; response: { entry: VocabularyEntry | null } };
  OPEN_PAGE: { request: { page: ExtensionPage; query?: Record<string, string> }; response: { opened: boolean } };
  PING: { request: undefined; response: { ok: true; version: string } };
}

export type ExtensionPage = 'vocabulary' | 'options' | 'review' | 'practice';

/** Messages sent from the service worker down into a tab's content script. */
export interface TabMessageMap {
  EXPLAIN_SELECTION: { request: { intent: ExplainIntent; selectionText?: string }; response: { handled: boolean } };
  SPEAK_SELECTION: { request: { selectionText?: string }; response: { handled: boolean } };
  SAVE_SELECTION: { request: { selectionText?: string }; response: { handled: boolean } };
  SETTINGS_CHANGED: { request: { settings: Settings }; response: { handled: boolean } };
  /** A progressively more complete explanation, pushed while the model streams. */
  EXPLANATION_PARTIAL: {
    request: { requestId: number; partial: Record<string, unknown> };
    response: { handled: boolean };
  };
}

type Reply<T> = { ok: true; data: T } | { ok: false; error: ClariErrorShape };

interface Envelope {
  __clariword: true;
  type: string;
  payload: unknown;
}

function envelope(type: string, payload: unknown): Envelope {
  return { __clariword: true, type, payload };
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && (value as Envelope).__clariword === true;
}

/* ------------------------------------------------------------------ */
/* Senders                                                             */
/* ------------------------------------------------------------------ */

/** Send to the service worker. Rejects with a ClariError on failure. */
export async function sendMessage<K extends keyof MessageMap>(
  type: K,
  ...args: MessageMap[K]['request'] extends undefined ? [] : [MessageMap[K]['request']]
): Promise<MessageMap[K]['response']> {
  const payload = args[0];
  let reply: Reply<MessageMap[K]['response']> | undefined;
  try {
    reply = await chrome.runtime.sendMessage(envelope(type as string, payload));
  } catch (error) {
    throw new ClariError('UNKNOWN', 'ClariWord background service is not responding.', {
      hint: 'Reload the extension from chrome://extensions if this persists.',
      retryable: true,
    });
  }
  if (!reply) {
    throw new ClariError('UNKNOWN', 'No response from the ClariWord background service.', { retryable: true });
  }
  if (!reply.ok) throw ClariError.from(reply.error);
  return reply.data;
}

/** Send into a tab. Resolves to null when no content script is listening. */
export async function sendToTab<K extends keyof TabMessageMap>(
  tabId: number,
  type: K,
  payload: TabMessageMap[K]['request'],
): Promise<TabMessageMap[K]['response'] | null> {
  try {
    const reply: Reply<TabMessageMap[K]['response']> = await chrome.tabs.sendMessage(
      tabId,
      envelope(type as string, payload),
    );
    return reply?.ok ? reply.data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Receivers                                                           */
/* ------------------------------------------------------------------ */

type HandlerMap<M> = {
  [K in keyof M]?: (
    payload: M[K] extends { request: infer R } ? R : never,
    sender: chrome.runtime.MessageSender,
  ) => Promise<M[K] extends { response: infer S } ? S : never>;
};

/**
 * Wire a set of handlers to `chrome.runtime.onMessage`.
 *
 * Returns `true` synchronously only for messages we own, so other extensions'
 * and the page's own messages are left alone.
 */
export function registerHandlers<M extends Record<keyof M, { request: unknown; response: unknown }>>(
  handlers: HandlerMap<M>,
): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isEnvelope(message)) return false;
    const handler = (handlers as Record<string, ((p: unknown, s: chrome.runtime.MessageSender) => Promise<unknown>) | undefined>)[
      message.type
    ];
    if (!handler) return false;

    handler(message.payload, sender)
      .then((data) => sendResponse({ ok: true, data } satisfies Reply<unknown>))
      .catch((error: unknown) => {
        const clari = ClariError.from(error);
        if (__DEV__) console.error(`[ClariWord] ${message.type} failed`, error);
        sendResponse({ ok: false, error: clari.toJSON() } satisfies Reply<never>);
      });
    return true; // keep the channel open for the async reply
  });
}
