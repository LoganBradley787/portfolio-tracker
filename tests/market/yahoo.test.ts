import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mapYahooSearch, searchUrl, YahooProfileProvider } from '../../src/market/yahoo.ts';
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
