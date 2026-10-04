// Benchmark comparisons (spec 7.6 as replaced by 13.1 item 1).
import { splitRatio } from './prices.ts';
import { orderEvents } from './replay.ts';
import { ZERO_SHARES, type Dividend, type PriceBar, type Quote, type Split, type Transaction } from './types.ts';

/** Close on `date`, or the next available close if there is no bar that day. */
export function closeLookup(bars: PriceBar[]): (date: string) => number | null {
  return (date: string) => {
    let lo = 0;
    let hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].date < date) lo = mid + 1;
      else hi = mid;
    }
    return lo < bars.length ? bars[lo].close : null;
  };
}

// ── Sheet-compatible mirror ────────────────────────────────────────────

export interface MirrorRow {
  txId: number;
  date: string;
  type: 'Buy' | 'Sell';
  amount: number;
  close: number;
  units: number;
  runningUnits: number;
  runningCost: number;
  costRemoved: number | null;
  gain: number | null;
}

export interface MirrorResult {
  rows: MirrorRow[];
  units: number;
  cost: number;
  unitsSold: number;
  realized: number;
  unrealized: number;
  /** Rows skipped because the benchmark had no close on or after their date. */
  missing: number;
  /** The flaw this check exists to expose: units went below zero. */
  negative: boolean;
}

/**
 * The sheet's "S&P 500 Math": every trade's dollars go into or come out of
 * the benchmark at that day's close, under average cost, with no clamp.
 * Shown only as a labelled check figure.
 */
export function sheetMirror(transactions: Transaction[], closeOn: (date: string) => number | null, currentClose: number): MirrorResult {
  const ordered = [...transactions].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.seq - b.seq));
  let units = 0;
  let cost = 0;
  let unitsSold = 0;
  let realized = 0;
  let missing = 0;
  let negative = false;
  const rows: MirrorRow[] = [];
  for (const t of ordered) {
    const close = closeOn(t.date);
    if (close === null || close <= 0) {
      missing++;
      continue;
    }
    const amount = t.shares * t.price;
    const u = amount / close;
    let costRemoved: number | null = null;
    let gain: number | null = null;
    if (t.type === 'Buy') {
      units += u;
      cost += amount;
    } else {
      costRemoved = units !== 0 ? (cost / units) * u : 0;
      gain = amount - costRemoved;
      units -= u;
      cost -= costRemoved;
      unitsSold += u;
      realized += gain;
    }
    if (units < -ZERO_SHARES) negative = true;
    rows.push({ txId: t.id, date: t.date, type: t.type, amount, close, units: u, runningUnits: units, runningCost: cost, costRemoved, gain });
  }
  const avg = units !== 0 ? cost / units : 0;
  return { rows, units, cost, unitsSold, realized, unrealized: units * (currentClose - avg), missing, negative };
}

// ── Per-ticker shadow ──────────────────────────────────────────────────

export interface ShadowPosition {
  units: number;
  cost: number;
  realized: number;
  /** Benchmark dividends received and reinvested into more units. */
  dividends: number;
}

export interface ShadowDay {
  date: string;
  units: number;
  value: number;
  cost: number;
  realized: number;
  /** Dollars put into the shadow that day (equal to the portfolio's buys). */
  buys: number;
  /** Benchmark proceeds taken out that day (shadow units sold × close). */
  sells: number;
}

export interface ShadowResult {
  days: ShadowDay[];
  byTicker: Record<string, ShadowPosition>;
  /** Per-position gain over the requested range, using each shadow's own flows. */
  rangeGains: Record<string, number>;
  units: number;
  cost: number;
  value: number;
  realized: number;
  unrealized: number;
  /** Dividends reinvested, all time. Already inside value and realized. */
  dividends: number;
}

export interface ShadowInput {
  transactions: Transaction[];
  splits: Split[];
  /** The benchmark's bars. */
  bars: PriceBar[];
  calendar: string[];
  /** Latest quote; used for a calendar day that has no bar yet (today). */
  quote?: Quote | null;
  /** The benchmark's own dividends, reinvested at the ex-date close. */
  dividends?: { exDate: string; amount: number }[];
  range?: { from: string; to: string };
  benchmarkSplits?: Split[];
}

/**
 * Each buy of ticker T buys the same dollars of the benchmark into T's
 * shadow. Selling a fraction f of T's shares sells fraction f of T's shadow
 * units. A shadow can never go negative. The benchmark's dividends are
 * reinvested: on each ex-date, every shadow buys more units at that close.
 */
