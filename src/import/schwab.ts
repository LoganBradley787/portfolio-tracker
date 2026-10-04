// Parses Schwab's JSON transaction export into the same shape as a sheet
// import. Pure: text in, rows + skipped + errors out. Only Buy and Sell rows
// become transactions; the file names no account, so the caller supplies it.
import { parseDate, parseNumber, type ImportResult } from './parse.ts';

interface SchwabRow {
  Date?: string;
  Action?: string;
  Symbol?: string;
  Description?: string;
  Quantity?: string;
  Price?: string;
}

/** True for text shaped like the export: a JSON object with `BrokerageTransactions`. */
export function isSchwabExport(text: string): boolean {
  return /^\s*\{/.test(text) && text.includes('"BrokerageTransactions"');
}

/** `08/07/2026 as of 08/06/2026` → the "as of" date, which is when it happened. */
function schwabDate(s: string | undefined): string | null {
  const parts = (s ?? '').split(' as of ');
  return parseDate(parts[parts.length - 1].trim());
}

export function parseSchwab(text: string, account: string): ImportResult {
  const result: ImportResult = { rows: [], splits: [], errors: [], fileErrors: [], skipped: [], source: 'schwab' };
  let file: { FromDate?: string; ToDate?: string; BrokerageTransactions?: SchwabRow[] };
  try {
    file = JSON.parse(text);
  } catch {
    result.fileErrors.push('This file is not a complete Schwab JSON export');
    return result;
  }
  if (!Array.isArray(file.BrokerageTransactions)) {
    result.fileErrors.push('This file is not a complete Schwab JSON export');
    return result;
  }
  const from = schwabDate(file.FromDate);
  const to = schwabDate(file.ToDate);
  if (from && to) result.range = { from, to };

  file.BrokerageTransactions.forEach((t, i) => {
    const row = i + 1;
    const action = (t.Action ?? '').trim();
    if (action !== 'Buy' && action !== 'Sell') {
      const why = action.startsWith('Reinvest') ? 'the app reinvests dividends itself' : 'not a trade';
      result.skipped!.push({ row, message: `${action || 'No action'}: ${why}` });
      return;
    }
    const err = (message: string) => result.errors.push({ row, message });
    const ticker = (t.Symbol ?? '').trim().toUpperCase();
    const date = schwabDate(t.Date);
    const shares = parseNumber(t.Quantity ?? '');
    const price = parseNumber(t.Price ?? '');
    if (!ticker) return err('Symbol is empty');
    if (!date) return err(`Date is not a valid date (got "${t.Date ?? ''}")`);
    if (shares === null || shares <= 0) return err(`Quantity must be a positive number (got "${t.Quantity ?? ''}")`);
    if (price === null || price < 0) return err(`Price must be a number zero or above (got "${t.Price ?? ''}")`);
    const assetType = /\bETF\b/i.test(t.Description ?? '') ? 'ETF' : null;
    result.rows.push({ row, seq: 0, ticker, assetType, type: action, shares, price, date, account, note: '' });
  });

  // The file lists the newest first; the ledger wants the oldest first.
  result.rows.reverse().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  result.rows.forEach((r, i) => (r.seq = i + 1));
  return result;
}
