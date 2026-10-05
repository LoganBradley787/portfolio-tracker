import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import { accountsParam, assetTypeParam, methodParam, sortParam } from '../params.ts';
import { exposureView, moversView, outlookView, performanceView, portfolioView, realizedView, seriesView, tickerView } from '../service.ts';
import { parseDate } from '../../import/parse.ts';

export function portfolioRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/exposure', (c) => {
    ctx.cache.maybeRefresh();
    ctx.fundHoldings.maybeRefresh();
    const integer = (key: string, fallback: number, max: number) => {
      const text = c.req.query(key);
      const value = text && /^\d+$/.test(text) ? Number(text) : fallback;
      return Number.isSafeInteger(value) ? Math.min(value, max) : fallback;
    };
    return c.json(exposureView(ctx, {
      method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')),
      page: {
        query: c.req.query('search') ?? '',
        sort: { key: c.req.query('sort') ?? 'total', dir: c.req.query('dir') === 'asc' ? 'asc' : 'desc' },
        offset: integer('offset', 0, Number.MAX_SAFE_INTEGER), limit: Math.max(1, integer('limit', 20, 100)),
      },
    }));
  });

  r.get('/portfolio', (c) => {
    ctx.inbox?.maybeScan();
    ctx.cache.maybeRefresh();
    ctx.sectors.maybeRefresh();
    ctx.fundSectors.maybeRefresh();
    return c.json(portfolioView(ctx, { assetType: assetTypeParam(c.req.query('assetType')), method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) }));
  });

  r.get('/movers', (c) => c.json(moversView(ctx, { method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) })));

  r.get('/outlook', (c) => {
    ctx.cache.maybeRefresh();
    ctx.fundSectors.maybeRefresh();
    return c.json(outlookView(ctx, { method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) }));
  });

  r.get('/realized', (c) =>
    c.json(
      realizedView(ctx, {
        assetType: assetTypeParam(c.req.query('assetType')),
        method: methodParam(c.req.query('method')),
        sort: sortParam(c.req.query('sort')),
        accounts: accountsParam(c.req.queries('account')),
      }),
    ),
  );

  const range = (q: (k: string) => string | undefined) => {
    const from = q('from') ? parseDate(q('from')!) : undefined;
    const to = q('to') ? parseDate(q('to')!) : undefined;
    return { from, to, bad: from === null || to === null };
  };

  r.get('/series', (c) => {
    const { from, to, bad } = range((k) => c.req.query(k));
    if (bad) return c.json({ errors: ['from and to must be YYYY-MM-DD'] }, 400);
    return c.json(seriesView(ctx, { from: from ?? undefined, to: to ?? undefined, method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) }));
  });

  r.get('/performance', (c) => {
    const { from, to, bad } = range((k) => c.req.query(k));
    if (bad) return c.json({ errors: ['from and to must be YYYY-MM-DD'] }, 400);
    return c.json(performanceView(ctx, { from: from ?? undefined, to: to ?? undefined, method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) }));
  });

  r.get('/ticker/:ticker', (c) => {
    const { from, to, bad } = range((k) => c.req.query(k));
    if (bad || (from && to && from > to)) return c.json({ errors: ['Choose a valid date range'] }, 400);
    const view = tickerView(ctx, c.req.param('ticker').toUpperCase(), { from: from ?? undefined, to: to ?? undefined,
      method: methodParam(c.req.query('method')), accounts: accountsParam(c.req.queries('account')) });
    return view ? c.json(view) : c.json({ errors: ['Security not found'] }, 404);
  });

  return r;
}
