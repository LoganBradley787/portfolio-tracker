import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

// The sample has two accounts: Main (DIS, KO, UBER, SHOP, QQQM, ZM) and
// Brokerage (TSLA incl. the one sale, DIS, VZ, AMD, F). DIS is in both.
const ACCOUNTS = ['Brokerage', 'Main'];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function seeded() {
  const app = testApp();
  await app.seed();
  const get = async (path: string) => (await app.call('GET', path)).body;
  return { ...app, get };
}

describe('one account at a time', () => {
  it('lists the accounts in /api/config', async () => {
    const { get } = await seeded();
    expect((await get('/api/config')).accounts).toEqual(ACCOUNTS);
  });

  it('/api/portfolio holds only that account’s positions', async () => {
    const { get } = await seeded();
    const main = await get('/api/portfolio?account=Main');
    expect(main.accounts).toEqual(['Main']);
    expect(main.holdings.map((h: any) => h.ticker).sort()).toEqual(['DIS', 'KO', 'QQQM', 'SHOP', 'UBER', 'ZM']);
    const dis = main.holdings.find((h: any) => h.ticker === 'DIS');
    expect(dis.shares).toBeGreaterThan(36); // 36 bought + reinvested dividends
    expect(dis.shares).toBeLessThan(38);
    expect(main.realizedGain).toBe(0); // the TSLA sale was in Brokerage
    const brokerage = await get('/api/portfolio?account=Brokerage');
    expect(brokerage.holdings.find((h: any) => h.ticker === 'DIS').shares).toBeGreaterThan(3);
    expect(brokerage.holdings.find((h: any) => h.ticker === 'DIS').shares).toBeLessThan(3.3);
    expect(brokerage.realizedGain).toBeCloseTo(170.88, 4);
    expect((await get('/api/portfolio')).accounts).toBeNull();
  });

  for (const method of ['average', 'fifo']) {
    it(`the accounts add up to All (${method})`, async () => {
      const { get } = await seeded();
      const all = await get(`/api/portfolio?method=${method}`);
      const parts = await Promise.all(ACCOUNTS.map((a) => get(`/api/portfolio?method=${method}&account=${a}`)));
      for (const k of ['equity', 'cost', 'gain'] as const) expect(sum(parts.map((p) => p.totals[k]))).toBeCloseTo(all.totals[k], 6);
      expect(sum(parts.map((p) => p.dividends))).toBeCloseTo(all.dividends, 6);
      expect(sum(parts.map((p) => p.realizedGain))).toBeCloseTo(all.realizedGain, 6);
      expect(sum(parts.map((p) => p.transactionCount))).toBe(all.transactionCount);
    });
  }

  it('/api/realized lists only that account’s sales and dividends', async () => {
    const { get } = await seeded();
    const main = await get('/api/realized?account=Main');
    expect(main.sales).toEqual([]);
    expect(new Set(main.dividendEvents.map((d: any) => d.ticker))).toEqual(new Set(['DIS', 'KO', 'QQQM']));
    const brokerage = await get('/api/realized?account=Brokerage&method=fifo');
    expect(brokerage.sales.map((s: any) => s.ticker)).toEqual(['TSLA']);
    expect(brokerage.taxYears).toHaveLength(1);
  });

  it('/api/series and /api/performance follow the account’s own trades', async () => {
    const { get } = await seeded();
    const all = await get('/api/series');
    const parts = await Promise.all(ACCOUNTS.map((a) => get(`/api/series?account=${a}`)));
    expect(parts[0].firstDate).toBe('2021-03-16'); // Brokerage's first trade
    expect(parts[1].firstDate).toBe('2020-03-10');
    expect(sum(parts.map((p) => p.summary.gain))).toBeCloseTo(all.summary.gain, 6);
    expect(sum(parts.map((p) => p.summary.endValue))).toBeCloseTo(all.summary.endValue, 6);

    const perfAll = await get('/api/performance');
    const perf = await Promise.all(ACCOUNTS.map((a) => get(`/api/performance?account=${a}`)));
    expect(sum(perf.map((p) => p.portfolio.value))).toBeCloseTo(perfAll.portfolio.value, 6);
    expect(sum(perf.map((p) => p.portfolio.dividends))).toBeCloseTo(perfAll.portfolio.dividends, 6);
    // Same money in SPY: each account's shadow mirrors only its own trades.
    expect(sum(perf.map((p) => p.benchmarks.SPY.shadow.cost))).toBeCloseTo(perfAll.benchmarks.SPY.shadow.cost, 6);
    expect(sum(perf.map((p) => p.benchmarks.SPY.shadow.value))).toBeCloseTo(perfAll.benchmarks.SPY.shadow.value, 6);
  });

  it('an account with no transactions renders empty instead of failing', async () => {
    const { call } = await seeded();
    for (const path of ['/api/portfolio', '/api/realized', '/api/series', '/api/performance']) {
      const r = await call('GET', `${path}?account=Nobody`);
      expect(r.status).toBe(200);
    }
    expect((await call('GET', '/api/portfolio?account=Nobody')).body.holdings).toEqual([]);
  });
});

describe('several accounts together', () => {
  // A third account holding one ticker of its own (UBER) and one shared (DIS).
  const THIRD = ['UBER\tStock\tBuy\t3\t\t40\t6/29/2022\tRetirement', 'DIS\tStock\tBuy\t2\t\t100\t6/29/2022\tRetirement'];
  const third = async () => {
    const app = testApp();
    await app.seed(THIRD);
    return { ...app, get: async (path: string) => (await app.call('GET', path)).body };
  };

  it('repeating ?account= shows those accounts and leaves the others out', async () => {
    const { get } = await third();
    expect((await get('/api/config')).accounts).toEqual(['Brokerage', 'Main', 'Retirement']);
    const one = await Promise.all(['Main', 'Retirement', 'Brokerage'].map((a) => get(`/api/portfolio?account=${a}`)));
    const two = await get('/api/portfolio?account=Main&account=Retirement');
    expect(two.accounts).toEqual(['Main', 'Retirement']);
    expect(two.totals.equity).toBeCloseTo(one[0].totals.equity + one[1].totals.equity, 6);
    expect(two.transactionCount).toBe(one[0].transactionCount + one[1].transactionCount);
    expect(two.holdings.map((h: any) => h.ticker)).not.toContain('TSLA'); // Brokerage only
    const all = await get('/api/portfolio');
    expect(all.accounts).toBeNull();
    expect(two.totals.equity + one[2].totals.equity).toBeCloseTo(all.totals.equity, 6);
  });

  it('series, performance and realized take the same selection', async () => {
    const { get } = await third();
    const q = 'account=Brokerage&account=Retirement';
    const parts = await Promise.all(['Brokerage', 'Retirement'].map((a) => get(`/api/series?account=${a}`)));
    const both = await get(`/api/series?${q}`);
    expect(both.firstDate).toBe('2021-03-16'); // Brokerage's first trade
    expect(both.summary.endValue).toBeCloseTo(sum(parts.map((p) => p.summary.endValue)), 6);
    const perf = await get(`/api/performance?${q}`);
    expect(perf.portfolio.value).toBeCloseTo(both.summary.endValue, 6);
    expect((await get(`/api/realized?${q}`)).sales.map((s: any) => s.ticker)).toEqual(['TSLA']);
    expect((await get('/api/realized?account=Main&account=Retirement')).sales).toEqual([]);
  });
});

