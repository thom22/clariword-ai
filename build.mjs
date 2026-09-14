/**
 * ClariWord AI build script.
 *
 * Bundles every extension entry point with esbuild and copies static assets
 * into `dist/`, which is the folder you load with chrome://extensions →
 * "Load unpacked".
 *
 *   node build.mjs            production build
 *   node build.mjs --dev      unminified + sourcemaps
 *   node build.mjs --watch    rebuild on change (implies --dev)
 *   node build.mjs --tests    bundle tests/ into dist-tests/
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const dev = watch || args.has('--dev');
const testsOnly = args.has('--tests');

/** Entry points: [source, output] relative to src/ and dist/. */
const ENTRIES = [
  ['background/service-worker.ts', 'background/service-worker.js', 'esm'],
  ['content/index.ts', 'content/content-script.js', 'iife'],
  ['popup/popup.ts', 'popup/popup.js', 'esm'],
  ['options/options.ts', 'options/options.js', 'esm'],
  ['vocabulary/vocabulary.ts', 'vocabulary/vocabulary.js', 'esm'],
  ['review/review.ts', 'review/review.js', 'esm'],
  ['practice/practice.ts', 'practice/practice.js', 'esm'],
];

const banner = {
  js: `/* ClariWord AI — built ${new Date().toISOString()} */`,
};

/** @returns {Promise<import('esbuild').BuildOptions>} */
async function optionsFor([entry, out, format]) {
  return {
    entryPoints: [path.join(src, entry)],
    outfile: path.join(dist, out),
    bundle: true,
    format,
    target: ['chrome116'],
    platform: 'browser',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'info',
    banner,
    define: {
      __DEV__: JSON.stringify(dev),
      __VERSION__: JSON.stringify(await readVersion()),
    },
    loader: { '.png': 'dataurl', '.svg': 'text' },
  };
}

let cachedVersion;
async function readVersion() {
  if (!cachedVersion) {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    cachedVersion = pkg.version;
  }
  return cachedVersion;
}

/** Recursively copy every file with one of `exts` from src/ to dist/. */
async function copyStatic() {
  const exts = new Set(['.html', '.css', '.png', '.svg', '.json', '.woff2']);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!exts.has(path.extname(entry.name))) continue;
      const rel = path.relative(src, full);
      const target = path.join(dist, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(full, target);
    }
  }
  await walk(src);
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
  const version = await readVersion();
  if (manifest.version !== version) {
    manifest.version = version;
    await writeFile(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  const referenced = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
  ];
  const missing = referenced.filter((rel) => !existsSync(path.join(dist, rel)));
  if (missing.length) {
    throw new Error(`manifest.json references files that were not built: ${missing.join(', ')}`);
  }
}

async function buildTests() {
  const testDir = path.join(root, 'tests');
  const outDir = path.join(root, 'dist-tests');
  await rm(outDir, { recursive: true, force: true });
  const files = (await readdir(testDir)).filter((f) => f.endsWith('.test.ts'));
  await esbuild.build({
    entryPoints: files.map((f) => path.join(testDir, f)),
    outdir: outDir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    outExtension: { '.js': '.mjs' },
    external: ['node:*'],
    define: { __DEV__: 'true', __VERSION__: JSON.stringify(await readVersion()) },
    logLevel: 'info',
  });
  console.log(`✔ bundled ${files.length} test file(s) → dist-tests/`);
}

async function main() {
  if (testsOnly) {
    await buildTests();
    return;
  }

  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const configs = [];
  for (const entry of ENTRIES) configs.push(await optionsFor(entry));

  if (watch) {
    await copyStatic();
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('👀 watching for changes — reload the extension in chrome://extensions after each rebuild');
    return;
  }

  await Promise.all(configs.map((c) => esbuild.build(c)));
  await copyStatic();
  await validateManifest();
  console.log(`✔ ClariWord AI ${await readVersion()} built → dist/ (${dev ? 'development' : 'production'})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
