import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('custom benchmark', () => {
  it('saves a selection, adds its history to the refresh plan and compares it without adding trades', async () => {
    const { seed, call, ctx } = testApp();
    await seed();
    const count = ctx.q.listTransactions().length;
    expect((await call('PUT', '/api/benchmark', { ticker: ' voo ' })).status).toBe(200);
    expect((await call('GET', '/api/config')).body.customBenchmark).toBe('VOO');
    expect(ctx.cache.benchmarkTickers()).toContain('VOO');
    expect(ctx.q.listTransactions()).toHaveLength(count);
    // Populate deterministic bars without another provider call.
    ctx.q.upsertBars('VOO', ctx.q.allBars().SPY);
    const p = (await call('GET', '/api/performance')).body;
    expect(p.benchmarks.VOO.available).toBe(true);
    const s = (await call('GET', '/api/series')).body;
    expect(s.days.at(-1).benchmarks.VOO.pct).toBeCloseTo(s.benchmarks.VOO.totalReturn, 9);
    expect((await call('PUT', '/api/benchmark', { ticker: null })).status).toBe(200);
    expect((await call('GET', '/api/config')).body.customBenchmark).toBeNull();
    expect(ctx.cache.benchmarkTickers()).not.toContain('VOO');
  });

  it('rejects malformed input and does not reclassify an owned stock as an ETF', async () => {
    const { seed, call, ctx } = testApp();
    await seed();
    expect((await call('PUT', '/api/benchmark', { ticker: '../x' })).status).toBe(400);
    expect((await call('PUT', '/api/benchmark', {})).status).toBe(400);
    expect((await call('PUT', '/api/benchmark', { ticker: 'TSLA' })).status).toBe(200);
    expect(ctx.q.getSecurity('TSLA')!.assetType).toBe('Stock');
  });

  it('withholds same-money comparisons when a benchmark starts after the trades', async () => {
    const { seed, call, ctx } = testApp();
    await seed();
    await call('PUT', '/api/benchmark', { ticker: 'QQQM' });
    const p = (await call('GET', '/api/performance')).body;
    expect(p.benchmarks.QQQM.shadowAvailable).toBe(false);
    expect(p.benchmarks.QQQM.totalReturn).toBeNull();
    const s = (await call('GET', '/api/series')).body;
    expect(s.days.every((d: any) => d.benchmarks.QQQM.pct === null)).toBe(true);
  });

  it('takes asset type from the first trade after a benchmark-only ticker, even after removing the benchmark', async () => {
    const { call, ctx } = testApp({ apiKey: null });
    await call('PUT', '/api/benchmark', { ticker: 'VOO' });
    await call('PUT', '/api/benchmark', { ticker: null });
    await call('POST', '/api/transactions', { ticker: 'VOO', assetType: 'ETF', type: 'Buy', shares: 1, price: 100, date: '2024-01-02', account: 'One' });
    expect(ctx.q.getSecurity('VOO')!.assetType).toBe('ETF');
    await call('PUT', '/api/securities/VOO', { assetType: 'Stock' });
    await call('POST', '/api/transactions', { ticker: 'VOO', assetType: 'ETF', type: 'Buy', shares: 1, price: 100, date: '2024-01-03', account: 'One' });
    expect(ctx.q.getSecurity('VOO')!.assetType).toBe('Stock'); // manual classification survives
  });
});
