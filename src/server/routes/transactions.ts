import { Hono } from 'hono';
import type { AppContext } from '../context.ts';
import { validateTransaction } from '../validate.ts';

export function transactionRoutes(ctx: AppContext) {
  const r = new Hono();

  r.get('/', (c) => {
    const account = c.req.query('account');
    const txs = ctx.q.listTransactions().filter((t) => !account || t.account === account);
    const assetTypes = Object.fromEntries(ctx.q.listSecurities().map((s) => [s.ticker, s.assetType]));
    const accounts = ctx.q.listAccounts();
    return c.json({ transactions: txs.map((t) => ({ ...t, assetType: assetTypes[t.ticker] ?? 'Stock' })), accounts });
  });

  r.post('/', async (c) => {
    const v = validateTransaction(await c.req.json().catch(() => null));
    if (!v.ok) return c.json({ errors: v.errors }, 400);
    const { assetType, ...input } = v.value;
    return c.json(ctx.q.insertTransaction(input, assetType), 201);
  });

  r.post('/reorder', async (c) => {
    const body = await c.req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || (body?.direction !== 'up' && body?.direction !== 'down')) {
      return c.json({ errors: ['Expected { id, direction: "up" | "down" }'] }, 400);
    }
    return c.json({ moved: ctx.q.moveTransaction(id, body.direction) });
  });

  r.put('/:id', async (c) => {
    const v = validateTransaction(await c.req.json().catch(() => null));
    if (!v.ok) return c.json({ errors: v.errors }, 400);
    const { assetType, ...input } = v.value;
    const updated = ctx.q.updateTransaction(Number(c.req.param('id')), input);
    if (!updated) return c.json({ errors: ['Transaction not found'] }, 404);
    if (assetType) ctx.q.ensureSecurity(updated.ticker, assetType);
    return c.json(updated);
  });

  r.delete('/:id', (c) => {
    if (!ctx.q.deleteTransaction(Number(c.req.param('id')))) return c.json({ errors: ['Transaction not found'] }, 404);
    return c.body(null, 204);
  });

  return r;
}
