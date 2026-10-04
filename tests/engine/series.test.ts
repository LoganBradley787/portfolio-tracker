import { describe, expect, it } from 'vitest';
import { buildCalendar, dailySeries, rangeSummary } from '../../src/engine/series.ts';
import type { PriceBar, Transaction } from '../../src/engine/types.ts';
import { fixtureDividends, fixtureSplits, historyBars, HISTORY_TICKERS, sampleTransactions } from '../helpers/fixtures.ts';
import { runLedger } from '../../src/engine/costBasis.ts';

const bars: Record<string, PriceBar[]> = Object.fromEntries(HISTORY_TICKERS.map((t) => [t, historyBars(t).map(({ date, close }) => ({ date, close }))]));
const spyDates = bars.SPY.map((b) => b.date);

function tx(seq: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, ticker = 'AAA'): Transaction {
  return { id: seq, seq, ticker, type, shares, price, date, account: 'Main' };
}

describe('buildCalendar', () => {
  it('uses SPY dates from the first transaction, and appends today if it is later', () => {
    const cal = buildCalendar(spyDates, '2022-06-28', '2026-10-02');
    expect(cal[0]).toBe('2022-06-28');
    expect(cal.at(-2)).toBe('2026-10-01');
    expect(cal.at(-1)).toBe('2026-10-02');
    expect(buildCalendar(spyDates, '2022-06-25', '2026-10-01')[0]).toBe('2022-06-27');
  });
});

describe('dailySeries on the sample with fixture prices', () => {
  const series = dailySeries({
    transactions: sampleTransactions(),
    splits: fixtureSplits(),
    bars,
    quotes: {},
    calendar: buildCalendar(spyDates, '2020-03-09', '2026-10-01'),
  });
  const day = (d: string) => series.find((p) => p.date === d)!;

  it('shows no jump from the SHOP split', () => {
    expect(day('2022-06-28').byTicker.SHOP.value).toBeCloseTo(3 * 350.26, 9);
    expect(day('2022-06-29').byTicker.SHOP.value).toBeCloseTo(30 * 33.05, 9);
  });

  it('handles TSLA’s 3-for-1 the same way', () => {
    const before = day('2022-08-24').byTicker.TSLA.value;
    const after = day('2022-08-25').byTicker.TSLA.value;
    expect(after / before).toBeGreaterThan(0.9);
    expect(after / before).toBeLessThan(1.1);
    expect(day('2022-08-25').byTicker.TSLA.shares).toBe(12);
  });

  it('excludes a ticker on days before it was bought', () => {
    expect(day('2021-03-15').byTicker.TSLA).toBeUndefined();
    expect(day('2021-03-16').byTicker.TSLA.shares).toBe(6);
    const d = day('2020-03-10');
    expect(Object.keys(d.byTicker)).toEqual(['DIS']);
    expect(d.value).toBeCloseTo(30 * bars.DIS.find((b) => b.date === '2020-03-10')!.close, 9);
    expect(d.buys).toBeCloseTo(30 * 111.46, 9);
  });

  it('tracks cost basis, flows and cumulative realized gain', () => {
    const d = day('2021-04-13');
    expect(d.sells).toBeCloseTo(1524.64, 9);
    expect(d.buys).toBeCloseTo(40 * 12.2, 9);
    expect(d.realized).toBeCloseTo(170.88, 6);
    expect(series.at(-1)!.cost).toBeCloseTo(12627.46, 6);
    expect(series.at(-1)!.realized).toBeCloseTo(170.88, 6);
    expect(series.every((p) => !p.incomplete)).toBe(true);
  });

  it('sums ticker values into the day’s value', () => {
    const d = day('2024-01-02');
    const sum = Object.values(d.byTicker).reduce((a, x) => a + x.value, 0);
    expect(d.value).toBeCloseTo(sum, 9);
  });
});

