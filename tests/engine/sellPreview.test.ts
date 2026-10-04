import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import { reinvestDividends } from '../../src/engine/drip.ts';
import { previewSale, turningLongTermSoon } from '../../src/engine/sellPreview.ts';
import type { Transaction } from '../../src/engine/types.ts';

const lots = [
  { acquired: '2026-01-01', account: 'A', shares: 4, cost: 120 },
  { acquired: '2025-10-03', account: 'B', shares: 3, cost: 60 },
  { acquired: '2024-01-01', account: 'A', shares: 2, cost: 20 },
];
const tx = (id: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, account = 'A'): Transaction =>
  ({ id, seq: id, ticker: 'AAA', date, type, shares, price, account });

describe('sale preview', () => {
  it('defaults to the largest account and never mixes three accounts, without mutating lots', () => {
    const input = [...lots, { acquired: '2020-01-01', account: 'C', shares: 1, cost: 5 }];
    const before = structuredClone(input);
    const p = previewSale({ lots: input, price: 20, today: '2026-10-03', averageCost: 25 });
    expect(p.shares).toBe(6);
    expect(p.proceeds).toBe(120);
    expect(p.gain).toBe(-20);
    expect(p.averageGain).toBe(-30);
    expect(p.longTerm.gain).toBe(20);
    expect(p.shortTerm.gain).toBe(-40);
    expect(p.lots.map((l) => [l.account, l.acquired])).toEqual([['A', '2024-01-01'], ['A', '2026-01-01']]);
    expect(input).toEqual(before);
  });

  it('previews only the chosen account and caps quantities to its own shares', () => {
    const p = previewSale({ lots, account: 'B', price: 30, today: '2026-10-03', averageCost: 25 });
    expect(p.shares).toBe(3);
    expect(p.gain).toBe(30);
    expect(p.averageGain).toBe(15);
    expect(p.shortTerm.gain).toBe(30); // anniversary itself remains short-term
    expect(p.lots.every((l) => l.account === 'B')).toBe(true);
    expect(() => previewSale({ lots, account: 'B', shares: 3.5, price: 30, today: '2026-10-03' })).toThrow();
  });

  it('consumes a fractional partial lot and reconciles term totals', () => {
    const p = previewSale({ lots, price: 30, today: '2026-10-04', shares: 3.5, averageCost: 25 });
    expect(p.lots.map((l) => l.shares)).toEqual([2, 1.5]);
    expect(p.cost).toBe(65);
    expect(p.gain).toBe(40);
    expect(p.averageGain).toBe(17.5);
    expect(p.shortTerm.gain + p.longTerm.gain).toBe(p.gain);
    expect(p.shortTerm.proceeds + p.longTerm.proceeds).toBe(p.proceeds);
  });

  it.each([0, -1, NaN, Infinity, 9.1])('rejects invalid or excessive shares: %s', (shares) => {
    expect(() => previewSale({ lots, price: 20, today: '2026-10-03', shares })).toThrow();
  });

  it('handles a closed position', () => {
    expect(previewSale({ lots: [], price: 20, today: '2026-10-03' })).toMatchObject({ shares: 0, proceeds: 0, gain: 0, lots: [] });
  });

  it('uses remaining split-adjusted FIFO lots after account-specific sales and excludes future trades', () => {
    const transactions = [tx(1, '2024-01-01', 'Buy', 2, 100), tx(2, '2025-01-01', 'Buy', 3, 40, 'B'),
      tx(3, '2026-01-01', 'Sell', 5, 30), tx(4, '2027-01-01', 'Buy', 100, 1)];
    const splits = [{ ticker: 'AAA', exDate: '2025-06-01', ratio: 10 }];
    const l = runLedger(transactions, splits, { method: 'fifo', asOf: '2026-10-03' });
    const p = previewSale({ lots: l.positions.get('AAA')!.lots!, price: 20, today: '2026-10-03', account: 'A', shares: 15 });
    expect(p.lots.map((l) => [l.account, l.shares, l.cost])).toEqual([['A', 15, 150]]);
  });

  it('counts dividend reinvestments as separate dated lots', () => {
    const drip = reinvestDividends({ transactions: [tx(1, '2024-01-01', 'Buy', 10, 10)], splits: [],
      dividends: [{ ticker: 'AAA', exDate: '2026-01-01', amount: 2 }], bars: { AAA: [{ date: '2026-01-01', close: 20 }] } });
    const l = runLedger(drip.transactions, [], { method: 'fifo' });
    const p = previewSale({ lots: l.positions.get('AAA')!.lots!, price: 30, today: '2026-10-03' });
    expect(p.lots.map((l) => [l.acquired, l.shares, l.term])).toEqual([['2024-01-01', 10, 'long'], ['2026-01-01', 1, 'short']]);
    expect(p.shortTerm.gain).toBe(10);
  });
});

