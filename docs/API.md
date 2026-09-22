# ClariWord backend API

The extension talks to exactly one thing over the network: a backend you
control. This is the contract between them.

Base URL is whatever the user sets in **Settings → AI backend**. All routes are
relative to it. Every request is `application/json`, except
`POST /api/pronunciation`, which is `multipart/form-data`.

If you set `ACCESS_TOKEN` on the backend, the extension sends
`Authorization: Bearer <token>` on every request.

---

## `GET /api/health`

Used by the **Test connection** button in Settings.

```json
{ "status": "ok", "model": "claude-sonnet-4-5", "version": 1 }
```

---

## `POST /api/explain`

### Request

```json
{
  "selectedText": "ostensibly",
  "sentence": "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
  "previousSentence": "Ministers announced the change on Tuesday.",
  "nextSentence": "Critics were quick to respond.",
  "pageTitle": "",
  "pageDomain": "",
  "selectionType": "word",
  "intent": "explain",
  "explanationLevel": "intermediate",
  "accent": "american",
  "clientVersion": "1.0.0"
}
```

| Field | Notes |
| --- | --- |
| `selectedText` | Required. Capped at 4000 characters; the extension refuses longer selections before sending. |
| `sentence` | Empty when the selection *is* the whole sentence. |
| `previousSentence` / `nextSentence` | Empty unless the user has neighbouring context enabled (default: on). |
| `pageTitle` / `pageDomain` | Empty unless the user opted into page metadata (default: off). **The full URL is never sent.** |
| `selectionType` | `word` · `phrase` · `sentence` · `passage` — decided client-side by `classifySelection()`. |
| `intent` | `explain` · `simplify` · `grammar` · `examples` · `why-this-word` · `key-vocabulary`. A hint, not a different route. |
| `explanationLevel` | `beginner` · `intermediate` · `advanced`. |
| `accent` | `american` · `british`. Drives IPA and voice selection. |

### Response

One JSON object whose `type` matches `selectionType`. Every field must be
present; use `""` or `[]` for anything that does not apply. The extension
re-validates: **required** fields failing means the card shows an error rather
than a half-empty explanation; optional fields are coerced to safe defaults.

#### `type: "word"` — required: `word`, `contextualMeaning`

```json
{
  "type": "word",
  "word": "ostensibly",
  "ipa": "/ɑːˈstɛnsəbli/",
  "phonetic": "os-TEN-suh-blee",
  "partOfSpeech": "adverb",
  "contextualMeaning": "Something appears to be true, although it may not actually be.",
  "simpleMeaning": "Apparently, but perhaps not actually.",
  "authorIntent": "The wording suggests the writer doubts the stated reason is the real one.",
  "tone": "Formal, somewhat skeptical",
  "register": "Academic / journalistic",
  "synonyms": ["apparently", "seemingly", "supposedly"],
  "naturalAlternative": "apparently",
  "example": "The project was ostensibly created to reduce costs.",
  "sentenceExplanation": "The policy looks practical on the surface.",
  "confidence": "high",
  "ambiguityNote": "optional; only when the selection genuinely has more than one reading here"
}
```

`phonetic` uses hyphen-separated syllables with the stressed one in CAPS — the
card renders that syllable in the accent colour *and* leaves it capitalised, so
the stress is never communicated by colour alone.

`ipa` may be sent with or without slashes; the extension normalises it.

#### `type: "sentence"` — required: `simpleMeaning`

```json
{
  "type": "sentence",
  "simpleMeaning": "...",
  "authorMeaning": "...",
  "tone": "...",
  "register": "...",
  "simplifiedRewrite": "...",
  "segments": [{ "text": "verbatim clause from the sentence", "meaning": "..." }],
  "keyVocabulary": [{ "word": "belies", "gloss": "hides the truth", "ipa": "/bɪˈlaɪz/" }],
  "grammarNote": "optional",
  "confidence": "high"
}
```

2–5 segments. Explain the pieces that carry the meaning; do not define every word.

#### `type: "phrase"` — required: `phrase`, `meaning`

