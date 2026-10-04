// Runs the real server on a scratch database with prices served from the
// recorded Tiingo fixtures and the clock frozen at the recording time.
// For UI checks without network access or API budget: `npx tsx scripts/demo-server.ts`.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from '../src/server/app.ts';
import { createContext } from '../src/server/context.ts';
import { fakeTiingo } from '../tests/helpers/fakeTiingo.ts';
import { readFileSync } from 'node:fs';
import { mapVanguardHoldings } from '../src/market/vanguard.ts';

const PORT = Number(process.env.PORT ?? 3001);
const ctx = createContext({
  dbPath: process.env.PORTFOLIO_DB ?? 'data/demo.db',
  apiKey: 'fixture',
  fetchFn: fakeTiingo().fetchFn,
  fundHoldingsProvider: {
    holdings: async (ticker) => mapVanguardHoldings(JSON.parse(readFileSync(
      new URL(`../tests/fixtures/vanguard/${ticker.toLowerCase()}-holdings.json`, import.meta.url), 'utf8',
    ))),
  },
  now: () => new Date('2026-10-02T16:30:00.000Z'),
});
const app = createApp(ctx);
app.use('/*', serveStatic({ root: 'dist/client' }));
app.get('*', serveStatic({ root: 'dist/client', path: 'index.html' }));
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (i) => console.log(`Demo server (fixture prices) on http://${i.address}:${i.port}`));
