import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

async function setup() {
  const t = testApp();
  await t.seed([
    'AAA\tStock\tBuy\t2\t\t10\t10/2/2025\tA',
    'AAA\tStock\tBuy\t3\t\t20\t10/3/2025\tB',
    'AAA\tStock\tSell\t1\t\t30\t9/1/2026\tA',
    'AAA\tStock\tBuy\t100\t\t1\t1/1/2027\tA',
    'BBB\tETF\tBuy\t1\t\t10\t10/3/2025\tA',
  ]);
  t.ctx.q.upsertBars('AAA', [{ date: '2026-10-01', close: 25 }]);
  return t;
}

describe('read-only sell estimates', () => {
  it('uses today and selected accounts independently of the chart range and method', async () => {
    const { call, ctx } = await setup();
    const before = ctx.q.listTransactions();
    const p = (await call('GET', '/api/ticker/AAA?from=2024-01-01&to=2025-01-01&account=A')).body;
    expect(p.holding).toBeNull(); // historical chart is before the buys
    expect(p.sellPreview.today).toBe('2026-10-02');
    expect(p.sellPreview.lots).toEqual([{ acquired: '2025-10-02', account: 'A', shares: 1, cost: 10 }]);
    expect(p.sellPreview.averageCost).toBe(10);
    expect(p.sellPreview.price.price).toBe(25);
    expect(ctx.q.listTransactions()).toEqual(before);
    const all = (await call('GET', '/api/ticker/AAA?method=fifo')).body;
    expect(all.sellPreview.lots.reduce((a: number, l: any) => a + l.shares, 0)).toBe(4);
    expect(all.sellPreview.averageCost).toBe(16); // pooled average cost, not FIFO
    const empty = (await call('GET', '/api/ticker/AAA?account=Nobody')).body;
    expect(empty.sellPreview.lots).toEqual([]);
  });

  it('includes upcoming remaining lots under either method and respects account/asset filters', async () => {
    const { call, ctx } = await setup();
    const before = ctx.q.listTransactions();
    const avg = (await call('GET', '/api/realized?account=A&assetType=Stock')).body;
    expect(avg.turningLongTermSoon).toEqual([
      { ticker: 'AAA', acquired: '2025-10-02', account: 'A', shares: 1, cost: 10, longTermDate: '2026-10-03', gain: 15 },
    ]);
    const fifo = (await call('GET', '/api/realized?account=A&assetType=Stock&method=fifo')).body;
    expect(fifo.turningLongTermSoon).toEqual(avg.turningLongTermSoon);
    const b = (await call('GET', '/api/realized?account=B')).body;
    expect(b.turningLongTermSoon).toHaveLength(1);
    expect(b.turningLongTermSoon[0].shares).toBe(3);
    const etf = (await call('GET', '/api/realized?account=A&assetType=ETF')).body;
    expect(etf.turningLongTermSoon).toMatchObject([{ ticker: 'BBB', gain: null }]);
    expect(ctx.q.listTransactions()).toEqual(before);
  });

  it('carries DRIP into ticker lots and groups soon rows within each selected account', async () => {
    const { call, ctx } = await setup();
    ctx.q.upsertDividends('AAA', [{ exDate: '2025-10-04', amount: 1 }, { exDate: '2025-11-01', amount: 1 }]);
    ctx.q.upsertBars('AAA', [{ date: '2025-10-04', close: 10 }, { date: '2025-11-01', close: 10 }]);
    const detail = (await call('GET', '/api/ticker/AAA')).body;
    expect(detail.sellPreview.lots.filter((l: any) => l.drip)).toHaveLength(4);
    const realized = (await call('GET', '/api/realized?account=A&assetType=Stock')).body;
    const rows = realized.turningLongTermSoon;
    expect(rows).toHaveLength(2); // one entered lot, one combined reinvestment row
    expect(rows[0].drip).toBeUndefined();
    expect(rows[1]).toMatchObject({ ticker: 'AAA', account: 'A', drip: true, reinvestedLots: 2,
      longTermDate: '2026-10-05', lastLongTermDate: '2026-11-02' });
    expect(rows[1].shares).toBeCloseTo(0.42);
    expect(rows[1].gain).toBeCloseTo(6.3);
  });

  it('includes reinvestment lots and exposes no price rather than a cost fallback', async () => {
    const { seed, call } = testApp();
    await seed(['SQ\tStock\tBuy\t1\t\t10\t1/1/2024\tA']);
    const vz = (await call('GET', '/api/ticker/VZ')).body;
    expect(vz.sellPreview.lots.some((l: any) => vz.dividends.some((d: any) => d.date === l.acquired))).toBe(true);
    const sq = (await call('GET', '/api/ticker/SQ')).body;
    expect(sq.sellPreview.price).toBeNull();
  });
});
