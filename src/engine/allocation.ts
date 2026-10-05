// How the portfolio's market value is split (spec 7.7 "Allocation").
import type { AssetType } from './types.ts';

export interface Slice {
  label: string;
  value: number;
  pct: number;
  count: number;
}

export interface Allocation {
  byPosition: Slice[];
  byAssetType: Slice[];
  /** Funds grouped as one "ETFs" slice. */
  bySector: Slice[];
  /** Funds with a known breakdown spread across the sectors, bonds and cash they hold. */
  bySectorSplit: Slice[];
}

/** What a fund holds, as fractions of the fund. `sectors` divides the stock part and sums to 1. */
export interface FundBreakdown {
  stock: number;
  bond: number;
  sectors: Record<string, number>;
  /** Annual fee as a fraction of assets; null when none is published, absent on a breakdown saved before fees were read. */
  expenseRatio?: number | null;
}

export const UNASSIGNED = 'Unassigned';
export const ETF_GROUP = 'ETFs';
export const BONDS = 'Bonds';
export const CASH_AND_OTHER = 'Cash and other';

/** A fund's value as [label, fraction] parts; a fund with no usable breakdown stays whole. */
function fundParts(fund: FundBreakdown | undefined): [string, number][] {
  if (!fund) return [[ETF_GROUP, 1]];
  const stock = Math.min(Math.max(fund.stock, 0), 1);
  const bond = Math.min(Math.max(fund.bond, 0), 1 - stock);
  const weights = Object.entries(fund.sectors).filter(([, w]) => w > 0);
  const sum = weights.reduce((a, [, w]) => a + w, 0);
  if (stock > 0 && sum <= 0) return [[ETF_GROUP, 1]];
  const parts: [string, number][] = weights.map(([label, w]) => [label, (stock * w) / sum]);
  parts.push([BONDS, bond], [CASH_AND_OTHER, 1 - stock - bond]);
  // Rounding leftovers under a hundredth of a percent are not worth a row.
  return parts.filter(([, f]) => f > 1e-4);
}

export function allocation(
  holdings: { ticker: string; equity: number; assetType: AssetType }[],
  sectors: Record<string, string | null | undefined>,
  funds: Record<string, FundBreakdown | undefined> = {},
): Allocation {
  const total = holdings.reduce((a, h) => a + h.equity, 0);
  const split = (parts: (h: (typeof holdings)[number]) => [string, number][]): Slice[] => {
    const m = new Map<string, Slice>();
    for (const h of holdings) {
      for (const [k, fraction] of parts(h)) {
        const s = m.get(k) ?? { label: k, value: 0, pct: 0, count: 0 };
        s.value += h.equity * fraction;
        s.count++;
        m.set(k, s);
      }
    }
    return [...m.values()]
      .map((s) => ({ ...s, pct: total ? s.value / total : 0 }))
      .sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  };
  const group = (key: (h: (typeof holdings)[number]) => string): Slice[] => split((h) => [[key(h), 1]]);
  const stockSector = (ticker: string) => sectors[ticker]?.trim() || UNASSIGNED;
  return {
    byPosition: group((h) => h.ticker),
    byAssetType: group((h) => (h.assetType === 'ETF' ? ETF_GROUP : 'Stocks')),
    bySector: group((h) => (h.assetType === 'ETF' ? ETF_GROUP : stockSector(h.ticker))),
    bySectorSplit: split((h) => (h.assetType === 'ETF' ? fundParts(funds[h.ticker]) : [[stockSector(h.ticker), 1]])),
  };
}
