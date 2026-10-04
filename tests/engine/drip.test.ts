import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { reinvestDividends } from '../../src/engine/drip.ts';
import { dailySeries, rangeSummary } from '../../src/engine/series.ts';
import { dailyReturns, rangeIrr } from '../../src/engine/returns.ts';
import type { Dividend, PriceBar, Split, Transaction } from '../../src/engine/types.ts';

let seq = 1;
function tx(date: string, type: 'Buy' | 'Sell', shares: number, price = 10, account = 'Main', ticker = 'AAA'): Transaction {
  const s = seq++;
  return { id: s, seq: s, ticker, type, shares, price, date, account };
}
const div = (exDate: string, amount: number, ticker = 'AAA'): Dividend => ({ ticker, exDate, amount });
const bar = (date: string, close: number): PriceBar => ({ date, close });
const BARS = { AAA: [bar('2024-01-02', 10), bar('2024-03-01', 20), bar('2024-04-01', 10), bar('2024-06-03', 25), bar('2025-01-15', 30)] };

function run(transactions: Transaction[], dividends: Dividend[], splits: Split[] = [], bars: Record<string, PriceBar[]> = BARS) {
  return reinvestDividends({ transactions, splits, dividends, bars });
}

describe('reinvestDividends', () => {
  it('buys shares at the ex-date close, and reinvested shares earn later dividends', () => {
    const r = run([tx('2024-01-02', 'Buy', 10)], [div('2024-03-01', 1), div('2024-06-03', 1)]);
    // $10 at 20 → 0.5 sh; then 10.5 sh × $1 = $10.50 at 25 → 0.42 sh.
    expect(r.reinvestments).toEqual([
      { date: '2024-03-01', ticker: 'AAA', account: 'Main', amount: 10, price: 20, shares: 0.5 },
      { date: '2024-06-03', ticker: 'AAA', account: 'Main', amount: 10.5, price: 25, shares: 0.42 },
    ]);
    const drips = r.transactions.filter((t) => t.drip);
    expect(drips.map((t) => [t.date, t.type, t.shares, t.price, t.account])).toEqual([
      ['2024-03-01', 'Buy', 0.5, 20, 'Main'],
      ['2024-06-03', 'Buy', 0.42, 25, 'Main'],
    ]);
    expect(new Set(r.transactions.map((t) => t.id)).size).toBe(r.transactions.length);

    const l = runLedger(r.transactions, [], { method: 'average', dividends: [div('2024-03-01', 1), div('2024-06-03', 1)] });
    const p = l.positions.get('AAA')!;
    expect(p.shares).toBeCloseTo(10.92, 12);
    expect(p.cost).toBeCloseTo(100 + 10 + 10.5, 12); // reinvested shares cost what was reinvested
    expect(p.dividends).toBeCloseTo(20.5, 12);
  });

  it('a split scales reinvested shares too', () => {
    const splits = [{ ticker: 'AAA', exDate: '2024-04-01', ratio: 2 }];
    const r = run([tx('2024-01-02', 'Buy', 10)], [div('2024-03-01', 1), div('2024-06-03', 1)], splits);
    // After the split: 21 shares, so the June dividend is $21 at 25.
    expect(r.reinvestments[1]).toMatchObject({ amount: 21, shares: 0.84 });
    const l = runLedger(r.transactions, splits, { method: 'fifo' });
    expect(l.positions.get('AAA')!.shares).toBeCloseTo(21.84, 12);
  });

  it('each account reinvests its own dividends', () => {
    const r = run([tx('2024-01-02', 'Buy', 10, 10, 'Main'), tx('2024-01-02', 'Buy', 5, 10, 'Brokerage')], [div('2024-03-01', 1)]);
    expect(r.reinvestments.map((x) => [x.account, x.amount, x.shares])).toEqual([
      ['Brokerage', 5, 0.25],
      ['Main', 10, 0.5],
    ]);
  });

  it('a reinvestment is its own FIFO lot, dated the ex-date', () => {
    // A sale of 10.5 takes the original 10 (long-term) and the reinvested 0.5 (short-term).
    const r = run([tx('2024-01-02', 'Buy', 10), tx('2025-01-15', 'Sell', 10.5, 30)], [div('2024-03-01', 1)]);
    const l = runLedger(r.transactions, [], { method: 'fifo' });
    expect(l.sales[0].lots!.map((x) => [x.acquired, x.shares, x.cost])).toEqual([
      ['2024-01-02', 10, 100],
      ['2024-03-01', 0.5, 10],
    ]);
  });

  it('selling every entered share sells the reinvested shares with them', () => {
    const r = run([tx('2024-01-02', 'Buy', 10), tx('2024-05-01', 'Sell', 10, 30)], [div('2024-03-01', 1), div('2024-06-03', 1)]);
    const sale = r.transactions.find((t) => t.type === 'Sell')!;
    expect(sale.shares).toBeCloseTo(10.5, 12);
    expect(r.reinvestments).toHaveLength(1); // nothing held by June
    const l = runLedger(r.transactions, [], { method: 'average' });
    expect(l.positions.size).toBe(0);
    expect(l.oversells).toEqual([]);
    expect(l.sales[0].proceeds).toBeCloseTo(315, 12);
  });

  it('a sale of the broker’s full count (entered shares + reinvested) is not an oversell', () => {
    const r = run([tx('2024-01-02', 'Buy', 10), tx('2024-05-01', 'Sell', 10.5, 30)], [div('2024-03-01', 1)]);
    expect(r.transactions.find((t) => t.type === 'Sell')!.shares).toBe(10.5);
    expect(runLedger(r.transactions, [], { method: 'fifo' }).oversells).toEqual([]);
  });

  it('keeps a dividend as cash when there is no close for it, or the position was sold that day', () => {
    const noBar = run([tx('2024-01-02', 'Buy', 10)], [div('2024-02-15', 1)], [], { AAA: [bar('2024-01-02', 10), bar('2024-03-01', 20)] });
    expect(noBar.reinvestments).toEqual([]);
    expect(noBar.cash).toEqual([{ date: '2024-02-15', ticker: 'AAA', account: 'Main', amount: 10, reason: 'no close' }]);

    const soldOnEx = run([tx('2024-01-02', 'Buy', 10), tx('2024-03-01', 'Sell', 10, 20)], [div('2024-03-01', 1)]);
    expect(soldOnEx.reinvestments).toEqual([]);
    expect(soldOnEx.cash).toEqual([{ date: '2024-03-01', ticker: 'AAA', account: 'Main', amount: 10, reason: 'sold' }]);
  });

  it('leaves transactions alone when there are no dividends', () => {
    const txs = [tx('2024-01-02', 'Buy', 10)];
    expect(run(txs, []).transactions).toEqual(txs);
  });
});

