import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { createContext } from './context.ts';
import { loadEnv } from './env.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIR = 'dist/client';

loadEnv();
const dbPath = process.env.PORTFOLIO_DB ?? 'data/portfolio.db';
const ctx = createContext({
  dbPath,
  apiKey: process.env.TIINGO_API_KEY?.trim() || null,
  inboxDir: process.env.PORTFOLIO_INBOX ?? join(dirname(dbPath), 'inbox'),
  passwordFile: join(dirname(dbPath), 'password'),
});
ctx.inbox?.start();
const app = createApp(ctx);

if (existsSync(CLIENT_DIR)) {
  app.use('/*', serveStatic({ root: CLIENT_DIR }));
  // Client-side routes fall back to index.html.
  app.get('*', serveStatic({ root: CLIENT_DIR, path: 'index.html' }));
}

serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`Portfolio tracker on http://${info.address}:${info.port}`);
  if (!ctx.hasKey) console.log('No TIINGO_API_KEY found: the app will show the setup screen.');
});
