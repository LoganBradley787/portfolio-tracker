import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { currentVersion, LATEST_VERSION, openDatabase } from '../../src/db/migrate.ts';
import { Queries } from '../../src/db/queries.ts';
import { parseImport } from '../../src/import/parse.ts';
import { readFileSync } from 'node:fs';
import { FIXTURES } from '../helpers/fixtures.ts';

const sampleTsv = () => readFileSync(join(FIXTURES, 'sample', 'transactions.tsv'), 'utf8');
const NOW = new Date('2026-10-02T16:00:00Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pt-db-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrations', () => {
  it('upgrades a v1 database with a backup and preserves trades and the custom selection across reopen', () => {
    const path = join(dir, 'v1.db');
    const raw = new BetterSqlite3(path);
    raw.exec(readFileSync(join(import.meta.dirname, '../../src/db/schema.sql'), 'utf8'));
    raw.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    raw.exec(`INSERT INTO securities (ticker, asset_type) VALUES ('VOO', 'ETF');
      INSERT INTO transactions (seq, ticker, type, shares, price, date, account, note)
      VALUES (1, 'VOO', 'Buy', 1, 100, '2024-01-02', 'One', 'legacy trade')`);
    const before = new Queries(raw);
    const trades = before.listTransactions();
    raw.close();
    const db = openDatabase(path, { now: () => NOW });
    const q = new Queries(db);
    expect(q.listTransactions()).toEqual(trades);
    expect(q.getSecurity('VOO')!.assetType).toBe('ETF');
    expect(q.customBenchmark()).toBeNull();
    q.setCustomBenchmark('VOO');
    db.close();
    const reopened = openDatabase(path, { now: () => NOW });
    expect(new Queries(reopened).customBenchmark()).toBe('VOO');
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    reopened.close();
  });
  it('upgrades v2 with a backup, preserves trades, and persists the requested history start', () => {
    const path = join(dir, 'v2.db');
    const raw = new BetterSqlite3(path);
    raw.exec(readFileSync(join(import.meta.dirname, '../../src/db/schema.sql'), 'utf8'));
    raw.exec(`CREATE TABLE custom_benchmark (id INTEGER PRIMARY KEY CHECK (id = 1), ticker TEXT NOT NULL);
      ALTER TABLE securities ADD COLUMN asset_type_set INTEGER NOT NULL DEFAULT 1;
      INSERT INTO schema_version (version) VALUES (1), (2);
      INSERT INTO securities (ticker, asset_type) VALUES ('VOO', 'ETF');
      INSERT INTO custom_benchmark VALUES (1, 'VOO');
      INSERT INTO transactions (seq, ticker, type, shares, price, date, account)
      VALUES (1, 'VOO', 'Buy', 1, 100, '2024-01-02', 'One')`);
    const trades = new Queries(raw).listTransactions();
    raw.close();
    const db = openDatabase(path, { now: () => NOW });
    const q = new Queries(db);
    expect(q.listTransactions()).toEqual(trades);
    expect(q.customBenchmark()).toBe('VOO');
    expect(q.getSecurity('VOO')!.historyRequestedFrom).toBeNull();
    q.setSecurityStatus('VOO', { historyRequestedFrom: '2024-01-02' });
    db.close();
    const reopened = openDatabase(path, { now: () => NOW });
    expect(new Queries(reopened).getSecurity('VOO')!.historyRequestedFrom).toBe('2024-01-02');
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    reopened.close();
  });

  it('creates the schema on a new file without a backup and is idempotent', () => {
    const path = join(dir, 'p.db');
    const db = openDatabase(path, { now: () => NOW });
    expect(currentVersion(db)).toBe(LATEST_VERSION);
    db.close();
    const again = openDatabase(path, { now: () => NOW });
    expect(currentVersion(again)).toBe(LATEST_VERSION);
    again.close();
    expect(() => readdirSync(join(dir, 'backups'))).toThrow();
  });

  it('backs up an existing database before migrating it', () => {
    const path = join(dir, 'old.db');
    const raw = new BetterSqlite3(path);
    raw.exec('CREATE TABLE legacy (x INTEGER)');
    raw.close();
    const db = openDatabase(path, { now: () => NOW });
    expect(readdirSync(join(dir, 'backups'))).toEqual(['2026-10-02T16-00-00-000Z.db']);
    db.close();
  });
});

