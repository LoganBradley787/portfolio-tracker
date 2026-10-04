import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import { healthReport, refreshInfo } from '../service.ts';
import { methodParam } from '../params.ts';

export function healthRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/health-report', (c) => c.json(healthReport(ctx, methodParam(c.req.query('method')))));

  /** Starts a refresh in the background and returns at once. */
  r.post('/refresh', (c) => {
    ctx.fundHoldings.maybeRefresh();
    if (!ctx.hasKey) return c.json({ errors: ['No Tiingo API key configured'], ...refreshInfo(ctx) }, 400);
    void ctx.cache.refresh();
    return c.json(refreshInfo(ctx), 202);
  });

  r.get('/refresh/status', (c) => {
    ctx.fundHoldings.maybeRefresh();
    return c.json(refreshInfo(ctx));
  });

  /** "Apply this split": copies an imported split row into splits as manual. */
  r.post('/splits/apply', async (c) => {
    const body = await c.req.json().catch(() => null);
    const row = ctx.q.listImportedSplits().find((s) => s.id === Number(body?.importedSplitId));
    if (!row) return c.json({ errors: ['Imported split not found'] }, 404);
    ctx.q.insertManualSplit({ ticker: row.ticker, exDate: row.exDate, ratio: row.ratio });
    return c.json({ applied: row });
  });

  return r;
}
