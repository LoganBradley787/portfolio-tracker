import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES, readJson } from '../helpers/fixtures.ts';
import { sampleTsv, testApp } from '../helpers/server.ts';

const expected = readJson('sample', 'expected-from-sheet.json');

/** Every dividend is reinvested: per ticker, the shares bought and what they cost (from /api/realized). */
async function reinvested(call: (m: string, p: string) => Promise<{ body: any }>) {
  const by: Record<string, { shares: number; cost: number }> = {};
  for (const d of (await call('GET', '/api/realized')).body.dividendEvents) {
    if (d.reinvestedShares === null) continue;
    const r = (by[d.ticker] ??= { shares: 0, cost: 0 });
    r.shares += d.reinvestedShares;
    r.cost += d.amount;
  }
  return { by, cost: Object.values(by).reduce((a, r) => a + r.cost, 0) };
}

describe('basic routes', () => {
  it('GET /api/health', async () => {
    const { call } = testApp();
    expect((await call('GET', '/api/health')).body).toEqual({ ok: true });
  });

  it('GET /api/config reports whether a key is set', async () => {
    expect((await testApp().call('GET', '/api/config')).body).toEqual({ hasKey: true, today: '2026-10-02', accounts: [], customBenchmark: null });
    expect((await testApp({ apiKey: null }).call('GET', '/api/config')).body.hasKey).toBe(false);
  });
});

describe('/api/portfolio with the sample and fixture prices', () => {
  it('returns the Task 3 numbers, with the real TSLA split applied', async () => {
    const { call, seed } = testApp();
    await seed();
    const { status, body } = await call('GET', '/api/portfolio');
    expect(status).toBe(200);
    const by = Object.fromEntries(body.holdings.map((h: any) => [h.ticker, h]));
    // The sheet's numbers plus the reinvested dividends (none of these tickers split after paying one).
    const drip = await reinvested(call);
    expect(Object.keys(drip.by).sort()).toEqual(['DIS', 'F', 'KO', 'QQQM', 'VZ']);
    for (const [t, h] of Object.entries<any>(expected.holdings)) {
      expect(by[t].totalCost, t).toBeCloseTo(h.totalCost + (drip.by[t]?.cost ?? 0), 6);
      expect(by[t].shares, t).toBeCloseTo((t === 'TSLA' ? 12 : h.shares) + (drip.by[t]?.shares ?? 0), 9);
    }
    expect(body.totals.cost).toBeCloseTo(12627.46 + drip.cost, 6);
    expect(body.realizedGain).toBeCloseTo(170.88, 6);
    // TSLA has a quote from 2026-10-02 (newer than the last bar): 12 × tngoLast.
    expect(by.TSLA).toMatchObject({ price: 371.035, priceSource: 'quote', flag: null });
    expect(by.TSLA.equity).toBeCloseTo(12 * 371.035, 9);
    expect(by.TSLA.dayChange).toBeCloseTo(12 * (371.035 - 354.11), 9);
    // VZ has no quote in the fixture: last close on 2026-10-01.
    expect(by.VZ).toMatchObject({ priceSource: 'close', priceAsOf: '2026-10-01' });
    expect(body.pricesAsOf).toMatch(/^2026-10-02T/);
    expect(body.oversells).toEqual([]);
    expect(body.realizedPlusUnrealized).toBeCloseTo(body.totals.gain + 170.88, 6);
  });

  it('filters by asset type', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/portfolio?assetType=ETF');
    expect(body.holdings.map((h: any) => h.ticker)).toEqual(['QQQM']);
  });

  it('flags an unresolved ticker in /api/portfolio and /api/health-report (review focus 3)', async () => {
    const { call, seed } = testApp();
    await seed(['SQ\tStock\tBuy\t10\t\t50\t1/4/2021\tMain']);
    const p = (await call('GET', '/api/portfolio')).body;
    const sq = p.holdings.find((h: any) => h.ticker === 'SQ');
    expect(sq).toMatchObject({ flag: 'unresolved', priceSource: 'cost', price: 50, equity: 500 });
    expect(p.flagged).toEqual([{ ticker: 'SQ', flag: 'unresolved' }]);
    const h = (await call('GET', '/api/health-report')).body;
    expect(h.securities.find((s: any) => s.ticker === 'SQ')).toMatchObject({ status: 'unresolved', held: true });
  });

  it('reports an oversell and still renders (review focus 1)', async () => {
    const { call, seed } = testApp();
    await seed(['VZ\tStock\tSell\t15\t\t40\t1/3/2022\tBrokerage']);
    const p = (await call('GET', '/api/portfolio')).body;
    expect(p.oversells).toMatchObject([{ ticker: 'VZ', requested: 15 }]);
    expect(p.oversells[0].held).toBeGreaterThan(10); // 10 bought + reinvested dividends
    expect(p.oversells[0].held).toBeLessThan(10.6);
    expect(p.holdings.find((h: any) => h.ticker === 'VZ')).toBeUndefined();
    const h = (await call('GET', '/api/health-report')).body;
    expect(h.oversells).toHaveLength(1);
  });
});

