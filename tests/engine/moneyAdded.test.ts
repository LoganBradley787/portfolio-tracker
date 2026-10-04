import { describe, expect, it } from 'vitest';
import { moneyAdded } from '../../src/engine/moneyAdded.ts';
import type { Transaction } from '../../src/engine/types.ts';

const tx = (id: number, date: string, type: 'Buy' | 'Sell', shares: number, price: number, drip = false): Transaction =>
  ({ id, seq: id, ticker: 'AAA', account: 'A', date, type, shares, price, drip });

describe('money added over time', () => {
  it('groups buys minus sells by month and year, excluding DRIP buys and future trades', () => {
    const transactions = [tx(1, '2024-12-01', 'Buy', 10, 10), tx(2, '2025-01-01', 'Buy', 5, 20),
      tx(3, '2025-01-02', 'Buy', 1, 20, true), tx(4, '2025-03-01', 'Sell', 4, 30), tx(5, '2026-01-01', 'Buy', 100, 10)];
    const before = structuredClone(transactions);
    const p = moneyAdded({ transactions, splits: [], today: '2025-03-02', value: 360 });
    expect(p.months).toEqual([
      { period: '2024-12', buys: 100, sells: 0, net: 100 }, { period: '2025-01', buys: 100, sells: 0, net: 100 },
      { period: '2025-02', buys: 0, sells: 0, net: 0 }, { period: '2025-03', buys: 0, sells: 120, net: -120 },
    ]);
    expect(p.years).toEqual([{ period: '2024', buys: 100, sells: 0, net: 100 }, { period: '2025', buys: 100, sells: 120, net: -20 }]);
    expect(p.added).toBe(80);
    expect(p.growth).toBe(280);
    expect(p.added + p.growth).toBe(p.value);
    expect(transactions).toEqual(before);
  });

  it('uses split-adjusted actual sales, including sold reinvested shares and clamped oversells', () => {
    const transactions = [tx(1, '2024-01-01', 'Buy', 2, 100), tx(2, '2024-02-01', 'Buy', 0.5, 100, true),
      tx(3, '2025-01-01', 'Sell', 30, 20)];
    const p = moneyAdded({ transactions, splits: [{ ticker: 'AAA', exDate: '2024-12-01', ratio: 10 }], today: '2025-01-01', value: 0 });
    expect(p.added).toBe(-300); // 200 put in, 500 taken out; reinvestment was internal
    expect(p.growth).toBe(300);
  });

  it('permits losses and zero/negative net money added without percentages', () => {
    expect(moneyAdded({ transactions: [tx(1, '2025-01-01', 'Buy', 10, 10)], splits: [], today: '2025-01-01', value: 80 })).toMatchObject({ added: 100, growth: -20 });
  });

  it('handles an empty portfolio', () => {
    expect(moneyAdded({ transactions: [], splits: [], today: '2026-10-03', value: 0 })).toEqual({ months: [], years: [], added: 0, value: 0, growth: 0 });
  });
});
