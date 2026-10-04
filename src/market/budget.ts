// Trailing-hour request budget, backed by the provider_requests log.
import type { Queries } from '../db/queries.ts';

export const HOURLY_LIMIT = 45;
const HOUR_MS = 3_600_000;

export class RequestBudget {
  constructor(
    private readonly q: Queries,
    private readonly now: () => Date,
    readonly limit = HOURLY_LIMIT,
  ) {}

  private windowTimes(): string[] {
    return this.q.requestTimesSince(new Date(this.now().getTime() - HOUR_MS).toISOString());
  }

  used(): number {
    return this.windowTimes().length;
  }

  remaining(): number {
    return Math.max(0, this.limit - this.used());
  }

  /** When the next request becomes allowed, or null if one is allowed now. */
  resumesAt(): string | null {
    const times = this.windowTimes();
    if (times.length < this.limit) return null;
    // The request that must age out is the (n - limit + 1)th oldest in the window.
    const pivot = times[times.length - this.limit];
    return new Date(Date.parse(pivot) + HOUR_MS).toISOString();
  }

  record(kind: string, symbol: string | null, status: number | null, ok: boolean): void {
    this.q.logRequest({ at: this.now().toISOString(), kind, symbol, status, ok });
  }
}
