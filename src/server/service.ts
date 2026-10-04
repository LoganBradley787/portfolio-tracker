// Loads state from the database and runs the engine over it.
import { addDays } from '../engine/dates.ts';
import { runLedger, type Ledger } from '../engine/costBasis.ts';
import { computeHoldings, resolvePrice, type PricePoint } from '../engine/holdings.ts';
import { priceGaps, priceSanity, splitCrossCheck } from '../engine/health.ts';
import { dividendsByYear, summarizeRealized, taxYears, type SaleSort } from '../engine/realized.ts';
import { buildCalendar, dailySeries, rangeSummary, type DayPoint } from '../engine/series.ts';
import { closeLookup, shadowBenchmark, sheetMirror, totalReturnLevels } from '../engine/benchmark.ts';
import { priceChange, splitAdjustedBars, splitRatio } from '../engine/prices.ts';
import { allocation } from '../engine/allocation.ts';
import { turningLongTermSoon } from '../engine/sellPreview.ts';
import { moneyAdded } from '../engine/moneyAdded.ts';
import { contribution, dailyReturns, drawdown, investedMask, monthlyReturns, rangeIrr, twrIndex, volatility } from '../engine/returns.ts';
import type { AssetType, CostMethod, Quote, SecurityStatus, Transaction } from '../engine/types.ts';
import type { Security } from '../db/queries.ts';
import { loadLedgerState } from '../db/ledgerState.ts';
import type { AppContext } from './context.ts';
import { selectExposureRows, type ExposurePage } from '../engine/exposureRows.ts';
import { computeExposure, type FundSnapshot } from '../engine/exposure.ts';
import { holdingsUrl, VANGUARD_FUNDS } from '../market/vanguard.ts';

export interface State extends ReturnType<typeof loadLedgerState> {
  quotes: Record<string, Quote>;
  securities: Security[];
  assetTypes: Record<string, AssetType>;
  statuses: Record<string, SecurityStatus>;
}

/** `accounts` limits the transactions to those accounts; prices, splits and dividend rates are shared. */
export function loadState(ctx: AppContext, accounts?: string[]): State {
  const securities = ctx.q.listSecurities();
  return {
    ...loadLedgerState(ctx.q, accounts),
    quotes: Object.fromEntries(ctx.q.listQuotes().map((x) => [x.ticker, { last: x.last, prevClose: x.prevClose, asOf: x.asOf }])),
    securities,
    assetTypes: Object.fromEntries(securities.map((s) => [s.ticker, s.assetType])),
    statuses: Object.fromEntries(securities.map((s) => [s.ticker, s.status])),
  };
}

export function currentPrices(state: State, tickers: Iterable<string>): Record<string, PricePoint> {
  const out: Record<string, PricePoint> = {};
  for (const t of tickers) {
    const p = resolvePrice(t, state.bars[t] ?? [], state.quotes[t] ?? null, state.splits);
    if (p) out[t] = p;
  }
  return out;
}

/** Today's sale estimates always use open FIFO lots, independent of a chart range. */
function salePreviewState(state: State, today: string) {
  const fifo = runLedger(state.ledgerTransactions, state.splits, { method: 'fifo', asOf: today });
  const prices: Record<string, PricePoint> = {};
  const splits = state.splits.filter((s) => s.exDate <= today);
  for (const ticker of fifo.positions.keys()) {
    const quote = state.quotes[ticker];
    const p = resolvePrice(ticker, (state.bars[ticker] ?? []).filter((b) => b.date <= today),
      quote && quote.asOf.slice(0, 10) <= today ? quote : null, splits);
    if (p) prices[ticker] = p;
  }
  return { fifo, prices };
}

