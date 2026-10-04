// Keeps the database's market data fresh within the provider's rate limit.
//
// Pages render from the database and never wait on this. A refresh runs in
// the background, one at a time, and records what it could not finish.
import { currentLedger } from '../db/ledgerState.ts';
import { addDays, previousWeekday, subtractWeekdays } from '../engine/dates.ts';
import type { Queries, Security } from '../db/queries.ts';
import { RequestBudget } from './budget.ts';
import { ProviderError, type MarketDataProvider, type ProviderErrorKind } from './provider.ts';

export const BENCHMARKS = ['SPY', 'QQQ', 'VT'];
const SIX_HOURS_MS = 6 * 3_600_000;
const QUOTE_TTL_MS = 5 * 60_000;
/** A held ticker with no bar for this many weekdays is treated as delisted or renamed. */
const DELISTED_AFTER_WEEKDAYS = 10;

export type Group = 'benchmark' | 'held' | 'sold';

export interface PlanItem {
  ticker: string;
  symbol: string;
  group: Group;
  mode: 'backfill' | 'update';
  start: string;
  end?: string;
}

export interface RefreshStatus {
  state: 'idle' | 'running' | 'no-key';
  startedAt: string | null;
  finishedAt: string | null;
  done: number;
  total: number;
  current: string | null;
  /** Tickers whose history is still owed (never fetched, or skipped this run). */
  pending: string[];
  /** When the request budget allows the next request, if it ran out. */
  resumesAt: string | null;
  error: { kind: ProviderErrorKind; message: string; at: string } | null;
  lastSuccessAt: string | null;
}

/** Today's date in New York, where the market keeps its calendar. */
export function easternDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export interface CacheDeps {
  q: Queries;
  provider: MarketDataProvider | null;
  now?: () => Date;
  limit?: number;
}

export class MarketCache {
  readonly status: RefreshStatus;
  readonly budget: RequestBudget;
  private readonly q: Queries;
  private readonly provider: MarketDataProvider | null;
  private readonly now: () => Date;
  private inFlight: Promise<RefreshStatus> | null = null;
  private lastQuoteAttempt = 0;

  constructor(deps: CacheDeps) {
    this.q = deps.q;
    this.provider = deps.provider;
    this.now = deps.now ?? (() => new Date());
    this.budget = new RequestBudget(this.q, this.now, deps.limit);
    this.status = {
      state: this.provider ? 'idle' : 'no-key',
      startedAt: null,
      finishedAt: null,
      done: 0,
      total: 0,
      current: null,
      pending: [],
      resumesAt: null,
      error: null,
      lastSuccessAt: null,
    };
  }

  today(): string {
    return easternDate(this.now());
  }

  benchmarkTickers(): string[] {
    const custom = this.q.customBenchmark();
    return [...new Set([...BENCHMARKS, ...(custom ? [custom] : [])])];
  }

  /** Tickers whose history should be fetched now, in fetch order. */
  plan(): PlanItem[] {
    const { state, ledger } = currentLedger(this.q);
    const txs = state.transactions;
    if (!txs.length) return [];
    const first = new Map<string, string>();
    const last = new Map<string, string>();
    for (const t of txs) {
      if (!first.has(t.ticker) || t.date < first.get(t.ticker)!) first.set(t.ticker, t.date);
      if (!last.has(t.ticker) || t.date > last.get(t.ticker)!) last.set(t.ticker, t.date);
    }
    const held = ledger.positions;
    const earliest = [...first.values()].sort()[0];

    const benchmarks = this.benchmarkTickers();
    for (const b of benchmarks) {
      // Only the built-in funds have a known asset type. Custom symbols remain unclassified until a trade or manual edit.
      if (BENCHMARKS.includes(b)) this.q.ensureSecurity(b, 'ETF');
    }
    const groups: [Group, string[]][] = [
      ['benchmark', benchmarks],
      ['held', [...first.keys()].filter((t) => !benchmarks.includes(t) && held.has(t)).sort()],
      ['sold', [...first.keys()].filter((t) => !benchmarks.includes(t) && !held.has(t)).sort()],
    ];
    const out: PlanItem[] = [];
    for (const [group, tickers] of groups) {
      for (const ticker of tickers) {
        const sec = this.q.getSecurity(ticker);
        if (!sec) continue;
        const item = this.planOne(sec, group, group === 'benchmark' ? earliest : first.get(ticker)!, last.get(ticker)!);
        if (item) out.push(item);
      }
    }
    return out;
  }

