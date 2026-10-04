// Test-only loaders for the recorded fixtures. Deliberately independent of
// src/import and src/market so engine tests do not depend on those units.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dividend, Split, Transaction } from '../../src/engine/types.ts';

export const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

export function readJson<T = any>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(FIXTURES, ...parts), 'utf8'));
}

function isoFromUs(d: string): string {
  const [m, day, y] = d.split('/').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The 15-row sample: 14 trades (Split rows dropped), seq in row order. */
export function sampleTransactions(): Transaction[] {
  const lines = readFileSync(join(FIXTURES, 'sample', 'transactions.csv'), 'utf8').trim().split(/\r?\n/);
  const out: Transaction[] = [];
  lines.slice(1).forEach((line, i) => {
    const [ticker, , type, shares, , price, date, account] = line.split(',');
    if (type === 'Split') return;
    out.push({
      id: i + 1,
      seq: i + 1,
      ticker,
      type: type as 'Buy' | 'Sell',
      shares: Number(shares),
      price: Number(price),
      date: isoFromUs(date),
      account,
    });
  });
  return out;
}

export function sampleAssetTypes(): Record<string, 'Stock' | 'ETF'> {
  const lines = readFileSync(join(FIXTURES, 'sample', 'transactions.csv'), 'utf8').trim().split(/\r?\n/);
  const out: Record<string, 'Stock' | 'ETF'> = {};
  for (const line of lines.slice(1)) {
    const [ticker, assetType] = line.split(',');
    if (assetType && !out[ticker]) out[ticker] = assetType as 'Stock' | 'ETF';
  }
  return out;
}

export interface Bar {
  date: string;
  close: number;
  splitFactor: number;
  divCash: number;
}

export function historyBars(ticker: string): Bar[] {
  const raw = readJson<any[]>('tiingo', `history_${ticker}.json`);
  return raw.map((r) => ({ date: r.date.slice(0, 10), close: r.close, splitFactor: r.splitFactor, divCash: r.divCash }));
}

export const HISTORY_TICKERS = ['AMD', 'DIS', 'F', 'KO', 'QQQ', 'QQQM', 'SHOP', 'SPY', 'TSLA', 'UBER', 'VT', 'VZ', 'ZM'];

/** Every split in the recorded history fixtures. */
export function fixtureSplits(): Split[] {
  const out: Split[] = [];
  for (const t of HISTORY_TICKERS) {
    for (const b of historyBars(t)) if (b.splitFactor !== 1) out.push({ ticker: t, exDate: b.date, ratio: b.splitFactor });
  }
  return out;
}

/** Every dividend in the recorded history fixtures. */
export function fixtureDividends(): Dividend[] {
  const out: Dividend[] = [];
  for (const t of HISTORY_TICKERS) {
    for (const b of historyBars(t)) if (b.divCash !== 0) out.push({ ticker: t, exDate: b.date, amount: b.divCash });
  }
  return out;
}
