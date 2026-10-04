// Public issuer website endpoints; undocumented, so validate before caching.
import { exposureSymbol, type FundHolding, type FundSnapshot } from '../engine/exposure.ts';

export const VANGUARD_FUNDS: Record<string, { id: string; name: string }> = {
  VOO: { id: '0968', name: 'Vanguard S&P 500 ETF' },
  VT: { id: '3141', name: 'Vanguard Total World Stock ETF' },
};

export function holdingsUrl(ticker: string): string {
  const fund = VANGUARD_FUNDS[ticker];
  if (!fund) throw new Error(`Unsupported fund: ${ticker}`);
  return `https://advisors.vanguard.com/investments/products/api/funds/${fund.id}/holdings/latest`;
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function mapVanguardHoldings(json: unknown): FundSnapshot {
  const data = object(json);
  const date = data?.latestEffectiveDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error('Vanguard holdings have no valid effective date');
  }
  const equity = object(data?.[date])?.equity;
  if (!Array.isArray(equity) || !equity.length) throw new Error('Vanguard holdings have no equity array');
  const holdings: FundHolding[] = equity.map((value) => {
    const row = object(value);
    if (!row || typeof row.holdingName !== 'string' || !row.holdingName.trim()) throw new Error('Invalid Vanguard holding name');
    const text = (key: string) => {
      if (row[key] === null || row[key] === undefined) return '';
      if (typeof row[key] !== 'string') throw new Error(`Invalid Vanguard holding ${key}`);
      return row[key].trim();
    };
    const weight = row.percentOfFunds === '' || row.percentOfFunds === null ? null : row.percentOfFunds;
    if (weight !== null && (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100)) {
      throw new Error('Invalid Vanguard holding weight');
    }
    return {
      name: row.holdingName.trim(), ticker: exposureSymbol(text('ticker')),
      country: text('country').toUpperCase(), cusip: text('cusip').toUpperCase(), sedol: text('sedol').toUpperCase(),
      weight: weight === null ? null : (weight as number) / 100,
    };
  });
  // Published weights are rounded; allow up to half a percentage point of excess.
  const sum = holdings.reduce((n, h) => n + (h.weight ?? 0), 0);
  if (!holdings.some((h) => h.weight !== null) || sum > 1.005 + 1e-10) throw new Error('Invalid Vanguard equity allocation');
  return { effectiveDate: date, holdings };
}

export interface FundHoldingsProvider {
  holdings(ticker: string): Promise<FundSnapshot>;
}

export class VanguardHoldingsProvider implements FundHoldingsProvider {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async holdings(ticker: string): Promise<FundSnapshot> {
    const response = await this.fetchFn(holdingsUrl(ticker), {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Vanguard holdings request failed (${response.status})`);
    return mapVanguardHoldings(await response.json());
  }
}
