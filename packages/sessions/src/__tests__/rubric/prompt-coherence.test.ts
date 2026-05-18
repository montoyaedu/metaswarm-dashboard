// Unit tests for the prompt-coherence scorer (sessions-spike WU-4, §7).
// Covers Appendix A's pass / watch / na cells. No `fail` branch.

import { describe, expect, it } from 'vitest';

import { scorePromptCoherence } from '../../rubric/prompt-coherence.js';

import { ev, timeline, tool } from './helpers.js';

describe('scorePromptCoherence', () => {
  it('label and key are stable', () => {
    const item = scorePromptCoherence(timeline([tool('Bash', 'npm test')]));
    expect(item.key).toBe('prompt-coherence');
    expect(item.label).toBe('Coherence with prompt');
  });

  it('returns na when no bd create titles exist', () => {
    const item = scorePromptCoherence(
      timeline([ev('user-prompt', { summary: 'Implement the parser' })]),
    );
    expect(item.verdict).toBe('na');
    expect(item.pointer).toBeNull();
  });

  it('returns na when there is no user prompt', () => {
    const item = scorePromptCoherence(
      timeline([tool('Bash', "bd create 'WU-3 parser'")]),
    );
    expect(item.verdict).toBe('na');
  });

  it('passes when >=50% of bd titles share a token with the first prompt', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the WU-3 parser module' }),
        tool('Bash', "bd create --title 'WU-3 parser implementation'"),
        tool('Bash', "bd create --title 'parser test suite'"),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('extracts the title from --title= form', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Build the rubric scorers' }),
        tool('Bash', "bd create --title='rubric scorer composer'"),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('extracts the title from the first quoted positional when no --title flag', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the JSONL reader' }),
        tool('Bash', 'bd create "JSONL reader work" --type task'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('extracts a double-quoted --title= value', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Build the rubric scorers' }),
        tool('Bash', 'bd create --title="rubric composer module"'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('extracts a bare unquoted --title token', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Build the rubric scorers' }),
        tool('Bash', 'bd create --title rubric --type task'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('extracts a single-quoted positional title when no --title flag', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the parser' }),
        tool('Bash', "bd create 'parser core work' --type task"),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('skips a bd create with no extractable title', () => {
    // Only the titled bead counts; the title-less one contributes nothing.
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the parser' }),
        tool('Bash', 'bd create --type task'),
        tool('Bash', "bd create --title 'parser core'"),
      ]),
    );
    expect(item.verdict).toBe('pass');
    expect(item.evidence).toContain('1/1');
  });

  it('watches when fewer than 50% of bd titles share a token with the prompt', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the parser' }),
        tool('Bash', "bd create --title 'parser core'"),
        tool('Bash', "bd create --title 'unrelated billing widget'"),
        tool('Bash', "bd create --title 'another stray dashboard task'"),
        tool('Bash', "bd create --title 'yet more random scope'"),
      ]),
    );
    expect(item.verdict).toBe('watch');
    expect(item.pointer).toBeNull();
  });

  it('handles a title with no alphanumeric tokens (no shared token)', () => {
    // The `'---'` title tokenizes to an empty set -> shares nothing -> watch.
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'Implement the parser' }),
        tool('Bash', "bd create --title '---'"),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('handles a prompt with no alphanumeric tokens', () => {
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: '...' }),
        tool('Bash', "bd create --title 'parser core'"),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('handles a single-character bare --title token', () => {
    // `--title=x` exercises stripQuotes on a length-1 (unquoted) value. The
    // 1-char token is below the >=3 tokenization floor, so it shares no
    // token with the prompt -> watch.
    const item = scorePromptCoherence(
      timeline([
        ev('user-prompt', { summary: 'token matters here' }),
        tool('Bash', 'bd create --title=x --type task'),
      ]),
    );
    expect(item.verdict).toBe('watch');
  });
});
