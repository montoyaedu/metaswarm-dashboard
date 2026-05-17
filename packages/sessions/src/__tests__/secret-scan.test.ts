// Secret-pattern scanner tests (sessions-spike design §9.2 #4).
//
// Part 1 — unit tests for `scanForSecrets`. Every test secret is constructed
// at RUNTIME by string concatenation so this very file does NOT trip the
// repo-wide scan in Part 2. Never write a secret as a literal here.
//
// Part 2 — repo-wide scan. Walks the repository filesystem (no `git` spawn —
// anti-goal §12.12) and asserts no committed text file matches a
// high-confidence secret pattern.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SECRET_PATTERNS, scanForSecrets } from './secret-scan.js';
import type { SecretMatch } from './secret-scan.js';

describe('SECRET_PATTERNS', () => {
  it('covers the five high-confidence pattern names from design §9.2', () => {
    const names = SECRET_PATTERNS.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        'aws-access-key-id',
        'github-pat',
        'jwt',
        'openai-anthropic-key',
        'slack-bot-token',
      ].sort(),
    );
  });
});

describe('scanForSecrets — detection (secrets built at runtime)', () => {
  it('detects an OpenAI/Anthropic-style key', () => {
    const secret = 'sk-' + 'A'.repeat(28);
    const matches = scanForSecrets(`token=${secret}`);
    expect(matches).toContainEqual({
      pattern: 'openai-anthropic-key',
      match: secret,
    });
  });

  it('detects a GitHub PAT', () => {
    const secret = 'ghp_' + 'b'.repeat(30);
    const matches = scanForSecrets(`export GH=${secret}`);
    expect(matches).toContainEqual({ pattern: 'github-pat', match: secret });
  });

  it('detects an AWS access key id', () => {
    const secret = 'AKIA' + 'ABCDEFGH12345678';
    const matches = scanForSecrets(`AWS_KEY ${secret}`);
    expect(matches).toContainEqual({
      pattern: 'aws-access-key-id',
      match: secret,
    });
  });

  it('detects a Slack bot token', () => {
    const secret = 'xoxb-' + '1234567890-ABCdef';
    const matches = scanForSecrets(`slack=${secret}`);
    expect(matches).toContainEqual({
      pattern: 'slack-bot-token',
      match: secret,
    });
  });

  it('detects a JWT', () => {
    const secret =
      'eyJ' + 'a'.repeat(24) + '.' + 'eyJ' + 'b'.repeat(24) + '.' + 'sig';
    const matches = scanForSecrets(`auth: ${secret}`);
    expect(matches.some((m) => m.pattern === 'jwt')).toBe(true);
  });

  it('detects multiple occurrences of the same pattern', () => {
    const a = 'sk-' + 'A'.repeat(28);
    const b = 'sk-' + 'B'.repeat(28);
    const matches = scanForSecrets(`${a} and ${b}`);
    const skMatches = matches.filter(
      (m) => m.pattern === 'openai-anthropic-key',
    );
    expect(skMatches).toHaveLength(2);
  });

  it('returns an empty array for clean text', () => {
    expect(scanForSecrets('the quick brown fox jumps over the lazy dog')).toEqual(
      [],
    );
  });

  it('returns an empty array for empty input', () => {
    expect(scanForSecrets('')).toEqual([]);
  });
});

describe('repo-wide secret scan', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

  const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'coverage',
    '.dolt',
  ]);
  const BINARY_EXT = new Set([
    '.db',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.pdf',
    '.zip',
    '.gz',
    '.lock',
  ]);
  const MAX_FILE_BYTES = 512 * 1024;

  function isSkippedDir(name: string): boolean {
    return SKIP_DIRS.has(name) || name.startsWith('.beads.bak');
  }

  function extOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
  }

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) {
          yield* walk(full);
        }
      } else if (entry.isFile()) {
        yield full;
      }
    }
  }

  it('resolves a repo root containing the expected sentinel files', () => {
    expect(statSync(join(repoRoot, 'package.json')).isFile()).toBe(true);
    expect(
      statSync(join(repoRoot, '.coverage-thresholds.json')).isFile(),
    ).toBe(true);
  });

  it('finds no high-confidence secret patterns in any committed text file', () => {
    const offenders: { file: string; matches: SecretMatch[] }[] = [];
    for (const file of walk(repoRoot)) {
      if (BINARY_EXT.has(extOf(file))) continue;
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      const text = readFileSync(file, 'utf8');
      if (text.includes(String.fromCharCode(0))) continue;
      const matches = scanForSecrets(text);
      if (matches.length > 0) {
        offenders.push({ file, matches });
      }
    }
    expect(offenders).toEqual([]);
  });
});
