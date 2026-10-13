// Daily portfolio series from replayed transactions (spec 7.5, 13.2).
//
// Each calendar day: actual shares held that day × that day's raw close.
// No adjusted prices anywhere; splits change share counts on their ex-date.
import { makeStrategy } from './costBasis.ts';
import { orderEvents } from './replay.ts';
import { investedMask, twrIndex } from './returns.ts';
import { ZERO_SHARES, type CostMethod, type Dividend, type PriceBar, type Quote, type Split, type Transaction } from './types.ts';

export interface TickerDay {
  shares: number;
  value: number;
  cost: number;
  buys: number;
  sells: number;
  /** Dividend income that day. */
  dividends: number;
  /** Part of that income reinvested in the ticker (in `value`, not in `buys`). */
  reinvested: number;
  /** False when no price was available and the position is valued at cost. */
  priced: boolean;
}

export interface DayPoint {
  date: string;
  /** Market value at the close (today: at the latest quote). */
  value: number;
  /** Cost basis of the open positions. */
  cost: number;
  /** Cumulative realized gain through this day. */
  realized: number;
  /** Cost of buys that day. */
  buys: number;
  /** Proceeds of sales that day. */
  sells: number;
  /** Dividend income that day (ex-date). */
  dividends: number;
  /** Part of that income reinvested (bought shares, so it is in `value`; not money added). */
  reinvested: number;
  /** Cumulative dividend income through this day. */
  dividendsCum: number;
  /** A held ticker had no price yet (still pending) and was valued at cost. */
  incomplete: boolean;
  byTicker: Record<string, TickerDay>;
}

export interface SeriesInput {
  transactions: Transaction[];
  splits: Split[];
  dividends?: Dividend[];
  bars: Record<string, PriceBar[]>;
  quotes: Record<string, Quote>;
  calendar: string[];
  /** Tickers the provider has no data for: valued at last close or cost, but not "incomplete". */
  unresolved?: string[];
  method?: CostMethod;
}

/**
 * Trading days from the first transaction to today: the benchmark's bar dates,
 * plus today when it is later than the last bar (valued from quotes).
 */
export function buildCalendar(benchmarkDates: string[], firstDate: string, today: string): string[] {
  const days = benchmarkDates.filter((d) => d >= firstDate && d <= today);
  if (!days.length || days[days.length - 1] < today) days.push(today);
  return days;
}

/** Walks one ticker's bars forward as the calendar advances. */
class PriceCursor {
  private i = -1;
  constructor(
    private readonly bars: PriceBar[],
    private readonly splits: Split[],
    private readonly quote: Quote | undefined,
  ) {}

  /** Raw close for `date` on the share basis of that date, or null if none yet. */
  at(date: string): number | null {
    while (this.i + 1 < this.bars.length && this.bars[this.i + 1].date <= date) this.i++;
    const bar = this.i >= 0 ? this.bars[this.i] : null;
    if (bar && bar.date === date) return bar.close;
    if (this.quote && this.quote.asOf.slice(0, 10) === date && Number.isFinite(this.quote.last)) return this.quote.last;
    if (!bar) return null;
    // Carry the last close forward, restated for any split since.
    const ratio = this.splits.filter((s) => s.exDate > bar.date && s.exDate <= date).reduce((a, s) => a * s.ratio, 1);
    return bar.close / ratio;
  }
}

