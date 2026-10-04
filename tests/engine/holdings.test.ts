import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { computeHoldings, resolvePrice } from '../../src/engine/holdings.ts';
import type { PricePoint } from '../../src/engine/holdings.ts';
import type { Transaction } from '../../src/engine/types.ts';
import { readJson, sampleAssetTypes, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');

function tx(seq: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, ticker = 'AAA'): Transaction {
  return { id: seq, seq, ticker, type, shares, price, date, account: 'Main' };
}

describe('resolvePrice', () => {
  const bars = [
    { date: '2022-06-27', close: 373.21 },
    { date: '2022-06-28', close: 350.26 },
    { date: '2022-06-29', close: 33.05 },
  ];
  const splits = [{ ticker: 'SHOP', exDate: '2022-06-29', ratio: 10 }];

  it('uses the last bar and adjusts the previous close for a split on that bar', () => {
    const p = resolvePrice('SHOP', bars, null, splits)!;
    expect(p.source).toBe('close');
    expect(p.price).toBe(33.05);
    expect(p.prevClose).toBeCloseTo(35.026, 9);
    expect(p.asOf).toBe('2022-06-29');
  });

  it('prefers a quote newer than the last bar', () => {
    const p = resolvePrice('SHOP', bars, { last: 34, prevClose: 33.05, asOf: '2022-06-30T12:00:00-04:00' }, splits)!;
    expect(p).toMatchObject({ source: 'quote', price: 34, prevClose: 33.05 });
  });

  it('prefers the daily bar once it exists for the quote’s day', () => {
    const p = resolvePrice('SHOP', bars, { last: 34, prevClose: 35, asOf: '2022-06-29T15:00:00-04:00' }, splits)!;
    expect(p.source).toBe('close');
  });

  it('returns null with no bars and no quote', () => {
    expect(resolvePrice('SQ', [], null, [])).toBeNull();
  });
});

describe('computeHoldings', () => {
  const ledger = runLedger(sampleTransactions(), expected.splitsKnownToSheet, { method: 'average' });

  // Flat prices: each ticker priced at its own average cost, prev close 1% lower.
  function flatPrices(): Record<string, PricePoint> {
    const out: Record<string, PricePoint> = {};
    for (const [t, p] of ledger.positions) {
      const avg = p.cost / p.shares;
      out[t] = { price: avg, prevClose: avg / 1.01, asOf: '2026-10-01', source: 'close' };
    }
    return out;
  }

  it('gives the sheet’s per-holding numbers and sensible totals', () => {
    const prices = flatPrices();
    prices.DIS = { price: 100, prevClose: 99, asOf: '2026-10-01', source: 'close' };
    const r = computeHoldings({ positions: ledger.positions, prices, assetTypes: sampleAssetTypes(), statuses: {} });
    const dis = r.holdings.find((h) => h.ticker === 'DIS')!;
    expect(dis.shares).toBe(39);
    expect(dis.totalCost).toBeCloseTo(4562.7, 6);
    expect(dis.avgCost).toBeCloseTo(116.9923077, 6);
    expect(dis.equity).toBeCloseTo(3900, 9);
    expect(dis.gain).toBeCloseTo(3900 - 4562.7, 9);
    expect(dis.gainPct).toBeCloseTo((3900 - 4562.7) / 4562.7, 9);
    expect(dis.status).toBe('Loss');
    expect(dis.dayChange).toBeCloseTo(39, 9);
    expect(dis.dayChangePct).toBeCloseTo(1 / 99, 9);
    expect(r.totals.cost).toBeCloseTo(12627.46, 6);
    const equitySum = r.holdings.reduce((a, h) => a + h.equity, 0);
    expect(r.totals.equity).toBeCloseTo(equitySum, 9);
    expect(r.holdings.reduce((a, h) => a + h.pctOfEquity, 0)).toBeCloseTo(1, 9);
    expect(r.holdings.reduce((a, h) => a + h.pctOfCost, 0)).toBeCloseTo(1, 9);
    expect(r.totals.counts).toEqual({ gain: 0, loss: 1, neutral: 9 });
  });

  it('filters by asset type before computing shares of total', () => {
    const r = computeHoldings({
      positions: ledger.positions,
      prices: flatPrices(),
      assetTypes: sampleAssetTypes(),
      statuses: {},
      assetType: 'ETF',
    });
    expect(r.holdings.map((h) => h.ticker)).toEqual(['QQQM']);
    expect(r.holdings[0].pctOfEquity).toBe(1);
    expect(r.totals.cost).toBeCloseTo(831.32, 9);
  });

  it('values an unresolved ticker with no price at average cost and flags it (review focus 3)', () => {
    const l = runLedger([tx(1, '2021-01-04', 'Buy', 10, 50, 'SQ')], [], { method: 'average' });
    const r = computeHoldings({ positions: l.positions, prices: {}, assetTypes: { SQ: 'Stock' }, statuses: { SQ: 'unresolved' } });
    expect(r.holdings[0]).toMatchObject({ ticker: 'SQ', price: 50, equity: 500, gain: 0, dayChange: 0, priceSource: 'cost', flag: 'unresolved' });
  });

  it('values an unresolved ticker with stored closes at its last close, flagged, with no day change', () => {
    const l = runLedger([tx(1, '2021-01-04', 'Buy', 10, 50, 'TWTR')], [], { method: 'average' });
    const r = computeHoldings({
      positions: l.positions,
      prices: { TWTR: { price: 5.5, prevClose: 5.4, asOf: '2025-02-28', source: 'close' } },
      assetTypes: {},
      statuses: { TWTR: 'unresolved' },
    });
    expect(r.holdings[0]).toMatchObject({ price: 5.5, equity: 55, dayChange: 0, flag: 'unresolved' });
  });

  it('uses the ±5% neutral band', () => {
    const l = runLedger(
      [tx(1, '2024-01-02', 'Buy', 1, 100, 'A'), tx(2, '2024-01-02', 'Buy', 1, 100, 'B'), tx(3, '2024-01-02', 'Buy', 1, 100, 'C')],
      [],
      { method: 'average' },
    );
    const at = (price: number): PricePoint => ({ price, prevClose: price, asOf: '2024-02-01', source: 'close' });
    const r = computeHoldings({ positions: l.positions, prices: { A: at(105.5), B: at(104.9), C: at(90) }, assetTypes: {}, statuses: {} });
    expect(Object.fromEntries(r.holdings.map((h) => [h.ticker, h.status]))).toEqual({ A: 'Gain', B: 'Neutral', C: 'Loss' });
    expect(r.totals.counts).toEqual({ gain: 1, loss: 1, neutral: 1 });
  });

  it('returns zeroed totals for an empty portfolio', () => {
    const r = computeHoldings({ positions: new Map(), prices: {}, assetTypes: {}, statuses: {} });
    expect(r.holdings).toEqual([]);
    expect(r.totals).toMatchObject({ equity: 0, cost: 0, gain: 0, gainPct: 0, dayChange: 0, dayChangePct: 0 });
  });
});
