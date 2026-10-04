import { expect, it } from 'vitest';
import { shadowBenchmark, totalReturnLevels } from '../../src/engine/benchmark.ts';
import { splitAdjustedBars } from '../../src/engine/prices.ts';

it('a custom benchmark split preserves total return, shadow value and range gain', () => {
  const bars = [{ date: '2024-01-02', close: 100 }, { date: '2024-01-03', close: 50 }, { date: '2024-01-04', close: 55 }];
  const splits = [{ ticker: 'BENCH', exDate: '2024-01-03', ratio: 2 }];
  const calendar = bars.map((b) => b.date);
  expect(totalReturnLevels(bars, [], calendar, null, splits)).toEqual([100, 100, 110]);
  const shadow = shadowBenchmark({ bars, calendar, splits: [], benchmarkSplits: splits, range: { from: calendar[0], to: calendar[2] },
    transactions: [{ id: 1, seq: 1, ticker: 'A', date: calendar[0], type: 'Buy', price: 100, shares: 1, account: '' }] });
  expect(shadow.value).toBe(110);
  expect(shadow.rangeGains.A).toBe(10);
  expect(splitAdjustedBars(bars, splits, '2024-01-04')).toEqual([{ date: '2024-01-02', close: 50 }, { date: '2024-01-03', close: 50 }, { date: '2024-01-04', close: 55 }]);
});

it('combines benchmark splits and dividends in order and restates a carried close on a missing split day', () => {
  const bars = [{ date: '2024-01-02', close: 100 }, { date: '2024-01-04', close: 49 }];
  const splits = [{ ticker: 'B', exDate: '2024-01-03', ratio: 2 }];
  const calendar = ['2024-01-02', '2024-01-03', '2024-01-04'];
  expect(totalReturnLevels(bars, [], calendar, null, splits)).toEqual([100, 100, 98]);
  const shadow = shadowBenchmark({ bars, calendar, splits: [], benchmarkSplits: splits,
    transactions: [{ id: 1, seq: 1, ticker: 'A', date: calendar[0], type: 'Buy', price: 100, shares: 1, account: '' }] });
  expect(shadow.days.map((d) => d.value)).toEqual([100, 100, 98]);
  const levels = totalReturnLevels(bars, [{ exDate: '2024-01-04', amount: 1 }], calendar, null, splits);
  expect(levels.at(-1)).toBeCloseTo(100);
});
