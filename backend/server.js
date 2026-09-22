/**
 * ClariWord AI reference backend.
 *
 *   node server.js                      (env vars injected by the platform)
 *   node --env-file=.env server.js       (local development)
 *
 * Responsibilities, in order of importance:
 *  1. Hold the AI provider key so the extension never has to.
 *  2. Accept only the small, bounded payload the extension is supposed to send.
 *  3. Return JSON that matches the contract in ../docs/API.md.
 *
 * Deliberately dependency-light: Node's own http server, no framework.
 */
import http from 'node:http';
import { buildChatPrompt, buildExplainPrompt } from './prompts.js';
import { createProvider } from './provider.js';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 32 * 1024;
const MAX_SELECTION_CHARS = 4000;
const MAX_FIELD_CHARS = 1000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN ?? '';

const provider = createProvider(process.env);
const buckets = new Map();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * CORS. Extension requests arrive from `chrome-extension://<id>`; restrict to
 * your published id in production by setting ALLOWED_ORIGINS.
 */
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function cors(request, response) {
  const origin = request.headers.origin ?? '';
  // No Origin header means this is not a cross-origin browser request: curl,
  // uptime probes and the platform healthcheck all arrive this way. CORS does
  // not apply to them, so an allowlist must not reject them.
  if (!origin) {
    response.setHeader('vary', 'origin');
    return true;
  }
  const allowed = ALLOWED.length === 0 ? origin : ALLOWED.includes(origin) ? origin : '';
  if (allowed) response.setHeader('access-control-allow-origin', allowed);
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-headers', 'content-type, authorization');
  response.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  response.setHeader('access-control-max-age', '86400');
  return allowed !== '' || ALLOWED.length === 0;
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

function clientKey(request) {
  return request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
}

function rateLimited(request) {
  const key = clientKey(request);
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, resetAt: now + 60_000 };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60_000;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (buckets.size > 5000) buckets.clear();
  return bucket.count > RATE_LIMIT ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Drain rather than destroy, so the 413 actually reaches the client.
        request.removeAllListeners('data');
        request.resume();
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('body was not valid JSON'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

const clean = (value, max = MAX_FIELD_CHARS) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Accept only the documented fields, at the documented sizes. */
function normaliseInput(body) {
  // Reject an oversized selection rather than silently truncating it: a
  // half-sentence produces a confusing explanation, or output the validator
  // rejects with a 502 that looks like a provider fault.
  if (typeof body.selectedText === 'string') {
    const length = body.selectedText.replace(/\s+/g, ' ').trim().length;
    if (length > MAX_SELECTION_CHARS) {
      throw Object.assign(
        new Error(`selectedText is ${length} characters; the maximum is ${MAX_SELECTION_CHARS}`),
        { status: 400 },
      );
    }
  }

  const selectedText = clean(body.selectedText, MAX_SELECTION_CHARS);
  if (!selectedText) throw Object.assign(new Error('selectedText is required'), { status: 400 });

  const selectionType = ['word', 'phrase', 'sentence', 'passage'].includes(body.selectionType)
    ? body.selectionType
    : 'word';
  const explanationLevel = ['beginner', 'intermediate', 'advanced'].includes(body.explanationLevel)
    ? body.explanationLevel
    : 'intermediate';
  const accent = body.accent === 'british' ? 'british' : 'american';

  return {
    selectedText,
    sentence: clean(body.sentence),
    previousSentence: clean(body.previousSentence),
    nextSentence: clean(body.nextSentence),
    pageTitle: clean(body.pageTitle, 200),
    pageDomain: clean(body.pageDomain, 120),
    selectionType,
    explanationLevel,
    accent,
    intent: clean(body.intent, 40) || 'explain',
  };
}

function parseModelJson(text) {
  const trimmed = (text ?? '').trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  const fromFence = fenced && tryParse(fenced.trim());
  if (fromFence) return fromFence;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) return tryParse(trimmed.slice(first, last + 1));
  return null;
}

function tryParse(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

/** Mirror of the extension's validator, so bad model output fails here first. */
const REQUIRED_BY_TYPE = {
  word: ['word', 'contextualMeaning'],
  sentence: ['simpleMeaning'],
  phrase: ['phrase', 'meaning'],
  passage: ['summary'],
};

function assertExplanationShape(value, expectedType) {
  if (!value || typeof value !== 'object') throw Object.assign(new Error('model did not return JSON'), { status: 502 });
  if (!value.type) value.type = expectedType;
  const required = REQUIRED_BY_TYPE[value.type];
  if (!required) throw Object.assign(new Error(`unknown explanation type "${value.type}"`), { status: 502 });
  for (const field of required) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw Object.assign(new Error(`model output missing "${field}"`), { status: 502 });
    }
  }
  return value;
}

