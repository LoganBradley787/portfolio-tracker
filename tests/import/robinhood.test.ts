import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRobinhoodExport, parseRobinhood } from '../../src/import/robinhood.ts';
import { FIXTURES } from '../helpers/fixtures.ts';

const file = readFileSync(join(FIXTURES, 'robinhood', 'transactions.csv'), 'utf8');
const header = 'Activity Date,Process Date,Settle Date,Instrument,Description,Trans Code,Quantity,Price,Amount';
const trade = '7/8/2026,7/9/2026,7/10/2026,DIS,Walt Disney,Buy,2.5,$90.125,($225.31)';

describe('Robinhood account activity CSV', () => {
  it('recognizes its header, including BOM, whitespace and case, without mistaking another format', () => {
    expect(isRobinhoodExport(file)).toBe(true);
    expect(isRobinhoodExport('\uFEFF\r\n' + header.toLowerCase() + '\r\n' + trade)).toBe(true);
    expect(isRobinhoodExport('Ticker,Type,Shares,Avg Price,Date\nDIS,Buy,1,90,7/8/2026')).toBe(false);
    expect(isRobinhoodExport('{"BrokerageTransactions": []}')).toBe(false);
    expect(isRobinhoodExport('Note\n' + header)).toBe(false);
  });

  it('maps fractional trades and currency prices using the activity date, oldest first', () => {
    const r = parseRobinhood(file, 'Taxable');
    expect(r.source).toBe('robinhood');
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.seq, x.date, x.ticker, x.type, x.shares, x.price, x.account])).toEqual([
      [1, '2026-06-03', 'VOO', 'Buy', 2.75, 1234.5, 'Taxable'],
      [2, '2026-07-08', 'DIS', 'Buy', 3, 101.25, 'Taxable'],
      [3, '2026-07-08', 'DIS', 'Sell', 1.25, 104.75, 'Taxable'],
    ]);
    expect(r.rows.map((x) => x.assetType)).toEqual(['ETF', null, null]);
    // Physical line numbers still point to the CSV after multiline descriptions.
    expect(r.rows.map((x) => x.row)).toEqual([9, 7, 6]);
    expect(r.splits).toEqual([]);
    expect(r.range).toBeUndefined(); // Activity dates do not say what report period was requested.
  });

  it('lists reinvestments, dividends, cash activity, options and the footer as skipped', () => {
    const skipped = parseRobinhood(file, 'Taxable').skipped!;
    expect(skipped).toEqual([
      { row: 2, message: 'Buy: the app reinvests dividends itself' },
      { row: 5, message: 'CDIV: dividends are handled by the app' },
      { row: 8, message: 'REC: not a supported stock/ETF trade' },
      { row: 11, message: 'SLIP: not a supported stock/ETF trade' },
      { row: 12, message: 'DCF: not a supported stock/ETF trade' },
      { row: 13, message: 'BTO: not a supported stock/ETF trade' },
      { row: 15, message: 'Report footer: not activity' },
    ]);
  });

  it('keeps accepting the old single-cell footer shape', () => {
    const r = parseRobinhood(header + '\n' + trade + '\n"Synthetic report disclaimer."', 'A');
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ row: 3, message: 'Report footer: not activity' }]);
  });

  it('skips the real ten-cell disclaimer shape after an empty quoted cell', () => {
    const footer = Array(9).fill('""').join(',') + ',"Synthetic report disclaimer."';
    const r = parseRobinhood(header + '\n' + trade + '\n""\n' + footer, 'A');
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ row: 4, message: 'Report footer: not activity' }]);
  });

  it.each([
    ['date, extra cell', ['7/8/2026', '', '', '', '', '', '', '', '', 'extra']],
    ['code, extra cell', ['', '', '', '', '', 'Buy', '', '', '', 'extra']],
    ['date, truncated', ['7/8/2026']],
    ['code, truncated', ['', '', '', '', '', 'Buy']],
  ])('keeps column-count errors when activity has a %s', (_name, cells) => {
    const r = parseRobinhood(header + '\n' + cells.map((cell) => `"${cell}"`).join(','), 'A');
    expect(r.rows).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.errors).toEqual([{ row: 2, message: `Expected 9 columns, got ${cells.length}` }]);
  });

  it('keeps the column-count error when a reordered header puts the code in the first cell', () => {
    const reordered = 'Trans Code,Activity Date,Instrument,Description,Quantity,Price';
    const r = parseRobinhood(reordered + '\n"Buy"', 'A');
    expect(r.skipped).toEqual([]);
    expect(r.errors).toEqual([{ row: 2, message: 'Expected 6 columns, got 1' }]);
  });

  it('reads reordered quoted headers, escaped quotes, blank lines and CRLF without using the cash amount as price', () => {
    const r = parseRobinhood('\uFEFF\r\n"Trans Code","Description","Price","Quantity","Instrument","Activity Date"\r\n' +
      '"Buy","Example, ""quoted""\r\nCUSIP: synthetic","$12.345","0.000001","DIS","2026-07-08"\r\n\r\n', 'A');
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ row: 3, shares: 0.000001, price: 12.345, date: '2026-07-08', ticker: 'DIS' });
  });

  it.each(['Dividend Reinvestment', 'DIVIDEND RE-INVESTMENT', 'DRIP'])('skips %s buys even with an unreadable trade quantity', (description) => {
    const r = parseRobinhood(header + '\n' + trade.replace('Walt Disney', description).replace('2.5', ''), 'A');
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.skipped![0].message).toContain('reinvests dividends');
  });

  it.each([
    ['Instrument', 'DIS', '', /Instrument/],
    ['Instrument', 'DIS', 'DIS 260717C00100000', /Instrument/],
    ['Activity Date', '7/8/2026', '2/30/2026', /Activity Date/],
    ['Quantity', '2.5', '', /Quantity/],
    ['Quantity', '2.5', '-1', /Quantity/],
    ['Quantity', '2.5', '1e999', /Quantity/],
    ['Price', '$90.125', '', /Price/],
    ['Price', '$90.125', '-1', /Price/],
    ['Price', '$90.125', '1e999', /Price/],
  ])('reports invalid %s (%s → %s) as a row error', (_field, before, after, message) => {
    const r = parseRobinhood(header + '\n' + trade.replace(before, after), 'A');
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ row: 2, message: expect.stringMatching(message) }]);
  });

  it('accepts a zero price but reports an activity row with a missing transaction code', () => {
    expect(parseRobinhood(header + '\n' + trade.replace('$90.125', '$0'), 'A').rows[0].price).toBe(0);
    const r = parseRobinhood(header + '\n' + trade.replace(',Buy,', ',,'), 'A');
    expect(r.errors).toEqual([{ row: 2, message: expect.stringMatching(/Trans Code/) }]);
  });

  it('reports missing columns and duplicate headers as file errors', () => {
    expect(isRobinhoodExport(header.replace(',Price', ''))).toBe(true);
    expect(parseRobinhood(header.replace(',Price', ''), 'A').fileErrors).toEqual(['Missing required column: Price']);
    expect(parseRobinhood(header + ',Price', 'A').fileErrors).toEqual(['Duplicate column: Price']);
    expect(parseRobinhood('', 'A').fileErrors.length).toBeGreaterThan(0);
  });

  it.each([
    header + '\n"7/8/2026,7/9/2026',
    header + '\n' + trade.replace('Walt Disney', 'Walt "Disney'),
    header + '\n' + trade.replace('Walt Disney', '"Walt Disney"oops'),
  ])('refuses malformed CSV quoting', (text) => {
    const r = parseRobinhood(text, 'A');
    expect(r.fileErrors).toEqual([expect.stringMatching(/CSV/)]);
    expect(r.rows).toEqual([]);
  });

  it('reports truncated or extra activity cells instead of silently saving shifted data', () => {
    for (const row of [trade.split(',').slice(0, 7).join(','), trade + ',extra']) {
      const r = parseRobinhood(header + '\n' + row, 'A');
      expect(r.errors).toEqual([{ row: 2, message: expect.stringMatching(/columns/) }]);
      expect(r.rows).toEqual([]);
    }
  });
});
