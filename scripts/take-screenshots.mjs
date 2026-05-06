#!/usr/bin/env node
// Reproducible screenshot capture for the dashboard MVP. WU-5.6 deliverable
// (`docs/screenshots/projects-index.png`) and WU-6/7 follow-ups will reuse
// this same harness.
//
// What it does:
//   1. Builds packages/web/ (real Vite output).
//   2. Starts the WU-4 Fastify server in-process, pointing at a committed
//      fixture data dir under packages/web/src/__tests__/fixtures/server-data-dir/.
//   3. Launches a headless Chromium via Playwright with a fixed viewport.
//   4. Navigates to each named view, takes a screenshot, writes it under
//      docs/screenshots/.
//   5. Tears the server down.
//
// CI does NOT auto-regenerate (per plan §WU-5.6 / §WU-7.4). Run it locally:
//   npm run screenshots:projects-index    # only the projects index
//   npm run screenshots                   # all of them

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { buildServer } from '../packages/server/dist/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const STATIC_ROOT = resolve(REPO_ROOT, 'packages/web/dist');
const DATA_DIR = resolve(REPO_ROOT, 'packages/web/src/__tests__/fixtures/server-data-dir');
const SCREENSHOTS_DIR = resolve(REPO_ROOT, 'docs/screenshots');
const PORT = 5174;

const TARGETS = {
  'projects-index': { path: '/', file: 'projects-index.png' },
  'project-detail': { path: '/projects/alpha', file: 'project-detail.png' },
  'agents-view': { path: '/agents', file: 'agents-view.png' },
};

async function main() {
  const requested = process.argv.slice(2);
  const targets =
    requested.length === 0
      ? Object.keys(TARGETS)
      : requested.filter((r) => Object.hasOwn(TARGETS, r));

  if (targets.length === 0) {
    console.error(`Unknown screenshot target. Known: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  if (!existsSync(STATIC_ROOT)) {
    console.error(`SPA build output not found at ${STATIC_ROOT}.\n  Run \`npm run build\` first.`);
    process.exit(1);
  }
  if (!existsSync(DATA_DIR)) {
    console.error(`Fixture data dir not found at ${DATA_DIR}.`);
    process.exit(1);
  }
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`Server listening on http://127.0.0.1:${PORT}`);

  const browser = await chromium.launch();
  try {
    for (const name of targets) {
      const t = TARGETS[name];
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const url = `http://127.0.0.1:${PORT}${t.path}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      // small settle delay for any async data fetches
      await page.waitForTimeout(300);
      const out = resolve(SCREENSHOTS_DIR, t.file);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`✓ ${name} → ${out}`);
      await context.close();
    }
  } finally {
    await browser.close();
    await app.close();
  }
}

await main();
