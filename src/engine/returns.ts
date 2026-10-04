// Return and risk measures over the daily series (spec 7.7, 13.2).
import type { DayPoint } from './series.ts';

/**
 * Daily time-weighted returns: r = (V_d + S_d + D_d) / (V_{d−1} + B_d) − 1,
 * with buys as start-of-day money, and sales and cash dividends (D) as
 * end-of-day money. A reinvested dividend is already in V_d, so it is not in D. r = 0 when the
 * denominator is zero, and on incomplete days and the day after one.
 */
export function dailyReturns(series: DayPoint[]): number[] {
  return series.map((p, i) => {
    const prev = i > 0 ? series[i - 1] : null;
    if (p.incomplete || prev?.incomplete) return 0;
    const denom = (prev?.value ?? 0) + p.buys;
    if (Math.abs(denom) < 1e-9) return 0;
    return (p.value + p.sells + p.dividends - p.reinvested) / denom - 1;
  });
}

export interface IndexPoint {
  date: string;
  /** Growth of 1 from the start of the range, through this day's close. */
  index: number;
}

/** Time-weighted index over [from, to], chained from 1. */
export function twrIndex(series: DayPoint[], from: string, to: string, returns = dailyReturns(series)): IndexPoint[] {
  const out: IndexPoint[] = [];
  let idx = 1;
  series.forEach((p, i) => {
    if (p.date < from || p.date > to) return;
    idx *= 1 + returns[i];
    out.push({ date: p.date, index: idx });
  });
  return out;
}

/** Days that count for volatility: complete, invested (non-zero denominator). */
export function investedMask(series: DayPoint[]): boolean[] {
  return series.map((p, i) => {
    const prev = i > 0 ? series[i - 1] : null;
    if (p.incomplete || prev?.incomplete) return false;
    return Math.abs((prev?.value ?? 0) + p.buys) >= 1e-9;
  });
}

export interface MonthReturn {
  month: string;
  from: string;
  to: string;
  return: number | null;
  partial: boolean;
  incomplete: boolean;
}

/** Compound daily TWR within the selected range; never present missing days as a full monthly return. */
export function monthlyReturns(series: DayPoint[], from: string, to: string): MonthReturn[] {
  const returns = dailyReturns(series);
  const invested = investedMask(series);
  const months = new Map<string, MonthReturn & { growth: number; invested: boolean }>();
  series.forEach((p, i) => {
    if (p.date < from || p.date > to) return;
    const month = p.date.slice(0, 7);
    const start = `${month}-01`;
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    let m = months.get(month);
    if (!m) {
      m = { month, from: p.date, to: p.date, return: null, growth: 1, invested: false, incomplete: false,
        partial: from > start || to < end || series[0]?.date.slice(0, 7) === month };
      months.set(month, m);
    }
    m.to = p.date;
    m.growth *= 1 + returns[i];
    m.invested ||= invested[i];
    m.incomplete ||= p.incomplete || (series[i - 1]?.incomplete ?? false);
  });
  return [...months.values()].map(({ growth, invested, ...m }) => ({ ...m, return: invested && !m.incomplete ? growth - 1 : null }));
}

const TRADING_DAYS = 252;

/** Annualized standard deviation (sample) of daily returns on the masked days. */
export function volatility(returns: number[], mask: boolean[]): number | null {
  const xs = returns.filter((_, i) => mask[i]);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

export interface DrawdownResult {
  /** Worst peak-to-trough fall, as a negative fraction (0 if none). */
  max: number;
  maxPeakDate: string | null;
  maxTroughDate: string | null;
  /** Fall from the highest point so far to the last point. */
  current: number;
  series: { date: string; drawdown: number }[];
}

/** Drawdown on a time-weighted index, so deposits cannot hide a fall. The range starts at 1. */
export function drawdown(index: IndexPoint[]): DrawdownResult {
  let peak = 1;
  let peakDate: string | null = index[0]?.date ?? null;
  let max = 0;
  let maxPeakDate: string | null = null;
  let maxTroughDate: string | null = null;
  const series = index.map((p) => {
    if (p.index > peak) {
      peak = p.index;
      peakDate = p.date;
    }
    const dd = p.index / peak - 1;
    if (dd < max) {
      max = dd;
      maxPeakDate = peakDate;
      maxTroughDate = p.date;
    }
    return { date: p.date, drawdown: dd };
  });
  return { max, maxPeakDate, maxTroughDate, current: series.at(-1)?.drawdown ?? 0, series };
}

export interface Flow {
  date: string;
  amount: number;
}

/**
 * Annualized money-weighted return (XIRR, actual/365). Same-day flows are
 * netted; the rate is bracketed on (−0.9999, 10]. Null without a sign change
 * or a root in the bracket.
 */
export function xirr(flows: Flow[]): number | null {
  const byDate = new Map<string, number>();
  for (const f of flows) byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount);
  const netted = [...byDate].filter(([, a]) => Math.abs(a) > 1e-9).sort(([a], [b]) => (a < b ? -1 : 1));
  if (!netted.some(([, a]) => a > 0) || !netted.some(([, a]) => a < 0)) return null;
  const t0 = toDays(netted[0][0]);
  const pts = netted.map(([d, a]) => ({ t: (toDays(d) - t0) / 365, a }));
  const npv = (r: number) => pts.reduce((s, p) => s + p.a / (1 + r) ** p.t, 0);
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-10 || hi - lo < 1e-12) return mid;
    if (f * fLo < 0) hi = mid;
    else {
      lo = mid;
      fLo = f;
    }
  }
  return (lo + hi) / 2;
}