```json
{
  "type": "phrase",
  "phrase": "move the goalposts",
  "meaning": "...",
  "contextualMeaning": "...",
  "literalMeaning": "optional, for idioms",
  "figurative": true,
  "register": "Informal / idiomatic",
  "tone": "Critical",
  "example": "...",
  "alternatives": ["..."],
  "keyVocabulary": [],
  "confidence": "high"
}
```

#### `type: "passage"` — required: `summary`

```json
{
  "type": "passage",
  "summary": "...",
  "simpleMeaning": "...",
  "tone": "...",
  "register": "...",
  "keyPoints": ["..."],
  "segments": [{ "text": "verbatim sentence", "meaning": "..." }],
  "keyVocabulary": [],
  "simplifiedRewrite": "...",
  "confidence": "high"
}
```

`keyVocabulary` also accepts an array of bare strings; they become entries with
an empty gloss.

---

## `POST /api/explain/stream`

Same request body as `POST /api/explain`, but the explanation is delivered as
it is generated so the card can fill in rather than wait. Roughly 3 seconds of
model time becomes well under a second before the reader sees the word, its
pronunciation and what it means here.

`content-type: application/x-ndjson` — one JSON object per line, flushed as it
is produced. Three frame types:

```jsonc
{ "type": "field", "key": "contextualMeaning", "value": "..." }  // 0..n
{ "type": "done",  "explanation": { ... } }                      // exactly 1
{ "type": "error", "status": 502, "error": "..." }               // on failure
```

`field` frames carry only *completed* top-level string values, so a client
never sees half a sentence. Arrays and nested objects are omitted here and
arrive with `done`.

The `done` frame holds the full explanation, parsed and validated by the same
code `/api/explain` uses — a stream cannot return a shape the non-streaming
route would have rejected. **Treat `done` as authoritative** and the `field`
frames as a preview.

Because the response status is sent before generation begins, a mid-stream
failure arrives as an `error` frame on a 200 response rather than an HTTP error
code. A client that cannot use partial output should call `/api/explain`, which
is unchanged and returns one complete payload.

---

## `POST /api/chat`

Same context fields as `/api/explain`, plus:

```json
{
  "question": "Is this formal English?",
  "explanation": { "…the explanation already shown to the reader…" },
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
}
```

`history` is capped at the last 12 turns by the extension and again by the
backend.

```json
{ "answer": "…" }
```

A bare string is also accepted. Empty answers are rejected.

---

## `POST /api/pronunciation`

`multipart/form-data` with `audio` (webm), `word`, `phonetic`, `ipa`, `accent`.

The reference backend returns **501** on purpose: scoring requires a speech
model, and ClariWord must never show a number it did not measure. Implement this
route and return:

```json
{
  "overall": 82,
  "stressCorrect": true,
  "transcript": "ostensibly",
  "feedback": "Make the \"TEN\" syllable slightly stronger.",
  "perSyllable": [{ "syllable": "os", "score": 88 }, { "syllable": "TEN", "score": 71 }]
}
```

Anything without a numeric `overall` is rejected by the extension. Responses
from a real backend are shown as measurements; the built-in dev simulator is
always labelled as simulated output in the UI.

---

## Errors

| Status | Meaning | What the user sees |
| --- | --- | --- |
| 400 | Malformed request | "The AI response was not in the expected format" path is not used; this is a bug in the client |
| 401 | Bad or missing access token | Backend error with the status |
| 413 | Body too large | Backend error |
| 429 | Rate limited | "Too many requests. Try again in about Ns." (`Retry-After` is honoured) |
| 5xx | Server or provider failure | Retryable error with a "Try again" button and a pointer to Demo mode |

Non-JSON bodies, JSON wrapped in a ``` fence, or JSON surrounded by prose are all
tolerated by the extension's parser — but a clean JSON body is what the contract
asks for.

---

## CORS

Extension requests originate from `chrome-extension://<id>`. The reference
backend echoes the origin when `ALLOWED_ORIGINS` is empty (development) and
otherwise allows only the listed origins. Set it to your published extension id
in production.

Because the backend sends the right CORS headers, the extension can reach it
without a Chrome host permission. The **Test connection** button still requests
one, so that a backend without CORS headers also works.