export function shadowBenchmark(input: ShadowInput): ShadowResult {
  const closeAt = closeLookup(input.bars);
  const shares = new Map<string, number>();
  const shadows: Record<string, ShadowPosition> = {};
  const shadow = (t: string) => (shadows[t] ??= { units: 0, cost: 0, realized: 0, dividends: 0 });
  const BENCH = '\u0000benchmark';
  const benchDivs: Dividend[] = (input.dividends ?? []).map((d) => ({ ticker: BENCH, exDate: d.exDate, amount: d.amount }));
  const events = orderEvents(input.transactions, [...input.splits, ...(input.benchmarkSplits ?? []).map((s) => ({ ...s, ticker: BENCH }))], undefined, benchDivs);
  let ei = 0;
  let lastClose: number | null = null;
  let bi = 0;
  const days: ShadowDay[] = [];
  const rangeGains: Record<string, number> = {};
  const previousValues: Record<string, number> = {};

  for (const date of input.calendar) {
    let buys = 0;
    let sells = 0;
    const flows: Record<string, number> = {};
    while (ei < events.length && events[ei].date <= date) {
      const e = events[ei++];
      if (e.kind === 'split') {
        if (e.ticker === BENCH) {
          for (const s of Object.values(shadows)) s.units *= e.ratio;
          continue;
        }
        if (shares.has(e.ticker)) shares.set(e.ticker, shares.get(e.ticker)! * e.ratio);
        continue;
      }
      if (e.kind === 'dividend') {
        // Portfolio tickers' own dividends are not this benchmark's business.
        if (e.ticker !== BENCH) continue;
        const close = closeAt(e.date);
        if (!close) continue;
        for (const s of Object.values(shadows)) {
          if (s.units <= ZERO_SHARES) continue;
          s.dividends += s.units * e.amount;
          s.units *= 1 + e.amount / close;
        }
        continue;
      }
      const tx = e.tx;
      const held = shares.get(tx.ticker) ?? 0;
      const close = closeAt(tx.date);
      if (tx.type === 'Buy') {
        shares.set(tx.ticker, held + tx.shares);
        if (close) {
          const s = shadow(tx.ticker);
          s.units += (tx.shares * tx.price) / close;
          s.cost += tx.shares * tx.price;
          buys += tx.shares * tx.price;
          flows[tx.ticker] = (flows[tx.ticker] ?? 0) - tx.shares * tx.price;
        }
      } else {
        const sold = Math.min(tx.shares, Math.max(held, 0));
        const f = held > ZERO_SHARES ? sold / held : 0;
        shares.set(tx.ticker, held - sold);
        const s = shadows[tx.ticker];
        if (s && f > 0 && close) {
          const units = s.units * f;
          const costRemoved = s.cost * f;
          s.realized += units * close - costRemoved;
          sells += units * close;
          flows[tx.ticker] = (flows[tx.ticker] ?? 0) + units * close;
          s.units -= units;
          s.cost -= costRemoved;
          if (f >= 1 - 1e-12 || s.units <= ZERO_SHARES) {
            s.units = 0;
            s.cost = 0;
          }
        }
      }
    }
    let barToday = false;
    while (bi < input.bars.length && input.bars[bi].date <= date) {
      barToday = input.bars[bi].date === date;
      lastClose = input.bars[bi++].close;
    }
    const q = input.quote;
    const carriedRatio = bi > 0 ? splitRatio(input.benchmarkSplits ?? [], input.bars[bi - 1].date, date) : 1;
    const price = !barToday && q && q.asOf.slice(0, 10) === date ? q.last : lastClose === null ? null : lastClose / carriedRatio;
    if (input.range) {
      for (const [ticker, s] of Object.entries(shadows)) {
        const value = price !== null ? s.units * price : s.cost;
        if (date >= input.range.from && date <= input.range.to) {
          rangeGains[ticker] = (rangeGains[ticker] ?? 0) + value - (previousValues[ticker] ?? 0) + (flows[ticker] ?? 0);
        }
        previousValues[ticker] = value;
      }
    }
    const t = totals(shadows);
    days.push({ date, units: t.units, value: price !== null ? t.units * price : t.cost, cost: t.cost, realized: t.realized, buys, sells });
  }

  const t = totals(shadows);
  const value = days.at(-1)?.value ?? 0;
  return { days, byTicker: shadows, rangeGains, ...t, value, unrealized: value - t.cost };
}

function totals(shadows: Record<string, ShadowPosition>) {
  let units = 0;
  let cost = 0;
  let realized = 0;
  let dividends = 0;
  for (const s of Object.values(shadows)) {
    units += s.units;
    cost += s.cost;
    realized += s.realized;
    dividends += s.dividends;
  }
  return { units, cost, realized, dividends };
}

/**
 * Total-return level of the benchmark on each calendar day: the close times
 * the units one starting unit has grown to by reinvesting every dividend at
 * its ex-date close. Today uses the quote. Null before the first bar.
 */
export function totalReturnLevels(bars: PriceBar[], dividends: { exDate: string; amount: number }[], calendar: string[], quote?: Quote | null, splits: Split[] = []): (number | null)[] {
  const closeAt = closeLookup(bars);
  const events = orderEvents([], splits, undefined, dividends.map((d) => ({ ...d, ticker: '' })));
  let units = 1;
  let di = 0;
  let bi = -1;
  return calendar.map((d) => {
    while (bi + 1 < bars.length && bars[bi + 1].date <= d) bi++;
    while (di < events.length && events[di].date <= d) {
      const e = events[di++];
      // Events before the first price cannot affect the unit we start with at that price.
      if (!bars.length || e.date < bars[0].date) continue;
      if (e.kind === 'split') units *= e.ratio;
      else if (e.kind === 'dividend') {
        const close = closeAt(e.date);
        if (close && bi >= 0) units *= 1 + e.amount / close;
      }
    }
    const barToday = bi >= 0 && bars[bi].date === d;
    const carriedRatio = bi >= 0 ? splitRatio(splits, bars[bi].date, d) : 1;
    const price = !barToday && quote && quote.asOf.slice(0, 10) === d ? quote.last : bi >= 0 ? bars[bi].close / carriedRatio : null;
    return price === null ? null : price * units;
  });
}
