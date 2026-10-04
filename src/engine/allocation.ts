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
  bySector: Slice[];
}

export const UNASSIGNED = 'Unassigned';
export const ETF_GROUP = 'ETFs';

export function allocation(
  holdings: { ticker: string; equity: number; assetType: AssetType }[],
  sectors: Record<string, string | null | undefined>,
): Allocation {
  const total = holdings.reduce((a, h) => a + h.equity, 0);
  const group = (key: (h: (typeof holdings)[number]) => string): Slice[] => {
    const m = new Map<string, Slice>();
    for (const h of holdings) {
      const k = key(h);
      const s = m.get(k) ?? { label: k, value: 0, pct: 0, count: 0 };
      s.value += h.equity;
      s.count++;
      m.set(k, s);
    }
    return [...m.values()]
      .map((s) => ({ ...s, pct: total ? s.value / total : 0 }))
      .sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  };
  return {
    byPosition: group((h) => h.ticker),
    byAssetType: group((h) => (h.assetType === 'ETF' ? ETF_GROUP : 'Stocks')),
    bySector: group((h) => (h.assetType === 'ETF' ? ETF_GROUP : sectors[h.ticker]?.trim() || UNASSIGNED)),
  };
}
