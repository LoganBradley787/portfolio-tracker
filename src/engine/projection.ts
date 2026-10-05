// A range of possible future values, in today's dollars. Not a forecast: the
// spread comes from an assumed average return and an assumed yearly swing, and
// the same inputs always give the same answer (the random draws are seeded).
import type { MoneyPeriod } from './moneyAdded.ts';

export interface ProjectionInput {
  /** Today's value. */
  value: number;
  /** Money added at the end of each month, in today's dollars. */
  monthly: number;
  years: number;
  /** Average yearly return after inflation, e.g. 0.05. */
  realReturn: number;
  /** Standard deviation of a year's return, e.g. 0.16. */
  volatility: number;
  /** A value to reach, in today's dollars. */
  target?: number | null;
  paths?: number;
  seed?: number;
}

export interface ProjectionYear {
  /** Years from today. */
  year: number;
  /** Today's value plus everything added by then, with no growth. */
  contributed: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** Share of outcomes at or above the target; null without a target. */
  reached: number | null;
}

export interface Projection {
  years: ProjectionYear[];
  /** First year in which at least half the outcomes reach the target; null if none within the horizon. */
  targetYear: number | null;
}

export const PROJECTION_VOLATILITY = 0.16;
const DEFAULT_PATHS = 2000;

/** A small seeded generator (mulberry32): uniform on [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: Float64Array, p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Monthly steps of a lognormal return whose yearly mean and standard deviation
 * match the inputs, with the monthly amount added after each month's return.
 */
export function project(input: ProjectionInput): Projection {
  const years = Math.max(0, Math.floor(input.years));
  const paths = input.volatility > 0 ? Math.max(1, input.paths ?? DEFAULT_PATHS) : 1;
  const target = input.target != null && input.target > 0 ? input.target : null;
  // Yearly log return ~ N(mu, sigma²) with E[growth] = 1 + realReturn.
  const sigma2 = Math.log(1 + (input.volatility / (1 + input.realReturn)) ** 2);
  const mu = Math.log(1 + input.realReturn) - sigma2 / 2;
  const stepMean = mu / 12;
  const stepSd = Math.sqrt(sigma2 / 12);
  const random = seeded(input.seed ?? 1);
  const normal = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };

  const byYear = Array.from({ length: years }, () => new Float64Array(paths));
  for (let p = 0; p < paths; p++) {
    let v = input.value;
    for (let y = 0; y < years; y++) {
      for (let m = 0; m < 12; m++) v = Math.max(0, v * Math.exp(stepMean + (stepSd ? stepSd * normal() : 0)) + input.monthly);
      byYear[y][p] = v;
    }
  }

  const out: ProjectionYear[] = byYear.map((values, y) => {
    const sorted = values.sort();
    return {
      year: y + 1,
      contributed: input.value + input.monthly * 12 * (y + 1),
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      reached: target === null ? null : sorted.filter((v) => v >= target).length / paths,
    };
  });
  return { years: out, targetYear: out.find((y) => y.reached !== null && y.reached >= 0.5)?.year ?? null };
}

export interface Pace {
  /** Average net money added per month over the months used. */
  monthly: number;
  /** Complete calendar months averaged (up to 12; 0 when there are none yet). */
  months: number;
}

/** The recent pace of money added: the last 12 complete calendar months before `today`'s. */
export function contributionPace(months: MoneyPeriod[], today: string): Pace {
  const complete = months.filter((m) => m.period < today.slice(0, 7)).slice(-12);
  if (!complete.length) return { monthly: 0, months: 0 };
  return { monthly: complete.reduce((a, m) => a + m.net, 0) / complete.length, months: complete.length };
}