describe('/api/realized', () => {
  it('lists the sample sale and totals', async () => {
    const { call, seed } = testApp();
    await seed();
    const { body } = await call('GET', '/api/realized?sort=gain');
    expect(body.sales).toHaveLength(1);
    expect(body.sales[0]).toMatchObject({ ticker: 'TSLA', date: '2021-04-13', sharesSold: 2, price: 762.32 });
    expect(body.totalGain).toBeCloseTo(170.88, 6);
  });
});

describe('/api/health-report', () => {
  it('cross-checks the sample’s imported SHOP split and lists provider splits', async () => {
    const { call, seed } = testApp();
    await seed();
    const h = (await call('GET', '/api/health-report')).body;
    expect(h.splitCheck).toMatchObject([{ ticker: 'SHOP', exDate: '2022-06-29', ratio: 10, result: 'match' }]);
    expect(h.splits.map((s: any) => `${s.ticker} ${s.exDate} ${s.ratio}`)).toEqual(['SHOP 2022-06-29 10', 'TSLA 2022-08-25 3']);
    expect(h.priceWarnings).toEqual([]);
    expect(h.priceGaps).toEqual([]);
    expect(h.refresh.status).toMatchObject({ state: 'idle', error: null });
  });

  it('applies an imported split the provider does not have', async () => {
    const { call, seed } = testApp();
    await seed(['UBER\t\tSplit\t\t2\t\t1/3/2023\t']);
    let h = (await call('GET', '/api/health-report')).body;
    const row = h.splitCheck.find((s: any) => s.ticker === 'UBER');
    expect(row.result).toBe('missing');
    expect((await call('POST', '/api/splits/apply', { importedSplitId: row.id })).status).toBe(200);
    h = (await call('GET', '/api/health-report')).body;
    expect(h.splitCheck.find((s: any) => s.ticker === 'UBER').result).toBe('applied');
    const p = (await call('GET', '/api/portfolio')).body;
    expect(p.holdings.find((x: any) => x.ticker === 'UBER').shares).toBe(30);
  });

  it('flags a trade far from that day’s close', async () => {
    const { call, seed } = testApp();
    await seed(['SHOP\tStock\tBuy\t1\t\t350\t6/30/2022\tMain']);
    const h = (await call('GET', '/api/health-report')).body;
    expect(h.priceWarnings).toMatchObject([{ ticker: 'SHOP', date: '2022-06-30', price: 350 }]);
  });
});

describe('transactions', () => {
  it('adds, edits, reorders and deletes', async () => {
    const { call } = testApp();
    const a = await call('POST', '/api/transactions', { ticker: 'voo', type: 'Buy', shares: '2', price: '$400.50', date: '2024-01-02', account: 'Main', assetType: 'ETF' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ ticker: 'VOO', shares: 2, price: 400.5 });
    const b = await call('POST', '/api/transactions', { ticker: 'VOO', type: 'Sell', shares: 1, price: 410, date: '1/2/2024', account: 'Main' });
    expect(b.body.date).toBe('2024-01-02');
    expect((await call('POST', '/api/transactions/reorder', { id: b.body.id, direction: 'up' })).body).toEqual({ moved: true });
    let list = (await call('GET', '/api/transactions')).body;
    expect(list.transactions.map((t: any) => t.id)).toEqual([b.body.id, a.body.id]);
    expect(list.transactions[0].assetType).toBe('ETF');
    expect(list.accounts).toEqual(['Main']);
    const put = await call('PUT', `/api/transactions/${a.body.id}`, { ...a.body, shares: 3 });
    expect(put.body.shares).toBe(3);
    expect((await call('DELETE', `/api/transactions/${b.body.id}`)).status).toBe(204);
    list = (await call('GET', '/api/transactions')).body;
    expect(list.transactions).toHaveLength(1);
    expect((await call('DELETE', '/api/transactions/9999')).status).toBe(404);
  });

  it('rejects invalid input with messages', async () => {
    const { call } = testApp();
    const r = await call('POST', '/api/transactions', { ticker: '', type: 'Dividend', shares: -1, price: 'x', date: '2024-02-30' });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(5);
  });

  it('filters by account', async () => {
    const { call, seed } = testApp();
    await seed();
    const r = (await call('GET', '/api/transactions?account=Brokerage')).body;
    expect(r.transactions).toHaveLength(6);
    expect(r.accounts).toEqual(['Brokerage', 'Main']);
  });
});

