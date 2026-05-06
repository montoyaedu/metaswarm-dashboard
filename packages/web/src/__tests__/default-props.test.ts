// Coverage gap closure: ThroughputSparkline default width/height computeds.

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ThroughputSparkline from '../components/ThroughputSparkline.vue';

const POINTS = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-04-${(23 + i).toString().padStart(2, '0')}`,
  closed: i + 1,
}));

describe('ThroughputSparkline default props', () => {
  it('uses default width/height when props are not provided (covers ?? branches)', () => {
    const w = mount(ThroughputSparkline, { props: { points: POINTS } });
    const svg = w.find('svg');
    expect(svg.attributes('width')).toBe('280');
    expect(svg.attributes('height')).toBe('60');
  });

  it('honors explicit width/height when provided', () => {
    const w = mount(ThroughputSparkline, {
      props: { points: POINTS, width: 400, height: 100 },
    });
    const svg = w.find('svg');
    expect(svg.attributes('width')).toBe('400');
    expect(svg.attributes('height')).toBe('100');
  });
});
