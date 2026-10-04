import { Hono } from 'hono';
import type { AppContext } from './context.ts';
import { healthRoutes } from './routes/health.ts';
import { importExportRoutes } from './routes/importExport.ts';
import { portfolioRoutes } from './routes/portfolio.ts';
import { securityRoutes } from './routes/securities.ts';
import { transactionRoutes } from './routes/transactions.ts';

export function createApp(ctx: AppContext) {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/config', (c) => c.json({ hasKey: ctx.hasKey, today: ctx.today(), accounts: ctx.q.listAccounts(), customBenchmark: ctx.q.customBenchmark() }));
  app.put('/api/benchmark', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body?.ticker !== null && (typeof body?.ticker !== 'string' || !/^[A-Za-z0-9.\-^]{1,15}$/.test(body.ticker.trim()))) {
      return c.json({ errors: ['Enter a ticker (letters, digits, "." or "-"), or null to remove it'] }, 400);
    }
    const ticker = body.ticker === null ? null : body.ticker.trim().toUpperCase();
    ctx.q.setCustomBenchmark(ticker);
    ctx.cache.maybeRefresh();
    return c.json({ customBenchmark: ticker });
  });
  app.route('/api/transactions', transactionRoutes(ctx));
  app.route('/api/securities', securityRoutes(ctx));
  app.route('/api', importExportRoutes(ctx));
  app.route('/api', portfolioRoutes(ctx));
  app.route('/api', healthRoutes(ctx));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ errors: [err.message] }, 500);
  });
  return app;
}
