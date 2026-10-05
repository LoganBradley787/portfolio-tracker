// Dividend income to expect over the next twelve months: the last twelve
// months' dividends per share, paid on the shares held today.
import { addDays, daysBetween } from './dates.ts';
import { splitRatio } from './prices.ts';
import type { Dividend, Split } from './types.ts';

export interface IncomeRow {
  ticker: string;
  shares: number;
  value: number;
  /** Dividends per share over the last 12 months, on today's share basis. */
  perShare: number;
  /** Payments in the last 12 months. */
  payments: number;
  /** perShare × shares held today. */
  annual: number;
  /** annual ÷ value; null when the holding has no value. */
  yield: number | null;
  lastExDate: string;
  /** The next ex-date if the usual gap between payments holds; null when it cannot be told. */
  nextExDate: string | null;
}

export interface IncomeSummary {
  rows: IncomeRow[];
  annual: number;
  /** Value of every position given, payers or not. */
  value: number;
  /** annual ÷ value; null when there is no value. */
  yield: number | null;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Last ex-date plus the median of the last few gaps; null once that date has passed without a payment. */
function nextExDate(exDates: string[], today: string): string | null {
  const recent = exDates.slice(-6);
  if (recent.length < 2) return null;
  const gap = Math.round(median(recent.slice(1).map((d, i) => daysBetween(recent[i], d))));
  const next = addDays(recent[recent.length - 1], gap);
  return gap > 0 && next > today ? next : null;
}

export function forwardIncome(input: {
  positions: { ticker: string; shares: number; value: number }[];
  dividends: Dividend[];
  splits: Split[];
  today: string;
}): IncomeSummary {
  const since = addDays(input.today, -365);
  const rows: IncomeRow[] = [];
  for (const p of input.positions) {
    const paid = input.dividends.filter((d) => d.ticker === p.ticker && d.exDate <= input.today).sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
    const recent = paid.filter((d) => d.exDate > since);
    if (!recent.length) continue;
    const splits = input.splits.filter((s) => s.ticker === p.ticker);
    const perShare = recent.reduce((a, d) => a + d.amount / splitRatio(splits, d.exDate, input.today), 0);
    const annual = perShare * p.shares;
    rows.push({
      ticker: p.ticker,
      shares: p.shares,
      value: p.value,
      perShare,
      payments: recent.length,
      annual,
      yield: p.value > 0 ? annual / p.value : null,
      lastExDate: recent[recent.length - 1].exDate,
      nextExDate: nextExDate(paid.map((d) => d.exDate), input.today),
    });
  }
  rows.sort((a, b) => b.annual - a.annual || (a.ticker < b.ticker ? -1 : 1));
  const annual = rows.reduce((a, r) => a + r.annual, 0);
  const value = input.positions.reduce((a, p) => a + p.value, 0);
  return { rows, annual, value, yield: value > 0 ? annual / value : null };
}
