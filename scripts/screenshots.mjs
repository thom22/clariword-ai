/**
 * Reference screenshots → docs/screens/
 *
 * Two quirks of this headless Chromium shaped the implementation:
 *  - Playwright's screenshot helper never returns once the extension overlay
 *    exists, so captures go through CDP with an explicit clip;
 *  - a second capture in the same renderer after the card is open crashes it,
 *    so each scenario gets a fresh browser over a shared, persistent profile
 *    (which also lets saved vocabulary carry from one scenario to the next).
 */
import { chromium } from 'playwright';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../dist');
const out = path.resolve(root, '../docs/screens');
const fixtureFile = path.resolve(root, '../tests/fixtures/article.html');

let profile = process.env.CLARIWORD_PROFILE;
let server;
let fixtureUrl;
let extensionId = process.env.CLARIWORD_EXT_ID || null;

async function shoot(page, file, clip) {
  const cdp = await page.context().newCDPSession(page);
  const region =
    clip ??
    (await page.evaluate(() => ({
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth,
      height: Math.min(2200, Math.max(document.documentElement.clientHeight, document.documentElement.scrollHeight)),
    })));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...region, scale: 1 } });
  await writeFile(path.join(out, file), Buffer.from(data, 'base64'));
  console.log('  saved', file);
}

const select = (page, selector, needle) =>
  page.evaluate(
    ([sel, text]) => {
      const node = document.querySelector(sel).firstChild;
      const start = node.textContent.indexOf(text);
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

async function withBrowser(size, run) {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    viewport: size,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
  });
  context.on('serviceworker', (worker) => {
    extensionId ??= new URL(worker.url()).host;
  });
  try {
    return await run(context);
  } finally {
    await context.close();
  }
}

/** Open the card for a selection and capture it. */
async function cardShot(file, paragraph, needle, after) {
  await guard(file, () => withBrowser({ width: 1180, height: 820 }, async (context) => {
    const page = await context.newPage();
    await page.goto(fixtureUrl);
    await page.waitForTimeout(1100);
    await select(page, paragraph, needle);
    await page.locator('.cw-trigger').waitFor();
    await page.waitForTimeout(200);
    await page.locator('.cw-trigger').click();
    await page.locator('.cw-card-body').waitFor();
    await page.waitForTimeout(1400);
    if (after) await after(page);
    await shoot(page, file);
    for (let i = 0; i < 30 && !extensionId; i += 1) await page.waitForTimeout(200);
  }));
}

/**
 * Save a few words so the dashboard, popup and review pages have data.
 * Each scenario runs in a fresh profile, so seeding happens per scenario.
 */
async function seed(context) {
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  await page.waitForTimeout(1000);
  const picks = [
    ['#p2', 'ostensibly'],
    ['#p4', 'ubiquitous'],
    ['#p3', 'moved the goalposts'],
  ];
  for (const [paragraph, needle] of picks) {
    await select(page, paragraph, needle);
    await page.locator('.cw-trigger').waitFor();
    await page.waitForTimeout(150);
    await page.locator('.cw-trigger').click();
    await page.locator('.cw-card-body').waitFor();
    await page.waitForTimeout(900);
    await page.locator('.cw-action[data-action="save"]').click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 40 && !extensionId; i += 1) await page.waitForTimeout(250);
  await page.close();
}

async function pageShot(file, pagePath, size = { width: 1180, height: 820 }, after) {
  await guard(file, () => withBrowser(size, async (context) => {
    await seed(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${pagePath}`);
    await page.waitForTimeout(1300);
    if (after) await after(page);
    await shoot(page, file);
  }));
}

/** One flaky renderer must not abort — or stall — the whole run. */
async function guard(file, run) {
  if (!wanted(file)) return;
  let timer;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('scenario timed out')), 75_000);
      }),
    ]);
  } catch (error) {
    console.log('  skipped', file, '-', String(error).split('\n')[0]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scenario filter: `node scripts/screenshots.mjs 02` runs one scenario.
 * scripts/capture.sh drives them one process at a time, because a stalled
 * renderer would otherwise keep the profile locked for every later scenario.
 */
const only = (process.argv[2] ?? '').split(',').filter(Boolean);
const wanted = (name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix));

async function main() {
  await mkdir(out, { recursive: true });
  profile ??= await mkdtemp(path.join(os.tmpdir(), 'clariword-shots-'));
  server = http.createServer(async (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(await readFile(fixtureFile));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fixtureUrl = `http://127.0.0.1:${server.address().port}/article.html`;

  /* the trigger, before the card opens */
  await guard('01-trigger.png', () => withBrowser({ width: 1180, height: 820 }, async (context) => {
    const page = await context.newPage();
    await page.goto(fixtureUrl);
    await page.waitForTimeout(1100);
    await select(page, '#p2', 'ostensibly');
    await page.locator('.cw-trigger').waitFor();
    await page.waitForTimeout(300);
    await shoot(page, '01-trigger.png', { x: 0, y: 40, width: 1180, height: 380 });
    for (let i = 0; i < 30 && !extensionId; i += 1) await page.waitForTimeout(200);
  }));

  await cardShot('02-word-card.png', '#p2', 'ostensibly', async (page) => {
    await page.locator('.cw-action[data-action="save"]').click();
    await page.waitForTimeout(600);
  });

  await cardShot('03-word-card-chat.png', '#p2', 'ostensibly', async (page) => {
    await page.locator('.cw-chat-input').fill('Is this formal English?');
    await page.locator('.cw-chat-send').click();
    await page.locator('.cw-msg[data-role="assistant"]').waitFor();
    await page.waitForTimeout(500);
  });

  await cardShot(
    '04-sentence-card.png',
    '#p2',
    "The policy's ostensibly pragmatic approach belies a deeper ideological shift.",
    async (page) => {
      await page.locator('.cw-action[data-action="save"]').click();
      await page.waitForTimeout(600);
    },
  );

  await cardShot('05-phrase-card.png', '#p3', 'moved the goalposts', async (page) => {
    await page.locator('.cw-action[data-action="save"]').click();
    await page.waitForTimeout(600);
  });

  await cardShot('06-word-card-2.png', '#p4', 'ubiquitous', async (page) => {
    await page.locator('.cw-action[data-action="save"]').click();
    await page.waitForTimeout(600);
  });

  if (extensionId) console.log('extension id', extensionId);

  await pageShot('10-popup.png', 'popup/popup.html', { width: 340, height: 600 });
  await pageShot('11-vocabulary.png', 'vocabulary/vocabulary.html');
  await pageShot('12-vocabulary-detail.png', 'vocabulary/vocabulary.html', { width: 1180, height: 820 }, async (page) => {
    if (await page.locator('.word-card').count()) {
      await page.locator('.word-card').first().click();
      await page.waitForTimeout(600);
    }
  });
  await pageShot('13-review.png', 'review/review.html');
  await pageShot('14-practice.png', 'practice/practice.html?word=ostensibly');
  await pageShot('15-settings.png', 'options/options.html');

  /* dark mode */
  await pageShot('16-settings-dark.png', 'options/options.html', { width: 1180, height: 820 }, async (page) => {
    await page.locator('#theme button[data-value="dark"]').click();
    await page.waitForTimeout(700);
  });
  await cardShot('17-word-card-dark.png', '#p4', 'meticulous');
  await pageShot('18-vocabulary-dark.png', 'vocabulary/vocabulary.html');

  server.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  server?.close();
  process.exit(1);
});
