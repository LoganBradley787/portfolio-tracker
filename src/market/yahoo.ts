// Yahoo Finance's public search endpoint; unofficial and undocumented, so every field is checked.
// Used only for a company's name and sector, which Tiingo's free tier does not give.

export interface CompanyProfile {
  name: string | null;
  sector: string;
}

export interface ProfileProvider {
  /** Null when the symbol is unknown or has no sector (funds, delisted companies). */
  profile(symbol: string): Promise<CompanyProfile | null>;
}

export function searchUrl(symbol: string): string {
  return `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The search also returns lookalikes (other listings, leveraged funds); only an exact symbol match counts. */
export function mapYahooSearch(json: unknown, symbol: string): CompanyProfile | null {
  const quotes = (json as { quotes?: unknown } | null)?.quotes;
  if (!Array.isArray(quotes)) throw new Error('Yahoo search returned no quotes array');
  for (const quote of quotes) {
    if (quote === null || typeof quote !== 'object') continue;
    const q = quote as Record<string, unknown>;
    if (text(q.symbol).toUpperCase() !== symbol.toUpperCase() || q.quoteType !== 'EQUITY') continue;
    const sector = text(q.sector);
    if (!sector) return null;
    return { name: text(q.longname) || text(q.shortname) || null, sector };
  }
  return null;
}

export class YahooProfileProvider implements ProfileProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async profile(symbol: string): Promise<CompanyProfile | null> {
    const response = await this.fetchFn(searchUrl(symbol), {
      // Yahoo turns away requests without a browser-like agent.
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Yahoo search request failed (${response.status})`);
    return mapYahooSearch(await response.json(), symbol);
  }
}
