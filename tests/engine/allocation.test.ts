import { describe, expect, it } from 'vitest';
import { allocation } from '../../src/engine/allocation.ts';

const h = (ticker: string, equity: number, assetType: 'Stock' | 'ETF' = 'Stock') => ({ ticker, equity, assetType });

describe('allocation', () => {
  const holdings = [h('AAA', 500), h('BBB', 300), h('QQQM', 150, 'ETF'), h('CCC', 50)];
  const sectors = { AAA: 'Technology', BBB: 'Technology', QQQM: 'Ignored for ETFs' };
  const a = allocation(holdings, sectors);

  it('by position, largest first, shares summing to 1', () => {
    expect(a.byPosition.map((x) => [x.label, x.value, x.pct])).toEqual([
      ['AAA', 500, 0.5],
      ['BBB', 300, 0.3],
      ['QQQM', 150, 0.15],
      ['CCC', 50, 0.05],
    ]);
  });

  it('by asset type', () => {
    expect(a.byAssetType.map((x) => [x.label, x.value])).toEqual([
      ['Stocks', 850],
      ['ETFs', 150],
    ]);
  });

  it('by sector: ETFs are their own group, unset sector is Unassigned', () => {
    expect(a.bySector.map((x) => [x.label, x.value, x.count])).toEqual([
      ['Technology', 800, 2],
      ['ETFs', 150, 1],
      ['Unassigned', 50, 1],
    ]);
  });

  it('handles an empty portfolio', () => {
    expect(allocation([], {})).toEqual({ byPosition: [], byAssetType: [], bySector: [] });
  });
});
