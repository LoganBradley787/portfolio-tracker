// Realized gains: the list of sales and their totals (spec 7.4).
import type { DividendEvent, Sale } from './costBasis.ts';
import type { AssetType } from './types.ts';
import { addDays } from './dates.ts';

export type SaleSort = 'date' | 'gain' | 'gainPct';

export interface RealizedSummary {
  sales: Sale[];
  totalProceeds: number;
  totalCostRemoved: number;
  totalGain: number;
  realizedPlusUnrealized: number;
  /** Dividend income, all time. */
  dividends: number;
  /** Realized + unrealized + dividends. */
  totalReturn: number;
}

export function summarizeRealized(
  sales: Sale[],
  opts: { unrealizedGain: number; assetTypes: Record<string, AssetType>; assetType?: AssetType; sort?: SaleSort; dividends?: DividendEvent[] },
): RealizedSummary {
  const filtered = opts.assetType ? sales.filter((s) => (opts.assetTypes[s.ticker] ?? 'Stock') === opts.assetType) : sales;
  const totalGain = filtered.reduce((a, s) => a + s.gain, 0);
  const keep = (t: string) => !opts.assetType || (opts.assetTypes[t] ?? 'Stock') === opts.assetType;
  const dividends = (opts.dividends ?? []).filter((d) => keep(d.ticker)).reduce((a, d) => a + d.amount, 0);
  return {
    sales: sortSales(filtered, opts.sort ?? 'date'),
    totalProceeds: filtered.reduce((a, s) => a + s.proceeds, 0),
    totalCostRemoved: filtered.reduce((a, s) => a + s.costRemoved, 0),
    totalGain,
    realizedPlusUnrealized: totalGain + opts.unrealizedGain,
    dividends,
    totalReturn: totalGain + opts.unrealizedGain + dividends,
  };
}

/** Newest first by date; largest first by gain or gain %. */
export function sortSales(sales: Sale[], sort: SaleSort): Sale[] {
  const out = [...sales];
  if (sort === 'date') out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq));
  else out.sort((a, b) => b[sort] - a[sort]);
  return out;
}

// ── Tax years (FIFO only) ──────────────────────────────────────────────

/** First day held more than one year; Feb 29's anniversary is Feb 28. */
export function longTermDate(acquired: string): string {
  const y = Number(acquired.slice(0, 4)) + 1;
  const md = acquired.slice(5) === '02-29' ? '02-28' : acquired.slice(5);
  return addDays(`${y}-${md}`, 1);
}

export function isLongTerm(acquired: string, sold: string): boolean {
  return sold >= longTermDate(acquired);
}

export interface TaxLot {
  saleDate: string;
  ticker: string;
  account: string;
  acquired: string;
  shares: number;
  proceeds: number;
  cost: number;
  gain: number;
  term: 'short' | 'long';
}

export interface TermTotals {
  proceeds: number;
  cost: number;
  gain: number;
}

export interface TaxYear {
  year: number;
  shortTerm: TermTotals;
  longTerm: TermTotals;
  total: number;
  lots: TaxLot[];
}

/** Realized gains per calendar year of sale, split short/long term, newest year first. */
export function taxYears(sales: Sale[]): TaxYear[] {
  const years = new Map<number, TaxYear>();
  for (const s of sales) {
    if (!s.lots) continue;
    const year = Number(s.date.slice(0, 4));
    let y = years.get(year);
    if (!y) {
      years.set(year, (y = { year, shortTerm: { proceeds: 0, cost: 0, gain: 0 }, longTerm: { proceeds: 0, cost: 0, gain: 0 }, total: 0, lots: [] }));
    }
    for (const lot of s.lots) {
      const proceeds = lot.shares * s.price;
      const term = isLongTerm(lot.acquired, s.date) ? 'long' : 'short';
      const bucket = term === 'long' ? y.longTerm : y.shortTerm;
      bucket.proceeds += proceeds;
      bucket.cost += lot.cost;
      bucket.gain += proceeds - lot.cost;
      y.total += proceeds - lot.cost;
      y.lots.push({ saleDate: s.date, ticker: s.ticker, account: s.account, acquired: lot.acquired, shares: lot.shares, proceeds, cost: lot.cost, gain: proceeds - lot.cost, term });
    }
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

export interface DividendYear {
  year: number;
  total: number;
  byTicker: { ticker: string; amount: number }[];
}

/** Dividend income per calendar year of the ex-date, newest year first. */
export function dividendsByYear(events: DividendEvent[]): DividendYear[] {
  const years = new Map<number, Map<string, number>>();
  for (const e of events) {
    const y = Number(e.date.slice(0, 4));
    const m = years.get(y) ?? new Map<string, number>();
    m.set(e.ticker, (m.get(e.ticker) ?? 0) + e.amount);
    years.set(y, m);
  }
  return [...years]
    .sort(([a], [b]) => b - a)
    .map(([year, m]) => ({
      year,
      total: [...m.values()].reduce((a, x) => a + x, 0),
      byTicker: [...m].map(([ticker, amount]) => ({ ticker, amount })).sort((a, b) => b.amount - a.amount),
    }));
}