describe('import and export', () => {
  it('previews without saving, then commits replace-all with a backup', async () => {
    const { call, dir } = testApp();
    const prev = await call('POST', '/api/import/preview', { text: sampleTsv() });
    expect(prev.body.rows).toHaveLength(14);
    expect((await call('GET', '/api/transactions')).body.transactions).toHaveLength(0);
    await call('POST', '/api/transactions', { ticker: 'X', type: 'Buy', shares: 1, price: 1, date: '2024-01-02' });
    const commit = await call('POST', '/api/import/commit', { text: sampleTsv(), mode: 'replace' });
    expect(commit.body).toMatchObject({ mode: 'replace', inserted: 14, splits: 1 });
    expect(existsSync(commit.body.backupPath)).toBe(true);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    expect((await call('GET', '/api/transactions')).body.transactions).toHaveLength(14);
  });

  it('refuses to commit an import with row errors', async () => {
    const { call } = testApp();
    const r = await call('POST', '/api/import/commit', { text: 'Ticker,Type,Shares,Avg Price,Date\nA,Gift,1,1,1/2/2024', mode: 'replace' });
    expect(r.status).toBe(400);
    expect(r.body.errors).toHaveLength(1);
  });

  it('exports CSV that re-imports to the same rows', async () => {
    const { call, seed } = testApp();
    await seed();
    const csv = await call('GET', '/api/export.csv');
    expect(csv.headers.get('content-type')).toMatch(/text\/csv/);
    const again = (await call('POST', '/api/import/preview', { text: csv.body })).body;
    expect(again.errors).toEqual([]);
    expect(again.rows).toHaveLength(14);
  });
});

describe('securities and refresh', () => {
  it('edits a security and re-queues it when the provider symbol changes', async () => {
    const { call, seed } = testApp();
    await seed(['SQ\tStock\tBuy\t10\t\t50\t1/4/2021\tMain']);
    const r = await call('PUT', '/api/securities/SQ', { providerSymbol: 'XYZ', sector: 'Fintech' });
    expect(r.body).toMatchObject({ providerSymbol: 'XYZ', status: 'pending', sector: 'Fintech' });
    expect((await call('PUT', '/api/securities/NOPE', { sector: 'x' })).status).toBe(404);
    expect((await call('PUT', '/api/securities/SQ', { assetType: 'Bond' })).status).toBe(400);
  });

  it('starts a refresh and reports status', async () => {
    const { call } = testApp();
    await call('POST', '/api/import/commit', { text: sampleTsv(), mode: 'replace' });
    const r = await call('POST', '/api/refresh');
    expect(r.status).toBe(202);
    const s = (await call('GET', '/api/refresh/status')).body;
    expect(s.hasKey).toBe(true);
    expect(s.budget.limit).toBe(45);
  });

  it('refuses to refresh without a key', async () => {
    expect((await testApp({ apiKey: null }).call('POST', '/api/refresh')).status).toBe(400);
  });

  it('keeps last good data and reports the error when the provider fails (review focus 5)', async () => {
    const { call, seed, ctx } = testApp({ fake: { quotesStatus: 429 } });
    await seed();
    const p = (await call('GET', '/api/portfolio')).body;
    expect(p.refresh.status.error).toMatchObject({ kind: 'rate-limit' });
    expect(p.holdings).toHaveLength(10);
    expect(ctx.cache.budget.used()).toBe(1);
  });
});

