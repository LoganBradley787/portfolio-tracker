// Robinhood account activity CSV → the ledger's import shape. Pure, and only
// ordinary stock/ETF buys and sells are kept. The caller supplies the account.
import { parseDate, parseNumber, type ImportResult } from './parse.ts';

const REQUIRED = ['Activity Date', 'Instrument', 'Description', 'Trans Code', 'Quantity', 'Price'];

/** Recognize the header even when another required column is missing. */
export function isRobinhoodExport(text: string): boolean {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n|\r/).find((line) => line.trim() !== '') ?? '';
  const names = header.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').trim().toLowerCase());
  return names.includes('activity date') && names.includes('trans code');
}

export function parseRobinhood(text: string, account: string): ImportResult {
  const result: ImportResult = { rows: [], splits: [], errors: [], fileErrors: [], skipped: [], source: 'robinhood' };
  const csv = readCsv(text.replace(/^\uFEFF/, ''));
  if (csv.error) {
    result.fileErrors.push(csv.error);
    return result;
  }
  const records = csv.records.filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  const header = records.shift();
  if (!header) {
    result.fileErrors.push('Nothing to import');
    return result;
  }
  const columns = new Map<string, number>();
  header.cells.forEach((name, index) => {
    const key = name.trim().toLowerCase();
    if (columns.has(key)) result.fileErrors.push(`Duplicate column: ${name.trim()}`);
    else columns.set(key, index);
  });
  for (const name of REQUIRED) {
    if (!columns.has(name.toLowerCase())) result.fileErrors.push(`Missing required column: ${name}`);
  }
  if (result.fileErrors.length) return result;

  for (const { row, cells } of records) {
    const get = (name: string) => (cells[columns.get(name.toLowerCase())!] ?? '').trim();
    const code = get('Trans Code');
    // Disclaimers can extend past the header width. Check activity fields before
    // checking width, while still accepting the older single-cell prose footer.
    const proseFooter = cells.length === 1 && !code && !/^\d/.test(cells[0].trim());
    if ((!get('Activity Date') && !code) || proseFooter) {
      result.skipped!.push({ row, message: 'Report footer: not activity' });
      continue;
    }
    const err = (message: string) => result.errors.push({ row, message });
    if (cells.length !== header.cells.length) {
      err(`Expected ${header.cells.length} columns, got ${cells.length}`);
      continue;
    }
    const normalized = code.toLowerCase();
    if (!code) {
      err('Trans Code is empty');
      continue;
    }
    if (normalized !== 'buy' && normalized !== 'sell') {
      const why = normalized === 'cdiv' ? 'dividends are handled by the app' : 'not a supported stock/ETF trade';
      result.skipped!.push({ row, message: `${code}: ${why}` });
      continue;
    }
    const description = get('Description');
    if (normalized === 'buy' && /\bdividend\s+re[\s-]?investment\b|\bDRIP\b/i.test(description)) {
      result.skipped!.push({ row, message: `${code}: the app reinvests dividends itself` });
      continue;
    }
    const ticker = get('Instrument').toUpperCase();
    const date = parseDate(get('Activity Date'));
    const shares = parseNumber(get('Quantity'));
    const price = parseNumber(get('Price'));
    if (!/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(ticker)) {
      err(`Instrument must be a stock/ETF ticker (got "${get('Instrument')}")`);
      continue;
    }
    if (!date) { err(`Activity Date is not a valid date (got "${get('Activity Date')}")`); continue; }
    if (shares === null || !Number.isFinite(shares) || shares <= 0) {
      err(`Quantity must be a finite positive number (got "${get('Quantity')}")`);
      continue;
    }
    if (price === null || !Number.isFinite(price) || price < 0) {
      err(`Price must be a finite number zero or above (got "${get('Price')}")`);
      continue;
    }
    result.rows.push({
      row, seq: 0, ticker, assetType: /\bETF\b/i.test(description) ? 'ETF' : null,
      type: normalized === 'buy' ? 'Buy' : 'Sell', shares, price, date, account, note: '',
    });
  }

  // Reports list newest first, with no execution times. Reverse file order for
  // same-day trades, as for Schwab; the UI lets the user adjust ledger order.
  result.rows.reverse().sort((a, b) => a.date.localeCompare(b.date));
  result.rows.forEach((r, i) => (r.seq = i + 1));
  return result;
}

interface CsvRecord { row: number; cells: string[] }

/** Keep physical line numbers and fail closed on incomplete/misplaced quotes. */
function readCsv(text: string): { records: CsvRecord[]; error?: string } {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let value = '';
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';
  let line = 1;
  let row = 1;
  const error = () => ({ records: [], error: `Malformed CSV quoting at line ${line}` });
  const cell = () => { cells.push(value); value = ''; state = 'start'; };
  const record = () => { cell(); records.push({ row, cells }); cells = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else state = 'closed';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        value += '\n';
        line++;
      } else value += ch;
    } else if (ch === ',') {
      cell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record();
      line++;
      row = line;
    } else if (ch === '"') {
      if (state !== 'start') return error();
      value = '';
      state = 'quoted';
    } else if (state === 'closed') {
      if (ch !== ' ' && ch !== '\t') return error();
    } else {
      value += ch;
      if (ch !== ' ' && ch !== '\t') state = 'unquoted';
    }
  }
  if (state === 'quoted') return error();
  record();
  return { records };
}