  private planOne(sec: Security, group: Group, firstDate: string, lastDate: string): PlanItem | null {
    if (sec.status === 'unresolved') return null;
    const base = { ticker: sec.ticker, symbol: sec.providerSymbol, group };
    const end = group === 'sold' ? lastDate : undefined;
    // A trade added before the earliest date ever requested needs its history now, not in six hours.
    if (sec.historyRequestedFrom && firstDate < sec.historyRequestedFrom) return { ...base, mode: 'backfill', start: firstDate, end };
    if (sec.lastHistoryFetch && this.now().getTime() - Date.parse(sec.lastHistoryFetch) < SIX_HOURS_MS) return null;
    const firstBar = this.q.firstBarDate(sec.ticker);
    // A week of slack covers a first trade made on a weekend or holiday.
    const startCovered = sec.historyRequestedFrom && sec.historyRequestedFrom <= firstDate;
    if (!sec.historyThrough || !firstBar || (firstBar > addDays(firstDate, 7) && !startCovered)) {
      return { ...base, mode: 'backfill', start: firstDate, end };
    }
    const start = subtractWeekdays(sec.historyThrough, 5);
    if (group === 'sold') {
      // Fetched once through the last sale; again only if a later trade appears.
      const fetchedAfterSale = sec.lastHistoryFetch && easternDate(new Date(sec.lastHistoryFetch)) > lastDate;
      return sec.historyThrough < lastDate && !fetchedAfterSale ? { ...base, mode: 'update', start, end } : null;
    }
    return sec.historyThrough < previousWeekday(this.today()) ? { ...base, mode: 'update', start } : null;
  }

  /** Held tickers (and benchmarks) to quote, or [] if quotes are fresh. */
  quoteSymbols(): Security[] {
    if (!this.q.listTransactions().length) return [];
    const lastFetch = Math.max(Date.parse(this.q.lastQuoteFetch() ?? '') || 0, this.lastQuoteAttempt);
    if (this.now().getTime() - lastFetch < QUOTE_TTL_MS) return [];
    const held = currentLedger(this.q).ledger.positions;
    const tickers = new Set([...this.benchmarkTickers(), ...held.keys()]);
    return this.q.listSecurities().filter((s) => tickers.has(s.ticker) && s.status !== 'unresolved');
  }

  needsRefresh(): boolean {
    return !!this.provider && (this.plan().length > 0 || this.quoteSymbols().length > 0);
  }

  /** Starts a background refresh if anything is stale. Never waits. */
  maybeRefresh(): void {
    if (!this.inFlight && this.needsRefresh()) void this.refresh();
  }

