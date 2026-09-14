# Architecture

Why the pieces are where they are.

## The three contexts, and the rule for each

| Context | May do | May **not** do |
| --- | --- | --- |
| **Content script** | Read the selection, extract a bounded context, render UI in a shadow root, speak text | Touch the network, hold secrets, write storage |
| **Service worker** | Call the backend, read/write storage, own the context menu and commands | Render anything |
| **Extension pages** | Render, take user input, request permissions and the microphone | Call the AI backend directly (they go through the worker) |

Everything crosses those boundaries through one typed bus,
`src/shared/messaging.ts`. A `MessageMap` interface pairs each message name with
its request and response type, so `sendMessage('SAVE_ENTRY', input)` is checked
at compile time on both ends, and `registerHandlers<MessageMap>({...})` cannot
forget a return shape. Failures cross the boundary as a serialised `ClariError`
with a code, a human message, an optional next step, and a retryable flag.

## Why the service worker owns persistence

Two tabs can save the same word at the same moment. If each tab did its own
read-modify-write against `chrome.storage`, one would lose. All writes go
through the single worker, and `WriteQueue` serialises read-modify-write cycles
within it, so "save" and "record encounter" can never interleave destructively.

The collection lives under one key as `Record<id, VocabularyEntry>`, with an
in-memory cache invalidated by `chrome.storage.onChanged`. That is the right
trade at vocabulary scale (hundreds to low thousands of entries, a few KB each);
if it ever stops being right, `services/migrations.ts` is where the move to
per-entry keys goes, and the repository API does not change.

## Why a closed Shadow DOM

The injected UI lands on pages whose CSS we do not control and must not disturb.

- `all: initial !important` on the host neutralises inherited font size, box
  sizing and any `* { ... !important }` reset the page applies.
- A custom tag name (`<clariword-root>`) cannot be hit by page rules like
  `div { ... }`.
- A **closed** root means page scripts cannot reach in through `.shadowRoot`.
  Development builds use an open root so the e2e suite can drive the UI; that is
  the only behavioural difference between dev and production.
- The host is 0×0 and every floating piece is `position: fixed` on its own, so
  an idle page carries no full-viewport compositing layer.

`tests/fixtures/article.html` ships hostile CSS on purpose, and the e2e suite
asserts computed `box-sizing`, `font-size` and button borders inside the card
are ours, not the page's.

## No innerHTML

Every node in the injected UI is built by `content/ui/dom.ts`, whose only text
path is `textContent`. Model output and page text therefore cannot become
markup. The extension pages follow the same rule.

## Selection → context, and the privacy budget

`selection-manager.ts` listens passively to `mouseup`, `touchend`, `keyup` and
`selectionchange`, settles for 140 ms, then measures once. No `MutationObserver`,
no polling. Scroll and resize listeners are attached only while something is
open, and are rAF-throttled.

`context-extractor.ts` walks up to the nearest block element that reads like
prose (skipping `nav`, `header`, `footer`, `aside`, scripts and controls), takes
its text, and finds the sentence around the selection — reaching into the
previous or next paragraph only when the neighbouring sentence would otherwise
be missing.

`ai-service.ts::buildOutgoingContext` is then the **single** place where text is
prepared for the network. It applies the user's privacy settings and caps every
field. Settings renders its "what gets sent" line by calling
`describeOutgoingPayload` — the same function — so the promise cannot drift from
the behaviour. The full URL is never included, by construction, not by policy.

## Validation on both sides

Model output is untrusted input. The backend refuses payloads missing required
fields (502), and the extension validates again before rendering:

- **Required** fields (`word` + `contextualMeaning`, `simpleMeaning`, …) missing
  → the whole response is rejected and the card shows an error.
- **Decorative** fields (synonyms, tone, example) are coerced to safe defaults,
  so one missing field never blanks a card.
- Every string is length-capped, so a runaway generation cannot blow up the UI.
- The parser tolerates a ``` fence or surrounding prose, because models do that.

Demo mode runs through the same validator and the same renderers, so the offline
path exercises the production code path rather than a parallel one.

## Explanation shape is a product decision, not a model decision

`classifySelection()` decides word / phrase / sentence / passage from word count
and punctuation. That choice picks the response schema, the prompt, the renderer
and the action row. The renderer then enforces the ordering the product is built
on — *contextual meaning first, dictionary meaning second* — rather than trusting
the model to lead with the right thing.

## Scheduling and learning state

`ReviewState` carries `due`, `intervalDays`, `ease`, `repetitions`, `lapses` and
per-outcome counts from day one. `scheduleNextReview()` is an SM-2 variant
trimmed to what a vocabulary quiz needs. Phase 1 only surfaces "due now", so
turning on full spaced repetition is a UI change, not a data migration.

`deriveStatus()` maps that state onto New / Learning / Familiar / Mastered, and
the user can override it by hand — the override wins.

The signals an adaptive system would need (lookups, saves, encounter counts per
word, review outcomes, difficulty of the words selected) are already being
recorded. Nothing consumes them yet, on purpose.

## Pronunciation, honestly

`PronunciationScorer` has two implementations. `BackendScorer` posts the
recording and validates a numeric `overall`. `SimulatedScorer` is a development
stand-in that always sets `simulated: true`, and the UI renders a warning banner
above its output saying the numbers are generated and say nothing about the
recording. The reference backend returns 501 for the scoring route rather than
inventing something plausible.

The microphone is requested by `practice.html` — an extension page with the
extension's own origin — not by a content script on someone else's site. The
prompt names ClariWord, and the grant never touches the pages you read.

## Build

esbuild bundles seven entry points: the service worker (ESM, as MV3 requires),
the content script (IIFE, single file), and one module per extension page.
Static files are copied by extension, and the build fails if `manifest.json`
references a file that was not produced. `__DEV__` and `__VERSION__` are compile
-time constants. There are no runtime dependencies — nothing ships in `dist/`
that is not in this repository.
