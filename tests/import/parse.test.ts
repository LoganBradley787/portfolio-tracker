import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImport } from '../../src/import/parse.ts';
import { exportCsv } from '../../src/import/export.ts';
import { FIXTURES, sampleTransactions } from '../helpers/fixtures.ts';

const read = (f: string) => readFileSync(join(FIXTURES, 'sample', f), 'utf8');

describe('parseImport on the sample', () => {
  for (const file of ['transactions.tsv', 'transactions.csv']) {
    it(`parses ${file} into 14 trades and 1 skipped split row`, () => {
      const r = parseImport(read(file));
      expect(r.fileErrors).toEqual([]);
      expect(r.errors).toEqual([]);
      expect(r.rows).toHaveLength(14);
      expect(r.splits).toEqual([{ row: 15, ticker: 'SHOP', exDate: '2022-06-29', ratio: 10 }]);
      expect(r.rows.map((x) => x.seq)).toEqual([...Array(14)].map((_, i) => i + 1));
      expect(r.rows[0]).toEqual({
        row: 2,
        seq: 1,
        ticker: 'DIS',
        assetType: 'Stock',
        type: 'Buy',
        shares: 30,
        price: 111.46,
        date: '2020-03-10',
        account: 'Main',
        note: '',
      });
      expect(r.rows[12]).toMatchObject({ ticker: 'ZM', assetType: 'Stock' });
      expect(r.rows[13]).toMatchObject({ row: 16, ticker: 'QQQM', assetType: 'ETF', date: '2022-07-06' });
      const want = sampleTransactions();
      r.rows.forEach((x, i) => expect([x.ticker, x.type, x.shares, x.price, x.date, x.account]).toEqual([
        want[i].ticker, want[i].type, want[i].shares, want[i].price, want[i].date, want[i].account,
      ]));
    });
  }
});

describe('parseImport edge cases (review focus 4)', () => {
  it('accepts $ and commas, both date formats, blank lines and lower-case headers', () => {
    const text = [
      'ticker\tasset type\ttype\tshares\tsplit (n to 1)\tavg price\tdate\taccount\t',
      'aapl\tStock\tbuy\t1,000\t\t$1,234.50\t3/9/2020\tMain\tfirst lot',
      '',
      '\t\t\t\t\t\t\t\t',
      'AAPL\tStock\tSell\t2\t\t$10\t2020-03-10\tBrokerage\t',
      '',
    ].join('\n');
    const r = parseImport(text);
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ row: 2, ticker: 'AAPL', type: 'Buy', shares: 1000, price: 1234.5, date: '2020-03-09', note: 'first lot' });
    expect(r.rows[1]).toMatchObject({ row: 5, seq: 2, type: 'Sell', date: '2020-03-10', account: 'Brokerage' });
  });

  it('handles quoted CSV fields with commas and CRLF line endings', () => {
    const text = 'Ticker,Asset Type,Type,Shares,Split (n to 1),Avg Price,Date,Account\r\nVOO,ETF,Buy,"1,200","","$1,234.50",12/31/2021,"Main"\r\n';
    const r = parseImport(text);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ ticker: 'VOO', assetType: 'ETF', shares: 1200, price: 1234.5, date: '2021-12-31' });
  });

  it('reports per-row errors with row numbers and keeps the good rows', () => {
    const text = [
      'Ticker,Asset Type,Type,Shares,Split (n to 1),Avg Price,Date,Account',
      'AAA,Stock,Dividend,1,,10,1/2/2024,Main',
      'BBB,Stock,Buy,abc,,10,1/2/2024,Main',
      'CCC,Stock,Buy,1,,10,13/45/2024,Main',
      ',Stock,Buy,1,,10,1/2/2024,Main',
      'DDD,Bond,Buy,1,,10,1/2/2024,Main',
      'EEE,Stock,Buy,-1,,10,1/2/2024,Main',
      'FFF,,Split,,,,1/2/2024,',
      'GGG,Stock,Buy,1,,10,2/30/2024,Main',
      'OK,Stock,Buy,1,,10,1/2/2024,Main',
    ].join('\n');
    const r = parseImport(text);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.errors[0].message).toMatch(/Type/);
    expect(r.errors[1].message).toMatch(/Shares/);
    expect(r.errors[2].message).toMatch(/Date/);
    expect(r.errors[3].message).toMatch(/Ticker/);
    expect(r.errors[4].message).toMatch(/Asset Type/);
    expect(r.errors[5].message).toMatch(/Shares/);
    expect(r.errors[6].message).toMatch(/Split/);
    expect(r.errors[7].message).toMatch(/Date/);
    expect(r.rows.map((x) => [x.ticker, x.seq])).toEqual([['OK', 1]]);
  });

  it('reports a missing required column as a file-level error', () => {
    const r = parseImport('Ticker,Type,Shares,Date\nAAA,Buy,1,1/2/2024');
    expect(r.fileErrors).toEqual(['Missing required column: Avg Price']);
    expect(r.rows).toEqual([]);
  });

  it('reports empty input as a file-level error', () => {
    expect(parseImport('  \n\n').fileErrors).toEqual(['Nothing to import']);
  });
});

describe('exportCsv', () => {
  it('round-trips through parseImport', () => {
    const first = parseImport(read('transactions.csv'));
    const assetTypes = Object.fromEntries(first.rows.map((r) => [r.ticker, r.assetType ?? 'Stock']));
    const txs = first.rows.map((r, i) => ({ id: i + 1, seq: r.seq, ticker: r.ticker, type: r.type, shares: r.shares, price: r.price, date: r.date, account: r.account, note: i === 0 ? 'has, comma "quoted"' : '' }));
    const csv = exportCsv(txs, assetTypes);
    expect(csv.split('\n')[0]).toBe('Ticker,Asset Type,Type,Shares,Split (n to 1),Avg Price,Date,Account,Note');
    const again = parseImport(csv);
    expect(again.errors).toEqual([]);
    expect(again.splits).toEqual([]);
    expect(again.rows.map(({ row, ...rest }) => rest)).toEqual(
      first.rows.map(({ row, ...rest }, i) => ({ ...rest, note: i === 0 ? 'has, comma "quoted"' : '' })),
    );
  });
});
