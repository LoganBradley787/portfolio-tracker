import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { Inbox } from '../../src/server/inbox.ts';
import { FIXTURES } from '../helpers/fixtures.ts';
import { NOW } from '../helpers/server.ts';

const robinhood = readFileSync(join(FIXTURES, 'robinhood', 'transactions.csv'), 'utf8');
// The fixture's unreadable last row would block an import; drop it for the clean cases.
const schwab = (() => {
  const j = JSON.parse(readFileSync(join(FIXTURES, 'schwab', 'transactions.json'), 'utf8'));
  j.BrokerageTransactions.pop();
  return JSON.stringify(j);
})();
const open: { q: { db: { close(): void } } }[] = [];
afterEach(() => { for (const ctx of open.splice(0)) ctx.q.db.close(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pt-inbox-'));
  const ctx = createContext({ dbPath: join(dir, 'portfolio.db'), apiKey: null, now: () => NOW, autoRefresh: false });
  open.push(ctx);
  const imported = vi.fn();
  const inboxDir = join(dir, 'inbox');
  const inbox = new Inbox({ dir: inboxDir, q: ctx.q, now: () => NOW, backupDir: join(dir, 'backups'), onImported: imported, settleMs: 0 });
  ctx.inbox = inbox;
  const drop = (path: string, text: string) => {
    mkdirSync(join(inboxDir, path, '..'), { recursive: true });
    writeFileSync(join(inboxDir, path), text);
  };
  return { dir, ctx, inbox, inboxDir, drop, imported, app: createApp(ctx) };
}

describe('drop folder (temporary folders and databases only)', () => {
  it('imports a broker export under the account its folder names, then files it away', () => {
    const { ctx, inbox, inboxDir, drop, imported, dir } = setup();
    drop('Taxable/activity.csv', robinhood);
    const [entry] = inbox.scan();
    expect(entry).toMatchObject({ file: join('Taxable', 'activity.csv'), account: 'Taxable', ok: true, inserted: 3, message: 'Added 3 trades', at: NOW.toISOString() });
    expect(entry.skipped).toBeGreaterThan(0);
    expect(ctx.q.listTransactions().map((t) => t.account)).toEqual(['Taxable', 'Taxable', 'Taxable']);
    expect(existsSync(join(inboxDir, 'Taxable', 'activity.csv'))).toBe(false);
    expect(readdirSync(join(inboxDir, 'Taxable', 'imported'))).toEqual(['20261002-163000-activity.csv']);
    expect(readdirSync(join(dir, 'backups'))).toHaveLength(1); // the database was copied first
    expect(imported).toHaveBeenCalledTimes(1);
    expect(inbox.status()).toMatchObject({ dir: inboxDir, waiting: [], recent: [entry] });
    expect(inbox.scan()).toEqual([]); // filed files are not read again
  });

  it('adds only the missing trades when a file is dropped again, in either format', () => {
    const { ctx, inbox, inboxDir, drop, imported } = setup();
    drop('Taxable/activity.csv', robinhood);
    drop('Retirement/export.json', schwab);
    const first = inbox.scan();
    expect(first.map((e) => e.ok)).toEqual([true, true]);
    const count = ctx.q.listTransactions().length;
    drop('Taxable/activity.csv', robinhood);
    const [again] = inbox.scan();
    expect(again).toMatchObject({ ok: true, inserted: 0, message: 'Nothing new: every trade was already in the app' });
    expect(ctx.q.listTransactions()).toHaveLength(count);
    expect(readdirSync(join(inboxDir, 'Taxable', 'imported')).sort()).toEqual(['20261002-163000-1-activity.csv', '20261002-163000-activity.csv']);
    expect(imported).toHaveBeenCalledTimes(1);
    // The same file under another account is that account's trades.
    drop('Other/activity.csv', robinhood);
    expect(inbox.scan()[0]).toMatchObject({ account: 'Other', inserted: 3 });
    expect(inbox.status().recent.map((e) => e.account)).toEqual(['Other', 'Taxable', 'Taxable', 'Retirement']);
  });

  it('leaves a file it cannot import where it is, and reports it once', () => {
    const { ctx, inbox, inboxDir, drop } = setup();
    drop('loose.csv', robinhood);
    drop('Taxable/sheet.tsv', 'Ticker\tAsset Type\tType\tShares\tSplit (n to 1)\tAvg Price\tDate\tAccount\nDIS\tStock\tBuy\t1\t\t100\t1/2/2026\tMain');
    drop('Taxable/broken.csv', robinhood.replace('"$80.00"', '"eighty"').replace('Dividend Reinvestment', 'Bought'));
    const entries = inbox.scan();
    expect(entries.map((e) => [e.file, e.ok])).toEqual(expect.arrayContaining([
      ['loose.csv', false], [join('Taxable', 'sheet.tsv'), false], [join('Taxable', 'broken.csv'), false],
    ]));
    expect(entries.find((e) => e.file === 'loose.csv')!.message).toContain('folder named after its account');
    expect(entries.find((e) => e.file.endsWith('sheet.tsv'))!.message).toContain('Not a Schwab JSON or Robinhood activity export');
    expect(entries.find((e) => e.file.endsWith('broken.csv'))!.message).toMatch(/^Row \d+: .*Nothing was imported$/);
    expect(ctx.q.listTransactions()).toEqual([]);
    expect(existsSync(join(inboxDir, 'Taxable', 'broken.csv'))).toBe(true);
    expect(inbox.status().waiting).toHaveLength(3);
    // Unchanged files are not read or logged again.
    expect(inbox.scan()).toEqual([]);
    expect(inbox.status().recent).toHaveLength(3);
    expect(inbox.status().waiting).toHaveLength(3);
  });

  it('imports a failed file once it is fixed, and forgets one that is removed', async () => {
    const { ctx, inbox, inboxDir, drop } = setup();
    drop('Taxable/activity.csv', 'not an export');
    drop('stray.txt', 'x');
    expect(inbox.scan().map((e) => e.ok)).toEqual([false, false]);
    await new Promise((r) => setTimeout(r, 15)); // a later modification time
    drop('Taxable/activity.csv', robinhood);
    writeFileSync(join(inboxDir, 'Taxable', '.DS_Store'), '');
    rmSync(join(inboxDir, 'stray.txt'));
    expect(inbox.scan()).toMatchObject([{ ok: true, inserted: 3 }]);
    expect(inbox.status().waiting).toEqual([]);
    expect(ctx.q.listTransactions()).toHaveLength(3);
  });

  it('waits for a file that is still being written', () => {
    const { ctx, inboxDir, drop } = setup();
    const patient = new Inbox({ dir: inboxDir, q: ctx.q, now: () => NOW, settleMs: 60_000 });
    drop('Taxable/activity.csv', robinhood);
    expect(patient.scan()).toEqual([]);
    expect(ctx.q.listTransactions()).toEqual([]);
    expect(existsSync(join(inboxDir, 'Taxable', 'activity.csv'))).toBe(true);
    patient.stop();
  });

  it('creates the folder with instructions on start, and reports through the API', async () => {
    const { inbox, inboxDir, drop, app } = setup();
    inbox.start();
    inbox.stop();
    expect(readFileSync(join(inboxDir, 'README.txt'), 'utf8')).toContain('named after an account');
    expect(inbox.scan()).toEqual([]); // its own files are not imports
    drop('Taxable/activity.csv', robinhood);
    drop('Taxable/bad.csv', 'nope');
    const res = await app.request('/api/inbox/scan', { method: 'POST' });
    const body = await res.json() as any;
    expect(body.handled).toHaveLength(2);
    expect(body.waiting).toHaveLength(1);
    const health = await (await app.request('/api/health-report')).json() as any;
    expect(health.inbox).toMatchObject({ dir: inboxDir, waiting: [{ file: join('Taxable', 'bad.csv'), ok: false }] });
    expect(health.inbox.recent).toHaveLength(2);
    const portfolio = await (await app.request('/api/portfolio')).json() as any;
    expect(portfolio.inboxWaiting).toBe(1);
  });

  it('is absent unless a folder is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-inbox-'));
    const ctx = createContext({ dbPath: join(dir, 'portfolio.db'), apiKey: null, now: () => NOW, autoRefresh: false });
    open.push(ctx);
    expect(ctx.inbox).toBeNull();
    const app = createApp(ctx);
    expect((await app.request('/api/inbox/scan', { method: 'POST' })).status).toBe(404);
    expect((await (await app.request('/api/health-report')).json() as any).inbox).toBeNull();
  });
});
