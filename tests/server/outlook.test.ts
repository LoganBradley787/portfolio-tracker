import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('outlook (temporary databases only)', () => {
  it('reports the pace, expected dividend income and fund fees for the current holdings', async () => {
    const { seed, call, ctx } = testApp();
    await seed(['QQQM\tETF\tBuy\t1\t\t200\t3/2/2026\tMain', 'QQQM\tETF\tBuy\t1\t\t200\t8/3/2026\tMain']);
    ctx.q.saveFundSectors('QQQM', { stock: 1, bond: 0, sectors: { Technology: 1 }, expenseRatio: 0.0015 }, '2026-10-01T00:00:00.000Z');
    const o = (await call('GET', '/api/outlook')).body;
    const portfolio = (await call('GET', '/api/portfolio')).body;
    expect(o.value).toBeCloseTo(portfolio.totals.equity);
    // $400 added over the twelve complete months before October 2026.
    expect(o.pace).toEqual({ monthly: 400 / 12, months: 12 });

    const fund = portfolio.holdings.find((h: any) => h.ticker === 'QQQM');
    expect(o.fees.rows).toEqual([{ ticker: 'QQQM', value: fund.equity, expenseRatio: 0.0015, annualCost: fund.equity * 0.0015 }]);
    expect(o.fees.blendedRatio).toBeCloseTo((fund.equity * 0.0015) / portfolio.totals.equity);
    expect(o.fees.missing).toEqual([]);

    expect(o.income.rows.length).toBeGreaterThan(0);
    for (const r of o.income.rows) {
      const h = portfolio.holdings.find((x: any) => x.ticker === r.ticker);
      expect(r.shares).toBeCloseTo(h.shares);
      expect(r.annual).toBeCloseTo(r.perShare * h.shares);
    }
    expect(o.income.rows.map((r: any) => r.ticker)).toContain('KO');
    expect(o.income.rows.map((r: any) => r.ticker)).not.toContain('TSLA');
    expect(o.income.annual).toBeCloseTo(o.income.rows.reduce((a: number, r: any) => a + r.annual, 0));
    expect(o.income.yield).toBeCloseTo(o.income.annual / portfolio.totals.equity);
    const realized = (await call('GET', '/api/realized')).body;
    expect(o.income.received).toEqual(realized.dividendYears.map((y: any) => ({ year: y.year, total: y.total })));
  });

  it('lists a held fund with no published fee and follows the selected accounts', async () => {
    const { seed, call } = testApp();
    await seed();
    const o = (await call('GET', '/api/outlook')).body;
    expect(o.fees).toMatchObject({ annualCost: 0, missing: ['QQQM'] });
    const other = (await call('GET', '/api/outlook?account=Brokerage')).body;
    expect(other.fees.rows).toEqual([]);
    expect(other.value).toBeLessThan(o.value);
    const none = (await call('GET', '/api/outlook?account=Nobody')).body;
    expect(none).toMatchObject({ value: 0, transactionCount: 0, pace: { monthly: 0, months: 0 }, income: { rows: [], annual: 0, yield: null, received: [] } });
  });
});
