import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSchwabExport, parseSchwab } from '../../src/import/schwab.ts';
import { FIXTURES } from '../helpers/fixtures.ts';

// A made-up file in the layout of Schwab's JSON transaction export.
const file = readFileSync(join(FIXTURES, 'schwab', 'transactions.json'), 'utf8');

describe('Schwab JSON export', () => {
  it('is recognised by its shape, and the sheet format is not', () => {
    expect(isSchwabExport(file)).toBe(true);
    expect(isSchwabExport('Ticker\tType\nDIS\tBuy')).toBe(false);
    expect(isSchwabExport('{"something": "else"}')).toBe(false);
  });

  it('keeps buys and sells, oldest first, under the given account', () => {
    const r = parseSchwab(file, 'Retirement');
    expect(r.source).toBe('schwab');
    expect(r.range).toEqual({ from: '2026-01-15', to: '2026-10-03' });
    expect(r.rows.map((x) => [x.seq, x.date, x.ticker, x.type, x.shares, x.price, x.account])).toEqual([
      [1, '2026-03-02', 'DIS', 'Buy', 5, 98.25, 'Retirement'],
      [2, '2026-08-06', 'VT', 'Buy', 9.5, 160.615, 'Retirement'],
      [3, '2026-08-10', 'DIS', 'Sell', 2, 1105.5, 'Retirement'], // "as of" is the trade date
    ]);
    expect(r.rows.map((x) => x.assetType)).toEqual([null, 'ETF', null]); // ETF from the description
  });

  it('skips reinvestments, transfers and other actions, and says why', () => {
    const r = parseSchwab(file, 'Retirement');
    expect(r.skipped!.map((s) => [s.row, s.message])).toEqual([
      [1, 'Reinvest Shares: the app reinvests dividends itself'],
      [2, 'Reinvest Dividend: the app reinvests dividends itself'],
      [4, 'MoneyLink Transfer: not a trade'],
      [7, 'Buy to Open: not a trade'],
    ]);
  });

  it('reports a trade it cannot read as an error', () => {
    const r = parseSchwab(file, 'Retirement');
    expect(r.errors).toEqual([{ row: 8, message: 'Quantity must be a positive number (got "")' }]);
  });

  it('refuses a file that is not valid JSON', () => {
    expect(parseSchwab('{"BrokerageTransactions": [', 'Retirement').fileErrors).toEqual(['This file is not a complete Schwab JSON export']);
  });
});
