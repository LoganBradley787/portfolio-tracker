import { describe, expect, it } from 'vitest';
import { contribution, dailyReturns, drawdown, rangeIrr, twrIndex, volatility, xirr } from '../../src/engine/returns.ts';
import type { DayPoint } from '../../src/engine/series.ts';
import { buildCalendar, dailySeries, rangeSummary } from '../../src/engine/series.ts';
import { fixtureSplits, historyBars, HISTORY_TICKERS, sampleTransactions } from '../helpers/fixtures.ts';

function day(date: string, value: number, buys = 0, sells = 0, incomplete = false, dividends = 0): DayPoint {
  return { date, value, cost: 0, realized: 0, buys, sells, dividends, reinvested: 0, dividendsCum: 0, incomplete, byTicker: {} };
}

describe('time-weighted return (spec 7.7)', () => {
  it('equals the simple return when there are no flows', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 110), day('2024-01-04', 121)];
    const idx = twrIndex(s, '2024-01-03', '2024-01-04');
    expect(idx.map((p) => p.index)).toEqual([expect.closeTo(1.1, 12), expect.closeTo(1.21, 12)]);
  });

  it('is not changed by a deposit (buy) at start-of-day money', () => {
    // Day 2: +10%. Day 3: buy 100 more, then +10% on everything.
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 110), day('2024-01-04', 231, 100)];
    expect(dailyReturns(s)).toEqual([0, expect.closeTo(0.1, 12), expect.closeTo(0.1, 12)]);
  });

  it('handles a full liquidation day: sale proceeds count as end-of-day money', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 0, 0, 105), day('2024-01-04', 0)];
    const r = dailyReturns(s);
    expect(r[1]).toBeCloseTo(0.05, 12);
    expect(r[2]).toBe(0); // zero denominator
  });

  it('treats the first buy day as start-of-day money', () => {
    const r = dailyReturns([day('2024-01-02', 102, 100)]);
    expect(r[0]).toBeCloseTo(0.02, 12);
  });

  it('excludes incomplete days and the day after one', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 150, 0, 0, true), day('2024-01-04', 160), day('2024-01-05', 176)];
    expect(dailyReturns(s)).toEqual([0, 0, 0, expect.closeTo(0.1, 12)]);
  });

  it('chains from 1 inside the range only', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 200), day('2024-01-04', 220)];
    expect(twrIndex(s, '2024-01-04', '2024-01-04').map((p) => p.index)).toEqual([expect.closeTo(1.1, 12)]);
  });
});


describe('xirr (spec 13.2)', () => {
  it('matches a known answer on actual/365', () => {
    const r = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 },
    ])!;
    expect(r).toBeCloseTo(0.0997, 3);
    expect(Math.abs(r - (1.1 ** (365 / 366) - 1))).toBeLessThan(1e-7);
  });

  it('nets same-day flows', () => {
    const a = xirr([
      { date: '2020-01-01', amount: -600 },
      { date: '2020-01-01', amount: -400 },
      { date: '2021-01-01', amount: 1100 },
    ]);
    expect(a).toBeCloseTo(0.0997, 3);
  });

  it('returns null with no sign change', () => {
    expect(xirr([{ date: '2020-01-01', amount: -1 }, { date: '2021-01-01', amount: -1 }])).toBeNull();
  });

  it('handles a large loss inside the bracket', () => {
    expect(xirr([{ date: '2020-01-01', amount: -1000 }, { date: '2021-01-01', amount: 10 }])!).toBeCloseTo(10 / 1000 - 1, 2);
  });
});

describe('rangeIrr', () => {
  const s = [day('2024-01-02', 1000, 1000), day('2024-07-01', 1050), day('2025-01-02', 1100)];
  it('uses the opening value as a negative flow and the end value as a positive one', () => {
    expect(rangeIrr(s, '2024-01-02', '2025-01-02')).toBeCloseTo(1.1 ** (365 / 366) - 1, 6);
    // Starting mid-way: open 1050 → 1100.
    expect(rangeIrr(s, '2024-07-02', '2025-01-02')).toBeCloseTo((1100 / 1050) ** (365 / 184) - 1, 6);
  });
  it('is n/a under 30 days', () => {
    expect(rangeIrr(s, '2024-12-20', '2025-01-02')).toBeNull();
  });
});

describe('drawdown and volatility', () => {
  it('measures drawdown on the TWR index', () => {
    const d = drawdown([1, 1.2, 0.9, 1.0, 1.3, 1.17].map((index, i) => ({ date: `2024-01-0${i + 1}`, index })));
    expect(d.max).toBeCloseTo(0.9 / 1.2 - 1, 12);
    expect(d.maxPeakDate).toBe('2024-01-02');
    expect(d.maxTroughDate).toBe('2024-01-03');
    expect(d.current).toBeCloseTo(1.17 / 1.3 - 1, 12);
    expect(d.series.map((x) => x.drawdown)[3]).toBeCloseTo(1.0 / 1.2 - 1, 12);
  });

  it('is not hidden by deposits (it runs on the time-weighted index)', () => {
    // Value only rises thanks to a deposit while the holding fell 20%.
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 80), day('2024-01-04', 1080, 1000)];
    const idx = twrIndex(s, '2024-01-02', '2024-01-04');
    expect(drawdown(idx).max).toBeCloseTo(-0.2, 12);
  });

  it('annualizes the sample standard deviation of invested days only', () => {
    const r = [0, 0.01, -0.01, 0.02, 0]; // first and last are excluded (uninvested)
    const invested = [false, true, true, true, false];
    const mean = (0.01 - 0.01 + 0.02) / 3;
    const sd = Math.sqrt(((0.01 - mean) ** 2 + (-0.01 - mean) ** 2 + (0.02 - mean) ** 2) / 2);
    expect(volatility(r, invested)).toBeCloseTo(sd * Math.sqrt(252), 12);
    expect(volatility([0.01], [true])).toBeNull();
  });
});

