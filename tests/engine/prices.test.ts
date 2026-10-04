import { describe, expect, it } from 'vitest';
import { priceChange } from '../../src/engine/prices.ts';
import { historyBars } from '../helpers/fixtures.ts';

describe('priceChange', () => {
  const shop = historyBars('SHOP').map(({ date, close }) => ({ date, close }));
  const splits = [{ ticker: 'SHOP', exDate: '2022-06-29', ratio: 10 }];

  it('measures across a split on the post-split basis', () => {
    const c = priceChange('SHOP', shop, splits, '2022-06-28', '2022-06-29', null, 10)!;
    // Start = close before 06-28 (06-27: 373.21), restated /10.
    expect(c.start).toBeCloseTo(37.321, 9);
    expect(c.end).toBe(33.05);
    expect(c.change).toBeCloseTo(33.05 / 37.321 - 1, 9);
    expect(c.spark.every((x) => x < 40)).toBe(true); // no 10× cliff in the sparkline
  });

  it('samples the sparkline to at most n points, keeping the last', () => {
    const c = priceChange('SHOP', shop, splits, '2024-01-01', '2024-12-31', null, 20)!;
    expect(c.spark.length).toBeLessThanOrEqual(21);
    expect(c.spark.at(-1)).toBe(c.end);
  });

  it('uses today’s quote at the end', () => {
    const c = priceChange('SHOP', shop, splits, '2026-09-01', '2026-10-02', { last: 152.25, prevClose: 149.09, asOf: '2026-10-02T12:00:00-04:00' }, 10)!;
    expect(c.end).toBe(152.25);
  });

  it('returns null with no bars', () => {
    expect(priceChange('SQ', [], [], '2024-01-01', '2024-12-31', null, 10)).toBeNull();
  });
});

describe('priceChange range endpoints', () => {
  const bars = [
    { date: '2024-01-02', close: 100 },
    { date: '2024-01-03', close: 110 },
    { date: '2024-01-04', close: 121 },
  ];
  it('measures from the close before the range', () => {
    expect(priceChange('B', bars, [], '2024-01-03', '2024-01-04', null)?.change).toBeCloseTo(0.21, 12);
    expect(priceChange('B', bars, [], '2024-01-02', '2024-01-03', null)?.change).toBeCloseTo(0.1, 12); // no earlier bar: first close
  });
  it('uses a newer quote for today', () => {
    expect(priceChange('B', bars, [], '2024-01-03', '2024-01-05', { last: 132, prevClose: 121, asOf: '2024-01-05T15:00:00Z' })?.change).toBeCloseTo(0.32, 12);
  });
});
