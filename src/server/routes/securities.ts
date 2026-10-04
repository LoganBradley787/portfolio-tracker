import { Hono } from 'hono';
import type { AppContext } from '../context.ts';

export function securityRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', (c) => {
    const traded = new Set(ctx.q.listTransactions().map((t) => t.ticker));
    return c.json({ securities: ctx.q.listSecurities().map((s) => ({ ...s, traded: traded.has(s.ticker) })) });
  });

  r.put('/:ticker', async (c) => {
    const body = await c.req.json().catch(() => null);
    const patch: Record<string, unknown> = {};
    if (body?.assetType !== undefined) {
      if (body.assetType !== 'Stock' && body.assetType !== 'ETF') return c.json({ errors: ['Asset type must be Stock or ETF'] }, 400);
      patch.assetType = body.assetType;
    }
    for (const k of ['name', 'sector', 'providerSymbol'] as const) if (body?.[k] !== undefined) patch[k] = body[k] === null ? null : String(body[k]).trim();
    if (typeof patch.providerSymbol === 'string' && patch.providerSymbol && !/^[A-Za-z0-9.\-^]{1,15}$/.test(patch.providerSymbol)) {
      return c.json({ errors: ['Provider symbol must be letters, digits, "." or "-"'] }, 400);
    }
    const updated = ctx.q.updateSecurity(c.req.param('ticker').toUpperCase(), patch);
    if (!updated) return c.json({ errors: ['Security not found'] }, 404);
    ctx.cache.maybeRefresh();
    return c.json(updated);
  });

  return r;
}
