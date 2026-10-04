// Tiingo provider: pure response mapping plus a thin fetch wrapper.
// The key travels only in the Authorization header, never in a URL.
import {
  ProviderError,
  type HistoryResult,
  type MarketDataProvider,
  type MetaResult,
  type QuoteResult,
} from './provider.ts';

const BASE = 'https://api.tiingo.com';

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/** Tiingo writes share classes with a dash (BRK-B), not a dot. */
export function tiingoSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-');
}

export function mapHistory(json: unknown): HistoryResult {
  if (!Array.isArray(json)) throw new ProviderError('provider', 'Unexpected history response');
  const out: HistoryResult = { bars: [], splits: [], dividends: [] };
  for (const r of json as any[]) {
    const date = String(r.date).slice(0, 10);
    if (typeof r.close === 'number') out.bars.push({ date, close: r.close });
    if (typeof r.splitFactor === 'number' && r.splitFactor !== 1 && r.splitFactor > 0) out.splits.push({ exDate: date, ratio: r.splitFactor });
    if (typeof r.divCash === 'number' && r.divCash !== 0) out.dividends.push({ exDate: date, amount: r.divCash });
  }
  out.bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

/** `last` is null on the free tier, so `tngoLast` comes first. */
export function mapQuotes(json: unknown): QuoteResult[] {
  if (!Array.isArray(json)) throw new ProviderError('provider', 'Unexpected quote response');
  const out: QuoteResult[] = [];
  for (const r of json as any[]) {
    const last = typeof r.tngoLast === 'number' ? r.tngoLast : typeof r.last === 'number' ? r.last : null;
    if (last === null || !r.ticker) continue;
    out.push({
      symbol: String(r.ticker).toUpperCase(),
      last,
      prevClose: typeof r.prevClose === 'number' ? r.prevClose : null,
      asOf: String(r.timestamp ?? ''),
    });
  }
  return out;
}

export function mapMeta(json: any): MetaResult {
  return {
    symbol: String(json?.ticker ?? '').toUpperCase(),
    name: json?.name ?? null,
    startDate: json?.startDate ?? null,
    endDate: json?.endDate ?? null,
    resolved: json?.startDate != null,
  };
}

export class TiingoProvider implements MarketDataProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly timeoutMs = 30_000,
  ) {}

  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(BASE + path, {
        headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ProviderError('network', `Could not reach Tiingo: ${(e as Error).message}`);
    }
    if (res.status === 404) throw new ProviderError('not-found', 'Not found', 404);
    if (res.status === 429) throw new ProviderError('rate-limit', 'Tiingo rate limit reached', 429);
    if (res.status === 401 || res.status === 403) throw new ProviderError('auth', 'Tiingo rejected the API key', res.status);
    if (!res.ok) throw new ProviderError('provider', `Tiingo returned HTTP ${res.status}`, res.status);
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError('provider', 'Tiingo returned something that is not JSON', res.status);
    }
    // Tiingo sometimes answers 200 with {"detail": "..."} for errors.
    if (json && !Array.isArray(json) && typeof json.detail === 'string') {
      const d = json.detail.toLowerCase();
      if (d.includes('not found')) throw new ProviderError('not-found', json.detail, res.status);
      if (d.includes('limit')) throw new ProviderError('rate-limit', json.detail, res.status);
      if (d.includes('token') || d.includes('auth')) throw new ProviderError('auth', json.detail, res.status);
      throw new ProviderError('provider', json.detail, res.status);
    }
    return json;
  }

  async history(symbol: string, start: string, end?: string): Promise<HistoryResult> {
    const q = new URLSearchParams({ startDate: start });
    if (end) q.set('endDate', end);
    return mapHistory(await this.get(`/tiingo/daily/${encodeURIComponent(tiingoSymbol(symbol))}/prices?${q}`));
  }

  async quotes(symbols: string[]): Promise<QuoteResult[]> {
    if (!symbols.length) return [];
    const q = new URLSearchParams({ tickers: symbols.map(tiingoSymbol).join(',') });
    return mapQuotes(await this.get(`/iex/?${q}`));
  }

  async meta(symbol: string): Promise<MetaResult> {
    return mapMeta(await this.get(`/tiingo/daily/${encodeURIComponent(tiingoSymbol(symbol))}`));
  }
}
