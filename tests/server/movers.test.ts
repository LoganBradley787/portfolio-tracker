import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('what moved (temporary databases only)', () => {
  it('breaks the last day, week and month into holdings that add up', async () => {
    const { seed, call } = testApp();
    await seed();
    const m = (await call('GET', '/api/movers')).body;
    expect(m.today).toBe('2026-10-02');
    expect(m.asOf).toBe('2026-10-02');
    for (const period of ['day', 'week', 'month'] as const) {
      const p = m.periods[period];
      expect(p.to).toBe('2026-10-02');
      expect(p.movers.reduce((a: number, r: any) => a + r.gain, 0)).toBeCloseTo(p.gain, 6);
      expect(p.movers.map((r: any) => r.gain)).toEqual([...p.movers.map((r: any) => r.gain)].sort((a, b) => b - a));
    }
    expect(m.periods.day.from).toBe('2026-10-02');
    expect(m.periods.week.from >= '2026-09-26').toBe(true);
    expect(m.periods.month.from >= '2026-09-03').toBe(true);
    // The month agrees with the range gain the Overview chart reports.
    const series = (await call('GET', `/api/series?from=${m.periods.month.from}&to=2026-10-02`)).body;
    expect(m.periods.month.gain).toBeCloseTo(series.summary.gain, 6);
    // The day agrees with the holdings table's Today column for every holding quoted that day.
    const portfolio = (await call('GET', '/api/portfolio')).body;
    const quoted = portfolio.holdings.filter((h: any) => h.priceAsOf.startsWith(m.asOf));
    expect(quoted.length).toBeGreaterThan(0);
    expect(m.periods.day.movers.map((r: any) => r.ticker).sort()).toEqual(quoted.map((h: any) => h.ticker).sort());
    for (const h of quoted) expect(m.periods.day.movers.find((r: any) => r.ticker === h.ticker).gain).toBeCloseTo(h.dayChange, 6);
  });

  it('follows the selected accounts and reports nothing for an empty selection', async () => {
    const { seed, call } = testApp();
    await seed();
    const main = (await call('GET', '/api/movers?account=Main')).body;
    const tickers = main.periods.month.movers.map((r: any) => r.ticker);
    expect(tickers).toContain('QQQM');
    expect(tickers).not.toContain('TSLA');
    const none = (await call('GET', '/api/movers?account=Nobody')).body;
    expect(none).toMatchObject({ asOf: null, periods: { day: null, week: null, month: null } });
  });

  it('ends on the last priced day when today is not a trading day', async () => {
    const { seed, call, ctx } = testApp();
    await seed();
    // Friday's closes arrive; the weekend adds no prices.
    for (const quote of ctx.q.listQuotes()) ctx.q.upsertBars(quote.ticker, [{ date: '2026-10-02', close: quote.last }]);
    ctx.q.upsertBars('SPY', [{ date: '2026-10-02', close: ctx.q.allBars().SPY.at(-1)!.close }]);
    ctx.now = () => new Date('2026-10-04T16:30:00.000Z');
    ctx.today = () => '2026-10-04';
    const m = (await call('GET', '/api/movers')).body;
    expect(m.today).toBe('2026-10-04');
    expect(m.asOf).toBe('2026-10-02');
    expect(m.periods.day.to).toBe('2026-10-02');
  });
});

describe('trade markers on the value series', () => {
  it('lists entered trades and splits of held tickers on the day they land', async () => {
    const { seed, call } = testApp();
    await seed();
    const s = (await call('GET', '/api/series')).body;
    const on = (date: string) => s.events.find((e: any) => e.date === date);
    expect(on('2020-03-10')).toEqual({ date: '2020-03-10', buys: ['DIS'], sells: [], splits: [] });
    expect(on('2021-04-13')).toEqual({ date: '2021-04-13', buys: ['F'], sells: ['TSLA'], splits: [] });
    expect(on('2022-06-29')).toMatchObject({ buys: ['ZM'], splits: ['SHOP'] });
    expect(s.events.some((e: any) => e.splits.includes('TSLA'))).toBe(true);
    // Reinvested dividends are not trades.
    expect(s.events.flatMap((e: any) => e.buys).filter((t: string) => t === 'KO')).toHaveLength(1);
    const ranged = (await call('GET', '/api/series?from=2022-06-01&to=2022-06-30')).body;
    expect(ranged.events.map((e: any) => e.date)).toEqual(['2022-06-27', '2022-06-29']);
    const main = (await call('GET', '/api/series?account=Main')).body;
    expect(main.events.some((e: any) => e.sells.includes('TSLA') || e.splits.includes('TSLA'))).toBe(false);
  });
});
