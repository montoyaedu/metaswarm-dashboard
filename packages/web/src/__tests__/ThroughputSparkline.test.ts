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

  it('renders "no data" with peak 0 and 0 days when given an empty points array', () => {
    // Empty array: `max` returns 0 early; polyline is '' → "no data" text.
    const w = mount(ThroughputSparkline, { props: { points: [] } });
    expect(w.find('polyline').exists()).toBe(false);
    expect(w.text()).toContain('no data');
    expect(w.find('[data-testid="sparkline-points-count"]').text()).toContain('0 days');
    expect(w.find('[data-testid="sparkline-peak"]').text()).toContain('peak: 0');
  });

  it('renders a single-point polyline (stepX falls back to 0 when n === 1)', () => {
    // One non-zero point: n === 1 so stepX is 0; the single coordinate sits
    // at the left padding (x = PAD = 4) and the polyline has exactly 1 point.
    const w = mount(ThroughputSparkline, {
      props: { points: [{ date: '2026-05-06', closed: 7 }] },
    });
    const poly = w.find('polyline');
    expect(poly.exists()).toBe(true);
    const coords = poly.attributes('points')?.split(' ') ?? [];
    expect(coords).toHaveLength(1);
    expect(coords[0]?.startsWith('4.00,')).toBe(true);
    expect(w.find('[data-testid="sparkline-peak"]').text()).toContain('peak: 7');
  });
});
