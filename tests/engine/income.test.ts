import { describe, expect, it } from 'vitest';
import { forwardIncome } from '../../src/engine/income.ts';
import type { Dividend } from '../../src/engine/types.ts';

const quarterly = (ticker: string, amount: number, dates: string[]): Dividend[] => dates.map((exDate) => ({ ticker, exDate, amount }));
const TODAY = '2026-10-02';

describe('forward dividend income', () => {
  const dividends = [
    ...quarterly('QTR', 0.5, ['2025-06-10', '2025-09-10', '2025-12-10', '2026-03-10', '2026-06-10', '2026-09-10']),
    ...quarterly('OLD', 1, ['2024-03-01', '2024-06-01']),
    ...quarterly('ONE', 2, ['2026-01-15']),
    { ticker: 'QTR', exDate: '2026-12-10', amount: 9 }, // not yet paid
  ];
  const positions = [
    { ticker: 'QTR', shares: 100, value: 10_000 },
    { ticker: 'OLD', shares: 10, value: 1_000 },
    { ticker: 'ONE', shares: 5, value: 500 },
    { ticker: 'NONE', shares: 1, value: 8_500 },
  ];
  const f = forwardIncome({ positions, dividends, splits: [], today: TODAY });

  it('pays the last twelve months of dividends on the shares held today', () => {
    expect(f.rows.map((r) => r.ticker)).toEqual(['QTR', 'ONE']);
    expect(f.rows[0]).toEqual({ ticker: 'QTR', shares: 100, value: 10_000, perShare: 2, payments: 4, annual: 200, yield: 0.02,
      lastExDate: '2026-09-10', nextExDate: '2026-12-11' });
    expect(f.rows[1]).toMatchObject({ perShare: 2, payments: 1, annual: 10, nextExDate: null });
    expect(f.annual).toBe(210);
    expect(f.value).toBe(20_000);
    expect(f.yield).toBeCloseTo(0.0105);
  });

  it('restates dividends paid before a split', () => {
    const split = forwardIncome({ positions: [{ ticker: 'QTR', shares: 200, value: 10_000 }], dividends,
      splits: [{ ticker: 'QTR', exDate: '2026-04-01', ratio: 2 }, { ticker: 'ONE', exDate: '2026-04-01', ratio: 10 }], today: TODAY });
    expect(split.rows[0].perShare).toBeCloseTo(0.25 + 0.25 + 0.5 + 0.5);
    expect(split.rows[0].annual).toBeCloseTo(300);
  });

  it('expects no next payment once the usual date has passed', () => {
    const late = forwardIncome({ positions: [positions[0]], dividends: dividends.filter((d) => d.exDate < '2026-12-01'), splits: [], today: '2026-12-20' });
    expect(late.rows[0].nextExDate).toBeNull();
  });

  it('handles nothing held and holdings without value', () => {
    expect(forwardIncome({ positions: [], dividends, splits: [], today: TODAY })).toEqual({ rows: [], annual: 0, value: 0, yield: null });
    expect(forwardIncome({ positions: [{ ticker: 'QTR', shares: 1, value: 0 }], dividends, splits: [], today: TODAY }).rows[0].yield).toBeNull();
  });
});
