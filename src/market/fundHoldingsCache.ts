// Separate from Tiingo's request budget. Only currently held VOO/VT are fetched.
import type { Queries } from '../db/queries.ts';
import { currentLedger } from '../db/ledgerState.ts';
import { easternDate } from './cache.ts';
import { VANGUARD_FUNDS, type FundHoldingsProvider } from './vanguard.ts';

const WEEK_MS = 7 * 24 * 3_600_000;
const RETRY_MS = 6 * 3_600_000;
// Bound ledger work from status polls; newly bought funds are discovered within five minutes.
const CHECK_MS = 5 * 60_000;

export class FundHoldingsCache {
  readonly status: { state: 'idle' | 'running'; finishedAt: string | null; pending: string[] } = {
    state: 'idle', finishedAt: null, pending: [],
  };
  private readonly q: Queries;
  private readonly provider: FundHoldingsProvider;
  private readonly now: () => Date;
  private nextCheckAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(deps: { q: Queries; provider: FundHoldingsProvider; now: () => Date }) {
    this.q = deps.q;
    this.provider = deps.provider;
    this.now = deps.now;
  }

  heldFunds(): string[] {
    const held = currentLedger(this.q).ledger.positions;
    return [...held.keys()].filter((ticker) => Object.hasOwn(VANGUARD_FUNDS, ticker));
  }

  plan(): string[] {
    const now = this.now().getTime();
    return this.heldFunds().filter((ticker) => {
      const saved = this.q.getFundHoldingsStatus(ticker);
      if (saved && now - Date.parse(saved.lastAttemptAt) < RETRY_MS) return false;
      return !saved?.lastCheckedAt || now - Date.parse(saved.lastCheckedAt) >= WEEK_MS;
    });
  }

  maybeRefresh(): void {
    if (this.inFlight || this.now().getTime() < this.nextCheckAt) return;
    this.nextCheckAt = this.now().getTime() + CHECK_MS;
    try {
      void this.refresh().catch((error) => console.error('Fund holdings background refresh failed', error));
    } catch (error) {
      console.error('Fund holdings background refresh failed', error);
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
    this.status.state = 'running';
    this.status.pending = [...tickers];
    try {
      for (const ticker of tickers) {
        try {
          const snapshot = await this.provider.holdings(ticker);
          const previous = this.q.getFundHoldings(ticker)?.snapshot;
          if (previous && snapshot.effectiveDate < previous.effectiveDate) throw new Error('Vanguard returned an older snapshot');
          if (snapshot.effectiveDate > easternDate(this.now())) throw new Error('Vanguard returned a future snapshot');
          this.q.saveFundHoldings(ticker, snapshot, this.now().toISOString());
        } catch (e) {
          this.q.recordFundHoldingsFailure(ticker, this.now().toISOString(), e instanceof Error ? e.message : 'Vanguard holdings refresh failed');
        }
        this.status.pending = this.status.pending.filter((t) => t !== ticker);
      }
    } finally {
      this.status.state = 'idle';
      this.status.pending = [];
      this.status.finishedAt = this.now().toISOString();
    }
  }
}
