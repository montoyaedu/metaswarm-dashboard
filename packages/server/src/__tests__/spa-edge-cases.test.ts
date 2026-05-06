// Coverage gap closure: spa.ts setNotFoundHandler branches.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';

let TMP: string;
let DATA_DIR: string;
let STATIC_ROOT: string;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'spa-edge-'));
  DATA_DIR = join(TMP, 'data');
  STATIC_ROOT = join(TMP, 'spa');
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('SPA fallback edge cases', () => {
  it('non-GET method on a non-/api path returns 404 (not 405, not index.html)', async () => {
    // Set up a usable static root.
    mkdirSync(STATIC_ROOT, { recursive: true });
    writeFileSync(join(STATIC_ROOT, 'index.html'), '<html><body>hi</body></html>', 'utf8');

    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({ method: 'OPTIONS', url: '/some/path' });
    // OPTIONS isn't /api/* so the method-guard doesn't fire; the
    // setNotFoundHandler returns 404 because the method isn't GET/HEAD.
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('not_found');
    await app.close();
  });

  it('returns 500 when index.html is missing from staticRoot', async () => {
    // STATIC_ROOT exists but contains no index.html (we never created it).
    mkdirSync(STATIC_ROOT, { recursive: true });

    const app = await buildServer({ dataDir: DATA_DIR, staticRoot: STATIC_ROOT });
    const res = await app.inject({ method: 'GET', url: '/anything' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe('spa_missing');
    await app.close();
  });
});
