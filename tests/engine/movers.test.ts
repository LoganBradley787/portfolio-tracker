import { describe, expect, it } from 'vitest';
import { movement } from '../../src/engine/movers.ts';
import { buildCalendar, dailySeries } from '../../src/engine/series.ts';
import type { PriceBar, Transaction } from '../../src/engine/types.ts';

const tx = (id: number, ticker: string, date: string, type: 'Buy' | 'Sell', shares: number, price: number): Transaction =>
  ({ id, seq: id, ticker, account: 'A', date, type, shares, price });
const bars = (closes: [string, number][]): PriceBar[] => closes.map(([date, close]) => ({ date, close }));

// Trading days: Sep 1–4, Sep 8–11, then Oct 1–2 (Thu, Fri).
const DAYS = ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04', '2025-09-08', '2025-09-09', '2025-09-10', '2025-09-11',
  '2025-09-25', '2025-09-26', '2025-09-29', '2025-09-30', '2025-10-01', '2025-10-02'];
const flat = (price: number, last: Record<string, number> = {}) => bars(DAYS.map((d) => [d, last[d] ?? price]));

function series(transactions: Transaction[], prices: Record<string, PriceBar[]>, today = '2025-10-02') {
  return dailySeries({ transactions, splits: [], bars: prices, quotes: {}, calendar: buildCalendar(DAYS, transactions[0].date, today) });
}

describe('what moved', () => {
  const s = series(
    [tx(1, 'UP', '2025-09-01', 'Buy', 10, 100), tx(2, 'DOWN', '2025-09-01', 'Buy', 10, 50), tx(3, 'FLAT', '2025-09-01', 'Buy', 1, 20)],
    {
      UP: flat(100, { '2025-09-29': 104, '2025-09-30': 104, '2025-10-01': 104, '2025-10-02': 110 }),
      DOWN: flat(50, { '2025-09-26': 48, '2025-09-29': 48, '2025-09-30': 48, '2025-10-01': 48, '2025-10-02': 47 }),
      FLAT: flat(20),
    },
  );

  it('ranks the last day by dollars and leaves out holdings that did not move', () => {
    const day = movement(s, '2025-10-02', 'day')!;
    expect(day).toMatchObject({ from: '2025-10-02', to: '2025-10-02', incomplete: false });
    expect(day.movers.map((m) => [m.ticker, Math.round(m.gain)])).toEqual([['UP', 60], ['DOWN', -10]]);
    expect(day.gain).toBeCloseTo(50);
    expect(day.returnPct).toBeCloseTo(50 / (1040 + 480 + 20));
    expect(day.movers[0].returnPct).toBeCloseTo(60 / 1040);
  });

  it('covers seven calendar days for a week and one month for a month', () => {
    const week = movement(s, '2025-10-02', 'week')!;
    expect(week.from).toBe('2025-09-26');
    expect(week.movers.map((m) => [m.ticker, Math.round(m.gain)])).toEqual([['UP', 100], ['DOWN', -30]]);
    const month = movement(s, '2025-10-02', 'month')!;
    expect(month.from).toBe('2025-09-03');
    expect(month.gain).toBeCloseTo(70);
    expect(month.returnPct).toBeCloseTo(70 / 1520);
  });

  it('covers a year for a year and everything since the first day for all time', () => {
    const year = movement(s, '2025-10-02', 'year')!;
    expect(year.from).toBe('2025-09-01');
    expect(year.gain).toBeCloseTo(70);
    const all = movement(s, '2025-10-02', 'all')!;
    expect(all).toMatchObject({ from: '2025-09-01', to: '2025-10-02' });
    expect(all.gain).toBeCloseTo(70);
    expect(all.movers.map((m) => m.ticker)).toEqual(['UP', 'DOWN']);
  });

  it('ends at the last day prices changed, not at a later carried-forward day', () => {
    const weekend = series([tx(1, 'UP', '2025-09-01', 'Buy', 10, 100)], { UP: flat(100, { '2025-10-02': 110 }) }, '2025-10-04');
    expect(movement(weekend, '2025-10-04', 'day')!.gain).toBe(0);
    expect(movement(weekend, '2025-10-02', 'day')!).toMatchObject({ to: '2025-10-02', gain: 100 });
  });

  it('does not count money added or taken out as movement', () => {
    const traded = series(
      [tx(1, 'UP', '2025-09-01', 'Buy', 10, 100), tx(2, 'UP', '2025-10-02', 'Buy', 5, 108), tx(3, 'DOWN', '2025-09-01', 'Buy', 10, 50), tx(4, 'DOWN', '2025-10-02', 'Sell', 10, 55)],
      { UP: flat(100, { '2025-10-02': 110 }), DOWN: flat(50, { '2025-10-02': 56 }) },
    );
    const day = movement(traded, '2025-10-02', 'day')!;
    expect(day.movers).toEqual([
      expect.objectContaining({ ticker: 'UP', gain: 110 }), // 10 × $10 on the old shares + 5 × $2 on the new
      expect.objectContaining({ ticker: 'DOWN', gain: 50, endValue: 0 }),
    ]);
  });

  it('flags a period with a missing price and returns null before the first day', () => {
    const missing = series([tx(1, 'UP', '2025-09-01', 'Buy', 10, 100), tx(2, 'NEW', '2025-10-01', 'Buy', 1, 10)], { UP: flat(100) });
    expect(movement(missing, '2025-10-02', 'day')!.incomplete).toBe(true);
    expect(movement(missing, '2025-09-11', 'day')!.incomplete).toBe(false);
    expect(movement(missing, '2025-08-01', 'day')).toBeNull();
  });
});