export function dailySeries(input: SeriesInput): DayPoint[] {
  const { calendar } = input;
  if (!calendar.length) return [];
  const strategy = makeStrategy(input.method ?? 'average');
  const unresolved = new Set(input.unresolved ?? []);
  const cursors = new Map<string, PriceCursor>();
  const cursor = (t: string) => {
    let c = cursors.get(t);
    if (!c) {
      const splits = input.splits.filter((s) => s.ticker === t);
      cursors.set(t, (c = new PriceCursor(input.bars[t] ?? [], splits, input.quotes[t])));
    }
    return c;
  };

  const events = orderEvents(input.transactions, input.splits, undefined, input.dividends);
  let ei = 0;
  let realized = 0;
  let dividendsCum = 0;
  const held = new Set<string>();
  const out: DayPoint[] = [];

  for (const date of calendar) {
    const flows = new Map<string, { buys: number; sells: number; dividends: number; reinvested: number }>();
    const flow = (t: string) => {
      let f = flows.get(t);
      if (!f) flows.set(t, (f = { buys: 0, sells: 0, dividends: 0, reinvested: 0 }));
      return f;
    };
    // Every event up to this trading day; a non-trading-day event lands on the next one.
    while (ei < events.length && events[ei].date <= date) {
      const e = events[ei++];
      if (e.kind === 'split') {
        strategy.split(e.ticker, e.ratio);
        continue;
      }
      if (e.kind === 'dividend') {
        const { shares } = strategy.totals(e.ticker);
        if (shares > ZERO_SHARES) {
          flow(e.ticker).dividends += shares * e.amount;
          dividendsCum += shares * e.amount;
        }
        continue;
      }
      const tx = e.tx;
      if (tx.type === 'Buy') {
        strategy.buy(tx);
        if (tx.drip) flow(tx.ticker).reinvested += tx.shares * tx.price;
        else flow(tx.ticker).buys += tx.shares * tx.price;
        held.add(tx.ticker);
      } else {
        const o = strategy.sell(tx);
        const proceeds = o.sharesSold * tx.price;
        flow(tx.ticker).sells += proceeds;
        if (o.sharesSold > ZERO_SHARES) realized += proceeds - o.costRemoved;
      }
    }

    const point: DayPoint = { date, value: 0, cost: 0, realized, buys: 0, sells: 0, dividends: 0, reinvested: 0, dividendsCum, incomplete: false, byTicker: {} };
    for (const t of [...held, ...flows.keys()]) {
      if (point.byTicker[t]) continue;
      const { shares, cost } = strategy.totals(t);
      const f = flows.get(t) ?? { buys: 0, sells: 0, dividends: 0, reinvested: 0 };
      const open = shares > ZERO_SHARES;
      if (!open) held.delete(t);
      if (!open && !flows.has(t)) continue;
      const close = open ? cursor(t).at(date) : 0;
      const priced = close !== null;
      const value = open ? (priced ? shares * close : cost) : 0;
      if (open && !priced && !unresolved.has(t)) point.incomplete = true;
      point.byTicker[t] = { shares: open ? shares : 0, value, cost: open ? cost : 0, buys: f.buys, sells: f.sells, dividends: f.dividends, reinvested: f.reinvested, priced };
      point.value += value;
      point.cost += open ? cost : 0;
      point.buys += f.buys;
      point.sells += f.sells;
      point.dividends += f.dividends;
      point.reinvested += f.reinvested;
    }
    out.push(point);
  }
  return out;
}

export interface RangeSummary {
  from: string | null;
  to: string | null;
  days: number;
  /** Value at the close of the day before the range (0 if none). */
  startValue: number;
  endValue: number;
  buys: number;
  sells: number;
  dividends: number;
  /** Part of the dividends reinvested (already in endValue). */
  reinvested: number;
  /** V_end − V_start − buys + sells + dividends paid out as cash. */
  gain: number;
  /** Time-weighted return over the range, the same figure What moved and Performance show; null when nothing was invested. */
  returnPct: number | null;
}

/** Gain over [from, to] inclusive, using the spec 13.2 convention. */
export function rangeSummary(series: DayPoint[], from: string, to: string): RangeSummary {
  const inRange = series.filter((p) => p.date >= from && p.date <= to);
  if (!inRange.length) return { from: null, to: null, days: 0, startValue: 0, endValue: 0, buys: 0, sells: 0, dividends: 0, reinvested: 0, gain: 0, returnPct: null };
  const before = series.filter((p) => p.date < inRange[0].date).at(-1);
  const startValue = before?.value ?? 0;
  const endValue = inRange[inRange.length - 1].value;
  const buys = inRange.reduce((a, p) => a + p.buys, 0);
  const sells = inRange.reduce((a, p) => a + p.sells, 0);
  const dividends = inRange.reduce((a, p) => a + p.dividends, 0);
  const reinvested = inRange.reduce((a, p) => a + p.reinvested, 0);
  const mask = investedMask(series);
  const invested = series.some((p, i) => mask[i] && p.date >= inRange[0].date && p.date <= inRange[inRange.length - 1].date);
  const index = invested ? twrIndex(series, inRange[0].date, inRange[inRange.length - 1].date) : [];
  return {
    from: inRange[0].date,
    to: inRange[inRange.length - 1].date,
    days: inRange.length,
    startValue,
    endValue,
    buys,
    sells,
    dividends,
    reinvested,
    gain: endValue - startValue - buys + sells + dividends - reinvested,
    returnPct: index.length ? index[index.length - 1].index - 1 : null,
  };
}
