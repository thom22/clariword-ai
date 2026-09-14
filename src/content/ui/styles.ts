/**
 * Styles for the injected UI.
 *
 * Lives inside a closed Shadow DOM, so page CSS cannot reach in and these
 * rules cannot leak out. `all: initial` on :host resets everything the page
 * might have inherited (font-size on <html>, box-sizing, line-height…).
 */
export const CONTENT_STYLES = /* css */ `
:host {
  all: initial;
  --cw-accent: #0E7C66;
  --cw-accent-strong: #0A5F4E;
  --cw-accent-soft: #E4F1ED;
  --cw-bg: #FFFFFF;
  --cw-bg-sunken: #FAF9F7;
  --cw-text: #1C1B1A;
  --cw-text-soft: #5B5954;
  --cw-text-faint: #85827B;
  --cw-border: #E7E4DE;
  --cw-border-strong: #D7D3CB;
  --cw-shadow: 0 1px 2px rgba(28,27,26,.06), 0 12px 32px -8px rgba(28,27,26,.18);
  --cw-radius: 14px;
  --cw-focus: #0E7C66;
  font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  color-scheme: light;
}

.cw-root[data-theme="dark"] {
  --cw-accent: #4FBFA3;
  --cw-accent-strong: #6FD5BA;
  --cw-accent-soft: #16342D;
  --cw-bg: #1B1E1D;
  --cw-bg-sunken: #232726;
  --cw-text: #F2F0EC;
  --cw-text-soft: #B9B6AF;
  --cw-text-faint: #8D8A83;
  --cw-border: #323735;
  --cw-border-strong: #434846;
  --cw-shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px -10px rgba(0,0,0,.6);
  --cw-focus: #6FD5BA;
  color-scheme: dark;
}

.cw-root, .cw-root * { box-sizing: border-box; }
/*
 * Zero-size container: every child is fixed-positioned on its own, so the root
 * never needs to cover the viewport. Keeping it 0x0 means an idle page carries
 * no full-screen compositing layer at all.
 */
.cw-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  font-size: 14px;
  line-height: 1.5;
  color: var(--cw-text);
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: none;
  margin: 0;
  cursor: pointer;
}
:focus-visible {
  outline: 2px solid var(--cw-focus);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ---------------- floating trigger ---------------- */

.cw-trigger {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px 0 8px;
  background: var(--cw-bg);
  border: 1px solid var(--cw-border);
  border-radius: 999px;
  box-shadow: var(--cw-shadow);
  color: var(--cw-text);
  font-size: 13px;
  font-weight: 550;
  letter-spacing: -0.01em;
  animation: cw-pop 120ms ease-out;
  transition: border-color 120ms ease, transform 120ms ease;
}
.cw-trigger:hover { border-color: var(--cw-border-strong); transform: translateY(-1px); }
.cw-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 5px;
  background: var(--cw-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}

/* ---------------- quick toolbar ---------------- */

.cw-toolbar {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--cw-bg);
  border: 1px solid var(--cw-border);
  border-radius: 12px;
  box-shadow: var(--cw-shadow);
  animation: cw-pop 120ms ease-out;
}
.cw-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 550;
  color: var(--cw-text-soft);
  white-space: nowrap;
}
.cw-toolbar button:hover { background: var(--cw-bg-sunken); color: var(--cw-text); }
.cw-toolbar button svg { width: 15px; height: 15px; fill: currentColor; }
.cw-toolbar .cw-sep { width: 1px; height: 18px; background: var(--cw-border); margin: 0 2px; }

/* ---------------- card ---------------- */

.cw-card {
  position: fixed;
  width: 372px;
  max-width: calc(100vw - 16px);
  max-height: min(560px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  background: var(--cw-bg);
  border: 1px solid var(--cw-border);
  border-radius: var(--cw-radius);
  box-shadow: var(--cw-shadow);
  overflow: hidden;
  animation: cw-rise 140ms cubic-bezier(.2,.8,.3,1);
}
.cw-card[data-expanded="true"] { width: 420px; }

@keyframes cw-pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
@keyframes cw-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .cw-trigger, .cw-toolbar, .cw-card { animation: none; }
  .cw-trigger:hover { transform: none; }
}

.cw-card-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 12px 11px 15px;
  border-bottom: 1px solid var(--cw-border);
  background: var(--cw-bg);
}
.cw-head-main { flex: 1; min-width: 0; }
.cw-term {
  margin: 0;
  font-size: 19px;
  font-weight: 620;
  letter-spacing: -0.015em;
  line-height: 1.25;
  word-break: break-word;
}
.cw-term-long { font-size: 14px; font-weight: 560; color: var(--cw-text-soft); }
.cw-pron { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.cw-ipa { font-size: 13px; color: var(--cw-text-faint); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.cw-phonetic { font-size: 12.5px; color: var(--cw-text-soft); }
.cw-phonetic .cw-stress { color: var(--cw-accent); font-weight: 680; }
.cw-pos {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  text-transform: lowercase;
  color: var(--cw-text-soft);
  background: var(--cw-bg-sunken);
  border: 1px solid var(--cw-border);
  border-radius: 999px;
  padding: 1px 7px;
}

.cw-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  color: var(--cw-text-soft);
}
.cw-icon-btn:hover { background: var(--cw-bg-sunken); color: var(--cw-text); }
.cw-icon-btn svg { width: 17px; height: 17px; fill: currentColor; }
.cw-icon-btn[aria-pressed="true"] { color: var(--cw-accent); }
.cw-icon-btn[data-variant="speak"] svg { width: 18px; height: 18px; }

.cw-card-body {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 13px 15px 4px;
  scrollbar-width: thin;
}
.cw-card-body::-webkit-scrollbar { width: 9px; }
.cw-card-body::-webkit-scrollbar-thumb { background: var(--cw-border-strong); border-radius: 9px; border: 3px solid var(--cw-bg); }

.cw-section { margin-bottom: 13px; }
.cw-label {
  display: block;
  font-size: 10.5px;
  font-weight: 680;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: var(--cw-text-faint);
  margin-bottom: 3px;
}
.cw-body-text { margin: 0; font-size: 14px; line-height: 1.55; color: var(--cw-text); }
.cw-body-text.cw-soft { color: var(--cw-text-soft); font-size: 13.5px; }
.cw-lead {
  font-size: 15px;
  line-height: 1.5;
  letter-spacing: -0.005em;
}
.cw-quote {
  margin: 0;
  padding-left: 10px;
  border-left: 2px solid var(--cw-accent-soft);
  color: var(--cw-text-soft);
  font-size: 13.5px;
}

.cw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cw-chip {
  font-size: 12.5px;
  color: var(--cw-text-soft);
  background: var(--cw-bg-sunken);
  border: 1px solid var(--cw-border);
  border-radius: 7px;
  padding: 3px 8px;
}
.cw-chip[data-clickable="true"]:hover { border-color: var(--cw-accent); color: var(--cw-accent); }
.cw-tone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--cw-text-soft);
}
.cw-tone::before {
  content: "";
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--cw-accent);
  flex: none;
}

.cw-segments { display: grid; gap: 9px; }
.cw-segment { display: grid; gap: 2px; }
.cw-segment-text {
  font-size: 13.5px;
  font-weight: 570;
  color: var(--cw-text);
}
.cw-segment-meaning {
  font-size: 13.5px;
  color: var(--cw-text-soft);
  padding-left: 14px;
  position: relative;
}
.cw-segment-meaning::before {
  content: "→";
  position: absolute;
  left: 0;
  color: var(--cw-accent);
}

.cw-vocab { display: grid; gap: 6px; }
.cw-vocab-row { display: flex; gap: 8px; align-items: baseline; }
.cw-vocab-word { font-weight: 600; font-size: 13.5px; }
.cw-vocab-gloss { color: var(--cw-text-soft); font-size: 13px; flex: 1; min-width: 0; }

.cw-note {
  display: flex;
  gap: 8px;
  padding: 9px 10px;
  background: var(--cw-bg-sunken);
  border: 1px solid var(--cw-border);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--cw-text-soft);
}
.cw-note[data-variant="demo"] { border-color: var(--cw-accent); background: var(--cw-accent-soft); color: var(--cw-text); }

/* ---------------- actions ---------------- */

.cw-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 15px 11px;
  border-top: 1px solid var(--cw-border);
  background: var(--cw-bg);
}
.cw-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 29px;
  padding: 0 10px;
  border: 1px solid var(--cw-border);
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--cw-text-soft);
  background: var(--cw-bg);
  transition: border-color 120ms ease, color 120ms ease;
}
.cw-action:hover:not(:disabled) { border-color: var(--cw-accent); color: var(--cw-accent); }
.cw-action:disabled { opacity: .5; cursor: default; }
.cw-action[data-primary="true"] {
  background: var(--cw-accent);
  border-color: var(--cw-accent);
  color: #fff;
}
.cw-action[data-primary="true"]:hover:not(:disabled) { background: var(--cw-accent-strong); color: #fff; }
.cw-action svg { width: 14px; height: 14px; fill: currentColor; }
/* :not(primary) — a pressed primary button keeps its white-on-accent styling. */
.cw-action[aria-pressed="true"]:not([data-primary="true"]) {
  border-color: var(--cw-accent);
  color: var(--cw-accent);
}

/* ---------------- chat ---------------- */

.cw-chat { border-top: 1px solid var(--cw-border); background: var(--cw-bg-sunken); }
.cw-chat-log {
  max-height: 220px;
  overflow-y: auto;
  padding: 11px 15px 0;
  display: grid;
  gap: 9px;
}
.cw-msg { font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
.cw-msg[data-role="user"] {
  justify-self: end;
  max-width: 88%;
  background: var(--cw-accent);
  color: #fff;
  padding: 7px 11px;
  border-radius: 12px 12px 3px 12px;
}
.cw-msg[data-role="assistant"] {
  color: var(--cw-text);
  max-width: 95%;
}
.cw-chat-form { display: flex; gap: 6px; align-items: flex-end; padding: 10px 12px 11px 15px; }
.cw-chat-input {
  flex: 1;
  min-height: 34px;
  max-height: 96px;
  padding: 7px 10px;
  font: inherit;
  font-size: 13.5px;
  color: var(--cw-text);
  background: var(--cw-bg);
  border: 1px solid var(--cw-border);
  border-radius: 10px;
  resize: none;
  outline: none;
}
.cw-chat-input::placeholder { color: var(--cw-text-faint); }
.cw-chat-input:focus { border-color: var(--cw-accent); }
.cw-chat-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px; height: 34px;
  flex: none;
  border-radius: 10px;
  background: var(--cw-accent);
  color: #fff;
}
.cw-chat-send:disabled { opacity: .4; cursor: default; }
.cw-chat-send svg { width: 15px; height: 15px; fill: currentColor; }

/* ---------------- states ---------------- */

.cw-loading { display: flex; align-items: center; gap: 9px; padding: 6px 0 14px; color: var(--cw-text-soft); font-size: 13.5px; }
.cw-dots { display: inline-flex; gap: 3px; }
.cw-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--cw-accent); animation: cw-blink 1.05s infinite ease-in-out; }
.cw-dots i:nth-child(2) { animation-delay: .16s; }
.cw-dots i:nth-child(3) { animation-delay: .32s; }
@keyframes cw-blink { 0%, 70%, 100% { opacity: .25; } 35% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cw-dots i { animation: none; opacity: .6; } }

.cw-skeleton { display: grid; gap: 8px; padding-bottom: 10px; }
.cw-skeleton span { height: 11px; border-radius: 5px; background: var(--cw-bg-sunken); border: 1px solid var(--cw-border); }
.cw-skeleton span:nth-child(2) { width: 88%; }
.cw-skeleton span:nth-child(3) { width: 62%; }

.cw-error { display: grid; gap: 7px; padding-bottom: 12px; }
.cw-error-title { font-weight: 600; font-size: 14px; }
.cw-error-hint { font-size: 13px; color: var(--cw-text-soft); }

.cw-sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
`;
