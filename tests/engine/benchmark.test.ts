import { describe, expect, it } from 'vitest';
import { closeLookup, shadowBenchmark, sheetMirror } from '../../src/engine/benchmark.ts';
import { buildCalendar } from '../../src/engine/series.ts';
import type { PriceBar, Transaction } from '../../src/engine/types.ts';
import { historyBars, readJson, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');
const bench = expected.benchmarkSheetCompatible;

function tx(seq: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, ticker = 'AAA', account = 'Main'): Transaction {
  return { id: seq, seq, ticker, type, shares, price, date, account };
}

describe('sheetMirror (the sheet’s S&P 500 Math, no clamp)', () => {
  // The sheet's own index closes for the first 11 rows (the rest were #N/A at export).
  const rows = bench.rows.slice(0, 11);
  const closes = new Map<string, number>(rows.map((r: any) => [r.date, r.indexClose]));
  const txs = sampleTransactions().slice(0, 11);

  it('matches the sheet row by row', () => {
    const m = sheetMirror(txs, (d) => closes.get(d) ?? null, 4500);
    m.rows.forEach((r, i) => {
      expect(r.units).toBeCloseTo(rows[i].indexUnits, 9);
      expect(r.runningUnits).toBeCloseTo(rows[i].runningUnits, 8);
      expect(r.runningCost).toBeCloseTo(rows[i].runningCost, 5);
      if (rows[i].costRemoved !== null) expect(r.costRemoved).toBeCloseTo(rows[i].costRemoved, 6);
    });
  });

  it('gives the sheet’s units sold and realized gain', () => {
    const m = sheetMirror(txs, (d) => closes.get(d) ?? null, 4500);
    expect(m.unitsSold).toBeCloseTo(bench.unitsSold, 9);
    expect(m.realized).toBeCloseTo(bench.realizedGain, 6);
    expect(m.negative).toBe(false);
  });

  it('goes negative (and says so) when a sale’s proceeds exceed the position', () => {
    const m = sheetMirror([tx(1, '2024-01-02', 'Buy', 4, 100), tx(2, '2024-06-03', 'Sell', 1, 1000)], () => 100, 100);
    expect(m.units).toBeCloseTo(4 - 10, 12);
    expect(m.negative).toBe(true);
  });

  it('skips rows with no benchmark close and counts them', () => {
    const m = sheetMirror(txs, (d) => (d === '2020-03-10' ? null : closes.get(d) ?? null), 4500);
    expect(m.missing).toBe(1);
  });
});

describe('shadowBenchmark (per-ticker shadow, spec 13.1)', () => {
  const flat = (close: number): PriceBar[] => historyBars('SPY').filter((b) => b.date >= '2024-01-02' && b.date <= '2024-12-31').map((b) => ({ date: b.date, close }));
  const calendar = buildCalendar(historyBars('SPY').map((b) => b.date), '2024-01-02', '2024-12-31');

  it('selling 25% of a ticker sells 25% of its shadow units, never going negative', () => {
    const s = shadowBenchmark({
      transactions: [tx(1, '2024-01-02', 'Buy', 4, 100), tx(2, '2024-06-03', 'Sell', 1, 1000)],
      splits: [],
      bars: flat(100),
      calendar,
    });
    expect(s.byTicker.AAA.units).toBeCloseTo(3, 12);
    expect(s.byTicker.AAA.cost).toBeCloseTo(300, 12);
    expect(s.realized).toBeCloseTo(0, 12); // sold 1 unit at 100, cost 100
    expect(s.units).toBeCloseTo(3, 12);
    expect(s.value).toBeCloseTo(300, 12);
    expect(s.days.at(-1)!.value).toBeCloseTo(300, 12);
    expect(s.days.reduce((a, d) => a + d.buys, 0)).toBeCloseTo(400, 12);
    expect(s.days.reduce((a, d) => a + d.sells, 0)).toBeCloseTo(100, 12);
  });

  it('uses the share count after splits to work out the fraction sold', () => {
    const s = shadowBenchmark({
      transactions: [tx(1, '2024-01-02', 'Buy', 1, 100), tx(2, '2024-06-03', 'Sell', 1, 30)],
      splits: [{ ticker: 'AAA', exDate: '2024-03-01', ratio: 4 }],
      bars: flat(50),
      calendar,
    });
    expect(s.byTicker.AAA.units).toBeCloseTo(1.5, 12); // 2 units, 25% sold
  });

  it('keeps shadows per ticker and closes one on a full exit', () => {
    const s = shadowBenchmark({
      transactions: [tx(1, '2024-01-02', 'Buy', 1, 100, 'A'), tx(2, '2024-01-02', 'Buy', 1, 200, 'B'), tx(3, '2024-02-01', 'Sell', 1, 150, 'A')],
      splits: [],
      bars: flat(100),
      calendar,
    });
    expect(s.byTicker.A.units).toBe(0);
    expect(s.byTicker.B.units).toBeCloseTo(2, 12);
    expect(s.cost).toBeCloseTo(200, 12);
  });

  it('clamps an oversell to selling the whole shadow', () => {
    const s = shadowBenchmark({ transactions: [tx(1, '2024-01-02', 'Buy', 1, 100), tx(2, '2024-02-01', 'Sell', 5, 100)], splits: [], bars: flat(100), calendar });
    expect(s.byTicker.AAA.units).toBe(0);
  });

  it('uses the next available close for a trade on a day with no bar', () => {
    const bars = flat(100).map((b) => (b.date === '2024-01-02' ? { ...b, close: 999 } : b)).filter((b) => b.date !== '2024-01-03');
    const at = closeLookup(bars);
    expect(at('2024-01-03')).toBe(100); // next: 2024-01-04
    expect(at('2024-01-06')).toBe(100);
  });

  it('runs on the sample with real SPY closes', () => {
    const spy = historyBars('SPY').map(({ date, close }) => ({ date, close }));
    const s = shadowBenchmark({ transactions: sampleTransactions(), splits: [], bars: spy, calendar: buildCalendar(spy.map((b) => b.date), '2020-03-10', '2026-10-01') });
    const dis0 = spy.find((b) => b.date === '2020-03-10')!.close;
    expect(s.days[0].units).toBeCloseTo((30 * 111.46) / dis0, 9);
    // TSLA shadow: 6 shares bought, 2 sold → two thirds of its units remain.
    const tslaClose = spy.find((b) => b.date === '2021-03-16')!.close;
    expect(s.byTicker.TSLA.units).toBeCloseTo(((6 * 676.88) / tslaClose) * (4 / 6), 9);
    expect(s.units).toBeGreaterThan(0);
  });
});

describe('shadowBenchmark today', () => {
  it('values today from the quote', () => {
    const bars = [{ date: '2024-01-02', close: 100 }];
    const s = shadowBenchmark({
      transactions: [{ id: 1, seq: 1, ticker: 'A', type: 'Buy', shares: 1, price: 100, date: '2024-01-02', account: '' }],
      splits: [],
      bars,
      calendar: ['2024-01-02', '2024-01-03'],
      quote: { last: 110, prevClose: 100, asOf: '2024-01-03T15:00:00Z' },
    });
    expect(s.days.map((d) => d.value)).toEqual([100, 110]);
  });
});

import { totalReturnLevels } from '../../src/engine/benchmark.ts';

describe('benchmark dividends, reinvested', () => {
  const bars = [
    { date: '2024-01-02', close: 100 },
    { date: '2024-01-03', close: 100 },
    { date: '2024-01-04', close: 100 },
  ];
  const cal = bars.map((b) => b.date);

  it('total-return levels grow by each dividend at the ex-date close', () => {
    expect(totalReturnLevels(bars, [{ exDate: '2024-01-03', amount: 1 }], cal)).toEqual([100, 101, 101]);
    expect(totalReturnLevels(bars, [], cal)).toEqual([100, 100, 100]);
  });

  it('shadows reinvest the benchmark’s dividends into more units', () => {
    const s = shadowBenchmark({
      transactions: [{ id: 1, seq: 1, ticker: 'A', type: 'Buy', shares: 10, price: 100, date: '2024-01-02', account: '' }],
      splits: [],
      bars,
      calendar: cal,
      dividends: [{ exDate: '2024-01-03', amount: 1 }],
    });
    expect(s.units).toBeCloseTo(10.1, 12);
    expect(s.value).toBeCloseTo(1010, 12);
    expect(s.dividends).toBeCloseTo(10, 12);
    expect(s.cost).toBe(1000);
  });

  it('a buy on the ex-date does not get that dividend', () => {
    const s = shadowBenchmark({
      transactions: [{ id: 1, seq: 1, ticker: 'A', type: 'Buy', shares: 10, price: 100, date: '2024-01-03', account: '' }],
      splits: [],
      bars,
      calendar: cal,
      dividends: [{ exDate: '2024-01-03', amount: 1 }],
    });
    expect(s.units).toBeCloseTo(10, 12);
  });

  it('SPY’s total return beats its price return over the fixture history', () => {
    const spy = historyBars('SPY');
    const levels = totalReturnLevels(spy.map(({ date, close }) => ({ date, close })), spy.filter((b) => b.divCash).map((b) => ({ exDate: b.date, amount: b.divCash })), spy.map((b) => b.date));
    const tr = levels.at(-1)! / levels[0]! - 1;
    const pr = spy.at(-1)!.close / spy[0].close - 1;
    expect(tr - pr).toBeGreaterThan(0.05);
  });
});
