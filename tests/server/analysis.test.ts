import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('performance breakdowns', () => {
  it('includes a fully sold stock and compounds group returns rather than averaging holding gains', async () => {
    const { call, ctx } = testApp({ apiKey: null });
    for (const body of [
      { ticker: 'A', assetType: 'Stock', type: 'Buy', shares: 10, price: 10, date: '2024-01-02', account: 'One' },
      { ticker: 'E', assetType: 'ETF', type: 'Buy', shares: 10, price: 10, date: '2024-01-02', account: 'One' },
      { ticker: 'A', type: 'Sell', shares: 10, price: 12, date: '2024-01-03', account: 'One' },
    ]) expect((await call('POST', '/api/transactions', body)).status).toBe(201);
    ctx.q.upsertBars('SPY', [{ date: '2024-01-02', close: 100 }, { date: '2024-01-03', close: 100 }]);
    ctx.q.upsertBars('A', [{ date: '2024-01-02', close: 10 }, { date: '2024-01-03', close: 12 }]);
    ctx.q.upsertBars('E', [{ date: '2024-01-02', close: 10 }, { date: '2024-01-03', close: 8 }]);
    const p = (await call('GET', '/api/performance?from=2024-01-02&to=2024-01-03')).body;
    expect(p.groups[0]).toMatchObject({ assetType: 'Stock', endValue: 0, gain: 20 });
    expect(p.groups[0].twr).toBeCloseTo(0.2);
    expect(p.groups[1].twr).toBeCloseTo(-0.2);
  });
  it('does not claim an unpriced position beat SPY', async () => {
    const { seed, call } = testApp();
    await seed(['SQ\tStock\tBuy\t1\t\t10\t1/2/2024\tMain']);
    const p = (await call('GET', '/api/performance')).body;
    expect(p.contribution.find((c: any) => c.ticker === 'SQ').aheadOfSpy).toBeNull();
  });
  it('replays stocks and ETFs separately, including previously sold tickers', async () => {
    const { seed, call } = testApp();
    await seed();
    const p = (await call('GET', '/api/performance')).body;
    expect(p.groups.map((g: any) => g.assetType)).toEqual(['Stock', 'ETF']);
    expect(p.groups.reduce((a: number, g: any) => a + g.endValue, 0)).toBeCloseTo(p.summary.endValue, 6);
    expect(p.groups.reduce((a: number, g: any) => a + g.gain, 0)).toBeCloseTo(p.summary.gain, 6);
    expect(p.groups.every((g: any) => typeof g.twr === 'number')).toBe(true);
    expect(p.months.length).toBeGreaterThan(12);
  });

  it('per-position SPY gains sum to the portfolio shadow gain over a partial range', async () => {
    const { seed, call } = testApp();
    await seed();
    const p = (await call('GET', '/api/performance?from=2021-04-01&to=2022-07-15')).body;
    const sum = p.contribution.reduce((a: number, c: any) => a + c.spyGain, 0);
    expect(sum).toBeCloseTo(p.benchmarks.SPY.shadow.rangeGain, 6);
    for (const c of p.contribution) expect(c.aheadOfSpy).toBeCloseTo(c.gain - c.spyGain, 6);
  });

  it('compares accounts independently over the selected range and account selection', async () => {
    const { seed, call } = testApp();
    await seed();
    const path = '/api/performance?from=2024-01-01&to=2024-12-31';
    const p = (await call('GET', path)).body;
    expect(p.accounts.map((a: any) => a.account)).toEqual(['Brokerage', 'Main']);
    expect(p.accounts.reduce((sum: number, a: any) => sum + a.endValue, 0)).toBeCloseTo(p.summary.endValue, 6);
    for (const a of p.accounts) {
      const own = (await call('GET', `${path}&account=${a.account}`)).body;
      expect(a.twr).toBeCloseTo(own.twr, 9);
      expect(a.gain).toBeCloseTo(own.summary.gain, 6);
      expect(own.accounts).toHaveLength(1);
    }
  });
});
