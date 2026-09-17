# ClariWord backend (reference implementation)

The extension holds no AI provider key. This server does.

```
Extension → service worker → THIS SERVER → AI provider
```

Node 20+, no dependencies, ~250 lines.

## Run it

```bash
cp .env.example .env      # add PROVIDER + your API key
npm run start:local       # = node --env-file=.env server.js
```

`npm start` runs plain `node server.js`, with no `--env-file`. That is the form
platforms want: they inject environment variables directly and there is no
`.env` file on the box. Use `start:local` for local development.

Then in ClariWord → Settings → AI backend: set Mode to **Backend**, enter
`http://localhost:8787`, and press **Test connection**.

Without a key it starts anyway, using the `echo` provider, which returns a
clearly-labelled placeholder so you can verify the wiring:

```bash
node server.js
node smoke.js       # 11 checks, no key needed
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8787` | |
| `PROVIDER` | *(empty → echo)* | `anthropic` · `openai` · empty |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Whichever provider you chose |
| `OPENAI_BASE_URL` | OpenAI | Only for OpenAI-compatible services; leave unset for OpenAI itself |
| `MODEL` | provider default | |
| `ACCESS_TOKEN` | — | If set, requires `Authorization: Bearer …`; paste the same value into Settings. Unset with `NODE_ENV=production` logs a loud startup warning |
| `ALLOWED_ORIGINS` | any | Set to `chrome-extension://<your id>` in production |
| `RATE_LIMIT_PER_MINUTE` | `20` | Per client IP, in memory |

## Deploy to Railway

Railway builds this directory directly — there is nothing to compile and no
dependencies to install.

**1. Point Railway at `backend/`.** In the service's
*Settings → Source → Root Directory*, set:

```
backend
```

That makes `backend/` the build context, which is why
[`railway.json`](./railway.json) says `"startCommand": "node server.js"` and not
`cd backend && …`. Railway reads the `railway.json` inside the root directory,
so it is picked up automatically.

**2. Set the environment variables** in *Settings → Variables*:

| Variable | Set it to | Required |
| --- | --- | --- |
| `PROVIDER` | `anthropic` or `openai` | Yes — without it you deploy the echo placeholder |
| `ANTHROPIC_API_KEY` | your key, if `PROVIDER=anthropic` | One of the two |
| `OPENAI_API_KEY` | your key, if `PROVIDER=openai` | One of the two |
| `OPENAI_BASE_URL` | *leave unset for OpenAI* | Only for compatible services |
| `MODEL` | e.g. `gpt-4o-mini` | No — defaults to `gpt-4o-mini` |
| `ACCESS_TOKEN` | a long random string | **Yes in practice** — see below |
| `ALLOWED_ORIGINS` | `chrome-extension://<your published id>` | Strongly recommended |
| `RATE_LIMIT_PER_MINUTE` | e.g. `20` | No — defaults to `20` |
| `NODE_ENV` | `production` | Recommended — enables the missing-token warning |

Generate a token with `openssl rand -hex 32`, then paste the same value into
ClariWord → Settings → Access token.

**Do not set `PORT`.** Railway injects it, and the server already reads
`process.env.PORT`. Setting it yourself will break the healthcheck.

**3. Deploy.** Railway runs the healthcheck against `/api/health`, which is
deliberately unauthenticated and returns 200 even when `ACCESS_TOKEN` is set, so
the check passes on a locked-down instance. On failure the service restarts
(`ON_FAILURE`, up to 10 retries).

**4. Point the extension at it.** Copy the generated
`https://<service>.up.railway.app` domain into ClariWord → Settings → AI backend
and press **Test connection**.

### Using OpenAI

`PROVIDER=openai` is the adapter's native target, so there is nothing to
redirect — set the key and go:

```
PROVIDER=openai
OPENAI_API_KEY=sk-...
MODEL=gpt-4o-mini
```

Get the key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
`MODEL` is optional — the adapter already defaults to `gpt-4o-mini`.

Leave **`OPENAI_BASE_URL` unset**. It exists only to point the same adapter at
an OpenAI-*compatible* service (a self-hosted gateway, or Gemini's compat
endpoint). If it is left over from an earlier provider, requests still go
there and OpenAI is never reached — delete the variable.

