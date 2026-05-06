import { describe, expect, it } from 'vitest';

import { bySortKey, formatDuration } from '../lib/table-sorters.js';

describe('formatDuration', () => {
  it('seconds under a minute → "Ns"', () => {
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('minutes under an hour → "N.Nm"', () => {
    expect(formatDuration(60)).toBe('1.0m');
    expect(formatDuration(3540)).toBe('59.0m');
  });

  it('hours and beyond → "N.Nh"', () => {
    expect(formatDuration(3600)).toBe('1.0h');
    expect(formatDuration(7200)).toBe('2.0h');
  });
});

describe('bySortKey', () => {
  interface Row {
    name: string;
    n: number;
  }

  it('numeric key: ascending', () => {
    const sorter = bySortKey<Row, 'n'>('n');
    const arr: Row[] = [
      { name: 'b', n: 5 },
      { name: 'a', n: 1 },
    ];
    arr.sort(sorter);
    expect(arr.map((r) => r.n)).toEqual([1, 5]);
  });

  it('string key: locale ascending', () => {
    const sorter = bySortKey<Row, 'name'>('name');
    const arr: Row[] = [
      { name: 'b', n: 1 },
      { name: 'a', n: 2 },
    ];
    arr.sort(sorter);
    expect(arr.map((r) => r.name)).toEqual(['a', 'b']);
  });
});
