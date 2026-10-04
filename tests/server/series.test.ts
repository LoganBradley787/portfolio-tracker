import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('/api/series', () => {
  it('replays the sample day by day on the SPY calendar through today', async () => {
    const { call, seed } = testApp();
    await seed();
    const { status, body } = await call('GET', '/api/series');
    expect(status).toBe(200);
    expect(body.firstDate).toBe('2020-03-10');
    expect(body.lastDate).toBe('2026-10-02'); // today, from quotes
    expect(body.days[0]).toMatchObject({ date: '2020-03-10', buys: expect.closeTo(3343.8, 6), incomplete: false });
    expect(body.days[0].byTicker).toBeUndefined();
    expect(body.incompleteDays).toBe(0);
  });

  it('full-range gain equals realized + unrealized + dividends on the portfolio page', async () => {
    const { call, seed } = testApp();
    await seed();
    const s = (await call('GET', '/api/series')).body;
    const p = (await call('GET', '/api/portfolio')).body;
    expect(s.summary.startValue).toBe(0);
    expect(s.summary.endValue).toBeCloseTo(p.totals.equity, 6);
    expect(p.dividends).toBeGreaterThan(0);
    expect(s.summary.dividends).toBeCloseTo(p.dividends, 6);
    expect(s.summary.gain).toBeCloseTo(p.totalReturn, 6);
    expect(p.totalReturn).toBeCloseTo(p.realizedPlusUnrealized + p.dividends, 9);
  });

  it('limits to a range and reports the range gain', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/series?from=2022-06-27&to=2022-07-01');
    expect(body.days.map((d: any) => d.date)).toEqual(['2022-06-27', '2022-06-28', '2022-06-29', '2022-06-30', '2022-07-01']);
    const d = Object.fromEntries(body.days.map((x: any) => [x.date, x]));
    expect(body.summary.buys).toBeCloseTo(3 * 373.21 + 4 * 111.87, 6);
    expect(body.summary.gain).toBeCloseTo(d['2022-07-01'].value - body.summary.startValue - body.summary.buys, 6);
    expect((await call('GET', '/api/series?from=nope')).status).toBe(400);
  });
});

describe('benchmarks in the API', () => {
  it('adds SPY, QQQ and VT closes and shadow values to each day', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/series?from=2020-03-10&to=2020-03-11');
    expect(body.days[0].benchmarks.SPY.close).toBeGreaterThan(0);
    expect(body.days[0].benchmarks.SPY.shadowValue).toBeCloseTo(3343.8, 6); // bought at that close
    expect(body.benchmarks.QQQ.available).toBe(true);
    expect(body.benchmarks.VT.available).toBe(true);
    expect(typeof body.days[1].benchmarks.VT.pct).toBe('number');
    expect(typeof body.benchmarks.SPY.priceReturn).toBe('number');
  });

  it('/api/performance compares the portfolio with the shadow benchmarks', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/performance');
    const p = (await call('GET', '/api/portfolio')).body;
    expect(body.portfolio.cost).toBeCloseTo(p.totals.cost, 6); // the sample's 12627.46 + reinvested dividends
    const spy = body.benchmarks.SPY;
    expect(spy.shadow.units).toBeUndefined();
    expect(spy.shadow.value).toBeGreaterThan(0);
    expect(spy.shadow.total).toBeCloseTo(spy.shadow.unrealized + spy.shadow.realized, 9);
    // Over the full range the shadow's range gain is its total gain.
    expect(spy.shadow.rangeGain).toBeCloseTo(spy.shadow.total, 6);
  });

  it('shows the sheet-compatible mirror on data health', async () => {
    const { call, seed } = testApp();
    await seed();
    const h = (await call('GET', '/api/health-report')).body;
    expect(h.sheetMirror).toMatchObject({ benchmark: 'SPY', negative: false, missing: 0 });
    expect(h.sheetMirror.unitsSold).toBeGreaterThan(0);
  });
});