One failure mode worth knowing, because it is silent: **`PROVIDER` must be
exactly `openai`.** Any other value falls through to the echo provider and the
extension shows placeholder text instead of an error. `/api/health` tells you
which one is live — it reports the model name, or `echo (no provider
configured)`.

### A public URL is a public bill

A Railway deployment is reachable by anyone who learns the URL. Without
`ACCESS_TOKEN` set, anyone who finds it can spend your provider credits — which
is why the server logs a loud warning at startup when `ACCESS_TOKEN` is unset and
`NODE_ENV=production`. Set both `ACCESS_TOKEN` and `ALLOWED_ORIGINS`.

Note that the rate limiter is in-memory and per-instance: it resets on every
deploy and does not span replicas. It blunts accidental loops, not a determined
abuser.

## Estimated cost

Rough per-lookup figures so you can sanity-check a bill. Input sizes are measured
from the actual prompts in `prompts.js` (a typical selection with one sentence of
context, a page title and a domain); output sizes are typical filled schemas.

**Token counts are estimated at ~4 characters per token and outputs are typical,
not measured against your traffic.** Treat these as an order of magnitude, and
read the real numbers off your provider dashboard.

At **`gpt-4o-mini`** rates ($0.15 / MTok input, $0.60 / MTok output):

| Route | Input tokens | Output tokens | Cost / 1,000 lookups |
| --- | --- | --- | --- |
| `/api/explain` — word | ~740 | ~260 | **~$0.27** |
| `/api/explain` — phrase | ~650 | ~300 | ~$0.28 |
| `/api/explain` — sentence | ~660 | ~420 | ~$0.35 |
| `/api/explain` — passage | ~610 | ~520 | ~$0.40 |
| `/api/chat` — one follow-up | ~440 | ~150 | ~$0.16 |

So **roughly $0.27 per 1,000 word lookups**, the most common case, and about
$0.40 per 1,000 for the longest passages. A worst case where every response runs
to its `max_tokens` cap (800 for words, 1,200 otherwise) is ~$0.43–$0.82 per
1,000.

Output dominates: the prompts are long but fixed, while the answer is what you
actually pay for. That is why capping `max_tokens` matters more than trimming the
system prompt.

The same token counts at other models' rates, for a word lookup per 1,000:

| Model | Input / output per MTok | Cost / 1,000 word lookups |
| --- | --- | --- |
| `gpt-4o-mini` | $0.15 / $0.60 | ~$0.27 |
| `gpt-4.1-mini` | $0.40 / $1.60 | ~$0.71 |
| `gemini-2.5-flash` | $0.30 / $2.50 | ~$0.87 |
| `gpt-4o` | $2.50 / $10.00 | ~$4.46 |
| `claude-sonnet-4-5` | $3.00 / $15.00 | ~$6.13 |

Two things that move this number more than the model choice:

- **The extension caches locally**, so repeat lookups of the same word on the
  same page do not reach the backend at all.
- **Follow-up chat turns resend the explanation and history**, so a conversation
  costs more per turn as it grows. History is capped at 12 messages.

## Routes

`GET /api/health` · `POST /api/explain` · `POST /api/chat` ·
`POST /api/pronunciation` (501 by design).

Full contract: [`../docs/API.md`](../docs/API.md).

## Files

- `server.js` — routing, CORS, auth, rate limiting, input bounds, output validation
- `prompts.js` — the system prompts; this is where explanation quality lives
- `provider.js` — Anthropic / OpenAI-compatible / echo adapters
- `smoke.js` — end-to-end checks against a live instance

## Adding a provider

Implement `complete({ system, user, maxTokens })` returning the raw text, and
add a branch to `createProvider`. Nothing else changes.

## Hardening before production

- Put it behind TLS and your own infrastructure.
- Replace the in-memory rate limiter with a shared store; it resets on restart
  and does not span instances.
- Set `ALLOWED_ORIGINS` and `ACCESS_TOKEN`.
- Add per-user quotas and a response cache — the extension caches locally, which
  helps latency but does not protect your provider bill.
- Log failures, not request bodies. Request bodies contain what people are
  reading.
