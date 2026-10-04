import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURES } from '../helpers/fixtures.ts';
import { testApp } from '../helpers/server.ts';

const file = readFileSync(join(FIXTURES, 'robinhood', 'transactions.csv'), 'utf8');
const header = 'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount';
const trade = '7/8/2026,7/9/2026,7/10/2026,DIS,Walt Disney,Buy,2.5,$90.125,($225.31)';
const open: ReturnType<typeof testApp>[] = [];
const setup = () => { const app = testApp(); open.push(app); return app; };
afterEach(() => { for (const app of open.splice(0)) app.ctx.q.db.close(); });

describe('Robinhood import routes (temporary databases only)', () => {
  it('previews without changing the ledger and always appends, even when replace is requested', async () => {
    const { call, seed } = setup();
    await seed();
    const before = (await call('GET', '/api/transactions')).body.transactions;
    const preview = await call('POST', '/api/import/preview', { text: file, account: ' Taxable ' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ source: 'robinhood', fileErrors: [], errors: [] });
    expect(preview.body.rows).toHaveLength(3);
    expect(preview.body.rows.every((r: any) => r.account === 'Taxable')).toBe(true);
    expect((await call('GET', '/api/transactions')).body.transactions).toEqual(before);
    const commit = await call('POST', '/api/import/commit', { text: file, account: ' Taxable ', mode: 'replace' });
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ mode: 'append', inserted: 3, splits: 0 });
    expect(commit.body.backupPath).toBeUndefined();
    const after = (await call('GET', '/api/transactions')).body.transactions;
    expect(after.filter((t: any) => t.account !== 'Taxable')).toEqual(before);
    expect(after.filter((t: any) => t.account === 'Taxable').map((t: any) => t.type)).toEqual(['Buy', 'Buy', 'Sell']);
    expect((await call('GET', '/api/config')).body.accounts).toContain('Taxable');
    expect((await call('GET', '/api/securities')).body.securities.find((s: any) => s.ticker === 'VOO').assetType).toBe('ETF');
  });

  it('skips existing trades on repeat and overlapping imports, separately per account', async () => {
    const { call } = setup();
    await call('POST', '/api/import/commit', { text: file, account: 'Taxable' });
    const preview = (await call('POST', '/api/import/preview', { text: file, account: 'Taxable' })).body;
    expect(preview.rows).toEqual([]);
    expect(preview.skipped.filter((s: any) => s.message === 'Already in the app')).toHaveLength(3);
    expect((await call('POST', '/api/import/commit', { text: file, account: 'Taxable' })).body.inserted).toBe(0);
    expect((await call('POST', '/api/import/preview', { text: file, account: 'Other' })).body.rows).toHaveLength(3);
    const overlapping = header + '\n7/8/2026,7/8/2026,7/9/2026,DIS,Walt Disney,Buy,3,$101.25,($303.75)\n' + trade;
    expect((await call('POST', '/api/import/commit', { text: overlapping, account: 'Taxable' })).body.inserted).toBe(1);
  });

  it('preserves two identical executions and imports only the missing occurrence', async () => {
    const { call } = setup();
    const one = header + '\n' + trade;
    const two = one + '\n' + trade;
    expect((await call('POST', '/api/import/commit', { text: one, account: 'Taxable' })).body.inserted).toBe(1);
    const preview = (await call('POST', '/api/import/preview', { text: two, account: 'Taxable' })).body;
    expect(preview.rows).toHaveLength(1);
    expect(preview.skipped.filter((s: any) => s.message === 'Already in the app')).toHaveLength(1);
    expect((await call('POST', '/api/import/commit', { text: two, account: 'Taxable' })).body.inserted).toBe(1);
    expect((await call('POST', '/api/import/commit', { text: two, account: 'Taxable' })).body.inserted).toBe(0);
  });

  it('requires an account and refuses any row or file errors without writing even the good rows', async () => {
    const { call, seed } = setup();
    await seed();
    const before = (await call('GET', '/api/transactions')).body.transactions;
    const invalid = header + '\n' + trade + '\n' + trade.replace('2.5', 'oops');
    for (const body of [
      { text: file, account: ' ' },
      { text: file },
      { text: invalid, account: 'Taxable' },
      { text: file + '\n"incomplete', account: 'Taxable' },
      { text: header.replace(',Price', '') + '\n' + trade, account: 'Taxable' },
    ]) {
      const r = await call('POST', '/api/import/commit', { ...body, mode: 'replace' });
      expect(r.status).toBe(400);
      expect((await call('GET', '/api/transactions')).body.transactions).toEqual(before);
    }
  });
});
