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
    expect(allocation([], {})).toEqual({ byPosition: [], byAssetType: [], bySector: [], bySectorSplit: [] });
  });

  describe('funds split into sectors', () => {
    const near = (rows: { label: string; value: number; count: number }[]) => rows.map((x) => [x.label, Math.round(x.value * 100) / 100, x.count]);

    it('spreads a stock fund across its sectors, next to the stocks in them', () => {
      const split = allocation(holdings, sectors, {
        QQQM: { stock: 1, bond: 0, sectors: { Technology: 0.6, Healthcare: 0.4 } },
      }).bySectorSplit;
      expect(near(split)).toEqual([
        ['Technology', 890, 3],
        ['Healthcare', 60, 1],
        ['Unassigned', 50, 1],
      ]);
      expect(split.reduce((n, x) => n + x.pct, 0)).toBeCloseTo(1);
    });

    it('counts only the stock part of a bond fund; the rest is bonds and cash', () => {
      // Sector weights of "100% Energy" on a fund that is 0.2% stock.
      const split = allocation([h('BOND', 10_000, 'ETF')], {}, {
        BOND: { stock: 0.002, bond: 0.99, sectors: { Energy: 1 } },
      }).bySectorSplit;
      expect(near(split)).toEqual([
        ['Bonds', 9900, 1],
        ['Cash and other', 80, 1],
        ['Energy', 20, 1],
      ]);
    });

    it('rescales sector weights that do not sum to 1', () => {
      const split = allocation([h('FUND', 1000, 'ETF')], {}, {
        FUND: { stock: 1, bond: 0, sectors: { Technology: 0.3, Energy: 0.1 } },
      }).bySectorSplit;
      expect(near(split)).toEqual([['Technology', 750, 1], ['Energy', 250, 1]]);
    });

    it('leaves a fund whole when it has no breakdown or no sector weights', () => {
      const split = allocation([h('NEW', 100, 'ETF'), h('ODD', 50, 'ETF')], {}, {
        ODD: { stock: 0.9, bond: 0, sectors: {} },
      }).bySectorSplit;
      expect(near(split)).toEqual([['ETFs', 150, 2]]);
    });

    it('keeps the grouped view unchanged', () => {
      const both = allocation(holdings, sectors, { QQQM: { stock: 1, bond: 0, sectors: { Technology: 1 } } });
      expect(both.bySector).toEqual(a.bySector);
    });
  });
});
