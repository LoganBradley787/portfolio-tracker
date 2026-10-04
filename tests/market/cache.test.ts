import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/migrate.ts';
import { Queries, type TransactionInput } from '../../src/db/queries.ts';
import { MarketCache } from '../../src/market/cache.ts';
import { TiingoProvider } from '../../src/market/tiingo.ts';
import { fakeTiingo, type FakeOptions } from '../helpers/fakeTiingo.ts';
import { historyBars } from '../helpers/fixtures.ts';

// 12:30 in New York on Friday 2026-10-02; the fixtures end on 2026-10-01.
const T0 = Date.parse('2026-10-02T16:30:00.000Z');

let q: Queries;
let clock: number;
beforeEach(() => {
  q = new Queries(openDatabase(':memory:'));
  clock = T0;
});

function add(ticker: string, type: 'Buy' | 'Sell', date: string, shares = 1, price = 10) {
  q.insertTransaction({ ticker, type, shares, price, date, account: 'Main' } as TransactionInput);
}

function setup(opts: FakeOptions = {}, limit?: number) {
  const fake = fakeTiingo(opts);
  const cache = new MarketCache({ q, provider: new TiingoProvider('k', fake.fetchFn), now: () => new Date(clock), limit });
  return { fake, cache };
}

function seedPortfolio() {
  add('SHOP', 'Buy', '2022-06-27', 3, 373.21); // held
  add('SQ', 'Buy', '2021-01-04', 1, 200); // held, renamed: no data
  add('F', 'Buy', '2021-04-13', 40, 12.2); // sold
  add('F', 'Sell', '2021-05-10', 40, 13);
  add('DIS', 'Buy', '2020-03-10', 30, 111.46); // held
}