export function refreshInfo(ctx: AppContext) {
  return {
    hasKey: ctx.hasKey,
    status: ctx.cache.status,
    budget: { used: ctx.cache.budget.used(), remaining: ctx.cache.budget.remaining(), limit: ctx.cache.budget.limit },
    /** Newest stored daily bar, so the header has something to say before the first refresh of a session. */
    pricesThrough: ctx.q.listSecurities().reduce<string | null>((a, s) => (s.historyThrough && (!a || s.historyThrough > a) ? s.historyThrough : a), null),
    holdingsRefresh: { ...ctx.fundHoldings.status },
  };
}

export function exposureView(ctx: AppContext, opts: { method: CostMethod; accounts?: string[]; page?: ExposurePage }) {
  const state = loadState(ctx, opts.accounts);
  const ledger = runLedger(state.ledgerTransactions, state.splits, { method: opts.method, dividends: state.dividends });
  const { holdings } = computeHoldings({
    positions: ledger.positions, prices: currentPrices(state, ledger.positions.keys()),
    assetTypes: state.assetTypes, statuses: state.statuses,
  });
  const saved = new Map(holdings.filter((h) => Object.hasOwn(VANGUARD_FUNDS, h.ticker))
    .map((h) => [h.ticker, ctx.q.getFundHoldings(h.ticker)] as const));
  const snapshots: Record<string, FundSnapshot> = {};
  for (const [ticker, data] of saved) if (data?.snapshot) snapshots[ticker] = data.snapshot;
  const exposure = computeExposure({ holdings, securities: state.securities, snapshots, supportedFunds: Object.keys(VANGUARD_FUNDS) });
  const funds = exposure.funds.map((fund) => {
    const data = saved.get(fund.ticker);
    const status: 'unsupported' | 'fetching' | 'failed' | 'saved' | 'pending' = !fund.supported ? 'unsupported'
      : ctx.fundHoldings.status.pending.includes(fund.ticker) ? 'fetching'
      : data?.lastError ? 'failed' : data?.snapshot ? 'saved' : 'pending';
    return {
      ...fund, status,
      sourceUrl: fund.supported ? holdingsUrl(fund.ticker) : null,
      lastCheckedAt: data?.lastCheckedAt ?? null,
      lastAttemptAt: data?.lastAttemptAt ?? null,
      lastError: data?.lastError ?? null,
    };
  });
  const page = opts.page ?? { query: '', sort: { key: 'total', dir: 'desc' }, offset: 0, limit: 20 };
  const selected = selectExposureRows(exposure.rows, page);
  return {
    ...exposure, rows: selected.rows, rowCount: exposure.rows.length, filteredCount: selected.count,
    offset: selected.offset, limit: page.limit, funds, accounts: opts.accounts ?? null, holdingsRefresh: { ...ctx.fundHoldings.status },
    valuationWarnings: holdings.filter((h) => h.flag).map((h) => ({ ticker: h.ticker, flag: h.flag })),
    oversells: ledger.oversells,
  };
}

export function portfolioView(ctx: AppContext, opts: { assetType?: AssetType; method: CostMethod; accounts?: string[] }) {
  const state = loadState(ctx, opts.accounts);
  const ledger = runLedger(state.ledgerTransactions, state.splits, { method: opts.method, dividends: state.dividends });
  const prices = currentPrices(state, ledger.positions.keys());
  const { holdings, totals } = computeHoldings({
    positions: ledger.positions,
    prices,
    assetTypes: state.assetTypes,
    statuses: state.statuses,
    assetType: opts.assetType,
  });
  const realized = summarizeRealized(ledger.sales, { unrealizedGain: totals.gain, assetTypes: state.assetTypes, assetType: opts.assetType, dividends: ledger.dividends });
  const asOfs = holdings.filter((h) => h.priceAsOf && h.flag === null).map((h) => h.priceAsOf!);
  return {
    today: ctx.today(),
    method: opts.method,
    accounts: opts.accounts ?? null,
    assetType: opts.assetType ?? null,
    holdings,
    totals,
    realizedGain: realized.totalGain,
    realizedPlusUnrealized: realized.realizedPlusUnrealized,
    dividends: realized.dividends,
    totalReturn: realized.totalReturn,
    oversells: ledger.oversells,
    allocation: allocation(holdings, Object.fromEntries(state.securities.map((s) => [s.ticker, s.sector]))),
    pricesAsOf: asOfs.sort().pop() ?? null,
    flagged: holdings.filter((h) => h.flag).map((h) => ({ ticker: h.ticker, flag: h.flag })),
    transactionCount: state.transactions.length,
    refresh: refreshInfo(ctx),
  };
}

