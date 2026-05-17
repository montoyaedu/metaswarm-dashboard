// Unit tests for the workflow-touchpoints scorer (sessions-spike WU-4, §7).
// Covers Appendix A's pass / watch / fail cells. No `na` branch.

import { describe, expect, it } from 'vitest';

import { scoreWorkflowTouchpoints } from '../../rubric/workflow-touchpoints.js';

import { timeline, tool } from './helpers.js';

describe('scoreWorkflowTouchpoints', () => {
  it('label and key are stable', () => {
    const item = scoreWorkflowTouchpoints(timeline([tool('Bash', 'npm test')]));
    expect(item.key).toBe('workflow-touchpoints');
    expect(item.label).toBe('Workflow touchpoints');
  });

  it('passes when >=3 distinct workflow touchpoints are present', () => {
    const item = scoreWorkflowTouchpoints(
      timeline([
        tool('Bash', "bd create 'WU-4'"),
        tool('Write', '.agents/notes.md'),
        tool('Read', '.coverage-thresholds.json'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('passes when all four categories are present', () => {
    const item = scoreWorkflowTouchpoints(
      timeline([
        tool('Bash', 'bd ready'),
        tool('Bash', 'mini yt list'),
        tool('Edit', '.agents/notes.md'),
        tool('Read', '.coverage-thresholds.json'),
      ]),
    );
    expect(item.verdict).toBe('pass');
  });

  it('watches when 1-2 distinct workflow touchpoints are present', () => {
    const item = scoreWorkflowTouchpoints(
      timeline([tool('Bash', 'bd ready'), tool('Write', '.agents/notes.md')]),
    );
    expect(item.verdict).toBe('watch');
  });

  it('watches when exactly one workflow touchpoint is present', () => {
    const item = scoreWorkflowTouchpoints(timeline([tool('Bash', 'bd ready')]));
    expect(item.verdict).toBe('watch');
  });

  it('fails when no workflow touchpoints are present', () => {
    const item = scoreWorkflowTouchpoints(
      timeline([tool('Bash', 'npm test'), tool('Write', 'src/foo.ts')]),
    );
    expect(item.verdict).toBe('fail');
    expect(item.pointer).toBeNull();
  });
});
