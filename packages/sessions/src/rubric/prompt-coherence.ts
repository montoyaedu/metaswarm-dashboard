// prompt-coherence scorer (sessions-spike WU-4, design §7).
//
// Signal: do the titles the agent gave to created beads share vocabulary
// with the operator's first prompt?
// Verdict: no bd titles -> na; no first user prompt -> na; matchRatio
// (titles sharing >=1 token with the prompt) >= 0.5 -> pass; < 0.5 -> watch.
// No `fail` branch (design §7 — prompt drift is "covered by planning").

import type { RubricItem, SessionTimeline } from '@metaswarm-dashboard/types/sessions';

import { bashMatches } from './util.js';

const BD_CREATE = /\bbd\s+create\b/;

/** Lowercase alphanumeric tokens of length >=3. */
function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(tokens.filter((t) => t.length >= 3));
}

/** Strip one pair of matching surrounding quotes from `v` (no-op when `v`
 *  is not wholly quoted). */
function stripQuotes(v: string): string {
  if (v.length >= 2) {
    const first = v[0];
    if ((first === '"' || first === "'") && v[v.length - 1] === first) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Extract a bead title from a `bd create` shell command:
 *  1. the value of `--title=<v>` / `--title <v>` (quotes stripped), else
 *  2. the first single- or double-quoted positional argument.
 *  Returns null when no title can be found. */
function extractTitle(command: string): string | null {
  // `--title=<v>` or `--title <v>`: a quoted run or a bare token. The whole
  // match includes the `--title[=\s]` prefix, which is sliced off so no
  // optional capture group is needed.
  const flag = /--title[=\s]+(?:"[^"]*"|'[^']*'|\S+)/.exec(command);
  if (flag !== null) {
    return stripQuotes(flag[0].replace(/^--title[=\s]+/, ''));
  }
  // First quoted positional argument (single- or double-quoted run).
  const quoted = /"[^"]*"|'[^']*'/.exec(command);
  if (quoted !== null) return stripQuotes(quoted[0]);
  return null;
}

export function scorePromptCoherence(timeline: SessionTimeline): RubricItem {
  const firstPrompt = timeline.events.find((e) => e.kind === 'user-prompt');

  const titles: string[] = [];
  for (const e of timeline.events) {
    if (!bashMatches(e, BD_CREATE)) continue;
    const title = extractTitle(e.summary);
    if (title !== null) titles.push(title);
  }

  if (titles.length === 0) {
    return {
      key: 'prompt-coherence',
      label: 'Coherence with prompt',
      verdict: 'na',
      evidence: 'no bd create titles to compare',
      pointer: null,
    };
  }
  if (firstPrompt === undefined) {
    return {
      key: 'prompt-coherence',
      label: 'Coherence with prompt',
      verdict: 'na',
      evidence: 'no user prompt to compare bd titles against',
      pointer: null,
    };
  }

  const promptTokens = tokenize(firstPrompt.summary);
  let matching = 0;
  for (const title of titles) {
    const shares = [...tokenize(title)].some((t) => promptTokens.has(t));
    if (shares) matching += 1;
  }
  const ratio = matching / titles.length;
  const verdict = ratio >= 0.5 ? 'pass' : 'watch';

  return {
    key: 'prompt-coherence',
    label: 'Coherence with prompt',
    verdict,
    evidence: `${matching}/${titles.length} bd titles share a token with the first user prompt`,
    pointer: null,
  };
}
