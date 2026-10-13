import { describe, expect, it } from 'vitest';
import { testApp } from '../helpers/server.ts';

describe('ticker detail', () => {
  it('includes split-adjusted prices, entered trades, remaining FIFO lots and dividend reinvestments', async () => {
    const { seed, call } = testApp();
    await seed();
    const { status, body: p } = await call('GET', '/api/ticker/SHOP?method=fifo&from=2022-06-01&to=2022-07-01');
    expect(status).toBe(200);
    expect(p.ticker).toBe('SHOP');
    expect(p.holding.shares).toBe(30);
    expect(p.lots.reduce((s: number, l: any) => s + l.shares, 0)).toBeCloseTo(30);
    expect(p.prices[0].close).toBeLessThan(100);
    expect(p.trades).toHaveLength(1);
    expect(p.trades[0].shares).toBe(3); // as entered; chart markers are restated
    expect(p.markers[0].price).toBeCloseTo(p.trades[0].price / 10);
    const vz = (await call('GET', '/api/ticker/VZ?method=fifo')).body;
    expect(vz.dividends.length).toBeGreaterThan(0);
    expect(vz.lots.reduce((s: number, l: any) => s + l.shares, 0)).toBeCloseTo(vz.holding.shares, 6);
  });

  it('respects account selection and cost method, and never invents FIFO lots for average cost', async () => {
    const { seed, call } = testApp();
    await seed();
    const avg = (await call('GET', '/api/ticker/SHOP?method=average')).body;
    expect(avg.lots).toBeNull();
    const other = (await call('GET', '/api/ticker/SHOP?account=Brokerage&method=fifo')).body;
    expect(other.holding).toBeNull();
    expect(other.trades).toEqual([]);
    expect(other.lots).toEqual([]);
    expect((await call('GET', '/api/ticker/UNKNOWN')).status).toBe(404);
    expect((await call('GET', '/api/ticker/SHOP?from=nope')).status).toBe(400);
  });
});
