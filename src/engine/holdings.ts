// Holdings and totals as of "now" (spec 7.4, 13.2).
import { splitRatio } from './prices.ts';
import type { Position } from './costBasis.ts';
import type { AssetType, PriceBar, Quote, SecurityStatus, Split } from './types.ts';

export type PriceSource = 'quote' | 'close' | 'cost';

export interface PricePoint {
  price: number;
  /** Previous close on the same share basis as `price`. */
  prevClose: number | null;
  asOf: string;
  source: Exclude<PriceSource, 'cost'>;
}

/**
 * Current price for a ticker from its stored bars (ascending) and latest quote.
 * A quote is used only when it is from a later day than the last bar; once
 * that day's bar exists the bar wins.
 */
export function resolvePrice(ticker: string, bars: PriceBar[], quote: Quote | null, splits: Split[]): PricePoint | null {
  const last = bars.length ? bars[bars.length - 1] : null;
  const ownSplits = splits.filter((s) => s.ticker === ticker);
  const ratioBetween = (after: string, through: string) => splitRatio(ownSplits, after, through);

  if (quote && Number.isFinite(quote.last) && (!last || quote.asOf.slice(0, 10) > last.date)) {
    const prev = quote.prevClose ?? (last ? last.close / ratioBetween(last.date, quote.asOf.slice(0, 10)) : null);
    return { price: quote.last, prevClose: prev, asOf: quote.asOf, source: 'quote' };
  }
  if (!last) return null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  return {
    price: last.close,
    prevClose: prevBar ? prevBar.close / ratioBetween(prevBar.date, last.date) : null,
    asOf: last.date,
    source: 'close',
  };
}

export type GainStatus = 'Gain' | 'Loss' | 'Neutral';
export type HoldingFlag = 'unresolved' | 'pending' | 'no-price' | null;

export const NEUTRAL_BAND = 0.05;

export interface Holding {
  ticker: string;
  assetType: AssetType;
  accounts: string[];
  shares: number;
  avgCost: number;
  totalCost: number;
  price: number;
  priceAsOf: string | null;
  priceSource: PriceSource;
  equity: number;
  gain: number;
  gainPct: number;
  status: GainStatus;
  dayChangePerShare: number;
  dayChange: number;
  dayChangePct: number;
  pctOfEquity: number;
  pctOfCost: number;
  /** Dividends received on this ticker, all time. */
  dividends: number;
  flag: HoldingFlag;
}

export interface HoldingTotals {
  equity: number;
  cost: number;
  gain: number;
  gainPct: number;
  dayChange: number;
  dayChangePct: number;
  counts: { gain: number; loss: number; neutral: number };
  shares: { gain: number; loss: number; neutral: number };
}

export interface HoldingsInput {
  positions: Map<string, Position>;
  prices: Record<string, PricePoint>;
  assetTypes: Record<string, AssetType>;
  statuses: Record<string, SecurityStatus>;
  assetType?: AssetType;
}

export function gainStatus(gainPct: number): GainStatus {
  if (gainPct >= NEUTRAL_BAND) return 'Gain';
  if (gainPct <= -NEUTRAL_BAND) return 'Loss';
  return 'Neutral';
}

export function computeHoldings(input: HoldingsInput): { holdings: Holding[]; totals: HoldingTotals } {
  const rows: Holding[] = [];
  for (const pos of input.positions.values()) {
    const assetType = input.assetTypes[pos.ticker] ?? 'Stock';
    if (input.assetType && assetType !== input.assetType) continue;
    const status = input.statuses[pos.ticker] ?? 'ok';
    const pp = input.prices[pos.ticker];
    const avgCost = pos.cost / pos.shares;
    const price = pp ? pp.price : avgCost;
    // An unresolved ticker's last bar can be years old; its "day change" means nothing.
    const hasDayChange = pp && pp.prevClose != null && status !== 'unresolved';
    const dayChangePerShare = hasDayChange ? pp.price - pp.prevClose! : 0;
    const equity = pos.shares * price;
    const gain = equity - pos.cost;
    const gainPct = pos.cost !== 0 ? gain / pos.cost : 0;
    let flag: HoldingFlag = null;
    if (status === 'unresolved') flag = 'unresolved';
    else if (!pp) flag = status === 'pending' ? 'pending' : 'no-price';
    rows.push({
      ticker: pos.ticker,
      assetType,
      accounts: pos.accounts,
      shares: pos.shares,
      avgCost,
      totalCost: pos.cost,
      price,
      priceAsOf: pp?.asOf ?? null,
      priceSource: pp ? pp.source : 'cost',
      equity,
      gain,
      gainPct,
      status: gainStatus(gainPct),
      dayChangePerShare,
      dayChange: dayChangePerShare * pos.shares,
      dayChangePct: hasDayChange && pp.prevClose ? dayChangePerShare / pp.prevClose : 0,
      pctOfEquity: 0,
      pctOfCost: 0,
      dividends: pos.dividends ?? 0,
      flag,
    });
  }

  const equity = sum(rows.map((h) => h.equity));
  const cost = sum(rows.map((h) => h.totalCost));
  const dayChange = sum(rows.map((h) => h.dayChange));
  for (const h of rows) {
    h.pctOfEquity = equity ? h.equity / equity : 0;
    h.pctOfCost = cost ? h.totalCost / cost : 0;
  }
  rows.sort((a, b) => b.equity - a.equity || (a.ticker < b.ticker ? -1 : 1));

  const counts = { gain: 0, loss: 0, neutral: 0 };
  for (const h of rows) counts[h.status === 'Gain' ? 'gain' : h.status === 'Loss' ? 'loss' : 'neutral']++;
  const n = rows.length || 1;
  const prevEquity = equity - dayChange;
  return {
    holdings: rows,
    totals: {
      equity,
      cost,
      gain: equity - cost,
      gainPct: cost ? (equity - cost) / cost : 0,
      dayChange,
      dayChangePct: prevEquity ? dayChange / prevEquity : 0,
      counts,
      shares: { gain: counts.gain / n, loss: counts.loss / n, neutral: counts.neutral / n },
    },
  };
}

function sum(xs: number[]): number {
  return xs.reduce((a, x) => a + x, 0);
}
