import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('dividends paid as cash (?drip=off)', () => {
  it('derives no shares, keeps dividend income, and leaves the entered shares alone', async () => {
    const { call, seed } = testApp();
    await seed();
    const on = (await call('GET', '/api/portfolio')).body;
    const off = (await call('GET', '/api/portfolio?drip=off')).body;
    const byOn = Object.fromEntries(on.holdings.map((h: any) => [h.ticker, h]));
    const byOff = Object.fromEntries(off.holdings.map((h: any) => [h.ticker, h]));
    const payers = Object.keys(byOn).filter((t) => byOn[t].shares > byOff[t].shares);
    expect(payers.length).toBeGreaterThan(0);
    for (const t of Object.keys(byOff)) expect(byOff[t].shares).toBeLessThanOrEqual(byOn[t].shares + 1e-9);
    expect(off.dividends).toBeGreaterThan(0);
    // Reinvested shares earn later dividends, so income is a little higher with reinvestment on.
    expect(off.dividends).toBeLessThanOrEqual(on.dividends);
    expect(off.totals.cost).toBeLessThan(on.totals.cost);

    const events = (await call('GET', '/api/realized?drip=off')).body.dividendEvents;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((d: any) => d.reinvestedShares === null)).toBe(true);
  });

  it('is accepted by every calculation route', async () => {
    const { call, seed } = testApp();
    await seed();
    for (const path of ['/api/series', '/api/performance', '/api/movers', '/api/outlook', '/api/exposure', '/api/health-report']) {
      expect((await call('GET', `${path}?drip=off`)).status).toBe(200);
    }
  });
});
