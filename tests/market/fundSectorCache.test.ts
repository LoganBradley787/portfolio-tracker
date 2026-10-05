import { describe, expect, it, vi } from 'vitest';
import { Queries } from '../../src/db/queries.ts';
import { openDatabase } from '../../src/db/migrate.ts';
import type { FundBreakdown } from '../../src/engine/allocation.ts';
import { FundSectorCache } from '../../src/market/fundSectorCache.ts';

const stocks: FundBreakdown = { stock: 1, bond: 0, sectors: { Technology: 0.6, Healthcare: 0.4 }, expenseRatio: 0.0003 };

function setup() {
  let time = new Date('2026-10-03T16:00:00Z');
  let answer: FundBreakdown | null | Error = stocks;
  const q = new Queries(openDatabase(':memory:'));
  const fundBreakdown = vi.fn(async (_symbol: string) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const cache = new FundSectorCache({ q, provider: { fundBreakdown }, now: () => time });
  const trade = (ticker: string, type: 'Buy' | 'Sell' = 'Buy', assetType: 'Stock' | 'ETF' = 'ETF') =>
    q.insertTransaction({ ticker, type, shares: 1, price: 100, date: '2026-01-02', account: 'One' }, assetType);
  return {
    q, fundBreakdown, cache, trade,
    answer: (next: FundBreakdown | null | Error) => { answer = next; },
    advance: (days: number) => { time = new Date(time.getTime() + days * 24 * 3_600_000); },
  };
}

describe('fund sector cache', () => {
  it('fetches held ETFs only: not stocks, sold funds or benchmarks', async () => {
    const { q, cache, trade, fundBreakdown } = setup();
    trade('VOO'); trade('TSLA', 'Buy', 'Stock');
    trade('QQQM'); trade('QQQM', 'Sell');
    q.ensureSecurity('SPY', 'ETF');
    await cache.refresh();
    expect(fundBreakdown.mock.calls.map(([s]) => s)).toEqual(['VOO']);
    expect(cache.breakdowns()).toEqual({ VOO: stocks });
    expect(cache.report()).toEqual([{ ticker: 'VOO', lastCheckedAt: '2026-10-03T16:00:00.000Z', lastError: null, stale: false }]);
    q.db.close();
  });

  it('refreshes weekly, not on every load', async () => {
    const { q, cache, trade, fundBreakdown, advance } = setup();
    trade('VOO');
    await cache.refresh();
    advance(6);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(1);
    advance(1);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(2);
    q.db.close();
  });

  it('keeps the old breakdown when a refresh fails, and retries after six hours', async () => {
    const { q, cache, trade, fundBreakdown, advance, answer } = setup();
    trade('VOO');
    await cache.refresh();
    advance(7);
    answer(new Error('Yahoo fund breakdown request failed (500)'));
    await cache.refresh();
    expect(cache.breakdowns()).toEqual({ VOO: stocks });
    expect(cache.report()[0]).toMatchObject({ lastCheckedAt: '2026-10-03T16:00:00.000Z', lastError: 'Yahoo fund breakdown request failed (500)', stale: false });
    advance(0.2);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(2);
    advance(0.1);
    answer(stocks);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(3);
    expect(cache.report()[0]).toMatchObject({ lastError: null, stale: false });
    q.db.close();
  });

  it('marks a breakdown stale after four weeks without a good refresh', async () => {
    const { q, cache, trade, advance, answer } = setup();
    trade('VOO');
    await cache.refresh();
    answer(new Error('down'));
    advance(28);
    expect(cache.report()[0].stale).toBe(false);
    advance(1);
    await cache.refresh();
    expect(cache.report()[0]).toMatchObject({ stale: true, lastError: 'down' });
    expect(cache.breakdowns()).toEqual({ VOO: stocks });
    q.db.close();
  });

  it('fetches again, once, a breakdown saved before fees were read', async () => {
    const { q, cache, trade, fundBreakdown, advance, answer } = setup();
    trade('VOO'); trade('BND');
    const { expenseRatio: _fee, ...legacy } = stocks;
    answer(legacy);
    await cache.refresh();
    expect(cache.expenseRatios()).toEqual({});
    answer({ ...stocks, expenseRatio: null });
    advance(0.2); // inside the retry window
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(2);
    advance(0.1);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(4);
    expect(cache.expenseRatios()).toEqual({ BND: null, VOO: null });
    advance(1);
    await cache.refresh();
    expect(fundBreakdown).toHaveBeenCalledTimes(4);
    q.db.close();
  });

  it('reports a fund with no breakdown as never refreshed', async () => {
    const { q, cache, trade, answer } = setup();
    trade('VOO');
    expect(cache.report()).toEqual([{ ticker: 'VOO', lastCheckedAt: null, lastError: null, stale: true }]);
    answer(null);
    await cache.refresh();
    expect(cache.breakdowns()).toEqual({});
    expect(cache.report()[0]).toMatchObject({ lastCheckedAt: null, stale: true, lastError: 'Yahoo has no sector breakdown for this fund' });
    q.db.close();
  });
});
