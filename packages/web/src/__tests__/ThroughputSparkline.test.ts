import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ThroughputSparkline from '../components/ThroughputSparkline.vue';

const NORMAL = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
  closed: i + 1,
}));

describe('ThroughputSparkline', () => {
  it('renders a polyline when there are non-zero points', () => {
    const w = mount(ThroughputSparkline, { props: { points: NORMAL } });
    const poly = w.find('polyline');
    expect(poly.exists()).toBe(true);
    expect(poly.attributes('points')?.split(' ').length).toBe(14);
  });

  it('renders "no data" text when all points are zero', () => {
    const flat = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
      closed: 0,
    }));
    const w = mount(ThroughputSparkline, { props: { points: flat } });
    expect(w.find('polyline').exists()).toBe(false);
    expect(w.text()).toContain('no data');
  });

  it('shows the days count and peak value in the legend', () => {
    const w = mount(ThroughputSparkline, { props: { points: NORMAL } });
    expect(w.find('[data-testid="sparkline-points-count"]').text()).toContain('14 days');
    expect(w.find('[data-testid="sparkline-peak"]').text()).toContain('peak: 14');
  });
});
