// What moved the portfolio over the last day, week or month: each holding's
// dollar gain over the period, on the same convention as the range gain.
import { addDays } from './dates.ts';
import { contribution, investedMask, twrIndex } from './returns.ts';
import type { DayPoint } from './series.ts';

export type MovePeriod = 'day' | 'week' | 'month';

export interface Mover {
  ticker: string;
  gain: number;
  /** gain ÷ the money at work in the ticker over the period; null with none. */
  returnPct: number | null;
  startValue: number;
  endValue: number;
}

export interface Movement {
  period: MovePeriod;
  from: string;
  to: string;
  /** Sum of the movers' gains: the portfolio's gain over the period. */
  gain: number;
  /** Time-weighted return over the period; null when nothing was invested. */
  returnPct: number | null;
  /** Largest gain first, largest loss last. Holdings that did not move a cent are left out. */
  movers: Mover[];
  /** A price was missing on a day in the period, so the figures are understated. */
  incomplete: boolean;
}

/** The same day one month earlier (clamped to the month's length). */
function monthBefore(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * Movement over the period ending at `to` (the last day prices changed).
 * A day is that one trading day; a week is the seven calendar days ending
 * there; a month starts the day after the same date a month earlier.
 */
export function movement(series: DayPoint[], to: string, period: MovePeriod): Movement | null {
  const end = series.filter((p) => p.date <= to).at(-1);
  if (!end) return null;
  const from = period === 'day' ? end.date : period === 'week' ? addDays(end.date, -6) : addDays(monthBefore(end.date), 1);
  const rows = contribution(series, from, end.date);
  const index = twrIndex(series, from, end.date);
  const invested = investedMask(series).some((v, i) => v && series[i].date >= from && series[i].date <= end.date);
  return {
    period,
    from: series.find((p) => p.date >= from)!.date,
    to: end.date,
    gain: rows.reduce((a, r) => a + r.gain, 0),
    returnPct: invested && index.length ? index[index.length - 1].index - 1 : null,
    movers: rows
      .filter((r) => Math.abs(r.gain) >= 0.005)
      .map((r) => ({ ticker: r.ticker, gain: r.gain, returnPct: r.returnPct, startValue: r.startValue, endValue: r.endValue })),
    incomplete: series.some((p, i) => p.date >= from && p.date <= end.date && (p.incomplete || (series[i - 1]?.incomplete ?? false))),
  };
}