function toDays(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
}

export const MIN_IRR_DAYS = 30;

/**
 * IRR over a range: the opening value as a negative flow at the range start,
 * buys negative, sales positive, the closing value positive at the end.
 * Null ("n/a") for ranges under 30 days or flows without a sign change.
 */
export function rangeIrr(series: DayPoint[], from: string, to: string): number | null {
  const inRange = series.filter((p) => p.date >= from && p.date <= to);
  if (!inRange.length) return null;
  const start = from > series[0].date ? from : series[0].date;
  const end = inRange[inRange.length - 1].date;
  if (toDays(end) - toDays(start) < MIN_IRR_DAYS) return null;
  const opening = series.filter((p) => p.date < inRange[0].date).at(-1)?.value ?? 0;
  const flows: Flow[] = [];
  if (opening) flows.push({ date: start, amount: -opening });
  for (const p of inRange) {
    if (p.buys) flows.push({ date: p.date, amount: -p.buys });
    if (p.sells) flows.push({ date: p.date, amount: p.sells });
    const cashDividends = p.dividends - p.reinvested;
    if (Math.abs(cashDividends) > 1e-9) flows.push({ date: p.date, amount: cashDividends });
  }
  flows.push({ date: end, amount: inRange[inRange.length - 1].value });
  return xirr(flows);
}

export interface Contribution {
  ticker: string;
  startValue: number;
  endValue: number;
  buys: number;
  sells: number;
  dividends: number;
  /** Part of the dividends reinvested in the ticker (already in endValue). */
  reinvested: number;
  /** V_end − V_start − buys + sells + cash dividends for this ticker; these sum to the range gain. */
  gain: number;
  /** gain ÷ (startValue + buys): the return on the money at work in the ticker; null with none. */
  returnPct: number | null;
  /** gain ÷ the range gain; these sum to 1. Null when the range did not gain. */
  share: number | null;
}

export function contribution(series: DayPoint[], from: string, to: string): Contribution[] {
  const inRange = series.filter((p) => p.date >= from && p.date <= to);
  if (!inRange.length) return [];
  const before = series.filter((p) => p.date < inRange[0].date).at(-1);
  const last = inRange[inRange.length - 1];
  const rows = new Map<string, Contribution>();
  const row = (t: string) => {
    let r = rows.get(t);
    if (!r) rows.set(t, (r = { ticker: t, startValue: 0, endValue: 0, buys: 0, sells: 0, dividends: 0, reinvested: 0, gain: 0, returnPct: null, share: null }));
    return r;
  };
  for (const [t, d] of Object.entries(before?.byTicker ?? {})) row(t).startValue = d.value;
  for (const p of inRange) {
    for (const [t, d] of Object.entries(p.byTicker)) {
      const r = row(t);
      r.buys += d.buys;
      r.sells += d.sells;
      r.dividends += d.dividends;
      r.reinvested += d.reinvested;
    }
  }
  for (const [t, d] of Object.entries(last.byTicker)) row(t).endValue = d.value;
  for (const r of rows.values()) r.gain = r.endValue - r.startValue - r.buys + r.sells + r.dividends - r.reinvested;
  const total = [...rows.values()].reduce((sum, r) => sum + r.gain, 0);
  for (const r of rows.values()) {
    const atWork = r.startValue + r.buys;
    r.returnPct = atWork > 0 ? r.gain / atWork : null;
    r.share = total > 1e-9 ? r.gain / total : null;
  }
  return [...rows.values()].sort((a, b) => b.gain - a.gain);
}
