import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { orderEvents } from '../../src/engine/replay.ts';
import { dividendsByYear } from '../../src/engine/realized.ts';
import type { Dividend, Transaction } from '../../src/engine/types.ts';
import { fixtureDividends, fixtureSplits, sampleTransactions } from '../helpers/fixtures.ts';

let seq = 1;
function tx(date: string, type: 'Buy' | 'Sell', shares: number, price = 10, ticker = 'AAA', account = 'Main'): Transaction {
  const s = seq++;
  return { id: s, seq: s, ticker, type, shares, price, date, account };
}
const div = (exDate: string, amount: number, ticker = 'AAA'): Dividend => ({ ticker, exDate, amount });

describe('dividend events in the replay', () => {
  it('orders a same-day split, then the dividend, then trades', () => {
    const e = orderEvents([tx('2024-03-01', 'Buy', 1)], [{ ticker: 'AAA', exDate: '2024-03-01', ratio: 2 }], undefined, [div('2024-03-01', 0.5)]);
    expect(e.map((x) => x.kind)).toEqual(['split', 'dividend', 'trade']);
  });
});

describe('dividends in the ledger', () => {
  it('pays shares held going into the ex-date', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 10)], [], { method: 'average', dividends: [div('2024-03-01', 0.25)] });
    expect(l.dividends).toEqual([{ date: '2024-03-01', ticker: 'AAA', shares: 10, perShare: 0.25, amount: 2.5 }]);
    expect(l.positions.get('AAA')!.dividends).toBeCloseTo(2.5, 12);
  });

  it('does not pay a buy on the ex-date, but does pay a sale on the ex-date', () => {
    const buyOnEx = runLedger([tx('2024-03-01', 'Buy', 10)], [], { method: 'average', dividends: [div('2024-03-01', 1)] });
    expect(buyOnEx.dividends).toEqual([]);
    const sellOnEx = runLedger([tx('2024-01-02', 'Buy', 10), tx('2024-03-01', 'Sell', 10)], [], { method: 'average', dividends: [div('2024-03-01', 1)] });
    expect(sellOnEx.dividends[0].amount).toBe(10);
    expect(sellOnEx.dividendsByTicker.get('AAA')).toBe(10);
  });

  it('uses post-split shares when a split shares the ex-date', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 10)], [{ ticker: 'AAA', exDate: '2024-03-01', ratio: 2 }], {
      method: 'average',
      dividends: [div('2024-03-01', 0.1)],
    });
    expect(l.dividends[0]).toMatchObject({ shares: 20, amount: 2 });
  });

  it('pays nothing on a closed position and ignores other tickers', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 10), tx('2024-02-01', 'Sell', 10)], [], {
      method: 'average',
      dividends: [div('2024-03-01', 1), div('2024-01-15', 1, 'BBB')],
    });
    expect(l.dividends).toEqual([]);
  });

  it('works the same under FIFO, summing across accounts', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 3, 10, 'AAA', 'Main'), tx('2024-01-03', 'Buy', 2, 10, 'AAA', 'Brokerage')], [], {
      method: 'fifo',
      dividends: [div('2024-03-01', 1)],
    });
    expect(l.dividends[0].amount).toBe(5);
  });

  it('pays the sample’s holders from the fixture dividends', () => {
    const divs = fixtureDividends();
    const l = runLedger(sampleTransactions(), fixtureSplits(), { method: 'average', dividends: divs });
    // VZ: 10 shares since 2021-03-23, never sold.
    const vz = divs.filter((d) => d.ticker === 'VZ' && d.exDate > '2021-03-23').reduce((a, d) => a + d.amount * 10, 0);
    expect(l.dividendsByTicker.get('VZ')).toBeCloseTo(vz, 9);
    // F: 40 shares bought 2021-04-13.
    const f = divs.filter((d) => d.ticker === 'F' && d.exDate > '2021-04-13').reduce((a, d) => a + d.amount * 40, 0);
    expect(l.dividendsByTicker.get('F')).toBeCloseTo(f, 9);
    // Non-payers get nothing.
    expect(l.dividendsByTicker.get('TSLA')).toBeUndefined();
    expect(l.dividends.every((d) => d.amount > 0)).toBe(true);
  });
});

describe('dividendsByYear', () => {
  it('groups income by calendar year of the ex-date, newest first', () => {
    const l = runLedger([tx('2023-01-02', 'Buy', 10)], [], { method: 'average', dividends: [div('2023-06-01', 1), div('2024-02-01', 0.5), div('2024-08-01', 0.5)] });
    expect(dividendsByYear(l.dividends)).toEqual([
      { year: 2024, total: 10, byTicker: [{ ticker: 'AAA', amount: 10 }] },
      { year: 2023, total: 10, byTicker: [{ ticker: 'AAA', amount: 10 }] },
    ]);
  });
});
