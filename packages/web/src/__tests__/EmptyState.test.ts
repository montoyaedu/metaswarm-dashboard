import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import EmptyState from '../components/EmptyState.vue';

describe('EmptyState', () => {
  it('renders the message prop', () => {
    const w = mount(EmptyState, { props: { message: 'No metrics yet' } });
    expect(w.text()).toContain('No metrics yet');
    expect(w.find('[data-testid="empty-state"]').exists()).toBe(true);
  });
});
