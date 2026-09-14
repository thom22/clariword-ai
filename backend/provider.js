/**
 * AI provider adapter.
 *
 * The whole point of the backend is that the provider key lives here and never
 * in the extension. Two adapters ship; add another by implementing
 * `complete({ system, user, maxTokens })` and returning the raw text.
 */

const TIMEOUT_MS = 30_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function postJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new HttpError(response.status, `provider returned ${response.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Anthropic Messages API. */
export class AnthropicProvider {
  constructor({ apiKey, model = 'claude-sonnet-4-5', baseUrl = 'https://api.anthropic.com' }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async complete({ system, user, maxTokens = 900 }) {
    const payload = await postJson(
      `${this.baseUrl}/v1/messages`,
      { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      },
    );
    return (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  }
}

/** OpenAI-compatible Chat Completions (also covers most self-hosted gateways). */
export class OpenAiProvider {
  constructor({ apiKey, model = 'gpt-4o-mini', baseUrl = 'https://api.openai.com/v1' }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async complete({ system, user, maxTokens = 900 }) {
    const payload = await postJson(
      `${this.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    );
    return payload.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

/** Returns canned JSON so the backend can be exercised without a provider key. */
export class EchoProvider {
  constructor() {
    this.model = 'echo (no provider configured)';
  }

  async complete({ user }) {
    const selected = /SELECTED TEXT: (.*)/.exec(user)?.[1] ?? 'the selection';
    const wantsChat = user.includes("READER'S QUESTION:");
    if (wantsChat) {
      return JSON.stringify({
        answer:
          'This backend is running without an AI provider key, so it cannot answer follow-up questions yet. Set PROVIDER and the matching API key in .env.',
      });
    }
    return JSON.stringify({
      type: 'word',
      word: selected,
      ipa: '',
      phonetic: '',
      partOfSpeech: '',
      contextualMeaning:
        'This backend is running without an AI provider key, so it is echoing a placeholder rather than a real explanation. Set PROVIDER and the matching API key in .env.',
      simpleMeaning: '',
      authorIntent: '',
      tone: '',
      register: '',
      synonyms: [],
      naturalAlternative: '',
      example: '',
      sentenceExplanation: '',
      confidence: 'low',
    });
  }
}

export function createProvider(env) {
  const name = (env.PROVIDER ?? '').toLowerCase();
  if (name === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('PROVIDER=anthropic but ANTHROPIC_API_KEY is not set');
    return new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.MODEL || undefined,
      baseUrl: env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  if (name === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('PROVIDER=openai but OPENAI_API_KEY is not set');
    return new OpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.MODEL || undefined,
      baseUrl: env.OPENAI_BASE_URL || undefined,
    });
  }
  return new EchoProvider();
}

export { HttpError };
