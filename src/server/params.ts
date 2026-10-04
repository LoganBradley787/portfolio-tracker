import type { SaleSort } from '../engine/realized.ts';
import type { AssetType, CostMethod } from '../engine/types.ts';

export function assetTypeParam(v: string | undefined): AssetType | undefined {
  return v === 'Stock' || v === 'ETF' ? v : undefined;
}

export function methodParam(v: string | undefined): CostMethod {
  return v === 'fifo' ? 'fifo' : 'average';
}

export function sortParam(v: string | undefined): SaleSort {
  return v === 'gain' || v === 'gainPct' ? v : 'date';
}

/** `?account=` given once or more: those accounts. Not given: every account. */
export function accountsParam(v: string[] | undefined): string[] | undefined {
  return v?.length ? v : undefined;
}