export function realizedView(ctx: AppContext, opts: { assetType?: AssetType; method: CostMethod; sort: SaleSort; accounts?: string[] }) {
  const state = loadState(ctx, opts.accounts);
  const ledger = runLedger(state.ledgerTransactions, state.splits, { method: opts.method, dividends: state.dividends });
  const keep = (t: string) => !opts.assetType || (state.assetTypes[t] ?? 'Stock') === opts.assetType;
  // Shares bought with each dividend (summed over accounts; null when it stayed cash).
  const bought = new Map<string, { shares: number; price: number }>();
  for (const r of state.drip.reinvestments) {
    const k = `${r.date} ${r.ticker}`;
    const b = bought.get(k);
    bought.set(k, { shares: (b?.shares ?? 0) + r.shares, price: r.price });
  }
  const dividendEvents = ledger.dividends
    .filter((d) => keep(d.ticker))
    .map((d) => {
      const b = bought.get(`${d.date} ${d.ticker}`);
      return { ...d, reinvestedShares: b?.shares ?? null, reinvestPrice: b?.price ?? null };
    });
  const { totals } = computeHoldings({
    positions: ledger.positions,
    prices: currentPrices(state, ledger.positions.keys()),
    assetTypes: state.assetTypes,
    statuses: state.statuses,
    assetType: opts.assetType,
  });
  const today = ctx.today();
  const preview = salePreviewState(state, today);
  const soon = turningLongTermSoon({ positions: preview.fifo.positions,
    prices: Object.fromEntries(Object.entries(preview.prices).map(([t, p]) => [t, p.price])), today });
  return {
    turningLongTermSoon: soon.filter((l) => keep(l.ticker)),
    method: opts.method,
    ...summarizeRealized(ledger.sales, { unrealizedGain: totals.gain, assetTypes: state.assetTypes, assetType: opts.assetType, sort: opts.sort, dividends: ledger.dividends }),
    unrealizedGain: totals.gain,
    dividendEvents: [...dividendEvents].reverse(),
    dividendYears: dividendsByYear(dividendEvents),
    taxYears:
      opts.method === 'fifo'
        ? taxYears(opts.assetType ? ledger.sales.filter((s) => (state.assetTypes[s.ticker] ?? 'Stock') === opts.assetType) : ledger.sales)
        : null,
  };
}

export function healthReport(ctx: AppContext, method: CostMethod = 'average') {
  const state = loadState(ctx);
  const ledger: Ledger = runLedger(state.ledgerTransactions, state.splits, { method });
  const calendar = (state.bars.SPY ?? []).map((b) => b.date);
  const traded = new Set(state.transactions.map((t) => t.ticker));
  const benchmarks = ctx.cache.benchmarkTickers();
  const txById = new Map(state.transactions.map((t) => [t.id, t]));
  return {
    today: ctx.today(),
    method,
    refresh: refreshInfo(ctx),
    securities: state.securities
      .filter((s) => traded.has(s.ticker) || benchmarks.includes(s.ticker))
      .map((s) => ({
        ...s,
        held: ledger.positions.has(s.ticker),
        benchmark: benchmarks.includes(s.ticker),
        bars: state.bars[s.ticker]?.length ?? 0,
      })),
    splits: state.splits,
    splitCheck: splitCrossCheck(ctx.q.listImportedSplits(), state.splits, calendar),
    oversells: ledger.oversells.map((o) => ({ ...o, seq: txById.get(o.txId)?.seq ?? null })),
    priceGaps: calendar.length ? Object.entries(state.bars).flatMap(([t, b]) => (t === 'SPY' ? [] : priceGaps(t, b, calendar))) : [],
    priceWarnings: priceSanity(state.transactions, state.bars),
    sheetMirror: mirrorCheck(state),
    /** Dividends that couldn't be reinvested for want of a close near the ex-date. */
    cashDividends: state.drip.cash.filter((c) => c.reason === 'no close'),
  };
}

