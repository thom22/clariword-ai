/**
 * Backend smoke test — no provider key needed (falls back to the echo provider).
 *
 *   node smoke.js
 */
process.env.PORT = process.env.PORT ?? '8799';
process.env.PROVIDER = '';

const { server } = await import('./server.js');
const base = `http://127.0.0.1:${process.env.PORT}`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
};

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const sample = {
  selectedText: 'ostensibly',
  sentence: "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
  selectionType: 'word',
  explanationLevel: 'intermediate',
  accent: 'american',
};

await new Promise((resolve) => setTimeout(resolve, 200));

try {
  const health = await fetch(`${base}/api/health`);
  check('GET /api/health returns 200', health.status === 200);
  check('health reports the model', !!(await health.json()).model);

  const explain = await post('/api/explain', sample);
  check('POST /api/explain returns 200', explain.status === 200, String(explain.status));
  const payload = await explain.json();
  check('explain returns a typed explanation', payload.type === 'word', JSON.stringify(payload).slice(0, 120));

  const missing = await post('/api/explain', { sentence: 'no selection here' });
  check('a missing selection is a 400', missing.status === 400, String(missing.status));

  const chat = await post('/api/chat', { ...sample, question: 'Is this formal English?' });
  check('POST /api/chat returns an answer', chat.status === 200 && typeof (await chat.json()).answer === 'string');

  const streamed = await post('/api/explain/stream', sample);
  const frames = (await streamed.text()).trim().split('\n').map((line) => JSON.parse(line));
  check('POST /api/explain/stream returns 200', streamed.status === 200, String(streamed.status));
  check('the stream emits fields before it finishes', frames.some((f) => f.type === 'field'));
  check(
    'the stream ends with a validated explanation',
    frames.at(-1)?.type === 'done' && frames.at(-1)?.explanation?.type === 'word',
    JSON.stringify(frames.at(-1)).slice(0, 120),
  );

  const scoring = await post('/api/pronunciation', {});
  check('pronunciation scoring is honestly unimplemented', scoring.status === 501, String(scoring.status));

  const huge = await post('/api/explain', { selectedText: 'x'.repeat(40_000) }).catch(() => ({ status: 'connection closed' }));
  check('oversized bodies are rejected', huge.status === 413 || huge.status === 400, String(huge.status));

  const notFound = await post('/api/nope', {});
  check('unknown routes are 404', notFound.status === 404);

  const options = await fetch(`${base}/api/explain`, { method: 'OPTIONS', headers: { origin: 'chrome-extension://abc' } });
  check('CORS preflight succeeds', options.status === 204 && !!options.headers.get('access-control-allow-origin'));
} finally {
  server.close();
}

console.log(failures === 0 ? '\nbackend smoke test passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