/**
 * Two ways in, either sufficient:
 *
 *  1. A request from an allowlisted extension origin. Browsers set `Origin`
 *     themselves and pages cannot forge it, so this identifies the published
 *     extension without shipping a secret inside it — anything bundled into an
 *     extension can be read straight out of the .crx.
 *  2. A bearer token, for callers that are not the extension.
 *
 * This is a gate, not a wall: a non-browser client can still send any Origin it
 * likes. The provider spend cap is what actually bounds abuse.
 */
function authorised(request) {
  const origin = request.headers.origin ?? '';
  if (origin && ALLOWED.includes(origin)) return true;
  if (!ACCESS_TOKEN) return true;
  const header = request.headers.authorization ?? '';
  return header === `Bearer ${ACCESS_TOKEN}`;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

async function handleExplain(body) {
  const input = normaliseInput(body);
  const { system, user } = buildExplainPrompt(input);
  const raw = await provider.complete({ system, user, maxTokens: input.selectionType === 'word' ? 800 : 1200 });
  return assertExplanationShape(parseModelJson(raw), input.selectionType);
}

async function handleChat(body) {
  const input = normaliseInput(body);
  const question = clean(body.question, 500);
  if (!question) throw Object.assign(new Error('question is required'), { status: 400 });

  const history = Array.isArray(body.history)
    ? body.history
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .slice(-12)
        .map((message) => ({ role: message.role, content: clean(message.content, 800) }))
    : [];

  const { system, user } = buildChatPrompt({
    ...input,
    question,
    history,
    explanation: body.explanation ?? null,
  });
  const raw = await provider.complete({ system, user, maxTokens: 600 });
  const parsed = parseModelJson(raw);
  const answer = typeof parsed?.answer === 'string' ? parsed.answer.trim() : raw.trim();
  if (!answer) throw Object.assign(new Error('model returned an empty answer'), { status: 502 });
  return { answer };
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

/**
 * Pull every *completed* top-level string field out of a partial JSON document.
 *
 * The client must never see half a value, so a field counts as complete only
 * once its closing quote has arrived. Arrays and objects are skipped here and
 * picked up from the final parse, which keeps this scanner small and
 * predictable — it is the part most likely to be wrong, so it does less.
 */
function completedStringFields(partial) {
  const out = {};
  // "key" : "value"  — with the closing quote present. Escaped quotes inside
  // the value are handled by requiring the terminator not be preceded by \.
  const pattern = /"([A-Za-z][A-Za-z0-9_]*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = pattern.exec(partial)) !== null) {
    try {
      out[match[1]] = JSON.parse(`"${match[2]}"`);
    } catch {
      // Not yet a valid escape sequence; it will parse on a later pass.
    }
  }
  return out;
}

/** One NDJSON frame per line, flushed immediately. */
function sendFrame(response, frame) {
  response.write(`${JSON.stringify(frame)}\n`);
}

async function handleExplainStream(body, response) {
  const input = normaliseInput(body);
  const { system, user } = buildExplainPrompt(input);
  const maxTokens = input.selectionType === 'word' ? 800 : 1200;

  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Proxies that buffer would defeat the point of streaming.
    'x-accel-buffering': 'no',
  });

  let raw = '';
  const sent = {};
  try {
    for await (const delta of provider.stream({ system, user, maxTokens })) {
      raw += delta;
      const fields = completedStringFields(raw);
      for (const [key, value] of Object.entries(fields)) {
        if (sent[key] === value) continue;
        sent[key] = value;
        sendFrame(response, { type: 'field', key, value });
      }
    }

    // The authoritative result: same parsing and the same validator the
    // non-streaming route uses, so a stream cannot return a shape that
    // /api/explain would have rejected.
    const explanation = assertExplanationShape(parseModelJson(raw), input.selectionType);
    sendFrame(response, { type: 'done', explanation });
  } catch (error) {
    const status = error?.status ?? 500;
    if (status >= 500) console.error('[clariword] stream', error);
    // Headers are already sent, so the error has to travel in-band.
    sendFrame(response, { type: 'error', status, error: error?.message ?? 'internal error' });
  } finally {
    response.end();
  }
}

