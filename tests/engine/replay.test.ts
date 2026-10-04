import { describe, expect, it } from 'vitest';
import { orderEvents, type ReplayEvent } from '../../src/engine/replay.ts';
import type { Transaction } from '../../src/engine/types.ts';
import { readJson, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');

function tx(seq: number, date: string, type: 'Buy' | 'Sell', shares: number, price = 10, ticker = 'AAA'): Transaction {
  return { id: seq, seq, ticker, type, shares, price, date, account: 'Main' };
}

/** Minimal share counter so the ordering rule can be observed directly. */
function sharesAfter(events: ReplayEvent[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const e of events) {
    if (e.kind === 'split') s[e.ticker] = (s[e.ticker] ?? 0) * e.ratio;
    else if (e.kind === 'trade') s[e.tx.ticker] = (s[e.tx.ticker] ?? 0) + (e.tx.type === 'Buy' ? e.tx.shares : -e.tx.shares);
  }
  return s;
}

describe('orderEvents', () => {
  it('orders the sample by date, then split before trade, then seq', () => {
    const events = orderEvents(sampleTransactions(), expected.splitsKnownToSheet);
    const keys = events.map((e) => (e.kind === 'trade' ? `${e.date} ${e.tx.seq}` : `${e.date} ${e.kind} ${e.ticker}`));
    expect(keys).toEqual([
      '2020-03-10 1',
      '2020-04-14 2',
      '2020-04-14 3',
      '2021-03-16 4',
      '2021-03-16 5',
      '2021-03-23 6',
      '2021-03-23 7',
      '2021-04-13 8',
      '2021-04-13 9',
      '2021-08-24 10',
      '2021-08-24 11',
      '2022-06-27 12',
      // The sample has the split row after the ZM buy; the split still goes first.
      '2022-06-29 split SHOP',
      '2022-06-29 13',
      '2022-07-06 15',
    ]);
  });

  it('uses seq, not input order, to break same-day ties', () => {
    const events = orderEvents([tx(2, '2024-01-02', 'Sell', 1), tx(1, '2024-01-02', 'Buy', 5)], []);
    expect(events.map((e) => (e.kind === 'trade' ? e.tx.seq : 0))).toEqual([1, 2]);
  });

  it('applies a split before a trade dated on its ex-date (review focus 2)', () => {
    const splits = [{ ticker: 'AAA', exDate: '2024-03-01', ratio: 10 }];
    // Bought the day before: multiplied. Bought on the ex-date: already post-split.
    expect(sharesAfter(orderEvents([tx(1, '2024-02-29', 'Buy', 2)], splits)).AAA).toBe(20);
    expect(sharesAfter(orderEvents([tx(1, '2024-03-01', 'Buy', 2)], splits)).AAA).toBe(2);
    expect(sharesAfter(orderEvents([tx(1, '2024-02-29', 'Buy', 2), tx(2, '2024-03-01', 'Buy', 5)], splits)).AAA).toBe(25);
  });

  it('can stop at an as-of date (inclusive)', () => {
    const splits = [{ ticker: 'AAA', exDate: '2024-03-01', ratio: 2 }];
    const txs = [tx(1, '2024-02-01', 'Buy', 1), tx(2, '2024-03-01', 'Buy', 1), tx(3, '2024-03-02', 'Buy', 1)];
    expect(sharesAfter(orderEvents(txs, splits, '2024-02-29')).AAA).toBe(1);
    expect(sharesAfter(orderEvents(txs, splits, '2024-03-01')).AAA).toBe(3);
  });
});