describe('contribution by position', () => {
  const bars = Object.fromEntries(HISTORY_TICKERS.map((t) => [t, historyBars(t).map(({ date, close }) => ({ date, close }))]));
  const series = dailySeries({
    transactions: sampleTransactions(),
    splits: fixtureSplits(),
    bars,
    quotes: {},
    calendar: buildCalendar(bars.SPY.map((b) => b.date), '2020-03-09', '2026-10-01'),
  });

  for (const [from, to] of [
    ['2020-03-09', '2026-10-01'],
    ['2021-04-01', '2022-07-15'],
    ['2022-06-29', '2022-06-29'],
  ]) {
    it(`sums to the range gain (${from} → ${to})`, () => {
      const c = contribution(series, from, to);
      const total = c.reduce((a, x) => a + x.gain, 0);
      expect(total).toBeCloseTo(rangeSummary(series, from, to).gain, 6);
    });
  }

  it('gives each position a return on the money at work and a share of the gain', () => {
    const d = (date: string, by: Record<string, [value: number, buys: number]>): DayPoint => ({
      date, value: 0, cost: 0, realized: 0, buys: 0, sells: 0, dividends: 0, reinvested: 0, dividendsCum: 0, incomplete: false,
      byTicker: Object.fromEntries(Object.entries(by).map(([t, [value, buys]]) => [t, { shares: 1, value, cost: 0, buys, sells: 0, dividends: 0, reinvested: 0, priced: true }])),
    });
    const s = [d('2024-01-02', { A: [100, 100], B: [200, 200] }), d('2024-01-03', { A: [150, 0], B: [180, 0] }), d('2024-01-04', { A: [260, 100], B: [180, 0] })];
    // Whole range: A put 200 to work and gained 60; B put 200 to work and lost 20.
    const all = Object.fromEntries(contribution(s, '2024-01-02', '2024-01-04').map((c) => [c.ticker, c]));
    expect(all.A.returnPct).toBeCloseTo(0.3, 12);
    expect(all.B.returnPct).toBeCloseTo(-0.1, 12);
    expect(all.A.share).toBeCloseTo(1.5, 12);
    expect(all.B.share).toBeCloseTo(-0.5, 12);
    // From day two: A starts at 100 and adds 100 (gain 60 on 200); B starts at 200 (gain −20).
    const late = Object.fromEntries(contribution(s, '2024-01-03', '2024-01-04').map((c) => [c.ticker, c]));
    expect(late.A.returnPct).toBeCloseTo(0.3, 12);
    expect(late.B.returnPct).toBeCloseTo(-0.1, 12);
  });

  it('leaves the share of gain empty when the range did not gain', () => {
    const d = (date: string, value: number, buys: number): DayPoint => ({
      date, value, cost: 0, realized: 0, buys, sells: 0, dividends: 0, reinvested: 0, dividendsCum: 0, incomplete: false,
      byTicker: { A: { shares: 1, value, cost: 0, buys, sells: 0, dividends: 0, reinvested: 0, priced: true } },
    });
    const c = contribution([d('2024-01-02', 100, 100), d('2024-01-03', 90, 0)], '2024-01-02', '2024-01-03');
    expect(c[0].returnPct).toBeCloseTo(-0.1, 12);
    expect(c[0].share).toBeNull();
  });

  it('includes a ticker sold in the range (TSLA’s partial sale)', () => {
    const c = contribution(series, '2021-04-01', '2021-04-30');
    const tsla = c.find((x) => x.ticker === 'TSLA')!;
    expect(tsla.sells).toBeCloseTo(1524.64, 9);
  });
});

describe('dividends in returns', () => {
  it('a dividend offsets the ex-date price drop in the time-weighted return', () => {
    const s = [day('2024-01-02', 100, 100), day('2024-01-03', 98, 0, 0, false, 2)];
    expect(dailyReturns(s)[1]).toBeCloseTo(0, 12);
  });

  it('counts dividends as positive flows in the IRR', () => {
    const s = [day('2024-01-02', 1000, 1000), day('2024-07-01', 1000, 0, 0, false, 50), day('2025-01-02', 1050)];
    expect(rangeIrr(s, '2024-01-02', '2025-01-02')!).toBeGreaterThan(0.09);
  });

  it('includes dividends in each position’s contribution', () => {
    const d = (date: string, value: number, buys: number, dividends: number): DayPoint => ({
      date, value, cost: 0, realized: 0, buys, sells: 0, dividends, reinvested: 0, dividendsCum: 0, incomplete: false,
      byTicker: { A: { shares: 1, value, cost: 0, buys, sells: 0, dividends, reinvested: 0, priced: true } },
    });
    const c = contribution([d('2024-01-02', 100, 100, 0), d('2024-01-03', 98, 0, 2)], '2024-01-02', '2024-01-03');
    expect(c[0]).toMatchObject({ ticker: 'A', dividends: 2, gain: 0 });
  });
});
