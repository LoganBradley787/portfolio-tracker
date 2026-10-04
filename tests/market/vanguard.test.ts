import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mapVanguardHoldings, VanguardHoldingsProvider } from '../../src/market/vanguard.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../fixtures/vanguard/voo-holdings.json', import.meta.url), 'utf8'));

describe('Vanguard weighted holdings', () => {
  it('reads the dated equity array and preserves unknown weights without adding reserve arrays', () => {
    const json = fixture();
    json['2026-08-31'].shortTermReserves = [{ holdingName: 'Reserve', percentOfFunds: 100 }];
    const result = mapVanguardHoldings(json);
    expect(result.effectiveDate).toBe('2026-08-31');
    expect(result.holdings).toHaveLength(json['2026-08-31'].equity.length);
    expect(result.holdings[0]).toMatchObject({ name: 'NVIDIA Corp', ticker: 'NVDA', cusip: '67066G104', country: 'US' });
    expect(result.holdings[0].weight).toBeCloseTo(0.0807623, 10);
    expect(result.holdings.find((h) => h.ticker === '2223637D')?.weight).toBeNull();
    expect(result.holdings.find((h) => h.ticker === 'BRK.B')).toBeDefined();
  });

  it.each(['missing-date', 'bad-date', 'missing-equity', 'empty-equity', 'bad-weight', 'overweight', 'missing-name'])('rejects %s instead of replacing a good snapshot', (kind) => {
    const json = fixture();
    const equity = json['2026-08-31'].equity;
    if (kind === 'missing-date') delete json.latestEffectiveDate;
    if (kind === 'bad-date') json.latestEffectiveDate = '2026-02-30';
    if (kind === 'missing-equity') delete json['2026-08-31'].equity;
    if (kind === 'empty-equity') json['2026-08-31'].equity = [];
    if (kind === 'bad-weight') equity[0].percentOfFunds = 'unknown';
    if (kind === 'overweight') equity[0].percentOfFunds = 100;
    if (kind === 'missing-name') delete equity[0].holdingName;
    expect(() => mapVanguardHoldings(json)).toThrow();
  });

  it.each(['ticker', 'country', 'cusip', 'sedol'])('accepts null or missing %s without rejecting the snapshot', (key) => {
    for (const absent of [false, true]) {
      const json = fixture();
      if (absent) delete json['2026-08-31'].equity[0][key];
      else json['2026-08-31'].equity[0][key] = null;
      const first = mapVanguardHoldings(json).holdings[0];
      expect(first[key as 'ticker' | 'country' | 'cusip' | 'sedol']).toBe('');
      expect(first.weight).toBeCloseTo(0.0807623, 10);
    }
  });

  it('allows rounded weights through 100.5% without normalizing, but rejects larger allocations', () => {
    const json = fixture();
    const row = json['2026-08-31'].equity[0];
    json['2026-08-31'].equity = [{ ...row, percentOfFunds: 50 }, { ...row, percentOfFunds: 50.5 }];
    expect(mapVanguardHoldings(json).holdings.map((h) => h.weight)).toEqual([0.5, 0.505]);
    json['2026-08-31'].equity[1].percentOfFunds = 50.50001;
    expect(() => mapVanguardHoldings(json)).toThrow('allocation');
  });

  it('sends only the supported fund ID, with no auth or portfolio information', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture())));
    const provider = new VanguardHoldingsProvider(fetchFn);
    await provider.holdings('VOO');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://advisors.vanguard.com/investments/products/api/funds/0968/holdings/latest');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await expect(provider.holdings('QQQ')).rejects.toThrow('Unsupported');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports HTTP failures', async () => {
    const provider = new VanguardHoldingsProvider(async () => new Response('', { status: 503 }));
    await expect(provider.holdings('VT')).rejects.toThrow('503');
  });
});
