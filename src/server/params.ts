import type { SaleSort } from '../engine/realized.ts';
import type { AssetType, CostMethod } from '../engine/types.ts';

export function assetTypeParam(v: string | undefined): AssetType | undefined {
  return v === 'Stock' || v === 'ETF' ? v : undefined;
}

/** `?method=average`: pooled average cost. Anything else: FIFO, the default. */
export function methodParam(v: string | undefined): CostMethod {
  return v === 'average' ? 'average' : 'fifo';
}

/** `?drip=off`: dividends are cash, not reinvested. Anything else: reinvested. */
export function reinvestParam(v: string | undefined): boolean {
  return v !== 'off';
}

export function sortParam(v: string | undefined): SaleSort {
  return v === 'gain' || v === 'gainPct' ? v : 'date';
}

/** `?account=` given once or more: those accounts. Not given: every account. */
export function accountsParam(v: string[] | undefined): string[] | undefined {
  return v?.length ? v : undefined;
}
