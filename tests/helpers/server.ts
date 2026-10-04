// A test app on a temp database, seeded from the sample with fixture prices.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { fakeTiingo, type FakeOptions } from './fakeTiingo.ts';
import { FIXTURES } from './fixtures.ts';

export const NOW = new Date('2026-10-02T16:30:00.000Z');
export const sampleTsv = () => readFileSync(join(FIXTURES, 'sample', 'transactions.tsv'), 'utf8');

export function testApp(opts: { fake?: FakeOptions; apiKey?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pt-app-'));
  const fake = fakeTiingo(opts.fake);
  const ctx = createContext({
    dbPath: join(dir, 'portfolio.db'),
    apiKey: opts.apiKey === undefined ? 'test-key' : opts.apiKey,
    fetchFn: fake.fetchFn,
    now: () => NOW,
    autoRefresh: false,
  });
  const app = createApp(ctx);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };
  /** Imports the sample and loads fixture prices through the real cache. */
  const seed = async (extraTsvRows: string[] = []) => {
    const text = [sampleTsv().trimEnd(), ...extraTsvRows].join('\n');
    const r = await call('POST', '/api/import/commit', { text, mode: 'replace' });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    await ctx.cache.refresh();
  };
  return { app, ctx, call, seed, fake, dir };
}
