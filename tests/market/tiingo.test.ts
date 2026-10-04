import { describe, expect, it } from 'vitest';
import { mapHistory, mapMeta, mapQuotes, TiingoProvider, tiingoSymbol } from '../../src/market/tiingo.ts';
import { ProviderError } from '../../src/market/provider.ts';
import { readJson } from '../helpers/fixtures.ts';
import { fakeTiingo } from '../helpers/fakeTiingo.ts';

describe('Tiingo mapping', () => {
  it('maps the SHOP split window to raw closes and one split', () => {
    const r = mapHistory(readJson('tiingo', 'raw_SHOP_split_window.json'));
    expect(r.splits).toEqual([{ exDate: '2022-06-29', ratio: 10 }]);
    const byDate = Object.fromEntries(r.bars.map((b) => [b.date, b.close]));
    expect(byDate['2022-06-28']).toBe(350.26);
    expect(byDate['2022-06-29']).toBe(33.05);
    expect(r.dividends).toEqual([]);
  });

  it('maps both TSLA splits from the full history', () => {
    expect(mapHistory(readJson('tiingo', 'history_TSLA.json')).splits).toEqual([
      { exDate: '2020-08-31', ratio: 5 },
      { exDate: '2022-08-25', ratio: 3 },
    ]);
  });

  it('maps VZ dividends', () => {
    const d = mapHistory(readJson('tiingo', 'history_VZ.json')).dividends;
    expect(d.length).toBe(26);
    expect(d.every((x) => x.amount > 0 && /^\d{4}-\d\d-\d\d$/.test(x.exDate))).toBe(true);
  });

  it('maps IEX quotes using tngoLast (last is null on the free tier)', () => {
    const q = mapQuotes(readJson('tiingo', 'raw_iex_quotes.json'));
    expect(q.find((x) => x.symbol === 'TSLA')).toEqual({
      symbol: 'TSLA',
      last: 371.035,
      prevClose: 354.11,
      asOf: '2026-10-02T12:27:29.568136759-04:00',
    });
    expect(q).toHaveLength(5);
  });

  it('treats null meta dates as unresolved', () => {
    expect(mapMeta(readJson('tiingo', 'meta_SQ.json'))).toMatchObject({ symbol: 'SQ', resolved: false });
    expect(mapMeta(readJson('tiingo', 'meta_XYZ.json'))).toMatchObject({ resolved: true, name: 'Block Inc - Class A' });
    expect(mapMeta(readJson('tiingo', 'meta_TWTR.json'))).toMatchObject({ resolved: true, endDate: '2022-10-28' });
  });

  it('writes share classes with a dash', () => {
    expect(tiingoSymbol('brk.b')).toBe('BRK-B');
  });
});

describe('TiingoProvider', () => {
  it('sends the key as a header and never in the URL', async () => {
    const fake = fakeTiingo();
    const p = new TiingoProvider('secret-key', fake.fetchFn);
    await p.history('SHOP', '2022-06-21', '2022-07-01');
    await p.quotes(['TSLA', 'DIS']);
    await p.meta('XYZ');
    expect(fake.calls).toHaveLength(3);
    for (const c of fake.calls) {
      expect(c.headers.Authorization).toBe('Token secret-key');
      expect(c.url).not.toContain('secret-key');
    }
    expect(fake.calls[0].url).toBe('https://api.tiingo.com/tiingo/daily/SHOP/prices?startDate=2022-06-21&endDate=2022-07-01');
    expect(fake.calls[1].url).toBe('https://api.tiingo.com/iex/?tickers=TSLA%2CDIS');
  });

  it('maps HTTP failures to error kinds', async () => {
    const fake = fakeTiingo({ override: { A: 429, B: 401, C: 500, D: new TypeError('fetch failed') } });
    const p = new TiingoProvider('k', fake.fetchFn);
    const kind = (s: string) => p.history(s, '2024-01-01').catch((e: ProviderError) => e.kind);
    expect(await kind('A')).toBe('rate-limit');
    expect(await kind('B')).toBe('auth');
    expect(await kind('C')).toBe('provider');
    expect(await kind('D')).toBe('network');
    expect(await kind('SQ')).toBe('not-found');
  });
});
