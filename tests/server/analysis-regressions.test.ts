import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

const buy = (ticker: string, date: string) => ({
  ticker, date, assetType: 'Stock', type: 'Buy', shares: 1, price: 10, account: 'One',
});

describe('portfolio analysis regressions', () => {
  it('keeps lifetime benchmark returns when the requested range starts before the portfolio', async () => {
    const { seed, call } = testApp();
    await seed();
    const all = (await call('GET', '/api/performance')).body;
    const early = (await call('GET', '/api/performance?from=2019-01-01')).body;
    const series = (await call('GET', '/api/series?from=2019-01-01')).body;
    for (const ticker of ['SPY', 'QQQ', 'VT']) {
      expect(early.benchmarks[ticker].totalReturn).not.toBeNull();
      expect(early.benchmarks[ticker].totalReturn).toBe(all.benchmarks[ticker].totalReturn);
      expect(series.days.at(-1).benchmarks[ticker].pct).toBeCloseTo(early.benchmarks[ticker].totalReturn, 9);
    }
  });

  it('withholds a benchmark that truly starts later than the portfolio, including SPY', async () => {
    const { call, ctx } = testApp({ apiKey: null });
    await call('POST', '/api/transactions', buy('ABC', '2024-01-02'));
    ctx.q.upsertBars('ABC', [{ date: '2024-01-02', close: 10 }]);
    for (const ticker of ['SPY', 'QQQ', 'VT']) {
      ctx.q.ensureSecurity(ticker);
      ctx.q.upsertBars(ticker, [{ date: '2024-02-01', close: 100 }, { date: '2024-02-02', close: 110 }]);
    }
    const p = (await call('GET', '/api/performance?from=2023-01-01')).body;
    for (const ticker of ['SPY', 'QQQ', 'VT']) expect(p.benchmarks[ticker].totalReturn).toBeNull();
  });

  it.each([
    ['weekend', '2024-01-06', '2024-01-08'],
    ['holiday', '2024-07-04', '2024-07-05'],
  ])('allows next trading-day prices after a first trade on a %s', async (_, tradeDate, barDate) => {
    const { call, ctx } = testApp({ apiKey: null });
    await call('POST', '/api/transactions', buy('ABC', tradeDate));
    for (const ticker of ['ABC', 'SPY', 'QQQ', 'VT']) {
      ctx.q.ensureSecurity(ticker);
      ctx.q.upsertBars(ticker, [{ date: barDate, close: 12 }]);
    }
    const p = (await call('GET', `/api/performance?from=${barDate}&to=${barDate}`)).body;
    for (const ticker of ['SPY', 'QQQ', 'VT']) expect(p.benchmarks[ticker].shadowAvailable).toBe(true);
    expect(p.contribution.find((c: any) => c.ticker === 'ABC').aheadOfSpy).not.toBeNull();
  });

  it('withholds a position comparison when its buy has no benchmark close yet', async () => {
    const { call, ctx } = testApp({ apiKey: null });
    await call('POST', '/api/transactions', buy('OLD', '2026-10-01'));
    await call('POST', '/api/transactions', buy('NEW', '2026-10-02'));
    ctx.q.ensureSecurity('SPY');
    ctx.q.upsertBars('SPY', [{ date: '2026-10-01', close: 100 }]);
    ctx.q.upsertBars('OLD', [{ date: '2026-10-01', close: 10 }]);
    ctx.q.upsertBars('NEW', [{ date: '2026-10-02', close: 12 }]);
    const p = (await call('GET', '/api/performance')).body;
    const row = p.contribution.find((c: any) => c.ticker === 'NEW');
    expect(row.gain).toBe(2);
    expect(row.spyGain).toBeNull();
    expect(row.aheadOfSpy).toBeNull();
  });

  it('keeps a benchmark placeholder classifiable after a name and sector edit', async () => {
    const { call, ctx } = testApp({ apiKey: null });
    await call('PUT', '/api/benchmark', { ticker: 'VOO' });
    await call('PUT', '/api/securities/VOO', { name: 'Vanguard', sector: 'Index', assetType: 'Stock' });
    await call('POST', '/api/transactions', { ...buy('VOO', '2024-01-02'), assetType: 'ETF' });
    expect(ctx.q.getSecurity('VOO')).toMatchObject({ assetType: 'ETF', name: 'Vanguard', sector: 'Index' });
  });
});
