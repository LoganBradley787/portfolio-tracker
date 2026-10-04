import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import type { FundSnapshot } from '../../src/engine/exposure.ts';

const snapshot: FundSnapshot = {
  effectiveDate: '2026-08-31', holdings: [{ name: 'Apple Inc', ticker: 'AAPL', country: 'US', cusip: '037833100', sedol: '2046251', weight: 0.1 }],
};
function setup(autoRefresh = false) {
  const holdings = vi.fn(async () => snapshot);
  const ctx = createContext({ dbPath: ':memory:', autoRefresh, now: () => new Date('2026-10-03T16:00:00Z'), fundHoldingsProvider: { holdings } });
  const app = createApp(ctx);
  const buy = (ticker: string, shares: number, price: number, account: string, assetType: 'Stock' | 'ETF') => {
    ctx.q.insertTransaction({ ticker, type: 'Buy', shares, price, date: '2026-01-02', account }, assetType);
    ctx.q.upsertBars(ticker, [{ date: '2026-10-02', close: price }]);
    ctx.q.setSecurityStatus(ticker, { status: 'ok' });
  };
  const get = async (path: string) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    return res.json() as Promise<any>;
  };
  return { ctx, app, buy, get, holdings };
}

describe('exposure API', () => {
  it('uses the same account-filtered current valuations as Overview and scales with new prices', async () => {
    const { ctx, buy, get, holdings } = setup();
    buy('AAPL', 1, 100, 'One', 'Stock');
    buy('VOO', 10, 100, 'One', 'ETF');
    buy('VOO', 20, 100, 'Two', 'ETF');
    buy('QQQ', 10, 100, 'Two', 'ETF');
    await ctx.fundHoldings.refresh();
    const all = await get('/api/exposure');
    const one = await get('/api/exposure?account=One');
    const two = await get('/api/exposure?account=Two&method=fifo');
    expect(all.totalValue).toBe((await get('/api/portfolio')).totals.equity);
    expect(one.totalValue).toBe(1100);
    expect(one.rows[0]).toMatchObject({ direct: 100, throughFunds: { VOO: 100 }, total: 200 });
    expect(two.rows[0].total).toBe(200);
    expect(all.rows[0].total).toBe(one.rows[0].total + two.rows[0].total);
    expect(all.funds.find((f: any) => f.ticker === 'QQQ')).toMatchObject({ supported: false, unexpandedValue: 1000 });
    expect(all.funds.find((f: any) => f.ticker === 'VOO')).toMatchObject({ effectiveDate: '2026-08-31', status: 'saved', sourceUrl: expect.stringContaining('/0968/') });
    ctx.q.upsertBars('VOO', [{ date: '2026-10-02', close: 200 }]);
    expect((await get('/api/exposure?account=One')).rows[0].total).toBe(300);
    expect(holdings).toHaveBeenCalledTimes(1);
    expect((await get('/api/exposure?account=Nobody')).rows).toEqual([]);
    ctx.q.db.close();
  });

  it('searches, sorts and pages 10,000 exposures on the server with bounded responses', async () => {
    const { ctx, app, buy, get } = setup();
    buy('VT', 10, 100, 'One', 'Stock');
    const holdings = Array.from({ length: 10_000 }, (_, i) => ({
      name: i === 0 ? 'alpha' : i === 1 ? 'Beta' : `Company ${i}`,
      ticker: `T${i}`, country: 'US', cusip: `ID${i}`, sedol: '', weight: 0.0001,
    }));
    ctx.q.saveFundHoldings('VT', { ...snapshot, holdings }, '2026-10-03T16:00:00Z');
    const response = await app.request('/api/exposure');
    const body = await response.text();
    const first = JSON.parse(body);
    expect(first.rows).toHaveLength(20);
    expect(first).toMatchObject({ rowCount: 10_000, filteredCount: 10_000, offset: 0, limit: 20 });
    expect(body.length).toBeLessThan(20_000);
    const second = await get('/api/exposure?offset=20&sort=name&dir=asc');
    const names = await get('/api/exposure?sort=name&dir=asc');
    expect(names.rows.slice(0, 2).map((r: any) => r.name)).toEqual(['alpha', 'Beta']);
    expect(second.rows[0].id).not.toBe(names.rows[0].id);
    const found = await get('/api/exposure?search=ID9999');
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].tickers).toEqual(['T9999']);
    expect(found.totalValue).toBe(first.totalValue);
    expect(found.mappedValue).toBe(first.mappedValue);
    expect((await get('/api/exposure?limit=100000')).rows).toHaveLength(100);
    expect((await get('/api/exposure?offset=-5&limit=oops')).offset).toBe(0);
    const narrowed = await get('/api/exposure?search=ID9999&offset=20');
    expect(narrowed.offset).toBe(0);
    expect(narrowed.rows).toHaveLength(1);
    ctx.q.db.close();
  });

  it('reads only held snapshots and never re-plans while building source statuses', async () => {
    const { ctx, buy, get } = setup();
    buy('VOO', 1, 100, 'One', 'ETF');
    buy('VT', 1, 100, 'Two', 'ETF');
    const read = vi.spyOn(ctx.q, 'getFundHoldings');
    const plan = vi.spyOn(ctx.fundHoldings, 'plan');
    ctx.fundHoldings.status.state = 'running';
    ctx.fundHoldings.status.pending = ['VOO', 'VT'];
    const data = await get('/api/exposure?account=One');
    expect(read.mock.calls).toEqual([['VOO']]);
    expect(plan).not.toHaveBeenCalled();
    expect(data.funds[0].status).toBe('fetching');
    ctx.q.db.close();
  });

  it('returns cached data immediately while a holdings fetch runs, without needing a Tiingo key', async () => {
    const { ctx, buy, get, holdings } = setup(true);
    buy('VOO', 10, 100, 'One', 'ETF');
    let resolve!: (s: FundSnapshot) => void;
    holdings.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const waiting = await get('/api/exposure');
    expect(waiting.funds[0]).toMatchObject({ status: 'fetching', effectiveDate: null, unexpandedValue: 1000 });
    expect(waiting.holdingsRefresh.state).toBe('running');
    expect((await get('/api/refresh/status')).holdingsRefresh.state).toBe('running');
    resolve(snapshot);
    await ctx.fundHoldings.refresh();
    expect((await get('/api/exposure')).rows[0].total).toBe(100);
    ctx.q.db.close();
  });

  it('automatically checks from the shared status poll even if Exposure is not open', async () => {
    const { ctx, buy, get, holdings } = setup(true);
    buy('VOO', 10, 100, 'One', 'ETF');
    await get('/api/refresh/status');
    await ctx.fundHoldings.refresh();
    expect(holdings).toHaveBeenCalledTimes(1);
    expect((await get('/api/exposure')).rows[0].total).toBe(100);
    ctx.q.db.close();
  });

  it('keeps repeated active and idle status polls free of ledger and snapshot reads', async () => {
    const { ctx, buy, get, holdings } = setup(true);
    buy('VT', 1, 100, 'One', 'ETF');
    let resolve!: (s: FundSnapshot) => void;
    holdings.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const bars = vi.spyOn(ctx.q, 'allBars');
    const read = vi.spyOn(ctx.q, 'getFundHoldings');
    await get('/api/refresh/status');
    expect(bars).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) await get('/api/refresh/status');
    expect(bars).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    resolve(snapshot);
    await ctx.fundHoldings.refresh();
    bars.mockClear();
    read.mockClear();
    for (let i = 0; i < 5; i++) await get('/api/refresh/status');
    expect(bars).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    ctx.q.db.close();
  });

  it('shares current positions across Overview, fund expansion and quote planning after DRIP and splits', async () => {
    const { ctx, buy, get } = setup();
    buy('VOO', 1, 100, 'One', 'ETF');
    buy('SHOP', 1, 100, 'Two', 'Stock');
    for (const ticker of ['VOO', 'SHOP']) {
      ctx.q.upsertBars(ticker, [{ date: '2026-01-05', close: 100 }]);
      ctx.q.upsertDividends(ticker, [{ exDate: '2026-01-05', amount: 10 }]);
    }
    ctx.q.insertTransaction({ ticker: 'VOO', type: 'Sell', shares: 1, price: 100, date: '2026-01-06', account: 'One' });
    ctx.q.insertManualSplit({ ticker: 'SHOP', exDate: '2026-01-07', ratio: 2 });
    const portfolio = await get('/api/portfolio');
    expect(portfolio.holdings.map((h: any) => h.ticker)).toEqual(['SHOP']);
    expect(portfolio.holdings[0].shares).toBeCloseTo(2.2, 10);
    expect(ctx.fundHoldings.heldFunds()).toEqual([]);
    const quotes = ctx.cache.quoteSymbols().map((s) => s.ticker);
    expect(quotes).toContain('SHOP');
    expect(quotes).not.toContain('VOO');
    expect(ctx.cache.plan().find((p) => p.ticker === 'VOO')?.group).toBe('sold');
    expect((await get('/api/exposure')).rows.map((r: any) => r.tickers)).toEqual([['SHOP']]);
    expect((await get('/api/exposure?account=One&method=fifo')).rowCount).toBe(0);
    ctx.q.db.close();
  });

  it('shows failed fetches alongside dated saved holdings without silently dropping exposure', async () => {
    const { ctx, buy, get } = setup();
    buy('VOO', 10, 100, 'One', 'ETF');
    ctx.q.saveFundHoldings('VOO', snapshot, '2026-09-25T16:00:00Z');
    ctx.q.recordFundHoldingsFailure('VOO', '2026-10-03T16:00:00Z', 'HTTP 503');
    const r = await get('/api/exposure');
    expect(r.funds[0]).toMatchObject({ status: 'failed', lastError: 'HTTP 503', effectiveDate: '2026-08-31' });
    expect(r.rows[0].total).toBe(100);
    expect(r.holdingsRefresh.state).toBe('idle');
    ctx.q.db.close();
  });
});
