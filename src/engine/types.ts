// Core engine types. Dates are ISO `YYYY-MM-DD` strings with no time zone.

export type TxType = 'Buy' | 'Sell';
export type AssetType = 'Stock' | 'ETF';
export type SecurityStatus = 'ok' | 'pending' | 'unresolved';

/** A share count within this distance of zero is a closed position. */
export const ZERO_SHARES = 1e-9;

export interface Transaction {
  id: number;
  /** Insertion order; breaks ties between same-day transactions. */
  seq: number;
  ticker: string;
  type: TxType;
  /** As traded on that date (not split-adjusted). */
  shares: number;
  /** Per share, as traded on that date. */
  price: number;
  date: string;
  account: string;
  note?: string;
  /** A dividend reinvestment derived by the engine (drip.ts), not an entered trade. */
  drip?: boolean;
}

export interface Split {
  ticker: string;
  exDate: string;
  /** 10 for a 10-for-1, 0.1 for a 1-for-10 reverse split. */
  ratio: number;
}

/** A cash dividend: `amount` per share, paid to shares held going into `exDate`. */
export interface Dividend {
  ticker: string;
  exDate: string;
  amount: number;
}

/** A daily bar as the engine needs it: raw (as-traded) close. */
export interface PriceBar {
  date: string;
  close: number;
}

export interface Quote {
  last: number;
  prevClose: number | null;
  /** ISO timestamp or date of the quote. */
  asOf: string;
}

export type CostMethod = 'average' | 'fifo';
