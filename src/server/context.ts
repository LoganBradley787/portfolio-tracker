// Everything a route needs: the database, the market cache and a clock.
import { join } from 'node:path';
import { openDatabase } from '../db/migrate.ts';
import { Queries } from '../db/queries.ts';
import { MarketCache, easternDate } from '../market/cache.ts';
import { TiingoProvider, type FetchFn } from '../market/tiingo.ts';
import { FundHoldingsCache } from '../market/fundHoldingsCache.ts';
import { VanguardHoldingsProvider, type FundHoldingsProvider } from '../market/vanguard.ts';
import { SectorFill } from '../market/sectorFill.ts';
import { FundSectorCache } from '../market/fundSectorCache.ts';
import { YahooProfileProvider, type FundSectorProvider, type ProfileProvider } from '../market/yahoo.ts';

export interface AppContext {
  q: Queries;
  cache: MarketCache;
  fundHoldings: FundHoldingsCache;
  sectors: SectorFill;
  fundSectors: FundSectorCache;
  now: () => Date;
  /** Today's date in New York. */
  today: () => string;
  backupDir?: string;
  hasKey: boolean;
}

export interface ContextOptions {
  dbPath: string;
  apiKey?: string | null;
  fetchFn?: FetchFn;
  fundHoldingsProvider?: FundHoldingsProvider;
  profileProvider?: ProfileProvider;
  fundSectorProvider?: FundSectorProvider;
  now?: () => Date;
  backupDir?: string;
  /** Start background refreshes on page loads. Off in tests. */
  autoRefresh?: boolean;
}

export function createContext(opts: ContextOptions): AppContext {
  const now = opts.now ?? (() => new Date());
  const db = openDatabase(opts.dbPath, { now, backupDir: opts.backupDir });
  const q = new Queries(db);
  const provider = opts.apiKey ? new TiingoProvider(opts.apiKey, opts.fetchFn) : null;
  const cache = new MarketCache({ q, provider, now });
  const fundHoldings = new FundHoldingsCache({ q, provider: opts.fundHoldingsProvider ?? new VanguardHoldingsProvider(), now });
  const yahoo = new YahooProfileProvider();
  const sectors = new SectorFill({ q, provider: opts.profileProvider ?? yahoo });
  const fundSectors = new FundSectorCache({ q, provider: opts.fundSectorProvider ?? yahoo, now });
  if (opts.autoRefresh === false) {
    cache.maybeRefresh = () => {};
    fundHoldings.maybeRefresh = () => {};
    sectors.maybeRefresh = () => {};
    fundSectors.maybeRefresh = () => {};
  }
  return {
    q,
    cache,
    fundHoldings,
    sectors,
    fundSectors,
    now,
    today: () => easternDate(now()),
    backupDir: opts.backupDir ?? (opts.dbPath === ':memory:' ? undefined : join(opts.dbPath, '..', 'backups')),
    hasKey: !!provider,
  };
}