/** Trading calendar: SPY's bar dates, or every stored bar date if SPY is not loaded yet. */
function calendarFor(state: State, today: string): string[] {
  if (!state.transactions.length) return [];
  const first = state.transactions.reduce((a, t) => (t.date < a ? t.date : a), state.transactions[0].date);
  const spy = state.bars.SPY?.map((b) => b.date);
  const dates = spy?.length ? spy : [...new Set(Object.values(state.bars).flatMap((b) => b.map((x) => x.date)))].sort();
  return buildCalendar(dates, first, today);
}

export function seriesFor(ctx: AppContext, state: State, method: CostMethod, calendar = calendarFor(state, ctx.today())): DayPoint[] {
  return dailySeries({
    transactions: state.ledgerTransactions,
    splits: state.splits,
    dividends: state.dividends,
    bars: state.bars,
    quotes: state.quotes,
    calendar,
    unresolved: state.securities.filter((s) => s.status === 'unresolved').map((s) => s.ticker),
    method,
  });
}

/** Benchmark closes on each calendar day (carried forward; today from the quote). */
function benchmarkCloses(state: State, ticker: string, calendar: string[]): (number | null)[] {
  const bars = state.bars[ticker] ?? [];
  const q = state.quotes[ticker];
  let i = -1;
  return calendar.map((d) => {
    while (i + 1 < bars.length && bars[i + 1].date <= d) i++;
    if (q && q.asOf.slice(0, 10) === d && (i < 0 || bars[i].date !== d)) return q.last;
    return i >= 0 ? bars[i].close : null;
  });
}

/**
 * Benchmark data for a range. Total return reinvests the benchmark's own
 * dividends at the ex-date close (spec 13.4); price return is kept alongside.
 */
function benchmarkData(state: State, calendar: string[], from: string, to: string, benchmarks: string[]) {
  const firstIn = calendar.findIndex((d) => d >= from);
  const portfolioStart = state.transactions[0]?.date;
  const effectiveStart = portfolioStart && portfolioStart > from ? portfolioStart : from;
  const lastIn = calendar.reduce((a, d, i) => (d <= to ? i : a), -1);
  return Object.fromEntries(
    benchmarks.map((b) => {
      const bars = state.bars[b] ?? [];
      const dividends = state.dividends.filter((d) => d.ticker === b);
      const splits = state.splits.filter((s) => s.ticker === b);
      const shadow = shadowBenchmark({ transactions: state.transactions, splits: state.splits, bars, calendar, quote: state.quotes[b], dividends,
        range: b === 'SPY' ? { from, to } : undefined, benchmarkSplits: splits });
      const levels = totalReturnLevels(bars, dividends, calendar, state.quotes[b], splits);
      // From the level the day before the range starts (or its first day).
      const base = firstIn < 0 ? null : (levels[firstIn - 1] ?? levels[firstIn]);
      const end = lastIn >= firstIn && firstIn >= 0 ? levels[lastIn] : null;
      return [
        b,
        {
          bars,
          shadow,
          levels,
          base,
          closes: benchmarkCloses(state, b, calendar),
          priceReturn: priceChange(b, bars, splits, from, to, state.quotes[b] ?? null)?.change ?? null,
          totalReturn: base && end != null && bars[0]?.date <= addDays(effectiveStart, 7) ? end / base - 1 : null,
          available: bars.length > 0,
          firstDate: bars[0]?.date ?? null,
          error: state.securities.find((s) => s.ticker === b)?.lastError ?? null,
          shadowAvailable: bars.length > 0 && state.transactions.length > 0 && bars[0].date <= addDays(state.transactions[0].date, 7),
        },
      ];
    }),
  );
}