  /** Runs a refresh, or joins the one already running. */
  refresh(): Promise<RefreshStatus> {
    if (!this.provider) return Promise.resolve(this.status);
    this.inFlight ??= this.run(this.provider).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(provider: MarketDataProvider): Promise<RefreshStatus> {
    const s = this.status;
    const plan = this.plan();
    const quoteSecs = this.quoteSymbols();
    Object.assign(s, {
      state: 'running',
      startedAt: this.now().toISOString(),
      finishedAt: null,
      done: 0,
      total: plan.length + (quoteSecs.length ? 1 : 0),
      current: null,
      pending: plan.map((p) => p.ticker),
      resumesAt: null,
      error: null,
    });
    let failed = false;
    try {
      if (quoteSecs.length) {
        if (!this.takeBudget()) return this.finish(false);
        s.current = 'quotes';
        await this.fetchQuotes(provider, quoteSecs);
        s.done++;
      }
      for (const item of plan) {
        if (!this.takeBudget()) return this.finish(false);
        s.current = item.ticker;
        await this.fetchHistory(provider, item);
        s.pending = s.pending.filter((t) => t !== item.ticker);
        s.done++;
      }
    } catch (e) {
      failed = true;
      const err = e instanceof ProviderError ? e : new ProviderError('provider', (e as Error).message);
      s.error = { kind: err.kind, message: err.message, at: this.now().toISOString() };
    }
    return this.finish(!failed);
  }

  private takeBudget(): boolean {
    if (this.budget.remaining() > 0) return true;
    this.status.resumesAt = this.budget.resumesAt();
    return false;
  }

  private finish(complete: boolean): RefreshStatus {
    const s = this.status;
    s.state = 'idle';
    s.current = null;
    s.finishedAt = this.now().toISOString();
    if (complete && !s.resumesAt) s.lastSuccessAt = s.finishedAt;
    return s;
  }

  private async call<T>(kind: string, symbol: string | null, fn: () => Promise<T>): Promise<T> {
    try {
      const out = await fn();
      this.budget.record(kind, symbol, 200, true);
      return out;
    } catch (e) {
      const status = e instanceof ProviderError ? e.status : null;
      this.budget.record(kind, symbol, status, false);
      throw e;
    }
  }

  private async fetchQuotes(provider: MarketDataProvider, secs: Security[]): Promise<void> {
    this.lastQuoteAttempt = this.now().getTime();
    const bySymbol = new Map(secs.map((s) => [s.providerSymbol.replace(/\./g, '-'), s.ticker]));
    const quotes = await this.call('quotes', null, () => provider.quotes(secs.map((s) => s.providerSymbol)));
    const fetchedAt = this.now().toISOString();
    for (const qt of quotes) {
      const ticker = bySymbol.get(qt.symbol) ?? bySymbol.get(qt.symbol.replace(/\./g, '-'));
      if (ticker) this.q.upsertQuote({ ticker, last: qt.last, prevClose: qt.prevClose, asOf: qt.asOf, fetchedAt });
    }
  }

  private async fetchHistory(provider: MarketDataProvider, item: PlanItem): Promise<void> {
    const fetchedAt = this.now().toISOString();
    let result;
    try {
      result = await this.call('history', item.symbol, () => provider.history(item.symbol, item.start, item.end));
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'not-found') {
        this.q.setSecurityStatus(item.ticker, {
          status: 'unresolved',
          lastHistoryFetch: fetchedAt,
          lastError: `The provider has no data for ${item.symbol}`,
        });
        return;
      }
      throw e;
    }
    const { bars, splits, dividends } = result;
    if (!bars.length && item.mode === 'backfill') {
      this.q.setSecurityStatus(item.ticker, {
        status: 'unresolved',
        lastHistoryFetch: fetchedAt,
        lastError: `The provider returned no prices for ${item.symbol} since ${item.start}`,
      });
      return;
    }
    this.q.upsertBars(item.ticker, bars);
    this.q.upsertProviderSplits(item.ticker, splits);
    this.q.upsertDividends(item.ticker, dividends);
    const sec = this.q.getSecurity(item.ticker)!;
    const prev = sec.historyThrough;
    // Record successful backfills, even when the fund did not exist at the requested start.
    const historyRequestedFrom = item.mode === 'backfill'
      ? [sec.historyRequestedFrom, item.start].filter((d): d is string => !!d).sort()[0]
      : sec.historyRequestedFrom;
    const lastBar = bars.length ? bars[bars.length - 1].date : null;
    const historyThrough = [prev, lastBar].filter((d): d is string => !!d).sort().pop() ?? null;

    const stale = item.group !== 'sold' && historyThrough && historyThrough < subtractWeekdays(this.today(), DELISTED_AFTER_WEEKDAYS);
    if (stale && item.group === 'held') {
      this.q.setSecurityStatus(item.ticker, {
        status: 'unresolved',
        historyThrough,
        historyRequestedFrom,
        lastHistoryFetch: fetchedAt,
        lastError: `No prices since ${historyThrough}: delisted or renamed? Record the sale, or set a new provider symbol.`,
      });
      return;
    }
    this.q.setSecurityStatus(item.ticker, { status: 'ok', historyThrough, historyRequestedFrom, lastHistoryFetch: fetchedAt, lastError: null });
  }
}
