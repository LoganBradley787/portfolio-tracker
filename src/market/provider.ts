// The app's own market-data types, independent of any provider.
import type { PriceBar } from '../engine/types.ts';

export interface HistoryResult {
  bars: PriceBar[];
  splits: { exDate: string; ratio: number }[];
  dividends: { exDate: string; amount: number }[];
}

export interface QuoteResult {
  symbol: string;
  last: number;
  prevClose: number | null;
  asOf: string;
}

export interface MetaResult {
  symbol: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  /** False when the provider knows the symbol but has no data (e.g. renamed SQ). */
  resolved: boolean;
}

export type ProviderErrorKind = 'not-found' | 'rate-limit' | 'auth' | 'network' | 'provider';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface MarketDataProvider {
  /** All daily bars from `start` (inclusive) to `end` (inclusive, default: latest). */
  history(symbol: string, start: string, end?: string): Promise<HistoryResult>;
  /** Latest quote for each symbol, in one request. Symbols with no quote are left out. */
  quotes(symbols: string[]): Promise<QuoteResult[]>;
  meta(symbol: string): Promise<MetaResult>;
}
