// Request-body validation for the transaction form.
import type { AssetType } from '../engine/types.ts';
import type { TransactionInput } from '../db/queries.ts';
import { parseDate, parseNumber } from '../import/parse.ts';

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateTransaction(body: any): Validated<TransactionInput & { assetType?: AssetType }> {
  const errors: string[] = [];
  const ticker = String(body?.ticker ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9.\-^]{1,15}$/.test(ticker)) errors.push('Ticker is required (letters, digits, "." or "-")');
  const type = body?.type === 'Buy' || body?.type === 'Sell' ? body.type : null;
  if (!type) errors.push('Type must be Buy or Sell');
  const shares = typeof body?.shares === 'number' ? body.shares : parseNumber(String(body?.shares ?? ''));
  if (shares === null || !Number.isFinite(shares) || shares <= 0) errors.push('Shares must be a positive number');
  const price = typeof body?.price === 'number' ? body.price : parseNumber(String(body?.price ?? ''));
  if (price === null || !Number.isFinite(price) || price < 0) errors.push('Price must be a number zero or above');
  const date = parseDate(String(body?.date ?? ''));
  if (!date) errors.push('Date must be YYYY-MM-DD or M/D/YYYY');
  const assetType = body?.assetType === 'Stock' || body?.assetType === 'ETF' ? body.assetType : undefined;
  if (body?.assetType && !assetType) errors.push('Asset type must be Stock or ETF');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ticker,
      type: type!,
      shares: shares!,
      price: price!,
      date: date!,
      account: String(body?.account ?? '').trim(),
      note: String(body?.note ?? '').trim(),
      assetType,
    },
  };
}
