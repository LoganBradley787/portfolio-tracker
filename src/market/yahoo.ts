// Yahoo Finance's public search endpoint; unofficial and undocumented, so every field is checked.
// Used only for a company's name and sector and a fund's sector breakdown, which Tiingo's free tier does not give.
import type { FundBreakdown } from '../engine/allocation.ts';

export interface CompanyProfile {
  name: string | null;
  sector: string;
}

export interface ProfileProvider {
  /** Null when the symbol is unknown or has no sector (funds, delisted companies). */
  profile(symbol: string): Promise<CompanyProfile | null>;
}

export interface FundSectorProvider {
  /** Null when Yahoo has no breakdown for the symbol (not a fund, or unknown). */
  fundBreakdown(symbol: string): Promise<FundBreakdown | null>;
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

/** Yahoo's keys for the sectors, under the names its search gives for a company. */
const SECTOR_NAMES: Record<string, string> = {
  realestate: 'Real Estate',
  consumer_cyclical: 'Consumer Cyclical',
  basic_materials: 'Basic Materials',
  consumer_defensive: 'Consumer Defensive',
  technology: 'Technology',
  communication_services: 'Communication Services',
  financial_services: 'Financial Services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
};

const fraction = (value: unknown, what: string): number => {
  const raw = (value as { raw?: unknown } | null | undefined)?.raw;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1.0001) throw new Error(`Yahoo fund breakdown has no valid ${what}`);
  return Math.min(raw, 1);
};

/**
 * The `topHoldings` module of quoteSummary. Sector weights describe only the stock
 * part of the fund, so a bond fund can read "100% Energy" on a sliver of stock;
 * the stock and bond positions say how much of the fund that really is.
 */
export function mapYahooFundBreakdown(json: unknown): FundBreakdown | null {
  const summary = (json as { quoteSummary?: { result?: unknown } } | null)?.quoteSummary;
  if (!summary) throw new Error('Yahoo returned no quote summary');
  const top = Array.isArray(summary.result) ? (summary.result[0] as { topHoldings?: Record<string, unknown> } | undefined)?.topHoldings : null;
  if (!top) return null;
  if (!Array.isArray(top.sectorWeightings)) throw new Error('Yahoo fund breakdown has no sector weightings');
  const sectors: Record<string, number> = {};
  for (const entry of top.sectorWeightings) {
    for (const [key, value] of Object.entries((entry ?? {}) as Record<string, unknown>)) {
      const weight = fraction(value, `weight for ${key}`);
      if (weight > 0) sectors[SECTOR_NAMES[key] ?? key] = weight;
    }
  }
  return { stock: fraction(top.stockPosition, 'stock position'), bond: fraction(top.bondPosition, 'bond position'), sectors };
}

const BROWSER = { 'User-Agent': 'Mozilla/5.0' };

export class YahooProfileProvider implements ProfileProvider, FundSectorProvider {
  /** quoteSummary wants a cookie and a token ("crumb") issued for it; both are reused until refused. */
  private session: { cookie: string; crumb: string } | null = null;

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async profile(symbol: string): Promise<CompanyProfile | null> {
    const response = await this.fetchFn(searchUrl(symbol), {
      // Yahoo turns away requests without a browser-like agent.
      headers: { Accept: 'application/json', ...BROWSER }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Yahoo search request failed (${response.status})`);
    return mapYahooSearch(await response.json(), symbol);
  }

  async fundBreakdown(symbol: string): Promise<FundBreakdown | null> {
    let response = await this.summary(symbol);
    if (response.status === 401) {
      this.session = null;
      response = await this.summary(symbol);
    }
    // 404 is Yahoo's answer for a symbol with no fund data.
    if (!response.ok && response.status !== 404) throw new Error(`Yahoo fund breakdown request failed (${response.status})`);
    return mapYahooFundBreakdown(await response.json());
  }

  private async summary(symbol: string): Promise<Response> {
    const { cookie, crumb } = this.session ??= await this.openSession();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings&crumb=${encodeURIComponent(crumb)}`;
    return this.fetchFn(url, { headers: { Accept: 'application/json', Cookie: cookie, ...BROWSER }, signal: AbortSignal.timeout(15_000) });
  }

  private async openSession(): Promise<{ cookie: string; crumb: string }> {
    // This page answers 404 but sets the cookie the crumb is tied to.
    const first = await this.fetchFn('https://fc.yahoo.com', { headers: BROWSER, signal: AbortSignal.timeout(15_000) });
    const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('Yahoo gave no session cookie');
    const second = await this.fetchFn('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { Cookie: cookie, ...BROWSER }, signal: AbortSignal.timeout(15_000),
    });
    const crumb = (await second.text()).trim();
    if (!second.ok || !crumb || crumb.length > 40) throw new Error(`Yahoo gave no crumb (${second.status})`);
    return { cookie, crumb };
  }
}
