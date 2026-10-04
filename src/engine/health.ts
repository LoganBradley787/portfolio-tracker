// Pure checks for the data-health page.
import type { PriceBar, Split, Transaction } from './types.ts';

export interface ImportedSplitRow {
  id: number;
  ticker: string;
  exDate: string;
  ratio: number;
}

export type SplitCheckResult = 'match' | 'ratio-differs' | 'missing' | 'applied';

export interface SplitCheck extends ImportedSplitRow {
  result: SplitCheckResult;
  providerExDate: string | null;
  providerRatio: number | null;
}

const NEAR_TRADING_DAYS = 5;

/** Index of the first calendar date on or after `date`. */
function calendarIndex(calendar: string[], date: string): number {
  let lo = 0;
  let hi = calendar.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (calendar[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Compares the sheet's split rows with the stored splits. A provider split
 * within 5 trading days of the sheet's date counts as the same event.
 */
export function splitCrossCheck(
  imported: ImportedSplitRow[],
  stored: (Split & { source: 'provider' | 'manual' })[],
  calendar: string[],
): SplitCheck[] {
  return imported.map((s) => {
    const near = stored
      .filter((p) => p.ticker === s.ticker)
      .map((p) => ({ p, distance: Math.abs(calendarIndex(calendar, p.exDate) - calendarIndex(calendar, s.exDate)) }))
      .filter((x) => x.distance <= NEAR_TRADING_DAYS)
      .sort((a, b) => a.distance - b.distance)[0]?.p;
    if (!near) return { ...s, result: 'missing', providerExDate: null, providerRatio: null };
    const sameRatio = Math.abs(near.ratio - s.ratio) <= 1e-9 * Math.max(1, s.ratio);
    const result: SplitCheckResult = near.source === 'manual' ? 'applied' : sameRatio ? 'match' : 'ratio-differs';
    return { ...s, result, providerExDate: near.exDate, providerRatio: near.ratio };
  });
}

export interface PriceGap {
  ticker: string;
  /** First and last missing trading day. */
  from: string;
  to: string;
  tradingDays: number;
}

/** Runs of more than 5 trading days with no bar, between a ticker's first and last bar. */
export function priceGaps(ticker: string, bars: PriceBar[], calendar: string[]): PriceGap[] {
  if (bars.length < 2) return [];
  const have = new Set(bars.map((b) => b.date));
  const first = bars[0].date;
  const last = bars[bars.length - 1].date;
  const gaps: PriceGap[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > NEAR_TRADING_DAYS) gaps.push({ ticker, from: run[0], to: run[run.length - 1], tradingDays: run.length });
    run = [];
  };
  for (let i = calendarIndex(calendar, first); i < calendar.length && calendar[i] <= last; i++) {
    if (have.has(calendar[i])) flush();
    else run.push(calendar[i]);
  }
  flush();
  return gaps;
}

export interface PriceWarning {
  txId: number;
  ticker: string;
  date: string;
  price: number;
  close: number;
  diffPct: number;
}

export const SANITY_THRESHOLD = 0.2;

/** Trades whose price is more than 20% away from that day's raw close. */
export function priceSanity(transactions: Transaction[], bars: Record<string, PriceBar[]>): PriceWarning[] {
  const closes = new Map<string, Map<string, number>>();
  const out: PriceWarning[] = [];
  for (const tx of transactions) {
    let byDate = closes.get(tx.ticker);
    if (!byDate) closes.set(tx.ticker, (byDate = new Map((bars[tx.ticker] ?? []).map((b) => [b.date, b.close]))));
    const close = byDate.get(tx.date);
    if (close === undefined || close <= 0) continue;
    const diffPct = tx.price / close - 1;
    if (Math.abs(diffPct) > SANITY_THRESHOLD) out.push({ txId: tx.id, ticker: tx.ticker, date: tx.date, price: tx.price, close, diffPct });
  }
  return out;
}
