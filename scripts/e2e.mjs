/**
 * End-to-end smoke test against a real Chromium with the extension loaded.
 *
 *   node build.mjs --dev && node scripts/e2e.mjs
 *
 * Development builds attach an OPEN shadow root so the test can drive the UI;
 * production builds are closed. Everything else is the shipped code path.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../dist');
const fixtureFile = path.resolve(root, '../tests/fixtures/article.html');

/** Content scripts only match http/https, so the fixture is served, not file://. */
function serveFixture() {
  return new Promise((resolve) => {
    const server = http.createServer(async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(await readFile(fixtureFile));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  if (!condition) failures += 1;
  console.log(`${condition ? '  ✔' : '  ✘'} ${name}${detail && !condition ? ` — ${detail}` : ''}`);
}

/** Select a substring of a paragraph and fire the events the page would. */
const selectText = async (page, selector, needle) => {
  await page.evaluate(
    ([sel, text]) => {
      const node = document.querySelector(sel)?.firstChild;
      if (!node) throw new Error(`no text node in ${sel}`);
      const start = node.textContent.indexOf(text);
      if (start === -1) throw new Error(`"${text}" not found in ${sel}`);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    [selector, needle],
  );
};

const shadow = (page) => page.locator('#clariword-ai-root-7f3a');

/**
 * MV3 workers start lazily and are torn down when idle, so subscribe to the
 * event at launch and remember the id rather than polling for a live worker.
 */
function watchExtensionId(context) {
  const seen = context.serviceWorkers()[0];
  let resolved = seen ? new URL(seen.url()).host : null;
  context.on('serviceworker', (worker) => {
    resolved ??= new URL(worker.url()).host;
  });
  return async () => {
    for (let attempt = 0; attempt < 40 && !resolved; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!resolved) throw new Error('extension service worker never started');
    return resolved;
  };
}


async function main() {
  const { server, port } = await serveFixture();
  const fixture = `http://127.0.0.1:${port}/article.html`;
  const profile = await mkdtemp(path.join(os.tmpdir(), 'clariword-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    // headless:false + --headless=new: MV3 extensions do not load in old headless.
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
  const waitForExtensionId = watchExtensionId(context);

  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(fixture);
    await page.waitForTimeout(900); // content script runs at document_idle

    const extensionId = await waitForExtensionId();
    check('service worker starts', !!extensionId, extensionId);

    // The shipped default now points at the hosted service. Pin this run to
    // demo mode so the suite stays deterministic, offline and free; the live
    // backend gets its own section further down.
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/options/options.html`);
    await setup.evaluate(async () => {
      // Settings live in chrome.storage.sync — writing to local is ignored.
      const key = 'clariword.settings';
      const current = (await chrome.storage.sync.get(key))[key] ?? {};
      await chrome.storage.sync.set({ [key]: { ...current, aiMode: 'mock' } });
    });
    await setup.close();
    await page.reload();
    await page.waitForTimeout(1200);

    check('content script injects its host element', (await shadow(page).count()) === 1);

    /* ---------- single word ---------- */
    await selectText(page, '#p2', 'ostensibly');
    const trigger = page.locator('.cw-trigger');
    await trigger.waitFor({ state: 'visible', timeout: 5000 });
    check('floating trigger appears next to the selection', await trigger.isVisible());

    const triggerBox = await trigger.boundingBox();
    const viewport = page.viewportSize();
    check(
      'trigger stays inside the viewport',
      triggerBox && triggerBox.x >= 0 && triggerBox.y >= 0 && triggerBox.x + triggerBox.width <= viewport.width,
      JSON.stringify(triggerBox),
    );

    await trigger.click();
    const card = page.locator('.cw-card');
    await card.waitFor({ state: 'visible', timeout: 5000 });
    check('card opens immediately', await card.isVisible());

    const loading = page.locator('.cw-loading');
    check('loading state is shown while the AI works', (await loading.count()) > 0);

    await page.locator('.cw-term').waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    const term = await page.locator('.cw-term').textContent();
    check('card headline is the selected word', term.trim() === 'ostensibly', term);

    const ipa = await page.locator('.cw-ipa').textContent();
    check('IPA is rendered', ipa.includes('ˈstɛnsəbli'), ipa);

    const stress = await page.locator('.cw-phonetic .cw-stress').textContent();
    check('stressed syllable is marked', stress === 'TEN', stress);

    const body = await page.locator('.cw-card-body').textContent();
    check('contextual meaning comes first', body.indexOf('Here it means') < body.indexOf('Simple meaning'));
    check('the offline-fallback notice is shown', body.includes('Offline mode'));
    check('“why this word” reasoning is present', body.includes('Why this word?'));

    /* ---------- CSS isolation ---------- */
    const isolation = await page.evaluate(() => {
      const host = document.getElementById('clariword-ai-root-7f3a');
      const cardEl = host.shadowRoot.querySelector('.cw-card');
      const button = host.shadowRoot.querySelector('.cw-action');
      const styles = getComputedStyle(cardEl);
      const buttonStyles = getComputedStyle(button);
      return {
        boxSizing: styles.boxSizing,
        fontSize: styles.fontSize,
        buttonBg: buttonStyles.backgroundColor,
        buttonBorder: buttonStyles.borderStyle,
      };
    });
    check('page CSS cannot reach the card (box-sizing)', isolation.boxSizing === 'border-box', isolation.boxSizing);
    check('page CSS cannot reach the card (font-size)', isolation.fontSize === '14px', isolation.fontSize);
    check('page CSS cannot restyle our buttons', isolation.buttonBorder !== 'dotted', isolation.buttonBorder);

    /* ---------- follow-up chat ---------- */
    await page.locator('.cw-chat-input').fill('How do I pronounce this naturally?');
    await page.locator('.cw-chat-send').click();
    await page.locator('.cw-msg[data-role="assistant"]').waitFor({ timeout: 8000 });
    const answer = await page.locator('.cw-msg[data-role="assistant"]').textContent();
    check('follow-up chat answers', answer.includes('os-TEN-suh-blee'), answer.slice(0, 80));

    /* ---------- save ---------- */
    await page.locator('.cw-action[data-action="save"]').click();
    await page.waitForTimeout(700);
    const saveLabel = await page.locator('.cw-action[data-action="save"]').textContent();
    check('save button confirms', saveLabel.includes('Saved'), saveLabel);

    /* ---------- escape closes ---------- */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Escape closes the card', (await page.locator('.cw-card').count()) === 0);

    /* ---------- sentence selection ---------- */
    await selectText(page, '#p2', "The policy's ostensibly pragmatic approach belies a deeper ideological shift.");
    await page.locator('.cw-trigger').waitFor({ timeout: 5000 });
    await page.locator('.cw-trigger').click();
    await page.locator('.cw-segments').waitFor({ timeout: 8000 });
    const sentenceBody = await page.locator('.cw-card-body').textContent();
    check('sentence view breaks the sentence down', sentenceBody.includes('Break it down'));
    check('sentence view lists key vocabulary', sentenceBody.includes('Important vocabulary'));
    check('sentence view offers a simpler rewrite', sentenceBody.includes('Simpler rewrite'));
    check(
      'sentence segments are explained, not defined word by word',
      sentenceBody.includes('hides or contradicts what is actually true'),
    );

    /* ---------- click outside closes ---------- */
    await page.mouse.click(5, 400);
    await page.waitForTimeout(300);
    check('clicking outside closes the card', (await page.locator('.cw-card').count()) === 0);

    /* ---------- phrase ---------- */
    await selectText(page, '#p3', 'moved the goalposts');
    await page.locator('.cw-trigger').waitFor({ timeout: 5000 });
    await page.locator('.cw-trigger').click();
    await page.waitForTimeout(1200);
    const phraseBody = await page.locator('.cw-card-body').textContent();
    check('phrases are treated as a unit', phraseBody.includes('Meaning'), phraseBody.slice(0, 60));

    await page.keyboard.press('Escape');

    /* ---------- extension pages ---------- */
    const vocab = await context.newPage();
    await vocab.goto(`chrome-extension://${extensionId}/vocabulary/vocabulary.html`);
    await vocab.waitForTimeout(900);
    const cards = await vocab.locator('.word-card').count();
    check('saved word appears in the dashboard', cards >= 1, `${cards} cards`);
    if (cards) {
      await vocab.locator('.word-card').first().click();
      await vocab.waitForTimeout(400);
      const drawer = await vocab.locator('#drawer-inner').textContent();
      check('detail view keeps the original sentence', drawer.includes('ostensibly pragmatic approach'));
      check('detail view names the source page', drawer.includes('Why AI Regulation'));
    }

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForTimeout(700);
    check('popup shows the saved count', (await popup.locator('#stat-saved').textContent()) !== '–');

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extensionId}/review/review.html`);
    await review.waitForTimeout(900);
    const reviewText = await review.locator('#stage').textContent();
    check('review page builds a question', reviewText.includes('ostensibly') || reviewText.includes('Nothing to review'));

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);
    await options.waitForTimeout(700);
    const privacy = await options.locator('#privacy-preview').textContent();
    check('settings explains exactly what is transmitted', privacy.includes('characters of selected text'), privacy);
    check('page URL is never listed as transmitted', !privacy.includes('example.com/article'));

    const practice = await context.newPage();
    await practice.goto(`chrome-extension://${extensionId}/practice/practice.html?word=ostensibly`);
    await practice.waitForTimeout(800);
    check('practice page loads the word', (await practice.locator('#target-word').textContent()) === 'ostensibly');
    const scoreNote = await practice.locator('#score-availability').textContent();
    check(
      'practice is honest about scoring availability',
      /not (yet )?(available|implemented)|needs a speech|scoring/i.test(scoreNote),
      scoreNote,
    );

    /* ---------- the real backend, end to end ---------- */
    const backendPort = 8791;
    const backend = spawn(process.execPath, ['smoke-server.js'], {
      cwd: path.resolve(root, '../backend'),
      env: { ...process.env, PORT: String(backendPort), PROVIDER: '' },
      stdio: 'ignore',
    });
    await new Promise((resolve) => setTimeout(resolve, 900));

    try {
      // The backend URL ships as a default and is no longer editable in the
      // UI, so point this run at the local smoke server through storage.
      await options.evaluate(async (port) => {
        const key = 'clariword.settings';
        const current = (await chrome.storage.sync.get(key))[key] ?? {};
        await chrome.storage.sync.set({
          [key]: { ...current, aiMode: 'backend', backendUrl: `http://127.0.0.1:${port}` },
        });
      }, backendPort);
      await options.waitForTimeout(700);

      const live = await context.newPage();
      await live.goto(fixture);
      await live.waitForTimeout(900);
      await selectText(live, '#p4', 'meticulous');
      await live.locator('.cw-trigger').waitFor({ timeout: 5000 });
      await live.locator('.cw-trigger').click();
      await live.locator('.cw-term').waitFor({ timeout: 10_000 });
      await live.waitForTimeout(1200);
      const liveBody = await live.locator('.cw-card-body').textContent();
      check('a real HTTP backend round-trips into the card', liveBody.includes('without an AI provider key'), liveBody.slice(0, 100));
      check('backend responses are not labelled as demo data', !liveBody.includes('Demo mode —'));
      await live.close();
    } finally {
      backend.kill();
    }

    check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  } finally {
    await context.close();
    server.close();
    await rm(profile, { recursive: true, force: true });
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
