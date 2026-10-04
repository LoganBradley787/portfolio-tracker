import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { isLongTerm, taxYears } from '../../src/engine/realized.ts';
import type { Transaction } from '../../src/engine/types.ts';
import { readJson, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');

let seq = 1;
function tx(date: string, type: 'Buy' | 'Sell', shares: number, price: number, account = 'Main', ticker = 'AAA'): Transaction {
  const s = seq++;
  return { id: s, seq: s, ticker, type, shares, price, date, account };
}

describe('FIFO strategy', () => {
  it('consumes the oldest lots first on a partial sale', () => {
    const l = runLedger(
      [tx('2020-01-02', 'Buy', 10, 10), tx('2021-01-04', 'Buy', 10, 20), tx('2022-01-03', 'Buy', 10, 30), tx('2022-06-01', 'Sell', 15, 40)],
      [],
      { method: 'fifo' },
    );
    const sale = l.sales[0];
    expect(sale.costRemoved).toBeCloseTo(10 * 10 + 5 * 20, 12);
    expect(sale.lots).toEqual([
      { acquired: '2020-01-02', shares: 10, cost: 100 },
      { acquired: '2021-01-04', shares: 5, cost: 100 },
    ]);
    const p = l.positions.get('AAA')!;
    expect(p.shares).toBe(15);
    expect(p.cost).toBeCloseTo(5 * 20 + 10 * 30, 12);
    expect(p.lots).toEqual([
      { account: 'Main', acquired: '2021-01-04', shares: 5, cost: 100 },
      { account: 'Main', acquired: '2022-01-03', shares: 10, cost: 300 },
    ]);
  });

  it('scales lots on a split, keeping their cost', () => {
    const l = runLedger([tx('2020-01-02', 'Buy', 2, 100), tx('2020-06-01', 'Sell', 10, 30)], [{ ticker: 'AAA', exDate: '2020-03-02', ratio: 10 }], {
      method: 'fifo',
    });
    expect(l.sales[0].lots).toEqual([{ acquired: '2020-01-02', shares: 10, cost: 100 }]);
    expect(l.positions.get('AAA')!.shares).toBeCloseTo(10, 12);
    expect(l.positions.get('AAA')!.cost).toBeCloseTo(100, 12);
  });

  it('keeps lots per account', () => {
    const l = runLedger(
      [tx('2020-01-02', 'Buy', 1, 10, 'Main'), tx('2021-01-04', 'Buy', 1, 50, 'Brokerage'), tx('2022-01-03', 'Sell', 1, 60, 'Brokerage')],
      [],
      { method: 'fifo' },
    );
    // Average cost would remove 30; FIFO in the Brokerage account removes its own 50.
    expect(l.sales[0].costRemoved).toBe(50);
    expect(l.positions.get('AAA')!.accounts).toEqual(['Main']);
  });

  it('reports an oversell within an account even if another account holds the ticker', () => {
    const l = runLedger([tx('2020-01-02', 'Buy', 5, 10, 'Main'), tx('2020-02-03', 'Sell', 1, 10, 'Brokerage')], [], { method: 'fifo' });
    expect(l.oversells).toMatchObject([{ account: 'Brokerage', requested: 1, held: 0 }]);
    expect(l.positions.get('AAA')!.shares).toBe(5);
  });

  it('gives the sample’s one sale the same 170.88 (single lot)', () => {
    const l = runLedger(sampleTransactions(), expected.splitsKnownToSheet, { method: 'fifo' });
    expect(l.sales[0].gain).toBeCloseTo(170.88, 6);
    for (const [t, h] of Object.entries<any>(expected.holdings)) {
      expect(l.positions.get(t)!.shares, t).toBeCloseTo(h.shares, 9);
      expect(l.positions.get(t)!.cost, t).toBeCloseTo(h.totalCost, 6);
    }
  });
});

describe('tax years', () => {
  it('long-term means held more than one year', () => {
    expect(isLongTerm('2020-01-02', '2021-01-02')).toBe(false);
    expect(isLongTerm('2020-01-02', '2021-01-03')).toBe(true);
    expect(isLongTerm('2020-02-29', '2021-02-28')).toBe(false);
    expect(isLongTerm('2020-02-29', '2021-03-01')).toBe(true);
  });

  it('splits each sale’s lots into short- and long-term by calendar year', () => {
    const l = runLedger(
      [
        tx('2020-01-02', 'Buy', 10, 10),
        tx('2020-12-01', 'Buy', 10, 20),
        tx('2021-06-01', 'Sell', 15, 30), // 10 long (+200), 5 short (+50)
        tx('2022-03-01', 'Sell', 5, 15), // 5 long (−25)
      ],
      [],
      { method: 'fifo' },
    );
    const years = taxYears(l.sales);
    expect(years.map((y) => y.year)).toEqual([2022, 2021]);
    const y2021 = years.find((y) => y.year === 2021)!;
    expect(y2021.longTerm).toMatchObject({ proceeds: 300, cost: 100, gain: 200 });
    expect(y2021.shortTerm).toMatchObject({ proceeds: 150, cost: 100, gain: 50 });
    expect(y2021.total).toBeCloseTo(250, 12);
    expect(y2021.lots).toHaveLength(2);
    expect(years[0].longTerm.gain).toBeCloseTo(-25, 12);
  });
});
