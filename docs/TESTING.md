# Test checklist

Automated coverage first, then the things a person has to look at.

## Automated

```bash
npm run typecheck            # strict tsc, zero errors
npm test                     # 55 unit tests
node scripts/e2e.mjs         # 36 checks in a real Chromium with the extension loaded
cd backend && node smoke.js  # 11 backend checks, no API key required
```

`scripts/e2e.mjs` needs a Chromium binary. It uses `CHROMIUM_PATH` if set,
otherwise Playwright's. Run `node build.mjs --dev` first — the e2e suite drives
the injected UI, which needs the development build's open shadow root.

`scripts/screenshots.mjs` captures reference images into `docs/screens/`. It is
best-effort development tooling: headless Chromium in a container is flaky about
screenshotting a page that carries an extension overlay, and the script skips a
scenario rather than failing the run.

## Manual — core flow

- [ ] Highlight a single word → the trigger appears next to it, not over it
- [ ] Click it → the card opens **immediately** with a loading line, then content
- [ ] The contextual meaning is above the general meaning
- [ ] IPA and the respelling are shown; the stressed syllable is visibly marked
- [ ] Highlight a full sentence → a breakdown, not a list of definitions
- [ ] Highlight an idiom (`moved the goalposts`) → explained as a unit
- [ ] Highlight a whole paragraph → a summary plus a sentence-by-sentence pass
- [ ] Select a word, then a different word without closing → the card updates and
      the stale response does not overwrite the new one

## Manual — dismissal and keyboard

- [ ] `Escape` closes the card
- [ ] Clicking outside the card closes it
- [ ] Clicking *inside* the card does not close it
- [ ] `Tab` cycles within the card and does not escape into the page behind
- [ ] Focus rings are visible on every control
- [ ] `Alt+Shift+E` explains the current selection; `Alt+Shift+V` opens vocabulary
- [ ] A screen reader announces the card as a dialog and reads the explanation

## Manual — right-click

- [ ] Select text, right-click → "Explain with ClariWord AI" with four sub-items
- [ ] Explain / Explain more simply open the card
- [ ] Pronounce speaks without opening the card
- [ ] Save adds the word and the card confirms

## Manual — positioning

- [ ] Selection at the very top of the page → the card appears **below** it
- [ ] Selection at the very bottom → the card appears **above** it
- [ ] Selection behind a sticky site header (try a news site) → the card is not
      hidden underneath it
- [ ] Selection at the far left and far right edges → the card stays on screen
- [ ] Narrow window (~420 px) → the card still fits
- [ ] Scroll while the card is open → it stays on screen; scroll with only the
      trigger showing → it follows, then hides when the selection leaves view

## Manual — vocabulary

- [ ] Save a word → it appears in the dashboard with its source and date
- [ ] Save the **same** word again from a different page → one entry, encounter
      count 2, both sentences listed in the detail view
- [ ] The detail view shows the original sentence and a working **View source**
- [ ] Search matches the word, the meaning, the saved sentence and the source
- [ ] Status filters and the six collections each return what they claim
- [ ] Change a status by hand → it sticks
- [ ] Favourite, notes and delete all persist across a reload
- [ ] Review: answer correctly → the original sentence is shown; answer wrongly →
      the correct option is marked and the word comes back sooner
- [ ] The toolbar badge shows the number of words due

## Manual — settings

- [ ] Every control persists across a browser restart
- [ ] Disabling the extension stops the helper appearing on pages
- [ ] Icon vs quick-toolbar changes what appears after highlighting
- [ ] Beginner / Intermediate / Advanced visibly change the explanation
- [ ] American / British change the IPA and the voice
- [ ] Light / Dark / System apply to both the card and the extension pages
- [ ] Adding a domain to "Never run on these sites" silences it there
- [ ] The privacy line matches what the settings above it are set to
- [ ] Export JSON downloads everything; Clear saved data empties it

## Manual — speech

- [ ] Listen speaks the word; pressing it again stops playback
- [ ] Read aloud speaks a whole sentence
- [ ] The rate slider changes speed
- [ ] Choosing a specific voice is respected
- [ ] On a machine with no English voices, the UI says so instead of failing silently

## Manual — practice

- [ ] Opening from the card pre-fills the word with its pronunciation
- [ ] Listen and Listen slowly both work
- [ ] Record prompts for the microphone once, shows a level meter and a timer
- [ ] Playback works; "Play model, then yours" plays both
- [ ] Denying the microphone shows a recovery hint rather than a dead button
- [ ] Without a speech backend, scoring says it needs one
- [ ] The dev simulator's output is clearly banner-labelled as simulated

## Manual — failure paths

- [ ] Backend mode with the server stopped → "Could not reach…" plus Try again
- [ ] Backend returning 500 → error with the status, Try again offered
- [ ] Backend returning malformed JSON → "not in the expected format", no crash
- [ ] Offline (DevTools → Network → Offline) → offline message; the dashboard
      and review still work
- [ ] Select ~2000 characters → refused with the limit named, nothing transmitted
- [ ] Rapid repeated lookups → rate-limit message rather than a hang
- [ ] `chrome://extensions` or the Web Store → no injection, no console errors

## Manual — real sites

Check the flow, the positioning and that nothing on the page shifts:

- [ ] Wikipedia (dense links inside paragraphs)
- [ ] A Medium-style article (sticky header, wide margins)
- [ ] A news site (ads, overlays, multiple fixed elements)
- [ ] MDN or another documentation site (code blocks next to prose)
- [ ] A GitHub README (the page's own tooltips and sticky header)
- [ ] Reddit (nested comments, dynamic loading)
- [ ] A page in dark mode, and a page whose CSS is aggressive about `!important`
- [ ] Two tabs at once → saving in one is reflected in the other's dashboard
- [ ] Navigate within a single-page app → no stale card, no duplicate host element