export function seriesView(ctx: AppContext, opts: { from?: string; to?: string; method: CostMethod; accounts?: string[] }) {
  const state = loadState(ctx, opts.accounts);
  const calendar = calendarFor(state, ctx.today());
  const series = seriesFor(ctx, state, opts.method, calendar);
  const from = opts.from ?? series[0]?.date ?? ctx.today();
  const to = opts.to ?? ctx.today();
  const benchmarks = ctx.cache.benchmarkTickers();
  const bench = benchmarkData(state, calendar, from, to, benchmarks);
  const twr = new Map(twrIndex(series, from, to).map((p) => [p.date, p.index - 1]));
  const days = series
    .map(({ byTicker, ...rest }, i) => ({
      ...rest,
      twr: twr.get(rest.date) ?? null,
      benchmarks: Object.fromEntries(
        benchmarks.map((b) => {
          const level = bench[b].levels[i];
          const b0 = bench[b].base;
          // Total return from the range start, dividends reinvested.
          return [b, {
            close: bench[b].closes[i],
            pct: level != null && b0 ? level / b0 - 1 : null,
            shadowValue: bench[b].shadowAvailable ? bench[b].shadow.days[i]?.value ?? null : null,
          }];
        }),
      ),
    }))
    .filter((p) => p.date >= from && p.date <= to);
  return {
    firstDate: series[0]?.date ?? null,
    lastDate: series.at(-1)?.date ?? null,
    from,
    to,
    days,
    summary: rangeSummary(series, from, to),
    benchmarks: Object.fromEntries(benchmarks.map((b) => [b, { available: bench[b].available, priceReturn: bench[b].priceReturn, totalReturn: bench[b].totalReturn }])),
    incompleteDays: days.filter((p) => p.incomplete).length,
  };
}

