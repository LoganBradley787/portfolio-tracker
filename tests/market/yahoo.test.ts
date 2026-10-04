import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapYahooFundBreakdown, mapYahooSearch, searchUrl, YahooProfileProvider } from '../../src/market/yahoo.ts';
import { FIXTURES } from '../helpers/fixtures.ts';

const recorded = JSON.parse(readFileSync(join(FIXTURES, 'yahoo', 'search_TSLA.json'), 'utf8'));

describe('Yahoo company profile', () => {
  it('reads the name and sector of the exact symbol from a recorded response', () => {
    expect(mapYahooSearch(recorded, 'TSLA')).toEqual({ name: 'Tesla, Inc.', sector: 'Consumer Cyclical' });
    expect(mapYahooSearch(recorded, 'tsla')).toEqual({ name: 'Tesla, Inc.', sector: 'Consumer Cyclical' });
  });

  it('ignores lookalike results, funds and results without a sector', () => {
    expect(mapYahooSearch(recorded, 'TSL')).toBeNull();
    expect(mapYahooSearch(recorded, 'TSLL')).toBeNull(); // an ETF in the same response
    expect(mapYahooSearch({ quotes: [{ symbol: 'XYZ', quoteType: 'EQUITY', longname: 'Example' }] }, 'XYZ')).toBeNull();
    expect(mapYahooSearch({ quotes: [] }, 'XYZ')).toBeNull();
  });

  it('rejects a response that is not a search result', () => {
    expect(() => mapYahooSearch({ error: 'nope' }, 'XYZ')).toThrow('no quotes array');
    expect(() => mapYahooSearch(null, 'XYZ')).toThrow('no quotes array');
  });

  it('requests the escaped symbol and reports a failed request', async () => {
    expect(searchUrl('BRK-B')).toContain('q=BRK-B&');
    expect(searchUrl('A B')).toContain('q=A%20B&');
    const ok = vi.fn(async () => new Response(JSON.stringify(recorded)));
    expect(await new YahooProfileProvider(ok as unknown as typeof fetch).profile('TSLA')).toMatchObject({ sector: 'Consumer Cyclical' });
    const down = vi.fn(async () => new Response('', { status: 429 }));
    await expect(new YahooProfileProvider(down as unknown as typeof fetch).profile('TSLA')).rejects.toThrow('429');
  });
});

const fund = JSON.parse(readFileSync(join(FIXTURES, 'yahoo', 'topHoldings_VOO.json'), 'utf8'));
const position = (raw: number) => ({ raw });
const summary = (topHoldings: unknown) => ({ quoteSummary: { result: [{ topHoldings }], error: null } });

describe('Yahoo fund breakdown', () => {
  it('reads positions and named sector weights from a recorded response', () => {
    const b = mapYahooFundBreakdown(fund)!;
    expect(b.stock).toBeCloseTo(0.9987);
    expect(b.bond).toBe(0);
    expect(Object.keys(b.sectors).sort()).toEqual([
      'Basic Materials', 'Communication Services', 'Consumer Cyclical', 'Consumer Defensive', 'Energy',
      'Financial Services', 'Healthcare', 'Industrials', 'Real Estate', 'Technology', 'Utilities',
    ]);
    expect(Object.values(b.sectors).reduce((n, w) => n + w, 0)).toBeCloseTo(1, 2);
  });

  it('drops zero weights and keeps a sector key it does not know', () => {
    const b = mapYahooFundBreakdown(summary({
      stockPosition: position(0.002), bondPosition: position(0.99),
      sectorWeightings: [{ energy: position(1) }, { technology: position(0) }, { new_sector: position(0.1) }],
    }));
    expect(b).toEqual({ stock: 0.002, bond: 0.99, sectors: { Energy: 1, new_sector: 0.1 } });
  });

  it('returns null for a symbol with no fund data', () => {
    expect(mapYahooFundBreakdown({ quoteSummary: { result: null, error: { code: 'Not Found' } } })).toBeNull();
  });

  it('rejects a malformed breakdown', () => {
    expect(() => mapYahooFundBreakdown({ finance: { error: 'Invalid Crumb' } })).toThrow('no quote summary');
    expect(() => mapYahooFundBreakdown(summary({ stockPosition: position(1), bondPosition: position(0) }))).toThrow('sector weightings');
    expect(() => mapYahooFundBreakdown(summary({ stockPosition: position(7), bondPosition: position(0), sectorWeightings: [] }))).toThrow('stock position');
    expect(() => mapYahooFundBreakdown(summary({ stockPosition: position(1), sectorWeightings: [] }))).toThrow('bond position');
  });

  it('opens a session once, sends the cookie and crumb, and reopens it when refused', async () => {
    let crumbs = 0;
    const seen: { url: string; cookie: string | null }[] = [];
    const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, cookie: new Headers(init?.headers).get('Cookie') });
      if (url === 'https://fc.yahoo.com') return new Response('', { status: 404, headers: { 'Set-Cookie': 'A3=abc; Path=/; Secure' } });
      if (url.endsWith('/getcrumb')) return new Response(`crumb${++crumbs}`);
      return url.includes('crumb=crumb1') && crumbs === 1 && seen.filter((s) => s.url.includes('quoteSummary')).length > 2
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify(fund));
    });
    const yahoo = new YahooProfileProvider(fetchFn as unknown as typeof fetch);
    expect(await yahoo.fundBreakdown('VOO')).toMatchObject({ bond: 0 });
    expect(await yahoo.fundBreakdown('VT')).toMatchObject({ bond: 0 });
    expect(crumbs).toBe(1); // session reused
    expect(seen.at(-1)).toEqual({ url: expect.stringContaining('/quoteSummary/VT?modules=topHoldings&crumb=crumb1'), cookie: 'A3=abc' });
    expect(await yahoo.fundBreakdown('QQQ')).toMatchObject({ bond: 0 }); // third summary call is refused once
    expect(crumbs).toBe(2);
    expect(seen.at(-1)!.url).toContain('crumb=crumb2');
  });

  it('reports a failed request', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      const url = String(input);
      if (url === 'https://fc.yahoo.com') return new Response('', { headers: { 'Set-Cookie': 'A3=abc' } });
      if (url.endsWith('/getcrumb')) return new Response('crumb');
      return new Response('', { status: 500 });
    });
    await expect(new YahooProfileProvider(fetchFn as unknown as typeof fetch).fundBreakdown('VOO')).rejects.toThrow('500');
  });
});