describe('history fields for the charts', () => {
  it('gives a TWR and benchmark % per day from the range start', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/series?from=2024-01-02&to=2024-12-31');
    const first = body.days[0];
    expect(first.twr).not.toBeNull();
    expect(Math.abs(first.benchmarks.SPY.pct)).toBeLessThan(0.05);
    const last = body.days.at(-1);
    // Benchmark lines are total return (dividends reinvested), above price return.
    expect(last.benchmarks.SPY.pct).toBeCloseTo(body.benchmarks.SPY.totalReturn, 9);
    expect(body.benchmarks.SPY.totalReturn).toBeGreaterThan(body.benchmarks.SPY.priceReturn);
  });

  it('/api/performance lists held tickers with split-aware price change', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/performance?from=2022-06-01&to=2022-12-31');
    const shop = body.holdings.find((h: any) => h.ticker === 'SHOP');
    expect(shop.shares).toBe(30);
    expect(shop.price.start).toBeLessThan(60); // restated to post-split
    expect(typeof body.twr).toBe('number');
    expect(body.holdings.find((h: any) => h.ticker === 'ZM')).toBeDefined();
  });
});

describe('/api/performance returns and risk', () => {
  it('reports IRR, volatility, drawdown and contribution that sums to the range gain', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/performance?from=2022-01-01&to=2026-10-02');
    expect(typeof body.irr).toBe('number');
    expect(body.volatility).toBeGreaterThan(0.05);
    expect(body.volatility).toBeLessThan(1);
    expect(body.drawdown.max).toBeLessThan(0);
    expect(body.drawdown.series.length).toBe(body.summary.days);
    const sum = body.contribution.reduce((a: number, c: any) => a + c.gain, 0);
    expect(sum).toBeCloseTo(body.summary.gain, 6);
    expect(body.twrAnnualized).not.toBeNull();
  });

  it('says n/a for IRR on a short range', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/performance?from=2026-09-20');
    expect(body.irr).toBeNull();
    expect(body.twrAnnualized).toBeNull();
  });
});

describe('dividends in the API', () => {
  it('lists dividend income on /api/realized, by event and by year', async () => {
    const { call, seed } = testApp();
    await seed();
    const r = (await call('GET', '/api/realized')).body;
    expect(r.dividends).toBeGreaterThan(0);
    expect(r.dividendEvents.length).toBeGreaterThan(0);
    expect(r.dividendEvents[0].date >= r.dividendEvents.at(-1).date).toBe(true); // newest first
    const byYear = r.dividendYears.reduce((a: number, y: any) => a + y.total, 0);
    expect(byYear).toBeCloseTo(r.dividends, 9);
    expect(r.totalReturn).toBeCloseTo(r.totalGain + r.unrealizedGain + r.dividends, 9);
    const etf = (await call('GET', '/api/realized?assetType=ETF')).body;
    expect(etf.dividendEvents.every((d: any) => d.ticker === 'QQQM')).toBe(true);
  });

  it('shows per-holding dividends on /api/portfolio', async () => {
    const { call, seed } = testApp();
    await seed();
    const p = (await call('GET', '/api/portfolio')).body;
    expect(p.holdings.find((h: any) => h.ticker === 'VZ').dividends).toBeGreaterThan(0);
    expect(p.holdings.find((h: any) => h.ticker === 'TSLA').dividends).toBe(0);
  });

  it('reinvests benchmark dividends in the shadow on /api/performance', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/performance');
    expect(body.benchmarks.SPY.shadow.dividends).toBeGreaterThan(0);
    expect(body.benchmarks.SPY.totalReturn).toBeGreaterThan(body.benchmarks.SPY.priceReturn);
    expect(body.portfolio.dividends).toBeCloseTo(body.summary.dividends, 6);
    const sum = body.contribution.reduce((a: number, c: any) => a + c.gain, 0);
    expect(sum).toBeCloseTo(body.summary.gain, 6);
  });
});
