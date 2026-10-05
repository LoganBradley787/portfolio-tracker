import { describe, expect, it } from 'vitest';
import { fundFees } from '../../src/engine/fees.ts';

const holdings = [
  { ticker: 'CHEAP', equity: 100_000, assetType: 'ETF' as const },
  { ticker: 'DEAR', equity: 10_000, assetType: 'ETF' as const },
  { ticker: 'NEWF', equity: 5_000, assetType: 'ETF' as const },
  { ticker: 'CO', equity: 85_000, assetType: 'Stock' as const },
];

describe('fund fees', () => {
  const f = fundFees({ holdings, expenseRatios: { CHEAP: 0.0003, DEAR: 0.0075, NEWF: null, CO: 0.5 } });

  it('charges each fund its ratio and stocks nothing', () => {
    expect(f.rows).toEqual([
      { ticker: 'DEAR', value: 10_000, expenseRatio: 0.0075, annualCost: 75 },
      { ticker: 'CHEAP', value: 100_000, expenseRatio: 0.0003, annualCost: expect.closeTo(30) },
      { ticker: 'NEWF', value: 5_000, expenseRatio: null, annualCost: null },
    ]);
    expect(f.annualCost).toBeCloseTo(105);
    expect(f.coveredValue).toBe(110_000);
    expect(f.portfolioValue).toBe(200_000);
    expect(f.blendedRatio).toBeCloseTo(105 / 200_000);
    expect(f.missing).toEqual(['NEWF']);
  });

  it('compounds the fees against assumed growth', () => {
    expect(f.growth).toBe(0.07);
    expect(f.drag.map((d) => d.years)).toEqual([10, 20, 30]);
    const expected = (n: number) => 100_000 * (1.07 ** n - (1.07 * 0.9997) ** n) + 10_000 * (1.07 ** n - (1.07 * 0.9925) ** n);
    for (const d of f.drag) expect(d.cost).toBeCloseTo(expected(d.years));
    expect(f.drag[2].cost).toBeGreaterThan(f.annualCost * 30);
  });

  it('handles no funds, no ratios and an empty portfolio', () => {
    expect(fundFees({ holdings: [holdings[3]], expenseRatios: {} })).toMatchObject({ rows: [], annualCost: 0, blendedRatio: 0, missing: [] });
    expect(fundFees({ holdings: [holdings[2]], expenseRatios: {} })).toMatchObject({ annualCost: 0, coveredValue: 0, missing: ['NEWF'] });
    expect(fundFees({ holdings: [], expenseRatios: {} })).toMatchObject({ rows: [], blendedRatio: null, drag: [{ years: 10, cost: 0 }, { years: 20, cost: 0 }, { years: 30, cost: 0 }] });
  });
});
