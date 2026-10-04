// A fake `fetch` that answers Tiingo URLs from the recorded fixtures.
import type { FetchFn } from '../../src/market/tiingo.ts';
import { HISTORY_TICKERS, readJson } from './fixtures.ts';

export interface FakeCall {
  url: string;
  headers: Record<string, string>;
}

export interface FakeOptions {
  /** Per-symbol override: a status code to return, a thrown error, or a custom body. */
  override?: Record<string, number | Error | unknown[]>;
  quotesStatus?: number;
}

export function fakeTiingo(opts: FakeOptions = {}) {
  const calls: FakeCall[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (u.pathname === '/iex/') {
      if (opts.quotesStatus) return json({ detail: 'error' }, opts.quotesStatus);
      const wanted = (u.searchParams.get('tickers') ?? '').split(',');
      return json(readJson<any[]>('tiingo', 'raw_iex_quotes.json').filter((r) => wanted.includes(r.ticker)));
    }
    const m = /^\/tiingo\/daily\/([^/]+)(\/prices)?$/.exec(u.pathname);
    if (!m) return json({ detail: 'Not found.' }, 404);
    const symbol = decodeURIComponent(m[1]);
    const o = opts.override?.[symbol];
    if (o instanceof Error) throw o;
    if (typeof o === 'number') return json({ detail: 'error' }, o);
    if (!m[2]) return json(readJson('tiingo', `meta_${symbol}.json`));
    let rows: any[];
    if (Array.isArray(o)) rows = o;
    else if (HISTORY_TICKERS.includes(symbol)) rows = readJson<any[]>('tiingo', `history_${symbol}.json`);
    else return json({ detail: `Error: Ticker '${symbol}' not found` }, 404);
    const start = u.searchParams.get('startDate') ?? '0000';
    const end = u.searchParams.get('endDate') ?? '9999';
    return json(rows.filter((r) => r.date.slice(0, 10) >= start && r.date.slice(0, 10) <= end));
  };
  const historyCalls = () =>
    calls.filter((c) => c.url.includes('/prices')).map((c) => {
      const u = new URL(c.url);
      return { symbol: u.pathname.split('/')[3], start: u.searchParams.get('startDate'), end: u.searchParams.get('endDate') };
    });
  return { fetchFn, calls, historyCalls };
}
