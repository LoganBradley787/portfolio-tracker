// Fills in blank sectors (and blank names) for traded stocks, in the background.
// Each ticker is tried once per run of the server, so anything that failed or
// was not found is tried again at the next launch. A sector the user typed is never replaced.
import type { Queries } from '../db/queries.ts';
import type { ProfileProvider } from './yahoo.ts';

export class SectorFill {
  private readonly q: Queries;
  private readonly provider: ProfileProvider;
  private readonly pauseMs: number;
  private readonly tried = new Set<string>();
  private inFlight: Promise<void> | null = null;

  constructor(deps: { q: Queries; provider: ProfileProvider; pauseMs?: number }) {
    this.q = deps.q;
    this.provider = deps.provider;
    this.pauseMs = deps.pauseMs ?? 500;
  }

  plan(): string[] {
    const traded = new Set(this.q.listTransactions().map((t) => t.ticker));
    return this.q.listSecurities()
      .filter((s) => s.assetType === 'Stock' && !s.sector && traded.has(s.ticker) && !this.tried.has(s.ticker))
      .map((s) => s.ticker);
  }

  maybeRefresh(): void {
    if (this.inFlight) return;
    try {
      void this.refresh().catch((error) => console.error('Sector background fill failed', error));
    } catch (error) {
      console.error('Sector background fill failed', error);
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
    for (const [i, ticker] of tickers.entries()) {
      if (i > 0 && this.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
      this.tried.add(ticker);
      try {
        const symbol = this.q.getSecurity(ticker)?.providerSymbol ?? ticker;
        const profile = await this.provider.profile(symbol);
        // Read again: the user may have typed a sector or a name while the request was out.
        const current = this.q.getSecurity(ticker);
        if (!profile || !current || current.sector) continue;
        this.q.updateSecurity(ticker, { sector: profile.sector, name: current.name || profile.name });
      } catch (error) {
        console.error(`Sector lookup failed for ${ticker}`, error instanceof Error ? error.message : error);
      }
    }
  }
}
