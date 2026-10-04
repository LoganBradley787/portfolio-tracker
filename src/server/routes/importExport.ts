import { Hono } from 'hono';
import { exportCsv } from '../../import/export.ts';
import { parseImport, type ImportResult } from '../../import/parse.ts';
import { isSchwabExport, parseSchwab } from '../../import/schwab.ts';
import { isRobinhoodExport, parseRobinhood } from '../../import/robinhood.ts';
import type { AppContext } from '../context.ts';

export function importExportRoutes(ctx: AppContext) {
  const r = new Hono();

  /** The sheet format, or a broker export with existing trades set aside. */
  const parse = (body: { text?: unknown; account?: unknown } | null): ImportResult => {
    const text = String(body?.text ?? '');
    const account = String(body?.account ?? '').trim();
    const parsed = isSchwabExport(text) ? parseSchwab(text, account)
      : isRobinhoodExport(text) ? parseRobinhood(text, account) : parseImport(text);
    if (!parsed.source) return parsed;
    const key = (t: { account: string; date: string; ticker: string; type: string; shares: number; price: number }) =>
      [t.account, t.date, t.ticker, t.type, t.shares, t.price].join('|');
    // Match occurrences, so equal-sized executions are not collapsed when a
    // larger report contains more copies of a trade than the ledger already has.
    const existing = new Map<string, number>();
    for (const trade of ctx.q.listTransactions()) existing.set(key(trade), (existing.get(key(trade)) ?? 0) + 1);
    const fresh = parsed.rows.filter((row) => {
      const tradeKey = key(row);
      const count = existing.get(tradeKey) ?? 0;
      if (!count) return true;
      existing.set(tradeKey, count - 1);
      parsed.skipped!.push({ row: row.row, message: 'Already in the app' });
      return false;
    });
    fresh.forEach((row, i) => (row.seq = i + 1));
    return { ...parsed, rows: fresh };
  };

  r.post('/import/preview', async (c) => c.json(parse(await c.req.json().catch(() => null))));

  /** Saves only a clean import: any row error blocks it, so nothing is silently dropped. */
  r.post('/import/commit', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parse(body);
    // A broker file holds one account, so it only ever adds.
    const mode = body?.mode === 'append' || parsed.source ? 'append' : 'replace';
    if (parsed.source && !String(body?.account ?? '').trim()) return c.json({ ...parsed, message: 'Enter the account this file belongs to' }, 400);
    if (parsed.fileErrors.length || parsed.errors.length) return c.json({ ...parsed, message: 'Fix the errors shown in the preview first' }, 400);
    const result = ctx.q.importTransactions(parsed, mode, ctx.backupDir ? { dir: ctx.backupDir, now: ctx.now() } : undefined);
    ctx.cache.maybeRefresh();
    return c.json({ mode, ...result });
  });

  r.get('/export.csv', (c) => {
    const assetTypes = Object.fromEntries(ctx.q.listSecurities().map((s) => [s.ticker, s.assetType]));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="transactions-${ctx.today()}.csv"`);
    return c.body(exportCsv(ctx.q.listTransactions(), assetTypes));
  });

  return r;
}