describe('reinvested dividends in the daily series and returns', () => {
  const calendar = ['2024-03-01', '2024-03-04', '2024-03-05'];
  const bars = { AAA: [bar('2024-03-01', 20), bar('2024-03-04', 20), bar('2024-03-05', 20)] };
  const dividends = [div('2024-03-04', 1)];
  const { transactions } = reinvestDividends({ transactions: [tx('2024-03-01', 'Buy', 10, 20)], splits: [], dividends, bars });
  const series = dailySeries({ transactions, splits: [], dividends, bars, quotes: {}, calendar });

  it('counts the dividend as income, reinvested, and not as money added', () => {
    const d = series[1];
    expect(d).toMatchObject({ value: 210, buys: 0, dividends: 10, reinvested: 10 });
    expect(d.byTicker.AAA).toMatchObject({ shares: 10.5, buys: 0, dividends: 10, reinvested: 10 });
    expect(series[0].buys).toBe(200);
  });

  it('the return is the dividend yield, counted once', () => {
    expect(dailyReturns(series)[1]).toBeCloseTo(0.05, 12);
    const s = rangeSummary(series, '2024-03-04', '2024-03-05');
    expect(s).toMatchObject({ startValue: 200, endValue: 210, buys: 0, dividends: 10, reinvested: 10 });
    expect(s.gain).toBeCloseTo(10, 12);
  });

  it('the IRR has no cash flow for a reinvested dividend', () => {
    // Opening 200 → closing 210 with nothing in between: positive, not doubled.
    const long = ['2024-01-02', '2024-03-04', '2024-03-05'];
    const lb = { AAA: [bar('2024-01-02', 20), bar('2024-03-04', 20), bar('2024-03-05', 20)] };
    const r = reinvestDividends({ transactions: [tx('2024-01-02', 'Buy', 10, 20)], splits: [], dividends, bars: lb });
    const s = dailySeries({ transactions: r.transactions, splits: [], dividends, bars: lb, quotes: {}, calendar: long });
    const irr = rangeIrr(s, '2024-01-02', '2024-03-05')!;
    const years = 63 / 365;
    expect(irr).toBeCloseTo(1.05 ** (1 / years) - 1, 6);
  });
});