describe('dailySeries rules', () => {
  const flat = (from: string, to: string, close: number): PriceBar[] =>
    spyDates.filter((d) => d >= from && d <= to).map((date) => ({ date, close }));

  it('applies a weekend trade on the next trading day', () => {
    const s = dailySeries({
      transactions: [tx(1, '2020-03-07', 'Buy', 1, 10)],
      splits: [],
      bars: { AAA: flat('2020-03-02', '2020-03-31', 10) },
      quotes: {},
      calendar: buildCalendar(spyDates, '2020-03-07', '2020-03-31'),
    });
    expect(s[0]).toMatchObject({ date: '2020-03-09', value: 10, buys: 10 });
  });

  it('carries the previous close over a missing bar, adjusting for a split in the gap', () => {
    const b = flat('2020-03-02', '2020-03-31', 100).filter((x) => x.date !== '2020-03-11' && x.date !== '2020-03-12');
    const s = dailySeries({
      transactions: [tx(1, '2020-03-09', 'Buy', 1, 100)],
      splits: [{ ticker: 'AAA', exDate: '2020-03-12', ratio: 2 }],
      bars: { AAA: b.map((x) => (x.date >= '2020-03-12' ? { ...x, close: 50 } : x)) },
      quotes: {},
      calendar: buildCalendar(spyDates, '2020-03-09', '2020-03-31'),
    });
    const v = Object.fromEntries(s.map((p) => [p.date, p.value]));
    expect(v['2020-03-11']).toBe(100); // carried
    expect(v['2020-03-12']).toBe(100); // 2 shares × (100 / 2) carried across the split
    expect(v['2020-03-13']).toBe(100);
  });

  it('values a ticker with no prices at cost and marks the day incomplete', () => {
    const s = dailySeries({
      transactions: [tx(1, '2020-03-09', 'Buy', 2, 10, 'NEW'), tx(2, '2020-03-09', 'Buy', 1, 10)],
      splits: [],
      bars: { AAA: flat('2020-03-02', '2020-03-31', 11) },
      quotes: {},
      calendar: buildCalendar(spyDates, '2020-03-09', '2020-03-13'),
    });
    expect(s[0]).toMatchObject({ value: 20 + 11, incomplete: true });
    expect(s[0].byTicker.NEW.priced).toBe(false);
  });

  it('does not mark days incomplete for an unresolved ticker (it is flagged elsewhere)', () => {
    const s = dailySeries({
      transactions: [tx(1, '2020-03-09', 'Buy', 2, 10, 'SQ')],
      splits: [],
      bars: {},
      quotes: {},
      calendar: buildCalendar(spyDates, '2020-03-09', '2020-03-13'),
      unresolved: ['SQ'],
    });
    expect(s[0]).toMatchObject({ value: 20, incomplete: false });
  });

  it('values today from the latest quote', () => {
    const s = dailySeries({
      transactions: [tx(1, '2026-09-30', 'Buy', 3, 100)],
      splits: [],
      bars: { AAA: flat('2026-09-28', '2026-10-01', 100) },
      quotes: { AAA: { last: 110, prevClose: 100, asOf: '2026-10-02T12:27:29-04:00' } },
      calendar: buildCalendar(spyDates, '2026-09-30', '2026-10-02'),
    });
    expect(s.map((p) => [p.date, p.value])).toEqual([
      ['2026-09-30', 300],
      ['2026-10-01', 300],
      ['2026-10-02', 330],
    ]);
  });

  it('handles a full exit: value and cost go to zero, realized stays', () => {
    const s = dailySeries({
      transactions: [tx(1, '2020-03-09', 'Buy', 1, 10), tx(2, '2020-03-11', 'Sell', 1, 12)],
      splits: [],
      bars: { AAA: flat('2020-03-02', '2020-03-31', 12) },
      quotes: {},
      calendar: buildCalendar(spyDates, '2020-03-09', '2020-03-13'),
    });
    const last = s.at(-1)!;
    expect(last).toMatchObject({ value: 0, cost: 0, realized: 2 });
    expect(last.byTicker.AAA).toBeUndefined();
    expect(s[2]).toMatchObject({ sells: 12, value: 0 });
    expect(s[2].byTicker.AAA).toMatchObject({ value: 0, sells: 12 });
  });
});

describe('rangeSummary (spec 13.2)', () => {
  const s = dailySeries({
    transactions: [tx(1, '2020-03-11', 'Buy', 2, 10), tx(2, '2020-03-16', 'Sell', 1, 10)],
    splits: [],
    bars: { AAA: spyDates.filter((d) => d >= '2020-03-02' && d <= '2020-03-31').map((date) => ({ date, close: 10 })) },
    quotes: {},
    calendar: buildCalendar(spyDates, '2020-03-09', '2020-03-31'),
  });

  it('gives zero gain for a buy on the range’s first day at flat prices', () => {
    expect(rangeSummary(s, '2020-03-11', '2020-03-20')).toMatchObject({ startValue: 0, endValue: 10, buys: 20, sells: 10, gain: 0 });
  });

  it('uses the close before the range start as V_start', () => {
    expect(rangeSummary(s, '2020-03-12', '2020-03-20')).toMatchObject({ startValue: 20, buys: 0, sells: 10, gain: 0 });
  });

  it('snaps range ends to the calendar', () => {
    const r = rangeSummary(s, '2020-03-14', '2020-03-15'); // a weekend: nothing in range
    expect(r.days).toBe(0);
    expect(r.gain).toBe(0);
  });
});

describe('dividends in the daily series', () => {
  const dividends = fixtureDividends();
  const calendar = buildCalendar(spyDates, '2020-03-09', '2026-10-01');
  const series = dailySeries({ transactions: sampleTransactions(), splits: fixtureSplits(), dividends, bars, quotes: {}, calendar });

  it('books each dividend on its ex-date as income, per ticker and in total', () => {
    const vzDiv = dividends.find((d) => d.ticker === 'VZ' && d.exDate > '2021-03-23')!;
    const day = series.find((p) => p.date === vzDiv.exDate)!;
    expect(day.byTicker.VZ.dividends).toBeCloseTo(10 * vzDiv.amount, 12);
    expect(day.dividends).toBeGreaterThanOrEqual(day.byTicker.VZ.dividends);
  });

  it('accumulates to the ledger’s total', () => {
    const l = runLedger(sampleTransactions(), fixtureSplits(), { method: 'average', dividends });
    const total = l.dividends.reduce((a, d) => a + d.amount, 0);
    expect(total).toBeGreaterThan(0);
    expect(series.at(-1)!.dividendsCum).toBeCloseTo(total, 9);
    expect(series.reduce((a, p) => a + p.dividends, 0)).toBeCloseTo(total, 9);
  });

  it('adds dividends to the range gain', () => {
    const r = rangeSummary(series, '2020-03-09', '2026-10-01');
    expect(r.dividends).toBeCloseTo(series.at(-1)!.dividendsCum, 9);
    expect(r.gain).toBeCloseTo(r.endValue - r.startValue - r.buys + r.sells + r.dividends, 9);
  });
});
