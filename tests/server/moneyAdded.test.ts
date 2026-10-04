import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('Performance money added', () => {
  it('shares the series final value when a split follows the last stored price', async () => {
    const { seed, call, ctx } = testApp();
    await seed(['AAA\tStock\tBuy\t2\t\t100\t1/1/2026\tA']);
    ctx.q.upsertBars('AAA', [{ date: '2026-10-01', close: 100 }]);
    ctx.q.insertManualSplit({ ticker: 'AAA', exDate: '2026-10-02', ratio: 2 });
    const p = (await call('GET', '/api/performance?account=A')).body;
    expect(p.portfolio.value).toBe(200); // series restates the prior close after the split
    expect(p.moneyAdded.value).toBe(p.portfolio.value);
    expect(p.moneyAdded.growth).toBe(0);
  });

  it('uses all history through today, selected accounts and current value under either method', async () => {
    const { seed, call } = testApp();
    await seed();
    const p = (await call('GET', '/api/performance?account=Main&from=2026-09-01&to=2026-09-30')).body;
    const current = (await call('GET', '/api/portfolio?account=Main')).body;
    expect(p.moneyAdded.value).toBeCloseTo(current.totals.equity);
    expect(p.moneyAdded.months[0].period).toBe('2020-03');
    expect(p.moneyAdded.months.at(-1).period).toBe('2026-10');
    expect(p.moneyAdded.added + p.moneyAdded.growth).toBeCloseTo(p.moneyAdded.value);
    const fifo = (await call('GET', '/api/performance?account=Main&method=fifo')).body;
    expect(fifo.moneyAdded).toEqual(p.moneyAdded);
    const empty = (await call('GET', '/api/performance?account=Nobody')).body;
    expect(empty.moneyAdded).toMatchObject({ months: [], years: [], added: 0, growth: 0, value: 0 });
  });
});