describe('turning long-term soon', () => {
  it('includes tomorrow through day 60, excluding already long-term and day 61', () => {
    const dates = ['2025-10-02', '2025-10-03', '2025-12-01', '2025-12-02'];
    const l = runLedger(dates.map((d, i) => tx(i + 1, d, 'Buy', 2, 10)), [], { method: 'fifo' });
    const rows = turningLongTermSoon({ positions: l.positions, prices: { AAA: 15 }, today: '2026-10-03' });
    expect(rows.map((l) => l.longTermDate)).toEqual(['2026-10-04', '2026-12-02']);
    expect(rows.map((l) => l.gain)).toEqual([10, 10]);
  });

  it('carries reinvestment identity through splits and partial FIFO sales', () => {
    const transactions = [tx(1, '2025-01-01', 'Buy', 1, 10),
      { ...tx(2, '2025-10-03', 'Buy', 0.5, 20), drip: true }, tx(3, '2026-01-01', 'Sell', 2.5, 15)];
    const l = runLedger(transactions, [{ ticker: 'AAA', exDate: '2025-12-01', ratio: 2 }], { method: 'fifo' });
    expect(l.positions.get('AAA')!.lots).toMatchObject([{ acquired: '2025-10-03', shares: 0.5, cost: 5, drip: true }]);
  });

  it('keeps entered lots separate and folds only window reinvestments per ticker/account', () => {
    const transactions = [tx(1, '2025-10-03', 'Buy', 2, 10), tx(2, '2025-10-03', 'Buy', 3, 12),
      { ...tx(3, '2025-10-04', 'Buy', 0.1, 10), drip: true },
      { ...tx(4, '2025-11-01', 'Buy', 0.2, 20), drip: true },
      { ...tx(5, '2025-12-01', 'Buy', 0.3, 30), drip: true },
      { ...tx(6, '2025-12-02', 'Buy', 5, 10), drip: true }, // day 61: excluded
      { ...tx(7, '2025-10-02', 'Buy', 5, 10), drip: true }, // already long-term
      { ...tx(8, '2025-10-04', 'Buy', 0.4, 10, 'B'), drip: true },
      { ...tx(9, '2025-10-04', 'Buy', 0.5, 10), ticker: 'BBB', drip: true }];
    const l = runLedger(transactions, [], { method: 'fifo' });
    const before = structuredClone(l.positions);
    const rows = turningLongTermSoon({ positions: l.positions, prices: { AAA: 40, BBB: 20 }, today: '2026-10-03' });
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => !r.drip).map((r) => r.shares)).toEqual([2, 3]);
    const a = rows.find((r) => r.ticker === 'AAA' && r.account === 'A' && r.drip)!;
    expect(a.reinvestedLots).toBe(3);
    expect(a.shares).toBeCloseTo(0.6);
    expect(a.gain).toBeCloseTo(10);
    expect(a.longTermDate).toBe('2026-10-05');
    expect(a.lastLongTermDate).toBe('2026-12-02');
    expect(rows.find((r) => r.account === 'B')!.reinvestedLots).toBe(1);
    expect(rows.find((r) => r.ticker === 'BBB')!.gain).toBe(5);
    expect(l.positions).toEqual(before);
  });

  it('keeps grouped reinvestment gains unknown without a market price', () => {
    const transactions = ['2025-10-03', '2025-11-01'].map((d, i) => ({ ...tx(i + 1, d, 'Buy', 0.1, 10), drip: true }));
    const l = runLedger(transactions, [], { method: 'fifo' });
    const rows = turningLongTermSoon({ positions: l.positions, prices: {}, today: '2026-10-03' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reinvestedLots: 2, shares: 0.2, gain: null });
  });

  it('uses the leap-day anniversary rule and keeps missing prices unknown', () => {
    const l = runLedger([tx(1, '2024-02-29', 'Buy', 0.5, 20)], [], { method: 'fifo' });
    expect(turningLongTermSoon({ positions: l.positions, prices: {}, today: '2025-02-28' })).toMatchObject([
      { acquired: '2024-02-29', longTermDate: '2025-03-01', shares: 0.5, gain: null },
    ]);
  });
});
