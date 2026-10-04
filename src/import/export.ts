// Writes transactions in the sheet's column layout so an export re-imports.
// Split rows are not written: splits come from market data.
import type { AssetType, Transaction } from '../engine/types.ts';

export const EXPORT_HEADER = ['Ticker', 'Asset Type', 'Type', 'Shares', 'Split (n to 1)', 'Avg Price', 'Date', 'Account', 'Note'];

export function exportCsv(transactions: Transaction[], assetTypes: Record<string, AssetType>): string {
  const sorted = [...transactions].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.seq - b.seq));
  const lines = [EXPORT_HEADER.join(',')];
  for (const t of sorted) {
    lines.push(
      [t.ticker, assetTypes[t.ticker] ?? '', t.type, String(t.shares), '', String(t.price), usDate(t.date), t.account, t.note ?? '']
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function usDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
