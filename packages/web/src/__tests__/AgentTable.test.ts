import type { AgentBreakdown } from '@metaswarm-dashboard/types/api';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AgentTable from '../components/AgentTable.vue';

const AGENTS: AgentBreakdown[] = [
  { agent: 'coder', tasksCompleted: 5, successRate: 1.0, avgDurationSeconds: 600 },
  { agent: 'reviewer-cto', tasksCompleted: 2, successRate: 0.5, avgDurationSeconds: 200 },
];

describe('AgentTable', () => {
  it('renders one row per agent with formatted cells', () => {
    const w = mount(AgentTable, { props: { agents: AGENTS } });
    expect(w.find('[data-testid="agent-table"]').exists()).toBe(true);
    expect(w.find('[data-testid="cell-agent-coder"]').text()).toBe('coder');
    expect(w.find('[data-testid="cell-tasks-coder"]').text()).toBe('5');
    expect(w.find('[data-testid="cell-rate-coder"]').text()).toBe('100%');
    expect(w.find('[data-testid="cell-rate-reviewer-cto"]').text()).toBe('50%');
  });

  it('formats avg duration in seconds / minutes / hours appropriately', () => {
    const w = mount(AgentTable, {
      props: {
        agents: [
          { agent: 'a', tasksCompleted: 1, successRate: 1, avgDurationSeconds: 30 },
          { agent: 'b', tasksCompleted: 1, successRate: 1, avgDurationSeconds: 600 },
          { agent: 'c', tasksCompleted: 1, successRate: 1, avgDurationSeconds: 7200 },
        ],
      },
    });
    expect(w.find('[data-testid="cell-duration-a"]').text()).toBe('30s');
    expect(w.find('[data-testid="cell-duration-b"]').text()).toBe('10.0m');
    expect(w.find('[data-testid="cell-duration-c"]').text()).toBe('2.0h');
  });

  it('renders empty table when agents is empty array', () => {
    const w = mount(AgentTable, { props: { agents: [] } });
    expect(w.find('[data-testid="agent-table"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="cell-agent-"]')).toHaveLength(0);
  });
});
