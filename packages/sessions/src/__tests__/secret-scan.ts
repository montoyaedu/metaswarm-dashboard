// Secret-pattern scanner (sessions-spike design §9.2 #4).
//
// Belt-and-braces against the calibration-doc leakage vector: a CI-grep test
// fails the suite if any committed text file matches a high-confidence secret
// pattern. This module is the pure detection core; the test file drives the
// repo-wide filesystem walk.

/** A single secret detection: which pattern fired and the matched substring. */
export interface SecretMatch {
  pattern: string;
  match: string;
}

/**
 * High-confidence secret patterns. Each `re` is a global regex so a single
 * `String.prototype.match` call returns every occurrence in the input.
 */
export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'openai-anthropic-key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'github-pat', re: /ghp_[A-Za-z0-9]{20,}/g },
  { name: 'aws-access-key-id', re: /AKIA[A-Z0-9]{16}/g },
  { name: 'slack-bot-token', re: /xoxb-[A-Za-z0-9-]+/g },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\./g },
];

/**
 * Scan `text` for every high-confidence secret pattern. Returns one
 * `SecretMatch` per occurrence; an empty array means the text is clean.
 */
export function scanForSecrets(text: string): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const matches = text.match(re);
    if (matches !== null) {
      for (const match of matches) {
        found.push({ pattern: name, match });
      }
    }
  }
  return found;
}
