// Parses rows in the sheet's format (pasted TSV or CSV) into validated
// transactions. Pure: text in, rows + errors out. Nothing is saved here.
import type { AssetType, TxType } from '../engine/types.ts';

export interface ParsedRow {
  /** Line number in the input (the header is row 1). */
  row: number;
  /** Order among the valid trades, starting at 1. */
  seq: number;
  ticker: string;
  assetType: AssetType | null;
  type: TxType;
  shares: number;
  price: number;
  date: string;
  account: string;
  note: string;
}

export interface ParsedSplit {
  row: number;
  ticker: string;
  exDate: string;
  ratio: number;
}

export interface RowError {
  row: number;
  message: string;
}

export interface ImportResult {
  rows: ParsedRow[];
  /** `Type = Split` rows: not applied, kept for the data-health cross-check. */
  splits: ParsedSplit[];
  errors: RowError[];
  fileErrors: string[];
  /** Rows left out on purpose, with the reason (broker imports only). */
  skipped?: RowError[];
  /** Set when the text was a broker export, not the sheet format. */
  source?: 'schwab' | 'robinhood';
  /** The dates a broker export covers. */
  range?: { from: string; to: string };
}

type Field = 'ticker' | 'assetType' | 'type' | 'shares' | 'split' | 'price' | 'date' | 'account' | 'note';

const HEADERS: Record<string, Field> = {
  ticker: 'ticker',
  'asset type': 'assetType',
  type: 'type',
  shares: 'shares',
  'split (n to 1)': 'split',
  'avg price': 'price',
  date: 'date',
  account: 'account',
  note: 'note',
  notes: 'note',
  '': 'note',
};

const REQUIRED: [Field, string][] = [
  ['ticker', 'Ticker'],
  ['type', 'Type'],
  ['shares', 'Shares'],
  ['price', 'Avg Price'],
  ['date', 'Date'],
];

export function parseImport(text: string): ImportResult {
  const result: ImportResult = { rows: [], splits: [], errors: [], fileErrors: [] };
  const lines = splitLines(text.replace(/^﻿/, ''));
  const headerIdx = lines.findIndex((l) => l.trim() !== '');
  if (headerIdx < 0) {
    result.fileErrors.push('Nothing to import');
    return result;
  }
  const delimiter = lines[headerIdx].includes('\t') ? '\t' : ',';
  const cells = (line: string) => (delimiter === '\t' ? line.split('\t').map(unquote) : splitCsvLine(line));

  const columns = new Map<Field, number>();
  cells(lines[headerIdx]).forEach((h, i) => {
    const field = HEADERS[h.trim().toLowerCase()];
    if (field && !columns.has(field)) columns.set(field, i);
  });
  for (const [field, name] of REQUIRED) if (!columns.has(field)) result.fileErrors.push(`Missing required column: ${name}`);
  if (result.fileErrors.length) return result;

  let seq = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = i + 1;
    const values = cells(lines[i]);
    if (values.every((v) => v.trim() === '')) continue;
    const get = (f: Field) => {
      const idx = columns.get(f);
      return idx === undefined ? '' : (values[idx] ?? '').trim();
    };
    const err = (message: string) => result.errors.push({ row, message });

    const ticker = get('ticker').toUpperCase();
    const typeRaw = get('type');
    const type = normalizeType(typeRaw);
    const date = parseDate(get('date'));
    if (!ticker) { err('Ticker is empty'); continue; }
    if (!type) { err(`Type must be Buy, Sell or Split (got "${typeRaw}")`); continue; }
    if (!date) { err(`Date is not a valid M/D/YYYY or YYYY-MM-DD date (got "${get('date')}")`); continue; }

    if (type === 'Split') {
      const ratio = parseNumber(get('split'));
      if (ratio === null || ratio <= 0) { err(`Split (n to 1) must be a positive number (got "${get('split')}")`); continue; }
      result.splits.push({ row, ticker, exDate: date, ratio });
      continue;
    }

    const assetRaw = get('assetType');
    const assetType = normalizeAssetType(assetRaw);
    if (assetRaw && !assetType) { err(`Asset Type must be Stock or ETF (got "${assetRaw}")`); continue; }
    const shares = parseNumber(get('shares'));
    if (shares === null || shares <= 0) { err(`Shares must be a positive number (got "${get('shares')}")`); continue; }
    const price = parseNumber(get('price'));
    if (price === null || price < 0) { err(`Avg Price must be a number zero or above (got "${get('price')}")`); continue; }

    result.rows.push({
      row,
      seq: ++seq,
      ticker,
      assetType,
      type,
      shares,
      price,
      date,
      account: get('account'),
      note: get('note'),
    });
  }
  return result;
}

function normalizeType(s: string): TxType | 'Split' | null {
  const t = s.trim().toLowerCase();
  if (t === 'buy') return 'Buy';
  if (t === 'sell') return 'Sell';
  if (t === 'split') return 'Split';
  return null;
}

function normalizeAssetType(s: string): AssetType | null {
  const t = s.trim().toLowerCase();
  if (t === 'stock') return 'Stock';
  if (t === 'etf') return 'ETF';
  return null;
}

/** Accepts `$`, thousands commas and surrounding spaces. */
export function parseNumber(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null;
  return Number(cleaned);
}

/** `M/D/YYYY` (or `M/D/YY`) or `YYYY-MM-DD` → ISO date, or null if invalid. */
export function parseDate(s: string): string | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim()))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Splits into lines, keeping newlines that sit inside double quotes. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  lines.push(cur);
  return lines;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}
