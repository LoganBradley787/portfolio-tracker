import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { summarizeRealized, sortSales } from '../../src/engine/realized.ts';
import type { Transaction } from '../../src/engine/types.ts';
import { readJson, sampleAssetTypes, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');

function tx(seq: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, ticker = 'AAA'): Transaction {
  return { id: seq, seq, ticker, type, shares, price, date, account: 'Main' };
}

describe('realized', () => {
  it('totals the sample’s realized gain and adds unrealized', () => {
    const l = runLedger(sampleTransactions(), expected.splitsKnownToSheet, { method: 'average' });
    const r = summarizeRealized(l.sales, { unrealizedGain: 100, assetTypes: sampleAssetTypes() });
    expect(r.totalGain).toBeCloseTo(expected.totals.totalRealizedGain, 6);
    expect(r.totalProceeds).toBeCloseTo(1524.64, 9);
    expect(r.totalCostRemoved).toBeCloseTo(1353.76, 9);
    expect(r.realizedPlusUnrealized).toBeCloseTo(270.88, 6);
  });

  it('filters by asset type', () => {
    const l = runLedger(sampleTransactions(), expected.splitsKnownToSheet, { method: 'average' });
    expect(summarizeRealized(l.sales, { unrealizedGain: 0, assetTypes: sampleAssetTypes(), assetType: 'ETF' }).sales).toEqual([]);
  });

  it('sorts by date, gain or gain %', () => {
    const l = runLedger(
      [
        tx(1, '2024-01-02', 'Buy', 10, 10, 'A'),
        tx(2, '2024-01-02', 'Buy', 10, 100, 'B'),
        tx(3, '2024-02-01', 'Sell', 1, 15, 'A'), // +5, +50%
        tx(4, '2024-03-01', 'Sell', 1, 110, 'B'), // +10, +10%
      ],
      [],
      { method: 'average' },
    );
    expect(sortSales(l.sales, 'date').map((s) => s.ticker)).toEqual(['B', 'A']);
    expect(sortSales(l.sales, 'gain').map((s) => s.ticker)).toEqual(['B', 'A']);
    expect(sortSales(l.sales, 'gainPct').map((s) => s.ticker)).toEqual(['A', 'B']);
  });
});