const server = http.createServer(async (request, response) => {
  const allowed = cors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(allowed ? 204 : 403);
    response.end();
    return;
  }
  if (!allowed) return send(response, 403, { error: 'origin not allowed' });

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return send(response, 200, { status: 'ok', model: provider.model ?? 'configured', version: 1 });
  }

  if (request.method !== 'POST') return send(response, 404, { error: 'not found' });
  if (!authorised(request)) return send(response, 401, { error: 'invalid or missing access token' });

  const retryAfter = rateLimited(request);
  if (retryAfter) {
    response.setHeader('retry-after', String(retryAfter));
    return send(response, 429, { error: 'rate limit exceeded' });
  }

  try {
    const body = await readBody(request);
    if (url.pathname === '/api/explain') return send(response, 200, await handleExplain(body));
    if (url.pathname === '/api/explain/stream') return await handleExplainStream(body, response);
    if (url.pathname === '/api/chat') return send(response, 200, await handleChat(body));
    if (url.pathname === '/api/pronunciation') {
      // Deliberately not implemented: scoring needs a real speech model, and
      // the extension must never show numbers that were not measured.
      return send(response, 501, {
        error: 'pronunciation scoring is not implemented in the reference backend',
        hint: 'Wire this route to a speech-assessment service and return the PronunciationScore shape.',
      });
    }
    return send(response, 404, { error: 'not found' });
  } catch (error) {
    const status = error?.status ?? 500;
    if (status >= 500) console.error('[clariword]', error);
    return send(response, status, { error: error?.message ?? 'internal error' });
  }
});

server.listen(PORT, () => {
  // A shared deployment with no token is an open relay to your provider bill.
  if (!ACCESS_TOKEN && process.env.NODE_ENV === 'production') {
    console.warn('');
    console.warn('  ****************************************************************');
    console.warn('  *  WARNING: ACCESS_TOKEN is not set and NODE_ENV=production.   *');
    console.warn('  *  This backend is OPEN: anyone who learns the URL can spend   *');
    console.warn('  *  your AI provider credits. Set ACCESS_TOKEN (and             *');
    console.warn('  *  ALLOWED_ORIGINS) before sharing this deployment.            *');
    console.warn('  ****************************************************************');
    console.warn('');
  }
  console.log(`ClariWord backend listening on http://localhost:${PORT}`);
  console.log(`  provider: ${provider.model ?? 'unknown'}`);
  console.log(`  auth:     ${ACCESS_TOKEN ? 'bearer token required' : 'open (set ACCESS_TOKEN to require one)'}`);
  console.log(`  origins:  ${ALLOWED.length ? ALLOWED.join(', ') : 'any (set ALLOWED_ORIGINS in production)'}`);
});

export { server };