/** Return figures and benchmark comparison for a range. */
export function performanceView(ctx: AppContext, opts: { from?: string; to?: string; method: CostMethod; accounts?: string[] }) {
  const state = loadState(ctx, opts.accounts);
  const calendar = calendarFor(state, ctx.today());
  const series = seriesFor(ctx, state, opts.method, calendar);
  const from = opts.from ?? series[0]?.date ?? ctx.today();
  const to = opts.to ?? ctx.today();
  const benchmarks = ctx.cache.benchmarkTickers();
  const bench = benchmarkData(state, calendar, from, to, benchmarks);
  const summary = rangeSummary(series, from, to);
  const last = series.at(-1);
  const returns = dailyReturns(series);
  const idx = twrIndex(series, from, to, returns);
  const endDay = series.filter((p) => p.date <= to).at(-1);
  const holdings = Object.entries(endDay?.byTicker ?? {})
    .filter(([, d]) => d.shares > 0)
    .map(([ticker, d]) => ({
      ticker,
      assetType: state.assetTypes[ticker] ?? 'Stock',
      shares: d.shares,
      value: d.value,
      price: priceChange(ticker, state.bars[ticker] ?? [], state.splits, from, to, state.quotes[ticker] ?? null),
    }))
    .sort((a, b) => b.value - a.value);
  const mask = investedMask(series);
  const inRange = series.map((p) => p.date >= from && p.date <= to);
  const dd = drawdown(idx);
  const twr = idx.length ? idx[idx.length - 1].index - 1 : null;
  const years = summary.from && summary.to ? (Date.parse(summary.to) - Date.parse(summary.from)) / (365 * 86_400_000) : 0;
  const breakdown = (keep: (t: Transaction) => boolean) => {
    const subset = {
      ...state,
      transactions: state.transactions.filter(keep),
      ledgerTransactions: state.ledgerTransactions.filter(keep),
    };
    const days = seriesFor(ctx, subset, opts.method, calendar);
    const index = twrIndex(days, from, to);
    const investedInRange = investedMask(days).some((v, i) => v && days[i].date >= from && days[i].date <= to);
    return {
      ...rangeSummary(days, from, to),
      twr: index.length && investedInRange ? index.at(-1)!.index - 1 : null,
      incompleteDays: days.filter((d) => d.date >= from && d.date <= to && d.incomplete).length,
    };
  };
  const groups = (['Stock', 'ETF'] as const).map((assetType) => ({ assetType, ...breakdown((t) => (state.assetTypes[t.ticker] ?? 'Stock') === assetType) }));
  const accounts = [...new Set(state.transactions.map((t) => t.account))].sort().map((account) => ({ account, ...breakdown((t) => t.account === account) }));
  const today = ctx.today();
  return {
    moneyAdded: moneyAdded({ transactions: state.ledgerTransactions, splits: state.splits, today, value: last?.value ?? 0 }),
    from,
    to,
    summary,
    twr,
    twrAnnualized: twr !== null && years >= 1 ? (1 + twr) ** (1 / years) - 1 : null,
    irr: rangeIrr(series, from, to),
    volatility: volatility(returns, mask.map((m, i) => m && inRange[i])),
    drawdown: { max: dd.max, peakDate: dd.maxPeakDate, troughDate: dd.maxTroughDate, current: dd.current, series: dd.series },
    contribution: contribution(series, from, to).map((c) => {
      const firstTrade = state.transactions.find((t) => t.ticker === c.ticker);
      const priced = !series.some((p, i) => {
        const inRange = p.date >= from && p.date <= to;
        const openingDay = p.date < from && series[i + 1]?.date >= from;
        const position = p.byTicker[c.ticker];
        return (inRange || openingDay) && position?.shares > 0 && !position.priced;
      });
      const available = priced && bench.SPY.available && firstTrade && bench.SPY.bars[0].date <= addDays(firstTrade.date, 7);
      const spyGain = available ? (bench.SPY.shadow.rangeGains[c.ticker] ?? null) : null;
      return { ...c, spyGain, aheadOfSpy: spyGain === null ? null : c.gain - spyGain };
    }),
    groups,
    accounts,
    months: monthlyReturns(series, from, to),
    incompleteDays: series.filter((p) => p.date >= from && p.date <= to && p.incomplete).length,
    holdings,
    portfolio: {
      value: last?.value ?? 0,
      cost: last?.cost ?? 0,
      unrealized: (last?.value ?? 0) - (last?.cost ?? 0),
      realized: last?.realized ?? 0,
      dividends: last?.dividendsCum ?? 0,
    },
    benchmarks: Object.fromEntries(
      benchmarks.map((b) => {
        const { shadow, priceReturn: pr, totalReturn: tr, available, firstDate, error, shadowAvailable } = bench[b];
        // The shadow's gain over the range, on the same convention as the portfolio's.
        const sd = shadow.days;
        const inRange = sd.filter((d) => d.date >= from && d.date <= to);
        const before = sd.filter((d) => d.date < from).at(-1);
        const flows = inRange.reduce((acc, d) => acc - d.buys + d.sells, 0);
        const rangeGain = inRange.length ? inRange.at(-1)!.value - (before?.value ?? 0) + flows : 0;
        return [
          b,
          {
            available,
            firstDate,
            error,
            shadowAvailable,
            priceReturn: pr,
            totalReturn: tr,
            shadow: {
              value: shadow.value,
              cost: shadow.cost,
              unrealized: shadow.unrealized,
              realized: shadow.realized,
              dividends: shadow.dividends,
              total: shadow.unrealized + shadow.realized,
              rangeGain,
            },
          },
        ];
      }),
    ),
  };
}

