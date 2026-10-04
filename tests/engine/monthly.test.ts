import { describe, expect, it } from 'vitest';
import { monthlyReturns } from '../../src/engine/returns.ts';
import type { DayPoint } from '../../src/engine/series.ts';

function day(date: string, value: number, buys = 0, incomplete = false): DayPoint {
  return { date, value, buys, incomplete, cost: 0, realized: 0, sells: 0, dividends: 0, reinvested: 0, dividendsCum: 0, byTicker: {} };
}

describe('monthly returns', () => {
  it('compounds daily returns, preserving the close before the range and ignoring deposits', () => {
    const s = [day('2023-12-29', 100, 100), day('2024-01-02', 110), day('2024-01-31', 132), day('2024-02-01', 232, 100), day('2024-02-29', 255.2)];
    const months = monthlyReturns(s, '2024-01-01', '2024-02-29');
    expect(months.map((m) => m.month)).toEqual(['2024-01', '2024-02']);
    expect(months[0].return).toBeCloseTo(0.32);
    expect(months[1].return).toBeCloseTo(0.1);
    expect(months.every((m) => !m.partial)).toBe(true);
  });

  it('marks clipped months and withholds returns contaminated by missing prices', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-15', 100, 0, true), day('2024-02-01', 110), day('2024-02-15', 120)];
    const months = monthlyReturns(s, '2024-01-15', '2024-02-15');
    expect(months.every((m) => m.partial && m.incomplete && m.return === null)).toBe(true);
  });

  it('leaves months without invested days unavailable', () => {
    expect(monthlyReturns([day('2024-01-02', 0)], '2024-01-01', '2024-01-31')[0].return).toBeNull();
  });
});