describe('Queries', () => {
  let q: Queries;
  beforeEach(() => {
    q = new Queries(openDatabase(':memory:'));
  });

  it('replace-all import writes a backup and replaces every row', () => {
    q.insertTransaction({ ticker: 'old', type: 'Buy', shares: 1, price: 1, date: '2019-01-02', account: 'Main' });
    const parsed = parseImport(sampleTsv());
    const res = q.importTransactions(parsed, 'replace', { dir: join(dir, 'backups'), now: NOW });
    expect(res).toMatchObject({ inserted: 14, splits: 1 });
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1);
    const txs = q.listTransactions();
    expect(txs).toHaveLength(14);
    expect(txs.some((t) => t.ticker === 'OLD')).toBe(false);
    expect(txs.map((t) => t.seq)).toEqual([...Array(14)].map((_, i) => i + 1));
    expect(q.listImportedSplits()).toEqual([{ id: expect.any(Number), ticker: 'SHOP', exDate: '2022-06-29', ratio: 10 }]);
    expect(q.getSecurity('QQQM')).toMatchObject({ assetType: 'ETF', status: 'pending', providerSymbol: 'QQQM' });
  });

  it('append adds rows after the existing ones', () => {
    const parsed = parseImport(sampleTsv());
    q.importTransactions(parsed, 'replace');
    q.importTransactions(parsed, 'append');
    const txs = q.listTransactions();
    expect(txs).toHaveLength(28);
    expect(Math.max(...txs.map((t) => t.seq))).toBe(28);
    // Two identical rows on one day are both kept (no de-duplication).
    expect(txs.filter((t) => t.ticker === 'ZM')).toHaveLength(2);
    expect(q.listImportedSplits()).toHaveLength(2);
  });

  it('adds, edits, deletes and reorders same-day rows', () => {
    const a = q.insertTransaction({ ticker: 'aaa', type: 'Buy', shares: 1, price: 10, date: '2024-01-02', account: 'Main' }, 'ETF');
    const b = q.insertTransaction({ ticker: 'AAA', type: 'Sell', shares: 1, price: 11, date: '2024-01-02', account: 'Main' });
    expect(a.ticker).toBe('AAA');
    expect(q.getSecurity('AAA')!.assetType).toBe('ETF');
    expect(q.moveTransaction(a.id, 'up')).toBe(false);
    expect(q.moveTransaction(b.id, 'up')).toBe(true);
    expect(q.listTransactions().map((t) => t.id)).toEqual([b.id, a.id]);
    const edited = q.updateTransaction(a.id, { ticker: 'AAA', type: 'Buy', shares: 2, price: 10, date: '2024-01-02', account: 'Main', note: 'x' })!;
    expect(edited).toMatchObject({ shares: 2, note: 'x' });
    // Same date: the row keeps its place. A new date sends it last for that date.
    expect(q.listTransactions().map((t) => t.id)).toEqual([b.id, a.id]);
    const c = q.insertTransaction({ ticker: 'AAA', type: 'Buy', shares: 1, price: 10, date: '2024-01-03', account: 'Main' });
    q.updateTransaction(b.id, { ticker: 'AAA', type: 'Sell', shares: 1, price: 11, date: '2024-01-03', account: 'Main' });
    expect(q.listTransactions().map((t) => t.id)).toEqual([a.id, c.id, b.id]);
    expect(q.deleteTransaction(b.id)).toBe(true);
    expect(q.listTransactions()).toHaveLength(2);
  });

  it('changing the provider symbol discards provider data and marks the ticker pending', () => {
    q.ensureSecurity('SQ');
    q.upsertBars('SQ', [{ date: '2024-01-02', close: 50 }]);
    q.upsertProviderSplits('SQ', [{ exDate: '2020-01-02', ratio: 2 }]);
    q.insertManualSplit({ ticker: 'SQ', exDate: '2021-01-04', ratio: 3 });
    q.setSecurityStatus('SQ', { status: 'unresolved', historyThrough: '2024-01-02' });
    const s = q.updateSecurity('SQ', { providerSymbol: 'xyz', sector: 'Fintech' })!;
    expect(s).toMatchObject({ providerSymbol: 'XYZ', sector: 'Fintech', status: 'pending', historyThrough: null });
    expect(q.getBars('SQ')).toEqual([]);
    expect(q.listSplits()).toEqual([{ ticker: 'SQ', exDate: '2021-01-04', ratio: 3, source: 'manual' }]);
  });

  it('upserts bars, splits, dividends and quotes', () => {
    q.upsertBars('T', [{ date: '2024-01-02', close: 1 }, { date: '2024-01-03', close: 2 }]);
    q.upsertBars('T', [{ date: '2024-01-03', close: 2.5 }, { date: '2024-01-04', close: 3 }]);
    expect(q.getBars('T').map((b) => b.close)).toEqual([1, 2.5, 3]);
    expect(Object.keys(q.allBars())).toEqual(['T']);
    q.upsertDividends('T', [{ exDate: '2024-01-03', amount: 0.5 }]);
    expect(q.listDividends('T')).toEqual([{ exDate: '2024-01-03', amount: 0.5 }]);
    q.upsertQuote({ ticker: 'T', last: 3.1, prevClose: 3, asOf: '2024-01-05T15:00:00Z', fetchedAt: '2024-01-05T15:00:01Z' });
    expect(q.listQuotes()[0]).toMatchObject({ ticker: 'T', last: 3.1, prevClose: 3 });
    q.logRequest({ at: '2024-01-05T15:00:00.000Z', kind: 'history', symbol: 'T', status: 200, ok: true });
    expect(q.requestTimesSince('2024-01-05T14:00:00.000Z')).toEqual(['2024-01-05T15:00:00.000Z']);
  });
});