/** Ticker detail uses the same selected accounts and ledger method as the rest of the app. */
export function tickerView(ctx: AppContext, ticker: string, opts: { from?: string; to?: string; method: CostMethod; accounts?: string[] }) {
  const security = ctx.q.getSecurity(ticker);
  if (!security) return null;
  const state = loadState(ctx, opts.accounts);
  state.transactions = state.transactions.filter((t) => t.ticker === ticker);
  state.ledgerTransactions = state.ledgerTransactions.filter((t) => t.ticker === ticker);
  const to = opts.to ?? ctx.today();
  const bars = state.bars[ticker] ?? [];
  const from = opts.from ?? state.transactions[0]?.date ?? bars[0]?.date ?? to;
  const splits = state.splits.filter((s) => s.ticker === ticker);
  const ledger = runLedger(state.ledgerTransactions, splits, { method: opts.method, asOf: to, dividends: state.dividends });
  const quote = state.quotes[ticker];
  const asOfQuote = quote && quote.asOf.slice(0, 10) <= to ? quote : null;
  const prices = splitAdjustedBars(bars, splits, to).filter((b) => b.date >= from);
  if (asOfQuote && asOfQuote.asOf.slice(0, 10) >= from && asOfQuote.asOf.slice(0, 10) > (prices.at(-1)?.date ?? '')) {
    prices.push({ date: asOfQuote.asOf.slice(0, 10), close: asOfQuote.last });
  }
  const pricePoint = resolvePrice(ticker, bars.filter((b) => b.date <= to), asOfQuote, splits);
  const { holdings } = computeHoldings({ positions: ledger.positions, prices: pricePoint ? { [ticker]: pricePoint } : {}, assetTypes: state.assetTypes, statuses: state.statuses });
  const trades = state.transactions.filter((t) => t.date >= from && t.date <= to);
  const restate = (date: string, price: number) => price / splitRatio(splits, date, to);
  // Weekend trades appear on the next stored price date, matching the daily replay calendar.
  const markers = trades.flatMap((t) => {
    const date = prices.find((p) => p.date >= t.date)?.date;
    return date ? [{ id: t.id, date, tradeDate: t.date, type: t.type, price: restate(t.date, t.price), account: t.account }] : [];
  });
  const today = ctx.today();
  const preview = salePreviewState(state, today);
  const average = runLedger(state.ledgerTransactions, splits, { method: 'average', asOf: today }).positions.get(ticker);
  return {
    sellPreview: { today, lots: preview.fifo.positions.get(ticker)?.lots ?? [], price: preview.prices[ticker] ?? null,
      averageCost: average ? average.cost / average.shares : undefined },
    ticker, security, from, to, method: opts.method,
    firstDate: bars[0]?.date ?? state.transactions[0]?.date ?? null,
    holding: holdings[0] ?? null,
    prices, markers, trades: [...trades].reverse(),
    lots: opts.method === 'fifo' ? ledger.positions.get(ticker)?.lots ?? [] : null,
    sales: ledger.sales.filter((s) => s.date >= from).reverse(),
    dividends: state.drip.reinvestments.filter((r) => r.ticker === ticker && r.date >= from && r.date <= to),
    cashDividends: state.drip.cash.filter((r) => r.ticker === ticker && r.date >= from && r.date <= to),
    splits: splits.filter((s) => s.exDate >= from && s.exDate <= to),
    oversells: ledger.oversells,
  };
}

/** The sheet's benchmark method on SPY, shown on data health as a check figure. */
function mirrorCheck(state: State) {
  const bars = state.bars.SPY ?? [];
  if (!bars.length || !state.transactions.length) return null;
  const q = state.quotes.SPY;
  const current = q && q.asOf.slice(0, 10) > bars[bars.length - 1].date ? q.last : bars[bars.length - 1].close;
  const m = sheetMirror(state.transactions, closeLookup(bars), current);
  return { benchmark: 'SPY', units: m.units, cost: m.cost, unitsSold: m.unitsSold, realized: m.realized, unrealized: m.unrealized, missing: m.missing, negative: m.negative };
}
