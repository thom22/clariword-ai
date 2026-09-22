import { HARD_MAX_SELECTION_CHARS, MAX_CHAT_HISTORY, MAX_CONTEXT_SENTENCE_CHARS } from '@/shared/constants';
import { ClariError, Errors } from '@/shared/errors';
import { parseJsonLoose, validateChatAnswer, validateExplanation } from '@/shared/schema';
import { normalizeWhitespace, stableId, truncate } from '@/shared/text';
import { createMockChatAnswer, createMockExplanation, mockLatencyMs } from '@/services/mock-ai';
import type {
  ChatRequest,
  ChatResponse,
  Explanation,
  ExplainRequest,
  ExplainResponse,
  PageContext,
  Settings,
} from '@/types';

const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_MAX_ENTRIES = 60;
const CACHE_TTL_MS = 30 * 60_000;
/** Token bucket: burst of 12, refilled at 1 request every 2 seconds. */
const RATE_BURST = 12;
const RATE_REFILL_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Privacy: decide exactly what leaves the machine                     */
/* ------------------------------------------------------------------ */

/**
 * Strip the outgoing context down to what the user has agreed to send.
 * This is the single place where page text is prepared for the network —
 * keep it that way.
 */
export function buildOutgoingContext(context: PageContext, settings: Settings): PageContext {
  const sentence = truncate(context.sentence, MAX_CONTEXT_SENTENCE_CHARS);
  const out: PageContext = {
    selectedText: normalizeWhitespace(context.selectedText),
    sentence: sentence === normalizeWhitespace(context.selectedText) ? '' : sentence,
    previousSentence: '',
    nextSentence: '',
    pageTitle: '',
    pageUrl: '',
    pageDomain: '',
  };

  if (settings.sendNeighbouringContext) {
    out.previousSentence = truncate(context.previousSentence, MAX_CONTEXT_SENTENCE_CHARS);
    out.nextSentence = truncate(context.nextSentence, MAX_CONTEXT_SENTENCE_CHARS);
  }
  if (settings.sendPageMetadata) {
    out.pageTitle = truncate(context.pageTitle, 160);
    out.pageDomain = context.pageDomain;
    // The full URL can carry identifiers; the domain is the useful part.
  }
  return out;
}

/** A one-line, human-readable summary of what a request will transmit. */
export function describeOutgoingPayload(context: PageContext, settings: Settings): string {
  const outgoing = buildOutgoingContext(context, settings);
  const parts = [`${outgoing.selectedText.length} characters of selected text`];
  if (outgoing.sentence) parts.push('its sentence');
  if (outgoing.previousSentence || outgoing.nextSentence) parts.push('the neighbouring sentences');
  if (outgoing.pageDomain) parts.push(`the page domain (${outgoing.pageDomain})`);
  return parts.join(', ');
}

/* ------------------------------------------------------------------ */
/* Cache + rate limit                                                  */
/* ------------------------------------------------------------------ */

interface CacheRecord {
  at: number;
  response: ExplainResponse;
}

class ResponseCache {
  private map = new Map<string, CacheRecord>();

