import { describe, expect, it } from 'vitest';
import { computeExposure, type FundHolding, type FundSnapshot, type ExposurePosition } from '../../src/engine/exposure.ts';

const constituent = (ticker: string, weight: number | null, extra: Partial<FundHolding> = {}): FundHolding => ({
  ticker, weight, name: ticker, country: 'US', cusip: ticker, sedol: '', ...extra,
});
const snapshot = (...holdings: FundHolding[]): FundSnapshot => ({ effectiveDate: '2026-08-31', holdings });
const pos = (ticker: string, equity: number, assetType: 'Stock' | 'ETF' = 'Stock'): ExposurePosition => ({ ticker, equity, assetType, flag: null });
const calculate = (holdings: ExposurePosition[], snapshots: Record<string, FundSnapshot> = {}, securities: { ticker: string; providerSymbol: string; name: string | null }[] = []) =>
  computeExposure({ holdings, snapshots, securities, supportedFunds: ['VOO', 'VT'] });

describe('underlying exposure', () => {
  it('combines direct and full ETF exposure with the whole portfolio as denominator', () => {
    const r = calculate([pos('AAPL', 100), pos('VOO', 1000, 'ETF'), pos('VT', 2000, 'ETF'), pos('QQQ', 900, 'ETF')], {
      VOO: snapshot(constituent('AAPL', 0.1), constituent('SMALL', 0.2)),
      VT: snapshot(constituent('AAPL', 0.05)),
    });
    expect(r.rows.find((x) => x.tickers.includes('AAPL'))).toMatchObject({ direct: 100, throughFunds: { VOO: 100, VT: 100 }, total: 300, pctOfPortfolio: 0.075 });
    expect(r.rows.find((x) => x.tickers.includes('SMALL'))?.total).toBe(200);
    expect(r).toMatchObject({ totalValue: 4000, otherValue: 2600, unexpandedValue: 900 });
    expect(r.mappedValue).toBeCloseTo(500, 10);
    expect(r.coverage).toBeCloseTo(0.125, 10);
    expect(r.mappedValue + r.otherValue + r.unexpandedValue).toBeCloseTo(r.totalValue, 10);
    expect(r.rows.some((x) => x.tickers.includes('VOO'))).toBe(false);
  });

  it('merges a unique Canadian SHOP listing into the direct holding', () => {
    const r = calculate([pos('SHOP', 100), pos('VT', 1000, 'ETF')], {
      VT: snapshot(constituent('SHOP', 0.1, { country: 'CA' })),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ direct: 100, throughFunds: { VT: 100 } });
  });

  it('prefers the US listing when a ticker is also used in another country', () => {
    const r = calculate([pos('XYZ', 100), pos('VT', 1000, 'ETF')], {
      VT: snapshot(constituent('XYZ', 0.1, { country: 'CA', cusip: 'CA', name: 'Example Rail' }),
        constituent('XYZ', 0.2, { cusip: 'US', name: 'Example Mining' })),
    });
    expect(r.rows.find((x) => x.direct)).toMatchObject({ name: 'Example Mining', total: 300 });
    expect(r.rows.find((x) => x.name === 'Example Rail')?.direct).toBe(0);
  });

  it('keeps ambiguous non-US ticker matches separate and uncertain', () => {
    const r = calculate([pos('ABC', 100), pos('VT', 1000, 'ETF')], {
      VT: snapshot(constituent('ABC', 0.1, { country: 'CA', cusip: 'CA' }),
        constituent('ABC', 0.2, { country: 'AU', cusip: 'AU' })),
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.direct)?.matching).toBe('uncertain');
  });

  it('expands supported funds even when their asset type defaults to Stock', () => {
    const r = calculate([pos('VOO', 1000), pos('VT', 200)], {
      VOO: snapshot(constituent('AAPL', 0.1)),
    });
    expect(r.rows.map((x) => x.tickers)).toEqual([['AAPL']]);
    expect(r).toMatchObject({ mappedValue: 100, unexpandedValue: 200 });
  });

  it('groups confirmed Alphabet share classes and spelling variants of Berkshire', () => {
    const r = calculate([pos('GOOGL', 100), pos('BRK-B', 50), pos('VOO', 1000, 'ETF')], {
      VOO: snapshot(constituent('GOOG', 0.03, { cusip: '02079K107' }), constituent('GOOGL', 0.04, { cusip: '02079K305' }),
        constituent('BRK.B', 0.02, { cusip: '084670702' })),
    });
    expect(r.rows.find((x) => x.name === 'Alphabet Inc')).toMatchObject({ total: 170, direct: 100, matching: 'company' });
    expect(r.rows.find((x) => x.name === 'Berkshire Hathaway Inc')?.total).toBe(70);
  });

  it('matches security IDs across funds, including multiple listings of the same security', () => {
    const r = calculate([pos('VOO', 1000, 'ETF'), pos('VT', 1000, 'ETF')], {
      VOO: snapshot(constituent('SRE', 0.1, { cusip: '816851109', sedol: '2138158' })),
      VT: snapshot(constituent('SRE*', 0.02, { country: 'MX', cusip: '816851109', sedol: 'BPPWWG5' })),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].total).toBe(120);
    expect(r.rows[0].countries).toEqual(['MX', 'US']);
  });

  it('does not merge international ticker collisions, similar names, or ADRs with local shares', () => {
    const r = calculate([pos('TSM', 100), pos('VOO', 1000, 'ETF'), pos('VT', 1000, 'ETF')], {
      VOO: snapshot(constituent('ABC', 0.1, { name: 'Same company', country: 'CA', cusip: '', sedol: 'ONE' })),
      VT: snapshot(constituent('ABC', 0.2, { name: 'Same company', country: 'AU', cusip: '', sedol: 'TWO' }),
        constituent('2330', 0.03, { name: 'Taiwan Semiconductor', country: 'TW', cusip: '', sedol: '6889106' })),
    });
    expect(r.rows).toHaveLength(4);
    expect(r.rows.filter((x) => x.tickers.includes('ABC')).map((x) => x.total).sort()).toEqual([100, 200]);
    expect(r.rows.find((x) => x.tickers.includes('TSM'))?.throughFunds).toEqual({});
    expect(r.rows.find((x) => x.tickers.includes('2330'))?.matching).toBe('security');
  });

  it('keeps a direct holding separate when its US ticker matches multiple different securities', () => {
    const r = calculate([pos('ABC', 100), pos('VT', 1000, 'ETF')], {
      VT: snapshot(constituent('ABC', 0.1, { cusip: 'ONE' }), constituent('ABC', 0.2, { cusip: 'TWO' })),
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.direct > 0)?.matching).toBe('uncertain');
  });

  it('uses provider aliases to match direct securities and propagates valuation flags', () => {
    const r = calculate([{ ...pos('OLD', 100), flag: 'unresolved' }, { ...pos('VOO', 1000, 'ETF'), flag: 'pending' }], {
      VOO: snapshot(constituent('NEW', 0.1)),
    }, [{ ticker: 'OLD', providerSymbol: 'NEW', name: null }]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].total).toBe(200);
    expect(r.rows[0].valuationWarnings.sort()).toEqual(['OLD: unresolved', 'VOO: pending']);
  });

  it('does not count blank weights as zero or normalize the reported allocation', () => {
    const r = calculate([pos('VOO', 1000, 'ETF'), pos('VT', 200, 'ETF')], {
      VOO: snapshot(constituent('A', 0.5), constituent('UNKNOWN', null), constituent('ZERO', 0)),
    });
    expect(r.funds.find((x) => x.ticker === 'VOO')).toMatchObject({ allocatedValue: 500, otherValue: 500, missingWeights: 1 });
    expect(r.funds.find((x) => x.ticker === 'VT')).toMatchObject({ allocatedValue: 0, unexpandedValue: 200 });
    expect(r.rows.some((x) => x.tickers.includes('UNKNOWN'))).toBe(false);
    expect(r.mappedValue).toBe(500);
  });

  it('preserves rounded weights above 100% and reports the reconciliation surplus', () => {
    const r = calculate([pos('VT', 1000)], {
      VT: snapshot(constituent('A', 0.5), constituent('B', 0.505)),
    });
    expect(r.mappedValue).toBeCloseTo(1005, 10);
    expect(r.roundingExcessValue).toBeCloseTo(5, 10);
    expect(r.funds[0].roundingExcessValue).toBeCloseTo(5, 10);
    expect(r.otherValue).toBe(0);
    expect(r.mappedValue + r.otherValue + r.unexpandedValue - r.roundingExcessValue).toBeCloseTo(r.totalValue, 10);
  });

  it('marks unpublished ETF contributions on an otherwise mapped direct holding', () => {
    const r = calculate([pos('AAPL', 100), pos('VOO', 1000, 'ETF')], {
      VOO: snapshot(constituent('AAPL', null)),
    });
    expect(r.rows[0].unknownThroughFunds).toEqual(['VOO']);
    expect(r.rows[0].contributions).toContainEqual({ kind: 'fund', ticker: 'VOO', security: constituent('AAPL', null), value: null });
    expect(r.rows[0].total).toBe(100); // mapped subtotal, not a claim about the unpublished exposure
    expect(r.otherValue).toBe(1000);
  });

  it('returns honest empty coverage and disregards unheld cached funds', () => {
    expect(calculate([], { VOO: snapshot(constituent('A', 0.5)) })).toMatchObject({ rows: [], funds: [], totalValue: 0, coverage: null });
    expect(calculate([pos('DIRECT', 100)]).coverage).toBe(1);
  });

  it('does not expand unsupported ETFs even if unrelated snapshots were provided', () => {
    const r = calculate([pos('QQQ', 1000, 'ETF')], { QQQ: snapshot(constituent('A', 0.5)) });
    expect(r.rows).toEqual([]);
    expect(r.unexpandedValue).toBe(1000);
  });
});
