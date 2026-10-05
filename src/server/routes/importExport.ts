import { Hono } from 'hono';
import { exportCsv } from '../../import/export.ts';
import type { ImportResult } from '../../import/parse.ts';
import type { AppContext } from '../context.ts';
import { parseForImport } from '../importer.ts';

export function importExportRoutes(ctx: AppContext) {
  const r = new Hono();

  const parse = (body: { text?: unknown; account?: unknown } | null): ImportResult =>
    parseForImport(ctx.q, String(body?.text ?? ''), String(body?.account ?? '').trim());

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