  get(key: string): ExplainResponse | undefined {
    const record = this.map.get(key);
    if (!record) return undefined;
    if (Date.now() - record.at > CACHE_TTL_MS) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, record);
    return { ...record.response, meta: { ...record.response.meta, cached: true } };
  }

  set(key: string, response: ExplainResponse): void {
    this.map.set(key, { at: Date.now(), response });
    while (this.map.size > CACHE_MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

class RateLimiter {
  private tokens = RATE_BURST;
  private last = Date.now();

  take(): boolean {
    const now = Date.now();
    const refill = Math.floor((now - this.last) / RATE_REFILL_MS);
    if (refill > 0) {
      this.tokens = Math.min(RATE_BURST, this.tokens + refill);
      this.last = now;
    }
    if (this.tokens <= 0) return false;
    this.tokens -= 1;
    return true;
  }

  retryAfterSeconds(): number {
    return Math.ceil(RATE_REFILL_MS / 1000);
  }
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class AiService {
  private cache = new ResponseCache();
  private limiter = new RateLimiter();

  async explain(request: ExplainRequest, settings: Settings): Promise<ExplainResponse> {
    const selected = normalizeWhitespace(request.context.selectedText);
    if (!selected) throw Errors.emptySelection();

    const limit = Math.min(settings.maxSelectionChars, HARD_MAX_SELECTION_CHARS);
    if (selected.length > limit) {
      // Over the ceiling is a dead end; over their own setting is a setting
      // they can change, so point them at it instead of just refusing.
      throw limit < HARD_MAX_SELECTION_CHARS
        ? Errors.selectionOverSetting(selected.length, limit, HARD_MAX_SELECTION_CHARS)
        : Errors.selectionTooLong(selected.length, limit);
    }

    const outgoing = buildOutgoingContext(request.context, settings);
    const payload: ExplainRequest = { ...request, context: outgoing };
    const key = cacheKey('explain', payload, settings);

    const cached = this.cache.get(key);
    if (cached) return cached;

    const started = Date.now();
    const explanation =
      settings.aiMode === 'mock'
        ? await this.explainWithMock(payload)
        : validateExplanation(await this.postJson('/api/explain', toWirePayload(payload, settings), settings));

    const response: ExplainResponse = {
      explanation,
      meta: { source: settings.aiMode, elapsedMs: Date.now() - started },
    };
    this.cache.set(key, response);
    return response;
  }

  async chat(request: ChatRequest, settings: Settings): Promise<ChatResponse> {
    const question = normalizeWhitespace(request.question);
    if (!question) throw Errors.emptySelection();

    const started = Date.now();
    if (settings.aiMode === 'mock') {
      await delay(320);
      return {
        answer: createMockChatAnswer(request),
        meta: { source: 'mock', elapsedMs: Date.now() - started },
      };
    }

    const body = {
      ...toWirePayload(
        { context: request.context, kind: 'word', explanationLevel: request.explanationLevel, accent: request.accent },
        settings,
      ),
      question,
      explanation: request.explanation,
      history: request.history.slice(-MAX_CHAT_HISTORY).map(({ role, content }) => ({ role, content })),
    };
    const raw = await this.postJson('/api/chat', body, settings);
    return {
      answer: validateChatAnswer(raw),
      meta: { source: 'backend', elapsedMs: Date.now() - started },
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private async explainWithMock(request: ExplainRequest): Promise<ReturnType<typeof createMockExplanation>> {
    await delay(mockLatencyMs(request));
    // Run mock output through the same validator as the backend, so demo mode
    // exercises the real code path.
    return validateExplanation(createMockExplanation(request));
  }

  /**
   * Explain, emitting partial results as the model produces them.
   *
   * `onPartial` receives a progressively more complete explanation; the promise
   * resolves with the validated final one. Any failure falls back to the
   * non-streaming route, so streaming can only ever be faster, never worse.
   */
  async explainStreaming(
    request: ExplainRequest,
    settings: Settings,
    onPartial: (partial: Partial<Explanation> & { type: Explanation['type'] }) => void,
  ): Promise<ExplainResponse> {
    if (settings.aiMode === 'mock') return this.explain(request, settings);

    const outgoing = buildOutgoingContext(request.context, settings);
    const payload: ExplainRequest = { ...request, context: outgoing };
    const key = cacheKey('explain', payload, settings);

    const cached = this.cache.get(key);
    if (cached) return cached;

    const started = Date.now();
    try {
      const explanation = await this.streamExplain(payload, settings, onPartial);
      const response: ExplainResponse = {
        explanation,
        meta: { source: settings.aiMode, elapsedMs: Date.now() - started },
      };
      this.cache.set(key, response);
      return response;
    } catch (error) {
      // A half-finished stream leaves the card mid-render, so fall back to the
      // route that returns one complete payload.
      if (__DEV__) console.warn('[ClariWord] streaming failed, falling back', error);
      return this.explain(request, settings);
    }
  }

  private async streamExplain(
    payload: ExplainRequest,
    settings: Settings,
    onPartial: (partial: Partial<Explanation> & { type: Explanation['type'] }) => void,
  ): Promise<Explanation> {
    const base = settings.backendUrl.trim().replace(/\/+$/, '');
    if (!base) throw Errors.notConfigured();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Errors.offline();
    if (!this.limiter.take()) throw Errors.rateLimited(this.limiter.retryAfterSeconds());

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(new URL('/api/explain/stream', `${base}/`).toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(settings.backendToken ? { authorization: `Bearer ${settings.backendToken}` } : {}),
        },
        body: JSON.stringify(toWirePayload(payload, settings)),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw Errors.backendError(response.status, '');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const partial: Record<string, unknown> = { type: payload.kind };
      let buffer = '';
      let final: Explanation | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const frame = JSON.parse(line) as
            | { type: 'field'; key: string; value: string }
            | { type: 'done'; explanation: unknown }
            | { type: 'error'; status: number; error: string };

          if (frame.type === 'field') {
            partial[frame.key] = frame.value;
            onPartial({ ...partial } as Partial<Explanation> & { type: Explanation['type'] });
          } else if (frame.type === 'done') {
            final = validateExplanation(frame.explanation);
          } else {
            throw Errors.backendError(frame.status, frame.error);
          }
        }
      }

      if (!final) throw Errors.backendError(502, 'the stream ended before the explanation was complete');
      return final;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson(path: string, body: unknown, settings: Settings): Promise<unknown> {
    const base = settings.backendUrl.trim().replace(/\/+$/, '');
    if (!base) throw Errors.notConfigured();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Errors.offline();
    if (!this.limiter.take()) throw Errors.rateLimited(this.limiter.retryAfterSeconds());

    let url: string;
    try {
      url = new URL(path, `${base}/`).toString();
    } catch {
      throw new ClariError('NOT_CONFIGURED', `“${settings.backendUrl}” is not a valid URL.`, {
        hint: 'Backend URL should look like https://clariword.example.com',
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(settings.backendToken ? { authorization: `Bearer ${settings.backendToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ClariError('BACKEND_UNREACHABLE', 'The backend took too long to respond.', {
          hint: 'Try again, or switch to Demo mode.',
          retryable: true,
        });
      }
      throw Errors.backendUnreachable(base);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw Errors.rateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }
    if (!response.ok) {
      const detail = await safeText(response);
      throw Errors.backendError(response.status, truncate(detail, 200));
    }

    const text = await response.text();
    const parsed = parseJsonLoose(text);
    if (parsed === undefined) throw Errors.invalidResponse('backend did not return JSON');
    return parsed;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The exact JSON shape documented in the README / backend contract. */
function toWirePayload(request: ExplainRequest, settings: Settings) {
  const { context } = request;
  return {
    selectedText: context.selectedText,
    sentence: context.sentence,
    previousSentence: context.previousSentence,
    nextSentence: context.nextSentence,
    pageTitle: context.pageTitle,
    pageDomain: context.pageDomain,
    selectionType: request.kind,
    intent: request.intent ?? 'explain',
    explanationLevel: settings.explanationLevel,
    accent: settings.accent,
    clientVersion: __VERSION__,
  };
}

function cacheKey(prefix: string, request: ExplainRequest, settings: Settings): string {
  return `${prefix}:${stableId(
    JSON.stringify([
      request.context.selectedText,
      request.context.sentence,
      request.context.previousSentence,
      request.context.nextSentence,
      request.context.pageDomain,
      request.kind,
      request.intent ?? 'explain',
      settings.explanationLevel,
      settings.accent,
      settings.aiMode,
    ]),
  )}`;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const aiService = new AiService();
