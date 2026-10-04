import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/engine/costBasis.ts';
import type { Split, Transaction } from '../../src/engine/types.ts';
import { fixtureSplits, readJson, sampleTransactions } from '../helpers/fixtures.ts';

const expected = readJson('sample', 'expected-from-sheet.json');
const TOL = 6; // toBeCloseTo digits → 1e-6 / 2

let nextSeq = 1;
function tx(date: string, type: 'Buy' | 'Sell', shares: number, price: number, ticker = 'AAA', account = 'Main'): Transaction {
  const seq = nextSeq++;
  return { id: seq, seq, ticker, type, shares, price, date, account };
}

describe('average cost against the sheet sample', () => {
  const ledger = runLedger(sampleTransactions(), expected.splitsKnownToSheet, { method: 'average' });

  it('matches every ticker’s shares and total cost', () => {
    for (const [ticker, h] of Object.entries<any>(expected.holdings)) {
      const p = ledger.positions.get(ticker)!;
      expect(p, ticker).toBeDefined();
      expect(p.shares, ticker).toBeCloseTo(h.shares, TOL);
      expect(p.cost, ticker).toBeCloseTo(h.totalCost, TOL);
    }
    expect([...ledger.positions.keys()].sort()).toEqual(Object.keys(expected.holdings).sort());
  });

  it('matches the running shares and cost after each transaction', () => {
    const rows = expected.runningByTransaction.filter((r: any) => r.type !== 'Split');
    expect(ledger.steps).toHaveLength(rows.length);
    // The sheet's running shares are split-adjusted by every later split; ours are as held that day.
    const laterRatio = (ticker: string, date: string) =>
      expected.splitsKnownToSheet.filter((x: any) => x.ticker === ticker && x.exDate > date).reduce((a: number, x: any) => a * x.ratio, 1);
    ledger.steps.forEach((s, i) => {
      expect(s.ticker).toBe(rows[i].ticker);
      expect(s.shares * laterRatio(s.ticker, s.date)).toBeCloseTo(rows[i].runningShares, TOL);
      expect(s.cost).toBeCloseTo(rows[i].runningCost, TOL);
    });
  });

  it('matches total cost and the one sale', () => {
    const total = [...ledger.positions.values()].reduce((a, p) => a + p.cost, 0);
    expect(total).toBeCloseTo(expected.totals.totalCost, TOL);
    expect(ledger.sales).toHaveLength(1);
    const s = ledger.sales[0];
    const e = expected.realized[0];
    expect(s.ticker).toBe('TSLA');
    expect(s.date).toBe(e.date);
    expect(s.account).toBe(e.account);
    expect(s.sharesSold).toBe(e.sharesSold);
    expect(s.proceeds).toBeCloseTo(e.proceeds, TOL);
    expect(s.costRemoved).toBeCloseTo(e.costRemoved, TOL);
    expect(s.avgBuyPrice).toBeCloseTo(e.avgBuyPrice, TOL);
    expect(s.gain).toBeCloseTo(e.gain, TOL);
    expect(s.gainPerShare).toBeCloseTo(e.gainPerShare, TOL);
    expect(s.gainPct).toBeCloseTo(e.gainPct, TOL);
    expect(ledger.oversells).toEqual([]);
  });
});

describe('average cost with the provider’s real splits', () => {
  const ledger = runLedger(sampleTransactions(), fixtureSplits(), { method: 'average' });

  it('applies TSLA’s 2022 3-for-1 that the sheet missed', () => {
    const t = ledger.positions.get('TSLA')!;
    expect(t.shares).toBeCloseTo(12, 9);
    expect(t.cost).toBeCloseTo(2707.52, TOL);
    expect(t.cost / t.shares).toBeCloseTo(225.6267, 4);
  });

  it('leaves SHOP as the sheet has it', () => {
    const s = ledger.positions.get('SHOP')!;
    expect(s.shares).toBeCloseTo(30, 9);
    expect(s.cost).toBeCloseTo(1119.63, TOL);
  });

  it('does not change the TSLA sale (it predates the 2022 split)', () => {
    expect(ledger.sales[0].gain).toBeCloseTo(170.88, TOL);
  });
});

