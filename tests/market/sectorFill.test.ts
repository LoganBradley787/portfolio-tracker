import { describe, expect, it, vi } from 'vitest';
import { Queries } from '../../src/db/queries.ts';
import { openDatabase } from '../../src/db/migrate.ts';
import { SectorFill } from '../../src/market/sectorFill.ts';
import type { CompanyProfile } from '../../src/market/yahoo.ts';

function setup(answers: Record<string, CompanyProfile | null | Error>) {
  const q = new Queries(openDatabase(':memory:'));
  const profile = vi.fn(async (symbol: string) => {
    const answer = answers[symbol] ?? null;
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const create = () => new SectorFill({ q, provider: { profile }, pauseMs: 0 });
  const buy = (ticker: string, assetType: 'Stock' | 'ETF' = 'Stock') =>
    q.insertTransaction({ ticker, type: 'Buy', shares: 1, price: 100, date: '2026-01-02', account: 'One' }, assetType);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { q, profile, create, fill: create(), buy };
}

const tesla = { name: 'Tesla, Inc.', sector: 'Consumer Cyclical' };

describe('sector fill', () => {
  it('fills blank sectors and names of traded stocks only', async () => {
    const { q, fill, buy, profile } = setup({ TSLA: tesla });
    buy('TSLA'); buy('VOO', 'ETF');
    q.ensureSecurity('KO', 'Stock'); // never traded
    await fill.refresh();
    expect(profile.mock.calls.map(([s]) => s)).toEqual(['TSLA']);
    expect(q.getSecurity('TSLA')).toMatchObject(tesla);
    q.db.close();
  });

  it('never replaces a sector or a name the user set', async () => {
    const { q, fill, buy, profile } = setup({ TSLA: tesla, DIS: { name: 'The Walt Disney Company', sector: 'Communication Services' } });
    buy('TSLA'); buy('DIS');
    q.updateSecurity('TSLA', { sector: 'Cars' });
    q.updateSecurity('DIS', { name: 'Disney' });
    await fill.refresh();
    expect(profile.mock.calls.map(([s]) => s)).toEqual(['DIS']);
    expect(q.getSecurity('TSLA')).toMatchObject({ sector: 'Cars' });
    expect(q.getSecurity('DIS')).toMatchObject({ name: 'Disney', sector: 'Communication Services' });
    q.db.close();
  });

  it('keeps a sector typed while the lookup was out', async () => {
    const { q, buy } = setup({});
    buy('TSLA');
    const fill = new SectorFill({
      q, pauseMs: 0,
      provider: { profile: async () => { q.updateSecurity('TSLA', { sector: 'Cars' }); return tesla; } },
    });
    await fill.refresh();
    expect(q.getSecurity('TSLA')).toMatchObject({ sector: 'Cars', name: null });
    q.db.close();
  });

  it('looks a ticker up under its provider symbol', async () => {
    const { q, fill, buy, profile } = setup({ 'BRK-B': { name: 'Berkshire Hathaway Inc.', sector: 'Financial Services' } });
    buy('BRKB');
    q.updateSecurity('BRKB', { providerSymbol: 'BRK-B' });
    await fill.refresh();
    expect(profile.mock.calls.map(([s]) => s)).toEqual(['BRK-B']);
    expect(q.getSecurity('BRKB')).toMatchObject({ sector: 'Financial Services' });
    q.db.close();
  });

  it('tries a failed or unknown ticker once per launch, and again after a relaunch', async () => {
    const { q, fill, create, buy, profile } = setup({ TSLA: new Error('down'), TWTR: null, DIS: { name: null, sector: 'Communication Services' } });
    buy('TSLA'); buy('TWTR'); buy('DIS');
    await fill.refresh();
    expect(q.getSecurity('DIS')).toMatchObject({ sector: 'Communication Services' }); // one failure does not stop the rest
    await fill.refresh();
    expect(profile).toHaveBeenCalledTimes(3);
    await create().refresh();
    expect(profile.mock.calls.slice(3).map(([s]) => s).sort()).toEqual(['TSLA', 'TWTR']);
    q.db.close();
  });
});
