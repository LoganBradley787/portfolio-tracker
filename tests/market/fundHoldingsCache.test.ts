import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Queries } from '../../src/db/queries.ts';
import { openDatabase } from '../../src/db/migrate.ts';
import { FundHoldingsCache } from '../../src/market/fundHoldingsCache.ts';
import type { FundSnapshot } from '../../src/engine/exposure.ts';

const snapshot: FundSnapshot = {
  effectiveDate: '2026-08-31', holdings: [{ name: 'Apple', ticker: 'AAPL', country: 'US', cusip: '037833100', sedol: '2046251', weight: 0.1 }],
};
function setup() {
  let time = new Date('2026-10-03T16:00:00Z');
  const q = new Queries(openDatabase(':memory:'));
  const holdings = vi.fn(async (_ticker: string) => snapshot);
  const create = () => new FundHoldingsCache({ q, provider: { holdings }, now: () => time });
  const cache = create();
  const buy = (ticker: string) => q.insertTransaction({ ticker, type: 'Buy', shares: 1, price: 100, date: '2026-01-02', account: 'One' }, 'ETF');
  return { q, holdings, create, cache, buy, advance: (hours: number) => { time = new Date(time.getTime() + hours * 3_600_000); } };
}

describe('fund holdings cache', () => {
  it('fetches only held supported funds, not benchmarks, sold funds, or unsupported ETFs', async () => {
    const { q, cache, buy, holdings } = setup();
    q.ensureSecurity('VT', 'ETF'); // benchmark-only
    buy('VOO'); buy('QQQ');
    await cache.refresh();
    expect(holdings.mock.calls.map(([t]) => t)).toEqual(['VOO']);
    expect(q.getFundHoldings('VOO')).toMatchObject({ snapshot, lastCheckedAt: '2026-10-03T16:00:00.000Z', lastError: null });
    q.insertTransaction({ ticker: 'VOO', type: 'Sell', shares: 1, price: 100, date: '2026-10-03', account: 'One' });
    expect(cache.heldFunds()).toEqual([]);
    expect(q.requestTimesSince('2000-01-01')).toEqual([]); // no Tiingo budget consumed
    q.db.close();
  });

  it('fetches supported funds with the default Stock asset type', async () => {
    const { q, cache, holdings } = setup();
    q.insertTransaction({ ticker: 'VT', type: 'Buy', shares: 1, price: 100, date: '2026-01-02', account: 'One' });
    await cache.refresh();
    expect(holdings).toHaveBeenCalledWith('VT');
    q.db.close();
  });

  it('logs background failures even when recording the provider failure throws', async () => {
    const { q, cache, buy, holdings } = setup();
    buy('VOO');
    holdings.mockRejectedValueOnce(new Error('Unavailable'));
    vi.spyOn(q, 'recordFundHoldingsFailure').mockImplementation(() => { throw new Error('Database failed'); });
    const refresh = cache.refresh.bind(cache);
    vi.spyOn(cache, 'refresh').mockImplementation(() => {
      const pending = refresh();
      void pending.catch(() => {}); // absorb the old implementation's unhandled rejection in this regression test
      return pending;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    cache.maybeRefresh();
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
      'Fund holdings background refresh failed', expect.objectContaining({ message: 'Database failed' }),
    ));
    log.mockRestore();
    q.db.close();
  });

  it('checks at most once per five minutes and plans without parsing snapshots', async () => {
    const { q, cache, buy, advance } = setup();
    buy('VT');
    q.saveFundHoldings('VT', snapshot, '2026-10-03T16:00:00.000Z');
    const plan = vi.spyOn(cache, 'plan');
    const bars = vi.spyOn(q, 'allBars');
    const read = vi.spyOn(q, 'getFundHoldings');
    cache.maybeRefresh();
    for (let i = 0; i < 20; i++) cache.maybeRefresh();
    expect(plan).toHaveBeenCalledTimes(1);
    expect(bars).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    advance(5 / 60);
    cache.maybeRefresh();
    expect(plan).toHaveBeenCalledTimes(2);
    await cache.refresh();
    q.db.close();
  });

  it('checks weekly, persists across cache restarts, and recomputes without refetching', async () => {
    const { q, cache, buy, holdings, create, advance } = setup();
    buy('VOO');
    await cache.refresh();
    advance(24 * 6);
    await create().refresh();
    expect(holdings).toHaveBeenCalledTimes(1);
    advance(24);
    await create().refresh();
    expect(holdings).toHaveBeenCalledTimes(2);
    q.db.close();
  });

  it('retains last good data on failure and throttles failed attempts across restarts', async () => {
    const { q, cache, buy, holdings, create, advance } = setup();
    buy('VOO');
    await cache.refresh();
    advance(24 * 7);
    holdings.mockRejectedValueOnce(new Error('HTTP 503'));
    await cache.refresh();
    expect(q.getFundHoldings('VOO')).toMatchObject({ snapshot, lastError: 'HTTP 503', lastCheckedAt: '2026-10-03T16:00:00.000Z' });
    await create().refresh();
    expect(holdings).toHaveBeenCalledTimes(2);
    advance(6);
    await create().refresh();
    expect(holdings).toHaveBeenCalledTimes(3);
    expect(q.getFundHoldings('VOO')?.lastError).toBeNull();
    q.db.close();
  });

  it('keeps failures independent across funds and reports missing first snapshots', async () => {
    const { q, cache, buy, holdings } = setup();
    buy('VOO'); buy('VT');
    holdings.mockRejectedValueOnce(new Error('Unavailable'));
    await cache.refresh();
    expect(q.getFundHoldings('VOO')).toMatchObject({ snapshot: null, lastError: 'Unavailable' });
    expect(q.getFundHoldings('VT')?.snapshot).toEqual(snapshot);
    expect(cache.status.state).toBe('idle');
    expect(cache.status.finishedAt).not.toBeNull();
    q.db.close();
  });

  it('rejects older or future snapshots and retains the good one', async () => {
    const { q, cache, buy, holdings, advance } = setup();
    buy('VOO');
    await cache.refresh();
    for (const date of ['2026-07-31', '2027-01-01']) {
      advance(24 * 7);
      holdings.mockResolvedValueOnce({ ...snapshot, effectiveDate: date });
      await cache.refresh();
      expect(q.getFundHoldings('VOO')?.snapshot).toEqual(snapshot);
      expect(q.getFundHoldings('VOO')?.lastError).toBeTruthy();
    }
    q.db.close();
  });

  it('joins concurrent refreshes so a fund is requested once', async () => {
    const { q, cache, buy, holdings } = setup();
    buy('VOO');
    let resolve!: (s: FundSnapshot) => void;
    holdings.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const first = cache.refresh();
    const second = cache.refresh();
    expect(cache.status.state).toBe('running');
    resolve(snapshot);
    await Promise.all([first, second]);
    expect(holdings).toHaveBeenCalledTimes(1);
    q.db.close();
  });

  it('keeps a fully sold DRIP position closed, matching the portfolio convention', () => {
    const { q, cache, buy } = setup();
    buy('VOO');
    q.upsertBars('VOO', [{ date: '2026-01-05', close: 100 }]);
    q.upsertDividends('VOO', [{ exDate: '2026-01-05', amount: 10 }]);
    q.insertTransaction({ ticker: 'VOO', type: 'Sell', shares: 1, price: 100, date: '2026-01-06', account: 'One' });
    expect(cache.heldFunds()).toEqual([]);
    q.db.close();
  });

  it('upgrades v3 with a backup, preserves trades, and retains snapshots on reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-fund-cache-'));
    try {
      const path = join(dir, 'portfolio.db');
      const db = openDatabase(path);
      db.exec('DROP TABLE fund_holdings_cache; DELETE FROM schema_version WHERE version > 3');
      const q = new Queries(db);
      q.insertTransaction({ ticker: 'VOO', type: 'Buy', shares: 1, price: 100, date: '2026-01-02', account: 'One' }, 'ETF');
      const trades = q.listTransactions();
      db.close();
      const upgraded = openDatabase(path);
      const next = new Queries(upgraded);
      expect(next.listTransactions()).toEqual(trades);
      next.saveFundHoldings('VOO', snapshot, '2026-10-03T16:00:00.000Z');
      next.recordFundHoldingsFailure('VOO', '2026-10-10T16:00:00.000Z', 'Unavailable');
      upgraded.close();
      const reopened = openDatabase(path);
      expect(new Queries(reopened).getFundHoldings('VOO')).toMatchObject({ snapshot, lastError: 'Unavailable' });
      expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