describe('MarketCache', () => {
  it('fetches benchmarks, then held, then sold (through the last sale)', async () => {
    seedPortfolio();
    const { fake, cache } = setup();
    const status = await cache.refresh();
    expect(status.error).toBeNull();
    expect(fake.historyCalls()).toEqual([
      { symbol: 'SPY', start: '2020-03-10', end: null },
      { symbol: 'QQQ', start: '2020-03-10', end: null },
      { symbol: 'VT', start: '2020-03-10', end: null },
      { symbol: 'DIS', start: '2020-03-10', end: null },
      { symbol: 'SHOP', start: '2022-06-27', end: null },
      { symbol: 'SQ', start: '2021-01-04', end: null },
      { symbol: 'F', start: '2021-04-13', end: '2021-05-10' },
    ]);
    expect(q.getSecurity('SQ')).toMatchObject({ status: 'unresolved' });
    expect(q.getSecurity('F')).toMatchObject({ status: 'ok', historyThrough: '2021-05-10' });
    expect(q.getSecurity('SHOP')).toMatchObject({ status: 'ok', historyThrough: '2026-10-01' });
    expect(q.listSplits()).toEqual([{ ticker: 'SHOP', exDate: '2022-06-29', ratio: 10, source: 'provider' }]);
    expect(q.getBars('SHOP')[0]).toEqual({ date: '2022-06-27', close: 373.21 });
    expect(q.listDividends('SPY').length).toBeGreaterThan(0);
    // One quote request first, for held tickers and benchmarks (not sold F). SQ is
    // still pending at that point; IEX simply has no quote for it.
    expect(fake.calls[0].url).toContain('/iex/');
    expect(new URL(fake.calls[0].url).searchParams.get('tickers')!.split(',').sort()).toEqual(['DIS', 'QQQ', 'SHOP', 'SPY', 'SQ', 'VT']);
    expect(q.listQuotes().map((x) => x.ticker)).toEqual(['DIS', 'SHOP', 'SPY']);
    expect(status).toMatchObject({ state: 'idle', done: 8, total: 8, pending: [] });
  });

  it('does not refetch fresh, sold or unresolved tickers', async () => {
    seedPortfolio();
    const { fake, cache } = setup();
    await cache.refresh();
    const before = fake.historyCalls().length;
    clock += 7 * 3_600_000; // past the 6-hour rule; history is through the previous weekday
    expect(cache.plan()).toEqual([]);
    await cache.refresh();
    expect(fake.historyCalls().length).toBe(before);
  });

  it('backfills at once when a trade is added before the stored history starts', async () => {
    add('F', 'Sell', '2021-05-10', 5, 13); // a sale with no buy on record yet
    const { fake, cache } = setup();
    await cache.refresh();
    expect(q.firstBarDate('F')).toBe('2021-05-10');
    clock += 60_000; // well inside the six-hour throttle
    expect(cache.plan().map((p) => p.ticker)).not.toContain('F');
    add('F', 'Buy', '2021-04-13', 5, 12.2); // the missing earlier buy
    expect(cache.plan().find((p) => p.ticker === 'F')).toMatchObject({ mode: 'backfill', start: '2021-04-13' });
    const before = fake.historyCalls().length;
    await cache.refresh();
    expect(fake.historyCalls().slice(before).map((c) => c.symbol)).toContain('F');
    expect(q.firstBarDate('F')).toBe('2021-04-13');
    expect(cache.plan().map((p) => p.ticker)).not.toContain('F'); // and not again
  });

  it('remembers a successful backfill for a benchmark launched after the portfolio, across restarts', async () => {
    add('DIS', 'Buy', '2020-03-10');
    q.setCustomBenchmark('QQQM');
    const { cache } = setup();
    await cache.refresh();
    expect(q.firstBarDate('QQQM')).toBe('2020-10-13');
    clock += 7 * 3_600_000;
    const restarted = setup().cache;
    expect(restarted.plan().find((p) => p.ticker === 'QQQM')).toBeUndefined();
    clock = Date.parse('2026-10-05T16:00:00.000Z');
    expect(restarted.plan().find((p) => p.ticker === 'QQQM')).toMatchObject({ mode: 'update' });
    add('DIS', 'Buy', '2019-01-02');
    expect(restarted.plan().find((p) => p.ticker === 'QQQM')).toMatchObject({ mode: 'backfill', start: '2019-01-02' });
    q.resetMarketData('QQQM');
    expect(restarted.plan().find((p) => p.ticker === 'QQQM')).toMatchObject({ mode: 'backfill' });
  });

  it('does not mark a failed backfill as covering its requested start', async () => {
    add('DIS', 'Buy', '2020-03-10');
    q.setCustomBenchmark('QQQM');
    const { cache } = setup({ override: { QQQM: new TypeError('offline') } });
    expect((await cache.refresh()).error).toMatchObject({ kind: 'network' });
    expect(q.getSecurity('QQQM')!.historyRequestedFrom).toBeNull();
    clock += 7 * 3_600_000;
    expect(cache.plan().find((p) => p.ticker === 'QQQM')).toMatchObject({ mode: 'backfill', start: '2020-03-10' });
  });

  it('does not mark an empty backfill as covering its requested start', async () => {
    add('DIS', 'Buy', '2020-03-10');
    q.setCustomBenchmark('QQQM');
    await setup({ override: { QQQM: [] } }).cache.refresh();
    expect(q.getSecurity('QQQM')).toMatchObject({ status: 'unresolved', historyRequestedFrom: null });
  });

  it('updates from history_through minus 5 trading days and upserts', async () => {
    add('SHOP', 'Buy', '2022-06-27', 3, 373.21);
    q.ensureSecurity('SPY');
    q.ensureSecurity('QQQ');
    q.ensureSecurity('VT');
    for (const t of ['SHOP', 'SPY', 'QQQ', 'VT']) {
      const bars = historyBars(t).filter((b) => b.date >= '2022-06-27' && b.date <= '2026-09-25');
      q.upsertBars(t, bars.map((b) => ({ date: b.date, close: b.close + 1000 }))); // wrong on purpose
      q.setSecurityStatus(t, { status: 'ok', historyThrough: '2026-09-25', lastHistoryFetch: '2026-09-25T22:00:00.000Z' });
    }
    const { fake, cache } = setup();
    await cache.refresh();
    expect(fake.historyCalls()).toEqual([
      { symbol: 'SPY', start: '2026-09-18', end: null },
      { symbol: 'QQQ', start: '2026-09-18', end: null },
      { symbol: 'VT', start: '2026-09-18', end: null },
      { symbol: 'SHOP', start: '2026-09-18', end: null },
    ]);
    const bars = q.getBars('SHOP');
    const real = Object.fromEntries(historyBars('SHOP').map((b) => [b.date, b.close]));
    expect(bars.at(-1)!.date).toBe('2026-10-01');
    expect(bars.find((b) => b.date === '2026-09-18')!.close).toBe(real['2026-09-18']); // upserted
    expect(bars.find((b) => b.date === '2026-09-17')!.close).toBe(real['2026-09-17'] + 1000); // untouched
    expect(q.getSecurity('SHOP')!.historyThrough).toBe('2026-10-01');
  });

  it('treats history as stale only before the previous US weekday', () => {
    add('SHOP', 'Buy', '2022-06-27');
    for (const t of ['SHOP', 'SPY', 'QQQ', 'VT']) {
      q.ensureSecurity(t);
      q.upsertBars(t, [{ date: '2022-06-27', close: 1 }]);
      q.setSecurityStatus(t, { status: 'ok', historyThrough: '2026-10-01', lastHistoryFetch: '2026-10-01T00:00:00.000Z' });
    }
    const { cache } = setup();
    expect(cache.plan()).toEqual([]);
    clock = Date.parse('2026-10-05T16:00:00.000Z'); // Monday: previous weekday is Friday 10-02
    expect(cache.plan().map((p) => p.ticker)).toEqual(['SPY', 'QQQ', 'VT', 'SHOP']);
  });

  it('stops at the request budget and leaves the rest pending', async () => {
    seedPortfolio();
    const { fake, cache } = setup({}, 3);
    const status = await cache.refresh();
    expect(fake.calls).toHaveLength(3); // quotes, SPY, QQQ
    expect(status.pending).toEqual(['VT', 'DIS', 'SHOP', 'SQ', 'F']);
    expect(status.resumesAt).toBe('2026-10-02T17:30:00.000Z');
    expect(status.lastSuccessAt).toBeNull();
    expect(q.getSecurity('DIS')!.status).toBe('pending');
  });

  it('keeps stored data and reports a network failure (review focus 5)', async () => {
    seedPortfolio();
    q.upsertBars('DIS', [{ date: '2020-03-10', close: 100 }]);
    const { cache } = setup({ override: { SPY: new TypeError('getaddrinfo ENOTFOUND') } });
    const status = await cache.refresh();
    expect(status.error).toMatchObject({ kind: 'network' });
    expect(q.getBars('DIS')).toEqual([{ date: '2020-03-10', close: 100 }]);
    expect(q.getSecurity('DIS')!.status).toBe('pending');
    expect(status.pending).toContain('DIS');
  });

  it('keeps stored data and reports a 429, counting it against the budget (review focus 5)', async () => {
    seedPortfolio();
    const { fake, cache } = setup({ override: { QQQ: 429 } });
    const status = await cache.refresh();
    expect(status.error).toMatchObject({ kind: 'rate-limit' });
    expect(fake.historyCalls().map((c) => c.symbol)).toEqual(['SPY', 'QQQ']);
    expect(q.getBars('SPY').length).toBeGreaterThan(1000);
    expect(cache.budget.used()).toBe(3);
  });

  it('reports a rejected key', async () => {
    seedPortfolio();
    const { cache } = setup({ quotesStatus: 401 });
    expect((await cache.refresh()).error).toMatchObject({ kind: 'auth' });
  });

  it('runs a single refresh at a time', async () => {
    seedPortfolio();
    const { fake, cache } = setup();
    const [a, b] = await Promise.all([cache.refresh(), cache.refresh()]);
    expect(a).toBe(b);
    expect(fake.historyCalls()).toHaveLength(7);
  });

  it('marks a held ticker with no recent prices as unresolved (delisted)', async () => {
    add('TWTR', 'Buy', '2024-01-02', 100, 2);
    const rows = historyBars('ZM')
      .filter((b) => b.date >= '2024-01-02' && b.date <= '2025-02-28')
      .map((b) => ({ date: `${b.date}T00:00:00.000Z`, close: b.close, splitFactor: 1, divCash: 0 }));
    const { cache } = setup({ override: { TWTR: rows } });
    await cache.refresh();
    expect(q.getSecurity('TWTR')).toMatchObject({ status: 'unresolved', historyThrough: '2025-02-28' });
    expect(q.getSecurity('TWTR')!.lastError).toMatch(/delisted or renamed/);
  });

  it('does nothing without a provider', async () => {
    seedPortfolio();
    const cache = new MarketCache({ q, provider: null, now: () => new Date(clock) });
    expect(cache.status.state).toBe('no-key');
    expect(cache.needsRefresh()).toBe(false);
    expect((await cache.refresh()).state).toBe('no-key');
  });
});