describe('average cost, synthetic cases', () => {
  it('handles a reverse split: shares × 0.1, cost unchanged', () => {
    const splits: Split[] = [{ ticker: 'AAA', exDate: '2024-05-01', ratio: 0.1 }];
    const l = runLedger([tx('2024-01-02', 'Buy', 100, 2)], splits, { method: 'average' });
    expect(l.positions.get('AAA')!.shares).toBeCloseTo(10, 12);
    expect(l.positions.get('AAA')!.cost).toBeCloseTo(200, 12);
  });

  it('starts a fresh pool after a full exit and re-entry', () => {
    const l = runLedger(
      [tx('2024-01-02', 'Buy', 10, 10), tx('2024-02-01', 'Sell', 10, 12), tx('2024-03-01', 'Buy', 5, 20)],
      [],
      { method: 'average' },
    );
    const p = l.positions.get('AAA')!;
    expect(p.shares).toBe(5);
    expect(p.cost).toBeCloseTo(100, 12);
    expect(l.sales[0].gain).toBeCloseTo(20, 12);
  });

  it('closes a position within 1e-9 of zero shares', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 0.3, 10), tx('2024-02-01', 'Sell', 0.1 + 0.2, 12)], [], {
      method: 'average',
    });
    expect(l.positions.has('AAA')).toBe(false);
  });

  it('keeps a fractional 0.4-share position (unlike the sheet)', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 1.4, 10), tx('2024-02-01', 'Sell', 1, 12)], [], { method: 'average' });
    expect(l.positions.get('AAA')!.shares).toBeCloseTo(0.4, 12);
    expect(l.positions.get('AAA')!.cost).toBeCloseTo(4, 12);
  });

  it('pools cost across accounts', () => {
    const l = runLedger(
      [tx('2024-01-02', 'Buy', 1, 10, 'AAA', 'Main'), tx('2024-01-03', 'Buy', 1, 20, 'AAA', 'Brokerage'), tx('2024-02-01', 'Sell', 1, 30, 'AAA', 'Main')],
      [],
      { method: 'average' },
    );
    expect(l.sales[0].costRemoved).toBeCloseTo(15, 12);
    expect(l.positions.get('AAA')!.accounts).toEqual(['Brokerage', 'Main']);
  });

  it('clamps an oversell to the shares held and reports it (review focus 1)', () => {
    const sell = tx('2024-02-01', 'Sell', 15, 12);
    const l = runLedger([tx('2024-01-02', 'Buy', 10, 10), sell], [], { method: 'average' });
    expect(l.oversells).toEqual([
      { txId: sell.id, ticker: 'AAA', account: 'Main', date: '2024-02-01', requested: 15, held: 10 },
    ]);
    expect(l.positions.has('AAA')).toBe(false);
    expect(l.sales[0].sharesSold).toBe(10);
    expect(l.sales[0].proceeds).toBeCloseTo(120, 12);
    expect(l.sales[0].costRemoved).toBeCloseTo(100, 12);
  });

  for (const method of ['average', 'fifo'] as const) {
    it(`closes a position quietly when the sale is over by less than $1 (${method})`, () => {
      // Reinvested-share estimates differ from the broker's by fractions of a cent's worth.
      const l = runLedger([tx('2024-01-02', 'Buy', 10, 100), tx('2024-02-01', 'Sell', 10.009, 100)], [], { method });
      expect(l.oversells).toEqual([]);
      expect(l.positions.has('AAA')).toBe(false);
      expect(l.sales[0].sharesSold).toBe(10);
    });

    it(`still reports a sale that is over by more than $1 (${method})`, () => {
      const l = runLedger([tx('2024-01-02', 'Buy', 10, 100), tx('2024-02-01', 'Sell', 10.02, 100)], [], { method });
      expect(l.oversells).toHaveLength(1);
    });
  }

  it('still reports a small sale of a ticker never held', () => {
    const l = runLedger([tx('2024-02-01', 'Sell', 0.001, 12, 'ZZZ')], [], { method: 'average' });
    expect(l.oversells).toHaveLength(1);
  });

  it('reports a sale of a ticker never held as an oversell with no sale row', () => {
    const l = runLedger([tx('2024-02-01', 'Sell', 1, 12, 'ZZZ')], [], { method: 'average' });
    expect(l.oversells).toHaveLength(1);
    expect(l.oversells[0].held).toBe(0);
    expect(l.sales).toEqual([]);
  });

  it('stops at the as-of date', () => {
    const l = runLedger([tx('2024-01-02', 'Buy', 1, 10), tx('2024-02-01', 'Buy', 1, 10)], [], {
      method: 'average',
      asOf: '2024-01-31',
    });
    expect(l.positions.get('AAA')!.shares).toBe(1);
  });
});