describe('FIFO by default, average cost via ?method=average', () => {
  it('gives the same sample numbers and a tax-year view', async () => {
    const { call, seed } = testApp();
    await seed(['DIS\tStock\tSell\t10\t\t120\t6/1/2021\tMain']);
    const avg = (await call('GET', '/api/realized?method=average')).body;
    const fifo = (await call('GET', '/api/realized')).body;
    expect(avg.taxYears).toBeNull();
    // FIFO in the Main account: the 2020-03-10 lot at 111.46.
    const dis = fifo.sales.find((s: any) => s.ticker === 'DIS');
    expect(dis.costRemoved).toBeCloseTo(10 * 111.46, 9);
    expect(dis.lots).toEqual([{ acquired: '2020-03-10', shares: 10, cost: expect.closeTo(1114.6, 9) }]);
    const y2021 = fifo.taxYears.find((y: any) => y.year === 2021);
    expect(y2021.longTerm.gain).toBeCloseTo(10 * 120 - 1114.6, 9);
    expect(y2021.shortTerm.gain).toBeCloseTo(170.88, 6);
    const p = (await call('GET', '/api/portfolio')).body;
    expect(p.method).toBe('fifo');
    expect((await call('GET', '/api/portfolio?method=average')).body.method).toBe('average');
    expect(p.totals.cost).toBeCloseTo(12627.46 - 1114.6 + (await reinvested(call)).cost, 6);
  });
});

describe('allocation in /api/portfolio', () => {
  it('groups by sector once sectors are set', async () => {
    const { call, seed } = testApp();
    await seed();
    await call('PUT', '/api/securities/TSLA', { sector: 'Consumer Discretionary' });
    await call('PUT', '/api/securities/DIS', { sector: 'Communication Services', name: 'Walt Disney' });
    const p = (await call('GET', '/api/portfolio')).body;
    const labels = p.allocation.bySector.map((s: any) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Consumer Discretionary', 'Communication Services', 'ETFs', 'Unassigned']));
    const total = p.allocation.bySector.reduce((a: number, s: any) => a + s.pct, 0);
    expect(total).toBeCloseTo(1, 9);
    expect((await call('GET', '/api/securities')).body.securities.find((s: any) => s.ticker === 'DIS').name).toBe('Walt Disney');
  });
});

describe('Schwab import', () => {
  const file = () => readFileSync(join(FIXTURES, 'schwab', 'transactions.json'), 'utf8');
  // The fixture's unreadable last row would block a commit; drop it for the clean cases.
  const clean = () => {
    const j = JSON.parse(file());
    j.BrokerageTransactions.pop();
    return JSON.stringify(j);
  };

  it('adds the trades to the existing ones and never replaces', async () => {
    const { call, seed } = testApp();
    await seed();
    const before = (await call('GET', '/api/transactions')).body.transactions.length;
    const r = await call('POST', '/api/import/commit', { text: clean(), account: 'Retirement', mode: 'replace' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'append', inserted: 3 });
    const after = (await call('GET', '/api/transactions')).body.transactions;
    expect(after.length).toBe(before + 3);
    expect((await call('GET', '/api/config')).body.accounts).toContain('Retirement');
    expect((await call('GET', '/api/securities')).body.securities.find((s: any) => s.ticker === 'VT').assetType).toBe('ETF');
  });

  it('skips trades that are already there, so the same file can be imported twice', async () => {
    const { call, seed } = testApp();
    await seed();
    await call('POST', '/api/import/commit', { text: clean(), account: 'Retirement' });
    const prev = (await call('POST', '/api/import/preview', { text: clean(), account: 'Retirement' })).body;
    expect(prev.rows).toEqual([]);
    expect(prev.skipped.filter((s: any) => s.message === 'Already in the app')).toHaveLength(3);
    expect((await call('POST', '/api/import/commit', { text: clean(), account: 'Retirement' })).body.inserted).toBe(0);
    // The same trades under another account are new.
    expect((await call('POST', '/api/import/preview', { text: clean(), account: 'Other' })).body.rows).toHaveLength(3);
  });

  it('needs an account name and a file without errors', async () => {
    const { call, seed } = testApp();
    await seed();
    expect((await call('POST', '/api/import/commit', { text: clean(), account: ' ' })).status).toBe(400);
    expect((await call('POST', '/api/import/commit', { text: file(), account: 'Retirement' })).status).toBe(400);
  });
});
