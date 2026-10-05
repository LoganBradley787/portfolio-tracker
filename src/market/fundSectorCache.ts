// Sector breakdowns and fees of the ETFs currently held, refreshed weekly in the background.
// A failed refresh keeps the last good breakdown; Data health reports one that has gone stale.
import type { Queries } from '../db/queries.ts';
import { currentLedger } from '../db/ledgerState.ts';
import type { FundBreakdown } from '../engine/allocation.ts';
import type { FundSectorProvider } from './yahoo.ts';

const DAY_MS = 24 * 3_600_000;
const REFRESH_MS = 7 * DAY_MS;
const RETRY_MS = 6 * 3_600_000;
export const STALE_MS = 28 * DAY_MS;
// Bound ledger work from page loads; a newly bought fund is discovered within five minutes.
const CHECK_MS = 5 * 60_000;

export interface FundSectorStatus {
  ticker: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Never fetched, or last fetched more than four weeks ago. */
  stale: boolean;
}

export class FundSectorCache {
  private readonly q: Queries;
  private readonly provider: FundSectorProvider;
  private readonly now: () => Date;
  private nextCheckAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(deps: { q: Queries; provider: FundSectorProvider; now: () => Date }) {
    this.q = deps.q;
    this.provider = deps.provider;
    this.now = deps.now;
  }

  heldFunds(): string[] {
    const held = currentLedger(this.q).ledger.positions;
    return this.q.listSecurities().filter((s) => s.assetType === 'ETF' && held.has(s.ticker)).map((s) => s.ticker);
  }

  /** Each saved fund's yearly fee; null when Yahoo publishes none, absent until it has been read. */
  expenseRatios(): Record<string, number | null> {
    return Object.fromEntries(this.q.listFundSectors().flatMap((f) => (f.breakdown?.expenseRatio !== undefined ? [[f.ticker, f.breakdown.expenseRatio]] : [])));
  }

  breakdowns(): Record<string, FundBreakdown> {
    return Object.fromEntries(this.q.listFundSectors().flatMap((f) => (f.breakdown ? [[f.ticker, f.breakdown]] : [])));
  }

  /** One row per held fund, for Data health. */
  report(): FundSectorStatus[] {
    const now = this.now().getTime();
    const saved = new Map(this.q.listFundSectors().map((f) => [f.ticker, f]));
    return this.heldFunds().map((ticker) => {
      const row = saved.get(ticker);
      const lastCheckedAt = row?.lastCheckedAt ?? null;
      return { ticker, lastCheckedAt, lastError: row?.lastError ?? null, stale: !lastCheckedAt || now - Date.parse(lastCheckedAt) > STALE_MS };
    });
  }

  plan(): string[] {
    const now = this.now().getTime();
    const saved = new Map(this.q.listFundSectors().map((f) => [f.ticker, f]));
    return this.heldFunds().filter((ticker) => {
      const row = saved.get(ticker);
      if (row && now - Date.parse(row.lastAttemptAt) < RETRY_MS) return false;
      // Saved before fees were read: fetch again rather than wait out the week.
      if (row?.breakdown && row.breakdown.expenseRatio === undefined) return true;
      return !row?.lastCheckedAt || now - Date.parse(row.lastCheckedAt) >= REFRESH_MS;
    });
  }

  maybeRefresh(): void {
    if (this.inFlight || this.now().getTime() < this.nextCheckAt) return;
    this.nextCheckAt = this.now().getTime() + CHECK_MS;
    try {
      void this.refresh().catch((error) => console.error('Fund sector background refresh failed', error));
    } catch (error) {
      console.error('Fund sector background refresh failed', error);
    }
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const plan = this.plan();
    if (!plan.length) return Promise.resolve();
    this.inFlight = this.run(plan).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async run(tickers: string[]): Promise<void> {
    for (const ticker of tickers) {
      const at = this.now().toISOString();
      try {
        const symbol = this.q.getSecurity(ticker)?.providerSymbol ?? ticker;
        const breakdown = await this.provider.fundBreakdown(symbol);
        if (breakdown) this.q.saveFundSectors(ticker, breakdown, at);
        else this.q.recordFundSectorsFailure(ticker, at, 'Yahoo has no sector breakdown for this fund');
      } catch (e) {
        this.q.recordFundSectorsFailure(ticker, at, e instanceof Error ? e.message : 'Fund sector refresh failed');
      }
    }
  }
}
