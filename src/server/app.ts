import { Hono } from 'hono';
import type { AppContext } from './context.ts';
import { healthRoutes } from './routes/health.ts';
import { importExportRoutes } from './routes/importExport.ts';
import { portfolioRoutes } from './routes/portfolio.ts';
import { securityRoutes } from './routes/securities.ts';
import { transactionRoutes } from './routes/transactions.ts';

/** The unlock token comes as a header, or as `?unlock=` for plain links such as the CSV export. */
const unlockToken = (headers: Headers, query: string | undefined) => headers.get('x-unlock') ?? query ?? '';

export function createApp(ctx: AppContext) {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));

  // The optional password. These three are reachable while locked; everything else under /api needs the unlock.
  app.get('/api/lock', (c) => c.json({ on: ctx.lock.on() }));
  app.post('/api/unlock', async (c) => {
    const body = await c.req.json().catch(() => null);
    const token = ctx.lock.unlock(String(body?.password ?? ''));
    return token ? c.json({ token }) : c.json({ errors: ['Wrong password'] }, 401);
  });
  app.delete('/api/unlock', (c) => {
    ctx.lock.forget(unlockToken(c.req.raw.headers, c.req.query('unlock')));
    return c.body(null, 204);
  });
  app.use('/api/*', async (c, next) => {
    if (!ctx.lock.allows(unlockToken(c.req.raw.headers, c.req.query('unlock')))) return c.json({ locked: true, errors: ['Locked'] }, 401);
    await next();
  });
  app.put('/api/lock', async (c) => {
    const body = await c.req.json().catch(() => null);
    const password = String(body?.password ?? '').trim();
    if (!password) return c.json({ errors: ['Enter a password'] }, 400);
    ctx.lock.set(password);
    // The tab that set it stays open.
    return c.json({ on: true, token: ctx.lock.unlock(password) });
  });
  app.delete('/api/lock', (c) => {
    ctx.lock.clear();
    return c.json({ on: false });
  });
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
