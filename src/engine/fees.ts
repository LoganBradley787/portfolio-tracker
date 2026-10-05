// What the funds held cost each year in fees, and what those fees add up to.
import type { AssetType } from './types.ts';

export interface FeeRow {
  ticker: string;
  value: number;
  /** Annual fee as a fraction of assets; null when none is published. */
  expenseRatio: number | null;
  annualCost: number | null;
}

export interface FeeDrag {
  years: number;
  /** How much smaller today's fund holdings end up after this many years of fees. */
  cost: number;
}

export interface FeeSummary {
  rows: FeeRow[];
  /** Fees on today's values over one year, for the funds with a known ratio. */
  annualCost: number;
  /** Value of the funds with a known ratio. */
  coveredValue: number;
  /** Value of every holding, stocks included. */
  portfolioValue: number;
  /** annualCost ÷ portfolioValue: the fee on the whole portfolio. Null when it is empty. */
  blendedRatio: number | null;
  /** Funds held with no published ratio. */
  missing: string[];
  /** The yearly growth assumed for `drag`, before fees. */
  growth: number;
  drag: FeeDrag[];
}

export const FEE_GROWTH = 0.07;
export const FEE_HORIZONS = [10, 20, 30];

/**
 * Fund fees on today's holdings. Stocks have none. The drag compares each
 * fund's value growing at `growth` a year with and without its fee taken
 * yearly; later purchases are not counted.
 */
export function fundFees(input: {
  holdings: { ticker: string; equity: number; assetType: AssetType }[];
  expenseRatios: Record<string, number | null | undefined>;
  growth?: number;
  horizons?: number[];
}): FeeSummary {
  const growth = input.growth ?? FEE_GROWTH;
  const rows: FeeRow[] = input.holdings
    .filter((h) => h.assetType === 'ETF')
    .map((h) => {
      const expenseRatio = input.expenseRatios[h.ticker] ?? null;
      return { ticker: h.ticker, value: h.equity, expenseRatio, annualCost: expenseRatio === null ? null : h.equity * expenseRatio };
    })
    .sort((a, b) => (b.annualCost ?? -1) - (a.annualCost ?? -1) || b.value - a.value);
  const covered = rows.filter((r) => r.expenseRatio !== null);
  const annualCost = covered.reduce((a, r) => a + r.annualCost!, 0);
  const portfolioValue = input.holdings.reduce((a, h) => a + h.equity, 0);
  return {
    rows,
    annualCost,
    coveredValue: covered.reduce((a, r) => a + r.value, 0),
    portfolioValue,
    blendedRatio: portfolioValue > 0 ? annualCost / portfolioValue : null,
    missing: rows.filter((r) => r.expenseRatio === null).map((r) => r.ticker),
    growth,
    drag: (input.horizons ?? FEE_HORIZONS).map((years) => ({
      years,
      cost: covered.reduce((a, r) => a + r.value * ((1 + growth) ** years - ((1 + growth) * (1 - r.expenseRatio!)) ** years), 0),
    })),
  };
}
