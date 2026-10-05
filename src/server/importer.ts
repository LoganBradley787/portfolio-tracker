// Reads import text in any supported format, setting aside broker trades the ledger already has.
import type { Queries } from '../db/queries.ts';
import { parseImport, type ImportResult } from '../import/parse.ts';
import { isRobinhoodExport, parseRobinhood } from '../import/robinhood.ts';
import { isSchwabExport, parseSchwab } from '../import/schwab.ts';

/** The sheet format, or a broker export with existing trades set aside. */
export function parseForImport(q: Queries, text: string, account: string): ImportResult {
  const parsed = isSchwabExport(text) ? parseSchwab(text, account)
    : isRobinhoodExport(text) ? parseRobinhood(text, account) : parseImport(text);
  if (!parsed.source) return parsed;
  const key = (t: { account: string; date: string; ticker: string; type: string; shares: number; price: number }) =>
    [t.account, t.date, t.ticker, t.type, t.shares, t.price].join('|');
  // Match occurrences, so equal-sized executions are not collapsed when a
  // larger report contains more copies of a trade than the ledger already has.
  const existing = new Map<string, number>();
  for (const trade of q.listTransactions()) existing.set(key(trade), (existing.get(key(trade)) ?? 0) + 1);
  const fresh = parsed.rows.filter((row) => {
    const tradeKey = key(row);
    const count = existing.get(tradeKey) ?? 0;
    if (!count) return true;
    existing.set(tradeKey, count - 1);
    parsed.skipped!.push({ row: row.row, message: 'Already in the app' });
    return false;
  });
  fresh.forEach((row, i) => (row.seq = i + 1));
  return { ...parsed, rows: fresh };
}
