// WU-3.18 — `collect --help` text contains description, flags, examples.

import { describe, expect, it } from 'vitest';

import { HELP_DESCRIPTION, HELP_EXAMPLES, buildCollectHelpText } from '../cli/collect.js';

describe('collect --help text', () => {
  it('description mentions reading .beads/ from configured projects', () => {
    expect(HELP_DESCRIPTION).toMatch(/\.beads\//);
  });

  it('examples include both --all and --project forms', () => {
    expect(HELP_EXAMPLES.some((e) => e.includes('--all'))).toBe(true);
    expect(HELP_EXAMPLES.some((e) => e.includes('--project'))).toBe(true);
  });

  it('rendered help contains description, both flags, and examples', () => {
    const text = buildCollectHelpText();
    expect(text).toContain('Description:');
    expect(text).toContain('--project <name>');
    expect(text).toContain('--all');
    expect(text).toContain('Examples:');
    expect(text).toContain('metaswarm-dashboard collect');
  });
});
